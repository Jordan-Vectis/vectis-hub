import { notFound } from "next/navigation"
import Link from "next/link"
import { getResultSale, getResultLots, getResultSummary, saleHasHappened, LOTS_PAGE, type ResultLot } from "../data"
import { saleDateLong } from "../../../site-dates"

// One sale on the test website — its lots in lot order with photo, description, estimate and
// (once the sale has happened) the hammer price, read from the Hub's sale databases (see
// ../data.ts). The site id in the address is the website's own sale number — the one id every
// sale has, old system or BC. The home page and the calendar link UPCOMING sales here too, so the
// page wears two faces: "LIVE AUCTIONS" with estimates and LOGIN TO BID before the day, "AUCTION
// ARCHIVE" with the results after it. Laid out as vectis.co.uk lays out a sale (2026-10-14).

export const dynamic = "force-dynamic"

const gbp = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 2 })

function estimateText(low: number | null, high: number | null): string | null {
  if (low && high) return `£${gbp(low)} - £${gbp(high)}`
  if (low) return `£${gbp(low)}+`
  if (high) return `up to £${gbp(high)}`
  return null
}

function parseSiteId(raw: string): number | null {
  return /^\d{1,9}$/.test(raw) ? Number(raw) : null
}

export async function generateMetadata({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params
  const id = parseSiteId(siteId)
  const sale = id != null ? await getResultSale(id).catch(() => null) : null
  if (!sale) return { title: "Auction" }
  return { title: `${sale.title} — ${saleHasHappened(sale) ? "Results" : "Lots"}` }
}

export default async function SaleResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>
  searchParams: Promise<{ search?: string; page?: string }>
}) {
  const { siteId: raw } = await params
  const { search, page } = await searchParams
  const siteId = parseSiteId(raw)
  if (siteId == null) notFound()

  const sale = await getResultSale(siteId)
  if (!sale) notFound()

  // Before the day there is no result to show — only the estimate, and a way to log in and bid.
  const happened = saleHasHappened(sale)
  const currentPage = Math.max(1, parseInt(page ?? "1", 10) || 1)
  const [lots, summary] = await Promise.all([
    getResultLots(sale, { search, page: currentPage }),
    happened ? getResultSummary(sale) : Promise.resolve(null),
  ])

  const base = `/auctions/results/${sale.siteId}`
  const pageHref = (p: number) => {
    const sp = new URLSearchParams()
    if (p > 1) sp.set("page", String(p))
    if (search) sp.set("search", search)
    const qs = sp.toString()
    return qs ? `${base}?${qs}` : base
  }
  const from = lots.total === 0 ? 0 : (lots.page - 1) * LOTS_PAGE + 1
  const to = Math.min(lots.page * LOTS_PAGE, lots.total)
  const pageNumbers = Array.from({ length: lots.pages }, (_, i) => i + 1)
    .filter(p => Math.abs(p - currentPage) <= 2 || p === 1 || p === lots.pages)

  return (
    <div className="vs-page">
      <div className="vs-container">
        <Link href={happened ? "/auctions?tab=past" : "/auctions"} className="vs-link vs-link-back vs-link-sm">Back to auction calendar</Link>

        {/* ── The sale: kicker, title, date, with its cover picture on the right ── */}
        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_300px] lg:gap-12 items-start">
          <div className="min-w-0">
            <p className={`vs-kicker mb-3 ${happened ? "vs-kicker-navy" : ""}`}>
              {happened ? "Auction archive" : lots.total > 0 ? "Live auctions" : "Coming soon"}
            </p>
            <h1 className="vs-h1 mb-4">{sale.title}</h1>
            {sale.saleDate && <p className="vs-caps mb-2">{saleDateLong(sale.saleDate)}</p>}
            <p className="text-sm text-[var(--vs-muted)]">
              {sale.code && <span className="mr-4">Sale {sale.code}</span>}
              {happened
                ? "This auction has ended — the hammer prices are shown against each lot."
                : lots.total > 0
                  ? `${lots.total.toLocaleString("en-GB")} lots. Log in to leave a commission bid or to bid live on the day.`
                  : "The catalogue for this sale is not online yet. Check back soon."}
            </p>
          </div>

          <div className="w-full max-w-[300px]">
            {/* The site's cover files are square — shown whole on white, as vectis.co.uk's calendar shows them. */}
            <div className="vs-card-flat aspect-square overflow-hidden">
              {sale.photo
                ? <img src={sale.photo} alt="" loading="lazy" className="w-full h-full object-contain" />
                : <div className="w-full h-full bg-[var(--vs-bg)] flex items-center justify-center"><img src="/vectis-logo.svg" alt="" width={120} height={48} className="opacity-30" /></div>}
            </div>
            {!happened && lots.total > 0 && (
              <Link href="/portal/login" className="vs-btn vs-btn-block mt-4">Login to bid</Link>
            )}
          </div>
        </div>

        {/* ── The result in numbers — only once the sale has happened ── */}
        {happened && summary && summary.lots > 0 && (
          <div className="vs-band mt-10 grid grid-cols-3 divide-x divide-[var(--vs-line)] text-center">
            <Figure label="Lots" value={summary.lots.toLocaleString("en-GB")} />
            <Figure label="Sold" value={`${Math.round((summary.sold / summary.lots) * 100)}%`} sub={`${summary.sold.toLocaleString("en-GB")} lots`} />
            <Figure label="Hammer total" value={`£${gbp(summary.hammerTotal)}`} />
          </div>
        )}

        {/* ── Toolbar: search, and where the page is in the list ── */}
        {(lots.total > 0 || search) && (
          <form method="GET" action={base} className="mt-10 pt-6 border-t border-[var(--vs-line)] flex flex-wrap items-center gap-3">
            <label htmlFor="lot-search" className="sr-only">Search the lots</label>
            <input id="lot-search" name="search" defaultValue={search ?? ""} placeholder="Lot number or words" className="vs-input sm:!w-72" />
            <button type="submit" className="vs-btn">Search</button>
            {search && <Link href={base} className="vs-link vs-link-sm vs-link-plain">Clear</Link>}
            <p className="w-full sm:w-auto sm:ml-auto text-sm text-[var(--vs-muted)]">
              {lots.total === 0
                ? "No lots found"
                : `Showing ${from.toLocaleString("en-GB")} - ${to.toLocaleString("en-GB")} of ${lots.total.toLocaleString("en-GB")} lots${search ? ` for "${search}"` : ""}`}
            </p>
          </form>
        )}

        {/* ── The lots ── */}
        {lots.rows.length === 0 ? (
          <p className="text-center py-20 text-[var(--vs-muted)]">
            {search
              ? "No lots match your search."
              : happened ? "The results for this sale are not held." : "The lots for this sale will appear here once the catalogue is online."}
          </p>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 lg:gap-6">
              {lots.rows.map(lot => <ResultLotCard key={lot.id} lot={lot} saleHref={base} happened={happened} />)}
            </div>

            {lots.pages > 1 && (
              <nav className="vs-pages mt-12" aria-label="Pages of lots">
                {currentPage > 1 && <Link href={pageHref(currentPage - 1)} className="vs-page-link">Previous</Link>}
                {pageNumbers.map((p, i) => (
                  <span key={p} className="contents">
                    {i > 0 && pageNumbers[i - 1] !== p - 1 && <span className="px-1 text-[var(--vs-muted)]">…</span>}
                    <Link href={pageHref(p)} className="vs-page-link" aria-current={p === currentPage ? "page" : undefined}>{p}</Link>
                  </span>
                ))}
                {currentPage < lots.pages && <Link href={pageHref(currentPage + 1)} className="vs-page-link">Next</Link>}
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="py-6 px-2">
      <p className="text-[28px] sm:text-[36px] leading-none font-semibold text-[var(--vs-navy)]">{value}</p>
      <p className="vs-caps text-xs mt-2">{label}</p>
      {sub && <p className="text-xs text-[var(--vs-muted)] mt-1">{sub}</p>}
    </div>
  )
}

// The picture and the description open the lot's page (the zoom viewer lives there, not on the
// grid). The button is its own link, beside them rather than inside them — a link inside a link
// is not allowed, and the two clicks would fight.
function ResultLotCard({ lot, saleHref, happened }: { lot: ResultLot; saleHref: string; happened: boolean }) {
  const estimate = estimateText(lot.estimateLow, lot.estimateHigh)
  const href = `${saleHref}/lot/${encodeURIComponent(lot.id)}`
  return (
    <article className="vs-card-flat flex flex-col">
      <Link href={href} className="block bg-white aspect-square overflow-hidden border-b border-[var(--vs-line)]" aria-label={`Lot ${lot.lot ?? ""}`}>
        {lot.photo
          ? <img src={lot.photo} alt="" loading="lazy" className="w-full h-full object-contain" />
          : <div className="w-full h-full bg-[var(--vs-bg)]" />}
      </Link>
      <div className="p-3 sm:p-4 flex flex-col flex-1">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <span className="vs-caps text-[var(--vs-navy)] shrink-0">Lot {lot.lot ?? "—"}</span>
          {estimate && <span className="text-sm text-[var(--vs-muted)] text-right truncate">Estimate: {estimate}</span>}
        </div>
        <p className="text-sm leading-snug line-clamp-3 mb-4" title={lot.description}>
          <Link href={href} className="hover:underline">
            {lot.description || <span className="text-[var(--vs-muted)]">No description held</span>}
          </Link>
        </p>
        <div className="mt-auto">
          {happened ? (
            lot.hammer != null
              ? <p><span className="vs-price-label">Hammer price: </span><span className="vs-price">£{gbp(lot.hammer)}</span></p>
              : <p className="vs-price-label">Unsold</p>
          ) : (
            <Link href="/portal/login" className="vs-btn vs-btn-sm">Login to bid</Link>
          )}
        </div>
      </div>
    </article>
  )
}
