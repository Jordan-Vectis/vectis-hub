"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { saleDateLine, londonYmd } from "./site-dates"

// The home page's "Upcoming Auctions" row, as vectis.co.uk shows it: a heading with an arrow either
// side, "SEE FULL CALENDAR ›" under it, then the sales as cards you scroll sideways through — the
// picture, CATALOGUE NOW LIVE, the title, the date, Add to calendar, and LOGIN TO BID / VIEW LOTS.
// No carousel library: a snap-scrolling row and two buttons that scroll it by one card, which also
// means a finger swipe just works on the iPads and nothing breaks when scripts are slow.

export type UpcomingCard = {
  key: string
  title: string
  /** ISO — the server's Date, formatted here in Europe/London. */
  dateIso: string | null
  photo: string | null
  /** The sale's lots on the test site. */
  href: string
  lots: number
  /** "live" = the catalogue is published; "soon" = listed, lots not in yet. */
  status: "live" | "soon"
}

// An .ics file made in the browser — Outlook, Apple and Google calendars all open it. A sale is
// an all-day event on its date (or the hour it starts, when the time is known).
function calendarFile(c: UpcomingCard): string {
  const d = c.dateIso ? new Date(c.dateIso) : null
  if (!d) return ""
  const stamp = (x: Date) => x.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
  const allDay = d.getUTCHours() === 0 && d.getUTCMinutes() === 0
  const ymd = londonYmd(d).replace(/-/g, "")
  const when = allDay
    ? `DTSTART;VALUE=DATE:${ymd}\r\nDTEND;VALUE=DATE:${ymd}`
    : `DTSTART:${stamp(d)}\r\nDTEND:${stamp(new Date(d.getTime() + 8 * 3600_000))}`
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n")
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Vectis Auctions//Auction Calendar//EN", "BEGIN:VEVENT",
    `UID:${c.key}@vectis.co.uk`, `DTSTAMP:${stamp(new Date())}`, when,
    `SUMMARY:${esc("Vectis Auctions: " + c.title)}`, `URL:${typeof location !== "undefined" ? location.origin : ""}${c.href}`,
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n")
}

export default function UpcomingCarousel({ cards, heading = "Upcoming Auctions", kicker = "", loggedIn }: { cards: UpcomingCard[]; heading?: string; kicker?: string; loggedIn: boolean }) {
  const track = useRef<HTMLDivElement>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(false)

  const measure = useCallback(() => {
    const el = track.current
    if (!el) return
    setAtStart(el.scrollLeft <= 2)
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2)
  }, [])
  useEffect(() => {
    measure()
    const el = track.current
    if (!el) return
    el.addEventListener("scroll", measure, { passive: true })
    window.addEventListener("resize", measure)
    return () => { el.removeEventListener("scroll", measure); window.removeEventListener("resize", measure) }
  }, [measure, cards.length])

  const step = (dir: 1 | -1) => {
    const el = track.current
    if (!el) return
    const first = el.firstElementChild as HTMLElement | null
    const by = first ? first.getBoundingClientRect().width + 24 : el.clientWidth * 0.8
    el.scrollBy({ left: dir * by, behavior: "smooth" })
  }

  const addToCalendar = (c: UpcomingCard) => {
    const text = calendarFile(c)
    if (!text) return
    const url = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `${c.title.replace(/[^\w\- ]+/g, "").trim() || "vectis-auction"}.ics`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  const many = cards.length > 1
  return (
    <div>
      <div className="relative text-center mb-2">
        {kicker && <p className="vs-kicker mb-1">{kicker}</p>}
        <h2 className="vs-h2 mx-14">{heading}</h2>
        {many && (
          <>
            <button type="button" onClick={() => step(-1)} disabled={atStart} aria-label="Previous auctions" className="vs-arrow absolute left-0 top-1/2 -translate-y-1/2 !border-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <button type="button" onClick={() => step(1)} disabled={atEnd} aria-label="More auctions" className="vs-arrow absolute right-0 top-1/2 -translate-y-1/2 !border-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </button>
          </>
        )}
      </div>
      <p className="text-center mb-8"><Link href="/auctions" className="vs-link">See full calendar</Link></p>

      <div ref={track} className="vs-scroll-x gap-6 pb-2 -mx-1 px-1" role="list" aria-label="Upcoming auctions">
        {cards.map(c => {
          const d = c.dateIso ? new Date(c.dateIso) : null
          return (
            <article key={c.key} role="listitem" className="w-[280px] sm:w-[300px] lg:w-[calc((100%-72px)/4)] flex flex-col">
              <Link href={c.href} className="block bg-white aspect-square overflow-hidden" aria-label={c.title}>
                {c.photo
                  ? <img src={c.photo} alt="" loading="lazy" className="w-full h-full object-cover" />
                  : <div className="w-full h-full bg-[var(--vs-bg)] flex items-center justify-center"><img src="/vectis-logo.svg" alt="" width={120} height={48} className="opacity-30" /></div>}
              </Link>
              <div className="mt-4 flex flex-col flex-1">
                <p className="vs-kicker mb-1">{c.status === "live" ? "Catalogue now live" : "Coming soon"}</p>
                <h3 className="vs-h4 text-[22px] leading-tight mb-2"><Link href={c.href} className="hover:underline">{c.title}</Link></h3>
                {d && <p className="text-base">{saleDateLine(d)}</p>}
                {d && (
                  <button type="button" onClick={() => addToCalendar(c)} className="vs-link vs-link-sm vs-link-plain mt-1 self-start gap-2">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="1" /><path strokeLinecap="round" d="M8 3v4M16 3v4M3 10h18M12 13v6M9 16h6" /></svg>
                    Add to calendar
                  </button>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  {c.status === "live" && (
                    <Link href={loggedIn ? c.href : "/portal/login"} className="vs-btn">Login to bid</Link>
                  )}
                  <Link href={c.href} className="vs-btn">{c.status === "live" ? "View lots" : "View sale"}</Link>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
