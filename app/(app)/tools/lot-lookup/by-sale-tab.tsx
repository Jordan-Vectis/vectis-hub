"use client"

// Admin Centre → "Who catalogued the lots in a sale?"
//
// ⚠ The reason this tab exists: the lot NUMBER only lives in Business Central,
// but BC's own "catalogued by" is worthless — lots are pushed across in bulk, so
// every lot in a sale carries whoever ran the import rather than the person who
// catalogued it. So the lot number is read from BC and the cataloguer from the
// Hub (CatalogueLot.createdByName), joined on the barcode / unique ID.
//
// Same house style as the other two tabs: large type, large hit targets.

import { useEffect, useMemo, useState } from "react"
import { CARD, INPUT, BTN_PRIMARY, HINT, formatSaleDate, formatWhen, formatDay } from "./ui"

type Sale = { code: string; name: string; date: string; lots: number }
type Row  = {
  key: string; lotNo: string; lotSort: number; uniqueId: string; barcode: string; title: string
  vendor: string; location: string; tote: string; photos: number
  inHub: boolean; hubLotId: string; cataloguedBy: string; cataloguedAt: string
  bcStampCode: string; bcStampName: string; bcCatalogued: boolean; hubSaleCode: string
}
type Result = {
  sale: { code: string; name: string; date: string }
  rows: Row[]
  cataloguers: { name: string; lots: number }[]
  capped: boolean
}

// Driven by the Admin Centre page's single search bar when `controlled` is set: it supplies the
// sale code and, optionally, a lot number to filter to. The tab then hides its own pick-a-sale
// card. `nonce` bumps on every Search press so the same sale can be reloaded.
export type SaleControlled = { sale: string; lot: string; nonce: number }

export default function BySaleTab({ controlled }: { controlled?: SaleControlled } = {}) {
  const [sales, setSales]         = useState<Sale[]>([])
  const [salesError, setSalesErr] = useState<string | null>(null)
  const [sale, setSale]           = useState("")
  const [lotFilter, setLotFilter] = useState("")
  const [person, setPerson]       = useState<string | null>(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [data, setData]           = useState<Result | null>(null)

  // The sale list comes from BC itself, so the codes offered are always codes
  // that actually have lots against them.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res  = await fetch("/api/lot-lookup/sale?sales=1")
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? res.statusText)
        if (!cancelled) setSales(json.sales ?? [])
      } catch (e: any) { if (!cancelled) setSalesErr(e.message) }
    })()
    return () => { cancelled = true }
  }, [])

  async function load(code: string) {
    const c = code.trim()
    if (!c || loading) return
    setLoading(true); setError(null); setPerson(null)
    try {
      const res  = await fetch(`/api/lot-lookup/sale?sale=${encodeURIComponent(c)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.statusText)
      setData(json)
    } catch (e: any) { setError(e.message); setData(null) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    if (!controlled?.sale.trim()) { setData(null); return }
    setSale(controlled.sale)
    setLotFilter(controlled.lot)
    setPerson(null)
    void load(controlled.sale)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlled?.nonce])

  const rows = useMemo(() => data?.rows ?? [], [data])
  const shown = useMemo(() => {
    const lot = lotFilter.trim().toLowerCase()
    return rows.filter(r => {
      if (person !== null && (r.cataloguedBy || "") !== person) return false
      if (!lot) return true
      // Typing "247" should land on lot 247, not on 1247 and 2470 as well.
      return r.lotNo.toLowerCase() === lot || r.lotSort === Number(lot)
    })
  }, [rows, lotFilter, person])

  // Searched for a single lot number and got exactly one — show the big answer
  // instead of a one-row table.
  const one = lotFilter.trim() && shown.length === 1 ? shown[0] : null

  const missing = rows.filter(r => !r.inHub).length
  const noNumber = rows.filter(r => !r.lotNo).length

  return (
    <div className="space-y-6">
      {/* ── 1 · Pick the sale, 2 · search it by lot number (hidden when the page owns the search) ── */}
      {!controlled && <div className={`${CARD} p-6`}>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_14rem] gap-5">
          <div>
            <label htmlFor="sale-select" className="block text-lg font-semibold text-gray-900 dark:text-white mb-1">
              1 · Which sale?
            </label>
            <p className={`${HINT} mb-3`}>Straight from Business Central — newest first.</p>
            <select
              id="sale-select"
              value={sales.some(s => s.code === sale) ? sale : ""}
              onChange={e => { setSale(e.target.value); if (e.target.value) load(e.target.value) }}
              className={INPUT}
            >
              <option value="">Choose a sale…</option>
              {sales.map(s => (
                <option key={s.code} value={s.code}>
                  {[s.code, s.name].filter(Boolean).join(" — ")}
                  {formatSaleDate(s.date) ? ` · ${formatSaleDate(s.date)}` : ""}
                  {` · ${s.lots} lots`}
                </option>
              ))}
            </select>
            {/* Free-text fallback: a brand-new sale, or one the list didn't load. */}
            <div className="flex flex-col sm:flex-row gap-3 mt-3">
              <input
                value={sale}
                onChange={e => setSale(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") load(sale) }}
                placeholder="…or type the sale code, e.g. F088"
                aria-label="Sale code"
                autoComplete="off"
                className={`${INPUT} sm:max-w-sm`}
              />
              <button onClick={() => load(sale)} disabled={loading || !sale.trim()} className={`${BTN_PRIMARY} whitespace-nowrap`}>
                {loading ? "Loading…" : "Load the sale"}
              </button>
            </div>
          </div>

          {/* The actual search. It filters the loaded sale, so it answers as you
              type rather than making you press a button for each lot. */}
          <div className="lg:border-l-2 lg:border-gray-100 lg:dark:border-gray-800 lg:pl-5">
            <label htmlFor="lot-search" className="block text-lg font-semibold text-gray-900 dark:text-white mb-1">
              2 · Lot number
            </label>
            <p className={`${HINT} mb-3`}>BC&apos;s lot number. Blank = the whole sale.</p>
            <input
              id="lot-search"
              value={lotFilter}
              onChange={e => setLotFilter(e.target.value)}
              onFocus={e => e.currentTarget.select()}
              placeholder="247"
              inputMode="numeric"
              autoComplete="off"
              disabled={!data}
              className={`${INPUT} text-2xl disabled:opacity-40`}
            />
            {(lotFilter || person !== null) && (
              <button
                onClick={() => { setLotFilter(""); setPerson(null) }}
                className="mt-3 w-full px-6 py-3 rounded-xl border-2 border-gray-300 dark:border-gray-700 text-base font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        {salesError && (
          <p className="mt-3 text-base text-amber-700 dark:text-amber-300">
            Couldn&apos;t load the sale list ({salesError}) — type the sale code instead.
          </p>
        )}
        {error && (
          <p className="mt-4 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-base text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </div>}

      {controlled && loading && <p className="text-lg text-gray-500 dark:text-gray-400">Loading the sale…</p>}
      {controlled && error && (
        <p className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-base text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      {/* Controlled: the lot filter still needs to be adjustable without retyping the sale. */}
      {controlled && data && (
        <div className={`${CARD} px-6 py-4 flex flex-wrap items-end gap-4`}>
          <div>
            <label htmlFor="lot-search" className="block text-base font-semibold text-gray-900 dark:text-white mb-1">Lot number</label>
            <p className={`${HINT} mb-2`}>Blank shows the whole sale.</p>
            <input
              id="lot-search"
              value={lotFilter}
              onChange={e => setLotFilter(e.target.value)}
              onFocus={e => e.currentTarget.select()}
              placeholder="247"
              inputMode="numeric"
              autoComplete="off"
              className={`${INPUT} text-2xl sm:w-48`}
            />
          </div>
          {(lotFilter || person !== null) && (
            <button
              onClick={() => { setLotFilter(""); setPerson(null) }}
              className="px-6 py-3 rounded-xl border-2 border-gray-300 dark:border-gray-700 text-base font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
            >
              Show the whole sale
            </button>
          )}
        </div>
      )}

      {data && (
        <>
          {/* ── The sale ── */}
          <div className="rounded-2xl border-2 border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1C1C1E] px-6 py-5">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">Sale</p>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mt-1">
              <span className="text-3xl font-bold font-mono text-gray-900 dark:text-white">{data.sale.code}</span>
              {data.sale.name && <span className="text-xl text-gray-700 dark:text-gray-300">{data.sale.name}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-3 text-base">
              <span className="text-gray-800 dark:text-gray-200 font-semibold">
                📅 {formatSaleDate(data.sale.date) || "No sale date set"}
              </span>
              <span className="text-gray-600 dark:text-gray-400">{rows.length.toLocaleString()} lot{rows.length === 1 ? "" : "s"} in BC</span>
              {missing  > 0 && <span className="text-orange-600 dark:text-orange-400 font-semibold">{missing} not matched to a Hub lot</span>}
              {noNumber > 0 && <span className="text-amber-600 dark:text-amber-400 font-semibold">{noNumber} not numbered yet</span>}
            </div>
          </div>

          {/* Why the Hub name and not BC's — the whole point of this tab. */}
          <p className="px-5 py-4 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30 text-base text-indigo-900 dark:text-indigo-200">
            <strong>Catalogued by</strong> is the person who entered the lot <strong>in the Hub</strong>. Business Central&apos;s
            own cataloguer field is not used here — lots are pushed across in bulk, so BC records whoever ran the import on
            every lot in the sale.
          </p>

          {data.capped && (
            <p className="px-5 py-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-base text-amber-800 dark:text-amber-300">
              This sale is unusually large — showing the first 5,000 items only.
            </p>
          )}

          {/* ── Who catalogued this sale ── */}
          {data.cataloguers.length > 0 && (
            <div className={`${CARD} p-6`}>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">👥 Who catalogued this sale</h3>
              <p className={`${HINT} mb-4`}>Click a name to show only their lots.</p>
              <div className="flex flex-wrap gap-3">
                {data.cataloguers.map(c => {
                  const on = person === c.name
                  return (
                    <button
                      key={c.name || "__none"}
                      onClick={() => setPerson(on ? null : c.name)}
                      className={`px-5 py-3 rounded-xl border-2 text-base font-semibold transition ${
                        on
                          ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
                          : c.name
                            ? "border-gray-200 dark:border-gray-800 text-gray-800 dark:text-gray-200 hover:border-gray-300 dark:hover:border-gray-700"
                            : "border-orange-200 dark:border-orange-500/30 text-orange-700 dark:text-orange-300"
                      }`}
                    >
                      {c.name || "No cataloguer recorded"}
                      <span className="ml-2 font-normal text-gray-500 dark:text-gray-400">{c.lots}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── One lot searched for: the big answer, same as the barcode tab ── */}
          {one && (
            <div className={`${CARD} overflow-hidden`}>
              <div className="bg-indigo-50 dark:bg-indigo-500/10 border-b border-indigo-100 dark:border-indigo-500/20 px-8 py-8">
                <p className="text-sm font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 mb-2">
                  {data.sale.code} · Lot {one.lotNo} — catalogued by
                </p>
                {one.cataloguedBy ? (
                  <>
                    <p className="text-4xl sm:text-5xl font-bold text-gray-900 dark:text-white leading-tight">
                      {one.cataloguedBy}
                    </p>
                    {one.cataloguedAt && (
                      <p className="text-lg text-gray-700 dark:text-gray-300 mt-3">on {formatDay(one.cataloguedAt)}</p>
                    )}
                  </>
                ) : one.inHub ? (
                  <>
                    <p className="text-3xl font-bold text-gray-500 dark:text-gray-400">No name recorded</p>
                    <p className="text-base text-gray-600 dark:text-gray-400 mt-3 max-w-2xl">
                      The lot is in the Hub but has no cataloguer stamped on it — that happens with older lots and with
                      lots created by an import rather than by a person.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-3xl font-bold text-orange-600 dark:text-orange-400">Not in the Hub</p>
                    <p className="text-base text-gray-600 dark:text-gray-400 mt-3 max-w-2xl">
                      This lot is in Business Central but has no matching lot in the Hub cataloguing tool, so there is no
                      cataloguer to show
                      {one.bcStampCode ? ` (BC's import stamp says ${one.bcStampName || one.bcStampCode}, which is whoever ran the import)` : ""}.
                    </p>
                  </>
                )}
              </div>
              <div className="px-8 py-6">
                <p className="text-2xl font-semibold text-gray-900 dark:text-white leading-snug">{one.title || "No description"}</p>
                <div className="flex flex-wrap items-center gap-x-8 gap-y-3 mt-5 text-base">
                  {one.barcode  && <Fact label="Barcode"   value={one.barcode} mono />}
                  {one.uniqueId && <Fact label="Unique ID" value={one.uniqueId} mono />}
                  {one.vendor   && <Fact label="Customer"  value={one.vendor} />}
                  {one.tote     && <Fact label="Made from tote" value={one.tote} mono />}
                  <Fact label="Location" value={one.location || "—"} mono={!!one.location} />
                  <Fact label="Photos" value={String(one.photos)} />
                </div>
              </div>
            </div>
          )}

          {shown.length === 0 ? (
            <div className={`${CARD} p-10 text-center`}>
              <div className="text-6xl mb-4">🤷</div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                {rows.length === 0 ? `Nothing in Business Central for ${data.sale.code}` : "Nothing matches that"}
              </h2>
              <p className="text-base text-gray-600 dark:text-gray-400 max-w-xl mx-auto">
                {rows.length === 0
                  ? "That sale code has no items against it in the last warehouse sync."
                  : "No lot in this sale has that number — check the number, or clear the filters."}
              </p>
            </div>
          ) : one ? null : (
            <div className="rounded-2xl border-2 border-gray-200 dark:border-gray-800 overflow-hidden bg-white dark:bg-[#1C1C1E]">
              <div className="px-6 py-4 border-b-2 border-gray-200 dark:border-gray-800 flex flex-wrap items-baseline gap-x-4">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Lots</h3>
                <span className={HINT}>
                  {shown.length === rows.length
                    ? `${rows.length.toLocaleString()} lots`
                    : `${shown.length.toLocaleString()} of ${rows.length.toLocaleString()} lots`}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-base">
                  <thead className="bg-gray-50 dark:bg-gray-900/60 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    <tr>
                      <th className="text-left px-6 py-3 font-semibold">Lot no.</th>
                      <th className="text-left px-6 py-3 font-semibold">Item</th>
                      <th className="text-left px-6 py-3 font-semibold">Catalogued by</th>
                      <th className="text-left px-6 py-3 font-semibold">When</th>
                      <th className="text-left px-6 py-3 font-semibold">Location</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                    {shown.map(r => (
                      <tr key={r.key} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 align-top">
                        <td className="px-6 py-4 whitespace-nowrap">
                          {r.lotNo
                            ? <span className="text-2xl font-bold font-mono text-gray-900 dark:text-white">{r.lotNo}</span>
                            : <span className="text-base text-amber-600 dark:text-amber-400 font-semibold">Not numbered yet</span>}
                        </td>
                        <td className="px-6 py-4">
                          <p className="font-mono font-semibold text-gray-900 dark:text-white">{r.barcode || r.uniqueId}</p>
                          {r.barcode && r.uniqueId && (
                            <p className="font-mono text-sm text-gray-500 dark:text-gray-500">{r.uniqueId}</p>
                          )}
                          <p className="text-gray-700 dark:text-gray-300 max-w-lg mt-0.5">{r.title || "No description"}</p>
                          {r.hubSaleCode && r.hubSaleCode.toUpperCase() !== data.sale.code.toUpperCase() && (
                            <p className="text-sm text-amber-600 dark:text-amber-400 font-semibold mt-0.5">
                              ⚠ The Hub has it in {r.hubSaleCode}
                            </p>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {r.cataloguedBy ? (
                            <span className="text-lg font-semibold text-gray-900 dark:text-white">{r.cataloguedBy}</span>
                          ) : r.inHub ? (
                            <>
                              <span className="text-base font-semibold text-gray-500 dark:text-gray-400">No name recorded</span>
                              <span className={`block ${HINT}`}>In the Hub, but no cataloguer stamped on it</span>
                            </>
                          ) : (
                            <>
                              <span className="text-base font-semibold text-orange-600 dark:text-orange-400">Not in the Hub</span>
                              <span className={`block ${HINT}`}>
                                No matching lot, so there is no cataloguer to show
                                {r.bcStampCode ? ` (BC's import stamp: ${r.bcStampName || r.bcStampCode})` : ""}
                              </span>
                            </>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-600 dark:text-gray-400">
                          {r.cataloguedAt ? formatWhen(r.cataloguedAt) : "—"}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="font-mono text-gray-800 dark:text-gray-200">{r.location || "—"}</span>
                          {r.tote && <span className={`block ${HINT} font-mono`}>Tote {r.tote}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
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
