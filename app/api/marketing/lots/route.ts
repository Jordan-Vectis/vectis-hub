import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/marketing/lots
// Query params:
//   keyword  — text search on description (case-insensitive contains)
//   category — partial match on EVA_ArticleCategoryCode
//   month    — "YYYY-MM" to filter by auctionDate prefix
//   topN     — max results, sorted by hammerPrice DESC (default 10)

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { searchParams } = req.nextUrl
    const keyword  = searchParams.get("keyword")?.trim()  ?? ""
    const category = searchParams.get("category")?.trim() ?? ""
    const month    = searchParams.get("month")?.trim()    ?? "" // "YYYY-MM" or just "YYYY"
    const year     = searchParams.get("year")?.trim()     ?? ""  // "YYYY" — used when no month picked
    const mode     = searchParams.get("mode")?.trim()     ?? "sold"  // "sold" | "upcoming" | "all"
    const vendorNo = searchParams.get("vendorNo")?.trim() ?? ""
    // Comma-separated list of auctionCodes to limit results to specific sales
    const auctionCodesRaw = searchParams.get("auctionCodes")?.trim() ?? ""
    const auctionCodes    = auctionCodesRaw ? auctionCodesRaw.split(",").map(s => s.trim()).filter(Boolean) : []
    // topN: positive number = take N; "all" or 0/negative = no limit (cap at 1000)
    const topNRaw  = searchParams.get("topN")?.trim() ?? "10"
    const topN     = topNRaw === "all"
      ? 1000
      : Math.min(Math.max(parseInt(topNRaw, 10) || 10, 1), 1000)

    // Build where clause
    const where: any = {}
    if (mode === "sold") {
      // Sold = a hammer price is on record
      where.hammerPrice = { gt: 0 }
    } else if (mode === "upcoming") {
      // Upcoming = the auction hasn't happened yet (date today or later).
      // We don't filter on hammerPrice — BC may store 0, NULL, or even a
      // placeholder. The auction date is the canonical signal. If the user
      // has already narrowed to specific sales via auctionCodes, we trust
      // that and skip the date filter entirely (let them preview anything).
      const today = new Date().toISOString().slice(0, 10) // "YYYY-MM-DD"
      if (auctionCodes.length === 0) {
        where.auctionDate = { gte: today }
      }
    }

    if (vendorNo) {
      where.vendorNo = vendorNo
    }

    if (auctionCodes.length > 0) {
      where.auctionCode = { in: auctionCodes }
    }

    if (keyword) {
      where.description = { contains: keyword, mode: "insensitive" }
    }

    if (category) {
      where.category = { contains: category, mode: "insensitive" }
    }

    if (month) {
      // "YYYY-MM" prefix — most specific
      where.auctionDate = { startsWith: month }
    } else if (year) {
      // Year alone — match any month within that year
      where.auctionDate = { startsWith: year }
    }

    const rows = await prisma.warehouseItem.findMany({
      where,
      select: {
        uniqueId:     true,
        lotNo:        true,
        currentLotNo: true,
        description:  true,
        category:     true,
        hammerPrice:  true,
        lowEstimate:  true,
        highEstimate: true,
        auctionCode:  true,
        auctionName:  true,
        auctionDate:  true,
        vendorNo:     true,
        vendorName:   true,
      },
      orderBy: mode === "upcoming"
        ? [{ highEstimate: "desc" }, { lowEstimate: "desc" }]
        : { hammerPrice: "desc" },
      take: topN,
    })

    // Enrich with CatalogueLot data where available — gives us the cataloguer's
    // full description, key points, condition, manufacturer/brand, etc.
    const uniqueIds = rows.map(r => r.uniqueId).filter(Boolean)
    const catLots = uniqueIds.length === 0 ? [] : await prisma.catalogueLot.findMany({
      where: { receiptUniqueId: { in: uniqueIds } },
      select: {
        receiptUniqueId: true,
        title:           true,
        description:     true,
        keyPoints:       true,
        condition:       true,
        subCategory:     true,
        brand:           true,
        extraDetails:    true,
      },
    })
    const catMap = new Map(catLots.map(c => [c.receiptUniqueId, c]))

    const enriched = rows.map(r => {
      const c = catMap.get(r.uniqueId)
      return {
        ...r,
        catTitle:        c?.title        ?? null,
        catDescription:  c?.description  ?? null,
        catKeyPoints:    c?.keyPoints    ?? null,
        catCondition:    c?.condition    ?? null,
        catSubCategory:  c?.subCategory  ?? null,
        catBrand:        c?.brand        ?? null,
        catExtraDetails: c?.extraDetails ?? null,
      }
    })

    return NextResponse.json({ lots: enriched })
  } catch (e: any) {
    console.error("marketing/lots error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
