import type { PersonDay, PersonTotals, ReportRange } from "@/lib/goods-in/reports"
import { csvCell } from "@/lib/goods-in/location-codes"

// Goods In → Reports: the two spreadsheets, made in the browser from what the page already shows
// (nothing is fetched again). The Locations exports' rules: every cell through csvCell (a name
// starting = + - @ can't run as a formula), a byte-order mark so Excel reads accents and £ properly,
// Windows line endings. Days are London days (YYYY-MM-DD, as the report buckets them) and times are
// London time.

/** The UTF-8 byte-order mark, written as an escape so it can be seen in review and no editor strips it. */
const BOM = "﻿"
const toCsv = (lines: unknown[][]) => BOM + lines.map(cells => cells.map(csvCell).join(",")).join("\r\n") + "\r\n"

const LONDON_DT = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
const LONDON_T = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })

/** "2026-10-20 08:12" in London time. */
function londonDateTime(iso: string | null): string {
  if (!iso) return ""
  const p = LONDON_DT.formatToParts(new Date(iso))
  const g = (t: Intl.DateTimeFormatPartTypes) => p.find(x => x.type === t)?.value ?? ""
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}`
}
const londonClock = (iso: string | null) => (iso ? LONDON_T.format(new Date(iso)) : "")
const hourWords = (h: number | null) => (h == null ? "" : `${String(h).padStart(2, "0")}:00-${String((h + 1) % 24).padStart(2, "0")}:00`)

// "Failed scans acknowledged" = failed scans the person saw on the scanner's pop-up and confirmed
// seen, counted on the day they confirmed it (London) — so a day's figure can include a scan made
// the day before.
const COUNT_HEAD = ["Moves", "Put away", "To bench", "Lots shelved", "Moved in bulk", "Scans", "Refused", "Overtaken", "Sent late", "Failed scans acknowledged", "Check-ins", "Totes booked", "Pallets booked"]
const counts = (c: PersonTotals | PersonDay) => [c.moves, c.putAway, c.toBench, c.lotsShelved, c.bulk, c.scans, c.refused, c.stale, c.late, c.acks, c.checkIns, c.totesBooked, c.palletsBooked]

/** A total per day active, to one decimal place ("" with no days) — the table's "a day" columns. */
export const perDay = (total: number, activeDays: number): number | null =>
  activeDays > 0 ? Math.round((total / activeDays) * 10) / 10 : null

/** One line per person for the range. */
export function peopleCsv(people: PersonTotals[], range: ReportRange): string {
  return toCsv([
    ["From", "To", "Person", "Days active", ...COUNT_HEAD, "Moves a day", "Scans a day", "First activity", "Last activity", "Busiest hour", "Scanners used"],
    ...people.map(p => [
      range.from, range.to, p.name, p.activeDays, ...counts(p),
      perDay(p.moves, p.activeDays) ?? "", perDay(p.scans, p.activeDays) ?? "",
      londonDateTime(p.firstAt), londonDateTime(p.lastAt), hourWords(p.busiestHour), p.scanners,
    ]),
  ])
}

/** One line per person per day they did anything. */
export function daysCsv(days: PersonDay[], names: Map<string, string>): string {
  const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day) || (names.get(a.userId) ?? "").localeCompare(names.get(b.userId) ?? ""))
  return toCsv([
    ["Day", "Person", ...COUNT_HEAD, "First", "Last"],
    ...sorted.map(d => [d.day, names.get(d.userId) ?? "Unknown", ...counts(d), londonClock(d.firstAt), londonClock(d.lastAt)]),
  ])
}

/** Save text as a CSV file in the browser (a Blob — nothing goes to the server). */
export function downloadCsv(csv: string, name: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** goods-in-report-people-2026-10-14-to-2026-10-20.csv, or …-2026-10-20.csv for one day. */
export function fileName(kind: string, range: ReportRange, who?: string) {
  const span = range.from === range.to ? range.from : `${range.from}-to-${range.to}`
  const person = who ? `-${who.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}` : ""
  return `goods-in-report-${kind}${person}-${span}.csv`
}
