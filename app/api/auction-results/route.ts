import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

// GET /api/auction-results
// Returns list of finished auctions (no ?auctionId)
// GET /api/auction-results?auctionId=xxx
// Returns all lots with statuses/hammer prices for that auction

// ⚠ Signed-in only (security review, 2026-10-22): it hands out hammer prices, which stay behind the
// login by decision. Its only caller is the Auction Controller's results page.
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
  const auctionId = req.nextUrl.searchParams.get("auctionId")

  if (!auctionId) {
    // Return list of auctions that have completed lots or are finished
    const auctions = await prisma.catalogueAuction.findMany({
      where: {
        published: true,
        OR: [
          { finished: true },
          { complete: true },
          { lots: { some: { hammerPrice: { not: null } } } },
        ],
      },
      orderBy: { auctionDate: "desc" },
      select: {
        id: true,
        name: true,
        code: true,
        auctionDate: true,
        finished: true,
        complete: true,
        _count: { select: { lots: true } },
      },
    })
    return NextResponse.json(auctions)
  }

  // Return lot-level results for a specific auction
  const lots = await prisma.catalogueLot.findMany({
    where: { auctionId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      barcode: true,
      receiptUniqueId: true,
      title: true,
      status: true,
      hammerPrice: true,
      currentBid: true,
      estimateLow: true,
      estimateHigh: true,
    },
  })

  const auction = await prisma.catalogueAuction.findUnique({
    where: { id: auctionId },
    select: { id: true, name: true, code: true, auctionDate: true },
  })

  return NextResponse.json({ auction, lots })
}
