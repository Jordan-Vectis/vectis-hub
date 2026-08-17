import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/catalogue/review-lots?auctionId=xxx
// Full lot data for the Review tab — key points, description, estimates,
// condition/category details, photos and review flags.
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const auctionId = req.nextUrl.searchParams.get("auctionId")?.trim()
    if (!auctionId) return NextResponse.json({ error: "Missing auctionId" }, { status: 400 })

    const BASE = {
      id: true, barcode: true, receiptUniqueId: true, title: true,
      keyPoints: true, description: true,
      estimateLow: true, estimateHigh: true, aiEstimateLow: true, aiEstimateHigh: true,
      condition: true, category: true, subCategory: true, brand: true,
      status: true, imageUrls: true, createdByName: true,
      reviewFlag: true, reviewFlaggedBy: true, reviewFlaggedAt: true,
      aiFlagNote: true,
    } as const

    // ⚠ Code deploys to Railway before Run Migrations is clicked, so the kpFix* columns
    // may not exist yet. Selecting a missing column errors the whole route and empties the
    // Review tab — fall back to the columns that have always been there.
    let lots
    try {
      lots = await prisma.catalogueLot.findMany({
        where: { auctionId },
        select: { ...BASE, kpFixNote: true, kpFixedBy: true, kpFixedAt: true },
        orderBy: { createdAt: "asc" },
      })
    } catch {
      lots = await prisma.catalogueLot.findMany({
        where: { auctionId },
        select: BASE,
        orderBy: { createdAt: "asc" },
      })
    }

    return NextResponse.json({ lots })
  } catch (e: any) {
    console.error("catalogue/review-lots GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
