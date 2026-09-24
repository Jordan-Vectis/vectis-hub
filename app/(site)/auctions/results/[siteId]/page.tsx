import { notFound } from "next/navigation"
import Link from "next/link"
import { format } from "date-fns"
import { getResultSale, getResultLots, getResultSummary, type ResultLot } from "../data"

// One past sale's results on the test website: its lots in lot order with photo, description,
// estimate and hammer price, read from the Hub's sale databases (see ../data.ts). The site id in the
// address is the website's own sale number — the one id every sale has, old system or BC.

export const dynamic = "force-dynamic"

const gbp = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 2 })

function estimateText(low: number | null, high: number | null): string | null {
  if (low && high) return `£${gbp(low)} – £${gbp(high)}`
  if (low) return `£${gbp(low)}+`
  if (high) return `–£${gbp(high)}`
  return null
}

function parseSiteId(raw: string): number | null {
  return /^\d{1,9}$/.test(raw) ? Number(raw) : null
}

export async function generateMetadata({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params
  const id = parseSiteId(siteId)
  const sale = id != null ? await getResultSale(id).catch(() => null) : null
  return { title: sale ? `${sale.title} — Results` : "Auction Results" }
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

  const currentPage = Math.max(1, parseInt(page ?? "1", 10) || 1)
  const [lots, summary] = await Promise.all([
    getResultLots(sale, { search, page: currentPage }),
    getResultSummary(sale),
  ])

  const base = `/auctions/results/${sale.siteId}`
  const pageHref = (p: number) => {
    const sp = new URLSearchParams()
    if (p > 1) sp.set("page", String(p))
    if (search) sp.set("search", search)
    const qs = sp.toString()
    return qs ? `${base}?${qs}` : base
  }

  return (
    <div>
      {/* ── Sale banner ── */}
      <div className="relative bg-[#32348A] overflow-hidden" style={{ height: "300px" }}>
        {sale.photo ? (
          <img src={sale.photo} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#32348A] to-[#4446a8]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black/60 to-transparent" />
        <div className="relative h-full max-w-7xl mx-auto px-4 sm:px-6 flex flex-col justify-end pb-8">
          <div className="flex items-center gap-2 text-xs text-gray-300 mb-3">
            <Link href="/auctions" className="hover:text-white transition-colors uppercase tracking-wider font-semibold">Auction Calendar</Link>
            <span>/</span>
            <Link href="/auctions?tab=past" className="hover:text-white transition-colors uppercase tracking-wider font-semibold">Results</Link>
            <span>/</span>
            <span className="text-white uppercase tracking-wider font-semibold truncate">{sale.title}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white mb-1">{sale.title}</h1>
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-200 mb-4">
            {sale.saleDate && <span>{format(new Date(sale.saleDate), "EEEE do MMMM yyyy")}</span>}
            {sale.code && <span className="text-[#2AB4A6] font-semibold">Sale {sale.code}</span>}
            <span className="text-amber-300 font-semibold uppercase tracking-wider text-xs">Auction ended</span>
          </div>
          {summary && summary.lots > 0 && (
            <div className="flex flex-wrap gap-6 text-white">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-300">Lots</p>
                <p className="text-2xl font-black leading-tight">{summary.lots.toLocaleString("en-GB")}</p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-300">Sold</p>
                <p className="text-2xl font-black leading-tight">
                  {summary.sold.toLocaleString("en-GB")}
                  <span className="text-sm font-semibold text-gray-300 ml-1">({Math.round((summary.sold / summary.lots) * 100)}%)</span>
                </p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-300">Hammer total</p>
                <p className="text-2xl font-black leading-tight">£{gbp(summary.hammerTotal)}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <form method="GET" action={base} className="flex flex-wrap items-center gap-3 py-3">
            <div className="flex items-center border border-gray-300 overflow-hidden">
              <span className="px-2 text-gray-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                </svg>
              </span>
              <input
                name="search"
                defaultValue={search ?? ""}
                placeholder="Lot number or words…"
                className="py-2 pr-3 text-sm focus:outline-none w-56"
              />
            </div>
            <button
              type="submit"
              className="bg-[#32348A] text-white text-sm font-semibold px-5 py-2 hover:bg-[#28296e] transition-colors uppercase tracking-wider"
            >
              Search
            </button>
            {search && (
              <Link href={base} className="text-sm text-gray-400 hover:text-[#32348A] underline">Clear</Link>
            )}
            <span className="ml-auto text-sm text-gray-500">
              {lots.total.toLocaleString("en-GB")} lots {search ? "found" : "in this sale"}
            </span>
          </form>
        </div>
      </div>

      {/* ── Lots grid ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {lots.rows.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            {search ? "No lots match your search." : "The results for this sale aren't in yet."}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
              {lots.rows.map(lot => <ResultLotCard key={lot.id} lot={lot} saleHref={base} />)}
            </div>

            {lots.pages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-10 flex-wrap">
                {currentPage > 1 && <PageLink href={pageHref(currentPage - 1)} label="← Prev" />}
                {Array.from({ length: lots.pages }, (_, i) => i + 1)
                  .filter(p => Math.abs(p - currentPage) <= 2 || p === 1 || p === lots.pages)
                  .map(p => <PageLink key={p} href={pageHref(p)} label={String(p)} active={p === currentPage} />)}
                {currentPage < lots.pages && <PageLink href={pageHref(currentPage + 1)} label="Next →" />}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// The whole card is one link to the lot's page (the zoom viewer lives there, not on the grid — a
// zoom button inside a link would be a button inside an anchor, and the two clicks would fight).
function ResultLotCard({ lot, saleHref }: { lot: ResultLot; saleHref: string }) {
  const estimate = estimateText(lot.estimateLow, lot.estimateHigh)
  return (
    <Link
      href={`${saleHref}/lot/${encodeURIComponent(lot.id)}`}
      className="group bg-white border border-gray-200 shadow-sm hover:shadow-md hover:border-[#32348A]/40 transition-all flex flex-col"
    >
      <div className="relative bg-gray-100 aspect-square overflow-hidden">
        {lot.photo ? (
          <img src={lot.photo} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-200">
            <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
        {lot.hammer == null && (
          <span className="absolute top-2 left-2 bg-gray-800/80 text-white text-[10px] font-black uppercase tracking-widest px-2 py-0.5 pointer-events-none">
            Unsold
          </span>
        )}
      </div>

      <div className="p-3 flex flex-col flex-1">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-xs font-bold text-[#DB0606] tracking-wide">LOT {lot.lot ?? "—"}</span>
          {estimate && <span className="text-[11px] text-gray-500 truncate">Est. {estimate}</span>}
        </div>
        <p className="text-sm text-gray-800 leading-snug line-clamp-4 mb-3" title={lot.description}>
          {lot.description || <span className="text-gray-400">No description held</span>}
        </p>
        <div className="mt-auto">
          {lot.hammer != null ? (
            <div className="w-full bg-[#32348A] text-white text-xs font-black uppercase tracking-widest py-2 text-center">
              Hammer £{gbp(lot.hammer)}
            </div>
          ) : (
            <div className="w-full bg-gray-100 text-gray-500 text-xs font-black uppercase tracking-widest py-2 text-center">
              Unsold
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}

function PageLink({ href, label, active }: { href: string; label: string; active?: boolean }) {
  return (
    <Link
      href={href}
      className={`min-w-[2.5rem] text-center px-3 py-2 text-sm font-semibold border transition-colors ${
        active ? "bg-[#32348A] text-white border-[#32348A]" : "bg-white text-[#32348A] border-gray-300 hover:border-[#32348A]"
      }`}
    >
      {label}
    </Link>
  )
}
