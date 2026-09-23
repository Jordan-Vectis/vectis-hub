import Link from "next/link"
import Image from "next/image"
import { prisma } from "@/lib/prisma"
import { format } from "date-fns"
import LiveAuctionBanner from "./live-auction-banner"
import AuctionCalendarSidebar from "./auction-calendar-sidebar"
import { lotPhotoUrl } from "@/lib/photo-url"
import { getCustomerSession } from "@/lib/customer-auth"
import RegisterToBidButton from "./register-to-bid-button"

export const metadata = {
  title: "Auction Calendar",
  description:
    "Browse Vectis upcoming and past specialist auctions. Diecast, Matchbox, Corgi, Trains, Vinyl, Comics and more. Bid live or online.",
  openGraph: {
    title: "Auction Calendar — Vectis Auctions",
    description: "Browse upcoming and past specialist auctions. Bid live or online.",
  },
}
export const dynamic = "force-dynamic"

const TYPE_LABELS: Record<string, string> = {
  GENERAL: "General Auction", DIECAST: "Diecast", TRAINS: "Trains",
  VINYL: "Vinyl & Music", TV_FILM: "TV & Film", MATCHBOX: "Matchbox",
  COMICS: "Comics & Books", BEARS: "Teddy Bears", DOLLS: "Dolls & Toys",
}

// An auction moves to "past" 24 hours after its scheduled date
function isPast(auctionDate: Date | null, finished: boolean, complete: boolean): boolean {
  if (finished || complete) return true
  if (!auctionDate) return false
  const cutoff = new Date(auctionDate.getTime() + 24 * 60 * 60 * 1000)
  return cutoff < new Date()
}

export default async function AuctionsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; tab?: string; type?: string }>
}) {
  const { search, tab, type } = await searchParams
  const showPast = tab === "past"

  // Customer session + existing registrations
  const customerSession = await getCustomerSession()
  const isLoggedIn = !!customerSession
  const registeredAuctionIds: Set<string> = new Set()
  if (customerSession) {
    const regs = await prisma.bidderRegistration.findMany({
      where: { customerAccountId: customerSession.id },
      select: { auctionId: true },
    })
    regs.forEach(r => registeredAuctionIds.add(r.auctionId))
  }

  // Check for active live auction
  const liveAuction = await prisma.liveAuction.findFirst({
    where: { status: { in: ["ACTIVE", "PAUSED"] } },
    include: { auction: { include: { lots: { orderBy: { createdAt: "asc" } } } } },
  })

  const allPublished = await prisma.catalogueAuction.findMany({
    where: { published: true },
    orderBy: { auctionDate: showPast ? "desc" : "asc" },
    include: {
      _count: { select: { lots: true } },
      liveAuction: true,
      lots: { take: 1, where: { imageUrls: { isEmpty: false } }, select: { imageUrls: true } },
    },
  })

  // Split into upcoming / past based on 24h rule
  const upcoming = allPublished.filter(a => !isPast(a.auctionDate, a.finished, a.complete))
  const past      = allPublished.filter(a =>  isPast(a.auctionDate, a.finished, a.complete))

  let displayed = showPast ? past : upcoming

  // Type filter
  if (type) displayed = displayed.filter(a => (TYPE_LABELS[a.auctionType] ?? a.auctionType) === type)

  // Search
  if (search) {
    const q = search.toLowerCase()
    displayed = displayed.filter(a =>
      a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q)
    )
  }

  // Calendar sidebar data
  const auctionEntries = allPublished
    .filter(a => a.auctionDate)
    .map(a => ({ date: a.auctionDate!.toISOString(), code: a.code }))

  const auctionTypes = [...new Set(
    allPublished.map(a => TYPE_LABELS[a.auctionType] ?? a.auctionType)
  )]

  return (
    <div>
      {/* ── Live auction takeover ── */}
      {liveAuction && (
        <LiveAuctionBanner
          auctionId={liveAuction.auction.id}
          auctionName={liveAuction.auction.name}
          auctionCode={liveAuction.auction.code}
          auctionDate={liveAuction.auction.auctionDate}
          currentLotIndex={liveAuction.currentLotIndex}
          status={liveAuction.status}
          lots={liveAuction.auction.lots.map(l => ({
            id: l.id,
            barcode: l.barcode ?? "",
            title: l.title,
            imageUrls: l.imageUrls,
            estimateLow: l.estimateLow,
            estimateHigh: l.estimateHigh,
          }))}
        />
      )}

      {/* ── Page header ── */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
          <h1 className="text-3xl font-black text-[#32348A] uppercase tracking-tight mb-6">
            Auction Calendar
          </h1>

          {/* Tabs + search row */}
          <div className="flex items-center gap-4 flex-wrap">
            {/* Tabs */}
            <div className="flex border-b border-transparent gap-1">
              <Link
                href="/auctions"
                className={`px-5 py-2 text-sm font-bold uppercase tracking-wider border-b-2 transition-colors ${
                  !showPast
                    ? "border-[#32348A] text-[#32348A]"
                    : "border-transparent text-gray-400 hover:text-[#32348A]"
                }`}
              >
                Upcoming
              </Link>
              <Link
                href="/auctions?tab=past"
                className={`px-5 py-2 text-sm font-bold uppercase tracking-wider border-b-2 transition-colors ${
                  showPast
                    ? "border-[#32348A] text-[#32348A]"
                    : "border-transparent text-gray-400 hover:text-[#32348A]"
                }`}
              >
                View Results
              </Link>
            </div>

            {/* Search bar */}
            <form method="GET" action="/auctions" className="flex items-center ml-auto gap-2">
              {tab && <input type="hidden" name="tab" value={tab} />}
              {type && <input type="hidden" name="type" value={type} />}
              <div className="flex items-center border border-gray-300 bg-white overflow-hidden">
                <span className="px-3 text-gray-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                  </svg>
                </span>
                <input
                  name="search"
                  defaultValue={search ?? ""}
                  placeholder="Search auctions…"
                  className="py-2 pr-3 text-sm focus:outline-none w-56"
                />
              </div>
              <button
                type="submit"
                className="bg-[#32348A] text-white text-xs font-bold uppercase tracking-widest px-5 py-2.5 hover:bg-[#28296e] transition-colors"
              >
                GO
              </button>
              {(search || type) && (
                <Link
                  href={tab ? `/auctions?tab=${tab}` : "/auctions"}
                  className="text-xs text-gray-400 hover:text-[#32348A] underline"
                >
                  Clear
                </Link>
              )}
            </form>
          </div>
        </div>
      </div>

      {/* ── Main layout ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 flex gap-6 items-start">

        {/* Sidebar */}
        <AuctionCalendarSidebar
          auctionEntries={auctionEntries}
          auctionTypes={auctionTypes}
          selectedType={type ?? ""}
        />

        {/* Auction list */}
        <div className="flex-1 min-w-0">
          {displayed.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-gray-400 text-lg">
                {showPast ? "No past auctions found." : "No upcoming auctions at the moment."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-0 border border-gray-200">
              {displayed.map((auction, idx) => {
                const img = lotPhotoUrl(auction.lots[0]?.imageUrls[0], true)
                const label = TYPE_LABELS[auction.auctionType] ?? auction.auctionType
                const isLive = !!auction.liveAuction && ["ACTIVE","PAUSED"].includes(auction.liveAuction.status)
                const aDate = auction.auctionDate ? new Date(auction.auctionDate) : null

                return (
                  <div
                    key={auction.id}
                    className={`flex border-b border-gray-200 bg-white hover:bg-gray-50 transition-colors ${idx === 0 ? "" : ""}`}
                  >
                    {/* Image */}
                    <Link
                      href={`/auctions/${auction.code}`}
                      className="relative shrink-0 bg-gray-100 overflow-hidden"
                      style={{ width: "240px", minHeight: "160px" }}
                    >
                      {img ? (
                        <Image
                          src={img}
                          alt={auction.name}
                          fill
                          className="object-cover hover:scale-105 transition-transform duration-300"
                          sizes="240px"
                         
                        />
                      ) : (
                        <div className="absolute inset-0 bg-[#32348A]/5 flex items-center justify-center">
                          <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                      )}
                    </Link>

                    {/* Info */}
                    <div className="flex-1 px-6 py-5 flex flex-col justify-between min-w-0">
                      {/* Badge */}
                      <div className="mb-2">
                        {isLive ? (
                          <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-red-600 border border-red-400 px-2 py-0.5 rounded">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                            LIVE NOW
                          </span>
                        ) : (
                          <span className="text-[10px] font-black uppercase tracking-widest text-[#2AB4A6]">
                            {showPast ? "CATALOGUE AVAILABLE" : "CATALOGUE NOW LIVE"}
                          </span>
                        )}
                      </div>

                      {/* Title + meta */}
                      <div className="mb-3">
                        <Link href={`/auctions/${auction.code}`}>
                          <h2 className="text-[#32348A] font-black text-xl leading-tight hover:underline mb-1">
                            {auction.name}
                          </h2>
                        </Link>
                        {aDate && (
                          <p className="text-gray-500 text-sm uppercase font-medium tracking-wide">
                            {format(aDate, "EEEE d MMMM yyyy").toUpperCase()}
                            {" "}
                            {format(aDate, "HH:mm")}
                          </p>
                        )}
                        <p className="text-gray-400 text-xs mt-1">
                          {auction._count.lots} lots · {label}
                        </p>
                      </div>

                      {/* Buttons */}
                      <div className="flex flex-wrap gap-2">
                        {isLive && (
                          <Link
                            href={`/auctions/${auction.code}/live`}
                            className="border-2 border-[#32348A] text-[#32348A] hover:bg-[#32348A] hover:text-white text-xs font-black uppercase tracking-widest px-4 py-2 transition-colors"
                          >
                            APPROVED TO BID LIVE
                          </Link>
                        )}
                        <Link
                          href={`/auctions/${auction.code}`}
                          className="bg-[#32348A] hover:bg-[#28296e] text-white text-xs font-black uppercase tracking-widest px-4 py-2 transition-colors"
                        >
                          {showPast ? "VIEW RESULTS" : "VIEW CATALOGUE & BID"}
                        </Link>
                        {!showPast && !isLive && (
                          <RegisterToBidButton
                            auctionId={auction.id}
                            auctionName={auction.name}
                            isLoggedIn={isLoggedIn}
                            alreadyRegistered={registeredAuctionIds.has(auction.id)}
                          />
                        )}
                      </div>
                    </div>

                    {/* Right date block */}
                    {aDate && (
                      <div className="shrink-0 w-28 border-l border-gray-200 flex flex-col items-center justify-center py-5 px-2 bg-gray-50">
                        <span className="text-[#32348A] font-black text-5xl leading-none">
                          {format(aDate, "d")}
                        </span>
                        <span className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-1">
                          {format(aDate, "EEEE")}
                        </span>
                        <span className="text-gray-400 text-[10px] uppercase tracking-wider mt-0.5">
                          {format(aDate, "MMMM yyyy")}
                        </span>
                        <Link
                          href={`/auctions/${auction.code}`}
                          className="mt-3 text-[#32348A] text-[10px] font-semibold hover:underline text-center leading-tight"
                        >
                          + Add to<br />calendar
                        </Link>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
