"use client"

// Admin Centre → "Find a customer's lots"
//
// Search by receipt, tote or customer number. ONE row per physical item with
// both systems on it, because a lot is catalogued in the Hub FIRST and pushed
// to Business Central afterwards — two separate panels made that journey
// impossible to follow (the same item appears on each side under a different
// number: F090447 in the Hub, R008414-7 in BC).
//
// ⚠ "In Business Central" is matched on the BARCODE against the synced BC data.
// It is deliberately NOT CatalogueLot.addedToBC — that is a manual tick the
// cataloguers rarely make, so it read "no" for lots plainly sitting in BC.

import { useEffect, useState } from "react"
import { CARD, INPUT, BTN_PRIMARY, HINT, formatSaleDate } from "./ui"

type Row = {
  key: string; barcode: string; uniqueId: string; title: string
  // ⚠ ONE sale per lot, already worked out server-side — ours if we catalogued it, else the sale
  // its barcode names, else BC's if that isn't a holding pen. The admin never sees which system
  // it came from, which is the whole point of this screen.
  saleCode: string; saleName: string; saleDate: string
  tote: string; catalogued: boolean; cataloguedBy: string; lotNo: string; location: string
  needsAttention: boolean
}
type ToteInfo = {
  toteNo: string; location: string; receiptNo: string; vendorName: string; catalogued: boolean
  createdAt: string; category: string; subCategory: string
}
type Result = {
  type: string; q: string
  rows: Row[]; totes: ToteInfo[]
  capped: { hub: boolean; bc: boolean }
  /** BC rows left out because our own system has that barcode on a different receipt. */
  phantoms?: number
}

type Mode = "receipt" | "tote" | "vendor"
const MODES: { key: Mode; label: string; blurb: string; placeholder: string }[] = [
  { key: "receipt", label: "Receipt number",  blurb: "Everything booked in on one receipt", placeholder: "R000009" },
  { key: "tote",    label: "Tote number",     blurb: "Everything on that tote's receipt",   placeholder: "T001868" },
  { key: "vendor",  label: "Customer number", blurb: "Everything for one customer",         placeholder: "C224652" },
]

// Group by the auction. The Hub's auction wins — that is where the lot was
// catalogued; if BC has it under a different sale the row says so.
function groupByAuction(rows: Row[]) {
  const m = new Map<string, { code: string; name: string; date: string; rows: Row[] }>()
  for (const r of rows) {
    const key = `${r.saleCode}||${r.saleName}`
    if (!m.has(key)) m.set(key, { code: r.saleCode, name: r.saleName, date: r.saleDate, rows: [] })
    const g = m.get(key)!
    if (!g.date && r.saleDate) g.date = r.saleDate   // BC leaves the date off some rows of a sale
    g.rows.push(r)
  }
  for (const g of m.values()) {
    g.rows.sort((a, b) =>
      (a.lotNo || "").localeCompare(b.lotNo || "", "en-GB", { numeric: true }) ||
      (a.barcode || a.uniqueId).localeCompare(b.barcode || b.uniqueId, "en-GB", { numeric: true }))
  }
  // Sales with a date first, soonest first — that is what the customer is ringing about.
  // Anything not allocated to a sale sinks to the bottom.
  return [...m.values()].sort((a, b) => {
    if (!a.code) return 1
    if (!b.code) return -1
    if (a.date && b.date) return a.date.localeCompare(b.date)
    if (a.date) return -1
    if (b.date) return 1
    return a.code.localeCompare(b.code)
  })
}

// `controlled` is set by the Admin Centre page, which owns the one search bar for the whole
// screen. When present this tab hides its own search card and simply runs what it is given —
// `nonce` bumps on every Search press so pressing it twice re-runs the same query.
export type FindControlled = { mode: Mode; value: string; nonce: number }

export default function FindLotsTab({ controlled }: { controlled?: FindControlled } = {}) {
  const [mode, setMode]       = useState<Mode>(controlled?.mode ?? "receipt")
  const [value, setValue]     = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [data, setData]       = useState<Result | null>(null)
  // Which sale groups are open. ⚠ Collapsed by DEFAULT (Jordan, 2026-08-18: "Just show all the
  // sales they have lots in and how many then make the list expandable to see all the details of
  // the individual lots?") — a customer's lots can span a dozen sales and hundreds of rows, and
  // the question is usually "which sales is their stuff in?" before it is ever "show me every lot".
  // A search that lands on ONE sale opens it, because collapsing a single answer is just a click
  // in the way. The key is the same one used for the group's React key.
  const [open, setOpen] = useState<Record<string, boolean>>({})

  // ⚠ Takes the query as ARGUMENTS rather than reading state — a controlled run happens in the
  // same tick as the props arriving, and state would still hold the previous search.
  async function search(q0?: string, m0?: Mode) {
    const q = (q0 ?? value).trim()
    const m = m0 ?? mode
    if (!q || loading) return
    setLoading(true); setError(null)
    try {
      const res  = await fetch(`/api/lot-lookup?type=${m}&q=${encodeURIComponent(q)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.statusText)
      setData(json)
      setOpen({})   // a new search starts collapsed again
    } catch (e: any) { setError(e.message); setData(null) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    if (!controlled?.value.trim()) { setData(null); return }
    setMode(controlled.mode)
    setValue(controlled.value)
    void search(controlled.value, controlled.mode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlled?.nonce])

  const active = MODES.find(m => m.key === mode)!
  const rows   = data?.rows ?? []
  const groups = groupByAuction(rows)
  const totes  = data?.totes ?? []
  const totesDone = totes.filter(t => t.catalogued).length

  return (
    <div className="space-y-6">
      {/* ── Search (hidden when the page owns the search bar) ── */}
      {!controlled && <div className={`${CARD} p-6`}>
        <p className="text-lg font-semibold text-gray-900 dark:text-white mb-4">What are you searching by?</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          {MODES.map(m => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={`text-left px-5 py-4 rounded-xl border-2 transition ${
                mode === m.key
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10"
                  : "border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700"
              }`}
            >
              <span className={`block text-lg font-semibold ${mode === m.key ? "text-indigo-700 dark:text-indigo-300" : "text-gray-900 dark:text-white"}`}>
                {m.label}
              </span>
              <span className="block text-sm text-gray-500 dark:text-gray-400 mt-0.5">{m.blurb}</span>
            </button>
          ))}
        </div>

        <label htmlFor="find-input" className="block text-lg font-semibold text-gray-900 dark:text-white mb-1">
          {active.label}
        </label>
        <p className={`${HINT} mb-4`}>
          For example <span className="font-mono">{active.placeholder}</span>
          {mode === "vendor" && <> — or type part of a customer&apos;s name to search Business Central</>}
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            id="find-input"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") search() }}
            onFocus={e => e.currentTarget.select()}
            placeholder={active.placeholder}
            autoFocus
            autoComplete="off"
            className={INPUT}
          />
          <button onClick={() => search()} disabled={loading || !value.trim()} className={`${BTN_PRIMARY} whitespace-nowrap`}>
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
        {error && (
          <p className="mt-4 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-base text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </div>}

      {controlled && loading && <p className="text-lg text-gray-500 dark:text-gray-400">Searching…</p>}
      {controlled && error && (
        <p className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-base text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      {data && (
        <>
          {/* ── Their totes ──────────────────────────────────────────────────
              Straight from BC's own tote screen. Shown first because it is what the
              customer physically sent in, before any of it became lots. */}
          <div className="rounded-2xl border-2 border-gray-200 dark:border-gray-800 overflow-hidden bg-white dark:bg-[#1C1C1E]">
            <div className="bg-gray-50 dark:bg-gray-900/70 px-6 py-4 border-b-2 border-gray-200 dark:border-gray-800 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">📦 Totes</h2>
              <span className="text-base text-gray-600 dark:text-gray-400">
                {totes.length === 0
                  ? "none found"
                  : <>{totes.length} tote{totes.length === 1 ? "" : "s"}
                      {totesDone > 0 && <> · <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{totesDone} catalogued</span></>}
                      {totes.length - totesDone > 0 && <> · <span className="text-amber-600 dark:text-amber-400 font-semibold">{totes.length - totesDone} still to do</span></>}
                    </>}
              </span>
            </div>
            {totes.length === 0 ? (
              <p className="px-6 py-6 text-base text-gray-500 dark:text-gray-400">
                No totes found for this search.
              </p>
            ) : (
              // ⚠ Scrolls inside itself past ~10 rows. A busy customer has hundreds of totes
              // (measured: 341 on C002603), and an unbounded table would push the auctions —
              // the other half of the answer — clean off the screen.
              <div className="overflow-x-auto max-h-[26rem] overflow-y-auto">
                <table className="w-full text-base">
                  <thead className="sticky top-0 z-10 bg-gray-100 dark:bg-gray-900 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    <tr>
                      <th className="text-left px-6 py-3 font-semibold">Tote</th>
                      <th className="text-left px-6 py-3 font-semibold">Created</th>
                      <th className="text-left px-6 py-3 font-semibold">Category</th>
                      <th className="text-left px-6 py-3 font-semibold">Sub-category</th>
                      <th className="text-left px-6 py-3 font-semibold">Catalogued</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                    {totes.map(t => (
                      <tr key={t.toteNo} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                        <td className="px-6 py-4 font-mono font-semibold text-gray-900 dark:text-white">{t.toteNo}</td>
                        <td className="px-6 py-4 text-gray-700 dark:text-gray-300">{formatSaleDate(t.createdAt) || "—"}</td>
                        <td className="px-6 py-4 text-gray-700 dark:text-gray-300">{t.category || "—"}</td>
                        <td className="px-6 py-4 text-gray-700 dark:text-gray-300">{t.subCategory || "—"}</td>
                        <td className="px-6 py-4">
                          {t.catalogued
                            ? <span className="text-emerald-600 dark:text-emerald-400 font-semibold">✓ Catalogued</span>
                            : <span className="text-amber-600 dark:text-amber-400 font-semibold">Not yet</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-base text-gray-600 dark:text-gray-400">
              Showing results for {active.label.toLowerCase()}{" "}
              <span className="font-mono font-semibold text-gray-900 dark:text-white">{data.q}</span>
              {" · "}<span className="font-semibold text-gray-900 dark:text-white">{groups.length} sale{groups.length === 1 ? "" : "s"}</span>
              {" · "}{rows.length.toLocaleString()} item{rows.length === 1 ? "" : "s"}
              {" · "}<span className={HINT}>as of the last warehouse sync</span>
            </p>
            {groups.length > 1 && (
              <button
                onClick={() => {
                  const anyOpen = groups.some(g => open[`${g.code}||${g.name}`])
                  setOpen(anyOpen ? {} : Object.fromEntries(groups.map(g => [`${g.code}||${g.name}`, true])))
                }}
                className="px-5 py-3 rounded-xl border-2 border-gray-300 dark:border-gray-700 text-base font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
              >
                {groups.some(g => open[`${g.code}||${g.name}`]) ? "Collapse them all" : "Open them all"}
              </button>
            )}
          </div>

          {/* ⚠ Never silently swallow the ones dropped — design rule 7. */}
          {!!data.phantoms && data.phantoms > 0 && (
            <p className="px-5 py-4 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 text-base text-gray-600 dark:text-gray-400">
              {data.phantoms} Business Central {data.phantoms === 1 ? "record was" : "records were"} left out — {data.phantoms === 1 ? "its barcode belongs" : "their barcodes belong"} to a lot we have on a different receipt, so {data.phantoms === 1 ? "it isn&apos;t" : "they aren&apos;t"} part of this one.
            </p>
          )}

          {(data.capped.hub || data.capped.bc) && (
            <p className="px-5 py-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-base text-amber-800 dark:text-amber-300">
              Showing the first 500 — narrow your search to see the rest.
            </p>
          )}

          {/* Tote scope caveat — neither system tags a lot with its tote reliably. */}
          {data.type === "tote" && (
            <p className="px-5 py-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-base text-amber-800 dark:text-amber-300">
              Lots aren&apos;t individually tagged with a tote, so these are all the lots on that tote&apos;s <strong>receipt</strong> —
              they may include other totes booked in on the same receipt.
            </p>
          )}

          {/* Tote context */}
          {data.type === "tote" && data.totes.length > 0 && (
            <div className={`${CARD} p-6`}>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">📦 The tote</h3>
              <div className="space-y-3">
                {data.totes.map(t => (
                  <div key={t.toteNo} className="flex flex-wrap gap-x-8 gap-y-2 text-base text-gray-800 dark:text-gray-200">
                    <span className="font-mono text-lg font-bold">{t.toteNo}</span>
                    {t.location && <span>Location <span className="font-mono font-semibold">{t.location}</span></span>}
                    {t.receiptNo && <span>Receipt <span className="font-mono font-semibold">{t.receiptNo}</span></span>}
                    {t.vendorName && <span>{t.vendorName}</span>}
                    {t.catalogued && <span className="text-emerald-600 dark:text-emerald-400 font-semibold">✓ Catalogued</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {rows.length === 0 && (
            <div className={`${CARD} p-10 text-center`}>
              <div className="text-6xl mb-4">🤷</div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Nothing found for “{data.q}”</h2>
              <p className="text-base text-gray-600 dark:text-gray-400">
                Nothing found at all for that {active.label.toLowerCase()}.
              </p>
            </div>
          )}

          {/* ── One block per auction ──────────────────────────────────────
              ⚠ The sale on each row is already resolved server-side. Nothing here says which
              system a lot came from: an admin with a customer on the phone needs the auction,
              the date and who catalogued it, not our plumbing. */}
          {groups.map(g => {
            const when     = formatSaleDate(g.date)
            const problems = g.rows.filter(r => r.needsAttention).length
            const key      = `${g.code}||${g.name}`
            // One sale in the whole result opens itself — see the note on `open`.
            const isOpen   = open[key] ?? groups.length === 1
            return (
              <div key={key} className={`rounded-2xl border-2 overflow-hidden bg-white dark:bg-[#1C1C1E] ${
                problems > 0 ? "border-amber-300 dark:border-amber-500/50" : "border-gray-200 dark:border-gray-800"
              }`}>
                {/* Auction header band — the whole thing is the expand/collapse control */}
                <button
                  onClick={() => setOpen(o => ({ ...o, [key]: !isOpen }))}
                  aria-expanded={isOpen}
                  className={`w-full text-left bg-gray-50 dark:bg-gray-900/70 px-6 py-5 hover:bg-gray-100 dark:hover:bg-gray-900 transition ${
                    isOpen ? "border-b-2 border-gray-200 dark:border-gray-800" : ""
                  }`}
                >
                  <p className="text-xs font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">Auction</p>
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mt-1">
                    <span className={`text-2xl leading-none text-gray-400 dark:text-gray-500 transition-transform ${isOpen ? "rotate-90 inline-block" : "inline-block"}`}>›</span>
                    {g.code
                      ? <>
                          <span className="text-3xl font-bold font-mono text-gray-900 dark:text-white">{g.code}</span>
                          {g.name && <span className="text-xl text-gray-700 dark:text-gray-300">{g.name}</span>}
                        </>
                      : <span className="text-2xl font-bold text-gray-500 dark:text-gray-400">Not in a sale yet</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-3 text-base">
                    <span className="text-gray-800 dark:text-gray-200 font-semibold">
                      📅 {when || (g.code ? "No date set yet" : "Waiting to be put in a sale")}
                    </span>
                    <span className="text-gray-900 dark:text-white font-bold">{g.rows.length} lot{g.rows.length === 1 ? "" : "s"}</span>
                    {problems > 0 && (
                      <span className="text-amber-600 dark:text-amber-400 font-semibold">
                        ⚠ {problems} need{problems === 1 ? "s" : ""} looking at
                      </span>
                    )}
                    <span className="ml-auto text-indigo-600 dark:text-indigo-400 font-semibold">
                      {isOpen ? "Hide the lots" : `Show the ${g.rows.length} lot${g.rows.length === 1 ? "" : "s"}`}
                    </span>
                  </div>
                </button>

                <div className={`overflow-x-auto ${isOpen ? "" : "hidden"}`}>
                  <table className="w-full text-base">
                    <thead className="bg-gray-50/60 dark:bg-gray-900/40 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      <tr>
                        <th className="text-left px-6 py-3 font-semibold">Lot</th>
                        <th className="text-left px-6 py-3 font-semibold">Item</th>
                        <th className="text-left px-6 py-3 font-semibold">Tote</th>
                        <th className="text-left px-6 py-3 font-semibold">Catalogued by</th>
                        <th className="text-left px-6 py-3 font-semibold">Where it is up to</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                      {g.rows.map(r => (
                        <tr key={r.key} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 align-top">
                          {/* The lot number is what a customer actually asks for. */}
                          <td className="px-6 py-4 whitespace-nowrap">
                            {r.lotNo && r.lotNo !== "0"
                              ? <span className="text-2xl font-bold font-mono text-gray-900 dark:text-white">{r.lotNo}</span>
                              : <span className="text-gray-400 dark:text-gray-600">Not numbered yet</span>}
                          </td>
                          <td className="px-6 py-4">
                            <p className="font-mono font-semibold text-gray-900 dark:text-white">{r.barcode || r.uniqueId || "—"}</p>
                            <p className="text-gray-700 dark:text-gray-300 max-w-lg mt-0.5">{r.title || "No description yet"}</p>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {r.tote
                              ? <span className="font-mono font-semibold text-cyan-700 dark:text-cyan-300">{r.tote}</span>
                              : <span className="text-gray-400 dark:text-gray-600">Not recorded</span>}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {r.cataloguedBy
                              ? <span className="font-medium text-gray-900 dark:text-white">{r.cataloguedBy}</span>
                              : <span className="text-gray-400 dark:text-gray-600">Not recorded</span>}
                          </td>
                          <td className="px-6 py-4">
                            {r.needsAttention
                              ? <span className="text-amber-600 dark:text-amber-400 font-semibold">⚠ Needs looking at</span>
                              : r.catalogued
                                ? <span className="text-emerald-600 dark:text-emerald-400 font-semibold">✓ Catalogued</span>
                                : <span className="text-amber-600 dark:text-amber-400 font-semibold">Waiting to be catalogued</span>}
                            {r.location && (
                              <span className="block text-sm text-gray-600 dark:text-gray-400 mt-1">
                                <span className="text-gray-500 dark:text-gray-500">Where:</span>{" "}
                                <span className="font-mono font-semibold text-gray-800 dark:text-gray-200">{r.location}</span>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
