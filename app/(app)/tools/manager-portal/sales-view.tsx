import { prisma } from "@/lib/prisma"
import ManagerPortalTable, { type SaleRow } from "./manager-portal-table"

// The original Manager Portal table — every sale across both systems, pace and
// projected milestones. Lifted out of page.tsx unchanged when the portal gained
// tabs; the queries and the maths are exactly as they were.
export default async function SalesView() {
  const [auctions, dailyRows, timingAgg, catAgg] = await Promise.all([
    prisma.catalogueAuction.findMany({
      orderBy: { auctionDate: "desc" },
      include: { _count: { select: { lots: true } } },
    }),
    // Lots catalogued per day, per ACTIVE sale — drives the pace, the "active
    // days" denominator and the sparkline. Defensive: a failure just omits it.
    (async () => {
      try {
        return await prisma.$queryRaw<{ auctionId: string; day: Date; n: number }[]>`
          SELECT l."auctionId" AS "auctionId", date_trunc('day', l."createdAt") AS day, COUNT(*)::int AS n
          FROM "CatalogueLot" l
          JOIN "CatalogueAuction" a ON a.id = l."auctionId"
          WHERE a.complete = false
          GROUP BY l."auctionId", date_trunc('day', l."createdAt")
          ORDER BY day ASC`
      } catch {
        return [] as { auctionId: string; day: Date; n: number }[]
      }
    })(),
    // Exclude orphaned timing logs (a lotId matching no lot — the phantom
    // "deleted lot" rows) so the pace/leaderboard counts here match the Reports
    // pages. Logs with a null lotId are kept.
    prisma.$queryRaw<{ auctionId: string; avgMs: number | null; count: number }[]>`
      SELECT t."auctionId"            AS "auctionId",
             AVG(t."durationMs")::float8 AS "avgMs",
             COUNT(*)::int            AS "count"
      FROM "CatalogueTimingLog" t
      WHERE (t."lotId" IS NULL OR EXISTS (SELECT 1 FROM "CatalogueLot" l WHERE l."id" = t."lotId"))
      GROUP BY t."auctionId"`,
    prisma.$queryRaw<{ auctionId: string; userName: string; count: number }[]>`
      SELECT t."auctionId"  AS "auctionId",
             t."userName"   AS "userName",
             COUNT(*)::int  AS "count"
      FROM "CatalogueTimingLog" t
      WHERE (t."lotId" IS NULL OR EXISTS (SELECT 1 FROM "CatalogueLot" l WHERE l."id" = t."lotId"))
      GROUP BY t."auctionId", t."userName"`,
  ])

  const dailyMap = new Map<string, number[]>()  // auctionId → chronological per-day lot counts
  for (const r of dailyRows) {
    const arr = dailyMap.get(r.auctionId) ?? []
    arr.push(Number(r.n))
    dailyMap.set(r.auctionId, arr)
  }

  const timingMap = new Map(timingAgg.map(v => [v.auctionId, v]))

  const catMap = new Map<string, { name: string; count: number }[]>()
  for (const row of catAgg) {
    const arr = catMap.get(row.auctionId) ?? []
    arr.push({ name: row.userName, count: row.count })
    catMap.set(row.auctionId, arr)
  }
  for (const [k, arr] of catMap) catMap.set(k, arr.sort((a, b) => b.count - a.count).slice(0, 3))

  // "In BC" is MEASURED — lots whose BARCODE is in the synced BC data, the same query as the
  // Auction Manager and the overview PDF. It replaced the "Added to BC" tick in the Completed
  // table on 2026-09-15, when that tick came off Auction Settings. ⚠ Reflects the last Data
  // Sync, not BC live. A failure leaves the column at 0 rather than taking the portal down.
  let inBC = new Map<string, number>()
  try {
    const bcRows = await prisma.$queryRaw<{ auctionId: string; n: bigint }[]>`
      SELECT l."auctionId" AS "auctionId", count(DISTINCT l.id) AS n
      FROM "CatalogueLot" l
      JOIN "WarehouseItem" w ON upper(w.barcode) = upper(l.barcode)
      WHERE l."auctionId" = ANY(${auctions.map(a => a.id)}::text[])
        AND l.barcode IS NOT NULL AND btrim(l.barcode) <> ''
      GROUP BY l."auctionId"`
    inBC = new Map(bcRows.map(r => [r.auctionId, Number(r.n)]))
  } catch { /* the BC mirror is a convenience here */ }

  const rows: SaleRow[] = auctions.map(a => {
    const tim = timingMap.get(a.id)
    return {
      id:          a.id,
      code:        a.code,
      name:        a.name,
      auctionDate: a.auctionDate ? new Date(a.auctionDate).toISOString() : null,
      auctionType: a.auctionType,
      hubLots:     a._count.lots,
      complete:    !!a.complete,
      lotsInBC:    inBC.get(a.id) ?? 0,
      daily:       dailyMap.get(a.id) ?? [],
      avgDurationMs: tim?.avgMs ?? null,
      timedLots:   tim?.count ?? 0,
      topCataloguers: catMap.get(a.id) ?? [],
    }
  })

  return <ManagerPortalTable rows={rows} nowMs={Date.now()} />
}
