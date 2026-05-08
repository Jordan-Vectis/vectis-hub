"use client"

import { useState, useEffect } from "react"
import { Vendor, YEARS, MONTHS, fmt } from "./types"

type InsightType = "top_performers" | "estimate_vs_hammer" | "vendor_success" | "year_in_review"

const TYPES: { value: InsightType; label: string; desc: string }[] = [
  { value: "top_performers",     label: "🏆 Top Performers",       desc: "Leaderboard by category/year" },
  { value: "estimate_vs_hammer", label: "📊 Estimate vs Hammer",   desc: "% over/under estimate by category" },
  { value: "vendor_success",     label: "🤝 Vendor Success",       desc: "Performance for a single consignor" },
  { value: "year_in_review",     label: "📅 Year in Review",       desc: "Whole year retrospective" },
]

export default function InsightsTab() {
  const [type,     setType]     = useState<InsightType>("top_performers")
  const [category, setCategory] = useState("")
  const [year,     setYear]     = useState("")
  const [month,    setMonth]    = useState("")
  const [vendorNo, setVendorNo] = useState("")

  const [categories, setCategories] = useState<string[]>([])
  const [vendors,    setVendors]    = useState<Vendor[]>([])

  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [data,    setData]    = useState<any>(null)

  useEffect(() => {
    fetch("/api/marketing/categories").then(r => r.json()).then(d => { if (d.categories) setCategories(d.categories) }).catch(() => {})
    fetch("/api/marketing/vendors").then(r => r.json()).then(d => { if (d.vendors) setVendors(d.vendors) }).catch(() => {})
  }, [])

  async function run() {
    setLoading(true)
    setError(null)
    setData(null)

    const params = new URLSearchParams({ type })
    if (category) params.set("category", category)
    if (year)     params.set("year", year)
    if (month)    params.set("month", month)
    if (vendorNo) params.set("vendorNo", vendorNo)

    try {
      const res = await fetch(`/api/marketing/insights?${params}`)
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? "Failed to load"); return }
      setData(json)
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">

      {/* ── Type picker ──────────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Pick an Insight</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {TYPES.map(t => (
            <button key={t.value} onClick={() => { setType(t.value); setData(null) }}
              className={`text-left px-4 py-3 rounded-xl border transition-colors ${
                type === t.value ? "border-pink-500 bg-pink-900/30 text-pink-200" : "border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500"
              }`}>
              <div className="font-semibold text-sm">{t.label}</div>
              <div className="text-xs text-gray-500 mt-0.5">{t.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Filters</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {type !== "vendor_success" && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Category</label>
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-pink-500">
                <option value="">All categories</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}

          {type === "vendor_success" && (
            <div className="lg:col-span-2">
              <label className="block text-xs text-gray-400 mb-1">Vendor</label>
              <select value={vendorNo} onChange={e => setVendorNo(e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-pink-500">
                <option value="">— Pick a vendor —</option>
                {vendors.map(v => <option key={v.vendorNo} value={v.vendorNo}>{v.vendorName || v.vendorNo} ({v.vendorNo})</option>)}
              </select>
            </div>
          )}

          {type !== "vendor_success" && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Year{type === "year_in_review" ? " (required)" : ""}</label>
              <select value={year} onChange={e => setYear(e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-pink-500">
                <option value="">Any year</option>
                {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          )}

          {type !== "vendor_success" && type !== "year_in_review" && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Month</label>
              <select value={month} onChange={e => setMonth(e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-pink-500">
                <option value="">Any</option>
                {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          )}
        </div>

        <button onClick={run} disabled={loading || (type === "vendor_success" && !vendorNo) || (type === "year_in_review" && !year)}
          className="bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors">
          {loading ? "Loading…" : "Run Insight"}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-xl px-4 py-3 text-red-300 text-sm">{error}</div>
      )}

      {/* ── Results ──────────────────────────────────────────────────────── */}
      {data && type === "top_performers" && (
        <ResultsPanel title={`🏆 Top Performers (${data.lots.length})`}>
          <LotsTable lots={data.lots} />
        </ResultsPanel>
      )}

      {data && type === "estimate_vs_hammer" && (
        <>
          {data.overall && (
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Overall</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat label="Lots" value={data.overall.count.toLocaleString()} />
                <Stat label="Total Hammer" value={fmt(data.overall.totalHammer)} />
                <Stat label="Estimate Mid" value={fmt(data.overall.totalEstMid)} />
                <Stat label="vs Estimate" value={`${data.overall.performancePct}%`}
                  colour={data.overall.performancePct >= 100 ? "text-green-400" : "text-amber-400"} />
              </div>
            </div>
          )}
          <ResultsPanel title="📊 By Category">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 text-xs border-b border-gray-800">
                  <th className="px-4 py-2">Category</th>
                  <th className="px-4 py-2 text-right">Lots</th>
                  <th className="px-4 py-2 text-right">Total Hammer</th>
                  <th className="px-4 py-2 text-right">Est. Mid</th>
                  <th className="px-4 py-2 text-right">vs Estimate</th>
                </tr>
              </thead>
              <tbody>
                {data.categories.map((c: any) => (
                  <tr key={c.category} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="px-4 py-2 text-gray-200">{c.category}</td>
                    <td className="px-4 py-2 text-right text-gray-400">{c.count}</td>
                    <td className="px-4 py-2 text-right font-mono text-gray-300">{fmt(c.totalHammer)}</td>
                    <td className="px-4 py-2 text-right font-mono text-gray-500">{fmt(c.totalEstimateMid)}</td>
                    <td className={`px-4 py-2 text-right font-bold ${c.performancePct >= 100 ? "text-green-400" : "text-amber-400"}`}>{c.performancePct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResultsPanel>
        </>
      )}

      {data && type === "vendor_success" && (
        <>
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
            <h2 className="text-lg font-bold text-white">{data.vendorName ?? data.vendorNo}</h2>
            <p className="text-xs text-gray-500 mb-3">Vendor No. {data.vendorNo}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Stat label="Total Lots" value={data.count.toLocaleString()} />
              <Stat label="Total Realised" value={fmt(data.totalHammer)} colour="text-green-400" />
              <Stat label="vs Estimate" value={`${data.performancePct}%`} colour={data.performancePct >= 100 ? "text-green-400" : "text-amber-400"} />
            </div>
          </div>
          <ResultsPanel title={`🏆 Top Lots (${data.topLots.length})`}>
            <LotsTable lots={data.topLots} />
          </ResultsPanel>
        </>
      )}

      {data && type === "year_in_review" && (
        <>
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
            <h2 className="text-lg font-bold text-white">Year in Review · {data.year}</h2>
            <div className="grid grid-cols-2 gap-4 mt-3">
              <Stat label="Total Lots Sold" value={data.totalLots.toLocaleString()} />
              <Stat label="Total Hammer" value={fmt(data.totalHammer)} colour="text-green-400" />
            </div>
          </div>
          <ResultsPanel title="📊 Categories by Total Hammer">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 text-xs border-b border-gray-800">
                  <th className="px-4 py-2">Category</th>
                  <th className="px-4 py-2 text-right">Lots</th>
                  <th className="px-4 py-2 text-right">Total Hammer</th>
                </tr>
              </thead>
              <tbody>
                {data.categoryStats.map((c: any) => (
                  <tr key={c.category} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="px-4 py-2 text-gray-200">{c.category}</td>
                    <td className="px-4 py-2 text-right text-gray-400">{c.count}</td>
                    <td className="px-4 py-2 text-right font-mono text-gray-300">{fmt(c.totalHammer)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResultsPanel>
          <ResultsPanel title="🏆 Top 20 Lots of the Year">
            <LotsTable lots={data.topLots} />
          </ResultsPanel>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, colour = "text-white" }: { label: string; value: string; colour?: string }) {
  return (
    <div className="bg-gray-800/50 rounded-lg p-3">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-xl font-bold ${colour}`}>{value}</p>
    </div>
  )
}

function ResultsPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-700">
        <span className="text-sm font-semibold text-gray-300">{title}</span>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  )
}

function LotsTable({ lots }: { lots: any[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-gray-400 text-xs border-b border-gray-800">
          <th className="px-4 py-2">#</th>
          <th className="px-4 py-2">Lot</th>
          <th className="px-4 py-2">Description</th>
          <th className="px-4 py-2">Category</th>
          <th className="px-4 py-2">Hammer</th>
          <th className="px-4 py-2">Sale</th>
        </tr>
      </thead>
      <tbody>
        {lots.map((l, i) => (
          <tr key={l.uniqueId} className="border-b border-gray-800 hover:bg-gray-800/50">
            <td className="px-4 py-2 text-gray-500">{i + 1}</td>
            <td className="px-4 py-2 text-gray-300 whitespace-nowrap">{l.currentLotNo ?? l.lotNo ?? l.uniqueId}</td>
            <td className="px-4 py-2 text-gray-200 max-w-xs truncate">{l.description ?? "—"}</td>
            <td className="px-4 py-2 text-gray-400">{l.category ?? "—"}</td>
            <td className="px-4 py-2 font-semibold text-green-400 whitespace-nowrap">{fmt(l.hammerPrice)}</td>
            <td className="px-4 py-2 text-xs whitespace-nowrap">
              <div className="text-gray-300">{l.auctionName ?? l.auctionCode ?? "—"}</div>
              {l.auctionDate && (
                <div className="text-gray-500 text-[11px] mt-0.5">
                  {new Date(l.auctionDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  {l.auctionCode && l.auctionName && <span className="ml-1.5 text-gray-600">· {l.auctionCode}</span>}
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
