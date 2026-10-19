// The Auction Calendar — the Upcoming and View Results tabs, the year strip, the mini month
// calendar and the list, laid out as vectis.co.uk lays them out (2026-10-14). One copy, used by
// the built-in /auctions page and by the page editor's "Auction calendar" live block.
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import LiveAuctionBanner from "./live-auction-banner"
import AuctionCalendarSidebar from "./auction-calendar-sidebar"
import { lotPhotoUrl } from "@/lib/photo-url"
import { getCustomerSession } from "@/lib/customer-auth"
import RegisterToBidButton from "./register-to-bid-button"
import ResultsList, { SaleRow } from "./results-list"
import { listUpcomingSales, resultCalendarEntries, resultYears, upcomingCalendarEntries } from "./results/data"

const TYPE_LABELS: Record<string, string> = {
  GENERAL: "General Auction", DIECAST: "Diecast", TRAINS: "Trains",
  VINYL: "Vinyl & Music", TV_FILM: "TV & Film", MATCHBOX: "Matchbox",
  COMICS: "Comics & Books", BEARS: "Teddy Bears", DOLLS: "Dolls & Toys",
}

// A Hub sale moves to "past" 24 hours after its scheduled date — it is still running on the day.
function isPast(auctionDate: Date | null, finished: boolean, complete: boolean): boolean {
  if (finished || complete) return true
  if (!auctionDate) return false
  return new Date(auctionDate.getTime() + 24 * 60 * 60 * 1000) < new Date()
}

export type CalendarParams = { search?: string; tab?: string; type?: string; page?: string; year?: string }

/** One row of the Upcoming list — a sale from the website's own list, or a Hub sale not in it. */
type UpcomingRow = {
  key: string
  href: string
  title: string
  photo: string | null
  date: Date | null
  lots: number
  meta: string
  /** Set for a Hub sale: what its buttons need. */
  hub?: { id: string; code: string; isLive: boolean }
}

const LiveKicker = () => (
  <span className="inline-flex items-center gap-2">
    <span className="w-2 h-2 rounded-full bg-[var(--vs-red)] animate-pulse" aria-hidden="true" />
    Live now
  </span>
)

export default async function AuctionCalendar({ sp, title = "Auction Calendar" }: { sp: CalendarParams; title?: string }) {
  const { search, tab, type, page, year } = sp
  const showPast = tab === "past"
  const q = (search ?? "").trim()

  // The visitor's account and the sales they are already registered for.
  const customerSession = await getCustomerSession().catch(() => null)
  const isLoggedIn = !!customerSession
  const registeredAuctionIds = new Set<string>()
  if (customerSession) {
    const regs = await prisma.bidderRegistration.findMany({
      where: { customerAccountId: customerSession.id },
      select: { auctionId: true },
    }).catch(() => [])
    for (const r of regs) registeredAuctionIds.add(r.auctionId)
  }

  // A sale running right now takes over the top of the page.
  const liveAuction = await prisma.liveAuction.findFirst({
    where: { status: { in: ["ACTIVE", "PAUSED"] } },
    include: { auction: { include: { lots: { orderBy: { createdAt: "asc" } } } } },
  }).catch(() => null)

  // The Hub's published sales still to come — the website's own list is read below, and a Hub
  // sale the website already lists (same BC code) is left to that list.
  const hubSales = await prisma.catalogueAuction.findMany({
    where: { published: true },
    orderBy: { auctionDate: "asc" },
    include: {
      _count: { select: { lots: true } },
      liveAuction: true,
      lots: { take: 1, where: { imageUrls: { isEmpty: false } }, select: { imageUrls: true } },
    },
  }).catch(() => [])
  const hubUpcoming = hubSales.filter(a => !isPast(a.auctionDate, a.finished, a.complete))

  // The category list is the Hub's sale types with something coming up — it means nothing for the archive.
  const auctionTypes = showPast ? [] : [...new Set(hubUpcoming.map(a => TYPE_LABELS[a.auctionType] ?? a.auctionType))]

  // ── Upcoming: the website's sales plus the Hub's not among them, soonest first ──
  let rows: UpcomingRow[] = []
  let calendarEntries: { date: string; href: string }[] = []
  let years: number[] = []
  if (showPast) {
    ;[calendarEntries, years] = await Promise.all([resultCalendarEntries(), resultYears()])
  } else {
    const [siteSales, siteEntries] = await Promise.all([listUpcomingSales(60), upcomingCalendarEntries()])
    const codes = new Set(siteSales.map(s => (s.code ?? "").toUpperCase()).filter(Boolean))
    const hubOnly = hubUpcoming.filter(a => !codes.has(a.code.toUpperCase()))

    // A type can only be read off a Hub sale — the website's list carries none — so a chosen
    // category shows the Hub's sales of that type and leaves the website's out.
    if (!type) {
      for (const s of siteSales) {
        rows.push({
          key: `site-${s.siteId}`,
          href: `/auctions/results/${s.siteId}`,
          title: s.title,
          photo: s.photo,
          date: s.saleDate,
          lots: s.lotCount,
          meta: [s.lotCount > 0 ? `${s.lotCount.toLocaleString("en-GB")} lots` : "Catalogue to follow", s.code ? `Sale ${s.code}` : ""].filter(Boolean).join(" · "),
        })
      }
    }
    for (const a of hubOnly) {
      const label = TYPE_LABELS[a.auctionType] ?? a.auctionType
      if (type && label !== type) continue
      rows.push({
        key: `hub-${a.id}`,
        href: `/auctions/${a.code}`,
        title: a.name,
        photo: lotPhotoUrl(a.lots[0]?.imageUrls[0], true),
        date: a.auctionDate,
        lots: a._count.lots,
        meta: `${a._count.lots.toLocaleString("en-GB")} lots · ${label} · Sale ${a.code}`,
        hub: { id: a.id, code: a.code, isLive: !!a.liveAuction && ["ACTIVE", "PAUSED"].includes(a.liveAuction.status) },
      })
    }
    if (q) {
      const needle = q.toLowerCase()
      rows = rows.filter(r => r.title.toLowerCase().includes(needle) || r.meta.toLowerCase().includes(needle))
    }
    const at = (d: Date | null) => (d ? d.getTime() : Number.MAX_SAFE_INTEGER)
    rows.sort((a, b) => at(a.date) - at(b.date))

    // The mini calendar marks every sale day, whatever the category filter shows in the list.
    calendarEntries = [
      ...siteEntries,
      ...hubOnly.filter(a => a.auctionDate).map(a => ({ date: a.auctionDate!.toISOString(), href: `/auctions/${a.code}` })),
    ]
  }

  const yearNum = showPast && year && years.includes(Number(year)) ? Number(year) : undefined

  // Addresses that keep the rest of the filters: the year strip keeps the search and category;
  // "Clear" drops both and keeps only the tab and year.
  const listHref = (overrides: { year?: number; clear?: boolean } = {}) => {
    const p = new URLSearchParams()
    if (showPast) p.set("tab", "past")
    const y = overrides.year ?? yearNum
    if (y) p.set("year", String(y))
    if (!overrides.clear) {
      if (type) p.set("type", type)
      if (q) p.set("search", q)
    }
    const qs = p.toString()
    return qs ? `/auctions?${qs}` : "/auctions"
  }

  return (
    <div>
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

      <div className="vs-page">
        <div className="vs-container">
          {title && <h1 className="vs-h1 text-center mb-8">{title}</h1>}

          {/* ── Upcoming | View Results ── */}
          <nav className="vs-tabs" aria-label="Auction calendar">
            <Link href="/auctions" className="vs-tab" aria-current={!showPast ? "page" : undefined}>Upcoming</Link>
            <Link href="/auctions?tab=past" className="vs-tab" aria-current={showPast ? "page" : undefined}>View Results</Link>
          </nav>

          {/* ── The years the archive covers. A year opens the calendar on it; the list stays every past sale, newest first. ── */}
          {showPast && years.length > 0 && (
            <div className="flex justify-center">
              <nav className="vs-years max-w-full" aria-label="Results by year">
                {years.map(y => (
                  <Link key={y} href={listHref({ year: y })} className="vs-year" aria-current={y === yearNum ? "true" : undefined}>{y}</Link>
                ))}
              </nav>
            </div>
          )}

          <div className="mt-8 grid gap-8 lg:grid-cols-[240px_1fr] lg:gap-10 items-start">
            {/* The calendar is keyed on what it was asked to open on, so a new year or tab starts it afresh. */}
            <AuctionCalendarSidebar
              key={`${showPast ? "past" : "upcoming"}-${yearNum ?? "now"}`}
              auctionEntries={calendarEntries}
              auctionTypes={auctionTypes}
              selectedType={type ?? ""}
              year={yearNum}
            />

            <div className="min-w-0">
              {/* Search — by title, or by sale code. */}
              <form method="GET" action="/auctions" className="flex flex-wrap items-center gap-2 mb-5" role="search">
                {showPast && <input type="hidden" name="tab" value="past" />}
                {type && <input type="hidden" name="type" value={type} />}
                {yearNum && <input type="hidden" name="year" value={String(yearNum)} />}
                <label htmlFor="auction-search" className="sr-only">Search auctions</label>
                <input id="auction-search" name="search" defaultValue={q} placeholder="Search auctions" className="vs-input flex-1 min-w-[180px] sm:!w-72 sm:flex-none" />
                <button type="submit" className="vs-btn">Search</button>
                {(q || type) && <Link href={listHref({ clear: true })} className="vs-link vs-link-sm vs-link-plain ml-1">Clear</Link>}
              </form>

              {showPast ? (
                <ResultsList search={q || undefined} page={page} year={yearNum ? String(yearNum) : undefined} />
              ) : rows.length === 0 ? (
                <div className="vs-card-flat px-6 py-16 text-center">
                  <p className="vs-lead text-[var(--vs-muted)]">
                    {q ? `No upcoming auctions match “${q}”.` : type ? `No upcoming ${type} auctions at the moment.` : "No upcoming auctions at the moment."}
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-2">
                    {(q || type) && <Link href="/auctions" className="vs-link vs-link-sm">See all upcoming</Link>}
                    <Link href="/auctions?tab=past" className="vs-link vs-link-sm">See past results</Link>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-[var(--vs-muted)] mb-4">
                    {rows.length.toLocaleString("en-GB")} upcoming {type ? `${type} ` : ""}{rows.length === 1 ? "auction" : "auctions"}{q ? ` matching “${q}”` : ""}
                  </p>
                  <div className="flex flex-col gap-4">
                    {rows.map(r => {
                      const live = !!r.hub?.isLive
                      return (
                        <SaleRow
                          key={r.key}
                          href={r.href}
                          title={r.title}
                          photo={r.photo}
                          date={r.date}
                          kicker={live ? <LiveKicker /> : r.lots > 0 ? "Catalogue now live" : "Coming soon"}
                          meta={r.meta}
                          addToCalendar
                          actions={r.hub ? (
                            <>
                              {live
                                ? <Link href={`/auctions/${r.hub.code}/live`} className="vs-btn vs-btn-red">Bid live now</Link>
                                : <RegisterToBidButton
                                    auctionId={r.hub.id}
                                    auctionName={r.title}
                                    isLoggedIn={isLoggedIn}
                                    alreadyRegistered={registeredAuctionIds.has(r.hub.id)}
                                  />}
                              <Link href={r.href} className="vs-btn vs-btn-outline">View catalogue &amp; bid</Link>
                            </>
                          ) : (
                            <>
                              {r.lots > 0 && <Link href={isLoggedIn ? r.href : "/portal/login"} className="vs-btn">Login to bid</Link>}
                              <Link href={r.href} className="vs-btn vs-btn-outline">{r.lots > 0 ? "View catalogue & bid" : "View sale"}</Link>
                            </>
                          )}
                        />
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
