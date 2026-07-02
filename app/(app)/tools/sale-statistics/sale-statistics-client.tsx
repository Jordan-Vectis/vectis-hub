"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts"

// ─── Types (mirror the /api/bc/sale-statistics result) ─────────────────────────

type Bucket = {
  auctionNo: string; auctionName: string; auctionDate: string
  category: string; subcategory: string
  lots: number; sold: number; hammer: number; low: number; high: number; collected: number
  withdrawn: number; sellerPremium: number
}
type SaleDist = { auctionNo: string; vendors: number; successfulBuyers: number }
type Result = {
  buckets: Bucket[]
  total: number
  partial: boolean
  buyersPremiumRate: number
  range: { from: string; to: string }
  commissionField?: string
  withdrawnField?: string
  vendorField?: string
  buyerField?: string
  saleDistinct?: SaleDist[]
  totalVendors?: number
  totalSuccessfulBuyers?: number
}

// ─── Date helpers (LOCAL calendar — never toISOString, it shifts under BST) ─────

const pad = (n: number) => String(n).padStart(2, "0")
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const today = () => fmt(new Date())
const startOfMonth = () => { const d = new Date(); return fmt(new Date(d.getFullYear(), d.getMonth(), 1)) }
const startOfYear = () => fmt(new Date(new Date().getFullYear(), 0, 1))
const monthsAgo = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() - n); return fmt(d) }
function lastMonthRange(): [string, string] {
  const d = new Date()
  const end = new Date(d.getFullYear(), d.getMonth(), 0)
  const start = new Date(end.getFullYear(), end.getMonth(), 1)
  return [fmt(start), fmt(end)]
}

const PRESETS: { label: string; range: () => [string, string] }[] = [
  { label: "This month",     range: () => [startOfMonth(), today()] },
  { label: "Last month",     range: () => lastMonthRange() },
  { label: "Last 3 months",  range: () => [monthsAgo(3), today()] },
  { label: "This year",      range: () => [startOfYear(), today()] },
  { label: "Last 12 months", range: () => [monthsAgo(12), today()] },
]

// ─── Formatting ────────────────────────────────────────────────────────────────

const gbp0 = (n: number) => "£" + Math.round(n).toLocaleString("en-GB")
const gbp2 = (n: number) => "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const int  = (n: number) => n.toLocaleString("en-GB")
const pct  = (n: number) => (n * 100).toFixed(1) + "%"
const pctS = (n: number) => (n >= 0 ? "+" : "") + (n * 100).toFixed(1) + "%"
const gbpSigned = (n: number) => (n >= 0 ? "+£" : "−£") + Math.abs(Math.round(n)).toLocaleString("en-GB")

// ─── Aggregation ───────────────────────────────────────────────────────────────

type Roll = { lots: number; sold: number; hammer: number; low: number; high: number; collected: number; withdrawn: number; sellerPremium: number }
function rollup(bs: Bucket[]): Roll {
  const r: Roll = { lots: 0, sold: 0, hammer: 0, low: 0, high: 0, collected: 0, withdrawn: 0, sellerPremium: 0 }
  for (const b of bs) { r.lots += b.lots; r.sold += b.sold; r.hammer += b.hammer; r.low += b.low; r.high += b.high; r.collected += b.collected; r.withdrawn += b.withdrawn; r.sellerPremium += b.sellerPremium }
  return r
}
const avgLot = (r: Roll) => (r.sold > 0 ? r.hammer / r.sold : 0)
// Passed = unsold at auction, excluding withdrawn lots. Sell-through denominator
// likewise excludes withdrawn (they never went under the hammer).
const passed = (r: Roll) => Math.max(0, r.lots - r.sold - r.withdrawn)
const sellThrough = (r: Roll) => { const d = r.lots - r.withdrawn; return d > 0 ? r.sold / d : 0 }
const vsHigh = (r: Roll) => (r.high > 0 ? r.hammer / r.high - 1 : 0)          // sale value vs high estimate
const aveVendorPct = (r: Roll) => (r.hammer > 0 ? r.sellerPremium / r.hammer : 0)

// ─── Stream reader ─────────────────────────────────────────────────────────────

async function runStream(
  url: string,
  onProgress: (done: number) => void,
  onResult: (data: Result) => void,
  onError: (err: string) => void,
) {
  const res = await fetch(url)
  if (!res.ok) {
    let m = res.statusText
    try { const j = await res.json(); m = j.error ?? m } catch {}
    onError(m); return
  }
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split("\n"); buf = lines.pop()!
    for (const line of lines) {
      if (!line.trim()) continue
      const msg = JSON.parse(line)
      if (msg.type === "progress") onProgress(msg.done)
      else if (msg.type === "result") onResult(msg.data)
      else if (msg.type === "error") onError(msg.error ?? "Unknown error")
    }
  }
}

// Fetch one period and resolve with its aggregated result (used by compare mode).
function fetchRange(from: string, to: string): Promise<Result> {
  return new Promise((resolve, reject) => {
    runStream(`/api/bc/sale-statistics?from=${from}&to=${to}`, () => {}, resolve, e => reject(new Error(e)))
      .catch(reject)
  })
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December", "Full year"]
const YEARS = (() => { const y = new Date().getFullYear(); return Array.from({ length: y - 2021 }, (_, i) => y - i) })()
// m: 0-11 = that month; 12 = whole year. Returns [from, to] for the given year.
function monthYearRange(m: number, y: number): [string, string] {
  if (m >= 12) return [`${y}-01-01`, `${y}-12-31`]
  const last = new Date(y, m + 1, 0).getDate()
  return [`${y}-${pad(m + 1)}-01`, `${y}-${pad(m + 1)}-${pad(last)}`]
}

// ─── Component ─────────────────────────────────────────────────────────────────

const selCls = "bg-white dark:bg-[#0d0f1a] border border-gray-300 dark:border-gray-700 rounded px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[#2AB4A6]"

export default function SaleStatisticsClient() {
  const [preset, setPreset] = useState("This month")
  const [[from, to], setRange] = useState<[string, string]>(() => PRESETS[0].range())
  const [data, setData]       = useState<Result | null>(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError]     = useState<string | null>(null)

  // Client-side drill-down filters (applied over the fetched buckets)
  const [sale, setSale]           = useState("all")
  const [category, setCategory]   = useState("all")
  const [subcategory, setSubcategory] = useState("all")

  // Compare mode — two periods (month + year) side by side
  const [mode, setMode] = useState<"single" | "compare">("single")
  const [pa, setPa] = useState({ m: new Date().getMonth(), y: new Date().getFullYear() })
  const [pb, setPb] = useState({ m: new Date().getMonth(), y: new Date().getFullYear() - 1 })
  const [dataA, setDataA] = useState<Result | null>(null)
  const [dataB, setDataB] = useState<Result | null>(null)
  const [cmpLoading, setCmpLoading] = useState(false)
  const [cmpErr, setCmpErr] = useState<string | null>(null)

  const load = useCallback((f: string, t: string) => {
    if (!f || !t) return
    setLoading(true); setError(null); setProgress(0); setData(null)
    runStream(
      `/api/bc/sale-statistics?from=${f}&to=${t}`,
      d => setProgress(d),
      r => setData(r),
      e => setError(e),
    ).catch(e => setError(e.message ?? "Failed")).finally(() => setLoading(false))
  }, [])

  // Debounced so typing into the custom date inputs doesn't fire a fetch per keystroke.
  useEffect(() => {
    const t = setTimeout(() => load(from, to), 200)
    return () => clearTimeout(t)
  }, [from, to, load])

  // Compare mode: fetch both periods whenever they change.
  useEffect(() => {
    if (mode !== "compare") return
    let cancelled = false
    const t = setTimeout(() => {
      setCmpLoading(true); setCmpErr(null); setDataA(null); setDataB(null)
      Promise.all([
        fetchRange(...monthYearRange(pa.m, pa.y)),
        fetchRange(...monthYearRange(pb.m, pb.y)),
      ])
        .then(([a, b]) => { if (!cancelled) { setDataA(a); setDataB(b) } })
        .catch(e => { if (!cancelled) setCmpErr(e?.message ?? String(e)) })
        .finally(() => { if (!cancelled) setCmpLoading(false) })
    }, 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [mode, pa, pb])

  function applyPreset(label: string) {
    const p = PRESETS.find(x => x.label === label)
    if (!p) return
    setPreset(label); setRange(p.range())
  }

  const buckets = useMemo(() => data?.buckets ?? [], [data])
  const rate    = data?.buyersPremiumRate ?? 0.225

  // Distinct sales for the dropdown (most recent first)
  const sales = useMemo(() => {
    const m = new Map<string, { name: string; date: string }>()
    for (const b of buckets) if (!m.has(b.auctionNo)) m.set(b.auctionNo, { name: b.auctionName, date: b.auctionDate })
    return [...m.entries()].map(([code, v]) => ({ code, ...v })).sort((a, b) => (b.date || "").localeCompare(a.date || ""))
  }, [buckets])

  // Category / subcategory option lists reflect the sale (and category) selection
  const categories = useMemo(() => {
    const s = new Set<string>()
    for (const b of buckets) if (sale === "all" || b.auctionNo === sale) s.add(b.category)
    return [...s].sort()
  }, [buckets, sale])

  const subcategories = useMemo(() => {
    const s = new Set<string>()
    for (const b of buckets) {
      if (sale !== "all" && b.auctionNo !== sale) continue
      if (category !== "all" && b.category !== category) continue
      s.add(b.subcategory)
    }
    return [...s].sort()
  }, [buckets, sale, category])

  // Apply the active filters
  const filtered = useMemo(() => buckets.filter(b =>
    (sale === "all" || b.auctionNo === sale) &&
    (category === "all" || b.category === category) &&
    (subcategory === "all" || b.subcategory === subcategory)
  ), [buckets, sale, category, subcategory])

  const totals = useMemo(() => rollup(filtered), [filtered])

  // Compare rollups — filtered by category/subcategory only (a sale is a single period)
  const rollA = useMemo(() => rollup((dataA?.buckets ?? []).filter(b =>
    (category === "all" || b.category === category) && (subcategory === "all" || b.subcategory === subcategory)
  )), [dataA, category, subcategory])
  const rollB = useMemo(() => rollup((dataB?.buckets ?? []).filter(b =>
    (category === "all" || b.category === category) && (subcategory === "all" || b.subcategory === subcategory)
  )), [dataB, category, subcategory])
  const cmpCategories = useMemo(() => {
    const s = new Set<string>()
    for (const b of dataA?.buckets ?? []) s.add(b.category)
    for (const b of dataB?.buckets ?? []) s.add(b.category)
    return [...s].sort()
  }, [dataA, dataB])

  // By sale
  const bySale = useMemo(() => {
    const m = new Map<string, { code: string; name: string; date: string; roll: Bucket[] }>()
    for (const b of filtered) {
      const e = m.get(b.auctionNo) ?? { code: b.auctionNo, name: b.auctionName, date: b.auctionDate, roll: [] }
      e.roll.push(b); m.set(b.auctionNo, e)
    }
    return [...m.values()].map(e => ({ ...e, r: rollup(e.roll) })).sort((a, b) => b.r.hammer - a.r.hammer)
  }, [filtered])

  // By category + subcategory (the drill-down on average hammer)
  const byCat = useMemo(() => {
    const m = new Map<string, { category: string; subcategory: string; roll: Bucket[] }>()
    for (const b of filtered) {
      const key = `${b.category}|${b.subcategory}`
      const e = m.get(key) ?? { category: b.category, subcategory: b.subcategory, roll: [] }
      e.roll.push(b); m.set(key, e)
    }
    return [...m.values()].map(e => ({ ...e, r: rollup(e.roll) })).sort((a, b) => b.r.hammer - a.r.hammer)
  }, [filtered])

  // Chart / highlight data (bySale is sorted by hammer desc → [0] is the best sale)
  const bestSale = bySale.length ? bySale[0] : null
  const byCategory = useMemo(() => {
    const m = new Map<string, Bucket[]>()
    for (const b of filtered) { const a = m.get(b.category) ?? []; a.push(b); m.set(b.category, a) }
    return [...m.entries()].map(([category, bs]) => ({ category, r: rollup(bs) })).sort((x, y) => y.r.hammer - x.r.hammer)
  }, [filtered])
  const topSalesData = useMemo(() => bySale.slice(0, 10).map(s => {
    const nm = s.name.length > 22 ? s.name.slice(0, 21) + "…" : s.name
    return { label: `${s.code} · ${s.date}${nm ? " · " + nm : ""}`, value: s.r.hammer }
  }), [bySale])
  const catChartData = useMemo(() => byCategory.filter(c => c.r.high > 0).slice(0, 14).map(c => ({ category: c.category, pct: vsHigh(c.r) })), [byCategory])

  // Distinct vendor / buyer counts are per-sale (can't be summed or category-sliced).
  const saleDistinct = useMemo(
    () => new Map((data?.saleDistinct ?? []).map(s => [s.auctionNo, s] as [string, SaleDist])),
    [data],
  )
  const catFiltered = category !== "all" || subcategory !== "all"
  const distinctCard = (field: string | undefined, total: number | undefined, key: keyof SaleDist, noField: string) =>
    !field       ? { v: "—", s: noField }
    : catFiltered ? { v: "—", s: "per sale — clear category" }
    : sale === "all"
      ? { v: int(total ?? 0), s: "distinct across range" }
      : { v: int(Number(saleDistinct.get(sale)?.[key] ?? 0)), s: "in this sale" }
  const vendorsCard = distinctCard(data?.vendorField, data?.totalVendors, "vendors", "no vendor field found")
  const buyersCard  = distinctCard(data?.buyerField, data?.totalSuccessfulBuyers, "successfulBuyers", "not on the lines")

  const salesCount = bySale.length
  const hero = [
    { label: "Total Sale Value",  value: gbp0(totals.hammer),                                       sub: `${int(salesCount)} sale${salesCount === 1 ? "" : "s"} · ${int(totals.sold)} lots sold` },
    { label: "BP Earned",         value: gbp0(totals.hammer * rate),                                sub: `${(rate * 100).toFixed(1)}% buyer's premium` },
    { label: "Vendor Commission", value: data?.commissionField ? gbp0(totals.sellerPremium) : "—",  sub: data?.commissionField ? `avg ${pct(aveVendorPct(totals))}` : "no commission field" },
    { label: "Completed Sales",   value: int(salesCount),                                           sub: "in selected range" },
    { label: "Avg Sell-through",  value: pct(sellThrough(totals)),                                  sub: `${int(totals.sold)} of ${int(Math.max(0, totals.lots - totals.withdrawn))} lots` },
    { label: "Avg vs High Est",   value: pctS(vsHigh(totals)),                                      sub: `vs ${gbp0(totals.high)} high est` },
  ]

  const cards = [
    { label: "Total low estimate",  value: gbp0(totals.low),        sub: "sum of low estimates" },
    { label: "Total high estimate", value: gbp0(totals.high),       sub: "sum of high estimates" },
    { label: "Average lot value",   value: gbp2(avgLot(totals)),    sub: "hammer ÷ sold" },
    { label: "Lots passed",         value: int(passed(totals)),     sub: "unsold (£0 hammer)" },
    { label: "Lots withdrawn",      value: int(totals.withdrawn),   sub: data?.withdrawnField ? "withdrawn ticked" : "no withdrawn field" },
    { label: "Items collected",     value: int(totals.collected),   sub: "scanned to collected" },
    { label: "No. of vendors",      value: vendorsCard.v,           sub: vendorsCard.s },
    { label: "Successful buyers",   value: buyersCard.v,            sub: buyersCard.s },
  ]

  const cmpMetrics: { label: string; get: (r: Roll) => number; kind: "money" | "int" | "pct" }[] = [
    { label: "Sale Value",        get: r => r.hammer,        kind: "money" },
    { label: "Lots Sold",         get: r => r.sold,          kind: "int" },
    { label: "Lots Passed",       get: r => passed(r),       kind: "int" },
    { label: "Lots Withdrawn",    get: r => r.withdrawn,     kind: "int" },
    { label: "Sell-through",      get: r => sellThrough(r),  kind: "pct" },
    { label: "Low Estimate",      get: r => r.low,           kind: "money" },
    { label: "High Estimate",     get: r => r.high,          kind: "money" },
    { label: "Vs High Est",       get: r => vsHigh(r),       kind: "pct" },
    { label: "£ vs High Est",     get: r => r.hammer - r.high, kind: "money" },
    { label: "BP Earned",         get: r => r.hammer * rate, kind: "money" },
    { label: "Vendor Commission", get: r => r.sellerPremium, kind: "money" },
    { label: "Ave Vendor %",      get: r => aveVendorPct(r), kind: "pct" },
    { label: "Avg Lot",           get: r => avgLot(r),       kind: "money" },
    { label: "Items Collected",   get: r => r.collected,     kind: "int" },
  ]

  return (
    <div className="p-6 max-w-screen-2xl">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Sale Statistics</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
          Sale performance from Business Central auction lines — filter by sale, month, year, category and subcategory.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-1 mb-4">
        {(["single", "compare"] as const).map(mo => (
          <button key={mo} onClick={() => setMode(mo)}
            className={`px-3 py-1.5 text-xs font-semibold rounded border transition-colors ${
              mode === mo ? "bg-[#2AB4A6] text-white border-[#2AB4A6]"
                : "bg-gray-100 dark:bg-[#0d0f1a] text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-700 hover:border-gray-500"}`}>
            {mo === "single" ? "Single period" : "Compare periods"}
          </button>
        ))}
      </div>

      {mode === "single" && (<>
      {/* Date presets + custom range */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => applyPreset(p.label)}
              className={`px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
                preset === p.label
                  ? "bg-[#2AB4A6] text-white border-[#2AB4A6]"
                  : "bg-gray-100 dark:bg-[#0d0f1a] text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-700 hover:border-gray-500"
              }`}
            >{p.label}</button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <label className="text-xs text-gray-500 dark:text-gray-400">
            <span className="block mb-1 uppercase tracking-wider">From</span>
            <input type="date" value={from} onChange={e => { setPreset(""); setRange([e.target.value, to]) }} className={selCls} />
          </label>
          <label className="text-xs text-gray-500 dark:text-gray-400">
            <span className="block mb-1 uppercase tracking-wider">To</span>
            <input type="date" value={to} onChange={e => { setPreset(""); setRange([from, e.target.value]) }} className={selCls} />
          </label>
          <button onClick={() => load(from, to)} disabled={loading}
            className="px-4 py-1.5 rounded bg-[#2AB4A6] hover:bg-[#24a090] text-white text-sm font-medium disabled:opacity-50">
            {loading ? "Loading…" : "↺ Reload"}
          </button>
        </div>
      </div>

      {/* Drill-down filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select value={sale} onChange={e => { setSale(e.target.value); setCategory("all"); setSubcategory("all") }} className={selCls}>
          <option value="all">All sales{sales.length ? ` (${sales.length})` : ""}</option>
          {sales.map(s => <option key={s.code} value={s.code}>{s.code}{s.name ? ` — ${s.name}` : ""}</option>)}
        </select>
        <select value={category} onChange={e => { setCategory(e.target.value); setSubcategory("all") }} className={selCls}>
          <option value="all">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={subcategory} onChange={e => setSubcategory(e.target.value)} className={selCls}>
          <option value="all">All subcategories</option>
          {subcategories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {loading && <p className="text-xs text-gray-500 mb-4">Fetching from Business Central… {int(progress)} lots</p>}
      {error && <p className="text-red-400 text-sm mb-4">{error === "BC_NOT_CONNECTED" ? "Business Central isn't connected on this environment." : error}</p>}
      {data?.partial && !loading && (
        <p className="text-amber-500 text-xs mb-4">Showing a partial result — the range is large and hit the fetch time limit. Narrow the dates for a complete figure.</p>
      )}

      {data && !loading && (
        <>
          {/* Headline KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
            {hero.map((c, i) => (
              <div key={c.label} className={`rounded-xl border p-4 ${i === 0
                ? "border-[#2AB4A6] bg-[#2AB4A6]/10"
                : "border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#0d0f1a]"}`}>
                <p className="text-[11px] text-gray-500 dark:text-gray-500 uppercase tracking-wider mb-1">{c.label}</p>
                <p className={`text-2xl font-bold ${i === 0 ? "text-[#1f8d82] dark:text-[#2AB4A6]" : "text-gray-900 dark:text-white"}`}>{c.value}</p>
                <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-1">{c.sub}</p>
              </div>
            ))}
          </div>

          {/* Secondary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
            {cards.map(c => (
              <div key={c.label} className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-200 dark:border-gray-800 rounded-lg p-3.5">
                <p className="text-[11px] text-gray-500 dark:text-gray-500 mb-1 uppercase tracking-wider">{c.label}</p>
                <p className="text-lg font-bold text-gray-900 dark:text-white">{c.value}</p>
                <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-0.5">{c.sub}</p>
              </div>
            ))}
          </div>

          {/* Best sale highlight */}
          {bestSale && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/[0.06] p-4 mb-6 flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-0.5">Best sale in period</p>
                <p className="text-base font-bold text-gray-900 dark:text-white">
                  <span className="font-mono text-[#2AB4A6] mr-1.5">{bestSale.code}</span>{bestSale.name}
                </p>
                <p className="text-xs text-gray-500">{bestSale.date} · {pct(sellThrough(bestSale.r))} sell-through · {pctS(vsHigh(bestSale.r))} vs high est</p>
              </div>
              <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">{gbp0(bestSale.r.hammer)}</p>
            </div>
          )}

          {/* Charts */}
          <div className="grid lg:grid-cols-2 gap-4 mb-6">
            <div className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-200 dark:border-gray-800 rounded-xl p-4">
              <h2 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Top sales by value</h2>
              {topSalesData.length ? (
                <ResponsiveContainer width="100%" height={Math.max(180, topSalesData.length * 34 + 20)}>
                  <BarChart data={topSalesData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#9ca3af22" />
                    <XAxis type="number" tickFormatter={v => "£" + Math.round(Number(v) / 1000) + "k"} tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="label" width={220} tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ fill: "rgba(42,180,166,0.08)" }} contentStyle={{ background: "#111827", border: "1px solid #2d3047", borderRadius: 6, fontSize: 12, color: "#fff" }} formatter={v => gbp0(Number(v))} />
                    <Bar dataKey="value" fill="#2AB4A6" radius={[0, 3, 3, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="text-sm text-gray-500 py-8 text-center">No data</p>}
            </div>

            <div className="bg-gray-100 dark:bg-[#0d0f1a] border border-gray-200 dark:border-gray-800 rounded-xl p-4">
              <h2 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">% over / under high estimate by category</h2>
              {catChartData.length ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={catChartData} margin={{ top: 4, right: 8, left: 0, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#9ca3af22" />
                    <XAxis dataKey="category" interval={0} angle={-35} textAnchor="end" height={70} tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={v => Math.round(Number(v) * 100) + "%"} tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} contentStyle={{ background: "#111827", border: "1px solid #2d3047", borderRadius: 6, fontSize: 12, color: "#fff" }} formatter={v => pctS(Number(v))} />
                    <Bar dataKey="pct" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                      {catChartData.map((d, i) => <Cell key={i} fill={d.pct >= 0 ? "#2AB4A6" : "#ef4444"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="text-sm text-gray-500 py-8 text-center">No data</p>}
            </div>
          </div>

          {/* By sale — matches the manual "2026 by auction" columns */}
          <Section title={`By sale${bySale.length ? ` (${bySale.length})` : ""}`}>
            <DataTable
              rows={bySale}
              initialSort={{ index: 9, dir: "desc" }}
              filterPlaceholder="Filter sales by number, name or date…"
              columns={[
                { label: "Sale",             render: s => <span className="font-mono text-[#2AB4A6]">{s.code}</span>, sort: s => s.code, text: s => s.code },
                { label: "Name",             render: s => <span className="text-gray-500 dark:text-gray-400">{s.name}</span>, sort: s => s.name, text: s => s.name },
                { label: "Date",             render: s => <span className="text-gray-500 dark:text-gray-500 font-mono text-xs">{s.date}</span>, sort: s => s.date, text: s => s.date },
                { label: "Lots Sold",        align: "right", render: s => int(s.r.sold),          sort: s => s.r.sold },
                { label: "Lots Passed",      align: "right", render: s => int(passed(s.r)),       sort: s => passed(s.r) },
                { label: "Lots Withdrawn",   align: "right", render: s => int(s.r.withdrawn),     sort: s => s.r.withdrawn },
                { label: "Sell-through",     align: "right", render: s => pct(sellThrough(s.r)),  sort: s => sellThrough(s.r) },
                { label: "Low Estimate",     align: "right", render: s => gbp0(s.r.low),          sort: s => s.r.low },
                { label: "High Estimate",    align: "right", render: s => gbp0(s.r.high),         sort: s => s.r.high },
                { label: "Sale Value",       align: "right", render: s => gbp0(s.r.hammer),       sort: s => s.r.hammer },
                { label: "Avg Lot",          align: "right", render: s => gbp2(avgLot(s.r)),      sort: s => avgLot(s.r) },
                { label: "Vs High Est",      align: "right", sort: s => vsHigh(s.r), render: s => <span className={s.r.hammer - s.r.high >= 0 ? "text-emerald-500" : "text-red-400"}>{pctS(vsHigh(s.r))}</span> },
                { label: "£ vs High",        align: "right", sort: s => s.r.hammer - s.r.high, render: s => <span className={s.r.hammer - s.r.high >= 0 ? "text-emerald-500" : "text-red-400"}>{gbpSigned(s.r.hammer - s.r.high)}</span> },
                { label: "BP Earned",        align: "right", render: s => gbp0(s.r.hammer * rate), sort: s => s.r.hammer * rate },
                { label: "Vendor Commission",align: "right", render: s => gbp0(s.r.sellerPremium), sort: s => s.r.sellerPremium },
                { label: "Ave Vendor %",     align: "right", render: s => pct(aveVendorPct(s.r)),  sort: s => aveVendorPct(s.r) },
                { label: "Collected",        align: "right", render: s => int(s.r.collected),      sort: s => s.r.collected },
                { label: "Vendors",          align: "right", render: s => int(saleDistinct.get(s.code)?.vendors ?? 0), sort: s => saleDistinct.get(s.code)?.vendors ?? 0 },
                { label: "Buyers",           align: "right", render: s => data?.buyerField ? int(saleDistinct.get(s.code)?.successfulBuyers ?? 0) : "—", sort: s => saleDistinct.get(s.code)?.successfulBuyers ?? 0 },
              ]}
            />
          </Section>

          {/* Category contribution */}
          <Section title="By category & subcategory">
            <DataTable
              rows={byCat}
              initialSort={{ index: 4, dir: "desc" }}
              filterPlaceholder="Filter by category or subcategory…"
              columns={[
                { label: "Category",          render: c => <span className="text-gray-700 dark:text-gray-200">{c.category}</span>, sort: c => c.category, text: c => c.category },
                { label: "Subcategory",       render: c => <span className="text-gray-500 dark:text-gray-400">{c.subcategory}</span>, sort: c => c.subcategory, text: c => c.subcategory },
                { label: "Lots",              align: "right", render: c => int(c.r.lots),   sort: c => c.r.lots },
                { label: "Sold",              align: "right", render: c => int(c.r.sold),   sort: c => c.r.sold },
                { label: "Sale value",        align: "right", render: c => gbp0(c.r.hammer), sort: c => c.r.hammer },
                { label: "Share",             align: "right", render: c => totals.hammer > 0 ? pct(c.r.hammer / totals.hammer) : "—", sort: c => c.r.hammer },
                { label: "Avg hammer (sold)", align: "right", render: c => gbp2(avgLot(c.r)), sort: c => avgLot(c.r) },
              ]}
            />
          </Section>
        </>
      )}
      </>)}

      {mode === "compare" && (
        <>
          {/* Period pickers */}
          <div className="flex flex-wrap items-end gap-6 mb-4">
            {([["A", pa, setPa], ["B", pb, setPb]] as const).map(([tag, p, set]) => (
              <div key={tag} className="flex items-end gap-2">
                <span className="text-xs text-gray-500 uppercase tracking-wider pb-1.5">Period {tag}</span>
                <select value={p.m} onChange={e => set({ ...p, m: Number(e.target.value) })} className={selCls}>
                  {MONTHS.map((mn, i) => <option key={mn} value={i}>{mn}</option>)}
                </select>
                <select value={p.y} onChange={e => set({ ...p, y: Number(e.target.value) })} className={selCls}>
                  {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            ))}
          </div>

          {/* Category filter (applies to both periods) */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <select value={category} onChange={e => { setCategory(e.target.value); setSubcategory("all") }} className={selCls}>
              <option value="all">All categories</option>
              {cmpCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {category !== "all" && (
              <button onClick={() => setCategory("all")} className="text-xs text-gray-500 hover:text-gray-300 underline">clear</button>
            )}
          </div>

          {cmpLoading && <p className="text-xs text-gray-500 mb-4">Fetching both periods from Business Central…</p>}
          {cmpErr && <p className="text-red-400 text-sm mb-4">{cmpErr === "BC_NOT_CONNECTED" ? "Business Central isn't connected on this environment." : cmpErr}</p>}

          {dataA && dataB && !cmpLoading && (
            <Section title={`${MONTHS[pa.m]} ${pa.y} vs ${MONTHS[pb.m]} ${pb.y}${category !== "all" ? ` · ${category}` : ""}`}>
              <Table
                head={["Metric", `${MONTHS[pa.m]} ${pa.y}`, `${MONTHS[pb.m]} ${pb.y}`, "Change"]}
                rows={cmpMetrics.map(m => {
                  const a = m.get(rollA), b = m.get(rollB)
                  const f = m.kind === "money" ? gbp0 : m.kind === "int" ? int : pct
                  const d = a - b
                  const colour = d > 0 ? "text-emerald-500" : d < 0 ? "text-red-400" : "text-gray-500"
                  const change = m.kind === "pct"
                    ? <span className={colour}>{pctS(d)} pts</span>
                    : <span className={colour}>{(d >= 0 ? "+" : "") + f(d)}{b !== 0 ? ` (${pctS(d / b)})` : ""}</span>
                  return [<span key="m" className="text-gray-700 dark:text-gray-200">{m.label}</span>, f(a), f(b), change]
                })}
                rightFrom={1}
              />
            </Section>
          )}
        </>
      )}
    </div>
  )
}

// ─── Small presentational helpers ──────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{title}</h2>
      {children}
    </div>
  )
}

// ─── Sortable + filterable table ───────────────────────────────────────────────

type Col<T> = {
  label: string
  align?: "right"
  render: (r: T) => React.ReactNode
  sort?: (r: T) => number | string   // omit to make a column non-sortable
  text?: (r: T) => string            // included in the free-text filter
}

function DataTable<T>({ columns, rows, initialSort, filterPlaceholder }: {
  columns: Col<T>[]
  rows: T[]
  initialSort?: { index: number; dir: "asc" | "desc" }
  filterPlaceholder?: string
}) {
  const [sortIdx, setSortIdx] = useState(initialSort?.index ?? -1)
  const [dir, setDir] = useState<"asc" | "desc">(initialSort?.dir ?? "desc")
  const [q, setQ] = useState("")

  const query = q.trim().toLowerCase()
  const filtered = query
    ? rows.filter(r => columns.some(c => (c.text?.(r) ?? "").toLowerCase().includes(query)))
    : rows
  const col = sortIdx >= 0 ? columns[sortIdx] : undefined
  const sorted = col?.sort
    ? [...filtered].sort((a, b) => {
        const av = col.sort!(a), bv = col.sort!(b)
        const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv))
        return dir === "asc" ? cmp : -cmp
      })
    : filtered

  const toggle = (i: number) => {
    if (!columns[i].sort) return
    if (sortIdx === i) setDir(d => (d === "asc" ? "desc" : "asc"))
    else { setSortIdx(i); setDir("desc") }
  }

  return (
    <div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder={filterPlaceholder ?? "Filter…"}
        className="mb-2 bg-white dark:bg-[#0d0f1a] border border-gray-300 dark:border-gray-700 rounded px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[#2AB4A6] w-full sm:w-80" />
      <div className="overflow-x-auto border border-gray-200 dark:border-gray-800 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-400 text-xs">
            <tr>
              {columns.map((c, i) => (
                <th key={i} onClick={() => toggle(i)}
                  className={`px-3 py-2 whitespace-nowrap ${c.align === "right" ? "text-right" : "text-left"} ${c.sort ? "cursor-pointer select-none hover:text-gray-900 dark:hover:text-white" : ""} ${sortIdx === i ? "text-[#2AB4A6]" : ""}`}>
                  {c.label}{sortIdx === i ? (dir === "asc" ? " ▲" : " ▼") : c.sort ? " ↕" : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-3 py-4 text-gray-500">No rows match.</td></tr>
            ) : sorted.map((r, ri) => (
              <tr key={ri} className="border-t border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900/40">
                {columns.map((c, ci) => (
                  <td key={ci} className={`px-3 py-2 ${c.align === "right" ? "text-right font-mono text-gray-700 dark:text-gray-200" : ""}`}>{c.render(r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Table({ head, rows, rightFrom }: { head: string[]; rows: React.ReactNode[][]; rightFrom: number }) {
  if (rows.length === 0) return <p className="text-sm text-gray-500 py-4">No data for these filters.</p>
  return (
    <div className="overflow-x-auto border border-gray-200 dark:border-gray-800 rounded-lg">
      <table className="w-full text-sm">
        <thead className="bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-400 text-xs">
          <tr>
            {head.map((h, i) => <th key={h} className={`px-3 py-2 ${i >= rightFrom ? "text-right" : "text-left"}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-t border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900/40">
              {r.map((cell, ci) => (
                <td key={ci} className={`px-3 py-2 ${ci >= rightFrom ? "text-right font-mono text-gray-700 dark:text-gray-200" : ""}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
