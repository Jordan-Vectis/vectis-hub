"use client"

import { useState } from "react"

type Entry = { name: string; email: string; saleCodes: string[] }

const QUICK_KEYWORDS = [
  "Star Wars", "Matchbox", "Diecast", "Comics", "Vinyl", "Trains",
  "Dolls", "Bears", "TV Film", "Military",
]

const DATE_PRESETS = [
  { label: "Last 6 months",  months: 6 },
  { label: "Last 12 months", months: 12 },
  { label: "Last 2 years",   months: 24 },
  { label: "Last 3 years",   months: 36 },
  { label: "All time",       months: 0 },
]

function monthsAgoISO(months: number): string {
  if (!months) return ""
  const d = new Date()
  d.setMonth(d.getMonth() - months)
  return d.toISOString().slice(0, 10)
}

export default function EmailListsTab() {
  const [keywords,    setKeywords]    = useState<string[]>([])
  const [inputVal,    setInputVal]    = useState("")
  const [dateFrom,    setDateFrom]    = useState("")
  const [datePreset,  setDatePreset]  = useState(0)
  const [loading,     setLoading]     = useState(false)
  const [entries,     setEntries]     = useState<Entry[] | null>(null)
  const [rawCount,    setRawCount]    = useState<number>(0)
  const [bcTotal,     setBcTotal]     = useState<number>(0)
  const [errors,      setErrors]      = useState<string[]>([])
  const [error,       setError]       = useState<string | null>(null)
  const [copied,      setCopied]      = useState(false)
  const [search,      setSearch]      = useState("")

  function addKeyword(kw: string) {
    const trimmed = kw.trim()
    if (!trimmed || keywords.includes(trimmed)) return
    setKeywords(prev => [...prev, trimmed])
    setInputVal("")
  }

  function removeKeyword(kw: string) {
    setKeywords(prev => prev.filter(k => k !== kw))
  }

  function applyPreset(months: number) {
    setDatePreset(months)
    setDateFrom(monthsAgoISO(months))
  }

  async function fetchList() {
    if (!keywords.length) { setError("Add at least one auction keyword first"); return }
    setLoading(true); setError(null); setEntries(null); setErrors([])
    try {
      const params = new URLSearchParams({ keywords: keywords.join(",") })
      if (dateFrom) params.set("dateFrom", dateFrom)
      const res  = await fetch(`/api/bc/email-lists?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setEntries(data.entries)
      setRawCount(data.rawCount ?? 0)
      setBcTotal(data.bcTotal ?? 0)
      setErrors(data.errors ?? [])
    } catch (e: any) {
      setError(e.message ?? "Failed to fetch")
    } finally {
      setLoading(false)
    }
  }

  const filtered = (entries ?? []).filter(e =>
    !search || e.name.toLowerCase().includes(search.toLowerCase()) || e.email.toLowerCase().includes(search.toLowerCase())
  )

  function copyEmails() {
    navigator.clipboard.writeText(filtered.map(e => e.email).join("\n")).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function exportCSV() {
    const rows = ["Name,Email Address,Sale Codes", ...filtered.map(e =>
      `"${e.name.replace(/"/g, '""')}","${e.email}","${e.saleCodes.join("; ")}"`
    )].join("\n")
    const blob = new Blob([rows], { type: "text/csv" })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement("a")
    a.href     = url
    a.download = `email-list-${keywords.join("-").toLowerCase().replace(/\s+/g, "-")}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">Email Marketing Lists</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Pull buyer emails from BC by auction type. Add one or more keywords that appear in the auction name, choose a date range, and export the deduplicated list.
        </p>
      </div>

      {/* Keywords */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-3">
        <p className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider">Auction Keywords</p>

        {/* Quick picks */}
        <div className="flex flex-wrap gap-2">
          {QUICK_KEYWORDS.map(kw => (
            <button key={kw} onClick={() => addKeyword(kw)}
              disabled={keywords.includes(kw)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                keywords.includes(kw)
                  ? "bg-pink-600/20 border-pink-500 text-pink-400 cursor-default"
                  : "bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-pink-500 hover:text-pink-400"
              }`}>
              {kw}
            </button>
          ))}
        </div>

        {/* Custom input */}
        <div className="flex gap-2">
          <input
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") addKeyword(inputVal) }}
            placeholder="Custom keyword (press Enter to add)…"
            className="flex-1 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-pink-500"
          />
          <button onClick={() => addKeyword(inputVal)} disabled={!inputVal.trim()}
            className="px-4 py-2 bg-pink-600 hover:bg-pink-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors">
            Add
          </button>
        </div>

        {/* Active keywords */}
        {keywords.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {keywords.map(kw => (
              <span key={kw} className="flex items-center gap-1.5 text-xs bg-pink-600/20 border border-pink-500 text-pink-400 px-3 py-1.5 rounded-full">
                {kw}
                <button onClick={() => removeKeyword(kw)} className="hover:text-white transition-colors leading-none">✕</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Date range */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-3">
        <p className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider">Date Range</p>
        <div className="flex flex-wrap gap-2">
          {DATE_PRESETS.map(p => (
            <button key={p.months} onClick={() => applyPreset(p.months)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                datePreset === p.months
                  ? "bg-pink-600/20 border-pink-500 text-pink-400"
                  : "bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-pink-500 hover:text-pink-400"
              }`}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-600 dark:text-gray-500">From:</span>
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setDatePreset(-1) }}
            className="bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-pink-500" />
          {!dateFrom && <span className="text-xs text-gray-600 dark:text-gray-500 italic">All time (no date filter)</span>}
        </div>
      </div>

      {/* Fetch button */}
      <button onClick={fetchList} disabled={loading || !keywords.length}
        className="px-6 py-3 bg-pink-600 hover:bg-pink-500 disabled:opacity-40 text-white font-semibold rounded-xl transition-colors text-sm">
        {loading ? "Fetching from BC…" : `Pull Email List${keywords.length ? ` for "${keywords.join('", "')}"` : ""}`}
      </button>

      {/* Error */}
      {error && (
        <div className="bg-red-950 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300">✕ {error}</div>
      )}
      {errors.length > 0 && (
        <div className="bg-amber-950/40 border border-amber-700/40 rounded-lg px-4 py-3 text-sm text-amber-300">
          ⚠ Some keyword requests failed: {errors.join("; ")}
        </div>
      )}

      {/* Results */}
      {entries !== null && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <span className="font-semibold text-gray-900 dark:text-white">{entries.length}</span>
              <span className="text-gray-600 dark:text-gray-400 text-sm ml-1">unique buyers</span>
              <span className="text-gray-600 dark:text-gray-500 text-xs ml-2">({rawCount} fetched · BC reports {bcTotal} total)</span>
              {search && filtered.length !== entries.length && (
                <span className="text-gray-600 dark:text-gray-500 text-sm ml-2">· {filtered.length} shown</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter results…"
                className="bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-pink-500 w-44" />
              <button onClick={copyEmails}
                className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-pink-500 hover:text-pink-400 transition-colors">
                {copied ? "✓ Copied!" : "Copy Emails"}
              </button>
              <button onClick={exportCSV}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-pink-600 hover:bg-pink-500 text-white transition-colors">
                Export CSV
              </button>
            </div>
          </div>

          {filtered.length === 0 ? (
            <p className="text-gray-600 dark:text-gray-500 text-sm">No results found.</p>
          ) : (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
              <div className="grid grid-cols-3 px-4 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <span className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider">Buyer Name</span>
                <span className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider">Email Address</span>
                <span className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider">Sale Codes</span>
              </div>
              <div className="overflow-y-auto max-h-[500px] divide-y divide-gray-100 dark:divide-gray-800">
                {filtered.map((e, i) => (
                  <div key={i} className="grid grid-cols-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <span className="text-sm text-gray-800 dark:text-gray-200 truncate pr-4">{e.name || "—"}</span>
                    <span className="text-sm text-gray-600 dark:text-gray-400 font-mono truncate pr-4">{e.email}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-500 truncate">{e.saleCodes.join(", ") || "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
