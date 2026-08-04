"use client"

// Admin Centre → "Who catalogued this lot?"
//
// One question, one big answer. Scan or type the barcode and it tells you who
// entered the lot, when, and which sale it went into — then, underneath, the
// cross-check against Business Central and everyone who has changed it since.

import { useState } from "react"
import {
  CARD, INPUT, BTN_PRIMARY, HINT,
  actionLabel, sourceLabel, fieldLabel, formatWhen, formatDay, saleLine,
} from "./ui"

type Person  = { name: string; changes: number; firstAt: string; lastAt: string; created: boolean }
type Event   = { action: string; source: string; field: string; oldValue: string; newValue: string; changedBy: string; changedAt: string }
type HubLot  = {
  id: string; title: string; barcode: string; receiptUniqueId: string; receipt: string; tote: string
  vendor: string; status: string; addedToBC: boolean; category: string; photos: number
  saleId: string; saleCode: string; saleName: string; saleDate: string
  cataloguedBy: string; cataloguedAt: string; updatedAt: string
  people: Person[]; history: Event[]
}
type BcItem = {
  uniqueId: string; barcode: string; description: string; receiptNo: string; vendorNo: string; vendorName: string
  catalogued: boolean; cataloguedByCode: string; cataloguedByName: string; cataloguedAt: string; photos: number
  saleCode: string; saleName: string; saleDate: string; lotNo: string; location: string; toteNo: string
}
type Result = { q: string; lots: HubLot[]; bc: BcItem[]; historyCapped: boolean }

export default function WhoCataloguedTab() {
  const [value, setValue]     = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [data, setData]       = useState<Result | null>(null)
  const [openHistory, setOpenHistory] = useState<Record<string, boolean>>({})

  async function search() {
    const q = value.trim()
    if (!q || loading) return
    setLoading(true); setError(null)
    try {
      const res  = await fetch(`/api/lot-lookup/who?q=${encodeURIComponent(q)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.statusText)
      setData(json); setOpenHistory({})
    } catch (e: any) { setError(e.message); setData(null) }
    finally { setLoading(false) }
  }

  const nothingFound = data && data.lots.length === 0 && data.bc.length === 0
  // BC rows that don't line up with a Hub lot are still worth showing on their own.
  const hubIds = new Set(data?.lots.flatMap(l => [l.barcode.toUpperCase(), l.receiptUniqueId.toUpperCase()]).filter(Boolean) ?? [])
  const bcExtra = data?.bc.filter(b => !hubIds.has(b.barcode.toUpperCase()) && !hubIds.has(b.uniqueId.toUpperCase())) ?? []

  return (
    <div className="space-y-6">
      {/* ── Search ── */}
      <div className={`${CARD} p-6`}>
        <label htmlFor="who-input" className="block text-lg font-semibold text-gray-900 dark:text-white mb-1">
          Scan or type the barcode on the item
        </label>
        <p className={`${HINT} mb-4`}>
          The barcode on the label (like <span className="font-mono">F066001</span>) or the unique ID
          (like <span className="font-mono">R000016-413</span>). Either works.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            id="who-input"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") search() }}
            onFocus={e => e.currentTarget.select()}
            placeholder="F066001"
            autoFocus
            autoComplete="off"
            className={INPUT}
          />
          <button onClick={search} disabled={loading || !value.trim()} className={`${BTN_PRIMARY} whitespace-nowrap`}>
            {loading ? "Looking…" : "Who catalogued it?"}
          </button>
        </div>
        {error && (
          <p className="mt-4 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-base text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </div>

      {/* ── Nothing found ── */}
      {nothingFound && (
        <div className={`${CARD} p-10 text-center`}>
          <div className="text-6xl mb-4">🤷</div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            No lot found for “{data!.q}”
          </h2>
          <p className="text-base text-gray-600 dark:text-gray-400 max-w-xl mx-auto">
            Nothing in the Hub cataloguing system or Business Central matches that code. Check for a typo, or try the
            other identifier — the barcode on the label and the unique ID are different numbers.
          </p>
        </div>
      )}

      {/* ── The answer, one card per matching lot ── */}
      {data?.lots.map(lot => {
        const bc = data.bc.find(b =>
          (b.barcode && b.barcode.toUpperCase() === lot.barcode.toUpperCase()) ||
          (b.uniqueId && b.uniqueId.toUpperCase() === lot.receiptUniqueId.toUpperCase()))
        const showHistory = openHistory[lot.id]

        return (
          <div key={lot.id} className="space-y-4">
            {/* The big answer */}
            <div className={`${CARD} overflow-hidden`}>
              <div className="bg-indigo-50 dark:bg-indigo-500/10 border-b border-indigo-100 dark:border-indigo-500/20 px-8 py-8">
                <p className="text-sm font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 mb-2">
                  Catalogued by
                </p>
                {lot.cataloguedBy ? (
                  <>
                    <p className="text-4xl sm:text-5xl font-bold text-gray-900 dark:text-white leading-tight">
                      {lot.cataloguedBy}
                    </p>
                    <p className="text-lg text-gray-700 dark:text-gray-300 mt-3">
                      on {formatDay(lot.cataloguedAt)} at{" "}
                      <span className="font-semibold">{formatWhen(lot.cataloguedAt).split(", ").pop()}</span>
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-3xl font-bold text-gray-500 dark:text-gray-400">No name recorded</p>
                    <p className="text-base text-gray-600 dark:text-gray-400 mt-3 max-w-2xl">
                      This lot has no cataloguer stamped on it — that happens with older lots and with lots created by an
                      import rather than by a person. Check the change history below, or what Business Central says.
                    </p>
                  </>
                )}
              </div>

              {/* What the lot is */}
              <div className="px-8 py-6">
                <p className="text-2xl font-semibold text-gray-900 dark:text-white leading-snug">{lot.title}</p>
                <div className="flex flex-wrap items-center gap-x-8 gap-y-3 mt-5 text-base">
                  <Fact label="Sale" value={saleLine(lot.saleCode, lot.saleName, lot.saleDate, "Not in a sale")} />
                  {lot.barcode         && <Fact label="Barcode"   value={lot.barcode} mono />}
                  {lot.receiptUniqueId && <Fact label="Unique ID" value={lot.receiptUniqueId} mono />}
                  {lot.receipt && <Fact label="Receipt" value={lot.receipt} mono />}
                  {lot.tote    && <Fact label="Tote"    value={lot.tote} mono />}
                  {lot.vendor  && <Fact label="Customer" value={lot.vendor} mono />}
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-6">
                  <span className="px-4 py-2 rounded-full text-base font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                    📷 {lot.photos} photo{lot.photos === 1 ? "" : "s"}
                  </span>
                  {/* Whether it reached BC comes from an actual BC match on the
                      barcode — NOT CatalogueLot.addedToBC, a manual tick that is
                      routinely left unticked on lots that are plainly in BC. */}
                  <span className={`px-4 py-2 rounded-full text-base font-medium ${
                    bc
                      ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                      : "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300"}`}>
                    {bc ? "✓ In Business Central" : "Not pushed to Business Central yet"}
                  </span>
                  {lot.category && (
                    <span className="px-4 py-2 rounded-full text-base font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                      {lot.category}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Cross-check + everyone who touched it */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className={`${CARD} p-6`}>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">🏢 What Business Central says</h3>
                <p className={`${HINT} mb-4`}>From the last warehouse sync. It can disagree with the Hub — that on its own isn&apos;t a problem.</p>
                {!bc ? (
                  <p className="text-base text-gray-500 dark:text-gray-400 py-2">This lot isn&apos;t in the synced Business Central data.</p>
                ) : bc.catalogued ? (
                  <>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      {bc.cataloguedByName || bc.cataloguedByCode || "Marked as catalogued"}
                    </p>
                    {bc.cataloguedByName && bc.cataloguedByCode && (
                      <p className={`${HINT} mt-1`}>Staff code {bc.cataloguedByCode}</p>
                    )}
                    {bc.cataloguedAt && <p className="text-base text-gray-700 dark:text-gray-300 mt-2">on {formatDay(bc.cataloguedAt)}</p>}
                  </>
                ) : (
                  <p className="text-xl font-semibold text-amber-600 dark:text-amber-400">Not marked as catalogued in BC</p>
                )}
                {bc && (
                  <div className="flex flex-wrap gap-x-8 gap-y-3 mt-5 text-base">
                    <Fact label="Sale" value={saleLine(bc.saleCode, bc.saleName, bc.saleDate)} />
                    {/* BC writes 0 until the sale is numbered — say so, don't print 0. */}
                    <Fact label="Lot number" value={bc.lotNo && bc.lotNo !== "0" ? bc.lotNo : "Not numbered yet"} mono={!!bc.lotNo && bc.lotNo !== "0"} />
                    <Fact label="Location" value={bc.location || "—"} mono />
                    <Fact label="Photos" value={String(bc.photos)} />
                  </div>
                )}
              </div>

              <div className={`${CARD} p-6`}>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">👥 Everyone who has worked on this lot</h3>
                <p className={`${HINT} mb-4`}>From the lot change log — every edit, photo change and bulk action.</p>
                {lot.people.length === 0 ? (
                  <p className="text-base text-gray-500 dark:text-gray-400 py-2">
                    No changes recorded. The change log only covers lots edited since 1 July 2026.
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                    {lot.people.map(p => (
                      <li key={p.name} className="py-3 flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-lg font-semibold text-gray-900 dark:text-white truncate">{p.name}</p>
                          <p className={HINT}>
                            {p.created ? "Created the lot · " : ""}
                            {formatWhen(p.firstAt)}
                            {p.lastAt !== p.firstAt ? ` → ${formatWhen(p.lastAt)}` : ""}
                          </p>
                        </div>
                        <span className="flex-shrink-0 px-3 py-1.5 rounded-full text-base font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                          {p.changes} change{p.changes === 1 ? "" : "s"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {lot.history.length > 0 && (
                  <button
                    onClick={() => setOpenHistory(o => ({ ...o, [lot.id]: !o[lot.id] }))}
                    className="mt-4 px-5 py-3 rounded-xl border-2 border-gray-300 dark:border-gray-700 text-base font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                  >
                    {showHistory ? "Hide the full history" : `Show the full history (${lot.history.length})`}
                  </button>
                )}
              </div>
            </div>

            {/* Full audit trail */}
            {showHistory && (
              <div className={`${CARD} overflow-hidden`}>
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">📜 Full change history</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-base">
                    <thead className="bg-gray-50 dark:bg-gray-900/60 text-sm uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      <tr>
                        <th className="text-left px-6 py-3 font-semibold">When</th>
                        <th className="text-left px-6 py-3 font-semibold">Who</th>
                        <th className="text-left px-6 py-3 font-semibold">What</th>
                        <th className="text-left px-6 py-3 font-semibold">Where from</th>
                        <th className="text-left px-6 py-3 font-semibold">Changed to</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {lot.history.map((e, i) => (
                        <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                          <td className="px-6 py-3 whitespace-nowrap text-gray-600 dark:text-gray-400">{formatWhen(e.changedAt)}</td>
                          <td className="px-6 py-3 whitespace-nowrap font-semibold text-gray-900 dark:text-white">{e.changedBy}</td>
                          <td className="px-6 py-3 text-gray-700 dark:text-gray-300">
                            {actionLabel(e.action)}
                            {e.action === "updated" && e.field ? <> · <span className="font-medium">{fieldLabel(e.field)}</span></> : null}
                          </td>
                          <td className="px-6 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400">{sourceLabel(e.source) || "—"}</td>
                          <td className="px-6 py-3 text-gray-600 dark:text-gray-400 max-w-md">{e.newValue || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.historyCapped && (
                  <p className="px-6 py-3 text-sm text-amber-600 dark:text-amber-400 border-t border-gray-200 dark:border-gray-800">
                    Showing the most recent changes only — this lot has a long history.
                  </p>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* ── In BC but never catalogued in the Hub ── */}
      {bcExtra.map(b => (
        <div key={b.uniqueId} className={`${CARD} overflow-hidden`}>
          <div className="bg-orange-50 dark:bg-orange-500/10 border-b border-orange-100 dark:border-orange-500/20 px-8 py-8">
            <p className="text-sm font-semibold uppercase tracking-wider text-orange-600 dark:text-orange-400 mb-2">
              Found in Business Central only
            </p>
            <p className="text-3xl font-bold text-gray-900 dark:text-white">
              {b.catalogued ? (b.cataloguedByName || b.cataloguedByCode || "Marked as catalogued") : "Not catalogued yet"}
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 mt-3">
              This item has no matching lot in the Hub cataloguing tool
              {b.cataloguedAt ? <> · catalogued in BC on {formatDay(b.cataloguedAt)}</> : null}
            </p>
          </div>
          <div className="px-8 py-6">
            <p className="text-xl text-gray-900 dark:text-white">{b.description || "No description"}</p>
            <div className="flex flex-wrap gap-x-8 gap-y-3 mt-5 text-base">
              <Fact label="Unique ID" value={b.uniqueId} mono />
              {b.barcode && <Fact label="Barcode" value={b.barcode} mono />}
              <Fact label="Sale" value={saleLine(b.saleCode, b.saleName, b.saleDate)} />
              <Fact label="Customer" value={b.vendorName || b.vendorNo || "—"} />
              <Fact label="Location" value={b.location || "—"} mono />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-500 mb-0.5">{label}</p>
      <p className={`text-gray-900 dark:text-white font-medium ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  )
}
