import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/marketing/insights?type=top_performers|estimate_vs_hammer|vendor_success|year_in_review
//   Common params:
//     category, year, month (YYYY-MM)
//   For vendor_success: vendorNo (required)

// Enrich WarehouseItem rows with CatalogueLot data (full description, key points, etc.)
async function enrichLots<T extends { uniqueId: string }>(rows: T[]) {
  const ids = rows.map(r => r.uniqueId).filter(Boolean)
  if (ids.length === 0) return rows
  const catLots = await prisma.catalogueLot.findMany({
    where: { receiptUniqueId: { in: ids } },
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
  const map = new Map(catLots.map(c => [c.receiptUniqueId, c]))
  return rows.map(r => {
    const c = map.get(r.uniqueId)
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
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { searchParams } = req.nextUrl
    const type     = searchParams.get("type") ?? "top_performers"
    const category = searchParams.get("category")?.trim() ?? ""
    const year     = searchParams.get("year")?.trim()     ?? ""
    const month    = searchParams.get("month")?.trim()    ?? ""
    const vendorNo = searchParams.get("vendorNo")?.trim() ?? ""

    const where: any = { hammerPrice: { gt: 0 } }
    if (category) where.category = { contains: category, mode: "insensitive" }
    if (year && month) where.auctionDate = { startsWith: `${year}-${month}` }
    else if (year)     where.auctionDate = { startsWith: year }
    else if (month)    where.auctionDate = { contains: `-${month}-` }

    if (type === "top_performers") {
      const lots = await prisma.warehouseItem.findMany({
        where,
        select: {
          uniqueId: true, lotNo: true, currentLotNo: true,
          description: true, category: true,
          hammerPrice: true, lowEstimate: true, highEstimate: true,
          auctionCode: true, auctionName: true, auctionDate: true,
        },
        orderBy: { hammerPrice: "desc" },
        take: 50,
      })
      return NextResponse.json({ type, lots: await enrichLots(lots) })
    }

    if (type === "estimate_vs_hammer") {
      const lots = await prisma.warehouseItem.findMany({
        where: {
          ...where,
          lowEstimate:  { gt: 0 },
          highEstimate: { gt: 0 },
        },
        select: {
          uniqueId: true, description: true, category: true,
          hammerPrice: true, lowEstimate: true, highEstimate: true,
          auctionCode: true, auctionName: true, auctionDate: true,
        },
      })

      // Group by category
      const byCat = new Map<string, { count: number; totalHammer: number; totalEstMid: number }>()
      for (const l of lots) {
        const cat = l.category ?? "Uncategorised"
        const mid = ((l.lowEstimate ?? 0) + (l.highEstimate ?? 0)) / 2
        const e = byCat.get(cat) ?? { count: 0, totalHammer: 0, totalEstMid: 0 }
        e.count++
        e.totalHammer += l.hammerPrice ?? 0
        e.totalEstMid += mid
        byCat.set(cat, e)
      }

      const categories = [...byCat.entries()]
        .map(([cat, v]) => ({
          category: cat,
          count: v.count,
          totalHammer: v.totalHammer,
          totalEstimateMid: v.totalEstMid,
          performancePct: v.totalEstMid > 0
            ? Math.round((v.totalHammer / v.totalEstMid) * 100)
            : 0,
        }))
        .filter(c => c.count >= 3)
        .sort((a, b) => b.performancePct - a.performancePct)

      const overall = lots.length > 0 ? {
        count:        lots.length,
        totalHammer:  lots.reduce((s, l) => s + (l.hammerPrice ?? 0), 0),
        totalEstMid:  lots.reduce((s, l) => s + (((l.lowEstimate ?? 0) + (l.highEstimate ?? 0)) / 2), 0),
      } : null

      return NextResponse.json({
        type,
        overall: overall ? {
          ...overall,
          performancePct: overall.totalEstMid > 0
            ? Math.round((overall.totalHammer / overall.totalEstMid) * 100)
            : 0,
        } : null,
        categories,
      })
    }

    if (type === "vendor_success") {
      if (!vendorNo) return NextResponse.json({ error: "vendorNo required" }, { status: 400 })
      const lots = await prisma.warehouseItem.findMany({
        where: { vendorNo, hammerPrice: { gt: 0 } },
        select: {
          uniqueId: true, lotNo: true, currentLotNo: true,
          description: true, category: true,
          hammerPrice: true, lowEstimate: true, highEstimate: true,
          auctionCode: true, auctionName: true, auctionDate: true,
          vendorNo: true, vendorName: true,
        },
        orderBy: { hammerPrice: "desc" },
      })

      const totalHammer = lots.reduce((s, l) => s + (l.hammerPrice ?? 0), 0)
      const withEst = lots.filter(l => l.lowEstimate && l.highEstimate)
      const totalEstMid = withEst.reduce((s, l) => s + (((l.lowEstimate ?? 0) + (l.highEstimate ?? 0)) / 2), 0)
      const overTotal   = withEst.reduce((s, l) => s + (l.hammerPrice ?? 0), 0)

      const enrichedTop = await enrichLots(lots.slice(0, 20))
      return NextResponse.json({
        type,
        vendorNo,
        vendorName:  lots[0]?.vendorName ?? null,
        count:       lots.length,
        totalHammer,
        performancePct: totalEstMid > 0 ? Math.round((overTotal / totalEstMid) * 100) : 0,
        topLots:     enrichedTop,
        allLots:     lots,
      })
    }

    if (type === "year_in_review") {
      if (!year) return NextResponse.json({ error: "year required" }, { status: 400 })

      const lots = await prisma.warehouseItem.findMany({
        where: {
          hammerPrice: { gt: 0 },
          auctionDate: { startsWith: year },
        },
        select: {
          uniqueId: true, description: true, category: true,
          hammerPrice: true, lowEstimate: true, highEstimate: true,
          auctionCode: true, auctionName: true, auctionDate: true,
          lotNo: true, currentLotNo: true,
        },
        orderBy: { hammerPrice: "desc" },
      })

      const totalHammer = lots.reduce((s, l) => s + (l.hammerPrice ?? 0), 0)
      const byCat = new Map<string, { count: number; totalHammer: number }>()
      for (const l of lots) {
        const cat = l.category ?? "Uncategorised"
        const e = byCat.get(cat) ?? { count: 0, totalHammer: 0 }
        e.count++
        e.totalHammer += l.hammerPrice ?? 0
        byCat.set(cat, e)
      }
      const categoryStats = [...byCat.entries()]
        .map(([cat, v]) => ({ category: cat, ...v }))
        .sort((a, b) => b.totalHammer - a.totalHammer)

      return NextResponse.json({
        type,
        year,
        totalLots: lots.length,
        totalHammer,
        topLots:   await enrichLots(lots.slice(0, 20)),
        categoryStats,
      })
    }

    return NextResponse.json({ error: "Unknown insight type" }, { status: 400 })
  } catch (e: any) {
    console.error("marketing/insights error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
