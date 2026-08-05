import { prisma } from "@/lib/prisma"
import { widgetRoute } from "@/lib/dashboard-guard"

export const dynamic = "force-dynamic"

// Open IT tickets by priority, with the age of the oldest.
// RESOLVED and CLOSED are done; everything else is still someone's problem.

const OPEN = ["OPEN", "IN_PROGRESS", "AWAITING_RESPONSE"]
const ORDER = ["URGENT", "HIGH", "MEDIUM", "LOW"]

export async function GET() {
  return widgetRoute("job-board", async () => {
    const [byPriority, oldest] = await Promise.all([
      prisma.ticket.groupBy({
        by: ["priority"],
        where: { status: { in: OPEN } },
        _count: { _all: true },
      }),
      prisma.ticket.findFirst({
        where:   { status: { in: OPEN } },
        orderBy: { createdAt: "asc" },
        select:  { createdAt: true },
      }),
    ])

    const total = byPriority.reduce((n, p) => n + p._count._all, 0)
    if (total === 0) {
      return { kind: "stat", value: "0", sub: "Nothing open" }
    }

    const days = oldest ? Math.floor((Date.now() - new Date(oldest.createdAt).getTime()) / 86_400_000) : 0
    const parts = ORDER
      .map(p => ({ p, n: byPriority.find(b => b.priority === p)?._count._all ?? 0 }))
      .filter(x => x.n > 0)
      .map(x => `${x.n} ${x.p.toLowerCase()}`)

    const urgent = byPriority.find(b => b.priority === "URGENT")?._count._all ?? 0

    return {
      kind: "stat",
      value: String(total),
      sub: parts.join(" · "),
      delta: { text: days <= 0 ? "oldest opened today" : `oldest open ${days} day${days === 1 ? "" : "s"}`, good: urgent === 0 && days < 7 },
    }
  })
}
