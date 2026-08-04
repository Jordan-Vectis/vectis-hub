import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/warehouse/tote/report
//
// Active totes only (WarehouseTote.catalogued = false, synced from
// Receipt_Totes_Excel), further restricted to totes sitting on a real WAREHOUSE
// SHELF location. Totes on a cataloguing bench (BENCH*), in QUERY / ARCHIVE, or
// on any other non-shelf status (RETURNED, MISSING, SHIPPED, DISPOSAL, an office,
// no location at all, …) are excluded — the report is "what's actually shelved".
//
// "Shelf" = the aisle/bay/shelf code grammar, e.g. 60A5, 29A2B, 40B5A, A10A1.
// Non-shelf locations are word-labels (BENCH46, QUERY, ARCHIVE, …) which never
// match this pattern. The regex is kept identical between JS (list/stats) and
// SQL (category breakdown) so every view of the report stays consistent.
const SHELF_RE = /^[A-Za-z]?\d+[A-Za-z]+\d+[A-Za-z]?$/
const isShelf = (loc: string | null) => !!loc && SHELF_RE.test(loc.trim())
// Postgres POSIX regex equivalent of SHELF_RE, applied case-insensitively (~*).
const SHELF_SQL = "^[A-Za-z]?[0-9]+[A-Za-z]+[0-9]+[A-Za-z]?$"

export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const [activeTotes, totesPerCategory] = await Promise.all([
      prisma.warehouseTote.findMany({
        where: { catalogued: false },
        select: {
          toteNo:     true,
          location:   true,
          receiptNo:  true,
          vendorNo:   true,
          vendorName: true,
          status:     true,
          catalogued: true,
          syncedAt:   true,
        },
        orderBy: { toteNo: "asc" },
      }),

      // Category breakdown joins active totes to their items by RECEIPT number,
      // NOT by tote number: BC's Receipt/Auction line feeds don't populate the
      // item-level tote field (EVA_ArticleToteNo is empty on ~all 202k items), so a
      // tote-number join returns nothing. receiptNo is populated on every active tote
      // and on its items, so this gives a real breakdown. Caveat: a receipt can span
      // several totes/categories, so a tote can count toward more than one category
      // (the per-category tote counts are an approximation, not a partition).
      // Only totes on a real shelf location are counted (see SHELF_SQL).
      prisma.$queryRaw<{ category: string | null; toteCount: bigint; itemCount: bigint }[]>`
        SELECT
          wi.category,
          COUNT(DISTINCT wt."toteNo")   AS "toteCount",
          COUNT(DISTINCT wi."uniqueId") AS "itemCount"
        FROM "WarehouseTote" wt
        INNER JOIN "WarehouseItem" wi ON wi."receiptNo" = wt."receiptNo"
        WHERE wt.catalogued = false
          AND wt."receiptNo" IS NOT NULL AND btrim(wt."receiptNo") <> ''
          AND btrim(wt."location") ~* ${SHELF_SQL}
        GROUP BY wi.category
        ORDER BY "toteCount" DESC
      `,
    ])

    // Keep only totes physically on a shelf; everything else (bench, query,
    // archive, no location, …) is counted as "off-shelf" and hidden from the data.
    const onShelf  = activeTotes.filter(t => isShelf(t.location))
    const offShelf = activeTotes.length - onShelf.length

    // By location (shelf only), busiest first, top 20.
    const locCounts = new Map<string, number>()
    for (const t of onShelf) {
      const loc = t.location!.trim()
      locCounts.set(loc, (locCounts.get(loc) ?? 0) + 1)
    }
    const byLocation = [...locCounts.entries()]
      .map(([location, toteCount]) => ({ location, toteCount }))
      .sort((a, b) => b.toteCount - a.toteCount)
      .slice(0, 20)

    return NextResponse.json({
      stats: { onShelf: onShelf.length, offShelf },
      byCategory: totesPerCategory.map(r => ({
        category:    r.category ?? "Unknown",
        itemCount:   Number(r.itemCount),
        activeTotes: Number(r.toteCount),
      })),
      byLocation,
      totes: onShelf,
    })
  } catch (e: any) {
    console.error("tote report error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
