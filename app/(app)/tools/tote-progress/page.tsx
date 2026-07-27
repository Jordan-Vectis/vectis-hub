"use client"

import { useCallback, useEffect, useState } from "react"

// Tote Progress — "where are we up to", per check-in category.
//
// The headline figure per category is the check-in date of the OLDEST tote
// that has NOT been catalogued yet. That is the real progress line: if nothing
// older than 12 Jun is left in TV_FILM, TV_FILM is genuinely up to 12 Jun.
//
// Every date on this screen is a CHECK-IN date (SystemCreatedAt on the tote).
// BC stores EVA_TOT_Catalogued as a bare boolean with no timestamp, so
// "when was it catalogued" is not available from this data source.

type Upcoming = {
  barcode:     string
  description: string
  location:    string
  cataloguer:  string
  created:     string
}

type Category = {
  category:             string
  outstanding:          number
  undated:              number
  oldestDate:           string | null
  oldestAgeDays:        number | null
  newestCataloguedDate: string | null
  cataloguedCount:      number
  upcoming:             Upcoming[]
}

type Meta = {
  totalOutstanding:   number
  totalCatalogued:    number
  categoryCount:      number
  furthestBehindDate: string | null
  furthestBehindCat:  string | null
  furthestBehindDays: number | null
  undatedOutstanding: number
  locationExcluded:   number
  excludeBench:       boolean
  generatedAt:        string
}

type Data = { categories: Category[]; meta: Meta }

// Backlog age bands. Absolute thresholds rather than relative so the colour
// means the same thing every time you open the page.
function ageBand(days: number | null): { label: string; dot: string; text: string; bar: string } {
  if (days == null)  return { label: "No dated totes", dot: "bg-gray-400",   text: "text-gray-500 dark:text-gray-400",   bar: "bg-gray-400" }
  if (days < 14)     return { label: "On top of it",   dot: "bg-green-500",  text: "text-green-600 dark:text-green-400", bar: "bg-green-500" }
  if (days < 30)     return { label: "Keeping up",     dot: "bg-blue-500",   text: "text-blue-600 dark:text-blue-400",   bar: "bg-blue-500" }
  if (days < 60)     return { label: "Slipping",       dot: "bg-amber-500",  text: "text-amber-600 dark:text-amber-400", bar: "bg-amber-500" }
  return               { label: "Well behind",  dot: "bg-red-500",    text: "text-red-600 dark:text-red-400",     bar: "bg-red-500" }
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

function fmtDays(days: number | null): string {
  if (days == null) return "—"
  if (days === 0)   return "today"
  if (days === 1)   return "1 day"
  return `${days} days`
}

// Pretty-print a BC category code: MODERN_DIECAST → Modern Diecast
function prettyCategory(code: string): string {
  return code
    .split("_")
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
}

export default function ToteProgressPage() {
  const [data, setData]       = useState<Data | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [excludeBench, setExcludeBench] = useState(false)
  const [expanded, setExpanded]         = useState<string | null>(null)

  const load = useCallback(async (xb: boolean) => {
    setLoading(true); setError(null)
    try {
      const qs  = xb ? "?excludeBench=1" : ""
      const res = await window.fetch(`/api/bc/tote-progress${qs}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.statusText)
      setData(json)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load(excludeBench) }, [excludeBench, load])

  // Longest backlog on screen — used to scale the relative bars.
  const maxAge = data?.categories.reduce((m, c) => Math.max(m, c.oldestAgeDays ?? 0), 0) || 1

  return (
    <div className="p-6 max-w-[1400px]">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-1">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Tote Progress</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
            Where cataloguing has got up to, by the category each tote was checked in as.
          </p>
        </div>
        <button
          onClick={() => load(excludeBench)}
          disabled={loading}
          className="px-4 py-2 bg-[#0078D4] hover:bg-blue-500 text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
        >
          {loading ? "Loading…" : "↺ Refresh"}
        </button>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-500 mb-4">
        Each date is the <strong>check-in date of the oldest tote still waiting</strong> in that category — nothing older than that
        is left to do.
      </p>

      <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 mb-5 cursor-pointer select-none w-fit">
        <input
          type="checkbox" checked={excludeBench}
          onChange={e => setExcludeBench(e.target.checked)}
          className="w-4 h-4 accent-[#0078D4]"
        />
        Hide bench &amp; blank-location totes
      </label>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-sm">
          {error === "BC_NOT_CONNECTED" ? "Business Central is not connected — reconnect from BC Warehouse." : error}
        </div>
      )}

      {loading && !data && (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-12 text-center">Fetching totes from Business Central…</p>
      )}

      {data && (
        <>
          {/* ── Summary cards ────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
            <div className="bg-white dark:bg-[#0d0f1a] border border-gray-200 dark:border-gray-800 rounded-lg p-4">
              <p className="text-xs text-gray-500 dark:text-gray-500 mb-1">Totes still to catalogue</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{data.meta.totalOutstanding.toLocaleString()}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-0.5">
                across {data.meta.categoryCount} categor{data.meta.categoryCount === 1 ? "y" : "ies"}
              </p>
            </div>
            <div className="bg-white dark:bg-[#0d0f1a] border border-gray-200 dark:border-gray-800 rounded-lg p-4">
              <p className="text-xs text-gray-500 dark:text-gray-500 mb-1">Furthest behind</p>
              <p className={`text-2xl font-bold ${ageBand(data.meta.furthestBehindDays).text}`}>
                {fmtDate(data.meta.furthestBehindDate)}
              </p>
              <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-0.5">
                {data.meta.furthestBehindCat ? `${prettyCategory(data.meta.furthestBehindCat)} · ${fmtDays(data.meta.furthestBehindDays)} old` : "—"}
              </p>
            </div>
            <div className="bg-white dark:bg-[#0d0f1a] border border-gray-200 dark:border-gray-800 rounded-lg p-4">
              <p className="text-xs text-gray-500 dark:text-gray-500 mb-1">Already catalogued</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{data.meta.totalCatalogued.toLocaleString()}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-0.5">totes, all time</p>
            </div>
          </div>

          {/* ── Caveats ──────────────────────────────────────────── */}
          {(data.meta.locationExcluded > 0 || data.meta.undatedOutstanding > 0) && (
            <div className="mb-3 space-y-1">
              {data.meta.locationExcluded > 0 && (
                <p className="text-[11px] text-gray-500 dark:text-gray-500">
                  {data.meta.locationExcluded.toLocaleString()} tote{data.meta.locationExcluded === 1 ? "" : "s"} hidden — blank or bench location.
                </p>
              )}
              {data.meta.undatedOutstanding > 0 && (
                <p className="text-[11px] text-amber-600 dark:text-amber-500">
                  {data.meta.undatedOutstanding.toLocaleString()} outstanding tote{data.meta.undatedOutstanding === 1 ? " has" : "s have"} no
                  check-in date in BC — counted in the totals but not in any date.
                </p>
              )}
            </div>
          )}

          {/* ── The board ────────────────────────────────────────── */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="hidden md:grid grid-cols-[minmax(160px,1.4fr)_130px_110px_1fr_110px] gap-3 px-4 py-2.5 bg-gray-100 dark:bg-[#0d0f1a] text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-500">
              <div>Category</div>
              <div>Up to</div>
              <div>Backlog age</div>
              <div>Relative backlog</div>
              <div className="text-right">Outstanding</div>
            </div>

            <div className="divide-y divide-gray-200 dark:divide-gray-800">
              {data.categories.map(c => {
                const band   = ageBand(c.oldestAgeDays)
                const isOpen = expanded === c.category
                const pct    = Math.max(2, Math.round(((c.oldestAgeDays ?? 0) / maxAge) * 100))

                return (
                  <div key={c.category} className="bg-white dark:bg-transparent">
                    <button
                      onClick={() => setExpanded(isOpen ? null : c.category)}
                      className="w-full text-left grid grid-cols-2 md:grid-cols-[minmax(160px,1.4fr)_130px_110px_1fr_110px] gap-3 px-4 py-3 items-center hover:bg-gray-50 dark:hover:bg-[#0d0f1a] transition-colors"
                    >
                      {/* Category */}
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${band.dot}`} />
                        <span className="font-medium text-gray-900 dark:text-white truncate">{prettyCategory(c.category)}</span>
                        <span className={`text-gray-400 dark:text-gray-600 text-xs shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}>›</span>
                      </div>

                      {/* Up to */}
                      <div className={`font-semibold tabular-nums ${band.text}`}>
                        {fmtDate(c.oldestDate)}
                      </div>

                      {/* Backlog age */}
                      <div className="text-sm text-gray-600 dark:text-gray-400 tabular-nums">
                        {fmtDays(c.oldestAgeDays)}
                      </div>

                      {/* Relative bar */}
                      <div className="hidden md:flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
                          <div className={`h-full rounded-full ${band.bar}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[10px] text-gray-400 dark:text-gray-600 w-20 shrink-0">{band.label}</span>
                      </div>

                      {/* Outstanding */}
                      <div className="text-right">
                        <span className="font-semibold text-gray-900 dark:text-white tabular-nums">{c.outstanding.toLocaleString()}</span>
                        {c.undated > 0 && (
                          <span className="block text-[10px] text-amber-600 dark:text-amber-500">{c.undated} undated</span>
                        )}
                      </div>
                    </button>

                    {/* Drill-down — the queue in the order it should be worked */}
                    {isOpen && (
                      <div className="px-4 pb-4 bg-gray-50 dark:bg-[#0d0f1a]">
                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-gray-500 dark:text-gray-500 mb-3 pt-1">
                          <span>Newest already catalogued was checked in <strong className="text-gray-700 dark:text-gray-300">{fmtDate(c.newestCataloguedDate)}</strong></span>
                          <span>{c.cataloguedCount.toLocaleString()} catalogued in this category</span>
                        </div>

                        {c.upcoming.length === 0 ? (
                          <p className="text-xs text-gray-500 dark:text-gray-500 py-2">No dated totes outstanding.</p>
                        ) : (
                          <>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-500 mb-2">
                              Next up — oldest first
                            </p>
                            <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-800">
                              <table className="w-full text-sm bg-white dark:bg-[#0a0c14]">
                                <thead className="text-[10px] uppercase text-gray-500 dark:text-gray-500 bg-gray-100 dark:bg-[#0d0f1a]">
                                  <tr>
                                    <th className="px-3 py-1.5 text-left font-semibold">Tote</th>
                                    <th className="px-3 py-1.5 text-left font-semibold">Checked in</th>
                                    <th className="px-3 py-1.5 text-left font-semibold">Location</th>
                                    <th className="px-3 py-1.5 text-left font-semibold">Assigned to</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                  {c.upcoming.map((u, i) => (
                                    <tr key={`${u.barcode}-${i}`}>
                                      <td className="px-3 py-1.5 font-mono text-xs text-gray-700 dark:text-gray-300">{u.barcode || "—"}</td>
                                      <td className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">{fmtDate(u.created)}</td>
                                      <td className="px-3 py-1.5 font-mono text-xs text-gray-600 dark:text-gray-400">{u.location || "—"}</td>
                                      <td className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400">{u.cataloguer || "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {data.categories.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400 py-10 text-center">
              Nothing outstanding — every tote is catalogued.
            </p>
          )}

          <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-4">
            Live from Business Central · {new Date(data.meta.generatedAt).toLocaleString("en-GB")}
          </p>
        </>
      )}
    </div>
  )
}
