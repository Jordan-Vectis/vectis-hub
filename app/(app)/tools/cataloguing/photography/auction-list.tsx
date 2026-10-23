"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { auctionTypeEmoji, auctionTypeLabel, AUCTION_TYPES } from "@/lib/auction-types"

export interface PhotographyAuctionRow {
  id: string
  code: string
  name: string
  auctionDate: string | null
  auctionType: string
  complete: boolean
  lots: number
  lotsWithPhotos: number
}

interface Props {
  active:    PhotographyAuctionRow[]
  completed: PhotographyAuctionRow[]
}

function fmtDate(iso: string | null): string {
  if (!iso) return "No date"
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

function AuctionCard({ a, onStart, onView }: {
  a: PhotographyAuctionRow
  onStart: (id: string) => void
  onView:  (id: string) => void
}) {
  const [going, setGoing] = useState(false)
  const [viewing, setViewing] = useState(false)
  const pct  = a.lots > 0 ? Math.round((a.lotsWithPhotos / a.lots) * 100) : 0
  const done = a.lots > 0 && a.lotsWithPhotos === a.lots
  const none = a.lotsWithPhotos === 0

  return (
    <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl p-5 flex flex-col gap-4 hover:border-purple-400 dark:hover:border-purple-500/70 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold text-purple-700 dark:text-purple-400">{a.code}</span>
            <span className="text-xs text-gray-600 dark:text-gray-400">
              {auctionTypeEmoji(a.auctionType)} {auctionTypeLabel(a.auctionType)}
            </span>
          </div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mt-1 truncate">{a.name}</h3>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{fmtDate(a.auctionDate)}</p>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {done && (
            <span className="text-xs bg-green-200 text-green-800 dark:bg-green-900/40 dark:text-green-400 rounded-full px-2 py-0.5 whitespace-nowrap">
              ✓ All photographed
            </span>
          )}
          {/* "Marked photographed" and "In BC" badges went with their ticks (2026-09-15) — the photo
              count above is the truth, and BC is measured on Auction Manager. */}
        </div>
      </div>

      {/* Photo progress */}
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            {a.lots === 0
              ? "No lots yet"
              : <><span className="font-semibold text-gray-900 dark:text-white">{a.lotsWithPhotos}</span> of {a.lots} lots have photos</>}
          </p>
          {a.lots > 0 && (
            <p className={`text-xs font-semibold ${done ? "text-green-700 dark:text-green-400" : none ? "text-gray-500 dark:text-gray-500" : "text-purple-700 dark:text-purple-400"}`}>
              {pct}%
            </p>
          )}
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
          <div
            className={`h-2 rounded-full transition-all ${done ? "bg-green-500" : "bg-purple-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {a.lots > 0 && !done && (
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1.5">
            {a.lots - a.lotsWithPhotos} lot{a.lots - a.lotsWithPhotos !== 1 ? "s" : ""} still need photos
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <button
          onClick={() => { setGoing(true); onStart(a.id) }}
          disabled={going || a.lots === 0}
          className="w-full py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
        >
          {going ? "Opening…" : a.lots === 0 ? "No lots to photograph" : "📷 Start photography"}
        </button>
        <button
          onClick={() => { setViewing(true); onView(a.id) }}
          disabled={viewing || a.lots === 0}
          className="w-full py-2 rounded-lg border border-gray-300 dark:border-gray-700 hover:border-purple-400 disabled:opacity-40 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors"
        >
          {viewing ? "Opening…" : `🔍 View lots${a.lots > 0 ? ` (${a.lots})` : ""}`}
        </button>
      </div>
    </div>
  )
}

// List view (the default since 2026-10-23 — Jordan: "have it have a list view as default then have
// a toggle to change it back"). One row per sale, the same figures and buttons as a card.
function AuctionTable({ rows, onStart, onView }: {
  rows: PhotographyAuctionRow[]
  onStart: (id: string) => void
  onView:  (id: string) => void
}) {
  return (
    <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-gray-600 dark:text-gray-400 border-b border-gray-300 dark:border-gray-700">
            <th className="px-4 py-3 font-medium">Sale</th>
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium whitespace-nowrap">Date</th>
            <th className="px-4 py-3 font-medium min-w-[14rem]">Photos</th>
            <th className="px-4 py-3 font-medium whitespace-nowrap">Still need</th>
            <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(a => <AuctionRow key={a.id} a={a} onStart={onStart} onView={onView} />)}
        </tbody>
      </table>
    </div>
  )
}

function AuctionRow({ a, onStart, onView }: {
  a: PhotographyAuctionRow
  onStart: (id: string) => void
  onView:  (id: string) => void
}) {
  const [going, setGoing] = useState(false)
  const [viewing, setViewing] = useState(false)
  const pct  = a.lots > 0 ? Math.round((a.lotsWithPhotos / a.lots) * 100) : 0
  const done = a.lots > 0 && a.lotsWithPhotos === a.lots
  const none = a.lotsWithPhotos === 0
  const left = a.lots - a.lotsWithPhotos

  return (
    <tr className="border-b last:border-b-0 border-gray-200 dark:border-gray-800 hover:bg-purple-50/50 dark:hover:bg-purple-900/10">
      <td className="px-4 py-2.5 whitespace-nowrap">
        <span className="font-mono font-semibold text-purple-700 dark:text-purple-400">{a.code}</span>
        <span className="block text-xs text-gray-600 dark:text-gray-400">{auctionTypeEmoji(a.auctionType)} {auctionTypeLabel(a.auctionType)}</span>
      </td>
      <td className="px-4 py-2.5 font-semibold text-gray-900 dark:text-white">{a.name}</td>
      <td className="px-4 py-2.5 whitespace-nowrap text-gray-600 dark:text-gray-400">{fmtDate(a.auctionDate)}</td>
      <td className="px-4 py-2.5">
        {a.lots === 0 ? (
          <span className="text-xs text-gray-600 dark:text-gray-400">No lots yet</span>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-gray-200 dark:bg-gray-800 rounded-full h-2 overflow-hidden min-w-[6rem]">
              <div className={`h-2 rounded-full ${done ? "bg-green-500" : "bg-purple-500"}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
              <span className="font-semibold text-gray-900 dark:text-white">{a.lotsWithPhotos}</span> / {a.lots}
            </span>
            <span className={`text-xs font-semibold w-10 text-right ${done ? "text-green-700 dark:text-green-400" : none ? "text-gray-500" : "text-purple-700 dark:text-purple-400"}`}>{pct}%</span>
          </div>
        )}
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap">
        {done
          ? <span className="text-xs bg-green-200 text-green-800 dark:bg-green-900/40 dark:text-green-400 rounded-full px-2 py-0.5">✓ All photographed</span>
          : a.lots > 0 ? <span className="text-gray-900 dark:text-white">{left}</span> : <span className="text-gray-500">—</span>}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => { setGoing(true); onStart(a.id) }}
            disabled={going || a.lots === 0}
            className="min-h-11 px-4 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold whitespace-nowrap transition-colors"
          >
            {going ? "Opening…" : "📷 Start"}
          </button>
          <button
            onClick={() => { setViewing(true); onView(a.id) }}
            disabled={viewing || a.lots === 0}
            className="min-h-11 px-4 rounded-lg border border-gray-300 dark:border-gray-700 hover:border-purple-400 disabled:opacity-40 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300 text-sm font-medium whitespace-nowrap transition-colors"
          >
            {viewing ? "Opening…" : "🔍 View lots"}
          </button>
        </div>
      </td>
    </tr>
  )
}

type View = "list" | "cards"
const VIEW_KEY = "photography_view"

// Sort orders (2026-10-23 — Jordan: "by default can we have the soonest sales at the top and maybe a
// filter as well"). "Soonest" = today's and upcoming sales first, nearest first; then sales whose
// date has passed, most recent first; then sales with no date.
type Sort = "soonest" | "latest" | "most-left" | "code"
const SORT_KEY = "photography_sort"
const SORTS: { value: Sort; label: string }[] = [
  { value: "soonest",   label: "Soonest sale first" },
  { value: "latest",    label: "Latest sale first" },
  { value: "most-left", label: "Most lots still to photograph" },
  { value: "code",      label: "Sale code" },
]

function sortRows(rows: PhotographyAuctionRow[], sort: Sort): PhotographyAuctionRow[] {
  const t = (a: PhotographyAuctionRow) => a.auctionDate ? new Date(a.auctionDate).getTime() : null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const start = today.getTime()
  const byCode = (a: PhotographyAuctionRow, b: PhotographyAuctionRow) => a.code.localeCompare(b.code, undefined, { numeric: true })
  return [...rows].sort((a, b) => {
    const ta = t(a), tb = t(b)
    if (sort === "code") return byCode(a, b)
    if (sort === "most-left") return (b.lots - b.lotsWithPhotos) - (a.lots - a.lotsWithPhotos) || byCode(a, b)
    if (ta === null || tb === null) return ta === tb ? byCode(a, b) : ta === null ? 1 : -1
    if (sort === "latest") return tb - ta || byCode(a, b)
    const ua = ta >= start, ub = tb >= start
    if (ua !== ub) return ua ? -1 : 1
    return (ua ? ta - tb : tb - ta) || byCode(a, b)
  })
}

export default function PhotographyAuctionList({ active, completed }: Props) {
  const router = useRouter()
  const [search, setSearch]   = useState("")
  const [type, setType]       = useState("")
  const [showDone, setShowDone] = useState(false)
  // List by default; each device remembers its own choice (read after mount, so the server's first
  // render matches).
  const [view, setView] = useState<View>("list")
  const [sort, setSort] = useState<Sort>("soonest")
  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === "cards") setView("cards")
      const saved = localStorage.getItem(SORT_KEY)
      if (SORTS.some(o => o.value === saved)) setSort(saved as Sort)
    } catch { /* private mode */ }
  }, [])
  const chooseSort = (v: Sort) => {
    setSort(v)
    try { localStorage.setItem(SORT_KEY, v) } catch { /* private mode */ }
  }
  const chooseView = (v: View) => {
    setView(v)
    try { localStorage.setItem(VIEW_KEY, v) } catch { /* private mode */ }
  }
  const showRows = (rows: PhotographyAuctionRow[]) => view === "list"
    ? <AuctionTable rows={rows} onStart={start} onView={view_} />
    : (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
        {rows.map(a => <AuctionCard key={a.id} a={a} onStart={start} onView={view_} />)}
      </div>
    )

  const filter = (rows: PhotographyAuctionRow[]) => rows.filter(a => {
    const q = search.trim().toLowerCase()
    if (q && !a.code.toLowerCase().includes(q) && !a.name.toLowerCase().includes(q)) return false
    if (type && a.auctionType !== type) return false
    return true
  })

  const shownActive    = useMemo(() => sortRows(filter(active), sort),    [active, search, type, sort])
  const shownCompleted = useMemo(() => sortRows(filter(completed), sort), [completed, search, type, sort])

  const start = (id: string) => router.push(`/tools/cataloguing/photography/${id}`)
  const view_ = (id: string) => router.push(`/tools/cataloguing/photography/${id}?tab=view`)

  const totalNeeding = active.reduce((n, a) => n + (a.lots - a.lotsWithPhotos), 0)

  return (
    <div className="p-6">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">📷 Photography</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
            Pick a sale, then upload its photos. Barcode labels are read automatically and every photo is
            double-checked by AI before anything is saved.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link href="/tools/cataloguing/photography/any-sale"
            className="text-sm font-semibold px-3.5 py-2 rounded-lg border border-purple-400 dark:border-purple-500/70 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors whitespace-nowrap">
            📷 Upload without picking a sale
          </Link>
          <Link href="/tools/cataloguing/photography/debug"
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-purple-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors">
            🔧 Barcode debug
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white dark:bg-[#1C1C1E] rounded-xl border border-gray-300 dark:border-gray-700 p-4">
          <p className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Active sales</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{active.length}</p>
        </div>
        <div className="bg-white dark:bg-[#1C1C1E] rounded-xl border border-gray-300 dark:border-gray-700 p-4">
          <p className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Lots needing photos</p>
          <p className="text-2xl font-bold text-purple-700 dark:text-purple-400 mt-1">{totalNeeding}</p>
        </div>
        <div className="bg-white dark:bg-[#1C1C1E] rounded-xl border border-gray-300 dark:border-gray-700 p-4">
          <p className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Fully photographed</p>
          <p className="text-2xl font-bold text-green-700 dark:text-green-400 mt-1">
            {active.filter(a => a.lots > 0 && a.lotsWithPhotos === a.lots).length}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap mb-5">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search code or name…"
          className="flex-1 min-w-[12rem] max-w-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
        <select
          value={type}
          onChange={e => setType(e.target.value)}
          className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <option value="">All types</option>
          {AUCTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.emoji} {t.label}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          Sort by
          <select
            value={sort}
            onChange={e => chooseSort(e.target.value as Sort)}
            className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            {SORTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        {(search || type) && (
          <button onClick={() => { setSearch(""); setType("") }}
            className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white px-2 py-1">
            ✕ Clear
          </button>
        )}
        <div className="ml-auto inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden" role="group" aria-label="How to show the sales">
          {([["list", "☰ List"], ["cards", "▦ Cards"]] as const).map(([v, label]) => (
            <button key={v} onClick={() => chooseView(v)} aria-pressed={view === v}
              className={`min-h-11 px-4 text-sm font-medium transition-colors ${view === v
                ? "bg-purple-600 text-white"
                : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Active */}
      {shownActive.length === 0 ? (
        <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl px-6 py-10 text-center">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {active.length === 0 ? "No active sales to photograph." : "No sales match that search."}
          </p>
        </div>
      ) : (
        showRows(shownActive)
      )}

      {/* Completed sales, tucked away */}
      {completed.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setShowDone(v => !v)}
            className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-medium"
          >
            {showDone ? "▾" : "▸"} Completed sales ({shownCompleted.length})
          </button>
          {showDone && (
            <div className="mt-4">{showRows(shownCompleted)}</div>
          )}
        </div>
      )}
    </div>
  )
}
