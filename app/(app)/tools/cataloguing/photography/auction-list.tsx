"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { auctionTypeEmoji, auctionTypeLabel, AUCTION_TYPES } from "@/lib/auction-types"

export interface PhotographyAuctionRow {
  id: string
  code: string
  name: string
  auctionDate: string | null
  auctionType: string
  complete: boolean
  photography: boolean
  addedToBC: boolean
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
          {a.photography && !done && (
            <span className="text-xs bg-purple-200 text-purple-800 dark:bg-purple-900/40 dark:text-purple-400 rounded-full px-2 py-0.5 whitespace-nowrap">
              Marked photographed
            </span>
          )}
          {a.addedToBC && (
            <span className="text-xs bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-400 rounded-full px-2 py-0.5 whitespace-nowrap">
              In BC
            </span>
          )}
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

export default function PhotographyAuctionList({ active, completed }: Props) {
  const router = useRouter()
  const [search, setSearch]   = useState("")
  const [type, setType]       = useState("")
  const [showDone, setShowDone] = useState(false)

  const filter = (rows: PhotographyAuctionRow[]) => rows.filter(a => {
    const q = search.trim().toLowerCase()
    if (q && !a.code.toLowerCase().includes(q) && !a.name.toLowerCase().includes(q)) return false
    if (type && a.auctionType !== type) return false
    return true
  })

  const shownActive    = useMemo(() => filter(active),    [active, search, type])
  const shownCompleted = useMemo(() => filter(completed), [completed, search, type])

  const start = (id: string) => router.push(`/tools/cataloguing/photography/${id}`)
  const view  = (id: string) => router.push(`/tools/cataloguing/photography/${id}?tab=view`)

  const totalNeeding = active.reduce((n, a) => n + (a.lots - a.lotsWithPhotos), 0)

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">📷 Photography</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
          Pick a sale, then upload its photos. Barcode labels are read automatically and every photo is
          double-checked by AI before anything is saved.
        </p>
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
        {(search || type) && (
          <button onClick={() => { setSearch(""); setType("") }}
            className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white px-2 py-1">
            ✕ Clear
          </button>
        )}
      </div>

      {/* Active */}
      {shownActive.length === 0 ? (
        <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl px-6 py-10 text-center">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {active.length === 0 ? "No active sales to photograph." : "No sales match that search."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {shownActive.map(a => <AuctionCard key={a.id} a={a} onStart={start} onView={view} />)}
        </div>
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
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 mt-4">
              {shownCompleted.map(a => <AuctionCard key={a.id} a={a} onStart={start} onView={view} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
