"use client"

// Admin Centre → "Find a customer's lots"
//
// Search by receipt, tote or customer number and see every lot across BOTH the
// Hub cataloguing tool and Business Central, grouped by sale, with who
// catalogued each one.

import { useState } from "react"
import { CARD, INPUT, BTN_PRIMARY, HINT, STATUS_TONE, formatSaleDate } from "./ui"

type HubLot = {
  id: string; title: string; barcode: string | null; receiptUniqueId: string | null
  receipt: string | null; tote: string | null; vendor: string | null
  status: string; addedToBC: boolean; category: string | null; cataloguedBy: string | null
  saleCode: string; saleName: string; saleDate: string
}
type BcItem = {
  uniqueId: string; description: string; receiptNo: string; vendorNo: string; vendorName: string
  catalogued: boolean; cataloguedBy: string; cataloguedByName: string
  saleCode: string; saleName: string; saleDate: string
  lotNo: string; location: string; toteNo: string; barcode: string
}
type ToteInfo = { toteNo: string; location: string; receiptNo: string; vendorName: string; catalogued: boolean }
type Result = {
  type: string; q: string
  hub: HubLot[]; bc: BcItem[]; totes: ToteInfo[]
  capped: { hub: boolean; bc: boolean }
}

type Mode = "receipt" | "tote" | "vendor"
const MODES: { key: Mode; label: string; blurb: string; placeholder: string }[] = [
  { key: "receipt", label: "Receipt number",  blurb: "Everything booked in on one receipt", placeholder: "R000009" },
  { key: "tote",    label: "Tote number",     blurb: "Everything on that tote's receipt",   placeholder: "T001868" },
  { key: "vendor",  label: "Customer number", blurb: "Everything for one customer",         placeholder: "C224652" },
]

function groupBySale<T extends { saleCode: string; saleName: string; saleDate: string }>(rows: T[]) {
  const m = new Map<string, { code: string; name: string; date: string; rows: T[] }>()
  for (const r of rows) {
    const key = `${r.saleCode}||${r.saleName}`   // keep distinct sales apart even when the code is blank
    if (!m.has(key)) m.set(key, { code: r.saleCode, name: r.saleName, date: r.saleDate, rows: [] })
    const g = m.get(key)!
    if (!g.date && r.saleDate) g.date = r.saleDate   // BC leaves the date off some rows of the same sale
    g.rows.push(r)
  }
  return [...m.values()].sort((a, b) => (a.code || "~").localeCompare(b.code || "~"))
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

  const active       = MODES.find(m => m.key === mode)!
  const hubGroups    = data ? groupBySale(data.hub) : []
  const bcGroups     = data ? groupBySale(data.bc) : []
  const bcCatalogued = data ? data.bc.filter(b => b.catalogued).length : 0

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
          {/* ── Headline numbers ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Stat value={data.hub.length} label="Lots in the Hub" tone="text-indigo-600 dark:text-indigo-400" />
            <Stat value={data.bc.length}  label="Items in Business Central" tone="text-orange-600 dark:text-orange-400" />
            <Stat value={bcCatalogued}    label="Of those, catalogued in BC" tone="text-emerald-600 dark:text-emerald-400" />
          </div>

          <p className="text-base text-gray-600 dark:text-gray-400">
            Showing results for {active.label.toLowerCase()}{" "}
            <span className="font-mono font-semibold text-gray-900 dark:text-white">{data.q}</span>
          </p>

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

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
            {/* ── Hub cataloguing ── */}
            <Panel
              title="🗂 Hub cataloguing"
              blurb="Lots entered by the cataloguers in the Hub."
              capped={data.capped.hub}
              empty={hubGroups.length === 0 ? "No matching lots in the Hub." : null}
            >
              {hubGroups.map(g => (
                <SaleGroup key={`${g.code}||${g.name}`} code={g.code} name={g.name} date={g.date} count={g.rows.length} noun="lot" fallback="No sale assigned">
                  <table className="w-full text-base">
                    <thead className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">
                      <tr>
                        <th className="text-left py-2 pr-4 font-semibold">Lot</th>
                        <th className="text-left py-2 pr-4 font-semibold">Title</th>
                        <th className="text-left py-2 pr-4 font-semibold">Catalogued by</th>
                        <th className="text-left py-2 pr-4 font-semibold">Status</th>
                        <th className="text-left py-2 font-semibold">In BC</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                      {g.rows.map(l => (
                        <tr key={l.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                          <td className="py-3 pr-4 font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">
                            {l.barcode || l.receiptUniqueId || "—"}
                          </td>
                          <td className="py-3 pr-4 text-gray-800 dark:text-gray-200 max-w-[260px] truncate" title={l.title}>{l.title}</td>
                          <td className="py-3 pr-4 whitespace-nowrap">
                            {l.cataloguedBy
                              ? <span className="font-medium text-gray-900 dark:text-white">{l.cataloguedBy}</span>
                              : <span className="text-gray-400 dark:text-gray-600">Not recorded</span>}
                          </td>
                          <td className="py-3 pr-4">
                            <span className={`px-3 py-1 rounded-full text-sm font-semibold ${STATUS_TONE[l.status] ?? STATUS_TONE.ENTERED}`}>
                              {l.status}
                            </span>
                          </td>
                          <td className="py-3">
                            {l.addedToBC
                              ? <span className="text-emerald-600 dark:text-emerald-400 font-bold" title="Added to Business Central">✓</span>
                              : <span className="text-gray-400 dark:text-gray-600">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </SaleGroup>
              ))}
            </Panel>

            {/* ── Business Central ── */}
            <Panel
              title="🏢 Business Central"
              blurb="Items in BC, as of the last warehouse sync."
              capped={data.capped.bc}
              empty={bcGroups.length === 0 ? "No matching items in Business Central." : null}
            >
              {bcGroups.map(g => (
                <SaleGroup key={`${g.code}||${g.name}`} code={g.code} name={g.name} date={g.date} count={g.rows.length} noun="item" fallback="No sale allocated">
                  <table className="w-full text-base">
                    <thead className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">
                      <tr>
                        <th className="text-left py-2 pr-4 font-semibold">Item</th>
                        <th className="text-left py-2 pr-4 font-semibold">Catalogued by</th>
                        <th className="text-left py-2 pr-4 font-semibold">Lot</th>
                        <th className="text-left py-2 font-semibold">Location</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                      {g.rows.map(w => (
                        <tr key={w.uniqueId} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                          <td className="py-3 pr-4 text-gray-800 dark:text-gray-200 max-w-[280px] truncate"
                              title={`${w.uniqueId}${w.description ? " · " + w.description : ""}`}>
                            <span className="font-mono text-gray-500 dark:text-gray-500">{w.uniqueId}</span>
                            {w.description ? ` · ${w.description}` : ""}
                          </td>
                          <td className="py-3 pr-4 whitespace-nowrap">
                            {w.catalogued
                              ? <span className="font-medium text-emerald-700 dark:text-emerald-400">
                                  ✓ {w.cataloguedByName || w.cataloguedBy || "Yes"}
                                </span>
                              : <span className="text-gray-400 dark:text-gray-600">Not catalogued</span>}
                          </td>
                          <td className="py-3 pr-4 font-mono text-gray-600 dark:text-gray-400">{w.lotNo || "—"}</td>
                          <td className="py-3 font-mono text-gray-600 dark:text-gray-400">{w.location || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </SaleGroup>
              ))}
            </Panel>
          </div>
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

function Panel({ title, blurb, capped, empty, children }: {
  title: string; blurb: string; capped: boolean; empty: string | null; children: React.ReactNode
}) {
  return (
    <div className={`${CARD} p-6`}>
      <h2 className="text-xl font-bold text-gray-900 dark:text-white">{title}</h2>
      <p className={`${HINT} mt-1 mb-5`}>{blurb}</p>
      {capped && (
        <p className="mb-4 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-base text-amber-800 dark:text-amber-300">
          Showing the first 500 — narrow your search to see the rest.
        </p>
      )}
      {empty ? <p className="text-base text-gray-500 dark:text-gray-400 py-4">{empty}</p> : children}
    </div>
  )
}

function SaleGroup({ code, name, date, count, noun, fallback, children }: {
  code: string; name: string; date: string; count: number; noun: string; fallback: string; children: React.ReactNode
}) {
  const when = formatSaleDate(date)
  return (
    <div className="mb-8 last:mb-0">
      <div className="flex flex-wrap items-baseline gap-x-3 mb-2">
        <span className="text-lg font-bold text-gray-900 dark:text-white">
          {code ? <span className="font-mono">{code}</span> : fallback}
        </span>
        {code && name && <span className="text-base text-gray-600 dark:text-gray-400">{name}</span>}
        {when && (
          <span className="px-3 py-1 rounded-full text-sm font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 whitespace-nowrap">
            📅 {when}
          </span>
        )}
        <span className="text-base text-gray-500 dark:text-gray-500">
          {count} {noun}{count === 1 ? "" : "s"}
        </span>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  )
}
