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
      addedToBC:   !!a.addedToBC,
      daily:       dailyMap.get(a.id) ?? [],
      avgDurationMs: tim?.avgMs ?? null,
      timedLots:   tim?.count ?? 0,
      topCataloguers: catMap.get(a.id) ?? [],
    }
  })

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Manager Portal</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
          Lots in every sale across both systems, cataloguing pace and projected milestone dates. Click a sale for the full breakdown.
        </p>
      </div>

      <ManagerPortalTable rows={rows} nowMs={Date.now()} />
    </div>
  )
}
