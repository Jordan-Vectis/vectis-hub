import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/warehouse/search?q=A2A1&mode=exact
// GET /api/warehouse/search?q=T001234&mode=exact   → finds tote by tote number
// GET /api/warehouse/search?q=F066001&mode=exact   → finds item by barcode
// GET /api/warehouse/search?q=A2&mode=aisle        → all shelves in aisle A2
//
// Specific mode searches: location (exact), barcode (exact), toteNo (exact).
// Aisle mode: location startsWith, then JS-filtered so A2 ≠ A20/A22.

const ITEM_SELECT = {
  uniqueId:          true,
  location:          true,
  binCode:           true,
  toteNo:            true,
  barcode:           true,
  description:       true,
  artist:            true,
  category:          true,
  catalogued:        true,
  auctionCode:       true,
  lotNo:             true,
  currentLotNo:      true,
  locationScannedAt: true,
} as const

const TOTE_SELECT = {
  toteNo:     true,
  location:   true,
  receiptNo:  true,
  vendorNo:   true,
  vendorName: true,
  status:     true,
  catalogued: true,
  syncedAt:   true,
} as const

function isExactAisle(location: string | null, aisle: string): boolean {
  if (!location) return false
  const loc  = location.toUpperCase()
  const q    = aisle.toUpperCase()
  if (!loc.startsWith(q)) return false
  const next = loc[q.length]
  return next !== undefined && /[A-Z]/.test(next)
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const raw  = (req.nextUrl.searchParams.get("q") ?? req.nextUrl.searchParams.get("location") ?? "").trim()
    const mode = req.nextUrl.searchParams.get("mode") ?? "exact"
    if (!raw) return NextResponse.json({ items: [], totes: [], total: 0 })

    const q = raw.toUpperCase()

    // ── Aisle mode ───────────────────────────────────────────────────────────────
    if (mode === "aisle") {
      const locationWhere = { startsWith: q, mode: "insensitive" as const }
      const [rawItems, rawTotes] = await Promise.all([
        prisma.warehouseItem.findMany({
          where: { location: locationWhere },
          select: ITEM_SELECT,
          orderBy: { location: "asc" },
          take: 5000,
        }),
        prisma.warehouseTote.findMany({
          where: { location: locationWhere },
          select: TOTE_SELECT,
          orderBy: { toteNo: "asc" },
          take: 5000,
        }),
      ])
      const items = rawItems.filter(i => isExactAisle(i.location, q)).slice(0, 500)
      const totes = rawTotes.filter(t => isExactAisle(t.location, q)).slice(0, 500)
      return NextResponse.json({ items, totes, total: items.length + totes.length })
    }

    // ── Specific mode ────────────────────────────────────────────────────────────
    const [rawItems, rawTotes] = await Promise.all([
      prisma.warehouseItem.findMany({
        where: {
          OR: [
            { location: { equals: q, mode: "insensitive" } },
            { barcode:  { equals: q, mode: "insensitive" } },
          ],
        },
        select: ITEM_SELECT,
        orderBy: { location: "asc" },
        take: 500,
      }),
      prisma.warehouseTote.findMany({
        where: {
          OR: [
            { location: { equals: q, mode: "insensitive" } },
            { toteNo:   { equals: q, mode: "insensitive" } },
          ],
        },
        select: TOTE_SELECT,
        orderBy: { toteNo: "asc" },
        take: 500,
      }),
    ])

    return NextResponse.json({ items: rawItems, totes: rawTotes, total: rawItems.length + rawTotes.length })
  } catch (e: any) {
    console.error("warehouse search error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
