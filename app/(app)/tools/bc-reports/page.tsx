"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import Logo from "@/components/logo"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  LabelList, ResponsiveContainer, Cell,
  LineChart, Line,
} from "recharts"
import * as XLSX from "xlsx"
import { COUNTRY_NAMES } from "@/lib/country-names"
import { WorldMap, UKMap } from "./ShipMaps"

// ─── Types ────────────────────────────────────────────────────────────────────

type CatData = {
  dailyAvg:  { user: string; avg: number }[]
  totalLots: { user: string; total: number }[]
  monthly:   { label: string; sort: string; total: number }[]
  meta:      { total: number; userCount: number }
}
type PackData = {
  dailyAvgCollections: { staff: string; avg: number }[]
  totalCollections:    { staff: string; total: number }[]
  dailyAvgLots:        { staff: string; avg: number }[]
  totalLots:           { staff: string; total: number }[]
  raw:                 { date: string; staff: string; docNo: string; lotCount: number; rawStaff?: string }[]
  meta:                {
    total:      number
    staffCount: number
    unmatched?: { raw: string; count: number }[]
    merges?:    { canonical: string; variants: string[] }[]
  }
}
type WhData = {
  byCategory:   { category: string; count: number }[]
  byCataloguer: { cataloguer: string; count: number }[]
  raw:          { category: string; cataloguer: string; catalogued: boolean; barcode: string; description: string }[]
  meta:         { total: number; openTotes: number; categoryCount: number; largestCategory: string }
}

type Region = "UK" | "Europe" | "Rest of World"
type ShipData = {
  byCountry: { country: string; count: number }[]
  byCity:    { city: string; country: string; count: number }[]
  byRegion:  { region: Region; parcels: number; items: number; revenue: number }[]
  bySize:    { size: string; items: number; revenue: number }[]
  byMonth:   { month: string; parcels: number; items: number; revenue: number }[]
  byDeliveryStatus: { status: string; items: number; revenue: number }[]
  byCountrySize: {
    country: string; region: Region; parcels: number; items: number
    revenue: number; rated: boolean; sizes: Record<string, number>
  }[]
  sizesPresent: string[]
  meta: {
    total: number; countries: number; cities: number
    itemsWithSize: number; parcelsWithSize: number; parcelsWithoutSize: number
    sizeDataAvailable: boolean; estRevenueTotal: number
    unratedParcels: number; unratedItems: number
  }
}

type Report = "cataloguing" | "packing" | "warehouse" | "explorer" | "shipping"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function today()      { return new Date().toISOString().split("T")[0] }
function daysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split("T")[0]
}
function startOfMonth() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split("T")[0]
}
function startOfYear() { return new Date(new Date().getFullYear(), 0, 1).toISOString().split("T")[0] }
function last12Months() {
  const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().split("T")[0]
}
function lastMonthRange(): [string, string] {
  const d = new Date()
  const end   = new Date(d.getFullYear(), d.getMonth(), 0)
  const start = new Date(end.getFullYear(), end.getMonth(), 1)
  return [start.toISOString().split("T")[0], end.toISOString().split("T")[0]]
}
function exportXlsx(rows: object[], filename: string) {
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Report")
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

// ─── Bar chart ────────────────────────────────────────────────────────────────

function HBar({ data, valueKey, labelKey }: { data: object[]; valueKey: string; labelKey: string }) {
  if (!data.length) return <p className="text-gray-600 dark:text-gray-500 text-sm py-6 text-center">No data</p>
  const barH  = Math.max(28, Math.min(48, 600 / data.length))
  const chartH = data.length * barH + 50
  return (
    <ResponsiveContainer width="100%" height={chartH}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 60, left: 180, bottom: 20 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#1e2130" />
        <XAxis
          type="number" tick={{ fontSize: 11, fill: "#6b7280" }}
          tickLine={false} axisLine={false}
          label={{ value: valueKey, position: "insideBottom", offset: -10, fill: "#6b7280", fontSize: 11 }}
        />
        <YAxis
          type="category" dataKey={labelKey} width={175}
          tick={{ fontSize: 12, fill: "#c8c8d8" }} tickLine={false} axisLine={false}
        />
        <Tooltip
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          contentStyle={{ background: "#1c1f27", border: "1px solid #2d3047", borderRadius: 6, fontSize: 13, color: "#fff" }}
        />
        <Bar dataKey={valueKey} radius={[0, 3, 3, 0]} maxBarSize={36} isAnimationActive={false}>
          {data.map((_, i) => <Cell key={i} fill="#0078D4" />)}
          <LabelList dataKey={valueKey} position="right" style={{ fontSize: 12, fill: "#c8c8d8" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── Date presets + range ─────────────────────────────────────────────────────

function DateRange({ from, to, onChange, onPreset }: {
  from: string; to: string
  onChange: (f: string, t: string) => void
  onPreset: (f: string, t: string) => void
}) {
  const presets = [
    { label: "Today",          from: today(),            to: today() },
    { label: "Last 7 days",    from: daysAgo(6),         to: today() },
    { label: "Last 30 days",   from: daysAgo(29),        to: today() },
    { label: "This month",     from: startOfMonth(),      to: today() },
    { label: "Last month",     from: lastMonthRange()[0], to: lastMonthRange()[1] },
    { label: "Last 12 months", from: last12Months(),      to: today() },
    { label: "This year",      from: startOfYear(),       to: today() },
  ]
  // Track which preset was explicitly selected — never derive from date comparison
  // (two presets can produce the same dates, e.g. on the 1st of the month)
  const [activePreset, setActivePreset] = useState<string | null>(
    () => presets.find(p => p.from === from && p.to === to)?.label ?? null
  )
  return (
    <div className="space-y-3 mb-4">
      <div className="flex gap-2">
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => { setActivePreset(p.label); onPreset(p.from, p.to) }}
            className={`flex-1 px-2 py-1.5 text-xs font-medium rounded border transition-colors ${
              activePreset === p.label
                ? "bg-[#0078D4] text-gray-900 dark:text-white border-[#0078D4]"
                : "bg-gray-100 dark:bg-[#0d0f1a] text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-700 hover:border-gray-500 hover:text-gray-200"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex gap-4">
        <div className="flex-1">
          <label className="block text-xs text-gray-600 dark:text-gray-500 mb-1 uppercase tracking-wider">From</label>
          <input
            type="date" value={from}
            onChange={(e) => { setActivePreset(null); onChange(e.target.value, to) }}
            className="w-full bg-gray-100 dark:bg-[#0d0f1a] border border-gray-300 dark:border-gray-700 rounded px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-gray-600 dark:text-gray-500 mb-1 uppercase tracking-wider">To</label>
          <input
            type="date" value={to}
            onChange={(e) => { setActivePreset(null); onChange(from, e.target.value) }}
            className="w-full bg-gray-100 dark:bg-[#0d0f1a] border border-gray-300 dark:border-gray-700 rounded px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>
    </div>
  )
}

// ─── Sub tabs ─────────────────────────────────────────────────────────────────

function SubTabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div className="flex gap-1 mb-5">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
            active === t ? "bg-[#0078D4] text-gray-900 dark:text-white" : "text-gray-600 dark:text-gray-400 hover:text-gray-200 bg-gray-100 dark:bg-[#0d0f1a] border border-gray-300 dark:border-gray-700"
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

// ─── Packing icon nav ─────────────────────────────────────────────────────────

const PACKING_NAV_ITEMS = [
  {
    id: "Overview",
    label: "Overview",
    desc: "Summary stats & trend",
    icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  },
  {
    id: "Capacity",
    label: "Capacity",
    desc: "Throughput & catch-up",
    icon: "M13 10V3L4 14h7v7l9-11h-7z",
  },
  {
    id: "Collection Dockets Daily Avg",
    label: "Dockets Daily Avg",
    desc: "Avg dockets per person",
    icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  },
  {
    id: "Collection Dockets Total",
    label: "Dockets Total",
    desc: "Total dockets by person",
    icon: "M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2",
  },
  {
    id: "Lots Daily Avg",
    label: "Lots Daily Avg",
    desc: "Avg lots packed per day",
    icon: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
  },
  {
    id: "Total Lots",
    label: "Total Lots",
    desc: "Total lots by person",
    icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
  },
  {
    id: "Lots Over Time",
    label: "Lots Over Time",
    desc: "Daily / weekly / monthly",
    icon: "M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4v16",
  },
  {
    id: "Raw Data",
    label: "Raw Data",
    desc: "Full shipment records",
    icon: "M4 6h16M4 10h16M4 14h16M4 18h16",
  },
]

function PackingSubNav({ active, onChange }: { active: string; onChange: (t: string) => void }) {
  return (
    <div className="grid grid-cols-4 gap-2 mb-6">
      {PACKING_NAV_ITEMS.map(item => (
        <button
          key={item.id}
          onClick={() => onChange(item.id)}
          className={`flex flex-col items-start gap-1.5 p-3 rounded-xl border text-left transition-all ${
            active === item.id
              ? "bg-blue-950/40 border-blue-600"
              : "bg-gray-100 dark:bg-[#0d0f1a] border-gray-200 dark:border-gray-800 hover:border-gray-600"
          }`}
        >
          <svg
            className={`w-5 h-5 flex-shrink-0 ${active === item.id ? "text-blue-400" : "text-gray-600 dark:text-gray-500"}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
          </svg>
          <p className={`text-xs font-semibold leading-tight ${active === item.id ? "text-gray-900 dark:text-white" : "text-gray-600 dark:text-gray-300"}`}>{item.label}</p>
          <p className="text-xs text-gray-600 dark:text-gray-500 leading-tight">{item.desc}</p>
        </button>
      ))}
    </div>
  )
}

// ─── Meta bar ─────────────────────────────────────────────────────────────────

function MetaBar({ text }: { text: string }) {
  return <p className="text-xs text-gray-600 dark:text-gray-500 mb-4">{text}</p>
}

// ─── Load button ──────────────────────────────────────────────────────────────

function LoadBtn({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick} disabled={loading}
      className="mb-5 px-5 py-2 bg-[#0078D4] hover:bg-blue-500 text-gray-900 dark:text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
    >
      {loading ? "Loading…" : "↺ Reload"}
    </button>
  )
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ done, total, label, unit }: { done: number; total: number; label?: string; unit?: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : null
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs text-gray-600 dark:text-gray-500 mb-1.5">
        <span>{label ?? "Fetching data…"}</span>
        <span>
          {pct !== null
            ? `${done.toLocaleString()} / ${total.toLocaleString()} ${unit ?? "records"} (${pct}%)`
            : `${done.toLocaleString()} ${unit ?? "records"}…`}
        </span>
      </div>
      <div className="h-1.5 bg-white dark:bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-[#0078D4] rounded-full transition-all duration-300"
          style={{ width: pct !== null ? `${pct}%` : "40%" }}
        />
      </div>
    </div>
  )
}

// ─── Cataloguing tab ──────────────────────────────────────────────────────────

function CataloguingTab() {
  const [from, setFrom] = useState(daysAgo(29))
  const [to, setTo]     = useState(today())
  const [mode, setMode] = useState<"barcode" | "uniqueid" | "compare">("uniqueid")
  const [data, setData] = useState<CatData | null>(null)
  const [compareData, setCompareData] = useState<{ barcode: CatData; uniqueid: CatData } | null>(null)
  const [loading, setLoading]   = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [subTab, setSubTab]     = useState("Daily Average")

  // Load a single mode's data — returns the parsed result or throws.
  async function loadOne(f: string, t: string, m: "barcode" | "uniqueid", onProgress?: (p: { done: number; total: number }) => void): Promise<CatData> {
    const res = await window.fetch(`/api/bc/cataloguing?from=${f}&to=${t}&mode=${m}`)
    if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? res.statusText) }
    const reader  = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let result: CatData | null = null
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop()!
      for (const line of lines) {
        if (!line.trim()) continue
        const msg = JSON.parse(line)
        if (msg.type === "progress") onProgress?.({ done: msg.done, total: msg.total })
        else if (msg.type === "result") result = msg.data
        else if (msg.type === "error")  throw new Error(msg.error)
      }
    }
    if (!result) throw new Error("No result received")
    return result
  }

  const load = useCallback(async (f: string, t: string, m: "barcode" | "uniqueid" | "compare") => {
    if (!f || !t) return
    setLoading(true); setError(null); setProgress(null)
    try {
      if (m === "compare") {
        // Fetch both in parallel — both share cache so this is fast on warm data
        const [bc, ui] = await Promise.all([
          loadOne(f, t, "barcode",  p => setProgress(p)),
          loadOne(f, t, "uniqueid", p => setProgress(p)),
        ])
        setCompareData({ barcode: bc, uniqueid: ui })
        setData(null)
      } else {
        const r = await loadOne(f, t, m, p => setProgress(p))
        setData(r)
        setCompareData(null)
      }
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false); setProgress(null) }
  }, [])

  // Auto-reload whenever any filter changes (debounced so manual date typing doesn't spam)
  useEffect(() => {
    const t = setTimeout(() => load(from, to, mode), 300)
    return () => clearTimeout(t)
  }, [from, to, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleDateChange(f: string, t: string) { setFrom(f); setTo(t) }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Cataloguing Report</h2>
      <DateRange from={from} to={to} onChange={handleDateChange} onPreset={handleDateChange} />

      {/* Counting-method explanation */}
      <div className="mb-4 bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-3 text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
        <span className="text-gray-900 dark:text-white font-medium">Auction Line UniqueID</span> is the accurate measure — it counts only new lot insertions as recorded in BC, matching what BC itself reports.{" "}
        <span className="text-gray-900 dark:text-white font-medium">Internal Barcode</span> counts every change to the barcode field, which inflates figures due to double-scanning, corrections and re-entries. Use Auction Line for performance tracking and Internal Barcode only if you need to investigate scanning activity.
      </div>

      {/* Counting-method toggle */}
      <div className="mb-4">
        <p className="text-xs text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-2">Counting method</p>
        <div className="inline-flex gap-1 bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-0.5 flex-wrap">
          <button
            onClick={() => setMode("uniqueid")}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              mode === "uniqueid" ? "bg-blue-600 text-gray-900 dark:text-white font-semibold" : "text-gray-600 dark:text-gray-400 hover:text-white"
            }`}
            title="Counts only Auction Line UniqueID Insertions — matches BC's Insertion-filtered view"
          >Auction Line UniqueID (insertions only)</button>
          <button
            onClick={() => setMode("barcode")}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              mode === "barcode" ? "bg-blue-600 text-gray-900 dark:text-white font-semibold" : "text-gray-600 dark:text-gray-400 hover:text-white"
            }`}
            title="Counts every change to the Internal Barcode field — the original report"
          >Internal Barcode (any change)</button>
          <button
            onClick={() => setMode("compare")}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              mode === "compare" ? "bg-blue-600 text-gray-900 dark:text-white font-semibold" : "text-gray-600 dark:text-gray-400 hover:text-white"
            }`}
            title="Shows both numbers per user side by side, with the difference (barcode edits minus new lots)"
          >Compare both</button>
        </div>
      </div>

      {loading && progress && <ProgressBar done={progress.done} total={progress.total} unit="chunks" />}
      {loading && !progress && <p className="text-xs text-gray-600 dark:text-gray-500 mb-4">Connecting…</p>}
      {!loading && <LoadBtn loading={loading} onClick={() => load(from, to, mode)} />}

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      {data && (
        <div className={loading ? "opacity-40 pointer-events-none transition-opacity" : "transition-opacity"}>
          <MetaBar text={`${from} — ${to}  ·  ${data.meta.total.toLocaleString()} entries  ·  ${data.meta.userCount} users`} />
          <SubTabs tabs={["Daily Average", "Total Lots", "Lots by Month"]} active={subTab} onChange={setSubTab} />
          {subTab === "Daily Average" && <><HBar data={data.dailyAvg} valueKey="avg" labelKey="user" /><ExportBtn onClick={() => exportXlsx(data.dailyAvg, `cataloguing_daily_avg_${mode}`)} /></>}
          {subTab === "Total Lots"    && <><HBar data={data.totalLots} valueKey="total" labelKey="user" /><ExportBtn onClick={() => exportXlsx(data.totalLots, `cataloguing_total_lots_${mode}`)} /></>}
          {subTab === "Lots by Month" && <><HBar data={data.monthly} valueKey="total" labelKey="label" /><ExportBtn onClick={() => exportXlsx(data.monthly, `cataloguing_monthly_${mode}`)} /></>}
        </div>
      )}

      {compareData && (
        <CompareView from={from} to={to} compare={compareData} loading={loading} />
      )}
    </div>
  )
}

// ─── Compare-both view ───────────────────────────────────────────────────────
// Shows the two counting methods side by side per user, plus the gap.
// Gap = (Barcode total) − (UniqueID total). Positive gap = the cataloguer
// edited barcodes more often than they created new lots; negative gap shouldn't
// really happen but we colour-code it just in case.

function CompareView({
  from, to, compare, loading,
}: {
  from:    string
  to:      string
  compare: { barcode: CatData; uniqueid: CatData }
  loading: boolean
}) {
  const [sortBy, setSortBy] = useState<"barcode" | "uniqueid" | "gap" | "user">("uniqueid")

  // Merge both datasets keyed by user
  const byUser = new Map<string, { user: string; barcode: number; uniqueid: number; barcodeAvg: number; uniqueidAvg: number }>()
  for (const r of compare.barcode.totalLots) {
    byUser.set(r.user, { user: r.user, barcode: r.total, uniqueid: 0, barcodeAvg: 0, uniqueidAvg: 0 })
  }
  for (const r of compare.uniqueid.totalLots) {
    const e = byUser.get(r.user) ?? { user: r.user, barcode: 0, uniqueid: 0, barcodeAvg: 0, uniqueidAvg: 0 }
    e.uniqueid = r.total
    byUser.set(r.user, e)
  }
  for (const r of compare.barcode.dailyAvg)  { const e = byUser.get(r.user); if (e) e.barcodeAvg  = r.avg }
  for (const r of compare.uniqueid.dailyAvg) { const e = byUser.get(r.user); if (e) e.uniqueidAvg = r.avg }

  const merged = [...byUser.values()].map(r => ({
    ...r,
    gap: r.barcode - r.uniqueid,
  }))

  const sorted = [...merged].sort((a, b) => {
    switch (sortBy) {
      case "user":     return a.user.localeCompare(b.user)
      case "barcode":  return b.barcode - a.barcode
      case "uniqueid": return b.uniqueid - a.uniqueid
      case "gap":      return b.gap - a.gap
    }
  })

  const totalBarcode  = merged.reduce((s, r) => s + r.barcode, 0)
  const totalUniqueid = merged.reduce((s, r) => s + r.uniqueid, 0)
  const totalGap      = totalBarcode - totalUniqueid

  return (
    <div className={loading ? "opacity-40 pointer-events-none transition-opacity" : "transition-opacity"}>
      <MetaBar text={`${from} — ${to}  ·  ${totalBarcode.toLocaleString()} barcode events  ·  ${totalUniqueid.toLocaleString()} new lots  ·  ${totalGap.toLocaleString()} gap`} />

      <div className="bg-gray-100 dark:bg-gray-900/30 border border-gray-200 dark:border-gray-800 rounded-lg p-3 mb-4 text-xs text-gray-600 dark:text-gray-300">
        <strong className="text-gray-900 dark:text-white">How to read this:</strong> "Barcode" counts every change to a lot's
        Internal Barcode (insertions + edits). "New lots" counts only Auction Line UniqueID Insertions.
        The <strong>Gap</strong> is Barcode − New lots — i.e. how many barcode edits a cataloguer made on top
        of creating new lots. A high gap means lots of corrections; a low gap means clean entry.
      </div>

      <div className="overflow-x-auto border border-gray-200 dark:border-gray-800 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-400 text-xs">
            <tr>
              <SortHeader label="User"             active={sortBy === "user"}     onClick={() => setSortBy("user")}     align="left" />
              <SortHeader label="Barcode (any)"    active={sortBy === "barcode"}  onClick={() => setSortBy("barcode")}  align="right" />
              <SortHeader label="Avg / day"        active={false}                 onClick={() => {}}                     align="right" small />
              <SortHeader label="New lots"         active={sortBy === "uniqueid"} onClick={() => setSortBy("uniqueid")} align="right" />
              <SortHeader label="Avg / day"        active={false}                 onClick={() => {}}                     align="right" small />
              <SortHeader label="Gap (edits)"      active={sortBy === "gap"}      onClick={() => setSortBy("gap")}       align="right" />
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.user} className="border-t border-gray-200 dark:border-gray-800 hover:bg-gray-200 dark:hover:bg-gray-900/40">
                <td className="px-3 py-2 text-gray-700 dark:text-gray-200 font-mono">{r.user}</td>
                <td className="px-3 py-2 text-right text-blue-700 dark:text-blue-300 font-semibold">{r.barcode.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-500 text-xs">{r.barcodeAvg.toFixed(1)}</td>
                <td className="px-3 py-2 text-right text-emerald-700 dark:text-emerald-300 font-semibold">{r.uniqueid.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-500 text-xs">{r.uniqueidAvg.toFixed(1)}</td>
                <td className={`px-3 py-2 text-right font-semibold ${r.gap > 0 ? "text-amber-300" : r.gap < 0 ? "text-red-400" : "text-gray-600 dark:text-gray-400"}`}>
                  {r.gap > 0 ? "+" : ""}{r.gap.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-900/60 font-bold text-gray-700 dark:text-gray-200">
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right text-blue-200">{totalBarcode.toLocaleString()}</td>
              <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-500 text-xs">—</td>
              <td className="px-3 py-2 text-right text-emerald-200">{totalUniqueid.toLocaleString()}</td>
              <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-500 text-xs">—</td>
              <td className={`px-3 py-2 text-right ${totalGap > 0 ? "text-amber-200" : "text-gray-600 dark:text-gray-400"}`}>
                {totalGap > 0 ? "+" : ""}{totalGap.toLocaleString()}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-4">
        <ExportBtn onClick={() => exportXlsx(sorted, "cataloguing_compare")} />
      </div>
    </div>
  )
}

function SortHeader({
  label, active, onClick, align, small,
}: {
  label:   string
  active:  boolean
  onClick: () => void
  align:   "left" | "right"
  small?:  boolean
}) {
  return (
    <th
      onClick={onClick}
      className={`px-3 py-2 cursor-pointer hover:text-white select-none whitespace-nowrap ${
        align === "right" ? "text-right" : "text-left"
      } ${small ? "text-[10px] text-gray-600 dark:text-gray-500" : ""} ${active ? "text-blue-400" : ""}`}
    >
      {label} {active && "↓"}
    </th>
  )
}

// ─── Packing tab ──────────────────────────────────────────────────────────────

function PackingTab() {
  const [from, setFrom] = useState(daysAgo(29))
  const [to, setTo]     = useState(today())
  const [data, setData] = useState<PackData | null>(null)
  const [loading, setLoading]   = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [subTab, setSubTab]     = useState("Overview")

  const load = useCallback(async (f: string, t: string) => {
    if (!f || !t) return
    setLoading(true); setError(null); setProgress(null)
    try {
      const res = await window.fetch(`/api/bc/packing?from=${f}&to=${t}`)
      if (!res.ok) {
        let msg = res.statusText
        try { const j = await res.json(); msg = j.error ?? msg } catch {}
        throw new Error(msg)
      }

      const reader  = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop()!
        for (const line of lines) {
          if (!line.trim()) continue
          const msg = JSON.parse(line)
          if (msg.type === "progress") setProgress({ done: msg.done, total: msg.total })
          else if (msg.type === "result") setData(msg.data)
          else if (msg.type === "error")  throw new Error(msg.error)
        }
      }
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false); setProgress(null) }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => load(from, to), 300)
    return () => clearTimeout(t)
  }, [from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleDateChange(f: string, t: string) { setFrom(f); setTo(t) }

  // Derive daily totals from raw for stats + chart
  const lotsPerDay = data
    ? data.raw.reduce((acc, r) => { acc[r.date] = (acc[r.date] ?? 0) + r.lotCount; return acc }, {} as Record<string, number>)
    : {}
  const timelineDates = Object.keys(lotsPerDay).sort()
  const totalLotsPacked = timelineDates.reduce((s, d) => s + lotsPerDay[d], 0)
  const avgLotsPerDay = timelineDates.length > 0 ? Math.round(totalLotsPacked / timelineDates.length) : 0
  const timelineData = timelineDates.map(d => ({ date: d, lots: lotsPerDay[d] }))

  // Collected lots count (BC change log — movements TO COLLECTED in date range)
  const [collectedLots, setCollectedLots] = useState<number | null>(null)
  const [collectedProgress, setCollectedProgress] = useState<{ done: number; total: number } | null>(null)
  const [collectedError, setCollectedError] = useState<string | null>(null)

  function fetchCollected(f: string, t: string) {
    setCollectedLots(null)
    setCollectedProgress(null)
    setCollectedError(null)
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/packing/collected-count?from=${f}&to=${t}`)
        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        while (true) {
          const { done, value } = await reader.read()
          if (done || cancelled) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n"); buffer = lines.pop()!
          for (const line of lines) {
            if (!line.trim()) continue
            const msg = JSON.parse(line)
            if (msg.type === "progress") setCollectedProgress({ done: msg.done, total: msg.total })
            else if (msg.type === "result") { setCollectedLots(msg.count ?? null); setCollectedProgress(null) }
            else if (msg.type === "error") { setCollectedError(msg.error); setCollectedProgress(null) }
          }
        }
      } catch (e: any) { setCollectedError(e.message ?? "Failed"); setCollectedProgress(null) }
    })()
    return () => { cancelled = true }
  }

  useEffect(() => fetchCollected(from, to), [from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  // Chart grouping
  const [chartGrouping, setChartGrouping] = useState<"daily" | "weekly" | "monthly">("daily")
  function groupedTimeline(raw: { date: string; lots: number }[]) {
    if (chartGrouping === "daily") return raw
    const grouped: Record<string, number> = {}
    for (const row of raw) {
      let key: string
      if (chartGrouping === "weekly") {
        const d = new Date(row.date + "T00:00:00Z")
        const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - (d.getUTCDay() === 0 ? 6 : d.getUTCDay() - 1))
        key = mon.toISOString().split("T")[0]
      } else {
        key = row.date.slice(0, 7)
      }
      grouped[key] = (grouped[key] ?? 0) + row.lots
    }
    return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([date, lots]) => ({ date, lots }))
  }

  // Monthly receipt lines (last 3 months)
  const [monthlyLots, setMonthlyLots] = useState<{ months: { month: string; count: number; auctions: number; avgPerAuction: number }[]; avgLots: number; avgPerAuction: number } | null>(null)
  const [monthlyLotsLoading, setMonthlyLotsLoading] = useState(true)
  const [monthlyLotsProgress, setMonthlyLotsProgress] = useState<{ done: number; total: number } | null>(null)
  const [monthlyLotsError, setMonthlyLotsError] = useState<string | null>(null)
  const [monthlyCollected, setMonthlyCollected] = useState<Record<string, number> | null>(null)
  const [monthlyCollectedLoading, setMonthlyCollectedLoading] = useState(true)
  const [monthlyCollectedProgress, setMonthlyCollectedProgress] = useState<{ done: number; total: number } | null>(null)
  const [monthlyCollectedError, setMonthlyCollectedError] = useState<string | null>(null)

  async function readStream(
    url: string,
    onProgress: (done: number, total: number) => void,
    onResult: (msg: any) => void,
    onError: (err: string) => void
  ) {
    const res = await fetch(url)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n"); buffer = lines.pop()!
      for (const line of lines) {
        if (!line.trim()) continue
        const msg = JSON.parse(line)
        if (msg.type === "progress") onProgress(msg.done, msg.total)
        else if (msg.type === "result") onResult(msg)
        else if (msg.type === "error") onError(msg.error ?? "Unknown error")
      }
    }
  }

  function fetchMonthlyLots() {
    setMonthlyLotsLoading(true)
    setMonthlyLotsError(null)
    setMonthlyLotsProgress(null)
    readStream(
      "/api/bc/receipt-monthly",
      (done, total) => setMonthlyLotsProgress({ done, total }),
      (msg) => { setMonthlyLots(msg.data); setMonthlyLotsProgress(null) },
      (err) => { setMonthlyLotsError(err); setMonthlyLotsProgress(null) }
    )
      .catch(e => setMonthlyLotsError(e.message))
      .finally(() => setMonthlyLotsLoading(false))
  }

  function fetchMonthlyCollected() {
    setMonthlyCollectedLoading(true)
    setMonthlyCollectedError(null)
    setMonthlyCollectedProgress(null)
    setMonthlyCollected(null)
    readStream(
      "/api/packing/collected-monthly",
      (done, total) => setMonthlyCollectedProgress({ done, total }),
      (msg) => { setMonthlyCollected(msg.byMonth); setMonthlyCollectedProgress(null) },
      (err) => { setMonthlyCollectedError(err); setMonthlyCollectedProgress(null) }
    )
      .catch(e => setMonthlyCollectedError(e.message))
      .finally(() => setMonthlyCollectedLoading(false))
  }

  useEffect(() => { fetchMonthlyLots(); fetchMonthlyCollected() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Capacity dashboard inputs
  const [capStaff,           setCapStaff]           = useState(11)
  const [capSalesMonth,      setCapSalesMonth]       = useState(14)
  const [capLotsPerSale,     setCapLotsPerSale]      = useState(550)
  const [capWorkDays,        setCapWorkDays]         = useState(22)
  const [capCollectedPerDay, setCapCollectedPerDay]  = useState(0)
  const [capBacklog,         setCapBacklog]          = useState(0)
  const [capHelpOpen,        setCapHelpOpen]         = useState(false)
  // Lock per-person rate once when data first loads so changing capStaff only affects throughput
  const [lockedRate, setLockedRate] = useState(0)
  const rateLockedRef = useRef(false)
  useEffect(() => {
    if (avgLotsPerDay > 0 && capStaff > 0 && !rateLockedRef.current) {
      setLockedRate(avgLotsPerDay / capStaff)
      rateLockedRef.current = true
    }
  }, [avgLotsPerDay]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Packing Report</h2>
      <DateRange from={from} to={to} onChange={handleDateChange} onPreset={handleDateChange} />
      {loading && progress && <ProgressBar done={progress.done} total={progress.total} unit="chunks" />}
      {loading && !progress && <p className="text-xs text-gray-600 dark:text-gray-500 mb-4">Connecting…</p>}
      {!loading && <LoadBtn loading={loading} onClick={() => load(from, to)} />}
      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
      {data && (
        <div className={loading ? "opacity-40 pointer-events-none transition-opacity" : "transition-opacity"}>
          <MetaBar text={`${from} — ${to}  ·  ${data.meta.total.toLocaleString()} shipments  ·  ${data.meta.staffCount} staff`} />

          {/* Match-quality panel — surfaces typos and missing packers */}
          {(data.meta.unmatched?.length || data.meta.merges?.length) ? (
            <details className="mb-3 bg-gray-100 dark:bg-[#0d0f1a] border border-gray-200 dark:border-gray-800 rounded-lg">
              <summary className="px-3 py-2 cursor-pointer text-xs text-gray-600 dark:text-gray-400 hover:text-gray-200 select-none">
                Name matching ·{" "}
                {data.meta.merges?.length
                  ? <span className="text-emerald-400">{data.meta.merges.reduce((s, m) => s + m.variants.length, 0)} variant{data.meta.merges.reduce((s, m) => s + m.variants.length, 0) === 1 ? "" : "s"} merged</span>
                  : null}
                {data.meta.merges?.length && data.meta.unmatched?.length ? "  ·  " : ""}
                {data.meta.unmatched?.length
                  ? <span className="text-amber-400">{data.meta.unmatched.length} unmatched name{data.meta.unmatched.length === 1 ? "" : "s"}</span>
                  : null}
              </summary>
              <div className="border-t border-gray-200 dark:border-gray-800 p-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                {data.meta.merges?.length ? (
                  <div>
                    <p className="text-emerald-400 font-semibold mb-1.5">Variants merged into canonical packer</p>
                    <ul className="space-y-1">
                      {data.meta.merges.map(m => (
                        <li key={m.canonical} className="flex flex-wrap items-baseline gap-1.5">
                          <span className="text-gray-700 dark:text-gray-200 font-medium">{m.canonical}</span>
                          <span className="text-gray-600">←</span>
                          {m.variants.map(v => (
                            <code key={v} className="bg-emerald-900/30 text-emerald-200 px-1.5 py-0.5 rounded">{v}</code>
                          ))}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {data.meta.unmatched?.length ? (
                  <div>
                    <p className="text-amber-400 font-semibold mb-1.5">Unmatched names — add them as packers or correct at source</p>
                    <ul className="space-y-1">
                      {data.meta.unmatched.map(u => (
                        <li key={u.raw} className="flex items-baseline gap-2">
                          <code className="bg-amber-900/30 text-amber-200 px-1.5 py-0.5 rounded">{u.raw}</code>
                          <span className="text-gray-600 dark:text-gray-500">{u.count} shipment{u.count === 1 ? "" : "s"}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-gray-600 mt-2">
                      Manage the packer list at{" "}
                      <a href="/tools/packing/packers" className="text-blue-400 hover:underline">/tools/packing/packers</a>
                    </p>
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}

          <PackingSubNav active={subTab} onChange={setSubTab} />
          {subTab === "Overview" && (
            <div className="space-y-5">
              <div className="grid grid-cols-4 gap-3">
                <div className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-200 dark:border-gray-800 rounded-lg p-4">
                  <p className="text-xs text-gray-600 dark:text-gray-500 mb-1 uppercase tracking-wider">Total Lots Packed</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">{totalLotsPacked.toLocaleString()}</p>
                </div>
                <div className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-200 dark:border-gray-800 rounded-lg p-4">
                  <p className="text-xs text-gray-600 dark:text-gray-500 mb-1 uppercase tracking-wider">Avg Lots Per Day</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">{avgLotsPerDay.toLocaleString()}</p>
                </div>
                <div className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-200 dark:border-gray-800 rounded-lg p-4">
                  <p className="text-xs text-gray-600 dark:text-gray-500 mb-1 uppercase tracking-wider">Active Days</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">{timelineDates.length}</p>
                </div>
                <div className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-200 dark:border-gray-800 rounded-lg p-4">
                  <p className="text-xs text-gray-600 dark:text-gray-500 mb-1 uppercase tracking-wider">Lots Collected</p>
                  {collectedError ? (
                    <div className="mt-2">
                      <p className="text-xs text-red-400 mb-1">Failed — BC dropped connection</p>
                      <button onClick={() => fetchCollected(from, to)} className="text-xs text-blue-400 hover:text-blue-300 underline">Retry</button>
                    </div>
                  ) : collectedLots === null ? (
                    <div className="mt-3">
                      {collectedProgress
                        ? <ProgressBar done={collectedProgress.done} total={collectedProgress.total} label="Fetching from BC…" />
                        : <p className="text-xs text-gray-600">Connecting…</p>}
                    </div>
                  ) : (
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">{collectedLots.toLocaleString()}</p>
                  )}
                </div>
              </div>
              <div className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-200 dark:border-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider">Lots Packed Over Time</p>
                  <div className="flex gap-1">
                    {(["daily", "weekly", "monthly"] as const).map(g => (
                      <button key={g} onClick={() => setChartGrouping(g)}
                        className={`px-2 py-1 text-xs rounded transition-colors ${chartGrouping === g ? "bg-[#0078D4] text-gray-900 dark:text-white" : "bg-white dark:bg-[#07070f] border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:text-white"}`}>
                        {g.charAt(0).toUpperCase() + g.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                {timelineData.length > 0 ? (() => { const cd = groupedTimeline(timelineData); return (
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={cd} margin={{ top: 4, right: 16, left: 0, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e2130" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false}
                        interval={Math.max(0, Math.floor(cd.length / 8) - 1)}
                        angle={-35} textAnchor="end" height={40} />
                      <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ background: "#1c1f27", border: "1px solid #2d3047", borderRadius: 6, fontSize: 13, color: "#fff" }} cursor={{ stroke: "#374151" }} />
                      <Line type="monotone" dataKey="lots" stroke="#0078D4" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )})() : (
                  <p className="text-gray-600 dark:text-gray-500 text-sm py-6 text-center">No data</p>
                )}
              </div>
            </div>
          )}
          {subTab === "Capacity" && (() => {
            const perPersonRate   = lockedRate || (avgLotsPerDay / capStaff)
            const dailyThroughput = Math.round(capStaff * perPersonRate)
            const dailyIncoming   = (capSalesMonth * capLotsPerSale) / capWorkDays
            const effectiveDemand = Math.max(0, dailyIncoming - capCollectedPerDay)
            const netPerDay       = dailyThroughput - effectiveDemand
            const catchingUp      = netPerDay > 0
            const staffBreakEven  = perPersonRate > 0 ? Math.ceil(effectiveDemand / perPersonRate) : null
            const extraNeeded     = staffBreakEven !== null ? Math.max(0, staffBreakEven - capStaff) : null
            const statusColor     = catchingUp ? "#22c55e" : netPerDay > -10 ? "#f59e0b" : "#ef4444"
            const backlogLots     = capBacklog * capLotsPerSale
            const daysToClean     = capBacklog > 0 && netPerDay > 0 ? Math.ceil(backlogLots / netPerDay) : null
            const catchupDate     = daysToClean != null
              ? new Date(Date.now() + daysToClean * 24 * 60 * 60 * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
              : null

            return (
              <div className="space-y-6">
                {/* Help modal */}
                {capHelpOpen && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setCapHelpOpen(false)}>
                    <div className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-300 dark:border-gray-700 rounded-xl p-6 max-w-lg w-full mx-4 space-y-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">How the Capacity tab works</p>
                        <button onClick={() => setCapHelpOpen(false)} className="text-gray-600 dark:text-gray-500 hover:text-white text-lg leading-none">✕</button>
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-400"><span className="text-gray-700 dark:text-gray-200 font-medium">Assumptions</span> — Enter your inputs: staff, sales per month, average lots per sale, working days, average collections per day, and how many auctions you're currently behind.</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400"><span className="text-gray-700 dark:text-gray-200 font-medium">Throughput</span> — Based on your actual historical packing rate from BC, it calculates how many lots your team processes per day. Adjust the staff number to model adding or removing people.</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400"><span className="text-gray-700 dark:text-gray-200 font-medium">Demand vs. Capacity</span> — Works out how many lots are coming in each day (sales × lots per sale ÷ working days), subtracts collections offsetting that demand, and compares to throughput. If throughput exceeds demand you're catching up; if not, you're falling behind.</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400"><span className="text-gray-700 dark:text-gray-200 font-medium">Estimated Catch-Up</span> — Enter a backlog (in auctions) and it multiplies by your average lots per sale, then divides by your daily surplus to give a projected date when the backlog will be cleared.</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400"><span className="text-gray-700 dark:text-gray-200 font-medium">Lots by Month</span> — Actual auction lines received from BC over the last three months so you can see volume trends.</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400"><span className="text-gray-700 dark:text-gray-200 font-medium">Collections by Month</span> — How many lots were marked as collected each month, with a daily average, pulled from the BC change log.</p>
                    </div>
                  </div>
                )}
                {/* Inputs */}
                <div className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-200 dark:border-gray-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider">Assumptions</p>
                    <button onClick={() => setCapHelpOpen(true)} className="text-xs text-gray-600 dark:text-gray-500 hover:text-white border border-gray-300 dark:border-gray-700 hover:border-gray-500 rounded px-2 py-0.5 transition-colors">? Help</button>
                  </div>
                  <div className="flex flex-wrap gap-5">
                    <NumInput label="Staff" value={capStaff} onChange={setCapStaff} />
                    <NumInput label="Sales / month" value={capSalesMonth} onChange={setCapSalesMonth} />
                    <NumInput label="Lots / sale" value={capLotsPerSale} onChange={setCapLotsPerSale} />
                    <NumInput label="Working days / month" value={capWorkDays} onChange={setCapWorkDays} />
                    <NumInput label="Avg collections / day" value={capCollectedPerDay} onChange={setCapCollectedPerDay} />
                    <NumInput label="Current backlog (auctions)" value={capBacklog} onChange={setCapBacklog} />
                  </div>
                </div>

                {/* Status banner */}
                <div className="rounded-xl border p-4 flex items-center gap-4" style={{ borderColor: statusColor + "44", background: statusColor + "11" }}>
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: statusColor }} />
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900 dark:text-white text-sm">{catchingUp ? "Keeping up" : "Falling behind"}</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                      {catchingUp
                        ? `Packing ${netPerDay.toFixed(0)} more lots/day than incoming`
                        : `${Math.abs(netPerDay).toFixed(0)} more lots/day coming in than being packed`}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-2xl font-bold" style={{ color: statusColor }}>{netPerDay > 0 ? "+" : ""}{netPerDay.toFixed(0)}</p>
                    <p className="text-xs text-gray-600 dark:text-gray-500">lots/day net</p>
                  </div>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-200 dark:border-gray-800 rounded-lg p-4">
                    <p className="text-xs text-gray-600 dark:text-gray-500 mb-1 uppercase tracking-wider">Modelled Throughput</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">{dailyThroughput}</p>
                    <p className="text-xs text-gray-600 mt-0.5">{perPersonRate.toFixed(1)} lots/person · observed avg: {avgLotsPerDay}/day</p>
                  </div>
                  <div className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-200 dark:border-gray-800 rounded-lg p-4">
                    <p className="text-xs text-gray-600 dark:text-gray-500 mb-1 uppercase tracking-wider">Effective Demand</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">{effectiveDemand.toFixed(0)}</p>
                    <p className="text-xs text-gray-600 mt-0.5">{dailyIncoming.toFixed(0)} incoming − {capCollectedPerDay} collected/day</p>
                  </div>
                </div>

                {/* Staff to break even */}
                <div className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-200 dark:border-gray-800 rounded-xl p-4">
                  <p className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider mb-2">Staff needed to break even</p>
                  <p className="text-3xl font-bold text-gray-900 dark:text-white">{staffBreakEven ?? "—"}</p>
                  <p className="text-xs text-gray-600 mt-1">
                    {extraNeeded !== null && extraNeeded > 0
                      ? `+${extraNeeded} more on top of your current ${capStaff} staff`
                      : `Current ${capStaff} staff is enough to keep up with demand`}
                  </p>
                </div>

                {/* Estimated catch-up */}
                {capBacklog > 0 && (
                  <div className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-200 dark:border-gray-800 rounded-xl p-4">
                    <p className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider mb-2">Estimated catch-up</p>
                    {daysToClean != null && catchupDate ? (
                      <>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">{catchupDate}</p>
                        <p className="text-xs text-gray-600 mt-1">
                          {daysToClean} calendar {daysToClean === 1 ? "day" : "days"} to clear {capBacklog.toLocaleString()} {capBacklog === 1 ? "auction" : "auctions"} (~{backlogLots.toLocaleString()} lots) at +{netPerDay.toFixed(0)} lots/day net
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-amber-400">Cannot catch up — throughput is not exceeding demand</p>
                    )}
                  </div>
                )}

                {/* Monthly lots from receipt lines */}
                <div className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-200 dark:border-gray-800 rounded-xl p-4">
                  <p className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider mb-3">Lots by Month (Auction Lines · Last 3 Months + Current)</p>
                  {monthlyLotsError ? (
                    <div className="flex items-center gap-3">
                      <p className="text-red-400 text-sm">{monthlyLotsError}</p>
                      <button onClick={fetchMonthlyLots} className="text-xs text-blue-400 hover:text-blue-300 underline">Retry</button>
                    </div>
                  ) : monthlyLotsLoading ? (
                    monthlyLotsProgress
                      ? <ProgressBar done={monthlyLotsProgress.done} total={monthlyLotsProgress.total} label="Fetching auction lines…" />
                      : <p className="text-xs text-gray-600">Connecting…</p>
                  ) : !monthlyLots || monthlyLots.months.length === 0 ? (
                    <p className="text-gray-600 text-sm">No data</p>
                  ) : (
                    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${monthlyLots.months.length + 1}, 1fr)` }}>
                      {monthlyLots.months.map(({ month, count, auctions, avgPerAuction }) => {
                        const [yr, mo] = month.split("-")
                        const label = new Date(Number(yr), Number(mo) - 1, 1).toLocaleString("en-GB", { month: "short", year: "numeric" })
                        return (
                          <div key={month} className="bg-white dark:bg-[#07070f] border border-gray-200 dark:border-gray-800 rounded-lg p-3 text-center">
                            <p className="text-xs text-gray-600 dark:text-gray-500 mb-2">{label}</p>
                            <p className="text-2xl font-bold text-gray-900 dark:text-white">{count.toLocaleString()}</p>
                            <p className="text-xs text-gray-600 mt-0.5">lots</p>
                            <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-800">
                              <p className="text-xs text-gray-600 dark:text-gray-500">{auctions} auctions · {avgPerAuction}/auction</p>
                            </div>
                          </div>
                        )
                      })}
                      <div className="bg-blue-950/40 border border-blue-800/40 rounded-lg p-3 text-center">
                        <p className="text-xs text-blue-400 mb-2">Avg</p>
                        <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{monthlyLots.avgLots.toLocaleString()}</p>
                        <p className="text-xs text-blue-500 mt-0.5">lots/month</p>
                        <div className="mt-2 pt-2 border-t border-blue-900/40">
                          <p className="text-xs text-blue-400">{monthlyLots.avgPerAuction} lots/auction</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Collections by month — separate section */}
                <div className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-200 dark:border-gray-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider">Lots Collected by Month (Change Log · Last 3 Months + Current)</p>
                    {!monthlyCollectedLoading && (
                      <button onClick={fetchMonthlyCollected} className="text-xs text-gray-600 hover:text-gray-400 underline">↺ Refresh</button>
                    )}
                  </div>
                  {monthlyCollectedError ? (
                    <div className="flex items-center gap-3">
                      <p className="text-red-400 text-sm">{monthlyCollectedError}</p>
                      <button onClick={fetchMonthlyCollected} className="text-xs text-blue-400 hover:text-blue-300 underline">Retry</button>
                    </div>
                  ) : monthlyCollectedLoading ? (
                    monthlyCollectedProgress
                      ? <ProgressBar done={monthlyCollectedProgress.done} total={monthlyCollectedProgress.total} label="Fetching from BC change log…" />
                      : <p className="text-xs text-gray-600">Connecting…</p>
                  ) : !monthlyCollected || Object.keys(monthlyCollected).length === 0 ? (
                    <p className="text-gray-600 text-sm">No collections found in this period</p>
                  ) : (() => {
                    const now = new Date()
                    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
                    const months = Object.entries(monthlyCollected)
                      .sort(([a], [b]) => a.localeCompare(b))
                    const total = months.reduce((s, [, v]) => s + v, 0)
                    const avg = months.length > 0 ? Math.round(total / months.length) : 0
                    return (
                      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${months.length + 1}, 1fr)` }}>
                        {months.map(([month, count]) => {
                          const [yr, mo] = month.split("-")
                          const label = new Date(Number(yr), Number(mo) - 1, 1).toLocaleString("en-GB", { month: "short", year: "numeric" })
                          const isCurrentMonth = month === currentMonthKey
                          const daysInMo = isCurrentMonth ? now.getDate() : new Date(Number(yr), Number(mo), 0).getDate()
                          const dailyAvg = daysInMo > 0 ? Math.round(count / daysInMo) : 0
                          return (
                            <div key={month} className="bg-white dark:bg-[#07070f] border border-gray-200 dark:border-gray-800 rounded-lg p-3 text-center">
                              <p className="text-xs text-gray-600 dark:text-gray-500 mb-2">{label}</p>
                              <p className="text-2xl font-bold text-green-400">{count.toLocaleString()}</p>
                              <p className="text-xs text-gray-600 mt-0.5">collected</p>
                              <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-800">
                                <p className="text-xs text-green-600">{dailyAvg}/day avg{isCurrentMonth ? " so far" : ""}</p>
                              </div>
                            </div>
                          )
                        })}
                        <div className="bg-green-950/30 border border-green-800/30 rounded-lg p-3 text-center">
                          <p className="text-xs text-green-500 mb-2">Avg</p>
                          <p className="text-2xl font-bold text-green-300">{avg.toLocaleString()}</p>
                          <p className="text-xs text-green-600 mt-0.5">collected/month</p>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              </div>
            )
          })()}
          {subTab === "Collection Dockets Daily Avg" && <><HBar data={data.dailyAvgCollections} valueKey="avg" labelKey="staff" /><ExportBtn onClick={() => exportXlsx(data.dailyAvgCollections, "packing_daily_avg")} /></>}
          {subTab === "Collection Dockets Total"     && <><HBar data={data.totalCollections} valueKey="total" labelKey="staff" /><ExportBtn onClick={() => exportXlsx(data.totalCollections, "packing_total")} /></>}
          {subTab === "Lots Daily Avg"        && <><HBar data={data.dailyAvgLots} valueKey="avg" labelKey="staff" /><ExportBtn onClick={() => exportXlsx(data.dailyAvgLots, "packing_lots_avg")} /></>}
          {subTab === "Total Lots"            && <><HBar data={data.totalLots} valueKey="total" labelKey="staff" /><ExportBtn onClick={() => exportXlsx(data.totalLots, "packing_total_lots")} /></>}
          {subTab === "Lots Over Time" && (() => { const cd = groupedTimeline(timelineData); return (
            <>
              <div className="flex justify-end mb-3 gap-1">
                {(["daily", "weekly", "monthly"] as const).map(g => (
                  <button key={g} onClick={() => setChartGrouping(g)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${chartGrouping === g ? "bg-[#0078D4] text-gray-900 dark:text-white" : "bg-white dark:bg-[#07070f] border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:text-white"}`}>
                    {g.charAt(0).toUpperCase() + g.slice(1)}
                  </button>
                ))}
              </div>
              {cd.length > 0 ? (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={cd} margin={{ top: 4, right: 16, left: 0, bottom: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e2130" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false}
                      interval={Math.max(0, Math.floor(cd.length / 10) - 1)}
                      angle={-40} textAnchor="end" height={50} />
                    <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ background: "#1c1f27", border: "1px solid #2d3047", borderRadius: 6, fontSize: 13, color: "#fff" }} cursor={{ stroke: "#374151" }} />
                    <Line type="monotone" dataKey="lots" stroke="#0078D4" strokeWidth={2} dot={{ r: 3, fill: "#0078D4" }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-gray-600 dark:text-gray-500 text-sm py-6 text-center">No data</p>
              )}
              <ExportBtn onClick={() => exportXlsx(cd, "packing_lots_over_time")} />
            </>
          )})()}
          {subTab === "Raw Data" && (
            <>
              <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-800">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 dark:bg-[#0d0f1a] text-gray-600 dark:text-gray-500 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Date</th>
                      <th className="px-4 py-2 text-left">Staff</th>
                      <th className="px-4 py-2 text-left">Document No</th>
                      <th className="px-4 py-2 text-right">Lot Count</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                    {data.raw.map((r, i) => (
                      <tr key={i} className="hover:bg-gray-200 dark:hover:bg-[#0d0f1a]">
                        <td className="px-4 py-2 text-gray-600 dark:text-gray-300">{r.date}</td>
                        <td className="px-4 py-2 text-gray-600 dark:text-gray-300">{r.staff}</td>
                        <td className="px-4 py-2 text-gray-600 dark:text-gray-500">{r.docNo}</td>
                        <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-300">{r.lotCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ExportBtn onClick={() => exportXlsx(data.raw, "packing_raw")} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Warehouse tab ────────────────────────────────────────────────────────────

function WarehouseTab() {
  const [data, setData] = useState<WhData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [subTab, setSubTab]   = useState("By Category")

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res  = await window.fetch("/api/bc/warehouse")
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.statusText)
      setData(json)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Warehouse Report</h2>
      <button
        onClick={load} disabled={loading}
        className="mb-5 px-5 py-2 bg-[#0078D4] hover:bg-blue-500 text-gray-900 dark:text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
      >
        {loading ? "Loading…" : "↺ Refresh Snapshot"}
      </button>
      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
      {data && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-200 dark:border-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-600 dark:text-gray-500 mb-1">Total Totes</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{data.meta.total.toLocaleString()}</p>
            </div>
            <div className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-200 dark:border-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-600 dark:text-gray-500 mb-1">Categories</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{data.meta.categoryCount.toLocaleString()}</p>
            </div>
            <div className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-200 dark:border-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-600 dark:text-gray-500 mb-1">Largest Category</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{data.meta.largestCategory}</p>
            </div>
          </div>
          <SubTabs tabs={["By Category", "By Cataloguer", "Raw Data"]} active={subTab} onChange={setSubTab} />
          {subTab === "By Category"   && <><HBar data={data.byCategory} valueKey="count" labelKey="category" /><ExportBtn onClick={() => exportXlsx(data.byCategory, "warehouse_by_category")} /></>}
          {subTab === "By Cataloguer" && <><HBar data={data.byCataloguer} valueKey="count" labelKey="cataloguer" /><ExportBtn onClick={() => exportXlsx(data.byCataloguer, "warehouse_by_cataloguer")} /></>}
          {subTab === "Raw Data" && (
            <>
              <p className="text-xs text-gray-600 dark:text-gray-500 mb-3">{data.raw.length.toLocaleString()} totes</p>
              <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-800">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 dark:bg-[#0d0f1a] text-gray-600 dark:text-gray-500 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Barcode</th>
                      <th className="px-4 py-2 text-left">Category</th>
                      <th className="px-4 py-2 text-left">Cataloguer</th>
                      <th className="px-4 py-2 text-left">Catalogued</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                    {data.raw.map((r, i) => (
                      <tr key={i} className="hover:bg-gray-200 dark:hover:bg-[#0d0f1a]">
                        <td className="px-4 py-2 text-gray-600 dark:text-gray-500 font-mono text-xs">{r.barcode}</td>
                        <td className="px-4 py-2 text-gray-600 dark:text-gray-300">{r.category}</td>
                        <td className="px-4 py-2 text-gray-600 dark:text-gray-300">{r.cataloguer}</td>
                        <td className="px-4 py-2">{r.catalogued ? <span className="text-green-400 text-xs">✓ Yes</span> : <span className="text-gray-600 text-xs">No</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ExportBtn onClick={() => exportXlsx(data.raw, "warehouse_raw")} />
            </>
          )}
        </>
      )}
    </div>
  )
}

// ─── Data Explorer tab ────────────────────────────────────────────────────────

const ENDPOINTS: Record<string, string> = {
  "Auction Receipt Lines":  "Auction_Receipt_Lines_Excel",
  "Shipment Requests":      "ShipmentRequestAPI",
  "Collection List":        "CollectionList",
  "Posted Collection List": "PostedCollectionList",
  "Receipt Totes":          "Receipt_Totes_Excel",
}

function DataExplorerTab() {
  const [endpoint, setEndpoint] = useState(Object.keys(ENDPOINTS)[0])
  const [filter,   setFilter]   = useState("")
  const [orderby,  setOrderby]  = useState("")
  const [rows,     setRows]     = useState<any[] | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  async function fetch() {
    setLoading(true); setError(null); setRows(null)
    try {
      const params = new URLSearchParams({ endpoint: ENDPOINTS[endpoint] })
      if (filter)  params.set("filter",  filter)
      if (orderby) params.set("orderby", orderby)
      const res  = await window.fetch(`/api/bc/explorer?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.statusText)
      setRows(json.rows)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  const columns = rows && rows.length > 0
    ? Object.keys(rows[0]).filter(k => !k.startsWith("@odata"))
    : []

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Data Explorer</h2>

      <div className="flex gap-3 mb-3">
        <div className="flex-1">
          <label className="block text-xs text-gray-600 dark:text-gray-500 mb-1 uppercase tracking-wider">Endpoint</label>
          <select
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            className="w-full bg-gray-100 dark:bg-[#0d0f1a] border border-gray-300 dark:border-gray-700 rounded px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:border-blue-500"
          >
            {Object.keys(ENDPOINTS).map((k) => <option key={k}>{k}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs text-gray-600 dark:text-gray-500 mb-1 uppercase tracking-wider">OData $filter (optional)</label>
          <input
            type="text" value={filter} onChange={(e) => setFilter(e.target.value)}
            placeholder="e.g. Status eq 'Open'"
            className="w-full bg-gray-100 dark:bg-[#0d0f1a] border border-gray-300 dark:border-gray-700 rounded px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-xs text-gray-600 dark:text-gray-500 mb-1 uppercase tracking-wider">Order by (optional)</label>
        <input
          type="text" value={orderby} onChange={(e) => setOrderby(e.target.value)}
          placeholder="e.g. No desc"
          className="w-full max-w-sm bg-gray-100 dark:bg-[#0d0f1a] border border-gray-300 dark:border-gray-700 rounded px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:border-blue-500"
        />
      </div>

      <button
        onClick={fetch} disabled={loading}
        className="mb-5 px-5 py-2 bg-[#0078D4] hover:bg-blue-500 text-gray-900 dark:text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
      >
        {loading ? "Loading…" : "Fetch Data"}
      </button>

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      {rows && (
        <>
          <p className="text-xs text-gray-600 dark:text-gray-500 mb-3">{rows.length.toLocaleString()} rows × {columns.length} columns</p>
          <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-800 mb-3" style={{ maxHeight: 520 }}>
            <table className="w-full text-xs">
              <thead className="bg-gray-100 dark:bg-[#0d0f1a] text-gray-600 dark:text-gray-500 uppercase sticky top-0">
                <tr>
                  {columns.map((c) => (
                    <th key={c} className="px-3 py-2 text-left whitespace-nowrap font-semibold tracking-wider">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {rows.map((r, i) => (
                  <tr key={i} className="hover:bg-gray-200 dark:hover:bg-[#0d0f1a]">
                    {columns.map((c) => (
                      <td key={c} className="px-3 py-1.5 text-gray-600 dark:text-gray-300 whitespace-nowrap">{String(r[c] ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ExportBtn onClick={() => exportXlsx(rows, ENDPOINTS[endpoint])} />
        </>
      )}
    </div>
  )
}

function NumInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider block mb-1">{label}</label>
      <input type="number" value={value} onChange={e => onChange(Number(e.target.value))}
        className="w-20 bg-white dark:bg-[#07070f] border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-blue-500 text-right" />
    </div>
  )
}

function ExportBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mt-3 flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-[#0d0f1a] border border-gray-300 dark:border-gray-700 hover:border-gray-500 text-gray-600 dark:text-gray-300 hover:text-white text-xs font-medium rounded transition-colors"
    >
      ⬇ Export to Excel
    </button>
  )
}

// ─── Location History tab ─────────────────────────────────────────────────────

const SALESPERSON_NAMES_LOC: Record<string, string> = {
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

type LocationEntry = { from: string; to: string; changedBy: string; changedAt: string }

function formatDateTime(iso: string) {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    })
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
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`/api/bc/location-history?q=${encodeURIComponent(q)}&mode=${mode}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Lookup failed"); return }
      setResult(data)
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") lookup()
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Location History</h2>
      <p className="text-gray-600 dark:text-gray-500 text-sm mb-5">Look up every location a tote or lot has ever been moved to via BC change logs.</p>

      {/* Input */}
      <div className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-300 dark:border-gray-700 rounded-xl p-5 max-w-lg space-y-4">

        {/* Mode toggle */}
        <div className="flex gap-2">
          {(["tote", "barcode"] as const).map(m => (
            <button key={m} onClick={() => { setMode(m); setResult(null); setError(null) }}
              className={`px-4 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                mode === m
                  ? "border-blue-500 bg-blue-500/20 text-blue-700 dark:text-blue-300"
                  : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-500 hover:border-gray-500 hover:text-gray-300"
              }`}>
              {m === "tote" ? "🗂 Tote number" : "🔖 Barcode"}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={mode === "tote" ? "e.g. T000123" : "e.g. VEC-001234"}
            autoFocus
            className="flex-1 bg-white dark:bg-[#07070f] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
          />
          <button
            onClick={lookup}
            disabled={loading || !input.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-gray-900 dark:text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {loading ? "Searching…" : "Look up"}
          </button>
        </div>

        {mode === "barcode" && (
          <p className="text-xs text-gray-600">
            Barcode lookup does two BC queries: first finds the item key from the barcode, then fetches all location changes for that item.
          </p>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 max-w-lg bg-red-950 border border-red-700 rounded-xl p-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="mt-5 max-w-2xl space-y-4">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wide">BC Item Key</p>
              <p className="text-gray-900 dark:text-white font-mono text-sm">
                {result.field1}{result.field2 ? ` · ${result.field2}` : ""}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wide">Movements found</p>
              <p className="text-gray-900 dark:text-white font-semibold">{result.entries.length}</p>
            </div>
          </div>

          {result.entries.length === 0 ? (
            <div className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-300 dark:border-gray-700 rounded-xl p-6 text-center">
              <p className="text-gray-600 dark:text-gray-500 text-sm">No location changes found in the BC change log.</p>
              <p className="text-gray-600 text-xs mt-1">The item may not have been moved, or the change log wasn't active when it was.</p>
            </div>
          ) : (
            <div className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-300 dark:border-gray-700 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#07070f]">
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 dark:text-gray-500 uppercase tracking-wide">Date / Time</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 dark:text-gray-500 uppercase tracking-wide">From</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 dark:text-gray-500 uppercase tracking-wide">To</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 dark:text-gray-500 uppercase tracking-wide">Changed by</th>
                  </tr>
                </thead>
                <tbody>
                  {result.entries.map((e, i) => (
                    <tr key={i} className={`border-b border-gray-200 dark:border-gray-800/50 ${i % 2 === 0 ? "" : "bg-gray-100 dark:bg-[#0a0c17]"}`}>
                      <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 text-xs whitespace-nowrap">{formatDateTime(e.changedAt)}</td>
                      <td className="px-4 py-2.5">
                        {e.from
                          ? <span className="font-mono text-gray-600 dark:text-gray-400">{e.from}</span>
                          : <span className="text-gray-700 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-mono font-semibold text-blue-700 dark:text-blue-300">{e.to || "—"}</span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 text-xs">
                        {(SALESPERSON_NAMES_LOC[e.changedBy] ?? e.changedBy) || "—"}
                      </td>
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

// ─── Sidebar nav items ────────────────────────────────────────────────────────

// ─── Shipping tab ─────────────────────────────────────────────────────────────

function ShippingTab() {
  const [from, setFrom] = useState(startOfYear())
  const [to, setTo]     = useState(today())
  const [data, setData] = useState<ShipData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [subTab, setSubTab]   = useState("By Country")

  const load = useCallback(async (f: string, t: string) => {
    if (!f || !t) return
    setLoading(true); setError(null)
    try {
      const res  = await window.fetch(`/api/bc/shipping?from=${f}&to=${t}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.statusText)
      setData(json)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => load(from, to), 300)
    return () => clearTimeout(t)
  }, [from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleDateChange(f: string, t: string) { setFrom(f); setTo(t) }

  const money = (n: number) =>
    "£" + (n || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const monthLabel = (m: string) => {
    const mm = /^(\d{4})-(\d{2})$/.exec(m)
    return mm ? new Date(+mm[1], +mm[2] - 1, 1).toLocaleString("en-GB", { month: "short", year: "numeric" }) : m
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Shipping Report</h2>
        <a
          href={`/api/bc/shipping/pdf?from=${from}&to=${to}`}
          target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-2 bg-cyan-700 hover:bg-cyan-600 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Download PDF
        </a>
      </div>
      <DateRange from={from} to={to} onChange={handleDateChange} onPreset={handleDateChange} />
      {!loading && <LoadBtn loading={loading} onClick={() => load(from, to)} />}
      {loading && <p className="text-xs text-gray-600 dark:text-gray-500 mb-5">Loading…</p>}
      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
      {data && (
        <div className={loading ? "opacity-40 pointer-events-none transition-opacity" : "transition-opacity"}>
          {!data.meta.sizeDataAvailable ? (
            <div className="mb-4 text-sm rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-4 py-3">
              Parcel size &amp; estimated revenue need a one-time data refresh. Go to <span className="font-medium">BC Warehouse → Data Sync</span> and run a full receipt-lines sync, then reload this report.
            </div>
          ) : data.meta.parcelsWithoutSize > Math.max(20, data.meta.total * 0.03) ? (
            <div className="mb-4 text-sm rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-4 py-3">
              <span className="font-medium">{data.meta.parcelsWithoutSize.toLocaleString()}</span> of {data.meta.total.toLocaleString()} parcels have no matching lot data locally, so their items &amp; revenue are missing here. This usually means the receipt-lines sync didn’t finish — run a <span className="font-medium">full</span> re-sync in <span className="font-medium">BC Warehouse → Data Sync</span> (keep the tab open until it completes), then reload.
            </div>
          ) : null}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-200 dark:border-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-600 dark:text-gray-500 mb-1">Parcels</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{data.meta.total.toLocaleString()}</p>
            </div>
            <div className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-200 dark:border-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-600 dark:text-gray-500 mb-1">Est. Shipping Revenue (ex VAT)</p>
              <p className="text-xl font-bold text-cyan-700 dark:text-cyan-300">{money(data.meta.estRevenueTotal)}</p>
            </div>
            <div className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-200 dark:border-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-600 dark:text-gray-500 mb-1">Countries</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{data.meta.countries.toLocaleString()}</p>
            </div>
            <div className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-200 dark:border-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-600 dark:text-gray-500 mb-1">Items Shipped</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{data.meta.itemsWithSize.toLocaleString()}</p>
            </div>
          </div>
          <MetaBar text={`${from} — ${to}  ·  ${data.meta.total.toLocaleString()} parcels  ·  ${money(data.meta.estRevenueTotal)} est. revenue`} />
          <SubTabs tabs={["By Country", "By Region", "By Month", "By Size", "Shipped / Collected", "Country × Size", "By City", "World Map", "UK Map"]} active={subTab} onChange={setSubTab} />
          {subTab === "By Country" && (
            <>
              <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-800 mb-3" style={{ maxHeight: 520 }}>
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 dark:bg-[#0d0f1a] text-gray-600 dark:text-gray-500 text-xs uppercase sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left">Country</th>
                      <th className="px-4 py-2 text-right">Shipments</th>
                      <th className="px-4 py-2 text-right">%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                    {data.byCountry.map((r, i) => (
                      <tr key={i} className="hover:bg-gray-200 dark:hover:bg-[#0d0f1a]">
                        <td className="px-4 py-2 text-gray-600 dark:text-gray-300">
                          {COUNTRY_NAMES[r.country] ? `${COUNTRY_NAMES[r.country]} (${r.country})` : r.country}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-300">{r.count.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">
                          {data.meta.total ? ((r.count / data.meta.total) * 100).toFixed(1) : "—"}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ExportBtn onClick={() => exportXlsx(
                data.byCountry.map(r => ({
                  "Country": COUNTRY_NAMES[r.country] ? `${COUNTRY_NAMES[r.country]} (${r.country})` : r.country,
                  "Shipments": r.count,
                  "%": data.meta.total ? +((r.count / data.meta.total) * 100).toFixed(1) : 0,
                })),
                "shipping_by_country"
              )} />
            </>
          )}
          {subTab === "By Region" && (
            <>
              <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-800 mb-3">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 dark:bg-[#0d0f1a] text-gray-600 dark:text-gray-500 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Region</th>
                      <th className="px-4 py-2 text-right">Parcels</th>
                      <th className="px-4 py-2 text-right">%</th>
                      <th className="px-4 py-2 text-right">Items</th>
                      <th className="px-4 py-2 text-right">Est. Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                    {data.byRegion.map((r, i) => (
                      <tr key={i} className="hover:bg-gray-200 dark:hover:bg-[#0d0f1a]">
                        <td className="px-4 py-2 text-gray-600 dark:text-gray-300">{r.region}</td>
                        <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-300">{r.parcels.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">{data.meta.total ? ((r.parcels / data.meta.total) * 100).toFixed(1) : "—"}%</td>
                        <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-300">{r.items.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right text-cyan-700 dark:text-cyan-300">{money(r.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ExportBtn onClick={() => exportXlsx(
                data.byRegion.map(r => ({
                  "Region": r.region,
                  "Parcels": r.parcels,
                  "%": data.meta.total ? +((r.parcels / data.meta.total) * 100).toFixed(1) : 0,
                  "Items": r.items,
                  "Est. Revenue": +r.revenue.toFixed(2),
                })),
                "shipping_by_region"
              )} />
            </>
          )}
          {subTab === "By Month" && (() => {
            const maxRev = Math.max(1, ...data.byMonth.map(m => m.revenue))
            return (
              <>
                <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-800 mb-3" style={{ maxHeight: 560 }}>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100 dark:bg-[#0d0f1a] text-gray-600 dark:text-gray-500 text-xs uppercase sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-left">Month</th>
                        <th className="px-4 py-2 text-right">Parcels</th>
                        <th className="px-4 py-2 text-right">Items</th>
                        <th className="px-4 py-2 text-right">Est. Revenue</th>
                        <th className="px-4 py-2 text-left" style={{ width: "34%" }}>Revenue trend</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                      {data.byMonth.map((m, i) => (
                        <tr key={i} className="hover:bg-gray-200 dark:hover:bg-[#0d0f1a]">
                          <td className="px-4 py-2 text-gray-600 dark:text-gray-300 whitespace-nowrap">{monthLabel(m.month)}</td>
                          <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-300">{m.parcels.toLocaleString()}</td>
                          <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-300">{m.items.toLocaleString()}</td>
                          <td className="px-4 py-2 text-right text-cyan-700 dark:text-cyan-300">{money(m.revenue)}</td>
                          <td className="px-4 py-2">
                            <div className="h-3 rounded bg-cyan-500/70" style={{ width: `${Math.max(2, (m.revenue / maxRev) * 100)}%` }} title={money(m.revenue)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.byMonth.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-500 mb-3">No shipments in this period.</p>}
                <ExportBtn onClick={() => exportXlsx(
                  data.byMonth.map(m => ({
                    "Month": m.month,
                    "Parcels": m.parcels,
                    "Items": m.items,
                    "Est. Revenue": +m.revenue.toFixed(2),
                  })),
                  "shipping_by_month"
                )} />
              </>
            )
          })()}
          {subTab === "By Size" && (
            <>
              <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-800 mb-3">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 dark:bg-[#0d0f1a] text-gray-600 dark:text-gray-500 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Size</th>
                      <th className="px-4 py-2 text-right">Items</th>
                      <th className="px-4 py-2 text-right">%</th>
                      <th className="px-4 py-2 text-right">Est. Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                    {data.bySize.map((r, i) => (
                      <tr key={i} className="hover:bg-gray-200 dark:hover:bg-[#0d0f1a]">
                        <td className="px-4 py-2 text-gray-600 dark:text-gray-300">{r.size}</td>
                        <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-300">{r.items.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">{data.meta.itemsWithSize ? ((r.items / data.meta.itemsWithSize) * 100).toFixed(1) : "—"}%</td>
                        <td className="px-4 py-2 text-right text-cyan-700 dark:text-cyan-300">{money(r.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.bySize.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-500 mb-3">No parcel-size data for this period — run a full receipt-lines sync.</p>}
              <ExportBtn onClick={() => exportXlsx(
                data.bySize.map(r => ({
                  "Size": r.size,
                  "Items": r.items,
                  "%": data.meta.itemsWithSize ? +((r.items / data.meta.itemsWithSize) * 100).toFixed(1) : 0,
                  "Est. Revenue": +r.revenue.toFixed(2),
                })),
                "shipping_by_size"
              )} />
            </>
          )}
          {subTab === "Shipped / Collected" && (
            <>
              <p className="text-xs text-gray-500 dark:text-gray-500 mb-3">
                How shipped lots split by their BC location / collected flag. <span className="font-medium">Revenue is NOT filtered by this yet</span> — the column shows how much of the current estimate each status accounts for, so you can decide whether to exclude Collected later. (“Other” = still in a warehouse aisle / not yet marked.)
              </p>
              <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-800 mb-3">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 dark:bg-[#0d0f1a] text-gray-600 dark:text-gray-500 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Status</th>
                      <th className="px-4 py-2 text-right">Items</th>
                      <th className="px-4 py-2 text-right">%</th>
                      <th className="px-4 py-2 text-right">Est. Revenue (incl.)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                    {data.byDeliveryStatus.map((r, i) => (
                      <tr key={i} className="hover:bg-gray-200 dark:hover:bg-[#0d0f1a]">
                        <td className="px-4 py-2 text-gray-600 dark:text-gray-300">{r.status}</td>
                        <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-300">{r.items.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">{data.meta.itemsWithSize ? ((r.items / data.meta.itemsWithSize) * 100).toFixed(1) : "—"}%</td>
                        <td className="px-4 py-2 text-right text-cyan-700 dark:text-cyan-300">{money(r.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.byDeliveryStatus.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-500 mb-3">No delivery-status data for this period.</p>}
              <ExportBtn onClick={() => exportXlsx(
                data.byDeliveryStatus.map(r => ({
                  "Status": r.status,
                  "Items": r.items,
                  "%": data.meta.itemsWithSize ? +((r.items / data.meta.itemsWithSize) * 100).toFixed(1) : 0,
                  "Est. Revenue": +r.revenue.toFixed(2),
                })),
                "shipping_by_delivery_status"
              )} />
            </>
          )}
          {subTab === "Country × Size" && (
            <>
              <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-800 mb-3" style={{ maxHeight: 560 }}>
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 dark:bg-[#0d0f1a] text-gray-600 dark:text-gray-500 text-xs uppercase sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left">Country</th>
                      <th className="px-3 py-2 text-left">Region</th>
                      {data.sizesPresent.map(s => <th key={s} className="px-3 py-2 text-right">{s}</th>)}
                      <th className="px-3 py-2 text-right">Parcels</th>
                      <th className="px-4 py-2 text-right">Est. Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                    {data.byCountrySize.map((r, i) => (
                      <tr key={i} className="hover:bg-gray-200 dark:hover:bg-[#0d0f1a]">
                        <td className="px-4 py-2 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                          {COUNTRY_NAMES[r.country] ? `${COUNTRY_NAMES[r.country]} (${r.country})` : r.country}
                          {!r.rated && <span className="ml-1 text-amber-500" title="Not on the rate sheet">*</span>}
                        </td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-500">{r.region}</td>
                        {data.sizesPresent.map(s => (
                          <td key={s} className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{r.sizes[s] ? r.sizes[s].toLocaleString() : "·"}</td>
                        ))}
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{r.parcels.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right text-cyan-700 dark:text-cyan-300">{money(r.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-500 mb-2">* country not on the rate sheet — counted in parcels, excluded from estimated revenue.</p>
              <ExportBtn onClick={() => exportXlsx(
                data.byCountrySize.map(r => ({
                  "Country": COUNTRY_NAMES[r.country] ? `${COUNTRY_NAMES[r.country]} (${r.country})` : r.country,
                  "Region": r.region,
                  ...Object.fromEntries(data.sizesPresent.map(s => [s, r.sizes[s] ?? 0])),
                  "Parcels": r.parcels,
                  "Est. Revenue": +r.revenue.toFixed(2),
                })),
                "shipping_country_size"
              )} />
            </>
          )}
          {subTab === "By City" && (
            <>
              <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-800 mb-3" style={{ maxHeight: 520 }}>
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 dark:bg-[#0d0f1a] text-gray-600 dark:text-gray-500 text-xs uppercase sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left">City</th>
                      <th className="px-4 py-2 text-left">Country</th>
                      <th className="px-4 py-2 text-right">Shipments</th>
                      <th className="px-4 py-2 text-right">%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                    {data.byCity.map((r, i) => (
                      <tr key={i} className="hover:bg-gray-200 dark:hover:bg-[#0d0f1a]">
                        <td className="px-4 py-2 text-gray-600 dark:text-gray-300">{r.city}</td>
                        <td className="px-4 py-2 text-gray-600 dark:text-gray-500">
                          {COUNTRY_NAMES[r.country] ? `${COUNTRY_NAMES[r.country]} (${r.country})` : r.country}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-300">{r.count.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">
                          {data.meta.total ? ((r.count / data.meta.total) * 100).toFixed(1) : "—"}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ExportBtn onClick={() => exportXlsx(
                data.byCity.map(r => ({
                  "City": r.city,
                  "Country": COUNTRY_NAMES[r.country] ? `${COUNTRY_NAMES[r.country]} (${r.country})` : r.country,
                  "Shipments": r.count,
                  "%": data.meta.total ? +((r.count / data.meta.total) * 100).toFixed(1) : 0,
                })),
                "shipping_by_city"
              )} />
            </>
          )}
          {subTab === "World Map" && (
            <WorldMap byCountry={data.byCountry} total={data.meta.total} />
          )}
          {subTab === "UK Map" && (
            <UKMap byCity={data.byCity} total={data.meta.total} />
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

type NavItem = { id: Report; label: string; activeColor: string; icon: string }

const reports: NavItem[] = [
  {
    id: "cataloguing", label: "Cataloguing", activeColor: "text-red-400",
    icon: "M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z",
  },
  {
    id: "packing", label: "Packing", activeColor: "text-orange-400",
    icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
  },
  {
    id: "warehouse", label: "Warehouse", activeColor: "text-green-400",
    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  },
  {
    id: "shipping", label: "Shipping", activeColor: "text-cyan-400",
    icon: "M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0zM13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0",
  },
]
const toolReports: NavItem[] = [
  {
    id: "explorer", label: "Data Explorer", activeColor: "text-purple-400",
    icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4",
  },
]

function SidebarBtn({ r, active, onClick }: { r: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all ${
        active ? "bg-white/8 text-gray-900 dark:text-white" : "text-gray-600 dark:text-gray-500 hover:text-gray-200 hover:bg-white/5"
      }`}
    >
      <svg className={`w-4 h-4 flex-shrink-0 ${active ? r.activeColor : "text-gray-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d={r.icon} />
      </svg>
      <span className={`text-sm ${active ? "font-medium text-gray-900 dark:text-white" : "font-normal"}`}>{r.label}</span>
    </button>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BCReportsPage() {
  const [activeReport, setActiveReport] = useState<Report>("cataloguing")
  const [isConnected, setConnected]     = useState<boolean | null>(null)
  const [bcError, setBcError]           = useState<string | null>(null)
  const [debugReason, setDebugReason]   = useState<string | null>(null)
  const [refreshKey, setRefreshKey]     = useState(0)
  const [allowedSections, setAllowedSections] = useState<string[] | null>(null)

  useEffect(() => {
    fetch("/api/user/section-access/BC_REPORTS")
      .then(r => r.json())
      .then(({ allowed }: { allowed: string[] | null }) => {
        setAllowedSections(allowed)
        if (allowed && !allowed.includes(activeReport)) {
          setActiveReport((allowed[0] as Report) ?? "cataloguing")
        }
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("bc_error")) setBcError(params.get("bc_error"))
    window.fetch("/api/bc/status")
      .then((r) => r.json())
      .then((data) => {
        setConnected(data.connected === true)
        if (!data.connected) setDebugReason(data.reason ?? null)
      })
      .catch(() => setConnected(false))
  }, [])

  return (
    <div className="flex h-[calc(100vh-48px)] bg-white dark:bg-[#07070f] text-gray-900 dark:text-white overflow-hidden">

      {/* ── Sidebar ── */}
      <aside className="w-44 bg-gray-100 dark:bg-[#0b0d14] border-r border-gray-200 dark:border-gray-800 flex flex-col flex-shrink-0">
        {/* Logo */}
        <div className="px-4 py-5 border-b border-gray-200 dark:border-gray-800">
          <Logo variant="compact" />
          <p className="text-gray-600 text-xs mt-1">BC Reports</p>
        </div>

        {/* Reports nav */}
        <div className="flex-1 px-2 py-4 flex flex-col">
          <p className="text-gray-600 text-[10px] uppercase tracking-widest mb-1.5 px-2">Reports</p>
          <div className="space-y-0.5">
            {reports.filter(r => !allowedSections || allowedSections.includes(r.id)).map(r => (
              <SidebarBtn key={r.id} r={r} active={activeReport === r.id} onClick={() => setActiveReport(r.id)} />
            ))}
          </div>
          <div className="mt-auto pt-4 border-t border-gray-200 dark:border-gray-800/50">
            <p className="text-gray-600 text-[10px] uppercase tracking-widest mb-1.5 px-2">Tools</p>
            <div className="space-y-0.5">
              {toolReports.filter(r => !allowedSections || allowedSections.includes(r.id)).map(r => (
                <SidebarBtn key={r.id} r={r} active={activeReport === r.id} onClick={() => setActiveReport(r.id)} />
              ))}
            </div>
          </div>
        </div>

        {/* Bottom */}
        <div className="px-3 py-4 border-t border-gray-200 dark:border-gray-800 space-y-3">
          <div>
            <p className="text-gray-600 text-xs">Env: production</p>
            <p className="text-gray-600 text-xs">Company: Vectis</p>
          </div>
          <button
            onClick={async () => {
              await fetch("/api/bc/cache-bust", { method: "POST" }).catch(() => {})
              setRefreshKey((k) => k + 1)
            }}
            className="w-full bg-red-700 hover:bg-red-600 text-gray-900 dark:text-white text-xs font-bold py-1.5 px-2 rounded transition-colors"
          >
            ■ REFRESH ALL DATA
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-auto p-6">
        {isConnected === null && (
          <p className="text-gray-600 dark:text-gray-500 text-sm">Checking connection…</p>
        )}

        {isConnected === false && (
          <div className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-300 dark:border-gray-700 rounded-xl p-6 max-w-sm">
            <h2 className="font-semibold text-gray-900 dark:text-white mb-1">Connect to Microsoft</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Sign in with your Microsoft 365 account to access Business Central data.
            </p>
            {bcError && (
              <p className="text-sm text-red-400 mb-3 bg-red-950 border border-red-800 rounded p-2">{bcError}</p>
            )}
            {debugReason && !bcError && (
              <p className="text-xs text-gray-600 dark:text-gray-500 mb-3">Status: {debugReason}</p>
            )}
            <a
              href="/api/bc/auth"
              className="inline-block bg-[#0078D4] hover:bg-blue-500 text-gray-900 dark:text-white text-sm font-medium px-4 py-2 rounded transition-colors"
            >
              Sign in with Microsoft
            </a>
          </div>
        )}

        {isConnected === true && (
          <div key={refreshKey}>
            {activeReport === "cataloguing" && <CataloguingTab />}
            {activeReport === "packing"     && <PackingTab />}
            {activeReport === "warehouse"   && <WarehouseTab />}
            {activeReport === "explorer"    && <DataExplorerTab />}
            {activeReport === "shipping"    && <ShippingTab />}
          </div>
        )}
      </main>
    </div>
  )
}

// ─── Warehouse Heatmap Tab ────────────────────────────────────────────────────

type HeatTote = { id: string; description: string; category: string; catalogued: boolean; location: string }
type HeatLocation = {
  code: string; total: number; catalogued: number; uncatalogued: number; items: HeatTote[]
}
type HeatData = {
  locations: HeatLocation[]
  unlocated: HeatLocation
  meta: { totalTotes: number; totalLocations: number; occupiedLocations: number; directField: string | null }
}

function heatColour(count: number, max: number): string {
  if (count === 0) return "bg-gray-50 dark:bg-[#1a1d2e] border-gray-200 dark:border-gray-800 text-gray-600"
  const ratio = count / Math.max(max, 1)
  if (ratio < 0.25) return "bg-emerald-950 border-emerald-800 text-emerald-700 dark:text-emerald-300"
  if (ratio < 0.5)  return "bg-yellow-950 border-yellow-700 text-yellow-700 dark:text-yellow-300"
  if (ratio < 0.75) return "bg-orange-950 border-orange-700 text-orange-700 dark:text-orange-300"
  return "bg-red-950 border-red-700 text-red-700 dark:text-red-300"
}

function parseGrid(locations: HeatLocation[]) {
  const parsed = locations.map(loc => {
    const m = loc.code.match(/^([A-Za-z]+)[^0-9]*([0-9]+)$/)
    return m ? { ...loc, row: m[1].toUpperCase(), col: parseInt(m[2]) } : null
  })
  if (parsed.some(p => p === null)) return null
  const rows = [...new Set(parsed.map(p => p!.row))].sort()
  const cols = [...new Set(parsed.map(p => p!.col))].sort((a, b) => a - b)
  const grid = new Map(parsed.map(p => [`${p!.row}${p!.col}`, p!]))
  return { rows, cols, grid }
}

function WarehouseHeatmapTab() {
  const [data, setData]         = useState<HeatData | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [selected, setSelected] = useState<HeatLocation | null>(null)
  const [stageLabel, setStageLabel] = useState("")
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  async function load() {
    setLoading(true); setError(null); setProgress(null); setStageLabel("Connecting…")
    try {
      const res = await fetch("/api/bc/warehouse-heatmap")
      if (!res.body) throw new Error("No response body")
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split("\n")
        buf = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.trim()) continue
          const msg = JSON.parse(line)
          if (msg.type === "stage")    { setStageLabel(msg.label); setProgress(null) }
          if (msg.type === "progress") { setStageLabel(msg.label); setProgress({ done: msg.done, total: msg.total }) }
          if (msg.type === "result")   setData(msg.data)
          if (msg.type === "error")    setError(msg.message)
        }
      }
    } catch (e: any) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (!loading && !data) return null

  const max      = data ? Math.max(...data.locations.map(l => l.total), 1) : 1
  const gridData = data ? parseGrid(data.locations) : null
  const busiest  = data ? data.locations.reduce((a, b) => a.total > b.total ? a : b, { code: "—", total: 0 } as any) : null

  function BigNum({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
    return (
      <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl px-5 py-4">
        <p className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider mb-1">{label}</p>
        <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
        {sub && <p className="text-xs text-gray-600 dark:text-gray-500 mt-0.5">{sub}</p>}
      </div>
    )
  }

  if (error) return (
    <div>
      <p className="text-red-400 text-sm mb-3">{error}</p>
      <button onClick={load} className="px-4 py-2 bg-[#0078D4] hover:bg-blue-500 text-gray-900 dark:text-white text-sm rounded">↺ Retry</button>
    </div>
  )

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Warehouse Map</h2>
      <p className="text-gray-600 dark:text-gray-500 text-sm mb-5">
        Tote occupancy per BC location — current position based on BC location change log.
      </p>

      {loading && <ProgressBar done={progress?.done ?? 0} total={progress?.total ?? 0} label={stageLabel} />}
      {!loading && data && <LoadBtn loading={loading} onClick={load} />}

      {data && <>
      {/* Headline stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <BigNum label="Total totes" value={data.meta.totalTotes} />
        <BigNum label="Locations" value={`${data.meta.occupiedLocations} / ${data.meta.totalLocations}`} sub="occupied / total" />
        <BigNum label="Busiest location" value={busiest?.code ?? "—"} sub={`${max} totes`} />
        <BigNum label="No location" value={data.unlocated.total} sub="not yet placed in BC" />
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-4 text-xs text-gray-600 dark:text-gray-500">
        <span>Occupancy:</span>
        {[
          { label: "Empty",  cls: "bg-gray-50 dark:bg-[#1a1d2e] border-gray-300 dark:border-gray-700" },
          { label: "Low",    cls: "bg-emerald-900 border-emerald-700" },
          { label: "Medium", cls: "bg-yellow-900 border-yellow-600" },
          { label: "High",   cls: "bg-orange-900 border-orange-600" },
          { label: "Full",   cls: "bg-red-900 border-red-600" },
        ].map(({ label, cls }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className={`w-4 h-4 rounded border ${cls}`} />
            <span>{label}</span>
          </div>
        ))}
      </div>

      {/* Grid view */}
      {gridData ? (
        <div className="mb-6 overflow-x-auto">
          <table className="border-separate border-spacing-1">
            <thead>
              <tr>
                <th className="w-8" />
                {gridData.cols.map(c => (
                  <th key={c} className="text-xs text-gray-600 font-normal text-center w-14">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gridData.rows.map(row => (
                <tr key={row}>
                  <td className="text-xs text-gray-600 font-normal pr-1 text-right">{row}</td>
                  {gridData.cols.map(col => {
                    const loc = gridData.grid.get(`${row}${col}`)
                    if (!loc) return (
                      <td key={col}>
                        <div className="w-14 h-12 rounded border border-dashed border-gray-200 dark:border-gray-800/40 bg-transparent" />
                      </td>
                    )
                    return (
                      <td key={col}>
                        <button
                          onClick={() => setSelected(selected?.code === loc.code ? null : loc)}
                          title={`${loc.code}: ${loc.total} totes`}
                          className={`w-14 h-12 rounded border transition-all hover:scale-105 flex flex-col items-center justify-center gap-0.5 ${heatColour(loc.total, max)} ${selected?.code === loc.code ? "ring-2 ring-white/50" : ""}`}
                        >
                          <span className="text-[10px] font-bold leading-none">{loc.code}</span>
                          <span className="text-[9px] opacity-70 leading-none">{loc.total}</span>
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-1.5 mb-6">
          {data.locations.map(loc => (
            <button
              key={loc.code}
              onClick={() => setSelected(selected?.code === loc.code ? null : loc)}
              className={`rounded border p-2 text-center transition-all hover:scale-105 ${heatColour(loc.total, max)} ${selected?.code === loc.code ? "ring-2 ring-white/50" : ""}`}
            >
              <p className="text-[10px] font-bold truncate">{loc.code}</p>
              <p className="text-base font-bold">{loc.total}</p>
              {loc.uncatalogued > 0 && <p className="text-[9px] opacity-60">{loc.uncatalogued} open</p>}
            </button>
          ))}
        </div>
      )}

      {/* Unlocated pill */}
      {data.unlocated.total > 0 && (
        <button
          onClick={() => setSelected(selected?.code === "UNLOCATED" ? null : data.unlocated)}
          className={`mb-6 inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm transition-all ${
            selected?.code === "UNLOCATED"
              ? "bg-gray-200 dark:bg-gray-700 border-gray-500 text-gray-900 dark:text-white ring-2 ring-white/30"
              : "bg-gray-100 dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:text-white"
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-gray-500 inline-block" />
          {data.unlocated.total} totes with no BC location
        </button>
      )}

      {/* Drill-down panel */}
      {selected && (
        <div className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-300 dark:border-gray-700 rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-gray-900 dark:text-white font-semibold text-base">
                {selected.code === "UNLOCATED" ? "No Location" : `Location ${selected.code}`}
              </h3>
              <p className="text-gray-600 dark:text-gray-500 text-xs mt-0.5">
                {selected.total} totes — {selected.catalogued} catalogued, {selected.uncatalogued} open
              </p>
            </div>
            <button onClick={() => setSelected(null)} className="text-gray-600 hover:text-white text-lg leading-none">✕</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-600 dark:text-gray-500 text-xs border-b border-gray-200 dark:border-gray-800">
                  <th className="text-left pb-2 pr-4">Tote / Barcode</th>
                  <th className="text-left pb-2 pr-4">Category</th>
                  <th className="text-left pb-2 pr-4">Catalogued</th>
                  <th className="text-left pb-2">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800/50">
                {selected.items.map(item => (
                  <tr key={item.id} className="text-gray-600 dark:text-gray-300 hover:bg-white/5">
                    <td className="py-1.5 pr-4 font-mono text-xs text-gray-600 dark:text-gray-400">{item.id}</td>
                    <td className="py-1.5 pr-4 text-xs">{item.category || "—"}</td>
                    <td className="py-1.5 pr-4">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${item.catalogued ? "bg-emerald-900 text-emerald-700 dark:text-emerald-300" : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400"}`}>
                        {item.catalogued ? "Yes" : "No"}
                      </span>
                    </td>
                    <td className="py-1.5 text-gray-600 dark:text-gray-400 text-xs truncate max-w-xs">{item.description || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bar chart */}
      {data.locations.filter(l => l.total > 0).length > 0 && (
        <div className="mt-2">
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-3">Occupancy by Location</h3>
          <div className="space-y-1.5">
            {[...data.locations]
              .filter(l => l.total > 0)
              .sort((a, b) => b.total - a.total)
              .map(loc => (
                <div key={loc.code} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 dark:text-gray-500 w-16 text-right shrink-0">{loc.code}</span>
                  <div className="flex-1 bg-white dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        loc.total / max < 0.25 ? "bg-emerald-500" :
                        loc.total / max < 0.5  ? "bg-yellow-500"  :
                        loc.total / max < 0.75 ? "bg-orange-500"  :
                                                 "bg-red-500"
                      }`}
                      style={{ width: `${(loc.total / max) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-600 dark:text-gray-400 w-8 text-right shrink-0">{loc.total}</span>
                </div>
              ))}
          </div>
        </div>
      )}
      </>}
    </div>
  )
}
