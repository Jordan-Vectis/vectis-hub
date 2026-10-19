import { notFound } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { prisma } from "@/lib/prisma"
import { lotPhotoUrl } from "@/lib/photo-url"
import { getCustomerSession } from "@/lib/customer-auth"
import RegisterToBidButton from "../register-to-bid-button"
import { saleDateLong } from "../../site-dates"

// A Hub sale (a published CatalogueAuction) on the test website: its lots with the estimate and
// the current bid, searchable by words, barcode or category. Laid out as vectis.co.uk lays out a
// sale (2026-10-14): a kicker, the title and date with the cover picture on the right, a toolbar,
// then the lot grid. A sale that has finished shows the hammer prices instead of a bid button.

const TYPE_LABELS: Record<string, string> = {
  GENERAL: "General Auction", DIECAST: "Diecast", TRAINS: "Trains",
  VINYL: "Vinyl & Music", TV_FILM: "TV & Film", MATCHBOX: "Matchbox",
  COMICS: "Comics & Books", BEARS: "Teddy Bears", DOLLS: "Dolls & Toys",
}

const PAGE_SIZE = 48

const gbp = (n: number) => n.toLocaleString("en-GB")

function estimateText(low: number | null, high: number | null): string | null {
  if (low && high) return `£${gbp(low)} - £${gbp(high)}`
  if (low) return `£${gbp(low)}+`
  if (high) return `up to £${gbp(high)}`
  return null
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const auction = await prisma.catalogueAuction.findFirst({
    where: { code: code.toUpperCase() },
  })
  return { title: auction ? `${auction.name} — ${auction.finished || auction.complete ? "Results" : "Lots"}` : "Auction" }
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
  const currentPage = Math.max(1, parseInt(page ?? "1", 10) || 1)

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

  const ended = auction.finished || auction.complete

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

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const lots = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const from = filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const to = Math.min(currentPage * PAGE_SIZE, filtered.length)
  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(p => Math.abs(p - currentPage) <= 2 || p === 1 || p === totalPages)

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

  const base = `/auctions/${auction.code}`
  const pageHref = (p: number) => {
    const sp = new URLSearchParams()
    if (p > 1) sp.set("page", String(p))
    if (search) sp.set("search", search)
    if (category) sp.set("category", category)
    const qs = sp.toString()
    return qs ? `${base}?${qs}` : base
  }

  return (
    <div className="vs-page">
      <div className="vs-container">
        <Link href={ended ? "/auctions?tab=past" : "/auctions"} className="vs-link vs-link-back vs-link-sm">Back to auction calendar</Link>

        {/* ── The sale: kicker, title, date, with its cover picture on the right ── */}
        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_300px] lg:gap-12 items-start">
          <div className="min-w-0">
            <p className={`vs-kicker mb-3 ${ended ? "vs-kicker-navy" : ""}`}>
              {ended ? "Auction archive" : isLive ? "Live now" : auction.lots.length > 0 ? "Live auctions" : "Coming soon"}
            </p>
            <h1 className="vs-h1 mb-4">{auction.name}</h1>
            {auction.auctionDate && <p className="vs-caps mb-2">{saleDateLong(auction.auctionDate)}</p>}
            <p className="text-sm text-[var(--vs-muted)]">
              <span className="mr-4">Sale {auction.code}</span>
              <span className="mr-4">{TYPE_LABELS[auction.auctionType] ?? auction.auctionType}</span>
              <span>{auction.lots.length.toLocaleString("en-GB")} lots</span>
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {isLive && (
                <Link href={`${base}/live`} className="vs-btn vs-btn-red">
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse" aria-hidden="true" />
                  Bid live now
                </Link>
              )}
              {!ended && (
                <RegisterToBidButton
                  auctionId={auction.id}
                  auctionName={auction.name}
                  isLoggedIn={isLoggedIn}
                  alreadyRegistered={alreadyRegistered}
                />
              )}
            </div>
          </div>

          <div className="w-full max-w-[300px]">
            {/* The first lot's photo stands in for a cover picture — the Hub holds none for a sale. */}
            <div className="vs-card-flat aspect-square overflow-hidden relative">
              {heroImg
                ? <Image src={heroImg} alt="" fill className="object-contain" sizes="300px" priority />
                : <div className="w-full h-full bg-[var(--vs-bg)] flex items-center justify-center"><img src="/vectis-logo.svg" alt="" width={120} height={48} className="opacity-30" /></div>}
            </div>
            {!ended && auction.lots.length > 0 && !isLoggedIn && (
              <Link href="/portal/login" className="vs-btn vs-btn-block mt-4">Login to bid</Link>
            )}
          </div>
        </div>

        {/* ── Toolbar: search, category, and where the page is in the list ── */}
        {(auction.lots.length > 0 || search || category) && (
          <form method="GET" action={base} className="mt-10 pt-6 border-t border-[var(--vs-line)] flex flex-wrap items-center gap-3">
            <label htmlFor="lot-search" className="sr-only">Search the lots</label>
            <input id="lot-search" name="search" defaultValue={search ?? ""} placeholder="Search lots" className="vs-input sm:!w-72" />
            {categories.length > 0 && (
              <>
                <label htmlFor="lot-category" className="sr-only">Category</label>
                <select id="lot-category" name="category" defaultValue={category ?? ""} className="vs-select sm:!w-56">
                  <option value="">All categories</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </>
            )}
            <button type="submit" className="vs-btn">Search</button>
            {(search || category) && <Link href={base} className="vs-link vs-link-sm vs-link-plain">Clear</Link>}
            <p className="w-full sm:w-auto sm:ml-auto text-sm text-[var(--vs-muted)]">
              {filtered.length === 0
                ? "No lots found"
                : `Showing ${from.toLocaleString("en-GB")} - ${to.toLocaleString("en-GB")} of ${filtered.length.toLocaleString("en-GB")} lots${search ? ` for "${search}"` : ""}`}
            </p>
          </form>
        )}

        {/* ── The lots ── */}
        {lots.length === 0 ? (
          <p className="text-center py-20 text-[var(--vs-muted)]">
            {search || category ? "No lots match your search." : "The lots for this sale will appear here once the catalogue is online."}
          </p>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 lg:gap-6">
              {lots.map(lot => <LotCard key={lot.id} lot={lot} auctionCode={auction.code} ended={ended} isLoggedIn={isLoggedIn} />)}
            </div>

            {totalPages > 1 && (
              <nav className="vs-pages mt-12" aria-label="Pages of lots">
                {currentPage > 1 && <Link href={pageHref(currentPage - 1)} className="vs-page-link">Previous</Link>}
                {pageNumbers.map((p, i) => (
                  <span key={p} className="contents">
                    {i > 0 && pageNumbers[i - 1] !== p - 1 && <span className="px-1 text-[var(--vs-muted)]">…</span>}
                    <Link href={pageHref(p)} className="vs-page-link" aria-current={p === currentPage ? "page" : undefined}>{p}</Link>
                  </span>
                ))}
                {currentPage < totalPages && <Link href={pageHref(currentPage + 1)} className="vs-page-link">Next</Link>}
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// The picture and the title open the lot's page; the button is its own link beside them (a link
// inside a link is not allowed, and the two clicks would fight).
function LotCard({ lot, auctionCode, ended, isLoggedIn }: {
  lot: {
    id: string; barcode: string | null; receiptUniqueId: string | null; title: string
    estimateLow: number | null; estimateHigh: number | null
    hammerPrice: number | null; condition: string | null
    imageUrls: string[]; status: string
    commissionBids: { maxBid: number }[]
    currentBid: number | null
  }
  auctionCode: string
  ended: boolean
  isLoggedIn: boolean
}) {
  const img = lotPhotoUrl(lot.imageUrls[0], true)
  const sold = lot.status === "SOLD"
  const lotLabel = lot.barcode ?? lot.receiptUniqueId ?? "—"
  const currentBid = lot.currentBid ?? lot.commissionBids[0]?.maxBid ?? null
  const estimate = estimateText(lot.estimateLow, lot.estimateHigh)
  const href = `/auctions/${auctionCode}/lot/${lot.id}`

  return (
    <article className="vs-card-flat flex flex-col">
      <Link href={href} className="block relative bg-white aspect-square overflow-hidden border-b border-[var(--vs-line)]" aria-label={`Lot ${lotLabel}`}>
        {img
          ? <Image src={img} alt="" fill className="object-contain" sizes="(max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw" />
          : <div className="absolute inset-0 bg-[var(--vs-bg)]" />}
        {sold && <span className="vs-badge absolute top-2 left-2 text-xs">Sold</span>}
      </Link>
      <div className="p-3 sm:p-4 flex flex-col flex-1">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <span className="vs-caps text-[var(--vs-navy)] shrink-0">Lot {lotLabel}</span>
          {estimate && <span className="text-sm text-[var(--vs-muted)] text-right truncate">Estimate: {estimate}</span>}
        </div>
        <h3 className="text-base font-medium leading-snug line-clamp-2 mb-2">
          <Link href={href} className="hover:underline">{lot.title}</Link>
        </h3>
        {!sold && !ended && (
          <p className="text-sm mb-4">
            {currentBid && currentBid > 0
              ? <>Current bid: <span className="vs-price">£{gbp(currentBid)}</span></>
              : <span className="text-[var(--vs-muted)]">No bids yet</span>}
          </p>
        )}
        <div className="mt-auto">
          {sold ? (
            <p><span className="vs-price-label">Hammer price: </span><span className="vs-price">{lot.hammerPrice ? `£${gbp(lot.hammerPrice)}` : "—"}</span></p>
          ) : ended ? (
            <p className="vs-price-label">Unsold</p>
          ) : isLoggedIn ? (
            <Link href={href} className="vs-btn vs-btn-sm">Place bid</Link>
          ) : (
            <Link href="/portal/login" className="vs-btn vs-btn-sm">Login to bid</Link>
          )}
        </div>
      </div>
    </article>
  )
}
