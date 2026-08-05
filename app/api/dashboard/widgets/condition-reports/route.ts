import { prisma } from "@/lib/prisma"
import { widgetRoute } from "@/lib/dashboard-guard"

export const dynamic = "force-dynamic"

// Condition-report requests still to be answered, and how long the oldest has
// been sitting. Anything not DONE counts as outstanding — NEW and IN_PROGRESS
// both mean the customer hasn't had their answer.

export async function GET() {
  return widgetRoute("condition-reports", async () => {
    const [counts, oldest] = await Promise.all([
      prisma.conditionReport.groupBy({
        by: ["status"],
        where: { status: { not: "DONE" } },
        _count: { _all: true },
      }),
      prisma.conditionReport.findFirst({
        where:   { status: { not: "DONE" } },
        orderBy: { receivedAt: "asc" },
        select:  { receivedAt: true },
      }),
    ])

    const total = counts.reduce((n, c) => n + c._count._all, 0)
    const isNew = counts.find(c => c.status === "NEW")?._count._all ?? 0

    let waited = ""
    if (oldest?.receivedAt) {
      const days = Math.floor((Date.now() - new Date(oldest.receivedAt).getTime()) / 86_400_000)
      waited = days <= 0 ? "oldest came in today" : `oldest waiting ${days} day${days === 1 ? "" : "s"}`
    }

    return {
      kind: "stat",
      value: String(total),
      sub: total === 0 ? "All answered" : `${isNew} not started${waited ? ` · ${waited}` : ""}`,
      delta: total === 0 ? undefined : { text: waited || "", good: false },
    }
  })
}
