"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import type { Counts, PersonTotals } from "@/lib/goods-in/reports"
import { box } from "../_components/ui"
import { perDay } from "./export"

// Goods In → Reports: the per-person table. Sortable by any column (tap a heading; tap again to
// turn it round). Each name opens that person's page with the same days. First and last times
// show only when the range is a single day — over several days they would be one day's start and
// another day's finish — and "Moves a day" / "Scans a day" (total ÷ Days active) only when it is
// more than one. It scrolls sideways INSIDE its box on a phone; the name column stays put.

type Key = "name" | "activeDays" | keyof Counts | "movesPerDay" | "scansPerDay" | "scanners" | "firstAt" | "lastAt" | "busiestHour"
type Group = "who" | "moves" | "scans" | "checkIns" | "when"
type Col = { key: Key; label: string; group: Group; title?: string }

const COLS: Col[] = [
  { key: "name", label: "Person", group: "who" },
  { key: "activeDays", label: "Days active", group: "who", title: "Days with at least one move, scan or check-in" },
  { key: "moves", label: "Moves", group: "moves", title: "Every move of a tote, pallet or lot, on any screen" },
  { key: "movesPerDay", label: "Moves a day", group: "moves", title: "Moves divided by Days active" },
  { key: "putAway", label: "Put away", group: "moves", title: "Totes and pallets moved to storage" },
  { key: "toBench", label: "To bench", group: "moves", title: "Totes and pallets moved to a bench" },
  { key: "lotsShelved", label: "Lots shelved", group: "moves", title: "Single lots moved to a location" },
  { key: "bulk", label: "In bulk", group: "moves", title: "Moves made by Move everything on a location — counted in Moves too" },
  { key: "scans", label: "Scans", group: "scans", title: "Scans sent from the handheld scanner" },
  { key: "scansPerDay", label: "Scans a day", group: "scans", title: "Scans divided by Days active" },
  { key: "refused", label: "Refused", group: "scans", title: "Scans the Hub turned down" },
  { key: "stale", label: "Overtaken", group: "scans", title: "Scans not used because someone moved the item since" },
  { key: "late", label: "Sent late", group: "scans", title: "Scanned with no Wi-Fi, sent over 5 minutes later" },
  { key: "acks", label: "Acknowledged", group: "scans", title: "Failed scans they saw on the scanner's pop-up and confirmed seen" },
  { key: "scanners", label: "Scanners", group: "scans", title: "Different handheld scanners used" },
  { key: "checkIns", label: "Check-ins", group: "checkIns", title: "Receipts booked in" },
  { key: "totesBooked", label: "Totes", group: "checkIns", title: "Totes on the receipts they booked in" },
  { key: "palletsBooked", label: "Pallets", group: "checkIns", title: "Pallets on the receipts they booked in" },
  { key: "firstAt", label: "First", group: "when", title: "Earliest move, scan or check-in (UK time)" },
  { key: "lastAt", label: "Last", group: "when", title: "Latest move, scan or check-in (UK time)" },
  { key: "busiestHour", label: "Busiest hour", group: "when", title: "The hour with the most done (UK time)" },
]

const GROUPS: { group: Group; label: string }[] = [
  { group: "who", label: "" },
  { group: "moves", label: "Moves" },
  { group: "scans", label: "Handheld scanner" },
  { group: "checkIns", label: "Check-ins" },
  { group: "when", label: "When" },
]

const TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
const time = (iso: string | null) => (iso ? TIME.format(new Date(iso)) : "—")
const hour = (h: number | null) => (h == null ? "—" : `${String(h).padStart(2, "0")}:00–${String((h + 1) % 24).padStart(2, "0")}:00`)
const num = (n: number) => n.toLocaleString("en-GB")
const oneDp = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const zero = <span className="text-gray-500 dark:text-gray-400">0</span>

const sortValue = (p: PersonTotals, k: Key): number | string | null => {
  if (k === "name") return p.name.toLocaleLowerCase("en-GB")
  if (k === "firstAt" || k === "lastAt") return p[k] ? new Date(p[k]!).getTime() : null
  if (k === "movesPerDay") return perDay(p.moves, p.activeDays)
  if (k === "scansPerDay") return perDay(p.scans, p.activeDays)
  return p[k]
}

export default function PeopleTable({
  people, hrefs, oneDay, totals,
}: {
  people: PersonTotals[]
  hrefs: Record<string, string>
  oneDay: boolean
  /** The whole team's figures, for a last "Everyone" line (managers, with more than one person). */
  totals?: Counts
}) {
  // One day: first and last times, and no "a day" averages (they would just repeat the totals).
  // Several days: the averages, and no first/last.
  const cols = useMemo(() => COLS.filter(c =>
    oneDay ? c.key !== "movesPerDay" && c.key !== "scansPerDay" : c.key !== "firstAt" && c.key !== "lastAt"), [oneDay])
  const [sort, setSort] = useState<{ key: Key; dir: "asc" | "desc" }>({ key: "moves", dir: "desc" })

  const rows = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1
    return [...people].sort((a, b) => {
      const va = sortValue(a, sort.key), vb = sortValue(b, sort.key)
      if (va == null && vb != null) return 1 // nothing recorded sorts last either way round
      if (vb == null && va != null) return -1
      if (va != null && vb != null && va !== vb) return (va < vb ? -1 : 1) * dir
      return b.moves - a.moves || b.scans - a.scans || a.name.localeCompare(b.name, "en-GB")
    })
  }, [people, sort])

  const pick = (key: Key) =>
    setSort(s => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" || key === "firstAt" ? "asc" : "desc" }))

  const groupSpans = GROUPS.map(g => ({ ...g, span: cols.filter(c => c.group === g.group).length })).filter(g => g.span > 0)
  const firstOf = (c: Col, i: number) => i > 0 && cols[i - 1].group !== c.group
  const sticky = "sticky left-0 z-10 bg-white dark:bg-gray-900"

  const cell = (p: PersonTotals, c: Col) => {
    switch (c.key) {
      case "name": return <Link href={hrefs[p.userId]} className="font-semibold text-indigo-700 dark:text-indigo-300 hover:underline inline-flex items-center min-h-11">{p.name}</Link>
      case "firstAt": return time(p.firstAt)
      case "lastAt": return time(p.lastAt)
      case "busiestHour": return hour(p.busiestHour)
      case "movesPerDay":
      case "scansPerDay": {
        const v = sortValue(p, c.key) as number | null
        return v ? oneDp(v) : zero
      }
      default: {
        const v = p[c.key]
        return v ? num(v) : zero
      }
    }
  }

  return (
    <div className={`${box} overflow-x-auto overscroll-x-contain`}>
      <table className="w-full text-sm whitespace-nowrap">
        <thead>
          <tr className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {groupSpans.map(g => (
              <th key={g.group} colSpan={g.span} scope="colgroup" className={`px-3 pt-2.5 pb-0.5 text-left ${g.group === "who" ? "" : "border-l border-gray-200 dark:border-gray-800"}`}>
                {g.label}
              </th>
            ))}
          </tr>
          <tr className="border-b border-gray-200 dark:border-gray-800">
            {cols.map((c, i) => {
              const on = sort.key === c.key
              const right = c.key !== "name"
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  className={`p-0 ${c.key === "name" ? sticky : ""} ${firstOf(c, i) ? "border-l border-gray-200 dark:border-gray-800" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => pick(c.key)}
                    title={c.title ? `${c.title} — tap to sort` : "Tap to sort"}
                    className={`w-full min-h-11 px-3 inline-flex items-center gap-1 text-xs font-semibold transition-colors ${right ? "justify-end" : "justify-start"} ${
                      on ? "text-indigo-700 dark:text-indigo-300" : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                    }`}
                  >
                    {c.label}
                    <span aria-hidden className={`text-[10px] ${on ? "" : "opacity-0"}`}>{on && sort.dir === "asc" ? "▲" : "▼"}</span>
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map(p => (
            <tr key={p.userId} className="group hover:bg-gray-50 dark:hover:bg-gray-800">
              {cols.map((c, i) => (
                <td
                  key={c.key}
                  className={`px-3 py-1 tabular-nums ${c.key === "name" ? `${sticky} group-hover:bg-gray-50 dark:group-hover:bg-gray-800` : "text-right text-gray-800 dark:text-gray-200"} ${
                    c.key === "moves" || c.key === "scans" || c.key === "checkIns" ? "font-semibold" : ""
                  } ${firstOf(c, i) ? "border-l border-gray-100 dark:border-gray-800" : ""}`}
                >
                  {cell(p, c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot className="border-t-2 border-gray-200 dark:border-gray-700">
            <tr className="font-semibold text-gray-900 dark:text-white">
              {cols.map((c, i) => {
                const v = c.key in totals ? totals[c.key as keyof Counts] : null
                return (
                  <td key={c.key} className={`px-3 py-2.5 tabular-nums ${c.key === "name" ? sticky : "text-right"} ${firstOf(c, i) ? "border-l border-gray-100 dark:border-gray-800" : ""}`}>
                    {c.key === "name" ? "Everyone" : v == null ? "" : num(v)}
                  </td>
                )
              })}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
