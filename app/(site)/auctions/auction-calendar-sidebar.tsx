"use client"

import { useState } from "react"
import Link from "next/link"
import { londonYmd } from "../site-dates"

// The mini month calendar beside the auction list, as vectis.co.uk draws it: a day with a sale is
// a filled navy circle that opens the sale, today is outlined, the arrows step a month at a time.
// Under it, on Upcoming only, the Hub's sale types as a list of filters. Dates are placed on the
// London calendar day whatever the visitor's own timezone, so a 09:30 sale never lands on the
// evening before for someone abroad.

interface AuctionEntry {
  date: string   // ISO date string
  href: string   // where that day links to (a Hub sale's catalogue, or a past sale's results)
}

interface Props {
  auctionEntries: AuctionEntry[]
  auctionTypes: string[]
  selectedType: string
  /** The year strip's choice on View Results — the calendar opens on that year's newest sale. */
  year?: number
}

const DAYS   = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
const MONTHS = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"]

// "2026-10-15" → [2026, 9, 15] — the pieces londonYmd gives, as numbers, month zero-based.
const ymdParts = (ymd: string): [number, number, number] => {
  const [y, m, d] = ymd.split("-").map(Number)
  return [y, m - 1, d]
}

export default function AuctionCalendarSidebar({ auctionEntries, auctionTypes, selectedType, year: pickedYear }: Props) {
  const [todayYear, todayMonth, todayDay] = ymdParts(londonYmd(new Date()))

  // "year-month-day" (London) → the first sale on that day.
  const auctionDateMap = new Map<string, string>()
  for (const entry of auctionEntries) {
    const [y, m, d] = ymdParts(londonYmd(new Date(entry.date)))
    const key = `${y}-${m}-${d}`
    if (!auctionDateMap.has(key)) auctionDateMap.set(key, entry.href)
  }

  // Where to open: today's month, or — when a year was picked on the strip — that year's newest
  // sale month, so the first thing seen is a month with something in it.
  const openOn = (): [number, number] => {
    if (!pickedYear) return [todayYear, todayMonth]
    let best = -1
    for (const key of auctionDateMap.keys()) {
      const [y, m] = key.split("-").map(Number)
      if (y === pickedYear && m > best) best = m
    }
    if (best >= 0) return [pickedYear, best]
    return [pickedYear, pickedYear === todayYear ? todayMonth : 11]
  }
  const [initialYear, initialMonth] = openOn()
  const [year,  setYear]  = useState(initialYear)
  const [month, setMonth] = useState(initialMonth)

  // Monday first, as a British calendar reads.
  const firstDay    = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  const isToday = (d: number) => d === todayDay && month === todayMonth && year === todayYear
  const saleHref = (d: number) => auctionDateMap.get(`${year}-${month}-${d}`) ?? null

  const Arrow = ({ dir }: { dir: "left" | "right" }) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={dir === "left" ? "M15 19l-7-7 7-7" : "M9 5l7 7-7 7"} />
    </svg>
  )

  return (
    <aside className="w-full max-w-[360px] mx-auto lg:mx-0 lg:max-w-none" aria-label="Auction calendar">
      <div className="vs-card-flat">
        {/* Month nav */}
        <div className="flex items-center justify-between gap-2 p-2 border-b border-[var(--vs-line)]">
          <button type="button" onClick={prevMonth} aria-label="Previous month" className="vs-arrow !border-0">
            <Arrow dir="left" />
          </button>
          <p className="vs-caps text-[var(--vs-navy)] text-center" aria-live="polite">
            {MONTHS[month]} {year}
          </p>
          <button type="button" onClick={nextMonth} aria-label="Next month" className="vs-arrow !border-0">
            <Arrow dir="right" />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 px-2 pt-3" aria-hidden="true">
          {DAYS.map(d => (
            <div key={d} className="text-center text-xs text-[var(--vs-muted)] py-1">{d}</div>
          ))}
        </div>

        {/* Day cells — each one fills its column so the whole square is the target, the circle inside it the mark. */}
        <div className="grid grid-cols-7 px-2 pb-3 gap-y-1">
          {cells.map((d, i) => {
            if (!d) return <div key={`e-${i}`} />
            const href  = saleHref(d)
            const today = isToday(d)

            if (href) {
              return (
                <Link
                  key={d}
                  href={href}
                  title={today ? "Today's auction" : "View this auction"}
                  aria-label={`${d} ${MONTHS[month]}: view this auction`}
                  className="flex items-center justify-center aspect-square group"
                >
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium bg-[var(--vs-navy)] text-white group-hover:bg-[var(--vs-navy-dark)] transition-colors ${today ? "ring-2 ring-[var(--vs-navy)] ring-offset-2 ring-offset-white" : ""}`}>
                    {d}
                  </span>
                </Link>
              )
            }

            return (
              <div key={d} className="flex items-center justify-center aspect-square" aria-current={today ? "date" : undefined}>
                <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${today ? "border border-[var(--vs-navy)] text-[var(--vs-navy)] font-medium" : "text-[var(--vs-ink)]"}`}>
                  {d}
                </span>
              </div>
            )
          })}
        </div>

        {/* The key — a filled day means something, so say what. */}
        <ul className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2.5 border-t border-[var(--vs-line)] text-xs text-[var(--vs-muted)]">
          <li className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[var(--vs-navy)]" aria-hidden="true" />Auction day</li>
          <li className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full border border-[var(--vs-navy)]" aria-hidden="true" />Today</li>
        </ul>
      </div>

      {/* Categories — the Hub's sale types; only offered when there are some to pick from. */}
      {auctionTypes.length > 0 && (
        <nav className="vs-card-flat mt-4" aria-label="Categories">
          <p className="vs-caps text-[var(--vs-navy)] px-4 py-3 border-b border-[var(--vs-line)]">Categories</p>
          <ul className="py-1">
            {[{ label: "All auctions", value: "" }, ...auctionTypes.map(t => ({ label: t, value: t }))].map(c => {
              const active = selectedType === c.value
              return (
                <li key={c.value || "all"}>
                  <Link
                    href={c.value ? `/auctions?type=${encodeURIComponent(c.value)}` : "/auctions"}
                    aria-current={active ? "true" : undefined}
                    className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:text-[var(--vs-navy)] ${active ? "text-[var(--vs-navy)] font-semibold" : "text-[var(--vs-ink)]"}`}
                  >
                    <span className={`w-3 h-3 rounded-full border border-[var(--vs-navy)] shrink-0 ${active ? "bg-[var(--vs-navy)]" : ""}`} aria-hidden="true" />
                    {c.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      )}
    </aside>
  )
}
