"use client"

import { useState, useEffect, useCallback, useRef } from "react"

// ─── Types ────────────────────────────────────────────────────────────────────

type SyncStatus = {
  itemCount: number
  toteCount: number
  running: string[]
  sources: {
    receipt_lines: { completedAt: string; itemsProcessed: number } | null
    auction_lines:  { completedAt: string; itemsProcessed: number } | null
    changelog:      { completedAt: string; itemsProcessed: number } | null
    totes:          { completedAt: string; itemsProcessed: number } | null
    "totes-active": { completedAt: string; itemsProcessed: number } | null
  }
}

type HeatLocation = { code: string; name: string; items: number; totes: number; total: number; known: boolean; cataloguingBench: boolean }
type HeatFilter = "all" | "active" | "catalogued_located" | "barcodes" | "totes_only"
type HeatData = {
  locations: HeatLocation[]
  unlocated: number
  unlocatedBreakdown?: { items: number; totes: number }
  auctions: string[]
  meta: { total: number; totalItems: number; totalTotes: number; knownLocations: number; unknownLocations: number; occupiedLocations: number; emptyLocations: number }
}

type SaleItem = {
  uniqueId: string
  barcode: string | null
  lotNo: string | null
  currentLotNo: string | null
  description: string | null
  artist: string | null
  location: string | null
  binCode: string | null
  toteNo: string | null
  vendorNo: string | null
  vendorName: string | null
  withdrawLot: boolean | null
  collected: boolean | null
}

type SaleAuction = {
  code: string
  name: string | null
  date: string | null
  items: SaleItem[]
}

type SaleData = {
  auctions: SaleAuction[]
  total: number
}

type SearchItem = {
  uniqueId: string
  description: string | null
  artist: string | null
  location: string | null
  binCode: string | null
  toteNo: string | null
  barcode: string | null
  auctionCode: string | null
  lotNo: string | null
  currentLotNo: string | null
  category: string | null
  catalogued: boolean | null
  locationScannedAt: string | null
}

type SearchTote = {
  toteNo: string
  location: string | null
  receiptNo: string | null
  vendorNo: string | null
  vendorName: string | null
  status: string | null
  catalogued: boolean | null
  syncedAt: string | null
}

type Tab = "heatmap" | "sale-checklist" | "search" | "location-history" | "tote-data" | "collections-due" | "data-sync" | "db-explorer"

const STALE_MS = 15 * 60 * 1000 // 15 minutes

function isStale(completedAt: string | undefined | null): boolean {
  if (!completedAt) return true
  return Date.now() - new Date(completedAt).getTime() > STALE_MS
}

// ─── SyncBar ──────────────────────────────────────────────────────────────────

function SyncBar({ status, onSync }: { status: SyncStatus | null; onSync: () => void }) {
  const last = status?.sources.receipt_lines?.completedAt
  const running = (status?.running ?? []).length > 0

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-gray-900 border-t border-gray-700 text-xs text-gray-400">
      <span>{status?.itemCount ?? 0} items in DB</span>
      {last && (
        <span>· Last sync {new Date(last).toLocaleTimeString()}</span>
      )}
      {running && <span className="text-yellow-400 animate-pulse">· Syncing…</span>}
      <button
        onClick={onSync}
        disabled={running}
        className="ml-auto text-blue-400 hover:text-blue-300 disabled:opacity-40"
      >
        Sync now
      </button>
    </div>
  )
}

// ─── FirstSyncPanel ───────────────────────────────────────────────────────────

function FirstSyncPanel({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle")
  const [items, setItems] = useState(0)
  const [batch, setBatch] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef(false)

  async function runSync() {
    abortRef.current = false
    setPhase("running")
    setError(null)
    setItems(0)
    setBatch(0)

    // Step 1: receipt lines — call repeatedly until more === false
    // Each call handles 5 pages × 500 = 2,500 items (safe under Railway's 60s limit)
    let more = true
    while (more && !abortRef.current) {
      try {
        const res = await fetch("/api/warehouse/sync/receipt-lines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ maxPages: 5 }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "receipt-lines failed")
        setItems(i => i + (data.itemsProcessed ?? 0))
        setBatch(b => b + 1)
        more = data.more === true
      } catch (e: any) {
        setError(e.message)
        setPhase("error")
        return
      }
    }

    // Step 2: auction lines
    if (!abortRef.current) {
      try {
        const res = await fetch("/api/warehouse/sync/auction-lines", { method: "POST" })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "auction-lines failed")
        setItems(i => i + (data.itemsProcessed ?? 0))
      } catch (e: any) {
        setError(e.message)
        setPhase("error")
        return
      }
    }

    // Step 3: changelog
    if (!abortRef.current) {
      try {
        const res = await fetch("/api/warehouse/sync/changelog", { method: "POST" })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "changelog failed")
      } catch { /* changelog failure is non-fatal */ }
    }

    // Step 4: auction names — populate auctionName for all codes in DB
    if (!abortRef.current) {
      try {
        await fetch("/api/warehouse/sync/auction-names", { method: "POST" })
      } catch { /* non-fatal — names will be fetched on demand */ }
    }

    setPhase("done")
    onComplete()
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 text-center p-8">
      <div className="text-4xl">📦</div>
      <div>
        <h2 className="text-xl font-semibold text-white mb-1">No warehouse data yet</h2>
        <p className="text-gray-400 text-sm max-w-sm">
          The first sync downloads all items from Business Central and stores them locally.
          This takes a few minutes — subsequent syncs are instant.
        </p>
      </div>

      {phase === "idle" && (
        <button
          onClick={runSync}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium"
        >
          Start initial sync
        </button>
      )}

      {phase === "running" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-yellow-400">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
            <span>Syncing… {items.toLocaleString()} items ({batch} batches done)</span>
          </div>
          <p className="text-xs text-gray-500">Do not close this tab — this may take a few minutes</p>
          <button
            onClick={() => { abortRef.current = true; setPhase("error"); setError("Cancelled") }}
            className="text-xs text-gray-500 hover:text-gray-300"
          >
            Cancel
          </button>
        </div>
      )}

      {phase === "done" && (
        <p className="text-green-400 font-medium">✓ Sync complete — {items.toLocaleString()} items loaded</p>
      )}

      {phase === "error" && (
        <div className="space-y-2">
          <p className="text-red-400 text-sm">{error}</p>
          <button
            onClick={runSync}
            className="px-4 py-2 bg-red-900 hover:bg-red-800 text-white rounded text-sm"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  )
}

// ─── WarehouseHeatmapTab ──────────────────────────────────────────────────────

// Traffic-light colours by item count
function fillColor(total: number): { bg: string; ring: string; text: string } {
  if (total === 0)  return { bg: "bg-gray-900",   ring: "ring-gray-800",   text: "text-gray-600" }
  if (total <= 2)   return { bg: "bg-emerald-700/70", ring: "ring-emerald-500/40", text: "text-emerald-100" }
  if (total <= 5)   return { bg: "bg-yellow-600/70", ring: "ring-yellow-400/40", text: "text-yellow-50" }
  if (total <= 9)   return { bg: "bg-orange-600/80", ring: "ring-orange-400/50", text: "text-orange-50" }
  return                  { bg: "bg-red-700",        ring: "ring-red-500/60",   text: "text-red-50" }
}

// Group code "A10A1" → aisle "A10", bay "A", shelf "1"
function parseLocation(code: string): { aisle: string; bay: string; shelf: string } | null {
  const m = code.match(/^([A-Z]?\d+)([A-Z]+)(\d+)$/)
  if (!m) return null
  return { aisle: m[1], bay: m[2], shelf: m[3] }
}

const HEAT_FILTER_LABELS: Record<HeatFilter, string> = {
  all:                "All",
  active:             "Active",
  catalogued_located: "Catalogued totes (located)",
  barcodes:           "Barcodes only",
  totes_only:         "Totes only",
}

function WarehouseHeatmapTab() {
  const [data, setData]           = useState<HeatData | null>(null)
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState<string | null>(null)
  const [items, setItems]         = useState<SearchItem[]>([])
  const [totes, setTotes]         = useState<SearchTote[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [aisleFilter, setAisleFilter]   = useState<string>("ALL")
  const [showEmpty, setShowEmpty] = useState(true)
  const [heatFilter, setHeatFilter]     = useState<HeatFilter>("all")
  const [auctionFilter, setAuctionFilter] = useState<string>("")

  const fetchHeatmap = useCallback((filter: HeatFilter, auction: string) => {
    setLoading(true)
    const qs = new URLSearchParams()
    if (filter  !== "all") qs.set("filter",  filter)
    if (auction !== "")    qs.set("auction", auction)
    const url = `/api/warehouse/heatmap${qs.toString() ? `?${qs}` : ""}`
    fetch(url)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { fetchHeatmap(heatFilter, auctionFilter) }, [heatFilter, auctionFilter, fetchHeatmap])

  async function selectLocation(code: string) {
    setSelected(code)
    setItemsLoading(true)
    try {
      const r = await fetch(`/api/warehouse/search?location=${encodeURIComponent(code)}`)
      const d = await r.json()
      setItems(d.items ?? [])
      setTotes(d.totes ?? [])
    } catch { setItems([]); setTotes([]) }
    setItemsLoading(false)
  }

  if (loading && !data) return <div className="p-6 text-gray-400 text-sm">Loading heatmap…</div>
  if (!data) return <div className="p-6 text-red-400 text-sm">Failed to load heatmap</div>

  // Group locations by aisle, then by bay
  type Group = Map<string /* bay */, HeatLocation[]>
  const aisles = new Map<string, Group>()
  const other:  HeatLocation[] = []

  for (const loc of data.locations) {
    const parsed = parseLocation(loc.code)
    if (!parsed) { other.push(loc); continue }
    if (!aisles.has(parsed.aisle)) aisles.set(parsed.aisle, new Map())
    const bayMap = aisles.get(parsed.aisle)!
    if (!bayMap.has(parsed.bay)) bayMap.set(parsed.bay, [])
    bayMap.get(parsed.bay)!.push(loc)
  }

  // Aisle list, sorted naturally (A1, A2, ..., A10, ...)
  const aisleNames = [...aisles.keys()].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  )

  // Filter aisles to display
  const visibleAisles = aisleFilter === "ALL"
    ? aisleNames
    : aisleNames.filter(a => a === aisleFilter)

  // Stats
  const occupied = data.meta.occupiedLocations
  const empty    = data.meta.emptyLocations

  return (
    <div className="flex h-full">
      {/* Heatmap panel */}
      <div className="flex-1 overflow-y-auto p-4 min-w-0">

        {/* Header bar */}
        <div className="mb-4 pb-3 border-b border-gray-800 space-y-2">
          {/* Stats row */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm">
              {loading ? (
                <span className="text-gray-500 text-xs animate-pulse">Refreshing…</span>
              ) : (
                <>
                  <span className="text-white font-semibold">{data.locations.length.toLocaleString()}</span>
                  <span className="text-gray-500"> locations · </span>
                  <span className="text-emerald-400 font-medium">{occupied.toLocaleString()}</span>
                  <span className="text-gray-500"> occupied · </span>
                  <span className="text-gray-500 font-medium">{empty.toLocaleString()} empty · </span>
                  <span className="text-gray-300 font-medium">{data.meta.totalItems?.toLocaleString() ?? 0}</span>
                  <span className="text-gray-500"> items · </span>
                  <span className="text-cyan-300 font-medium">{data.meta.totalTotes?.toLocaleString() ?? 0}</span>
                  <span className="text-gray-500"> totes</span>
                </>
              )}
            </div>

            <div className="ml-auto flex items-center gap-2">
              {/* Aisle filter */}
              <select
                value={aisleFilter}
                onChange={e => setAisleFilter(e.target.value)}
                className="bg-gray-800 border border-gray-700 text-gray-200 rounded text-xs px-2 py-1.5 focus:outline-none focus:border-blue-500"
              >
                <option value="ALL">All aisles ({aisleNames.length})</option>
                {aisleNames.map(a => <option key={a} value={a}>{a}</option>)}
              </select>

              <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showEmpty}
                  onChange={e => setShowEmpty(e.target.checked)}
                  className="accent-blue-500"
                />
                Show empty
              </label>
            </div>
          </div>

          {/* Filter pills row */}
          <div className="flex flex-wrap items-center gap-2">
            {(["all", "active", "catalogued_located", "barcodes", "totes_only"] as HeatFilter[]).map(f => (
              <button
                key={f}
                onClick={() => { setHeatFilter(f); setSelected(null) }}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  heatFilter === f
                    ? "bg-blue-600 border-blue-500 text-white"
                    : "bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200"
                }`}
              >
                {HEAT_FILTER_LABELS[f]}
              </button>
            ))}

            <div className="h-4 w-px bg-gray-700 mx-1" />

            {/* Auction filter */}
            <select
              value={auctionFilter}
              onChange={e => { setAuctionFilter(e.target.value); setSelected(null) }}
              className="bg-gray-900 border border-gray-700 text-gray-300 rounded-full text-xs px-3 py-1 focus:outline-none focus:border-blue-500"
            >
              <option value="">All auctions</option>
              {(data.auctions ?? []).map(a => <option key={a} value={a}>{a}</option>)}
            </select>

            {(heatFilter !== "all" || auctionFilter !== "") && (
              <button
                onClick={() => { setHeatFilter("all"); setAuctionFilter(""); setSelected(null) }}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                ✕ Clear filters
              </button>
            )}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 mb-4 text-xs text-gray-400">
          <span className="text-gray-500 uppercase tracking-wider">Fill level:</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gray-900 ring-1 ring-gray-800" /> Empty</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-700/70" /> 1–2</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-yellow-600/70" /> 3–5</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-600/80" /> 6–9</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-700" /> 10+</span>
          <span className="text-gray-700">·</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-cyan-400" /> Has tote</span>
        </div>

        {/* Unlocated chip */}
        {data.unlocated > 0 && (
          <button
            onClick={() => selectLocation("")}
            className={`mb-4 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              selected === "" ? "bg-blue-700 border-blue-500 text-white" : "bg-gray-900 border-gray-700 text-gray-300 hover:border-gray-500"
            }`}
          >
            ⚠ Unlocated · {data.unlocated.toLocaleString()} items
          </button>
        )}

        {/* Aisles */}
        <div className="space-y-5">
          {visibleAisles.map(aisle => {
            const bays = aisles.get(aisle)!
            const bayNames = [...bays.keys()].sort()
            const totalInAisle = [...bays.values()].flat().reduce((s, l) => s + l.total, 0)
            const filledInAisle = [...bays.values()].flat().filter(l => l.total > 0).length
            const totalCells = [...bays.values()].flat().length

            return (
              <div key={aisle} className="bg-gray-900/40 rounded-lg border border-gray-800 p-3">
                <div className="flex items-baseline justify-between mb-2">
                  <h3 className="text-sm font-semibold text-white font-mono">{aisle}</h3>
                  <span className="text-xs text-gray-500">
                    {filledInAisle}/{totalCells} shelves · {totalInAisle} items
                  </span>
                </div>

                {/* Bays as columns, shelves as rows (shelf 1 at bottom, ascending up).
                    Bay labels run along the bottom. */}
                {(() => {
                  // Build a lookup: bay → shelf number → location
                  const lookup = new Map<string, Map<number, HeatLocation>>()
                  let maxShelf = 0
                  for (const bay of bayNames) {
                    const map = new Map<number, HeatLocation>()
                    for (const loc of bays.get(bay)!) {
                      const sh = parseInt(parseLocation(loc.code)?.shelf ?? "0", 10)
                      if (sh > 0) {
                        map.set(sh, loc)
                        if (sh > maxShelf) maxShelf = sh
                      }
                    }
                    lookup.set(bay, map)
                  }

                  // Shelves descending (so highest shelf is at top, shelf 1 at bottom)
                  const shelfRows: number[] = []
                  for (let s = maxShelf; s >= 1; s--) shelfRows.push(s)

                  return (
                    <div className="inline-block">
                      {/* Shelf rows */}
                      {shelfRows.map(shelfNum => (
                        <div key={shelfNum} className="flex items-center gap-1 mb-1 last:mb-0">
                          <span className="text-[10px] font-mono text-gray-600 w-4 flex-shrink-0 text-right">{shelfNum}</span>
                          {bayNames.map(bay => {
                            const loc = lookup.get(bay)?.get(shelfNum)
                            if (!loc) {
                              // Empty placeholder so columns line up
                              return <div key={bay} className="w-9 h-9" />
                            }
                            if (!showEmpty && loc.total === 0) {
                              return <div key={bay} className="w-9 h-9" />
                            }
                            const c = fillColor(loc.total)
                            const isSel = selected === loc.code
                            const tip = `${loc.code} — ${loc.total} total · ${loc.items} item${loc.items === 1 ? "" : "s"} · ${loc.totes} tote${loc.totes === 1 ? "" : "s"}`
                            return (
                              <button
                                key={loc.code}
                                onClick={() => selectLocation(loc.code)}
                                title={tip}
                                className={`relative w-9 h-9 rounded text-xs font-mono font-semibold flex items-center justify-center transition-all ${c.bg} ${c.text} ring-1 ${c.ring} hover:brightness-125 hover:scale-110 ${
                                  isSel ? "ring-2 ring-blue-400 scale-110" : ""
                                }`}
                              >
                                {loc.total || ""}
                                {loc.totes > 0 && (
                                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-cyan-400 ring-1 ring-gray-900" title={`${loc.totes} tote${loc.totes === 1 ? "" : "s"}`} />
                                )}
                              </button>
                            )
                          })}
                        </div>
                      ))}

                      {/* Bay labels along the bottom */}
                      <div className="flex items-center gap-1 mt-1 pt-1 border-t border-gray-800">
                        <span className="w-4 flex-shrink-0" />
                        {bayNames.map(bay => (
                          <span key={bay} className="w-9 text-center text-xs font-mono font-semibold text-gray-400">
                            {bay}
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })()}
              </div>
            )
          })}

          {/* Other (codes not matching aisle/bay/shelf pattern) */}
          {aisleFilter === "ALL" && other.length > 0 && (
            <div className="bg-gray-900/40 rounded-lg border border-gray-800 p-3">
              <h3 className="text-sm font-semibold text-white mb-2">Other locations</h3>
              <div className="flex flex-wrap gap-1.5">
                {other.filter(l => showEmpty || l.total > 0).map(loc => {
                  const c = fillColor(loc.total)
                  const isSel = selected === loc.code
                  return (
                    <button
                      key={loc.code}
                      onClick={() => selectLocation(loc.code)}
                      title={`${loc.code} — ${loc.total} items`}
                      className={`px-2.5 py-1.5 rounded text-xs font-mono ${c.bg} ${c.text} ring-1 ${c.ring} hover:brightness-125 ${
                        isSel ? "ring-2 ring-blue-400" : ""
                      }`}
                    >
                      {loc.code} <span className="opacity-60">{loc.total}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Details panel */}
      <div className="w-96 flex-shrink-0 border-l border-gray-800 overflow-y-auto p-4 bg-gray-950">
        {!selected && selected !== "" ? (
          <div className="text-gray-500 text-sm mt-8 text-center">Click a shelf to see its contents</div>
        ) : itemsLoading ? (
          <div className="text-gray-400 text-sm">Loading…</div>
        ) : items.length === 0 && totes.length === 0 ? (
          <div className="text-gray-500 text-sm">No items or totes found</div>
        ) : (
          <div className="space-y-3">
            {/* Header */}
            <div className="pb-2 border-b border-gray-800">
              <div className="font-mono text-base text-blue-400 font-semibold">{selected || "Unlocated"}</div>
              <div className="text-xs text-gray-500">
                {items.length > 0 && `${items.length} item${items.length === 1 ? "" : "s"}`}
                {items.length > 0 && totes.length > 0 && " · "}
                {totes.length > 0 && <span className="text-cyan-400">{totes.length} tote{totes.length === 1 ? "" : "s"}</span>}
              </div>
            </div>

            {/* Totes */}
            {totes.length > 0 && (
              <div>
                <div className="text-xs text-cyan-500 uppercase tracking-wider mb-1.5">Totes</div>
                <div className="space-y-1.5">
                  {totes.map(tote => (
                    <div key={tote.toteNo} className="bg-gray-800/80 rounded-lg px-3 py-2.5 text-xs border border-cyan-900/30">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-mono text-cyan-300 font-semibold">{tote.toteNo}</span>
                        {tote.catalogued != null && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${tote.catalogued ? "bg-green-900/60 text-green-300" : "bg-amber-900/60 text-amber-300"}`}>
                            {tote.catalogued ? "Catalogued" : "Active"}
                          </span>
                        )}
                      </div>
                      <div className="space-y-0.5 text-gray-400">
                        {tote.receiptNo   && <div><span className="text-gray-600">Receipt </span>{tote.receiptNo}</div>}
                        {tote.vendorName  && <div><span className="text-gray-600">Vendor </span>{tote.vendorName}{tote.vendorNo ? ` (${tote.vendorNo})` : ""}</div>}
                        {tote.status && tote.status !== "No Reserve" && <div><span className="text-gray-600">Status </span>{tote.status}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Items */}
            {items.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-1.5">Items</div>
                <div className="space-y-1.5">
                  {items.map(item => (
                    <div key={item.uniqueId} className="bg-gray-800 rounded-lg px-3 py-2.5 text-xs">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="font-mono text-gray-300">{item.uniqueId}</span>
                          {item.auctionCode && (
                            <span className="bg-blue-900 text-blue-200 px-1.5 py-0.5 rounded text-[10px]">{item.auctionCode}</span>
                          )}
                          {item.catalogued && (
                            <span className="bg-green-900/60 text-green-300 px-1.5 py-0.5 rounded text-[10px]">Catalogued</span>
                          )}
                        </div>
                      </div>
                      <div className="space-y-0.5 text-gray-400">
                        {(item.artist || item.description) && (
                          <div className="text-gray-200">
                            {item.artist && <span className="text-yellow-400">{item.artist} — </span>}
                            {item.description}
                          </div>
                        )}
                        {item.barcode     && <div><span className="text-gray-600">Barcode </span><span className="font-mono">{item.barcode}</span></div>}
                        {(() => { const lot = item.currentLotNo ?? item.lotNo; return lot && lot !== "0" ? <div><span className="text-gray-600">Lot </span>{lot}</div> : null })()}
                        {item.toteNo      && <div><span className="text-gray-600">Tote </span>{item.toteNo}</div>}
                        {item.binCode     && <div><span className="text-gray-600">Bin </span>{item.binCode}</div>}
                        {item.category    && <div><span className="text-gray-600">Category </span>{item.category}</div>}
                        {item.locationScannedAt && <div><span className="text-gray-600">Scanned </span>{new Date(item.locationScannedAt).toLocaleDateString("en-GB")}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── SaleChecklistTab ─────────────────────────────────────────────────────────

function SaleChecklistTab() {
  const [data, setData] = useState<SaleData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<"all" | "located" | "missing">("all")
  const [search, setSearch] = useState("")
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/warehouse/sale-checklist")
      .then(async r => {
        const d = await r.json()
        if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
        return d
      })
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return <div className="p-6 text-gray-400 text-sm">Loading sale checklist…</div>
  if (error || !data) return <div className="p-6 text-red-400 text-sm">Failed to load sale checklist{error ? `: ${error}` : ""}</div>

  const auctions = data.auctions.filter(a => {
    if (!search) return true
    const q = search.toLowerCase()
    return a.code.toLowerCase().includes(q) || (a.name?.toLowerCase().includes(q) ?? false)
  })

  return (
    <div className="h-full flex flex-col">
      <div className="flex gap-3 p-3 border-b border-gray-700 items-center">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search auction code or name…"
          className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        {(["all", "located", "missing"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded text-sm ${filter === f ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
          >
            {f === "all" ? "All" : f === "located" ? "Located" : "Missing"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {auctions.length === 0 && (
          <div className="text-gray-500 text-sm text-center mt-8">No auctions found</div>
        )}
        {auctions.map(auction => {
          const items = filter === "all" ? auction.items
            : filter === "located" ? auction.items.filter(i => i.location)
            : auction.items.filter(i => !i.location)

          if (items.length === 0 && filter !== "all") return null

          const isOpen = expanded === auction.code
          const located = auction.items.filter(i => i.location).length
          const missing = auction.items.length - located

          return (
            <div key={auction.code} className="bg-gray-800 rounded-lg overflow-hidden">
              <button
                onClick={() => setExpanded(isOpen ? null : auction.code)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-750 text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono font-semibold text-white flex-shrink-0">{auction.code}</span>
                  {auction.name && (
                    <span className="text-sm text-gray-300 truncate">{auction.name}</span>
                  )}
                  {auction.date && (
                    <span className="text-xs text-gray-400 flex-shrink-0">{new Date(auction.date).toLocaleDateString()}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-green-400">{located} located</span>
                  {missing > 0 && <span className="text-red-400">{missing} missing</span>}
                  <span className="text-gray-500">{auction.items.length} total</span>
                  <span className="text-gray-500">{isOpen ? "▲" : "▼"}</span>
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-gray-700">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-900 text-gray-400">
                      <tr>
                        <th className="px-3 py-2 text-left">Unique ID</th>
                        <th className="px-3 py-2 text-left">Barcode</th>
                        <th className="px-3 py-2 text-left">Lot</th>
                        <th className="px-3 py-2 text-left">Description</th>
                        <th className="px-3 py-2 text-left">Location</th>
                        <th className="px-3 py-2 text-left">Vendor</th>
                        <th className="px-3 py-2 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700">
                      {items.map(item => (
                        <tr key={item.uniqueId} className={!item.location ? "bg-red-950/30" : ""}>
                          <td className="px-3 py-2 font-mono text-gray-300">{item.uniqueId}</td>
                          <td className="px-3 py-2 font-mono text-gray-400">{item.barcode ?? "—"}</td>
                          <td className="px-3 py-2 text-gray-300">{item.currentLotNo ?? item.lotNo ?? "—"}</td>
                          <td className="px-3 py-2 text-gray-200 max-w-xs truncate">
                            {item.artist ? <span className="text-yellow-400">{item.artist} — </span> : null}
                            {item.description ?? "—"}
                          </td>
                          <td className="px-3 py-2 font-mono">
                            {item.location ? (
                              <span className="text-green-400">{[item.location, item.binCode, item.toteNo].filter(Boolean).join("·")}</span>
                            ) : (
                              <span className="text-red-400">Missing</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-400">{item.vendorName ?? item.vendorNo ?? "—"}</td>
                          <td className="px-3 py-2">
                            {item.withdrawLot && <span className="text-orange-400">Withdraw</span>}
                            {item.collected && <span className="text-blue-400">Collected</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── SearchByLocationTab ──────────────────────────────────────────────────────

function SearchByLocationTab() {
  const [query, setQuery]       = useState("")
  const [mode, setMode]         = useState<"exact" | "aisle">("exact")
  const [items, setItems]       = useState<SearchItem[]>([])
  const [totes, setTotes]       = useState<SearchTote[]>([])
  const [loading, setLoading]   = useState(false)
  const [searched, setSearched] = useState(false)
  const [searchedFor, setSearchedFor] = useState("")

  async function doSearch(e?: React.FormEvent) {
    e?.preventDefault()
    const q = query.trim().toUpperCase()
    if (!q) return
    setLoading(true)
    setSearched(true)
    setSearchedFor(q)
    try {
      const r = await fetch(`/api/warehouse/search?location=${encodeURIComponent(q)}&mode=${mode}`)
      const d = await r.json()
      setItems(d.items ?? [])
      setTotes(d.totes ?? [])
    } catch { setItems([]); setTotes([]) }
    setLoading(false)
  }

  const total = items.length + totes.length

  return (
    <div className="h-full flex flex-col">
      {/* Search bar */}
      <div className="p-4 border-b border-gray-800 space-y-3">
        {/* Mode toggle */}
        <div className="flex gap-2">
          {([
            { id: "exact", label: "Specific search",  hint: "location, barcode, or tote number" },
            { id: "aisle", label: "Whole aisle",      hint: "e.g. A2 → all shelves in aisle A2" },
          ] as const).map(m => (
            <button
              key={m.id}
              onClick={() => { setMode(m.id); setSearched(false) }}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                mode === m.id
                  ? "border-blue-500 bg-blue-500/20 text-blue-300"
                  : "border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <form onSubmit={doSearch} className="flex gap-2 max-w-lg">
          <input
            value={query}
            onChange={e => setQuery(e.target.value.toUpperCase())}
            placeholder={mode === "exact" ? "Location e.g. A2A1, barcode e.g. F066001, tote e.g. T001234…" : "Aisle e.g. A2, A10, BENCH…"}
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 font-mono"
            autoFocus
          />
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </form>

        {searched && !loading && (
          <div className="text-xs text-gray-500">
            {total === 0
              ? `Nothing found ${mode === "aisle" ? `in aisle` : `at`} "${searchedFor}"`
              : `${total.toLocaleString()} result${total === 1 ? "" : "s"} ${mode === "aisle" ? `in aisle` : `at`} ${searchedFor}${items.length ? ` · ${items.length.toLocaleString()} item${items.length === 1 ? "" : "s"}` : ""}${totes.length ? ` · ${totes.length.toLocaleString()} tote${totes.length === 1 ? "" : "s"}` : ""}`}
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {!searched && (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-600 gap-2">
            <div className="text-4xl">📍</div>
            <div className="text-sm">
              {mode === "exact"
                ? "Search by location code, barcode, or tote number"
                : "Enter an aisle code to see every shelf in that aisle"}
            </div>
            <div className="text-xs text-gray-700">
              {mode === "exact" ? "e.g. A2A1 · F066001 · T001234" : "e.g. A2 shows A2A1, A2B2, A2C3 …"}
            </div>
          </div>
        )}

        {searched && !loading && total === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-600 gap-2">
            <div className="text-4xl">🔍</div>
            <div className="text-sm">Nothing found {mode === "aisle" ? "in aisle" : "at"} <span className="font-mono text-gray-400">"{searchedFor}"</span></div>
            {mode === "exact" && <div className="text-xs text-gray-700">Switch to "Whole aisle" to search all shelves in an aisle</div>}
          </div>
        )}

        {/* Totes section */}
        {totes.length > 0 && (
          <div className="border-b border-gray-800">
            <div className="px-4 py-2 bg-gray-900/50 text-xs font-medium text-cyan-500 uppercase tracking-wider">
              Totes · {totes.length.toLocaleString()}
            </div>
            <table className="w-full text-xs">
              <thead className="bg-gray-900 text-gray-500 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Tote No</th>
                  {mode === "aisle" && <th className="px-4 py-2 text-left font-medium">Location</th>}
                  <th className="px-4 py-2 text-left font-medium">Receipt</th>
                  <th className="px-4 py-2 text-left font-medium">Vendor</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-left font-medium">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {totes.map(t => (
                  <tr key={t.toteNo} className="hover:bg-gray-800/40 transition-colors">
                    <td className="px-4 py-2.5 font-mono text-cyan-300 font-semibold">{t.toteNo}</td>
                    {mode === "aisle" && <td className="px-4 py-2.5 font-mono text-gray-500">{t.location ?? "—"}</td>}
                    <td className="px-4 py-2.5 font-mono text-gray-400">{t.receiptNo ?? "—"}</td>
                    <td className="px-4 py-2.5 text-gray-300">{t.vendorName ?? t.vendorNo ?? "—"}</td>
                    <td className="px-4 py-2.5 text-gray-400">{t.status && t.status !== "No Reserve" ? t.status : "—"}</td>
                    <td className="px-4 py-2.5">
                      {t.catalogued != null
                        ? <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${t.catalogued ? "bg-green-900/50 text-green-300" : "bg-amber-900/50 text-amber-300"}`}>
                            {t.catalogued ? "Catalogued" : "Active"}
                          </span>
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Items section */}
        {items.length > 0 && (
          <div>
            <div className="px-4 py-2 bg-gray-900/50 text-xs font-medium text-gray-400 uppercase tracking-wider">
              Items · {items.length.toLocaleString()}
            </div>
            <table className="w-full text-xs">
              <thead className="bg-gray-900 text-gray-500 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Unique ID</th>
                  <th className="px-4 py-2 text-left font-medium">Barcode</th>
                  {mode === "aisle" && <th className="px-4 py-2 text-left font-medium">Location</th>}
                  <th className="px-4 py-2 text-left font-medium">Description</th>
                  <th className="px-4 py-2 text-left font-medium">Auction</th>
                  <th className="px-4 py-2 text-left font-medium">Lot</th>
                  <th className="px-4 py-2 text-left font-medium">Category</th>
                  <th className="px-4 py-2 text-left font-medium">Tote / Bin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {items.map(item => (
                  <tr key={item.uniqueId} className="hover:bg-gray-800/40 transition-colors">
                    <td className="px-4 py-2.5 font-mono text-gray-300">{item.uniqueId}</td>
                    <td className="px-4 py-2.5 font-mono text-gray-500">{item.barcode ?? "—"}</td>
                    {mode === "aisle" && <td className="px-4 py-2.5 font-mono text-gray-400">{item.location ?? "—"}</td>}
                    <td className="px-4 py-2.5 text-gray-200 max-w-xs">
                      {item.artist && <span className="text-yellow-400">{item.artist} — </span>}
                      {item.description ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {item.auctionCode
                        ? <span className="bg-blue-900/60 text-blue-300 px-2 py-0.5 rounded font-mono">{item.auctionCode}</span>
                        : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-400">{item.currentLotNo ?? item.lotNo ?? "—"}</td>
                    <td className="px-4 py-2.5 text-gray-500">{item.category ?? "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-gray-500">{[item.toteNo, item.binCode].filter(Boolean).join(" / ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── LocationHistoryTab ───────────────────────────────────────────────────────

type LocationEntry = { from: string; to: string; changedBy: string; changedAt: string }

const SALESPERSON_NAMES: Record<string, string> = {
  AM: "Ashley McIntyre", AR: "Andrea Rowntree", AR2: "Andrew Reed", AROB: "Amelia Robson",
  AW: "Andrew Wilson", BC: "Bob Coulson", BG: "Bryan Goodall", BJ: "Becky Jones",
  BK: "Ben Kennington", CH: "Chris Hemingway", CW: "Chris Whan", DB: "Daniel Brakenbury",
  DC: "Debbie Cockerill", DL: "Daniel Lorraine", DP: "Dispatch", ED: "Edward Duffy",
  EG: "Ewan Gray", EW: "Eve Walker", GH: "Gill Harley", HW: "Harry Wheatley",
  ID: "Ian Dilley", IM: "Ian Main", JC: "Jack Collings", JG: "Jonathon Gouder",
  JK: "Jake Kenyon", JM: "Jo McDonald", JO: "Jordan Orange", JR: "Julian Royse",
  JS: "Jake Smithson", JW: "Julie Walker", KR: "Kay Rankin", KS: "Keiran Southgate",
  KT: "Kathy Taylor", LH: "Lesley Hill", LS: "Lisa Sutherland", MB: "Matt Bailey",
  MC: "Matthew Cotton", MD: "Mike Delaney", MF: "Mike Fishwick", MT: "Michelle Trotter",
  MV: "Melanie Vasey", ND: "Nick Dykes", NO: "Naomi O'Conner", OB: "Olivia Burley",
  PB: "Paul Beverley", PC: "Phil Cochrane", PD: "Peter Davis", PM: "Peter Morris",
  SC: "Simon Clarke", SCANNER: "Scanner", SF: "Steven Furlong", SM: "Sanaz Moghaddam",
  SR: "Stuart Redding", SS: "Simon Smith", TR: "Tim Routh", VA: "Vectis Accounts",
  VS: "Vanessa Stanton", WA: "Admin Warehouse", WR: "Wendy Robins",
}

function formatDateTime(iso: string) {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
  } catch { return iso }
}

function LocationHistoryTab() {
  const [input, setInput]   = useState("")
  const [mode, setMode]     = useState<"tote" | "barcode">("tote")
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [result, setResult] = useState<{ field1: string; field2: string | null; entries: LocationEntry[] } | null>(null)

  async function lookup() {
    const q = input.trim()
    if (!q) return
    setLoading(true); setError(null); setResult(null)
    try {
      const res  = await fetch(`/api/bc/location-history?q=${encodeURIComponent(q)}&mode=${mode}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Lookup failed"); return }
      setResult(data)
    } catch { setError("Network error") }
    finally { setLoading(false) }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-1">Location History</h2>
      <p className="text-gray-500 text-sm mb-5">Look up every location a tote or lot has ever been moved to via BC change logs.</p>

      <div className="bg-[#0d0f1a] border border-gray-700 rounded-xl p-5 max-w-lg space-y-4">
        <div className="flex gap-2">
          {(["tote", "barcode"] as const).map(m => (
            <button key={m} onClick={() => { setMode(m); setResult(null); setError(null) }}
              className={`px-4 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                mode === m ? "border-blue-500 bg-blue-500/20 text-blue-300" : "border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300"
              }`}>
              {m === "tote" ? "🗂 Tote number" : "🔖 Barcode"}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && lookup()}
            placeholder={mode === "tote" ? "e.g. T000123" : "e.g. F037458"} autoFocus
            className="flex-1 bg-[#07070f] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono" />
          <button onClick={lookup} disabled={loading || !input.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors">
            {loading ? "Searching…" : "Look up"}
          </button>
        </div>
        {mode === "barcode" && <p className="text-xs text-gray-600">Barcode lookup does two BC queries: first finds the item key from the barcode, then fetches all location changes for that item.</p>}
      </div>

      {error && <div className="mt-4 max-w-lg"><p className="text-red-400 text-sm">{error}</p></div>}

      {result && (
        <div className="mt-5 max-w-2xl space-y-4">
          <div className="flex items-center gap-8">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">BC Item Key</p>
              <p className="text-white font-mono text-sm">{result.field1}{result.field2 ? ` · ${result.field2}` : ""}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Movements found</p>
              <p className="text-white font-semibold">{result.entries.length}</p>
            </div>
          </div>

          {result.entries.length === 0 ? (
            <div className="bg-[#0d0f1a] border border-gray-700 rounded-xl p-6 text-center">
              <p className="text-gray-400 text-sm">No location changes found in the BC change log.</p>
              <p className="text-gray-600 text-xs mt-1">The item may not have been moved, or the change log wasn't active when it was.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-700">
              <table className="w-full text-sm">
                <thead className="bg-[#0d0f1a] text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-2.5 text-left">From</th>
                    <th className="px-4 py-2.5 text-left">To</th>
                    <th className="px-4 py-2.5 text-left">Changed by</th>
                    <th className="px-4 py-2.5 text-left">Date / Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {result.entries.map((e, i) => (
                    <tr key={i} className={`hover:bg-[#0d0f1a] ${i === 0 ? "bg-blue-950/30" : ""}`}>
                      <td className="px-4 py-2 text-gray-400 font-mono text-xs">{e.from || <span className="text-gray-600 italic">empty</span>}</td>
                      <td className="px-4 py-2 text-white font-mono text-xs font-semibold">{e.to || <span className="text-gray-600 italic">empty</span>}</td>
                      <td className="px-4 py-2 text-gray-300">{SALESPERSON_NAMES[e.changedBy] ?? e.changedBy}</td>
                      <td className="px-4 py-2 text-gray-400 text-xs">{formatDateTime(e.changedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── ToteDataTab ─────────────────────────────────────────────────────────────

type ToteReport = {
  stats: { total: number; active: number; catalogued: number; unknown: number }
  byCategory: { category: string; itemCount: number; activeTotes: number }[]
  byLocation: { location: string | null; toteCount: number }[]
  totes: SearchTote[]
}

function HorizBar({ value, max, color = "bg-blue-500" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.max((value / max) * 100, 0.5) : 0
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="flex-1 bg-gray-800 rounded-sm h-5 overflow-hidden">
        <div className={`${color} h-full rounded-sm transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-gray-300 w-10 text-right flex-shrink-0">{value.toLocaleString()}</span>
    </div>
  )
}

function ToteDataTab() {
  const [data, setData]       = useState<ToteReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [view, setView]       = useState<"category" | "location" | "raw">("category")
  const [showAll, setShowAll] = useState(false)

  async function load() {
    setLoading(true); setError(null)
    try {
      const r = await fetch("/api/warehouse/tote/report")
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? "Failed to load report")
      setData(d)
    } catch (e: any) { setError(e.message) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  if (loading) return <div className="p-6 text-gray-400 text-sm">Loading tote report…</div>
  if (error) return (
    <div className="p-6 space-y-3">
      <p className="text-red-400 text-sm">{error}</p>
      <button onClick={load} className="px-4 py-2 bg-red-900 hover:bg-red-800 text-white rounded text-sm">Retry</button>
    </div>
  )
  if (!data) return null

  const { stats, byLocation, totes } = data

  // Sort byCategory by activeTotes desc for the chart
  const byCategory = [...data.byCategory].sort((a, b) => b.activeTotes - a.activeTotes)
  const maxTotes   = Math.max(...byCategory.map(r => r.activeTotes), 1)
  const maxLoc     = Math.max(...byLocation.map(r => r.toteCount), 1)

  const largestCategory = byCategory[0]?.category ?? "—"
  const visibleTotes    = showAll ? totes : totes.slice(0, 150)

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-gray-800 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Tote Report</h2>
          <p className="text-xs text-gray-500 mt-0.5">Active totes by category and location</p>
        </div>
        <button
          onClick={load}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium transition-colors"
        >
          ⟳ Refresh
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3 px-6 py-4 border-b border-gray-800">
        <div className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Total Totes</div>
          <div className="text-2xl font-mono font-semibold text-white">{stats.total.toLocaleString()}</div>
          <div className="text-xs text-gray-600 mt-0.5">
            <span className="text-amber-400">{stats.active.toLocaleString()} active</span>
            {" · "}
            <span className="text-gray-500">{(stats.total - stats.active).toLocaleString()} done</span>
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Categories</div>
          <div className="text-2xl font-mono font-semibold text-white">{byCategory.length}</div>
          <div className="text-xs text-gray-600 mt-0.5">with active totes</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Largest Category</div>
          <div className="text-lg font-semibold text-white truncate">{largestCategory}</div>
          <div className="text-xs text-amber-400 mt-0.5">{byCategory[0]?.activeTotes.toLocaleString() ?? 0} active totes</div>
        </div>
      </div>

      {/* Sub-tab bar */}
      <div className="flex gap-1 px-6 pt-3 border-b border-gray-800">
        {([
          { id: "category", label: "By Category" },
          { id: "location", label: "By Location" },
          { id: "raw",      label: `Raw Data (${totes.length.toLocaleString()})` },
        ] as const).map(t => (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            className={`px-4 py-2 text-sm rounded-t transition-colors ${
              view === t.id
                ? "bg-gray-800 text-white border-b-2 border-blue-500"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Chart / Table area */}
      <div className="flex-1 overflow-y-auto px-6 py-5">

        {/* ── By Category chart ── */}
        {view === "category" && (
          <div className="space-y-1.5 max-w-3xl">
            {byCategory.length === 0 && (
              <div className="text-gray-600 text-sm">No active totes found</div>
            )}
            {byCategory.map(row => (
              <div key={row.category} className="grid items-center gap-3" style={{ gridTemplateColumns: "180px 1fr" }}>
                <div className="text-xs text-gray-400 text-right truncate pr-2 font-mono">{row.category}</div>
                <HorizBar value={row.activeTotes} max={maxTotes} color="bg-blue-500" />
              </div>
            ))}
            {/* x-axis ticks */}
            <div className="grid gap-3 mt-2 text-xs text-gray-600" style={{ gridTemplateColumns: "180px 1fr" }}>
              <div />
              <div className="flex justify-between pr-10">
                <span>0</span>
                <span>{Math.round(maxTotes / 4)}</span>
                <span>{Math.round(maxTotes / 2)}</span>
                <span>{Math.round((maxTotes * 3) / 4)}</span>
                <span>{maxTotes}</span>
              </div>
            </div>
          </div>
        )}

        {/* ── By Location chart ── */}
        {view === "location" && (
          <div className="space-y-1.5 max-w-3xl">
            {byLocation.length === 0 && (
              <div className="text-gray-600 text-sm">No location data found</div>
            )}
            {byLocation.map(row => (
              <div key={row.location} className="grid items-center gap-3" style={{ gridTemplateColumns: "120px 1fr" }}>
                <div className="text-xs text-gray-400 text-right truncate pr-2 font-mono">{row.location ?? "—"}</div>
                <HorizBar value={row.toteCount} max={maxLoc} color="bg-cyan-500" />
              </div>
            ))}
            <div className="grid gap-3 mt-2 text-xs text-gray-600" style={{ gridTemplateColumns: "120px 1fr" }}>
              <div />
              <div className="flex justify-between pr-10">
                <span>0</span>
                <span>{Math.round(maxLoc / 4)}</span>
                <span>{Math.round(maxLoc / 2)}</span>
                <span>{Math.round((maxLoc * 3) / 4)}</span>
                <span>{maxLoc}</span>
              </div>
            </div>
          </div>
        )}

        {/* ── Raw data table ── */}
        {view === "raw" && (
          <div className="border border-gray-800 rounded-lg overflow-hidden">
            {totes.length === 0 ? (
              <div className="p-6 text-center text-gray-600 text-sm">No active totes found</div>
            ) : (
              <>
                <table className="w-full text-xs">
                  <thead className="bg-gray-900 text-gray-500 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Tote No</th>
                      <th className="px-4 py-2 text-left font-medium">Location</th>
                      <th className="px-4 py-2 text-left font-medium">Receipt</th>
                      <th className="px-4 py-2 text-left font-medium">Vendor</th>
                      <th className="px-4 py-2 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/60">
                    {visibleTotes.map(t => (
                      <tr key={t.toteNo} className="hover:bg-gray-800/30 transition-colors">
                        <td className="px-4 py-2.5 font-mono text-cyan-300 font-semibold">{t.toteNo}</td>
                        <td className="px-4 py-2.5 font-mono text-gray-400">{t.location ?? <span className="text-gray-700">—</span>}</td>
                        <td className="px-4 py-2.5 text-gray-400">{t.receiptNo ?? <span className="text-gray-700">—</span>}</td>
                        <td className="px-4 py-2.5 text-gray-300">{t.vendorName ?? <span className="text-gray-700">—</span>}</td>
                        <td className="px-4 py-2.5 text-gray-500">{t.status && t.status !== "No Reserve" ? t.status : <span className="text-gray-700">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {totes.length > 150 && (
                  <div className="px-4 py-3 border-t border-gray-800 text-center bg-gray-900">
                    <button
                      onClick={() => setShowAll(v => !v)}
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      {showAll ? "Show fewer" : `Show all ${totes.length.toLocaleString()} totes`}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── DbExplorerTab ────────────────────────────────────────────────────────────

const ITEM_FIELDS = [
  { value: "auctionCode",  label: "Auction Code" },
  { value: "uniqueId",     label: "Unique ID" },
  { value: "barcode",      label: "Barcode" },
  { value: "location",     label: "Location" },
  { value: "toteNo",       label: "Tote No" },
  { value: "vendorNo",     label: "Vendor No" },
  { value: "category",     label: "Category" },
  { value: "description",  label: "Description" },
]

const TOTE_FIELDS = [
  { value: "toteNo",     label: "Tote No" },
  { value: "location",   label: "Location" },
  { value: "receiptNo",  label: "Receipt No" },
  { value: "vendorNo",   label: "Vendor No" },
  { value: "vendorName", label: "Vendor Name" },
]

// ─── Collections Due Tab ─────────────────────────────────────────────────────
// Mirrors the BC Receipt Lines workflow where staff filter by aisle prefix
// (e.g. A39, A40) and look for items with a Collection Docket. Produces a
// printable pick-list. Live BC query — bypasses the WarehouseItem cache so
// dockets issued in the last few minutes still appear.

type CollectionsItem = {
  uniqueId:     string
  receiptNo:    string
  articleNo:    string
  barcode:      string
  description:  string
  location:     string
  collectionNo: string
  vendorName:   string
}

function CollectionsDueTab() {
  const [aislesText, setAislesText] = useState("A39, A40")
  const [items,      setItems]      = useState<CollectionsItem[] | null>(null)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [groupByDocket, setGroupByDocket] = useState(false)

  async function search() {
    setLoading(true)
    setError(null)
    setItems(null)
    try {
      const params = new URLSearchParams({ aisles: aislesText })
      const res = await fetch(`/api/warehouse/collections-due?${params}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Failed")
        return
      }
      setItems(data.items as CollectionsItem[])
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }

  const [downloadingPdf, setDownloadingPdf] = useState(false)
  async function downloadPdf() {
    if (!items || items.length === 0) return
    setDownloadingPdf(true)
    try {
      const aisles = aislesText.trim()
      const url = `/api/warehouse/collections-due/pdf?aisles=${encodeURIComponent(aisles)}`
      const res = await fetch(url)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error ?? "PDF generation failed")
        return
      }
      const blob = await res.blob()
      const link = document.createElement("a")
      link.href = URL.createObjectURL(blob)
      link.download = `collections-due-${aisles.replace(/[^A-Za-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(link.href)
    } catch {
      alert("Network error while downloading PDF")
    } finally {
      setDownloadingPdf(false)
    }
  }

  // Group view: collapse items by collectionNo
  const grouped = items
    ? Object.values(items.reduce((acc, it) => {
        const key = it.collectionNo || "—"
        if (!acc[key]) acc[key] = { collectionNo: key, items: [] as CollectionsItem[] }
        acc[key].items.push(it)
        return acc
      }, {} as Record<string, { collectionNo: string; items: CollectionsItem[] }>))
        .sort((a, b) => a.collectionNo.localeCompare(b.collectionNo))
    : []

  return (
    <div className="p-4 space-y-4 h-full overflow-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-white">Collections Due</h2>
          <p className="text-sm text-gray-400">
            Items in the chosen aisles that have a collection docket — typically due to be shipped but not yet collected.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div className="sm:col-span-2">
            <label className="block text-xs text-gray-400 mb-1">Aisle prefixes</label>
            <input
              type="text"
              value={aislesText}
              onChange={e => setAislesText(e.target.value)}
              onKeyDown={e => e.key === "Enter" && search()}
              placeholder="e.g. A39, A40, A41"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
            <p className="text-[11px] text-gray-500 mt-1">
              Comma-separated prefixes — matches anything starting with these (e.g. A39 catches A39A1, A39B5, A39C3…).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={search}
              disabled={loading || !aislesText.trim()}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              {loading ? "Searching BC…" : "Search"}
            </button>
            <label className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={groupByDocket}
                onChange={e => setGroupByDocket(e.target.checked)}
                className="accent-blue-500"
              />
              Group by docket
            </label>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-xl px-4 py-3 text-red-300 text-sm">{error}</div>
      )}

      {/* Results */}
      {items !== null && (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-gray-400">
              {items.length === 0 ? (
                "No matching items found."
              ) : (
                <>
                  <span className="text-white font-semibold">{items.length}</span> item{items.length === 1 ? "" : "s"} found
                  {groupByDocket && grouped.length > 0 && (
                    <> · <span className="text-white font-semibold">{grouped.length}</span> docket{grouped.length === 1 ? "" : "s"}</>
                  )}
                </>
              )}
            </p>
            {items.length > 0 && (
              <button
                onClick={downloadPdf}
                disabled={downloadingPdf}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                title="Download a PDF with each aisle on its own report."
              >
                {downloadingPdf ? "Generating PDF…" : "📄 Download PDF"}
              </button>
            )}
          </div>

          {items.length > 0 && !groupByDocket && (
            <div className="overflow-auto border border-gray-800 rounded-lg">
              <table className="text-xs w-full">
                <thead className="bg-gray-800 sticky top-0">
                  <tr className="text-left text-gray-400">
                    <th className="px-3 py-2">Location</th>
                    <th className="px-3 py-2">Barcode</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2">Collection No.</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(it => (
                    <tr key={it.uniqueId} className="border-t border-gray-800 hover:bg-gray-900">
                      <td className="px-3 py-2 font-mono text-gray-300">{it.location}</td>
                      <td className="px-3 py-2 font-mono text-gray-300">{it.barcode}</td>
                      <td className="px-3 py-2 text-gray-200">{it.description}</td>
                      <td className="px-3 py-2 font-mono text-emerald-400">{it.collectionNo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {items.length > 0 && groupByDocket && (
            <div className="space-y-3">
              {grouped.map(g => (
                <div key={g.collectionNo} className="border border-gray-800 rounded-lg overflow-hidden">
                  <div className="bg-gray-800 px-3 py-2 flex items-center justify-between">
                    <span className="font-mono text-emerald-400 text-sm">{g.collectionNo}</span>
                    <span className="text-xs text-gray-400">{g.items.length} item{g.items.length === 1 ? "" : "s"}</span>
                  </div>
                  <table className="text-xs w-full">
                    <tbody>
                      {g.items.map(it => (
                        <tr key={it.uniqueId} className="border-t border-gray-800 hover:bg-gray-900">
                          <td className="px-3 py-2 font-mono text-gray-300 w-24">{it.location}</td>
                          <td className="px-3 py-2 font-mono text-gray-300 w-24">{it.barcode}</td>
                          <td className="px-3 py-2 text-gray-200">{it.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function DbExplorerTab() {
  const [table,   setTable]   = useState<"items"|"totes">("items")
  const [field,   setField]   = useState("auctionCode")
  const [q,       setQ]       = useState("")
  const [rows,    setRows]    = useState<any[]>([])
  const [count,   setCount]   = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  // Re-pull auction names from BC. Use this when a sale name in the DB looks
  // stale — e.g. an auction was renamed in BC but our cached value didn't update.
  const [refreshingNames, setRefreshingNames] = useState(false)
  const [refreshMsg,      setRefreshMsg]      = useState<string | null>(null)

  // Wipe BC cache tables — admin destructive action behind a type-to-confirm dialog.
  const [clearOpen,        setClearOpen]      = useState(false)
  const [clearTarget,      setClearTarget]    = useState<"items" | "totes" | "both">("both")
  const [clearConfirmText, setClearConfirmText] = useState("")
  const [clearing,         setClearing]       = useState(false)
  const [clearMsg,         setClearMsg]       = useState<string | null>(null)

  async function clearBcData() {
    if (clearing) return
    setClearing(true)
    setClearMsg(null)
    try {
      const res = await fetch("/api/warehouse/clear-bc-data", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ confirm: clearConfirmText, target: clearTarget }),
      })
      const data = await res.json()
      if (!res.ok) {
        setClearMsg(data.error ?? "Failed")
        return
      }
      const parts: string[] = []
      if (data.itemsDeleted) parts.push(`${data.itemsDeleted.toLocaleString()} items`)
      if (data.totesDeleted) parts.push(`${data.totesDeleted.toLocaleString()} totes`)
      setClearMsg(`✓ Cleared ${parts.join(" + ")}. Now go to Data Sync and run a fresh pull.`)
      setRows([])
      setCount(null)
      setClearOpen(false)
      setClearConfirmText("")
    } catch {
      setClearMsg("Network error")
    } finally {
      setClearing(false)
    }
  }

  async function refreshAuctionNames() {
    if (refreshingNames) return
    setRefreshingNames(true)
    setRefreshMsg(null)
    try {
      const res = await fetch("/api/warehouse/sync/auction-names", { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        setRefreshMsg(data.error ?? "Failed — check BC connection")
        return
      }
      setRefreshMsg(`✓ Refreshed — ${data.namesWritten ?? 0} rows updated across ${data.codesFound ?? 0} sales`)
      // Re-run the current search so the user sees the fresh values
      if (count !== null) await search()
      setTimeout(() => setRefreshMsg(null), 6000)
    } catch {
      setRefreshMsg("Network error")
    } finally {
      setRefreshingNames(false)
    }
  }

  const fields = table === "items" ? ITEM_FIELDS : TOTE_FIELDS

  async function search() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ table, field, limit: "200" })
      if (q) params.set("q", q)
      const res = await fetch(`/api/warehouse/db-explorer?${params}`)
      const j   = await res.json()
      setRows(j.rows ?? [])
      setCount(j.count ?? 0)
    } finally {
      setLoading(false)
    }
  }

  const columns = rows.length > 0 ? Object.keys(rows[0]) : []

  return (
    <div className="p-4 space-y-4 h-full overflow-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-white">DB Explorer</h2>
          <p className="text-sm text-gray-400">Inspect raw data stored in the database</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {refreshMsg && (
            <span className={`text-xs ${refreshMsg.startsWith("✓") ? "text-emerald-400" : "text-amber-400"}`}>
              {refreshMsg}
            </span>
          )}
          {clearMsg && !clearOpen && (
            <span className={`text-xs ${clearMsg.startsWith("✓") ? "text-emerald-400" : "text-red-400"}`}>
              {clearMsg}
            </span>
          )}
          <button
            onClick={refreshAuctionNames}
            disabled={refreshingNames}
            title="Re-pull all auction names from BC. Use this when a cached sale name in the DB looks stale."
            className="text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 disabled:opacity-50 text-gray-200 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
          >
            {refreshingNames ? "Refreshing…" : "↻ Refresh auction names from BC"}
          </button>
          <button
            onClick={() => { setClearOpen(o => !o); setClearMsg(null); setClearConfirmText("") }}
            title="Wipe all BC-synced cache rows (Warehouse Items / Totes) so the next sync re-pulls from scratch. Admin only."
            className="text-xs bg-red-950 hover:bg-red-900 border border-red-900 hover:border-red-800 text-red-300 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
          >
            ⚠ Clear BC data…
          </button>
        </div>
      </div>

      {/* Clear-data confirmation panel */}
      {clearOpen && (
        <div className="bg-red-950/40 border border-red-900 rounded-xl p-5 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-red-200">⚠ Clear BC-synced cache</h3>
            <p className="text-xs text-red-300 mt-1">
              This permanently deletes the chosen Warehouse rows from our database.
              Other BC-dependent features (sale checklist, location heatmap,
              BC Marketing) will appear empty until the next sync completes.
              Catalogue lots and other non-BC data are untouched. Admin only.
            </p>
          </div>

          <div>
            <label className="block text-xs text-red-200 mb-1.5">What to clear</label>
            <div className="inline-flex gap-1 bg-red-950/60 border border-red-900 rounded-lg p-0.5">
              {(["items", "totes", "both"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setClearTarget(t)}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors capitalize ${
                    clearTarget === t ? "bg-red-700 text-white" : "text-red-300 hover:text-white"
                  }`}
                >
                  {t === "both" ? "Both items & totes" : `Warehouse ${t}`}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-red-200 mb-1.5">
              Type <code className="bg-red-950 px-1.5 py-0.5 rounded font-mono text-red-100">DELETE</code> to confirm
            </label>
            <input
              type="text"
              value={clearConfirmText}
              onChange={e => setClearConfirmText(e.target.value)}
              placeholder="DELETE"
              className="w-full max-w-xs bg-gray-900 border border-red-900 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-red-500"
              autoFocus
            />
          </div>

          {clearMsg && (
            <p className={`text-xs ${clearMsg.startsWith("✓") ? "text-emerald-400" : "text-red-300"}`}>{clearMsg}</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={clearBcData}
              disabled={clearing || clearConfirmText !== "DELETE"}
              className="px-4 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-colors"
            >
              {clearing ? "Clearing…" : `Clear ${clearTarget === "both" ? "items & totes" : clearTarget}`}
            </button>
            <button
              onClick={() => { setClearOpen(false); setClearConfirmText(""); setClearMsg(null) }}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex rounded overflow-hidden border border-gray-700">
          {(["items","totes"] as const).map(t => (
            <button key={t} onClick={() => { setTable(t); setField(t === "items" ? "auctionCode" : "toteNo"); setRows([]); setCount(null) }}
              className={`px-4 py-2 text-sm transition-colors ${table === t ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}>
              {t === "items" ? "Warehouse Items" : "Warehouse Totes"}
            </button>
          ))}
        </div>
        <select value={field} onChange={e => setField(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500">
          {fields.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <input value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === "Enter" && search()}
          placeholder="Search value (blank = all)"
          className="flex-1 min-w-48 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500 placeholder:text-gray-600" />
        <button onClick={search} disabled={loading}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold rounded transition-colors">
          {loading ? "Loading…" : "Search"}
        </button>
      </div>

      {count !== null && (
        <p className="text-sm text-gray-400">{count} row{count !== 1 ? "s" : ""} returned {count === 200 && <span className="text-yellow-500">(capped at 200)</span>}</p>
      )}

      {/* Table */}
      {rows.length > 0 && (
        <div className="overflow-auto border border-gray-700 rounded-lg">
          <table className="text-xs w-full">
            <thead className="bg-gray-800 sticky top-0">
              <tr>
                {columns.map(c => (
                  <th key={c} className="px-3 py-2 text-left text-gray-300 font-mono whitespace-nowrap border-r border-gray-700 last:border-0">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className={i % 2 === 0 ? "bg-gray-900" : "bg-gray-850"}>
                  {columns.map(c => (
                    <td key={c} className="px-3 py-1.5 text-gray-300 font-mono whitespace-nowrap border-r border-gray-800 last:border-0 max-w-xs truncate" title={String(row[c] ?? "")}>
                      {row[c] === null || row[c] === undefined ? <span className="text-gray-600">null</span> : String(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── DataSyncTab ──────────────────────────────────────────────────────────────

type LogEntry = { time: number; level: "info" | "ok" | "warn" | "error"; text: string }

function DataSyncTab({ status, onComplete }: { status: SyncStatus | null; onComplete: () => Promise<SyncStatus | null> }) {
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<LogEntry[]>([])
  const [bcLog, setBcLog] = useState<LogEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<string>("")
  const [batchTotal, setBatchTotal] = useState(0)
  const [itemTotal, setItemTotal] = useState(0)
  const [liveCount, setLiveCount] = useState(status?.itemCount ?? 0)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [endedAt, setEndedAt] = useState<number | null>(null)
  const cancelRef = useRef(false)
  const logRef = useRef<HTMLDivElement>(null)
  const bcLogRef = useRef<HTMLDivElement>(null)

  // Keep liveCount in sync with status when not running
  useEffect(() => { if (!running) setLiveCount(status?.itemCount ?? 0) }, [status?.itemCount, running])

  // Poll DB count while sync is running
  useEffect(() => {
    if (!running) return
    const t = setInterval(async () => {
      try {
        const r = await fetch("/api/warehouse/sync/status")
        const d = await r.json()
        setLiveCount(d.itemCount ?? 0)
      } catch {}
    }, 2000)
    return () => clearInterval(t)
  }, [running])

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log.length])
  useEffect(() => {
    if (bcLogRef.current) bcLogRef.current.scrollTop = bcLogRef.current.scrollHeight
  }, [bcLog.length])

  function addLog(level: LogEntry["level"], text: string) {
    setLog(l => [...l, { time: Date.now(), level, text }])
  }
  function addBcLog(level: LogEntry["level"], text: string) {
    setBcLog(l => [...l, { time: Date.now(), level, text }])
  }

  // ── Per-stage runners ────────────────────────────────────────────────────
  // Each returns { items, batches } and logs both human-readable and raw BC info

  async function runStage(
    endpoint: "receipt-lines" | "auction-lines" | "changelog" | "totes" | "totes-active",
    label: string,
    full: boolean,
  ): Promise<{ items: number; batches: number }> {
    let more = true
    let batch = 0
    let items = 0
    let nextLink: string | null = null
    while (more) {
      if (cancelRef.current) { addLog("warn", "Cancelled by user"); break }
      batch++
      let t0 = Date.now()
      addLog("info", `  Batch ${batch} · fetching up to 5,000…`)
      let retries = 0
      while (true) {
        try {
          const res: Response = await fetch(`/api/warehouse/sync/${endpoint}`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ full: batch === 1 ? full : false, nextLink, maxItems: 5000 }),
          })
          const data: any = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
          const ms = Date.now() - t0
          items += data.itemsProcessed ?? 0
          setItemTotal(t => t + (data.itemsProcessed ?? 0))
          setBatchTotal(b => b + 1)
          addLog("ok", `  Batch ${batch} done — ${(data.itemsProcessed ?? 0).toLocaleString()} items in ${(ms / 1000).toFixed(1)}s · ${data.pages ?? 0} pages${data.more ? " · more remaining…" : " · finished"}`)
          addBcLog(
            data.more ? "info" : "warn",
            `[${label}] batch ${batch} → BC pages: ${data.pages ?? "?"}, items processed: ${data.itemsProcessed ?? "?"}, more: ${data.more}, nextLink: ${data.nextLink ? data.nextLink.slice(-80) : "(none)"}`,
          )
          more = data.more === true
          nextLink = data.nextLink ?? null
          if (batch >= 500) { addLog("warn", "  Safety cap (500 batches) reached — stopping"); break }
          break // success — exit retry loop
        } catch (e: any) {
          const isNetwork = e.message === "Failed to fetch" || e.message?.includes("network")
          if (isNetwork && retries < 3) {
            retries++
            addLog("warn", `  Batch ${batch} network error — retrying (${retries}/3)…`)
            await new Promise(r => setTimeout(r, 3000 * retries))
            t0 = Date.now()
            continue
          }
          addLog("error", `  Batch ${batch} failed: ${e.message ?? e}`)
          addBcLog("error", `[${label}] batch ${batch} → ${e.message ?? e}`)
          throw e
        }
      }
    }
    return { items, batches: batch }
  }

  async function runOneStage(
    endpoint: "receipt-lines" | "auction-lines" | "changelog" | "totes" | "totes-active",
    label: string,
    full: boolean,
  ) {
    if (running) return
    cancelRef.current = false
    setRunning(true)
    setError(null)
    setLog([])
    setBcLog([])
    setBatchTotal(0)
    setItemTotal(0)
    setStartedAt(Date.now())
    setEndedAt(null)
    setPhase(label)
    addLog("info", `${full ? "FULL re-sync" : "Incremental sync"} · ${label}`)
    try {
      const { items } = await runStage(endpoint, label, full)
      addLog("ok", `${label} complete — ${items.toLocaleString()} items processed`)
    } catch (e: any) {
      const msg = e.message ?? String(e)
      setError(msg)
      addLog("error", `✗ Stopped: ${msg}`)
      setPhase("Failed")
    } finally {
      setEndedAt(Date.now())
      setRunning(false)
      await onComplete()
    }
  }

  async function runSync(opts: { full?: boolean } = {}) {
    if (running) return
    const { full = false } = opts
    cancelRef.current = false
    setRunning(true)
    setError(null)
    setLog([])
    setBcLog([])
    setBatchTotal(0)
    setItemTotal(0)
    setStartedAt(Date.now())
    setEndedAt(null)
    addLog("info", full
      ? "Starting FULL re-sync — re-fetching everything from Business Central…"
      : "Starting sync — connecting to Business Central…")

    try {
      // ── Stage 1: Receipt Lines ──────────────────────────────────────────────
      // Uses BC's @odata.nextLink (skiptoken) pagination so we can walk past
      // BC's $skip cap (~38k). The server returns nextLink in each response;
      // we pass it back on the next call until it becomes null.
      setPhase("Receipt Lines")
      addLog("info", `Stage 1/6 · Receipt Lines (the main item list)${full ? " — FULL re-sync" : " — incremental"}`)
      const r1 = await runStage("receipt-lines", "Receipt Lines", full)
      addLog("ok", `Stage 1 complete — ${r1.items.toLocaleString()} items processed`)

      // ── Stage 2: Auction Lines ──────────────────────────────────────────────
      if (!cancelRef.current) {
        setPhase("Auction Lines")
        addLog("info", `Stage 2/6 · Auction Lines (current lot numbers, vendor emails)${full ? " — FULL re-sync" : " — incremental"}`)
        const r2 = await runStage("auction-lines", "Auction Lines", full)
        addLog("ok", `Stage 2 complete — ${r2.items.toLocaleString()} items processed`)
      }

      // ── Stage 3: Change Log ─────────────────────────────────────────────────
      if (!cancelRef.current) {
        setPhase("Change Log")
        addLog("info", `Stage 3/6 · Change Log (latest location scans)${full ? " — FULL re-sync" : " — incremental"}`)
        try {
          const r3 = await runStage("changelog", "Change Log", full)
          addLog("ok", `Stage 3 complete — ${r3.items.toLocaleString()} entries processed`)
        } catch (e: any) {
          // Changelog is best-effort — don't fail the overall sync
          addLog("warn", `Stage 3 failed (non-fatal): ${e.message ?? e}`)
        }
      }

      // ── Stage 4: Totes (all) ────────────────────────────────────────────────
      if (!cancelRef.current) {
        setPhase("Totes")
        addLog("info", `Stage 4/6 · Totes — all T/P-prefixed totes from Totes_Excel${full ? " — FULL re-sync" : ""}`)
        try {
          const r4 = await runStage("totes", "Totes", full)
          addLog("ok", `Stage 4 complete — ${r4.items.toLocaleString()} totes processed`)
        } catch (e: any) {
          addLog("warn", `Stage 4 failed (non-fatal): ${e.message ?? e}`)
        }
      }

      // ── Stage 5: Active Totes (enrichment) ─────────────────────────────────
      if (!cancelRef.current) {
        setPhase("Active Totes")
        addLog("info", "Stage 5/6 · Active Totes — enriching from Receipt_Totes_Excel (vendor, location, status)")
        try {
          const r5 = await runStage("totes-active", "Active Totes", false)
          addLog("ok", `Stage 5 complete — ${r5.items.toLocaleString()} active totes enriched`)
        } catch (e: any) {
          addLog("warn", `Stage 5 failed (non-fatal): ${e.message ?? e}`)
        }
      }

      // ── Stage 6: Auction Names ──────────────────────────────────────────────
      if (!cancelRef.current) {
        setPhase("Auction Names")
        addLog("info", "Stage 6/6 · Auction Names — storing sale names from Auction_Lines_Excel")
        try {
          const res = await fetch("/api/warehouse/sync/auction-names", { method: "POST" })
          const data = await res.json()
          addLog("ok", `Stage 6 complete — ${data.namesWritten ?? 0} names written for ${data.codesFound ?? 0} codes`)
        } catch (e: any) {
          addLog("warn", `Stage 6 failed (non-fatal): ${e.message ?? e}`)
        }
      }

      addLog("ok", "✓ All sync stages finished")
      setPhase("Done")
    } catch (e: any) {
      const msg = e.message ?? String(e)
      setError(msg)
      addLog("error", `✗ Sync stopped: ${msg}`)
      setPhase("Failed")
    } finally {
      setEndedAt(Date.now())
      setRunning(false)
      await onComplete()
    }
  }

  function fmtTime(t: number): string {
    return new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  }

  function fmtAge(iso: string | undefined): string {
    if (!iso) return "never"
    const ms = Date.now() - new Date(iso).getTime()
    const m = Math.floor(ms / 60000)
    if (m < 1) return "just now"
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
  }

  const elapsedSec = startedAt ? Math.floor(((endedAt ?? Date.now()) - startedAt) / 1000) : 0
  const elapsedStr = `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`

  return (
    <div className="h-full overflow-y-auto p-6 max-w-4xl mx-auto">
      <h2 className="text-xl font-semibold text-white mb-1">Data Sync</h2>
      <p className="text-sm text-gray-400 mb-6">
        Pulls warehouse items, current lot numbers, and location scans from Business Central into the local database.
        Subsequent runs are incremental — only changed records are re-fetched.
      </p>

      {/* Stats grid — each table card has its own re-sync buttons */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Items in DB</div>
          <div className="text-2xl font-mono text-white">{liveCount.toLocaleString()}</div>
          <div className="text-xs text-gray-500 mt-1">{(status?.toteCount ?? 0).toLocaleString()} totes</div>
        </div>

        {/* Receipt Lines */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 flex flex-col">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Receipt Lines</div>
          <div className="text-sm text-gray-200">{fmtAge(status?.sources.receipt_lines?.completedAt)}</div>
          <div className="text-xs text-gray-500">{status?.sources.receipt_lines?.itemsProcessed?.toLocaleString() ?? 0} last run</div>
          <div className="mt-2 flex gap-1">
            <button
              disabled={running}
              onClick={() => runOneStage("receipt-lines", "Receipt Lines", false)}
              className="flex-1 text-[11px] px-2 py-1 rounded bg-blue-900/40 hover:bg-blue-800/60 text-blue-300 disabled:opacity-30 transition-colors"
              title="Incremental sync of receipt lines only"
            >
              ⟳ Sync
            </button>
            <button
              disabled={running}
              onClick={() => {
                if (!confirm("Full re-sync of Receipt Lines? This walks the entire ~186k row table and can take 5+ minutes.")) return
                runOneStage("receipt-lines", "Receipt Lines", true)
              }}
              className="flex-1 text-[11px] px-2 py-1 rounded bg-amber-900/40 hover:bg-amber-800/60 text-amber-300 disabled:opacity-30 transition-colors"
              title="Re-fetch every row from BC"
            >
              ⤓ Full
            </button>
          </div>
        </div>

        {/* Auction Lines */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 flex flex-col">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Auction Lines</div>
          <div className="text-sm text-gray-200">{fmtAge(status?.sources.auction_lines?.completedAt)}</div>
          <div className="text-xs text-gray-500">{status?.sources.auction_lines?.itemsProcessed?.toLocaleString() ?? 0} last run</div>
          <div className="mt-2 flex gap-1">
            <button
              disabled={running}
              onClick={() => runOneStage("auction-lines", "Auction Lines", false)}
              className="flex-1 text-[11px] px-2 py-1 rounded bg-blue-900/40 hover:bg-blue-800/60 text-blue-300 disabled:opacity-30 transition-colors"
            >
              ⟳ Sync
            </button>
            <button
              disabled={running}
              onClick={() => {
                if (!confirm("Full re-sync of Auction Lines?")) return
                runOneStage("auction-lines", "Auction Lines", true)
              }}
              className="flex-1 text-[11px] px-2 py-1 rounded bg-amber-900/40 hover:bg-amber-800/60 text-amber-300 disabled:opacity-30 transition-colors"
            >
              ⤓ Full
            </button>
          </div>
        </div>

        {/* Change Log */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 flex flex-col">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Change Log</div>
          <div className="text-sm text-gray-200">{fmtAge(status?.sources.changelog?.completedAt)}</div>
          <div className="text-xs text-gray-500">{status?.sources.changelog?.itemsProcessed?.toLocaleString() ?? 0} last run</div>
          <div className="mt-2 flex gap-1">
            <button
              disabled={running}
              onClick={() => runOneStage("changelog", "Change Log", false)}
              className="flex-1 text-[11px] px-2 py-1 rounded bg-blue-900/40 hover:bg-blue-800/60 text-blue-300 disabled:opacity-30 transition-colors"
            >
              ⟳ Sync
            </button>
            <button
              disabled={running}
              onClick={() => {
                if (!confirm("Full re-sync of Change Log?")) return
                runOneStage("changelog", "Change Log", true)
              }}
              className="flex-1 text-[11px] px-2 py-1 rounded bg-amber-900/40 hover:bg-amber-800/60 text-amber-300 disabled:opacity-30 transition-colors"
            >
              ⤓ Full
            </button>
          </div>
        </div>

        {/* Totes — Totes_Excel (all) */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 flex flex-col">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Totes</div>
          <div className="text-sm text-gray-200">{fmtAge(status?.sources.totes?.completedAt)}</div>
          <div className="text-xs text-gray-500">{status?.sources.totes?.itemsProcessed?.toLocaleString() ?? 0} last run</div>
          <div className="mt-2 flex gap-1">
            <button
              disabled={running}
              onClick={() => runOneStage("totes", "Totes", false)}
              className="flex-1 text-[11px] px-2 py-1 rounded bg-blue-900/40 hover:bg-blue-800/60 text-blue-300 disabled:opacity-30 transition-colors"
              title="Sync all T/P-prefixed totes from Totes_Excel"
            >
              ⟳ Sync
            </button>
            <button
              disabled={running}
              onClick={() => {
                if (!confirm("Full re-sync of Totes? This clears and re-fetches all totes.")) return
                runOneStage("totes", "Totes", true)
              }}
              className="flex-1 text-[11px] px-2 py-1 rounded bg-amber-900/40 hover:bg-amber-800/60 text-amber-300 disabled:opacity-30 transition-colors"
            >
              ⤓ Full
            </button>
          </div>
        </div>

        {/* Active Totes — Receipt_Totes_Excel (enrichment) */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 flex flex-col">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Active Totes</div>
          <div className="text-sm text-gray-200">{fmtAge(status?.sources["totes-active"]?.completedAt)}</div>
          <div className="text-xs text-gray-500">{status?.sources["totes-active"]?.itemsProcessed?.toLocaleString() ?? 0} last run</div>
          <div className="mt-2 flex gap-1">
            <button
              disabled={running}
              onClick={() => runOneStage("totes-active", "Active Totes", false)}
              className="flex-1 text-[11px] px-2 py-1 rounded bg-blue-900/40 hover:bg-blue-800/60 text-blue-300 disabled:opacity-30 transition-colors"
              title="Enrich active totes with location and vendor data from Receipt_Totes_Excel"
            >
              ⟳ Sync
            </button>
          </div>
        </div>
      </div>

      {/* Run buttons */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        {!running ? (
          <>
            <button
              onClick={() => runSync()}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium text-sm transition-colors"
            >
              ⟳ Run sync now
            </button>
            <button
              onClick={() => {
                if (!confirm("Full re-sync ignores the last-synced timestamp and re-fetches every record from Business Central. This can take 15+ minutes. Continue?")) return
                runSync({ full: true })
              }}
              className="px-5 py-2.5 bg-amber-700/80 hover:bg-amber-600 text-white rounded-lg font-medium text-sm transition-colors"
              title="Re-fetches everything from BC — use if items appear missing"
            >
              ⤓ Full re-sync
            </button>
          </>
        ) : (
          <button
            onClick={() => { cancelRef.current = true; addLog("warn", "Cancel requested — finishing current batch…") }}
            className="px-5 py-2.5 bg-red-700 hover:bg-red-600 text-white rounded-lg font-medium text-sm transition-colors"
          >
            ⛔ Cancel
          </button>
        )}

        {running && (
          <div className="flex items-center gap-3 text-sm">
            <div className="flex items-center gap-2 text-yellow-400">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span className="font-medium">{phase}</span>
            </div>
            <span className="text-gray-400">·</span>
            <span className="text-gray-300">{batchTotal} batch{batchTotal === 1 ? "" : "es"}</span>
            <span className="text-gray-400">·</span>
            <span className="text-gray-300">{itemTotal.toLocaleString()} items processed</span>
            <span className="text-gray-400">·</span>
            <span className="text-gray-500 tabular-nums">{elapsedStr}</span>
          </div>
        )}

        {!running && endedAt && !error && (
          <span className="text-sm text-emerald-400">✓ Finished in {elapsedStr} · {itemTotal.toLocaleString()} items processed</span>
        )}
        {!running && error && (
          <span className="text-sm text-red-400">✗ Stopped after {elapsedStr}</span>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 bg-red-950/40 border border-red-700/50 rounded-lg p-3">
          <div className="text-sm font-semibold text-red-300 mb-1">Sync error</div>
          <div className="text-xs text-red-200 font-mono break-all">{error}</div>
        </div>
      )}

      {/* Log */}
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-gray-500 uppercase tracking-wider">Activity log</span>
        {log.length > 0 && (
          <button onClick={() => setLog([])} className="text-xs text-gray-500 hover:text-gray-300">Clear</button>
        )}
      </div>
      <div
        ref={logRef}
        className="bg-black/50 border border-gray-800 rounded-lg p-3 font-mono text-xs h-96 overflow-y-auto"
      >
        {log.length === 0 ? (
          <div className="text-gray-600 italic">No activity yet — click "Run sync now" to begin.</div>
        ) : (
          log.map((entry, i) => {
            const colour =
              entry.level === "ok"    ? "text-emerald-400" :
              entry.level === "warn"  ? "text-yellow-400"  :
              entry.level === "error" ? "text-red-400"     :
                                        "text-gray-400"
            return (
              <div key={i} className={`${colour} leading-relaxed whitespace-pre-wrap`}>
                <span className="text-gray-600">[{fmtTime(entry.time)}]</span> {entry.text}
              </div>
            )
          })
        )}
      </div>

      {/* Raw BC response feed */}
      <div className="mt-4 mb-1 flex items-center justify-between">
        <span className="text-xs text-gray-500 uppercase tracking-wider">Raw BC responses</span>
        {bcLog.length > 0 && (
          <button onClick={() => setBcLog([])} className="text-xs text-gray-500 hover:text-gray-300">Clear</button>
        )}
      </div>
      <div
        ref={bcLogRef}
        className="bg-black/50 border border-gray-800 rounded-lg p-3 font-mono text-[11px] h-56 overflow-y-auto"
      >
        {bcLog.length === 0 ? (
          <div className="text-gray-600 italic">Each BC response logged here — page count, items returned, whether a nextLink was issued, and the tail of the skiptoken if present. If BC stops issuing nextLink before all rows are walked, that's how to spot it.</div>
        ) : (
          bcLog.map((entry, i) => {
            const colour =
              entry.level === "ok"    ? "text-emerald-400" :
              entry.level === "warn"  ? "text-yellow-400"  :
              entry.level === "error" ? "text-red-400"     :
                                        "text-cyan-300"
            return (
              <div key={i} className={`${colour} leading-relaxed whitespace-pre-wrap break-all`}>
                <span className="text-gray-600">[{fmtTime(entry.time)}]</span> {entry.text}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BCWarehousePage() {
  const [tab, setTab] = useState<Tab>("heatmap")
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [showFirstSync, setShowFirstSync] = useState(false)
  const syncingRef = useRef(false)

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/warehouse/sync/status")
      const d: SyncStatus = await r.json()
      setStatus(d)
      setShowFirstSync(d.itemCount === 0)
      return d
    } catch { return null }
  }, [])

  async function triggerIncrementalSync() {
    if (syncingRef.current) return
    syncingRef.current = true
    try {
      // Loop receipt-lines until more === false (each call handles 5 pages × 500 = 2,500 items)
      let more = true
      let safety = 0
      while (more && safety < 200) {
        const res = await fetch("/api/warehouse/sync/receipt-lines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ maxPages: 5 }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) break
        more = data.more === true
        safety++
        // Refresh status periodically so the user sees the count climb
        if (safety % 4 === 0) await fetchStatus()
      }
      const opts = { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
      await fetch("/api/warehouse/sync/auction-lines",  opts)
      await fetch("/api/warehouse/sync/changelog",      opts)
      await fetch("/api/warehouse/sync/totes",          opts)
      await fetch("/api/warehouse/sync/totes-active",   opts)
      await fetch("/api/warehouse/sync/auction-names",  opts)
      await fetchStatus()
    } finally {
      syncingRef.current = false
    }
  }

  useEffect(() => {
    fetchStatus().then(s => {
      if (!s) return
      if (s.itemCount === 0) return // let FirstSyncPanel handle it
      // Auto-sync if stale
      if (isStale(s.sources.receipt_lines?.completedAt)) {
        triggerIncrementalSync()
      }
    })
  }, [])

  const tabs: { id: Tab; label: string }[] = [
    { id: "heatmap",          label: "Location Heatmap" },
    { id: "sale-checklist",   label: "Sale Checklist" },
    { id: "search",           label: "Search by Location" },
    { id: "location-history", label: "Location History" },
    { id: "tote-data",        label: "Tote Data" },
    { id: "collections-due",  label: "Collections Due" },
    { id: "data-sync",        label: "Data Sync" },
    { id: "db-explorer",     label: "DB Explorer" },
  ]

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      {/* Tab bar */}
      <div className="flex gap-1 px-4 pt-3 border-b border-gray-800 shrink-0">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm rounded-t transition-colors ${
              tab === t.id
                ? "bg-gray-800 text-white border-b-2 border-blue-500"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {showFirstSync ? (
          <FirstSyncPanel onComplete={() => { setShowFirstSync(false); fetchStatus() }} />
        ) : (
          <>
            {tab === "heatmap"          && <WarehouseHeatmapTab />}
            {tab === "sale-checklist"   && <SaleChecklistTab />}
            {tab === "search"           && <SearchByLocationTab />}
            {tab === "location-history" && <LocationHistoryTab />}
            {tab === "tote-data"        && <ToteDataTab />}
            {tab === "collections-due"  && <CollectionsDueTab />}
            {tab === "data-sync"        && <DataSyncTab status={status} onComplete={fetchStatus} />}
            {tab === "db-explorer"     && <DbExplorerTab />}
          </>
        )}
      </div>

      {/* Sync bar */}
      {!showFirstSync && (
        <SyncBar
          status={status}
          onSync={() => { triggerIncrementalSync(); fetchStatus() }}
        />
      )}
    </div>
  )
}
