import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/warehouse/tote/report
// Category breakdown uses active totes only (WarehouseTote.catalogued = false,
// i.e. the ones synced from Receipt_Totes_Excel).
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const [toteStats, byLocation, recentTotes, totesPerCategory] = await Promise.all([
      prisma.warehouseTote.groupBy({
        by: ["catalogued"],
        _count: { _all: true },
      }),

      prisma.warehouseTote.groupBy({
        by: ["location"],
        where: { catalogued: false, location: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { location: "desc" } },
        take: 20,
      }),

      prisma.warehouseTote.findMany({
        where: { catalogued: false },
        select: {
          toteNo:     true,
          location:   true,
          receiptNo:  true,
          vendorName: true,
          status:     true,
          catalogued: true,
          syncedAt:   true,
        },
        orderBy: { toteNo: "asc" },
        take: 500,
      }),

      prisma.$queryRaw<{ category: string | null; toteCount: bigint; itemCount: bigint }[]>`
        SELECT
          wi.category,
          COUNT(DISTINCT wt."toteNo") AS "toteCount",
          COUNT(wi."uniqueId")        AS "itemCount"
        FROM "WarehouseTote" wt
        INNER JOIN "WarehouseItem" wi ON wi."toteNo" = wt."toteNo"
        WHERE wt.catalogued = false
        GROUP BY wi.category
        ORDER BY "toteCount" DESC
      `,
    ])

    const totalTotes   = toteStats.reduce((s, g) => s + g._count._all, 0)
    const activeTotes  = toteStats.find(g => g.catalogued === false)?._count._all ?? 0
    const doneTotes    = toteStats.find(g => g.catalogued === true)?._count._all  ?? 0
    const unknownTotes = toteStats.find(g => g.catalogued === null)?._count._all  ?? 0

    return NextResponse.json({
      stats: { total: totalTotes, active: activeTotes, catalogued: doneTotes, unknown: unknownTotes },
      byCategory: totesPerCategory.map(r => ({
        category:    r.category ?? "Unknown",
        itemCount:   Number(r.itemCount),
        activeTotes: Number(r.toteCount),
      })),
      byLocation: byLocation.map(g => ({ location: g.location, toteCount: g._count._all })),
      totes: recentTotes,
    })
  } catch (e: any) {
    console.error("tote report error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
