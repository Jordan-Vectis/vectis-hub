"use client"

import { useState } from "react"

// ─── Known endpoints ──────────────────────────────────────────────────────────

const KNOWN_ENDPOINTS = [
  { label: "Auction Line",           value: "EVA_AuctionLine" },
  { label: "Auction Lines",          value: "Auction_Lines_Excel" },
  { label: "Auction Receipt Lines",  value: "Auction_Receipt_Lines_Excel" },
  { label: "Receipt Lines",          value: "Receipt_Lines_Excel" },
  { label: "Receipt Totes",          value: "Receipt_Totes_Excel" },
  { label: "Totes",                  value: "Totes_Excel" },
  { label: "Change Log Entries",     value: "ChangeLogEntries" },
  { label: "Shipment Requests",      value: "ShipmentRequestAPI" },
  { label: "Collection List",        value: "CollectionList" },
  { label: "Posted Collection List", value: "PostedCollectionList" },
  { label: "Items",                  value: "items" },
  { label: "Customers",              value: "customers" },
]

// ─── Types ────────────────────────────────────────────────────────────────────

type FieldInfo = { name: string; sample: any; allNull: boolean }
type Result = { endpoint: string; fields: FieldInfo[]; rows: any[]; count: number }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatValue(v: any): string {
  if (v === null || v === undefined) return "—"
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}

function copyText(text: string) {
  navigator.clipboard.writeText(text).catch(() => {})
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BcApiViewerPage() {
  const [endpoint,  setEndpoint]  = useState("")
  const [limit,     setLimit]     = useState(5)
  const [filter,    setFilter]    = useState("")
  const [orderby,   setOrderby]   = useState("")
  const [loading,   setLoading]   = useState(false)
  const [result,    setResult]    = useState<Result | null>(null)
  const [error,     setError]     = useState<string | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [expandedRow, setExpandedRow] = useState<number | null>(null)

  async function fetch_(ep = endpoint) {
    const e = ep.trim()
    if (!e) return
    setLoading(true)
    setResult(null)
    setError(null)
    setExpandedRow(null)

    const params = new URLSearchParams({ endpoint: e, limit: String(limit) })
    if (filter) params.set("filter", filter)
    if (orderby) params.set("orderby", orderby)

    try {
      const res = await fetch(`/api/bc/api-viewer?${params}`)
      const j   = await res.json()
      if (!res.ok) { setError(j.error ?? `HTTP ${res.status}`); return }
      setResult(j)
      setEndpoint(e)
    } catch (e: any) {
      setError(e.message ?? "Network error")
    } finally {
      setLoading(false)
    }
  }

  function handleCopy(name: string) {
    copyText(name)
    setCopiedField(name)
    setTimeout(() => setCopiedField(null), 1500)
  }

  return (
    <div className="min-h-screen bg-[#0d0f1a] text-gray-200 p-6 space-y-6">

      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold text-white">BC API Viewer</h1>
        <p className="text-sm text-gray-500 mt-1">Inspect field names and sample data from any Business Central endpoint</p>
      </div>

      {/* ── Quick endpoints ── */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Known Endpoints</p>
        <div className="flex flex-wrap gap-2">
          {KNOWN_ENDPOINTS.map(ep => (
            <button key={ep.value}
              onClick={() => { setEndpoint(ep.value); fetch_(ep.value) }}
              className={`text-xs px-3 py-1.5 rounded border transition-colors font-mono
                ${endpoint === ep.value && result
                  ? "bg-[#C8A96E]/20 border-[#C8A96E] text-[#C8A96E]"
                  : "bg-[#1C1C2E] border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200"}`}>
              {ep.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Custom query ── */}
      <div className="bg-[#1C1C2E] border border-gray-700 rounded-xl p-4 space-y-3">
        <p className="text-xs text-gray-500 uppercase tracking-wider">Custom Query</p>

        <div className="flex gap-2">
          <input value={endpoint} onChange={e => setEndpoint(e.target.value)}
            placeholder="Endpoint name e.g. Auction_Receipt_Lines_Excel"
            className="flex-1 bg-[#0d0f1a] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 font-mono focus:outline-none focus:border-[#C8A96E] placeholder:text-gray-600" />
          <select value={limit} onChange={e => setLimit(Number(e.target.value))}
            className="bg-[#0d0f1a] border border-gray-700 rounded px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-[#C8A96E]">
            <option value={1}>1 row</option>
            <option value={5}>5 rows</option>
            <option value={10}>10 rows</option>
            <option value={25}>25 rows</option>
            <option value={50}>50 rows</option>
          </select>
        </div>

        <div className="flex gap-2">
          <input value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="$filter (optional) e.g. Field_Caption eq 'Location'"
            className="flex-1 bg-[#0d0f1a] border border-gray-700 rounded px-3 py-2 text-sm text-gray-400 font-mono focus:outline-none focus:border-[#C8A96E] placeholder:text-gray-600" />
          <input value={orderby} onChange={e => setOrderby(e.target.value)}
            placeholder="$orderby (optional)"
            className="w-48 bg-[#0d0f1a] border border-gray-700 rounded px-3 py-2 text-sm text-gray-400 font-mono focus:outline-none focus:border-[#C8A96E] placeholder:text-gray-600" />
        </div>

        <button onClick={() => fetch_()} disabled={loading || !endpoint.trim()}
          className="px-5 py-2 bg-[#C8A96E] hover:bg-[#d4b87a] disabled:opacity-40 text-black text-sm font-bold rounded transition-colors">
          {loading ? "Fetching…" : "Fetch"}
        </button>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="bg-red-950 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300">
          ✕ {error}
        </div>
      )}

      {/* ── Results ── */}
      {result && (
        <div className="space-y-4">

          {/* Summary */}
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">
              <span className="text-white font-semibold">{result.count}</span> rows returned from{" "}
              <span className="font-mono text-[#C8A96E]">{result.endpoint}</span>
            </span>
            <span className="text-xs text-gray-600">·</span>
            <span className="text-xs text-gray-500">{result.fields.length} fields</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* ── Field names panel ── */}
            <div className="bg-[#1C1C2E] border border-gray-700 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-700 bg-[#16162a] flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Field Names</p>
                <button onClick={() => { copyText(result.fields.map(f => f.name).join("\n")); setCopiedField("__all__"); setTimeout(() => setCopiedField(null), 1500) }}
                  className="text-xs px-2.5 py-1 bg-[#C8A96E]/20 hover:bg-[#C8A96E]/40 text-[#C8A96E] rounded transition-colors">
                  {copiedField === "__all__" ? "✓ Copied" : "Copy All"}
                </button>
              </div>
              <div className="overflow-y-auto max-h-[600px]">
                {result.fields.map(f => (
                  <div key={f.name}
                    className={`flex items-center gap-3 px-4 py-2 border-b border-gray-800 last:border-0 group hover:bg-[#252540] transition-colors ${f.allNull ? "opacity-40" : ""}`}>
                    <span className="flex-1 font-mono text-xs text-gray-300 truncate" title={f.name}>{f.name}</span>
                    <span className="text-xs text-gray-600 truncate max-w-[140px]" title={formatValue(f.sample)}>
                      {formatValue(f.sample)}
                    </span>
                    {f.allNull && <span className="text-xs text-gray-700 flex-shrink-0">all null</span>}
                    <button onClick={() => handleCopy(f.name)}
                      className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-xs px-2 py-0.5 bg-[#C8A96E]/20 hover:bg-[#C8A96E]/40 text-[#C8A96E] rounded">
                      {copiedField === f.name ? "✓" : "copy"}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Raw rows panel ── */}
            <div className="bg-[#1C1C2E] border border-gray-700 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-700 bg-[#16162a]">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Sample Rows — click to expand</p>
              </div>
              <div className="overflow-y-auto max-h-[600px]">
                {result.rows.map((row, i) => (
                  <div key={i} className="border-b border-gray-800 last:border-0">
                    <button onClick={() => setExpandedRow(expandedRow === i ? null : i)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[#252540] transition-colors text-left">
                      <span className="text-xs text-gray-600 flex-shrink-0 w-4">#{i + 1}</span>
                      <span className="text-xs text-gray-400 truncate flex-1 font-mono">
                        {Object.values(row).slice(0, 3).map(v => formatValue(v)).join("  ·  ")}
                      </span>
                      <span className="text-gray-600 text-xs flex-shrink-0">{expandedRow === i ? "▲" : "▼"}</span>
                    </button>
                    {expandedRow === i && (
                      <div className="px-4 pb-3 space-y-1 bg-[#0d0f1a]">
                        {Object.entries(row).map(([k, v]) => (
                          <div key={k} className="flex gap-3 text-xs">
                            <span className="font-mono text-[#C8A96E] flex-shrink-0 w-48 truncate" title={k}>{k}</span>
                            <span className="text-gray-300 break-all">{formatValue(v)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
