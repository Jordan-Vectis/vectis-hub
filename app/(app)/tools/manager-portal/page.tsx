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

  const [auctions, spanAgg, timingAgg, catAgg] = await Promise.all([
    prisma.catalogueAuction.findMany({
      orderBy: { auctionDate: "desc" },
      include: { _count: { select: { lots: true } } },
    }),
    // First + last lot ever for the sale — pace = lots ÷ that active span
    prisma.catalogueLot.groupBy({
      by: ["auctionId"],
      _min: { createdAt: true },
      _max: { createdAt: true },
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

  const spanMap   = new Map(spanAgg.map(v => [v.auctionId, v]))
  const timingMap = new Map(timingAgg.map(v => [v.auctionId, v]))

  const catMap = new Map<string, { name: string; count: number }[]>()
  for (const row of catAgg) {
    const arr = catMap.get(row.auctionId) ?? []
    arr.push({ name: row.userName, count: row._count._all })
    catMap.set(row.auctionId, arr)
  }
  for (const [k, arr] of catMap) catMap.set(k, arr.sort((a, b) => b.count - a.count).slice(0, 3))

  const rows: SaleRow[] = auctions.map(a => {
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
      firstLot:    span?._min.createdAt ? new Date(span._min.createdAt).toISOString() : null,
      lastLot:     span?._max.createdAt ? new Date(span._max.createdAt).toISOString() : null,
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
          Lots in every sale across both systems, cataloguing pace and projected milestone dates. Click a sale for more.
        </p>
      </div>

      <ManagerPortalTable rows={rows} nowMs={Date.now()} />
    </div>
  )
}
