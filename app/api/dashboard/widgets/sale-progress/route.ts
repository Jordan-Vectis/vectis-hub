import { prisma } from "@/lib/prisma"
import { widgetRoute } from "@/lib/dashboard-guard"
import { getBcSaleCounts } from "@/lib/bc-sale-counts"
import { paceFor, milestonesFor, DAY } from "@/lib/sale-projection"

export const dynamic = "force-dynamic"
export const maxDuration = 120

// Active sales: Hub lots and BC lots as SEPARATE figures, plus pace and the
// projected date for the next hundred.
//
// ⚠ Two figures, not one combined total — Jack's call on 2026-08-05, so the gap
// between the systems is visible rather than hidden inside a union. The
// underlying numbers still come from lib/bc-sale-counts.ts, the same source the
// Sales tab uses, so the two tabs cannot disagree about a sale.
//
// ⚠ Department-gated: the sale list applies ctx.saleWhere. A manager who can't
// see Trains sales must not see them here either.

export async function GET() {
  return widgetRoute("sale-progress", async ctx => {
    const auctions = await prisma.catalogueAuction.findMany({
      where:   { complete: false, ...ctx.saleWhere },
      orderBy: { auctionDate: "asc" },
      select:  { id: true, code: true, name: true, auctionDate: true, _count: { select: { lots: true } } },
    })

    if (auctions.length === 0) {
      return { kind: "table", columns: [], rows: [], empty: "No sales in progress." }
    }

    // Lots per day per sale — the "active days" denominator behind the pace.
    // Defensive: without it the widget still shows counts, just no projection.
    let daily: { auctionId: string; days: number }[] = []
    try {
      daily = await prisma.$queryRaw<{ auctionId: string; days: number }[]>`
        SELECT l."auctionId" AS "auctionId", COUNT(DISTINCT date_trunc('day', l."createdAt"))::int AS days
        FROM "CatalogueLot" l
        JOIN "CatalogueAuction" a ON a.id = l."auctionId"
        WHERE a.complete = false
        GROUP BY l."auctionId"`
    } catch { /* projection omitted */ }
    const daysMap = new Map(daily.map(d => [d.auctionId, Number(d.days)]))

    // BC is slow and rate-limited; a failure must cost the BC column, not the
    // widget. Everything Hub-side is already in hand by this point.
    let bc: Awaited<ReturnType<typeof getBcSaleCounts>> = { connected: false, sales: {} }
    try { bc = await getBcSaleCounts(60_000) } catch { /* leave disconnected */ }

    const now = Date.now()
    const rows = auctions.slice(0, 12).map(a => {
      const hub   = a._count.lots
      const count = bc.sales[a.code]
      const pace  = paceFor(hub, daysMap.get(a.id) ?? 0)
      const saleTs = a.auctionDate ? new Date(a.auctionDate).getTime() : now + 90 * DAY
      const next  = milestonesFor(hub, pace, now, saleTs, 1)[0]

      return [
        a.code,
        hub,
        !bc.connected ? "—" : count === null || count === undefined ? "—" : count.bc,
        pace > 0 ? (pace >= 10 ? Math.round(pace) : pace.toFixed(1)) : "—",
        a.auctionDate ? new Date(a.auctionDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—",
        next ? `${next.target} by ${new Date(next.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}${next.late ? " ⚠" : ""}` : "—",
      ]
    })

    return {
      kind: "table",
      columns: ["Sale", "Hub", "BC", "Per day", "Sale date", "Next hundred"],
      align:   ["left", "right", "right", "right", "left", "left"],
      rows,
      note: bc.connected
        ? "Hub and BC counted separately — BC counts lots ticked as catalogued there. ⚠ marks a milestone projected to land after the sale date."
        : "Not connected to Business Central, so the BC column is blank.",
      empty: "No sales in progress.",
    }
  })
}
