import { prisma } from "@/lib/prisma"
import { widgetRoute } from "@/lib/dashboard-guard"
import { paceFor, daysToSale } from "@/lib/sale-projection"

export const dynamic = "force-dynamic"

// The next sales by date: how far off, how many lots, and whether the current
// pace gets them there. Department-gated like every other sale list.

export async function GET() {
  return widgetRoute("sale-countdown", async ctx => {
    const auctions = await prisma.catalogueAuction.findMany({
      where:   { complete: false, auctionDate: { not: null }, ...ctx.saleWhere },
      orderBy: { auctionDate: "asc" },
      take:    8,
      select:  { id: true, code: true, name: true, auctionDate: true, _count: { select: { lots: true } } },
    })
    if (auctions.length === 0) {
      return { kind: "list", rows: [], empty: "No dated sales in progress." }
    }

    // Active days per sale — the denominator behind the pace. Grouped over all
    // active sales rather than the eight shown; it's one indexed scan either way
    // and it avoids building a variable IN list in raw SQL.
    // Defensive: without it the list still shows dates and lot counts.
    let daily: { auctionId: string; days: number }[] = []
    try {
      daily = await prisma.$queryRaw<{ auctionId: string; days: number }[]>`
        SELECT l."auctionId" AS "auctionId", COUNT(DISTINCT date_trunc('day', l."createdAt"))::int AS days
        FROM "CatalogueLot" l
        JOIN "CatalogueAuction" a ON a.id = l."auctionId"
        WHERE a.complete = false
        GROUP BY l."auctionId"`
    } catch { /* no projection */ }
    const daysMap = new Map(daily.map(d => [d.auctionId, Number(d.days)]))

    const now = Date.now()
    return {
      kind: "list",
      rows: auctions.map(a => {
        const left  = daysToSale(a.auctionDate ? new Date(a.auctionDate).toISOString() : null, now)
        const lots  = a._count.lots
        const pace  = paceFor(lots, daysMap.get(a.id) ?? 0)
        const more  = left != null && left > 0 && pace > 0 ? Math.round(pace * left) : 0
        return {
          label: a.code,
          sub:   left == null ? "" : left < 0 ? "past" : left === 0 ? "today" : `${left}d · ${lots} lots${more ? ` → ~${lots + more}` : ""}`,
          value: a.auctionDate ? new Date(a.auctionDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—",
        }
      }),
      note: "Projection uses each sale's own cataloguing pace.",
    }
  })
}
