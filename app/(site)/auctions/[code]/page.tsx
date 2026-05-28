import { notFound } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { prisma } from "@/lib/prisma"
import { format } from "date-fns"
import { lotPhotoUrl } from "@/lib/photo-url"
import { getCustomerSession } from "@/lib/customer-auth"
import RegisterToBidButton from "../register-to-bid-button"

const TYPE_LABELS: Record<string, string> = {
  GENERAL: "General Auction", DIECAST: "Diecast", TRAINS: "Trains",
  VINYL: "Vinyl & Music", TV_FILM: "TV & Film", MATCHBOX: "Matchbox",
  COMICS: "Comics & Books", BEARS: "Teddy Bears", DOLLS: "Dolls & Toys",
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const auction = await prisma.catalogueAuction.findFirst({
    where: { code: code.toUpperCase() },
  })
  return { title: auction ? `${auction.name} — Vectis Auctions` : "Auction — Vectis" }
}

export default async function AuctionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<{ search?: string; category?: string; page?: string }>
}) {
  const { code } = await params
  const { search, category, page } = await searchParams
  const currentPage = parseInt(page ?? "1", 10)
  const PAGE_SIZE = 48

  const auction = await prisma.catalogueAuction.findFirst({
    where: { code: code.toUpperCase(), published: true },
    include: {
      lots: {
        orderBy: { createdAt: "asc" },
        include: {
          commissionBids: {
            select: { maxBid: true },
            orderBy: { maxBid: "desc" },
            take: 1,
          },
        },
      },
      liveAuction: true,
    },
  })

  const isLive = !!auction?.liveAuction && ["ACTIVE", "PAUSED"].includes(auction.liveAuction.status)

  if (!auction) notFound()

  // Dedupe categories
  const categories = [...new Set(auction.lots.map(l => l.category).filter(Boolean))] as string[]

  // Filter
  const filtered = auction.lots.filter(l => {
    if (category && l.category !== category) return false
    if (search) {
      const q = search.toLowerCase()
      return l.title.toLowerCase().includes(q) || (l.barcode ?? "").toLowerCase().includes(q) || l.description.toLowerCase().includes(q)
    }
    return true
  })

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const lots = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const heroImg = lotPhotoUrl(auction.lots.find(l => l.imageUrls.length > 0)?.imageUrls[0], true)

  // Check customer session + registration status
  const customerSession = await getCustomerSession()
  const isLoggedIn = !!customerSession
  const alreadyRegistered = customerSession
    ? !!(await prisma.bidderRegistration.findUnique({
        where: {
          auctionId_customerAccountId: {
            auctionId: auction.id,
            customerAccountId: customerSession.id,
          },
        },
      }))
    : false

  return (
    <div>
      {/* ── Auction hero ── */}
      <div className="relative bg-[#32348A] overflow-hidden" style={{ height: "280px" }}>
        {heroImg ? (
          <Image src={heroImg} alt={auction.name} fill className="object-cover opacity-30" priority />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#32348A] to-[#4446a8]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black/50 to-transparent" />
        <div className="relative h-full max-w-7xl mx-auto px-4 sm:px-6 flex flex-col justify-end pb-8">
          <div className="flex items-center gap-2 text-xs text-gray-400 mb-3">
            <Link href="/auctions" className="hover:text-white transition-colors uppercase tracking-wider font-semibold">Auction Calendar</Link>
            <span>/</span>
            <span className="text-white uppercase tracking-wider font-semibold">{auction.name}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white mb-1">{auction.name}</h1>
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-300 mb-4">
            {auction.auctionDate && (
              <span>{format(new Date(auction.auctionDate), "EEEE do MMMM yyyy")}</span>
            )}
            <span className="text-[#2AB4A6] font-semibold">{TYPE_LABELS[auction.auctionType] ?? auction.auctionType}</span>
            <span>{auction.lots.length} lots</span>
            {auction.finished && <span className="text-amber-400 font-semibold">Auction Ended</span>}
          </div>
          <div className="flex flex-wrap gap-3">
            {isLive && (
              <Link
                href={`/auctions/${auction.code}/live`}
                className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-black text-sm px-6 py-3 uppercase tracking-widest transition-colors"
              >
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                BID LIVE NOW
              </Link>
            )}
            {!auction.finished && !auction.complete && (
              <RegisterToBidButton
                auctionId={auction.id}
                auctionName={auction.name}
                isLoggedIn={isLoggedIn}
                alreadyRegistered={alreadyRegistered}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <form method="GET" className="flex flex-wrap items-center gap-3 py-3">
            <div className="flex items-center border border-gray-300 overflow-hidden">
              <span className="px-2 text-gray-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                </svg>
              </span>
              <input
                name="search"
                defaultValue={search ?? ""}
                placeholder="Search lots…"
                className="py-2 pr-3 text-sm focus:outline-none w-52"
              />
            </div>

            {categories.length > 0 && (
              <select
                name="category"
                defaultValue={category ?? ""}
                className="border border-gray-300 px-3 py-2 text-sm focus:outline-none"
              >
                <option value="">All Categories</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}

            <button
              type="submit"
              className="bg-[#32348A] text-white text-sm font-semibold px-5 py-2 hover:bg-[#28296e] transition-colors uppercase tracking-wider"
            >
              Filter
            </button>

            {(search || category) && (
              <Link href={`/auctions/${auction.code}`} className="text-sm text-gray-400 hover:text-[#32348A] underline">
                Clear
              </Link>
            )}

            <span className="ml-auto text-sm text-gray-500">
              {filtered.length} lots {search || category ? "found" : "total"}
            </span>
          </form>
        </div>
      </div>

      {/* ── Lots grid ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {lots.length === 0 ? (
          <div className="text-center py-20 text-gray-400">No lots match your search.</div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {lots.map(lot => <LotCard key={lot.id} lot={lot} auctionCode={auction.code} />)}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-10">
                {currentPage > 1 && (
                  <PaginationLink code={auction.code} page={currentPage - 1} search={search} category={category} label="← Prev" />
                )}
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(p => Math.abs(p - currentPage) <= 2)
                  .map(p => (
                    <PaginationLink
                      key={p}
                      code={auction.code}
                      page={p}
                      search={search}
                      category={category}
                      label={String(p)}
                      active={p === currentPage}
                    />
                  ))}
                {currentPage < totalPages && (
                  <PaginationLink code={auction.code} page={currentPage + 1} search={search} category={category} label="Next →" />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function LotCard({ lot, auctionCode }: {
  lot: {
    id: string; barcode: string | null; receiptUniqueId: string | null; title: string
    estimateLow: number | null; estimateHigh: number | null
    hammerPrice: number | null; condition: string | null
    imageUrls: string[]; status: string
    commissionBids: { maxBid: number }[]
    currentBid: number | null
  }
  auctionCode: string
}) {
  const img = lotPhotoUrl(lot.imageUrls[0], true)
  const sold = lot.status === "SOLD"
  const lotLabel = lot.barcode ?? lot.receiptUniqueId ?? "—"
  const currentBid = lot.currentBid ?? lot.commissionBids[0]?.maxBid ?? null

  const estimateStr = lot.estimateLow && lot.estimateHigh
    ? `£${lot.estimateLow.toLocaleString("en-GB")} – £${lot.estimateHigh.toLocaleString("en-GB")}`
    : lot.estimateLow
    ? `£${lot.estimateLow.toLocaleString("en-GB")}+`
    : lot.estimateHigh
    ? `–£${lot.estimateHigh.toLocaleString("en-GB")}`
    : null

  return (
    <Link
      href={`/auctions/${auctionCode}/lot/${lot.id}`}
      className="group bg-white border border-gray-200 shadow-sm hover:shadow-md transition-shadow flex flex-col cursor-pointer"
    >
      {/* Image */}
      <div className="relative bg-gray-100 aspect-square overflow-hidden">
        {img ? (
          <Image
            src={img}
            alt={lot.title}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-200">
            <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
        {/* Heart / favourites icon */}
        <div className="absolute top-2 right-2">
          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
          </svg>
        </div>
        {sold && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="text-white font-black text-sm tracking-widest uppercase">SOLD</span>
          </div>
        )}
      </div>

      {/* Details */}
      <div className="p-3 flex flex-col flex-1">
        {/* Lot number + estimate row */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-[#DB0606] tracking-wide">LOT {lotLabel}</span>
          {estimateStr && (
            <span className="text-[11px] text-gray-500">Estimate: {estimateStr}</span>
          )}
        </div>

        {/* Title */}
        <p className="text-sm font-bold text-gray-800 leading-snug line-clamp-2 mb-2 group-hover:text-[#32348A]">
          {lot.title}
        </p>

        {/* Current bid */}
        <div className="mb-3">
          {currentBid && currentBid > 0 ? (
            <p className="text-sm font-bold text-gray-900">
              Current Bid: £{currentBid.toLocaleString("en-GB")}
            </p>
          ) : (
            <p className="text-sm text-gray-400">No Bids Yet</p>
          )}
        </div>

        {/* CTA button */}
        <div className="mt-auto">
          {sold ? (
            <div className="w-full bg-gray-100 text-gray-500 text-xs font-black uppercase tracking-widest py-2.5 text-center">
              SOLD — £{lot.hammerPrice ? lot.hammerPrice.toLocaleString("en-GB") : "–"}
            </div>
          ) : (
            <div className="w-full bg-[#32348A] hover:bg-[#28296e] text-white text-xs font-black uppercase tracking-widest py-2.5 text-center transition-colors">
              PLACE BID
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}

function PaginationLink({
  code, page, search, category, label, active,
}: {
  code: string; page: number; search?: string; category?: string; label: string; active?: boolean
}) {
  const params = new URLSearchParams()
  params.set("page", String(page))
  if (search) params.set("search", search)
  if (category) params.set("category", category)

  return (
    <Link
      href={`/auctions/${code}?${params.toString()}`}
      className={`min-w-[2.5rem] text-center px-3 py-2 text-sm font-semibold border transition-colors ${
        active
          ? "bg-[#32348A] text-white border-[#32348A]"
          : "bg-white text-[#32348A] border-gray-300 hover:border-[#32348A]"
      }`}
    >
      {label}
    </Link>
  )
}
