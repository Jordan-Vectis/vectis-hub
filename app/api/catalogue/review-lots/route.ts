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

    const lots = await prisma.catalogueLot.findMany({
      where: { auctionId },
      select: {
        id: true, barcode: true, receiptUniqueId: true, title: true,
        keyPoints: true, description: true,
        estimateLow: true, estimateHigh: true, aiEstimateLow: true, aiEstimateHigh: true,
        condition: true, category: true, subCategory: true, brand: true,
        status: true, imageUrls: true, createdByName: true,
        reviewFlag: true, reviewFlaggedBy: true, reviewFlaggedAt: true,
        aiFlagNote: true,
      },
      orderBy: { createdAt: "asc" },
    })

    return NextResponse.json({ lots })
  } catch (e: any) {
    console.error("catalogue/review-lots GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
