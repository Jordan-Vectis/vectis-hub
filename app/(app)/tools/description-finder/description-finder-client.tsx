"use client"

import { useState, useRef } from "react"
import type { FinderResult } from "@/app/api/description-finder/route"

export default function DescriptionFinderClient() {
  const [q, setQ]             = useState("")
  const [results, setResults] = useState<FinderResult[] | null>(null)
  const [total, setTotal]     = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [copied, setCopied]   = useState<number | null>(null)
  const reqId                 = useRef(0)

  async function search(term: string) {
    const query = term.trim()
    if (query.length < 2) { setResults(null); setError(query ? "Type at least 2 characters." : null); return }
    const id = ++reqId.current
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/description-finder?q=${encodeURIComponent(query)}`)
      const data = await res.json()
      if (id !== reqId.current) return              // a newer search superseded this one
      if (!res.ok) throw new Error(data.error ?? "Search failed")
      setResults(data.results ?? [])
      setTotal(data.total ?? (data.results?.length ?? 0))
    } catch (e: any) {
      if (id === reqId.current) setError(e?.message ?? "Search failed")
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    search(q)
  }

  async function copy(text: string, i: number) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(i)
      setTimeout(() => setCopied(c => (c === i ? null : c)), 1500)
    } catch { /* clipboard blocked — ignore */ }
  }

  const fmtDate = (iso: string | null) => {
    if (!iso) return null
    const d = new Date(iso)
    return isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Description Finder</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Search every description we&apos;ve written before — type a set number, model code, product name or barcode,
          and reuse how the item was catalogued.
        </p>
      </div>

      {/* Search box */}
      <form onSubmit={onSubmit} className="flex gap-2 mb-2">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          autoFocus
          placeholder="e.g. 75256, CBM216128A, “Millennium Falcon”, F073116…"
          className="flex-1 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E] text-gray-900 dark:text-gray-100 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
        <button
          type="submit"
          disabled={loading || q.trim().length < 2}
          className="bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold px-6 py-3 rounded-xl text-base transition-colors"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-6">
        Matches against past description text — great for items whose code or set number is written in (Lego, Corgi),
        and searchable by name for those that aren&apos;t (e.g. Charlie Bears by the bear&apos;s name).
      </p>

      {error && <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2 mb-4">{error}</p>}

      {/* Results */}
      {results !== null && !loading && (
        <>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
            {total === 0 ? "No past descriptions found." : `${total} match${total === 1 ? "" : "es"}${total > results.length ? ` — showing the ${results.length} most recent` : ""}.`}
          </p>
          <div className="space-y-3">
            {results.map((r, i) => (
              <div key={i} className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {r.code && <span className="font-mono font-semibold text-sky-600 dark:text-sky-400">{r.code}</span>}
                    <span className={`px-2 py-0.5 rounded-full font-medium ${r.source === "app" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"}`}>
                      {r.source === "app" ? "Catalogued (app)" : "BC history"}
                    </span>
                    {r.category && <span className="text-gray-400 dark:text-gray-500">{r.category}</span>}
                    {r.brand && <span className="text-gray-400 dark:text-gray-500">· {r.brand}</span>}
                  </div>
                  <button
                    onClick={() => copy(r.description, i)}
                    className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg border border-sky-500 text-sky-600 dark:text-sky-400 hover:bg-sky-500 hover:text-white transition-colors"
                  >
                    {copied === i ? "✓ Copied" : "Copy description"}
                  </button>
                </div>
                {r.title && <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">{r.title}</p>}
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{r.description}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-gray-400 dark:text-gray-500">
                  {r.auctionCode && <span className="font-mono">{r.auctionCode}{r.auctionName ? ` · ${r.auctionName}` : ""}</span>}
                  {r.vendor && <span>Vendor: {r.vendor}</span>}
                  {fmtDate(r.date) && <span>{fmtDate(r.date)}</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {results === null && !loading && !error && (
        <div className="text-center py-16 text-gray-400 dark:text-gray-600 text-sm">
          Enter a code, name or barcode above to search past descriptions.
        </div>
      )}
    </div>
  )
}
