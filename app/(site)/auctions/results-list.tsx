import Link from "next/link"
import type { ReactNode } from "react"
import { listResultSales } from "./results/data"
import { dateBox, londonYmd, saleDateLine } from "../site-dates"

// The "View Results" tab of the auction calendar: every sale that has happened, from the Hub's sale
// database (Databases → Sales), newest first, with the cover picture the website shows. Each one
// opens /auctions/results/[siteId] — its lots with photos, estimates and hammer prices. The row
// itself (SaleRow) is shared with the Upcoming tab, so both lists read the same way vectis.co.uk's do.

/** "Tuesday 13 October 2026 09:30" — the calendar's date line (vs-caps sets it in capitals). */
export function saleDateCaps(d: Date): string {
  const b = dateBox(d)
  const time = saleDateLine(d).match(/ (\d{2}:\d{2})$/)?.[1]
  return `${b.weekday} ${b.day} ${b.month} ${b.year}${time ? ` ${time}` : ""}`
}

// An .ics the browser can save straight from the link — Outlook, Apple and Google calendars all
// open it. Built on the server as a data: address, so the row needs no script of its own. A sale
// is an all-day event on its date, or eight hours from the time it starts when that is known.
function calendarLink(title: string, d: Date, href: string): { href: string; download: string } {
  const stamp = (x: Date) => x.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
  const allDay = !/ \d{2}:\d{2}$/.test(saleDateLine(d))
  const ymd = (x: Date) => londonYmd(x).replace(/-/g, "")
  // An all-day event ends on the NEXT day (the end is exclusive); 30 hours on lands there whichever
  // way the clocks went in between.
  const when = allDay
    ? `DTSTART;VALUE=DATE:${ymd(d)}\r\nDTEND;VALUE=DATE:${ymd(new Date(d.getTime() + 30 * 3600_000))}`
    : `DTSTART:${stamp(d)}\r\nDTEND:${stamp(new Date(d.getTime() + 8 * 3600_000))}`
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n")
  const uid = href.replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "")
  const text = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Vectis Auctions//Auction Calendar//EN", "BEGIN:VEVENT",
    `UID:${uid}@vectis.co.uk`, `DTSTAMP:${stamp(new Date())}`, when,
    `SUMMARY:${esc("Vectis Auctions: " + title)}`,
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n")
  return {
    href: `data:text/calendar;charset=utf-8,${encodeURIComponent(text)}`,
    download: `${title.replace(/[^\w\- ]+/g, "").trim() || "vectis-auction"}.ics`,
  }
}

const CalendarIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="1" /><path strokeLinecap="round" d="M8 3v4M16 3v4M3 10h18M12 13v6M9 16h6" /></svg>
)

/**
 * A calendar row as vectis.co.uk draws one: the square cover picture (shown whole on white — the
 * site's cover files are square), the kicker, the title, the date line, the buttons, and the date
 * box on the right with "Add to calendar" under it for a sale still to come. Below sm the picture
 * goes full width and the date box drops out — the date line already says the day.
 */
export function SaleRow({ href, title, photo, date, kicker, kickerNavy, meta, actions, addToCalendar }: {
  href: string
  title: string
  photo: string | null
  date: Date | null
  /** "Catalogue now live", "Coming soon", "Live now" (with its dot) — or "Auction archive" on View Results. */
  kicker: ReactNode
  /** The archive's kicker is navy; the rest are the site's red. */
  kickerNavy?: boolean
  /** "628 lots · Sale F120". */
  meta?: string
  actions?: ReactNode
  /** Offer the sale as an .ics — upcoming rows only. */
  addToCalendar?: boolean
}) {
  const box = date ? dateBox(date) : null
  const ics = addToCalendar && date ? calendarLink(title, date, href) : null
  return (
    <article className="vs-card-flat flex flex-col sm:flex-row">
      <Link href={href} className="block w-full aspect-square sm:aspect-auto sm:w-[220px] sm:h-[220px] shrink-0 bg-white overflow-hidden" aria-label={title}>
        {photo
          ? <img src={photo} alt="" loading="lazy" className="w-full h-full object-contain" />
          : <div className="w-full h-full bg-[var(--vs-bg)] flex items-center justify-center"><img src="/vectis-logo.svg" alt="" width={120} height={48} className="opacity-30" /></div>}
      </Link>

      <div className="flex-1 min-w-0 p-5 sm:p-6 flex flex-col">
        <p className={`vs-kicker mb-1${kickerNavy ? " vs-kicker-navy" : ""}`}>{kicker}</p>
        <h3 className="vs-h3 mb-2"><Link href={href} className="hover:underline">{title}</Link></h3>
        {date && <p className="vs-caps">{saleDateCaps(date)}</p>}
        {meta && <p className="text-sm text-[var(--vs-muted)] mt-1">{meta}</p>}
        {ics && (
          <a href={ics.href} download={ics.download} className="vs-link vs-link-sm vs-link-plain mt-2 self-start sm:hidden">
            <CalendarIcon />Add to calendar
          </a>
        )}
        {actions && <div className="mt-auto pt-5 flex flex-wrap gap-2">{actions}</div>}
      </div>

      {/* The .vs-date-box rule sets display:flex outside Tailwind's layers, so the breakpoint lives on a wrapper. */}
      {box && (
        <div className="hidden sm:flex shrink-0">
          <div className="vs-date-box">
            <span className="vs-date-month">{box.month}</span>
            <span className="vs-date-day">{box.day}</span>
            <span className="vs-date-weekday">{box.weekday}</span>
            {ics && (
              <a href={ics.href} download={ics.download} className="vs-link vs-link-sm vs-link-plain mt-4 text-center">
                <CalendarIcon />Add to calendar
              </a>
            )}
          </div>
        </div>
      )}
    </article>
  )
}

// The page numbers worth showing: the first, the last, and two either side of the current one,
// with a gap marked where numbers are left out.
function pageNumbers(current: number, total: number): (number | "gap")[] {
  const keep = [...new Set([1, total, current - 2, current - 1, current, current + 1, current + 2])]
    .filter(p => p >= 1 && p <= total)
    .sort((a, b) => a - b)
  const out: (number | "gap")[] = []
  let last = 0
  for (const p of keep) {
    if (p - last > 1) out.push("gap")
    out.push(p)
    last = p
  }
  return out
}

export default async function ResultsList({ search, page, year }: { search?: string; page?: string; year?: string }) {
  let data: Awaited<ReturnType<typeof listResultSales>>
  try {
    data = await listResultSales({ search, page: parseInt(page ?? "1", 10) || 1 })
  } catch (e) {
    // Say so plainly — a results tab that just reads "no past auctions" would hide a database that isn't there.
    return (
      <div className="vs-card-flat px-6 py-16 text-center">
        <p className="vs-lead text-[var(--vs-muted)]">Auction results aren&apos;t available here yet.</p>
        <p className="text-xs text-[var(--vs-muted)] mt-2">{String((e as { message?: string })?.message ?? "")}</p>
      </div>
    )
  }

  const listHref = (p: number) => {
    const sp = new URLSearchParams({ tab: "past" })
    if (search) sp.set("search", search)
    if (year) sp.set("year", year)
    if (p > 1) sp.set("page", String(p))
    return `/auctions?${sp.toString()}`
  }

  if (data.rows.length === 0) {
    return (
      <div className="vs-card-flat px-6 py-16 text-center">
        <p className="vs-lead text-[var(--vs-muted)]">
          {search ? `No past auctions match “${search}”.` : "No past auctions found."}
        </p>
        {search && <Link href={year ? `/auctions?tab=past&year=${encodeURIComponent(year)}` : "/auctions?tab=past"} className="vs-link vs-link-sm mt-4">See all results</Link>}
      </div>
    )
  }

  return (
    <>
      <p className="text-sm text-[var(--vs-muted)] mb-4">
        {data.total.toLocaleString("en-GB")} past {data.total === 1 ? "auction" : "auctions"}{search ? ` matching “${search}”` : ""}
        {data.pages > 1 && ` · page ${data.page} of ${data.pages}`}
      </p>

      <div className="flex flex-col gap-4">
        {data.rows.map(sale => {
          const href = `/auctions/results/${sale.siteId}`
          const lots = sale.lotCount > 0 ? `${sale.lotCount.toLocaleString("en-GB")} lots` : "Results not in yet"
          return (
            <SaleRow
              key={sale.siteId}
              href={href}
              title={sale.title}
              photo={sale.photo}
              date={sale.saleDate}
              kicker="Auction archive"
              kickerNavy
              meta={sale.code ? `${lots} · Sale ${sale.code}` : lots}
              actions={<Link href={href} className="vs-btn vs-btn-outline">View results</Link>}
            />
          )
        })}
      </div>

      {data.pages > 1 && (
        <nav className="vs-pages mt-8" aria-label="Results pages">
          {data.page > 1 && <Link href={listHref(data.page - 1)} className="vs-page-link" aria-label="Previous page">‹</Link>}
          {pageNumbers(data.page, data.pages).map((p, i) =>
            p === "gap"
              ? <span key={`gap-${i}`} className="px-1 text-[var(--vs-muted)]" aria-hidden="true">…</span>
              : <Link key={p} href={listHref(p)} className="vs-page-link" aria-current={p === data.page ? "page" : undefined}>{p}</Link>
          )}
          {data.page < data.pages && <Link href={listHref(data.page + 1)} className="vs-page-link" aria-label="Next page">›</Link>}
        </nav>
      )}
    </>
  )
}
