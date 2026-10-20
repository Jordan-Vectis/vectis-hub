"use client"

import { useState, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import type { PersonDay, PersonTotals, ReportRange } from "@/lib/goods-in/reports"
import { btn } from "../_components/ui"
import { daysCsv, downloadCsv, fileName, peopleCsv } from "./export"

// Goods In → Reports: the charts (Recharts, like the cataloguers' Reports) and the CSV buttons.
//
// Colours: the three measures keep ONE colour each everywhere — Moves indigo (Goods In's own
// colour), Scans orange, Check-ins aqua — stepped separately for the light and dark surfaces and
// checked for colour-blind separation. Every chart has a written legend or title, the values are in
// the tooltip, and each chart has the same figures as a table (the tables on the page, or "Show
// these figures as a table"), so nothing is read by colour alone. Dark is the Hub's default; the
// charts follow the page's own switch (the `dark` class on <html>), not the computer's setting.

export type Measure = "moves" | "scans" | "checkIns"

const SERIES: { key: Measure; label: string; light: string; dark: string }[] = [
  { key: "moves", label: "Moves", light: "#4f46e5", dark: "#6366f1" },
  { key: "scans", label: "Scans", light: "#eb6834", dark: "#d95926" },
  { key: "checkIns", label: "Check-ins", light: "#1baf7a", dark: "#199e70" },
]

function subscribe(onChange: () => void) {
  const mo = new MutationObserver(onChange)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
  return () => mo.disconnect()
}
/** True while the Hub is showing dark (the default — so the server's first render assumes dark). */
function useDark() {
  return useSyncExternalStore(subscribe, () => document.documentElement.classList.contains("dark"), () => true)
}

function useTheme() {
  const dark = useDark()
  return {
    dark,
    surface: dark ? "#111827" : "#ffffff",
    grid: dark ? "#1f2937" : "#e5e7eb",
    tick: dark ? "#9ca3af" : "#6b7280",
    ink: dark ? "#e5e7eb" : "#374151",
    cursor: dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
    colour: (m: Measure) => { const s = SERIES.find(x => x.key === m)!; return dark ? s.dark : s.light },
  }
}

const compact = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n))
const num = (n: number) => n.toLocaleString("en-GB")

function Swatch({ colour }: { colour: string }) {
  return <span aria-hidden className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ background: colour }} />
}

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: number; colour: string }[] }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 shadow-lg text-sm">
      <p className="font-semibold text-gray-900 dark:text-white mb-1">{title}</p>
      {rows.map(r => (
        <p key={r.label} className="flex items-center gap-2 text-gray-700 dark:text-gray-200">
          <Swatch colour={r.colour} />
          <span>{r.label}</span>
          <span className="ml-auto pl-4 font-semibold tabular-nums">{num(r.value)}</span>
        </p>
      ))}
    </div>
  )
}

// ─── Per day (or per week / month) — moves, scans and check-ins side by side ───────────────
//
// ⚠ Side by side, NEVER stacked: every scan that moved something is also a move (the scanner writes
// its own GoodsInMovement), so stacking Scans on Moves would count each scanner move twice and make
// a day on the handheld look twice as busy as the same work on Scan to move.

export type DayPoint = { key: string; label: string; title: string; moves: number; scans: number; checkIns: number }

const UNIT_HEAD = { day: "Day", week: "Week", month: "Month" } as const

export function DailyChart({ points, caption, unit }: { points: DayPoint[]; caption: string; unit: keyof typeof UNIT_HEAD }) {
  const t = useTheme()
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-600 dark:text-gray-300" aria-label="Key">
        {SERIES.map(s => (
          <span key={s.key} className="inline-flex items-center gap-1.5"><Swatch colour={t.colour(s.key)} />{s.label}</span>
        ))}
        <span className="text-gray-500 dark:text-gray-400">{caption}. A scan that moved something is in Scans and in Moves, so the bars stand side by side, not added together.</span>
      </div>
      <div className="h-64 sm:h-72" role="img" aria-label={`Moves, scans and check-ins ${caption.toLowerCase()}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="16%" barGap={1}>
            <CartesianGrid vertical={false} stroke={t.grid} />
            <XAxis dataKey="label" tick={{ fill: t.tick, fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={12} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} tick={{ fill: t.tick, fontSize: 12 }} axisLine={false} tickLine={false} width={40} tickFormatter={compact} />
            <Tooltip
              cursor={{ fill: t.cursor }}
              content={p => {
                const d = p.active ? (p.payload?.[0]?.payload as DayPoint | undefined) : undefined
                if (!d) return null
                return <TooltipBox title={d.title} rows={SERIES.map(s => ({ label: s.label, value: d[s.key], colour: t.colour(s.key) }))} />
              }}
            />
            {SERIES.map(s => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={t.colour(s.key)}
                maxBarSize={18}
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-3 group">
        <summary className="inline-flex items-center min-h-11 cursor-pointer select-none text-sm text-indigo-700 dark:text-indigo-300 hover:underline [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">Show these figures as a table</span>
          <span className="hidden group-open:inline">Hide the table</span>
        </summary>
        <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-gray-200 dark:border-gray-800">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">{UNIT_HEAD[unit]}</th>
                {SERIES.map(s => <th key={s.key} className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">{s.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {[...points].reverse().map(d => (
                <tr key={d.key}>
                  <td className="px-3 py-1.5 text-gray-800 dark:text-gray-200 whitespace-nowrap">{d.title}</td>
                  {SERIES.map(s => <td key={s.key} className="px-3 py-1.5 text-right tabular-nums text-gray-800 dark:text-gray-200">{num(d[s.key])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

// ─── Per person — one measure at a time ────────────────────────────────────────────────────

type PersonBar = { userId: string; name: string; short: string; value: number; href: string }

const shortName = (s: string) => (s.length > 20 ? `${s.slice(0, 19)}…` : s)

export function PersonBars({ people, hrefs }: { people: Pick<PersonTotals, "userId" | "name" | "moves" | "scans" | "checkIns">[]; hrefs: Record<string, string> }) {
  const t = useTheme()
  const router = useRouter()
  const anyScans = people.some(p => p.scans > 0)
  const [measure, setMeasure] = useState<Measure>(anyScans ? "scans" : "moves")
  const series = SERIES.find(s => s.key === measure)!
  const data: PersonBar[] = people
    .filter(p => p[measure] > 0)
    .sort((a, b) => b[measure] - a[measure] || a.name.localeCompare(b.name))
    .map(p => ({ userId: p.userId, name: p.name, short: shortName(p.name), value: p[measure], href: hrefs[p.userId] }))
  const left = people.length - data.length

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-700 p-1 gap-1" role="group" aria-label="Which figure to compare">
          {SERIES.map(s => (
            <button
              key={s.key}
              type="button"
              onClick={() => setMeasure(s.key)}
              aria-pressed={measure === s.key}
              className={`min-h-11 px-4 rounded-md text-sm font-semibold transition-colors ${
                measure === s.key
                  ? "bg-indigo-600 text-white"
                  : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400">Tap a bar to open that person&apos;s page.</span>
      </div>

      {data.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">Nobody has any {series.label.toLowerCase()} in these days.</p>
      ) : (
        <div style={{ height: Math.max(data.length * 38 + 16, 72) }} role="img" aria-label={`${series.label} per person`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, left: 4, bottom: 4 }} barCategoryGap="22%">
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis type="category" dataKey="short" width={150} tick={{ fill: t.ink, fontSize: 13 }} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: t.cursor }}
                content={p => {
                  const d = p.active ? (p.payload?.[0]?.payload as PersonBar | undefined) : undefined
                  if (!d) return null
                  return <TooltipBox title={d.name} rows={[{ label: series.label, value: d.value, colour: t.colour(measure) }]} />
                }}
              />
              <Bar
                dataKey="value"
                name={series.label}
                fill={t.colour(measure)}
                radius={[0, 4, 4, 0]}
                maxBarSize={24}
                cursor="pointer"
                isAnimationActive={false}
                onClick={(d: { payload?: PersonBar }) => { if (d?.payload?.href) router.push(d.payload.href) }}
              >
                <LabelList dataKey="value" position="right" fill={t.ink} fontSize={12} formatter={(v: unknown) => num(Number(v ?? 0))} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {left > 0 && data.length > 0 && (
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{left === 1 ? "1 person" : `${left} people`} with no {series.label.toLowerCase()} in these days {left === 1 ? "isn't" : "aren't"} shown.</p>
      )}
    </div>
  )
}

// ─── CSV ───────────────────────────────────────────────────────────────────────────────────

export function ExportButtons({ people, days, range, who }: { people: PersonTotals[]; days: PersonDay[]; range: ReportRange; who?: string }) {
  const names = new Map(people.map(p => [p.userId, p.name]))
  const nothing = people.length === 0 && days.length === 0
  return (
    <>
      <button type="button" className={btn} disabled={nothing} onClick={() => downloadCsv(peopleCsv(people, range), fileName(who ? "totals" : "people", range, who))}>
        <DownloadIcon /> {who ? "Export totals (CSV)" : "Export per person (CSV)"}
      </button>
      <button type="button" className={btn} disabled={days.length === 0} onClick={() => downloadCsv(daysCsv(days, names), fileName(who ? "days" : "people-by-day", range, who))}>
        <DownloadIcon /> Export per day (CSV)
      </button>
    </>
  )
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden>
      <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
    </svg>
  )
}
