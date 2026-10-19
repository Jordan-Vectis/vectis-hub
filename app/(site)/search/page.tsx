import Link from "next/link"
import type { Metadata } from "next"
import { getCustomerSession } from "@/lib/customer-auth"
import { dateShort } from "../site-dates"
import { SEARCH_PAGE, parseFilter, queryWords, searchLots, type SearchFilter, type SearchHit, type SearchResult } from "./data"

// The test website's search results (/search?q=…&filter=…), laid out as vectis.co.uk lays out its
// search: "‹ BACK TO HOME", the title with its short navy rule, how many lots the words found,
// Upcoming | Archive | All, then the lots as the SAME card the sale pages use — square photo,
// LOT 12 with the estimate on the right, the title, and the hammer price (or LOGIN TO BID while
// the sale is still to come). The header's box sends the three filter values; ./data.ts does the
// finding, over the Hub's own sale databases (the old system's archive, Business Central's sales
// and the Hub's own catalogue), so "star wars" finds lots rather than nothing.

export const dynamic = "force-dynamic"

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string }> }): Promise<Metadata> {
  const { q } = await searchParams
  const query = (q ?? "").trim()
  return {
    // The layout's template adds "| Vectis Auctions" — a suffix here printed the name twice.
    title: query ? `Search results for "${query}"` : "Search",
    description: query
      ? `Lots matching "${query}" across Vectis auctions — the sales still to come and the archive of results.`
      : "Search every lot Vectis has sold since 1999, and the ones coming up for auction.",
    // A page of results for whatever was typed is not a page worth indexing.
    robots: { index: false, follow: true },
  }
}

// The three the header's select sends — the values are part of its contract, the labels are ours.
const TABS: { value: SearchFilter; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Archive" },
  { value: "all", label: "All" },
]
const IN_WORDS: Record<SearchFilter, string> = {
  upcoming: "in upcoming auctions",
  past: "in the archive",
  all: "across every auction",
}

const gbp = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 2 })

function estimateText(low: number | null, high: number | null): string | null {
  if (low && high) return `£${gbp(low)} - £${gbp(high)}`
  if (low) return `£${gbp(low)}+`
  if (high) return `up to £${gbp(high)}`
  return null
}

/** The address of a page of this search — the filter always travels with it, so the tab stays put. */
function searchHref(q: string, filter: SearchFilter, page = 1): string {
  const sp = new URLSearchParams({ q, filter })
  if (page > 1) sp.set("page", String(page))
  return `/search?${sp.toString()}`
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string; page?: string }> }) {
  const { q, filter: f, page } = await searchParams
  const query = (q ?? "").trim()
  const filter = parseFilter(f)
  const currentPage = Math.max(1, parseInt(page ?? "1", 10) || 1)

  // Who is looking only decides what the bid button says — the search is the same for everyone.
  const [session, result] = await Promise.all([
    getCustomerSession().catch(() => null),
    query ? searchLots({ q: query, filter, page: currentPage }) : Promise.resolve(null),
  ])

  return (
    <div className="vs-page">
      <div className="vs-container">
        <p className="mb-6"><Link href="/" className="vs-link vs-link-back vs-link-sm">Back to home</Link></p>
        <h1 className="vs-h2 vs-rule">Search results</h1>

        {/* The words again, so they can be changed here — on a phone the header's box is inside the menu. */}
        <form method="GET" action="/search" role="search" className="mt-8 flex flex-col sm:flex-row gap-3 sm:max-w-[640px]">
          <label htmlFor="site-search-q" className="sr-only">Search lots</label>
          <input id="site-search-q" name="q" defaultValue={query} placeholder="A maker, a character, a model number" autoComplete="off" className="vs-input min-w-0 sm:flex-1" />
          <input type="hidden" name="filter" value={filter} />
          <button type="submit" className="vs-btn shrink-0">Search</button>
        </form>

        {query && (
          <nav className="vs-tabs !justify-start mt-8" aria-label="Which auctions to search">
            {TABS.map(t => (
              <Link key={t.value} href={searchHref(query, t.value)} className="vs-tab" aria-current={t.value === filter ? "page" : undefined}>{t.label}</Link>
            ))}
          </nav>
        )}

        {!query || !result
          ? <Prompt />
          : <Results query={query} filter={filter} result={result} loggedIn={!!session} />}
      </div>
    </div>
  )
}

/** Nothing typed yet. */
function Prompt() {
  return (
    <div className="vs-card-flat mt-8 px-6 py-14 text-center">
      <p className="vs-h4">Type what you&rsquo;re looking for.</p>
      <p className="mt-3 max-w-[520px] mx-auto text-[var(--vs-muted)]">
        A maker, a character, a model number or a lot&rsquo;s unique ID &mdash; every lot Vectis has sold since 1999, and the ones coming up.
      </p>
    </div>
  )
}

function Results({ query, filter, result, loggedIn }: { query: string; filter: SearchFilter; result: SearchResult; loggedIn: boolean }) {
  // A page past the last one has nothing to show and no row to carry the total — say so, rather
  // than "no lots found" for words that do find lots.
  if (result.rows.length === 0 && result.page > 1) {
    return (
      <div className="vs-card-flat mt-6 px-6 py-14 text-center">
        <p className="vs-h4">There is nothing on page {result.page} for &lsquo;{query}&rsquo;.</p>
        <p className="mt-4"><Link href={searchHref(query, filter)} className="vs-link vs-link-sm">Back to the first page</Link></p>
      </div>
    )
  }
  if (result.total === 0) return <Empty query={query} filter={filter} note={result.note} />

  const from = (result.page - 1) * SEARCH_PAGE + 1
  const to = Math.min(result.page * SEARCH_PAGE, result.total)
  const pageNumbers = Array.from({ length: result.pages }, (_, i) => i + 1)
    .filter(p => Math.abs(p - result.page) <= 2 || p === 1 || p === result.pages)

  return (
    <>
      <p className="mt-6">
        <span className="font-semibold">{result.total.toLocaleString("en-GB")}</span> {result.total === 1 ? "lot" : "lots"} found for &lsquo;{query}&rsquo; {IN_WORDS[filter]}
        {result.pages > 1 && <span className="text-[var(--vs-muted)]"> &mdash; showing {from.toLocaleString("en-GB")} - {to.toLocaleString("en-GB")}</span>}
      </p>
      {result.note && <p className="mt-2 text-sm text-[var(--vs-muted)]">{result.note}</p>}

      <div className="mt-6 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 lg:gap-6">
        {result.rows.map(hit => <HitCard key={`${hit.source}-${hit.id}`} hit={hit} loggedIn={loggedIn} />)}
      </div>

      {result.pages > 1 && (
        <nav className="vs-pages mt-12" aria-label="Pages of results">
          {result.page > 1 && <Link href={searchHref(query, filter, result.page - 1)} className="vs-page-link">Previous</Link>}
          {pageNumbers.map((p, i) => (
            <span key={p} className="contents">
              {i > 0 && pageNumbers[i - 1] !== p - 1 && <span className="px-1 text-[var(--vs-muted)]">&hellip;</span>}
              <Link href={searchHref(query, filter, p)} className="vs-page-link" aria-current={p === result.page ? "page" : undefined}>{p}</Link>
            </span>
          ))}
          {result.page < result.pages && <Link href={searchHref(query, filter, result.page + 1)} className="vs-page-link">Next</Link>}
        </nav>
      )}
    </>
  )
}

/** Nothing found — or the search couldn't be run (then the note says why). Suggests a way on. */
function Empty({ query, filter, note }: { query: string; filter: SearchFilter; note?: string }) {
  const words = queryWords(query)
  const others = TABS.filter(t => t.value !== filter)
  return (
    <div className="vs-card-flat mt-6 px-6 py-14 text-center">
      <p className="vs-h4">{note ?? <>No lots found for &lsquo;{query}&rsquo; {IN_WORDS[filter]}.</>}</p>
      <div className="mt-5 max-w-[560px] mx-auto text-[var(--vs-muted)] space-y-4">
        {others.length > 0 && (
          <p>
            Look {filter === "upcoming" ? "further back" : "elsewhere"}:{" "}
            {others.map((t, i) => (
              <span key={t.value}>
                {i > 0 && " or "}
                <Link href={searchHref(query, t.value)} className="vs-text-link">{t.label.toLowerCase()} auctions</Link>
              </span>
            ))}
          </p>
        )}
        {words.length > 1 && (
          <p>
            Or try one word on its own:{" "}
            {words.map((w, i) => (
              <span key={w}>
                {i > 0 && ", "}
                <Link href={searchHref(w, filter)} className="vs-text-link">{w}</Link>
              </span>
            ))}
          </p>
        )}
        <p>Try another word &mdash; a maker (Corgi, Dinky, Hornby), a character, or a model number on its own.</p>
      </div>
      <p className="mt-8"><Link href="/auctions" className="vs-link vs-link-sm">Browse the auction calendar</Link></p>
    </div>
  )
}

// A hit opens on this site when we hold its sale, on vectis.co.uk when we only hold the lot, and
// nowhere when neither — the card is still worth showing for its photo, estimate and result.
function Open({ hit, className, label, children }: { hit: SearchHit; className: string; label?: string; children: React.ReactNode }) {
  if (!hit.href) return <span className={className}>{children}</span>
  if (hit.external) return <a href={hit.href} target="_blank" rel="noreferrer" className={className} aria-label={label}>{children}</a>
  return <Link href={hit.href} className={className} aria-label={label}>{children}</Link>
}

// The sale pages' lot card, with one line more: which sale the lot is in — a search spans every
// sale, so the card has to say. The button is its own link beside the picture and the title (a link
// inside a link is not allowed, and the two clicks would fight).
function HitCard({ hit, loggedIn }: { hit: SearchHit; loggedIn: boolean }) {
  const estimate = estimateText(hit.estimateLow, hit.estimateHigh)
  // A BC or archive lot has a lot number; a Hub lot not yet in a sale is known by its barcode.
  const label = `Lot ${hit.lot ?? hit.ident ?? "—"}`
  const sale = [hit.saleTitle, hit.saleDate ? dateShort(hit.saleDate) : ""].filter(Boolean).join(" · ")
  return (
    <article className="vs-card-flat flex flex-col">
      <Open hit={hit} className="block bg-white aspect-square overflow-hidden border-b border-[var(--vs-line)]" label={`${label}: ${hit.title}`}>
        {hit.photo
          ? <img src={hit.photo} alt="" loading="lazy" className="w-full h-full object-contain" />
          : <span className="block w-full h-full bg-[var(--vs-bg)]" />}
      </Open>
      <div className="p-3 sm:p-4 flex flex-col flex-1">
        {/* On a phone the two don't always fit one line; the estimate drops to its own, still right-aligned. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 mb-2">
          <span className="vs-caps text-[var(--vs-navy)] shrink-0">{label}</span>
          {estimate && <span className="ml-auto text-sm text-[var(--vs-muted)] text-right">Estimate: {estimate}</span>}
        </div>
        <h3 className="text-base font-medium leading-snug line-clamp-3 mb-2" title={hit.description}>
          <Open hit={hit} className="hover:underline">{hit.title}</Open>
        </h3>
        {sale && <p className="text-xs text-[var(--vs-muted)] line-clamp-1 mb-4">{sale}</p>}
        <div className="mt-auto">
          {hit.hammer != null ? (
            <p><span className="vs-price-label">Hammer price: </span><span className="vs-price">£{gbp(hit.hammer)}</span></p>
          ) : hit.upcoming ? (
            loggedIn && hit.href
              ? <Open hit={hit} className="vs-btn vs-btn-sm">View lot</Open>
              : <Link href="/portal/login" className="vs-btn vs-btn-sm">Login to bid</Link>
          ) : (
            <p className="vs-price-label">Unsold</p>
          )}
          {hit.external && <p className="mt-2 text-xs text-[var(--vs-muted)]">Opens on vectis.co.uk</p>}
        </div>
      </div>
    </article>
  )
}
