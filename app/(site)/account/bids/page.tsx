import { getCustomerSession } from "@/lib/customer-auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import BidsClient from "./bids-client"

export const dynamic = "force-dynamic"
// The site layout's title template adds " | Vectis Auctions" itself.
export const metadata = { title: "My bids" }

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

  // Check for active live auction — the banner is a nicety, so a table that isn't there yet
  // must not take the bids with it.
  const liveAuction = await prisma.liveAuction.findFirst({
    where: { status: { in: ["ACTIVE", "PAUSED"] } },
    include: { auction: true },
  }).catch(() => null)

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
      <h1 className="vs-h2 vs-rule mb-3">My bids</h1>
      <p className="text-[var(--vs-muted)] mb-8">Your commission bids and results, sale by sale.</p>

      {/* A sale running right now — the way into the live room. */}
      {liveAuction && (
        <div className="vs-card-flat !border-[var(--vs-red)] p-5 sm:p-6 mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="vs-kicker mb-1">Live now</p>
            <p className="vs-h4">{liveAuction.auction.name}</p>
            <p className="text-sm text-[var(--vs-muted)] mt-1">Join the live room to bid in real time.</p>
          </div>
          <Link href={`/auctions/${liveAuction.auction.code}/live`} className="vs-btn vs-btn-red self-start sm:self-auto">Bid live</Link>
        </div>
      )}

      {/* Collapsible bid groups */}
      <BidsClient groups={groups} />

      {/* How bidding works */}
      <section className="vs-band p-5 sm:p-8 mt-8" aria-labelledby="bids-how">
        <h2 id="bids-how" className="vs-h4 mb-3">How commission bids work</h2>
        <div className="vs-prose">
          <p>
            Your maximum bid is kept confidential. During the sale, bids are placed on your behalf up to your
            maximum, only as far as needed to beat the other bidders. A buyer&apos;s premium of <strong>22% + VAT</strong>{" "}
            applies to every winning bid. To change or cancel a bid before the sale, please{" "}
            <Link href="/contact">contact us</Link>.
          </p>
        </div>
      </section>
    </div>
  )
}
