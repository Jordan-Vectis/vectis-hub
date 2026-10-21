import Link from "next/link"
import Form from "next/form"
import type { ReactNode } from "react"
import { REPORT_DEFINITIONS, REPORT_RANGES, rangeDays, type ReportRange, type ReportSource } from "@/lib/goods-in/reports"
import { box, btnGo, input, label, mono } from "../_components/ui"
import { londonYmd } from "../history/london-days"

// Goods In → Reports: the pieces both report screens share — the range picker, the tiles, the
// hour-of-day strip, the "What the numbers mean" fold-out and the London-time formatting.
// Server-safe (no hooks). The range always lives in the URL (?range=7d, or
// ?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD), so a view can be bookmarked or sent on, and Back works.

export const REPORTS_PATH = "/tools/warehouse/reports"

/** The query string that reopens this range. */
export function rangeQuery(range: Pick<ReportRange, "key" | "from" | "to">): string {
  const q = new URLSearchParams()
  q.set("range", range.key)
  if (range.key === "custom") { q.set("from", range.from); q.set("to", range.to) }
  return q.toString()
}

export const personHref = (userId: string, range: Pick<ReportRange, "key" | "from" | "to">) =>
  `${REPORTS_PATH}/${encodeURIComponent(userId)}?${rangeQuery(range)}`

/** One value from a search param (the first, when it's given twice). */
export const oneParam = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? undefined

// ─── Words and numbers ────────────────────────────────────────────────────────────────────

export const num = (n: number | null | undefined) => (n ?? 0).toLocaleString("en-GB")
export const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`

const ymdDate = (ymd: string) => new Date(`${ymd}T12:00:00Z`) // midday UTC: the same calendar day everywhere

/** "Mon 20 Oct" — a London day (YYYY-MM-DD) as people read it. */
export const dayShort = (ymd: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(ymdDate(ymd))

/** "Monday 20 October 2026". */
export const dayLong = (ymd: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(ymdDate(ymd))

/** "20 Oct 2026". */
export const dayMedium = (ymd: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(ymdDate(ymd))

/** "08:12" in London time, or a dash. */
export const londonTime = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)) : "—"

/** "08:12:05" in London time, to the second, or a dash. */
export const londonSeconds = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(iso)) : "—"

/** 14 → "14:00–15:00". */
export const hourSpan = (h: number | null | undefined) =>
  h == null ? "—" : `${String(h).padStart(2, "0")}:00–${String((h + 1) % 24).padStart(2, "0")}:00`

/** The range in words: "Monday 20 October 2026", or "13 Oct 2026 – 20 Oct 2026". */
export const rangeWords = (range: Pick<ReportRange, "from" | "to">) =>
  range.from === range.to ? dayLong(range.from) : `${dayMedium(range.from)} – ${dayMedium(range.to)}`

export const isOneDay = (range: Pick<ReportRange, "from" | "to">) => range.from === range.to

// ─── The range picker ─────────────────────────────────────────────────────────────────────

/** The preset buttons and a From/To pair. Everything is a link or a GET form, so the URL is the view. */
export function RangeBar({ path, range }: { path: string; range: ReportRange }) {
  const today = londonYmd()
  return (
    <section className={`${box} p-3 sm:p-4`} aria-label="Pick the days to show">
      <div className="flex flex-col xl:flex-row xl:items-end gap-3">
        <nav aria-label="Quick ranges" className="flex flex-wrap gap-1.5">
          {REPORT_RANGES.map(r => {
            const on = range.key === r.key
            return (
              <Link
                key={r.key}
                href={`${path}?${rangeQuery({ key: r.key, from: "", to: "" })}`}
                aria-current={on ? "page" : undefined}
                className={`inline-flex items-center min-h-11 px-3.5 rounded-lg text-sm font-semibold border transition-colors whitespace-nowrap ${
                  on
                    ? "bg-indigo-600 border-indigo-600 text-white"
                    : "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                {r.label}
              </Link>
            )
          })}
        </nav>
        <Form action={path} className="flex flex-wrap items-end gap-2 xl:ml-auto">
          <input type="hidden" name="range" value="custom" />
          <div>
            <label htmlFor="rep-from" className={label}>From</label>
            <input id="rep-from" name="from" type="date" required defaultValue={range.from} max={today} className={`${input} !w-auto dark:[color-scheme:dark]`} />
          </div>
          <div>
            <label htmlFor="rep-to" className={label}>To</label>
            <input id="rep-to" name="to" type="date" required defaultValue={range.to} max={today} className={`${input} !w-auto dark:[color-scheme:dark]`} />
          </div>
          <button type="submit" className={`${btnGo} ${range.key === "custom" ? "ring-2 ring-offset-2 ring-indigo-500 ring-offset-white dark:ring-offset-gray-900" : ""}`}>Show these days</button>
        </Form>
      </div>
      <p className="mt-2.5 text-sm text-gray-600 dark:text-gray-300" role="status">
        Showing <b>{rangeWords(range)}</b>{range.key !== "custom" && <span className="text-gray-500 dark:text-gray-400"> ({range.label})</span>}. Days and times are UK time.
      </p>
    </section>
  )
}

// ─── Tiles ────────────────────────────────────────────────────────────────────────────────

export type TileSpec = { label: string; value: ReactNode; sub?: ReactNode }

export function Tiles({ tiles }: { tiles: TileSpec[] }) {
  return (
    // Ten tiles: two rows of five from an upright iPad (md) up — never 3 + 3 + 3 + 1.
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {tiles.map(t => (
        <div key={t.label} className={`${box} min-w-0 px-4 py-3.5`}>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">{t.label}</p>
          {/* Five across is ~135px a tile from md to xl (the sidebar arrives at lg), so the big size waits for xl. */}
          <p className="mt-1 text-2xl sm:text-3xl md:text-2xl xl:text-3xl font-bold text-gray-900 dark:text-white tabular-nums">{t.value}</p>
          {t.sub && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 leading-snug">{t.sub}</p>}
        </div>
      ))}
    </div>
  )
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <h2 className="text-sm font-bold text-gray-700 dark:text-gray-200">{children}</h2>
      {aside}
    </div>
  )
}

// ─── When in the day ──────────────────────────────────────────────────────────────────────

// Sequential, one hue (indigo), lighter → darker = fewer → more. Each square also prints its number,
// so the colour is never the only way to read it; the key underneath says what the shades mean.
const SHADES = [
  "bg-gray-100 text-gray-500 dark:bg-gray-800/60 dark:text-gray-400",
  "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-100",
  "bg-indigo-200 text-indigo-950 dark:bg-indigo-900 dark:text-indigo-50",
  "bg-indigo-400 text-white dark:bg-indigo-700 dark:text-white",
  "bg-indigo-600 text-white dark:bg-indigo-500 dark:text-white",
]

/** The hour-of-day strip: one square per hour (UK time), the number of moves, scans and check-ins in it. */
export function HourStrip({ hours, empty }: { hours: { hour: number; count: number }[]; empty: ReactNode }) {
  const byHour = new Map<number, number>()
  for (const h of hours) byHour.set(h.hour, (byHour.get(h.hour) ?? 0) + h.count)
  const used = [...byHour.entries()].filter(([, c]) => c > 0).map(([h]) => h)
  if (used.length === 0) return <p className="text-sm text-gray-500 dark:text-gray-400">{empty}</p>
  // The working day, widened to take in anything earlier or later.
  const start = Math.min(7, ...used)
  const end = Math.max(18, ...used)
  const max = Math.max(...byHour.values())
  const shade = (c: number) => (c <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((c / max) * 4))))
  const cells = Array.from({ length: end - start + 1 }, (_, i) => start + i)
  const busiest = [...byHour.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
  return (
    <div>
      <div className="overflow-x-auto overscroll-x-contain pb-1">
        <ol className="flex gap-1 min-w-max" aria-label="Activity by hour of the day, UK time">
          {cells.map(h => {
            const c = byHour.get(h) ?? 0
            return (
              <li key={h} className="flex flex-col items-center gap-1 w-11 shrink-0">
                <span
                  title={`${hourSpan(h)}: ${num(c)}`}
                  className={`flex items-center justify-center w-11 h-11 rounded-md text-xs font-semibold tabular-nums ${SHADES[shade(c)]}`}
                >
                  <span aria-hidden>{c > 0 ? (c >= 10_000 ? `${Math.round(c / 1000)}k` : num(c)) : ""}</span>
                  <span className="sr-only">{hourSpan(h)}: {num(c)}</span>
                </span>
                <span aria-hidden className={`text-[11px] text-gray-500 dark:text-gray-400 ${mono}`}>{String(h).padStart(2, "0")}</span>
              </li>
            )
          })}
        </ol>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-500 dark:text-gray-400">
        <span>Each square is an hour of the day (UK time — 08 is 08:00–09:00); the number is how many moves, scans and check-ins were recorded in it over these days. A scan that moved something counts once, as its move.</span>
        <span className="inline-flex items-center gap-1.5" aria-hidden>
          Fewer
          {SHADES.slice(1).map((s, i) => <span key={i} className={`inline-block w-4 h-4 rounded ${s}`} />)}
          More
        </span>
        {busiest && <span>Busiest: <b className="text-gray-700 dark:text-gray-200">{hourSpan(busiest[0])}</b></span>}
      </div>
    </div>
  )
}

// ─── What the numbers mean ────────────────────────────────────────────────────────────────

/**
 * The fold-out. Its words are lib/goods-in/reports.ts's own REPORT_DEFINITIONS, next to the SQL that
 * does the counting, so what the page says and what is counted can't drift apart.
 */
export function Definitions({ ownOnly }: { ownOnly: boolean }) {
  return (
    <details className={`${box} group`}>
      <summary className="flex items-center justify-between gap-3 min-h-11 px-4 py-2 cursor-pointer select-none text-sm font-semibold text-gray-700 dark:text-gray-200 [&::-webkit-details-marker]:hidden">
        What the numbers mean
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-4 h-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
      </summary>
      <div className="px-4 pb-4 pt-1 text-sm text-gray-600 dark:text-gray-300 leading-relaxed space-y-3 max-w-4xl">
        <p>Everything here is counted from what Goods In already records — nothing is typed in for the report, and nothing done in Business Central is counted.</p>
        <dl className="grid sm:grid-cols-[minmax(0,12rem)_1fr] gap-x-4 gap-y-2">
          {REPORT_DEFINITIONS.map(d => (
            <div key={d.term} className="contents">
              <dt className="font-semibold text-gray-800 dark:text-gray-100">{d.term}</dt>
              <dd>{d.meaning}</dd>
            </div>
          ))}
        </dl>
        <p>
          {ownOnly
            ? "You see your own figures only. Warehouse managers and admins see everyone's."
            : "Warehouse managers and admins see everyone. Warehouse staff see their own figures only."}
        </p>
      </div>
    </details>
  )
}

/**
 * The empty state's "look further back" link — only to a range LONGER than the one that had
 * nothing (the last 30 days, else the last year), never to one it already covered; nothing at all
 * past a year.
 */
export function WiderRangeLink({ path, range }: { path: string; range: ReportRange }) {
  const days = rangeDays(range).length
  const to = days < 30 ? { key: "30d" as const, words: "Look at the last 30 days" }
    : days < 365 && range.key !== "1y" ? { key: "1y" as const, words: "Look at the last year" }
      : null
  if (!to) return null
  return (
    <p className="mt-3">
      <Link href={`${path}?${rangeQuery({ key: to.key, from: "", to: "" })}`} className="underline text-indigo-700 dark:text-indigo-300 inline-flex items-center min-h-11">{to.words}</Link>
    </p>
  )
}

/** Said plainly when a source's table isn't on this environment yet (before Run Migrations), so a 0 isn't read as "nobody did any". */
export function MissingNote({ missing }: { missing?: ReportSource[] }) {
  if (!missing?.length) return null
  const words: Record<ReportSource, string> = { scans: "handheld scans", moves: "moves", "check-ins": "check-ins", acks: "failed scans acknowledged on the scanner" }
  const list = missing.map(m => words[m] ?? m)
  const said = list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`
  return (
    <p role="status" className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 px-4 py-3 text-sm">
      The record of {said} isn&apos;t set up on this environment yet, so {list.length === 1 ? "it shows" : "they show"} as 0 here. An admin presses <b>Run Migrations</b> (the banner at the top of the Hub) to set it up.
    </p>
  )
}
