"use client"

import { useState } from "react"
import Link from "next/link"

type HubLot = {
  id: string; title: string; barcode: string | null; receiptUniqueId: string | null
  receipt: string | null; tote: string | null; vendor: string | null
  status: string; addedToBC: boolean; category: string | null; cataloguedBy: string | null
  saleCode: string; saleName: string
}
type BcItem = {
  uniqueId: string; description: string; receiptNo: string; vendorNo: string; vendorName: string
  catalogued: boolean; cataloguedBy: string; saleCode: string; saleName: string
  lotNo: string; location: string; toteNo: string; barcode: string
}
type ToteInfo = { toteNo: string; location: string; receiptNo: string; vendorName: string; catalogued: boolean }
type Result = {
  type: string; q: string
  hub: HubLot[]; bc: BcItem[]; totes: ToteInfo[]
  capped: { hub: boolean; bc: boolean }
}

type Mode = "receipt" | "tote" | "vendor"
const MODES: { key: Mode; label: string; placeholder: string }[] = [
  { key: "receipt", label: "Receipt no",          placeholder: "e.g. R000009" },
  { key: "tote",    label: "Tote no",             placeholder: "e.g. T001868" },
  { key: "vendor",  label: "Customer (vendor) no", placeholder: "e.g. C224652 (or a name for BC)" },
]

const STATUS_TONE: Record<string, string> = {
  ENTERED:   "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200",
  REVIEWED:  "bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300",
  PUBLISHED: "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  SOLD:      "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  UNSOLD:    "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300",
  WITHDRAWN: "bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400",
}

function groupBySale<T extends { saleCode: string; saleName: string }>(rows: T[]) {
  const m = new Map<string, { code: string; name: string; rows: T[] }>()
  for (const r of rows) {
    const key = `${r.saleCode}||${r.saleName}`   // keep distinct sales apart even when the code is blank
    if (!m.has(key)) m.set(key, { code: r.saleCode, name: r.saleName, rows: [] })
    m.get(key)!.rows.push(r)
  }
  return [...m.values()].sort((a, b) => (a.code || "~").localeCompare(b.code || "~"))
}

const card = "bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800"

export default function LookupClient() {
  const [mode, setMode]       = useState<Mode>("receipt")
  const [value, setValue]     = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [data, setData]       = useState<Result | null>(null)

  async function search() {
    const q = value.trim()
    if (!q || loading) return
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/lot-lookup?type=${mode}&q=${encodeURIComponent(q)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.statusText)
      setData(json)
    } catch (e: any) { setError(e.message); setData(null) }
    finally { setLoading(false) }
  }

  const modeLabel = MODES.find((m) => m.key === mode)!.label
  const hubGroups = data ? groupBySale(data.hub) : []
  const bcGroups  = data ? groupBySale(data.bc) : []
  const bcCatalogued = data ? data.bc.filter((b) => b.catalogued).length : 0

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-1 flex items-center gap-2">
        <Link href="/hub" className="text-sm text-gray-400 hover:text-indigo-500">← Hub</Link>
      </div>
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white">🎛️ Admin Centre</h1>
      <p className="text-sm text-gray-500 mt-1 mb-6">
        Lot lookup — search by receipt, tote or customer (vendor) number to see every lot, what&apos;s been catalogued and
        which sale it&apos;s in, across both the Hub cataloguing system and Business Central.
      </p>

      {/* Search bar */}
      <div className={`${card} p-4 mb-6`}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-700">
            {MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                className={`px-3 py-2 text-sm font-medium transition-colors ${
                  mode === m.key
                    ? "bg-indigo-600 text-white"
                    : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") search() }}
            placeholder={MODES.find((m) => m.key === mode)!.placeholder}
            autoFocus
            className="flex-1 min-w-[220px] px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <button
            onClick={search} disabled={loading || !value.trim()}
            className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50"
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
        {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
      </div>

      {data && (
        <>
          {/* Summary */}
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {modeLabel} <span className="font-semibold text-gray-900 dark:text-white">{data.q}</span> —{" "}
            <span className="font-semibold text-indigo-600 dark:text-indigo-400">{data.hub.length}</span> lot{data.hub.length === 1 ? "" : "s"} in the Hub
            {" · "}
            <span className="font-semibold text-orange-600 dark:text-orange-400">{data.bc.length}</span> item{data.bc.length === 1 ? "" : "s"} in BC
            {data.bc.length > 0 && <> ({bcCatalogued} catalogued)</>}
          </p>

          {/* Tote scope caveat — neither system tags a lot with its tote reliably. */}
          {data.type === "tote" && (
            <p className="text-[11px] text-amber-600 dark:text-amber-500 mb-4 -mt-2">
              Lots aren&apos;t individually tagged with a tote, so these are all lots on the tote&apos;s receipt — they may include other totes booked on the same receipt.
            </p>
          )}

          {/* Tote context */}
          {data.type === "tote" && data.totes.length > 0 && (
            <div className={`${card} p-4 mb-6`}>
              <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Tote</h3>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                {data.totes.map((t) => (
                  <div key={t.toteNo} className="text-gray-700 dark:text-gray-300">
                    <span className="font-mono font-semibold">{t.toteNo}</span>
                    {t.location && <> · Location <span className="font-mono">{t.location}</span></>}
                    {t.receiptNo && <> · Receipt <span className="font-mono">{t.receiptNo}</span></>}
                    {t.vendorName && <> · {t.vendorName}</>}
                    {t.catalogued && <span className="ml-1 text-emerald-600 dark:text-emerald-400">· catalogued</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Hub cataloguing */}
            <div className={`${card} p-4`}>
              <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-1">🗂 Hub cataloguing</h2>
              <p className="text-[11px] text-gray-400 mb-3">Lots entered in the Hub cataloguing tool.</p>
              {data.capped.hub && <p className="text-[11px] text-amber-500 mb-2">Showing the first 500 — narrow your search.</p>}
              {hubGroups.length === 0 ? (
                <p className="text-sm text-gray-400 py-4">No matching lots in the Hub.</p>
              ) : hubGroups.map((g) => (
                <div key={`${g.code}||${g.name}`} className="mb-4 last:mb-0">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1.5">
                    {g.code ? <><span className="font-mono">{g.code}</span>{g.name ? ` — ${g.name}` : ""}</> : "No sale assigned"}
                    <span className="text-gray-400 font-normal"> · {g.rows.length} lot{g.rows.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-[10px] uppercase text-gray-400 border-b border-gray-200 dark:border-gray-800">
                        <tr><th className="text-left py-1 pr-2">Lot</th><th className="text-left py-1 pr-2">Title</th><th className="text-left py-1 pr-2">Status</th><th className="text-left py-1">BC</th></tr>
                      </thead>
                      <tbody>
                        {g.rows.map((l) => (
                          <tr key={l.id} className="border-b border-gray-100 dark:border-gray-800/60">
                            <td className="py-1.5 pr-2 font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">{l.barcode || l.receiptUniqueId || "—"}</td>
                            <td className="py-1.5 pr-2 text-gray-700 dark:text-gray-300 max-w-[220px] truncate" title={l.title}>{l.title}</td>
                            <td className="py-1.5 pr-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_TONE[l.status] ?? STATUS_TONE.ENTERED}`}>{l.status}</span></td>
                            <td className="py-1.5">{l.addedToBC ? <span className="text-emerald-500" title="Added to BC">✓</span> : <span className="text-gray-400">—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>

            {/* Business Central */}
            <div className={`${card} p-4`}>
              <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-1">🏢 Business Central</h2>
              <p className="text-[11px] text-gray-400 mb-3">Items in BC (as of the last warehouse sync).</p>
              {data.capped.bc && <p className="text-[11px] text-amber-500 mb-2">Showing the first 500 — narrow your search.</p>}
              {bcGroups.length === 0 ? (
                <p className="text-sm text-gray-400 py-4">No matching items in Business Central.</p>
              ) : bcGroups.map((g) => (
                <div key={`${g.code}||${g.name}`} className="mb-4 last:mb-0">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1.5">
                    {g.code ? <><span className="font-mono">{g.code}</span>{g.name ? ` — ${g.name}` : ""}</> : "No sale allocated"}
                    <span className="text-gray-400 font-normal"> · {g.rows.length} item{g.rows.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-[10px] uppercase text-gray-400 border-b border-gray-200 dark:border-gray-800">
                        <tr><th className="text-left py-1 pr-2">Item</th><th className="text-left py-1 pr-2">Catalogued</th><th className="text-left py-1 pr-2">Lot</th><th className="text-left py-1">Location</th></tr>
                      </thead>
                      <tbody>
                        {g.rows.map((w) => (
                          <tr key={w.uniqueId} className="border-b border-gray-100 dark:border-gray-800/60">
                            <td className="py-1.5 pr-2 text-gray-700 dark:text-gray-300 max-w-[200px] truncate" title={`${w.uniqueId}${w.description ? " · " + w.description : ""}`}>
                              <span className="font-mono text-gray-500">{w.uniqueId}</span>{w.description ? ` · ${w.description}` : ""}
                            </td>
                            <td className="py-1.5 pr-2 whitespace-nowrap">{w.catalogued ? <span className="text-emerald-600 dark:text-emerald-400">✓ Yes{w.cataloguedBy ? ` · ${w.cataloguedBy}` : ""}</span> : <span className="text-gray-400">No</span>}</td>
                            <td className="py-1.5 pr-2 font-mono text-gray-600 dark:text-gray-400">{w.lotNo || "—"}</td>
                            <td className="py-1.5 font-mono text-gray-600 dark:text-gray-400">{w.location || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
