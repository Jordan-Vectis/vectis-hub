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

import { useState } from "react"
import { CARD, INPUT, BTN_PRIMARY, HINT, formatSaleDate } from "./ui"

type Row = {
  key: string; barcode: string; uniqueId: string; title: string
  inHub: boolean; hubCataloguedBy: string; hubSaleCode: string; hubSaleName: string; hubSaleDate: string
  inBC: boolean; bcCataloguedBy: string; bcCatalogued: boolean
  bcSaleCode: string; bcSaleName: string; bcSaleDate: string; bcLotNo: string; bcLocation: string
}
type ToteInfo = { toteNo: string; location: string; receiptNo: string; vendorName: string; catalogued: boolean }
type Result = {
  type: string; q: string
  rows: Row[]; totes: ToteInfo[]
  capped: { hub: boolean; bc: boolean }
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
    const code = r.hubSaleCode || r.bcSaleCode
    const name = r.hubSaleCode ? r.hubSaleName : r.bcSaleName
    const date = r.hubSaleCode ? r.hubSaleDate : r.bcSaleDate
    const key  = `${code}||${name}`
    if (!m.has(key)) m.set(key, { code, name, date, rows: [] })
    const g = m.get(key)!
    if (!g.date && date) g.date = date   // BC leaves the date off some rows of the same sale
    g.rows.push(r)
  }
  for (const g of m.values()) {
    g.rows.sort((a, b) =>
      (a.barcode || a.uniqueId).localeCompare(b.barcode || b.uniqueId, "en-GB", { numeric: true }))
  }
  return [...m.values()].sort((a, b) => (a.code || "~~~").localeCompare(b.code || "~~~"))
}

export default function FindLotsTab() {
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
      const res  = await fetch(`/api/lot-lookup?type=${mode}&q=${encodeURIComponent(q)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.statusText)
      setData(json)
    } catch (e: any) { setError(e.message); setData(null) }
    finally { setLoading(false) }
  }

  const active = MODES.find(m => m.key === mode)!
  const rows   = data?.rows ?? []
  const groups = groupByAuction(rows)
  const both   = rows.filter(r => r.inHub && r.inBC).length
  const hubOnly = rows.filter(r => r.inHub && !r.inBC).length
  const bcOnly  = rows.filter(r => !r.inHub && r.inBC).length

  return (
    <div className="space-y-6">
      {/* ── Search ── */}
      <div className={`${CARD} p-6`}>
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
          <button onClick={search} disabled={loading || !value.trim()} className={`${BTN_PRIMARY} whitespace-nowrap`}>
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
        {error && (
          <p className="mt-4 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-base text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </div>

      {data && (
        <>
          {/* ── What you are looking at ── */}
          <div className="rounded-2xl border-2 border-indigo-200 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/10 px-6 py-5">
            <h2 className="text-lg font-bold text-indigo-900 dark:text-indigo-200">How a lot gets here</h2>
            <div className="flex flex-wrap items-center gap-3 mt-3 text-base text-indigo-900 dark:text-indigo-100">
              <span className="px-4 py-2 rounded-xl bg-white dark:bg-indigo-500/20 font-semibold">1 · A cataloguer enters the lot in the Hub</span>
              <span className="text-2xl text-indigo-400">→</span>
              <span className="px-4 py-2 rounded-xl bg-white dark:bg-indigo-500/20 font-semibold">2 · The lot is pushed across to Business Central</span>
            </div>
            <p className="text-base text-indigo-800 dark:text-indigo-200/90 mt-3">
              Each row below is <strong>one item</strong>, showing where it has got to. They are matched by the
              barcode on the label, which is why the two systems&apos; numbers differ
              (<span className="font-mono">F090447</span> in the Hub, <span className="font-mono">R008414-7</span> in BC).
            </p>
          </div>

          {/* ── Where everything has got to ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Stat value={both}    label="In both — fully through" tone="text-emerald-600 dark:text-emerald-400" />
            <Stat value={hubOnly} label="Catalogued in the Hub, not yet in BC" tone="text-amber-600 dark:text-amber-400" />
            <Stat value={bcOnly}  label="In BC, never catalogued in the Hub" tone="text-orange-600 dark:text-orange-400" />
          </div>

          <p className="text-base text-gray-600 dark:text-gray-400">
            Showing results for {active.label.toLowerCase()}{" "}
            <span className="font-mono font-semibold text-gray-900 dark:text-white">{data.q}</span>
            {" · "}{rows.length.toLocaleString()} item{rows.length === 1 ? "" : "s"}
            {" · "}<span className={HINT}>Business Central as of the last warehouse sync</span>
          </p>

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
                Neither the Hub nor Business Central has anything against that {active.label.toLowerCase()}.
              </p>
            </div>
          )}

          {/* ── One block per auction ── */}
          {groups.map(g => {
            const when      = formatSaleDate(g.date)
            const gBoth     = g.rows.filter(r => r.inHub && r.inBC).length
            const gHubOnly  = g.rows.filter(r => r.inHub && !r.inBC).length
            const gBcOnly   = g.rows.filter(r => !r.inHub && r.inBC).length
            return (
              <div key={`${g.code}||${g.name}`} className="rounded-2xl border-2 border-gray-200 dark:border-gray-800 overflow-hidden bg-white dark:bg-[#1C1C1E]">
                {/* Auction header band */}
                <div className="bg-gray-50 dark:bg-gray-900/70 px-6 py-5 border-b-2 border-gray-200 dark:border-gray-800">
                  <p className="text-xs font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">Auction</p>
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mt-1">
                    {g.code
                      ? <>
                          <span className="text-3xl font-bold font-mono text-gray-900 dark:text-white">{g.code}</span>
                          {g.name && <span className="text-xl text-gray-700 dark:text-gray-300">{g.name}</span>}
                        </>
                      : <span className="text-2xl font-bold text-gray-500 dark:text-gray-400">Not in an auction yet</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-3 text-base">
                    <span className="text-gray-800 dark:text-gray-200 font-semibold">
                      📅 {when || "No auction date set"}
                    </span>
                    <span className="text-gray-600 dark:text-gray-400">{g.rows.length} item{g.rows.length === 1 ? "" : "s"}</span>
                    {gBoth    > 0 && <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{gBoth} in both</span>}
                    {gHubOnly > 0 && <span className="text-amber-600 dark:text-amber-400 font-semibold">{gHubOnly} not in BC yet</span>}
                    {gBcOnly  > 0 && <span className="text-orange-600 dark:text-orange-400 font-semibold">{gBcOnly} BC only</span>}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-base">
                    <thead className="bg-gray-50/60 dark:bg-gray-900/40 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      <tr>
                        <th className="text-left px-6 py-3 font-semibold">Item</th>
                        <th className="text-left px-6 py-3 font-semibold">Catalogued by</th>
                        <th className="text-left px-6 py-3 font-semibold">1 · In the Hub</th>
                        <th className="text-left px-6 py-3 font-semibold">2 · In Business Central</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                      {g.rows.map(r => (
                        <tr key={r.key} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 align-top">
                          <td className="px-6 py-4">
                            <p className="font-mono font-semibold text-gray-900 dark:text-white">{r.barcode || r.uniqueId || "—"}</p>
                            {r.barcode && r.uniqueId && (
                              <p className="font-mono text-sm text-gray-500 dark:text-gray-500">{r.uniqueId}</p>
                            )}
                            <p className="text-gray-700 dark:text-gray-300 max-w-lg mt-0.5">{r.title || "No description"}</p>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {r.hubCataloguedBy
                              ? <span className="font-medium text-gray-900 dark:text-white">{r.hubCataloguedBy}</span>
                              : r.bcCataloguedBy
                                ? <>
                                    <span className="font-medium text-gray-900 dark:text-white">{r.bcCataloguedBy}</span>
                                    <span className="block text-sm text-gray-500">recorded in BC</span>
                                  </>
                                : <span className="text-gray-400 dark:text-gray-600">Not recorded</span>}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {r.inHub
                              ? <span className="text-emerald-600 dark:text-emerald-400 font-semibold">✓ Catalogued</span>
                              : <span className="text-orange-600 dark:text-orange-400 font-semibold">✗ Never catalogued here</span>}
                          </td>
                          <td className="px-6 py-4">
                            {r.inBC ? (
                              <>
                                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">✓ In BC</span>
                                {/* Spelled out — a bare "166 · 5F3" means nothing to an admin. */}
                                <span className="block text-sm text-gray-600 dark:text-gray-400 mt-1">
                                  <span className="text-gray-500 dark:text-gray-500">Lot number:</span>{" "}
                                  {r.bcLotNo && r.bcLotNo !== "0"
                                    ? <span className="font-mono font-semibold text-gray-800 dark:text-gray-200">{r.bcLotNo}</span>
                                    : "not numbered yet"}
                                </span>
                                <span className="block text-sm text-gray-600 dark:text-gray-400">
                                  <span className="text-gray-500 dark:text-gray-500">Location:</span>{" "}
                                  {r.bcLocation
                                    ? <span className="font-mono font-semibold text-gray-800 dark:text-gray-200">{r.bcLocation}</span>
                                    : "not recorded"}
                                </span>
                                {r.bcSaleCode && g.code && r.bcSaleCode !== g.code && (
                                  <span className="block text-sm text-amber-600 dark:text-amber-400 font-semibold mt-0.5">
                                    ⚠ BC has it in {r.bcSaleCode}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-amber-600 dark:text-amber-400 font-semibold">Not pushed across yet</span>
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

function Stat({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className={`${CARD} px-6 py-5`}>
      <p className={`text-4xl font-bold ${tone}`}>{value.toLocaleString()}</p>
      <p className="text-base text-gray-600 dark:text-gray-400 mt-1">{label}</p>
    </div>
  )
}
