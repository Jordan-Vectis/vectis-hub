import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { hasAppAccess } from "@/lib/apps"
import ManagerPortalTable, { type SaleRow } from "./manager-portal-table"

export const dynamic = "force-dynamic"

export const metadata = { title: "Manager Portal" }

export default async function ManagerPortalPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, allowedApps: true },
  })
  if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "MANAGER_PORTAL")) redirect("/hub")

  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000)

  const [auctions, valueAgg, spanAgg, recent7, statusAgg, bcLotsAgg, timingAgg, catAgg] = await Promise.all([
    prisma.catalogueAuction.findMany({
      orderBy: { auctionDate: "desc" },
      include: { _count: { select: { lots: true } } },
    }),
    // £ estimate totals + averages per sale
    prisma.catalogueLot.groupBy({
      by: ["auctionId"],
      _sum:   { estimateLow: true, estimateHigh: true },
      _avg:   { estimateLow: true, estimateHigh: true },
      _count: { estimateLow: true },
    }),
    // First + last lot ever for the sale — pace = lots ÷ that active span (steady,
    // not skewed by a quiet few days)
    prisma.catalogueLot.groupBy({
      by: ["auctionId"],
      _min: { createdAt: true },
      _max: { createdAt: true },
    }),
    // Lots created in the last 7 days — a recent-activity figure
    prisma.catalogueLot.groupBy({
      by: ["auctionId"],
      where: { createdAt: { gte: sevenDaysAgo } },
      _count: { _all: true },
    }),
    // Status breakdown
    prisma.catalogueLot.groupBy({
      by: ["auctionId", "status"],
      _count: { _all: true },
    }),
    // Lots ticked Added-to-BC
    prisma.catalogueLot.groupBy({
      by: ["auctionId"],
      where: { addedToBC: true },
      _count: { _all: true },
    }),
    // Cataloguing speed (avg ms per lot) from the timing logs
    prisma.catalogueTimingLog.groupBy({
      by: ["auctionId"],
      _avg:   { durationMs: true },
      _count: { _all: true },
    }),
    // Per-cataloguer lot counts → top contributors per sale
    prisma.catalogueTimingLog.groupBy({
      by: ["auctionId", "userName"],
      _count: { _all: true },
    }),
  ])

  // Photo coverage needs an array-length check Prisma groupBy can't express — one
  // defensive raw query; if it ever fails the page still renders without it.
  let photoMap = new Map<string, number>()
  try {
    const photoRows = await prisma.$queryRaw<{ auctionId: string; n: number }[]>`
      SELECT "auctionId", COUNT(*)::int AS n
      FROM "CatalogueLot"
      WHERE cardinality("imageUrls") > 0
      GROUP BY "auctionId"`
    photoMap = new Map(photoRows.map(r => [r.auctionId, Number(r.n)]))
  } catch { /* photo coverage is optional */ }

  const valueMap = new Map(valueAgg.map(v => [v.auctionId, v]))
  const spanMap  = new Map(spanAgg.map(v => [v.auctionId, v]))
  const r7Map    = new Map(recent7.map(v => [v.auctionId, v._count._all]))
  const bcLotsMap = new Map(bcLotsAgg.map(v => [v.auctionId, v._count._all]))
  const timingMap = new Map(timingAgg.map(v => [v.auctionId, v]))

  const statusMap = new Map<string, Record<string, number>>()
  for (const row of statusAgg) {
    const m = statusMap.get(row.auctionId) ?? {}
    m[row.status] = row._count._all
    statusMap.set(row.auctionId, m)
  }

  const catMap = new Map<string, { name: string; count: number }[]>()
  for (const row of catAgg) {
    const arr = catMap.get(row.auctionId) ?? []
    arr.push({ name: row.userName, count: row._count._all })
    catMap.set(row.auctionId, arr)
  }
  for (const [k, arr] of catMap) {
    catMap.set(k, arr.sort((a, b) => b.count - a.count).slice(0, 3))
  }

  const rows: SaleRow[] = auctions.map(a => {
    const val  = valueMap.get(a.id)
    const span = spanMap.get(a.id)
    const tim  = timingMap.get(a.id)
    return {
      id:          a.id,
      code:        a.code,
      name:        a.name,
      auctionDate: a.auctionDate ? new Date(a.auctionDate).toISOString() : null,
      auctionType: a.auctionType,
      hubLots:     a._count.lots,
      complete:    !!a.complete,
      addedToBC:   !!a.addedToBC,
      addedToBCLots: bcLotsMap.get(a.id) ?? 0,
      estLowSum:   val?._sum.estimateLow  ?? 0,
      estHighSum:  val?._sum.estimateHigh ?? 0,
      estLowAvg:   val?._avg.estimateLow  ?? null,
      estHighAvg:  val?._avg.estimateHigh ?? null,
      estCount:    val?._count.estimateLow ?? 0,
      firstLot:    span?._min.createdAt ? new Date(span._min.createdAt).toISOString() : null,
      lastLot:     span?._max.createdAt ? new Date(span._max.createdAt).toISOString() : null,
      lots7d:      r7Map.get(a.id) ?? 0,
      statusCounts: statusMap.get(a.id) ?? {},
      withPhotos:  photoMap.has(a.id) ? (photoMap.get(a.id) as number) : null,
      avgDurationMs: tim?._avg.durationMs ?? null,
      timedLots:   tim?._count._all ?? 0,
      topCataloguers: catMap.get(a.id) ?? [],
    }
  })

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Manager Portal</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
          Lots in every sale across both systems, cataloguing pace with projected milestone dates, and estimate value. Click a sale for the full breakdown.
        </p>
      </div>

      <ManagerPortalTable rows={rows} nowMs={Date.now()} />
    </div>
  )
}
