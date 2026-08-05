import { prisma } from "@/lib/prisma"
import { widgetRoute } from "@/lib/dashboard-guard"
import { ukDayStartUtc } from "@/lib/cataloguing-reports"

export const dynamic = "force-dynamic"

// Lots catalogued today, against yesterday.
//
// ⚠ Days are LONDON days (ukDayStartUtc), not server days. The server runs UTC
// and the business is UK — bucketing on the server day mis-assigns everything
// catalogued after 11pm through all of BST, which is exactly the kind of quiet
// wrongness a dashboard figure must not have.

export async function GET() {
  return widgetRoute("lots-today", async ctx => {
    const now            = new Date()
    const startToday     = ukDayStartUtc(now, 0)
    const startYesterday = ukDayStartUtc(now, 1)

    const [today, yesterday] = await Promise.all([
      prisma.catalogueLot.count({
        where: { createdAt: { gte: startToday }, auction: ctx.saleWhere },
      }),
      prisma.catalogueLot.count({
        where: { createdAt: { gte: startYesterday, lt: startToday }, auction: ctx.saleWhere },
      }),
    ])

    const diff = today - yesterday
    return {
      kind: "stat",
      value: String(today),
      sub: `${yesterday} yesterday`,
      delta: yesterday === 0 && today === 0
        ? undefined
        : { text: diff >= 0 ? `+${diff} on yesterday` : `${diff} on yesterday`, good: diff >= 0 },
      note: ctx.access.unrestricted ? undefined : "Your departments' sales only.",
    }
  })
}
