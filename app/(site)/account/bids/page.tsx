import { getCustomerSession } from "@/lib/customer-auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import BidsClient from "./bids-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "My Bids — Vectis" }

export default async function MyBidsPage() {
  const session = await getCustomerSession()
  if (!session) redirect("/portal/login")

  // Fetch all commission bids for this customer, grouped by auction
  const bids = await prisma.commissionBid.findMany({
    where: { customerAccountId: session.id },
    orderBy: { placedAt: "desc" },
    include: {
      lot: {
        select: {
          id: true,
          barcode: true,
          receiptUniqueId: true,
          title: true,
          estimateLow: true,
          estimateHigh: true,
          currentBid: true,
          hammerPrice: true,
          imageUrls: true,
          status: true,
          auction: {
            select: {
              id: true,
              code: true,
              name: true,
              auctionDate: true,
              finished: true,
              complete: true,
            },
          },
        },
      },
    },
  })

  // Fetch highest commission bid per lot (from any bidder) to show as current bid pre-auction
  const lotIds = bids.map(b => b.lotId)
  const topBids = await prisma.commissionBid.groupBy({
    by: ["lotId"],
    _max: { maxBid: true },
    where: { lotId: { in: lotIds } },
  })
  const topBidMap = Object.fromEntries(topBids.map(t => [t.lotId, t._max.maxBid]))

  // Check for active live auction
  const liveAuction = await prisma.liveAuction.findFirst({
    where: { status: { in: ["ACTIVE", "PAUSED"] } },
    include: { auction: true },
  })

  // Group bids by auction (preserve most-recent-auction-first order)
  const auctionMap = new Map<string, {
    auctionId: string
    auctionCode: string
    auctionName: string
    auctionDate: string | null
    isFinished: boolean
    bids: typeof bids
  }>()

  for (const bid of bids) {
    const a = bid.lot.auction
    if (!auctionMap.has(a.id)) {
      auctionMap.set(a.id, {
        auctionId: a.id,
        auctionCode: a.code,
        auctionName: a.name,
        auctionDate: a.auctionDate?.toISOString() ?? null,
        isFinished: a.finished || a.complete,
        bids: [],
      })
    }
    auctionMap.get(a.id)!.bids.push(bid)
  }

  const groups = Array.from(auctionMap.values()).map(g => ({
    ...g,
    bids: g.bids.map(b => ({
      bidId: b.id,
      lotId: b.lot.id,
      lotBarcode: b.lot.barcode ?? b.lot.receiptUniqueId ?? null,
      lotTitle: b.lot.title,
      imageUrl: b.lot.imageUrls[0] ?? null,
      lotStatus: b.lot.status,
      currentBid: b.lot.currentBid ?? topBidMap[b.lot.id] ?? null,
      hammerPrice: b.lot.hammerPrice,
      estimateLow: b.lot.estimateLow,
      estimateHigh: b.lot.estimateHigh,
      maxBid: b.maxBid,
      placedAt: b.placedAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    })),
  }))

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">My Bids</h1>
      <p className="text-sm text-gray-500 mb-6">
        Your commission bids and bidding history — grouped by sale.
      </p>

      {/* Live auction alert */}
      {liveAuction && (
        <div className="mb-6 bg-red-50 border border-red-300 p-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse shrink-0" />
            <div>
              <p className="font-bold text-red-800 text-sm">Auction Live Now: {liveAuction.auction.name}</p>
              <p className="text-red-600 text-xs mt-0.5">Join the live bidding room to bid in real time</p>
            </div>
          </div>
          <Link
            href={`/auctions/${liveAuction.auction.code}/live`}
            className="shrink-0 bg-red-600 hover:bg-red-500 text-white text-xs font-black uppercase tracking-widest px-5 py-2.5 transition-colors"
          >
            BID LIVE →
          </Link>
        </div>
      )}

      {/* Collapsible bid groups */}
      <BidsClient groups={groups} />

      {/* How bidding works */}
      <div className="bg-gray-50 border border-gray-200 p-5 text-sm text-gray-600">
        <p className="font-bold text-gray-800 mb-2">How commission bids work</p>
        <p className="text-xs leading-relaxed text-gray-500">
          Your maximum bid is kept confidential. During the live auction, bids are placed on your behalf up to your
          maximum. A buyer&apos;s premium of <strong>22% + VAT</strong> applies to all winning bids. To update or
          cancel a bid before the sale date, please{" "}
          <Link href="/auctions" className="text-[#32348A] underline">contact us</Link>.
        </p>
      </div>
    </div>
  )
}
