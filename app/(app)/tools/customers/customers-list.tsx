"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  TYPES, TOGGLES, SORTS, QUICK_VIEWS, filtersToHref, quickViewHref, activeFilterCount, customerNumber,
  type ListFilters, type ToggleKey, type SortKey, type TypeKey, type FilterChange,
} from "@/lib/customers/filters"
import type { Facets, ListRow } from "@/lib/customers/queries"

// The Customers list: side filters (collapsible — the choice is kept per device), the table, and a
// preview of whichever row was tapped, so a person can be checked without leaving the list. Every
// filter lives in the URL, so Back, a refresh and a shared link keep it; the server runs the query.

export type RowDTO = Omit<ListRow, "lastReceipt" | "lastNote" | "followUpAt"> & { lastReceipt: string | null; lastNote: string | null; followUpAt: string | null }

type Summary = {
  address: string | null; since: string | null; notesReady: boolean
  notes: { id: string; kind: string; text: string; byName: string | null; createdAt: string; followUpAt: string | null; followUpDone: boolean }[]
  idStatus: string | null; idChecked: string | null; approvedBuy: boolean; approvedSell: boolean; highRisk: boolean; cardReady: boolean
}

const OPEN_KEY = "customers_filters_open"

const day = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" }) : null
const shortDay = (s: string | null | undefined) => {
  if (!s) return null
  const d = new Date(s.length === 10 ? `${s}T12:00:00Z` : s)
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" })
}
const KIND_LABEL: Record<string, string> = { note: "Note", call: "Call", email: "Email", visit: "Visit" }

/** The newest thing on record for a row — a note, a receipt or a sale. */
function lastActivity(r: RowDTO): { what: string; when: string } | null {
  const c: { what: string; t: number; label: string }[] = []
  if (r.lastNote) c.push({ what: "Note", t: new Date(r.lastNote).getTime(), label: shortDay(r.lastNote)! })
  if (r.lastReceipt) c.push({ what: "Receipt", t: new Date(r.lastReceipt).getTime(), label: shortDay(r.lastReceipt)! })
  if (r.lastSale) { const t = new Date(`${r.lastSale.slice(0, 10)}T12:00:00Z`).getTime(); if (!isNaN(t)) c.push({ what: t > Date.now() ? "In sale" : "Sold in sale", t, label: shortDay(r.lastSale)! }) }
  if (!c.length) return null
  c.sort((a, b) => b.t - a.t)
  return { what: c[0].what, when: c[0].label }
}

const pill = (cls: string) => `inline-flex items-center h-[22px] px-2 rounded-full text-[11px] font-bold ${cls}`
const SELLER = pill("bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200")
const BUYER  = pill("bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200")
const WEB    = pill("bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200")
const BLOCK  = pill("bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300")
const btn = "min-h-[44px] inline-flex items-center justify-center px-4 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm font-semibold text-gray-800 dark:text-gray-100 hover:border-indigo-400"
const input = "min-h-[44px] px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm"

export default function CustomersList({ rows, total, pages, filters, facets, notesReady, isAdmin }: {
  rows: RowDTO[]; total: number; pages: number; filters: ListFilters; facets: Facets; notesReady: boolean; isAdmin: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(true)
  const [q, setQ] = useState(filters.q)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [summary, setSummary] = useState<Record<string, Summary | { error: string } | "loading">>({})
  const asideRef = useRef<HTMLElement | null>(null)

  useEffect(() => { try { if (localStorage.getItem(OPEN_KEY) === "0") setOpen(false) } catch { /* private mode */ } }, [])
  useEffect(() => { setQ(filters.q) }, [filters.q])
  const toggleOpen = () => { setOpen(o => { try { localStorage.setItem(OPEN_KEY, o ? "0" : "1") } catch { /* private mode */ } return !o }) }

  const go = (change: FilterChange) => router.push(filtersToHref(filters, change))
  const setToggle = (k: ToggleKey, on: boolean) => go({ toggles: { [k]: on } as Partial<Record<ToggleKey, boolean>> })

  const selected = rows.find(r => r.id === selectedId) ?? null
  async function select(id: string) {
    setSelectedId(id)
    if (summary[id]) return
    setSummary(s => ({ ...s, [id]: "loading" }))
    try {
      const res = await fetch(`/api/customers/${id}/summary`, { cache: "no-store" })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? `Couldn't read (${res.status})`)
      setSummary(s => ({ ...s, [id]: d as Summary }))
    } catch (e: any) {
      setSummary(s => ({ ...s, [id]: { error: e?.message ?? "Couldn't read" } }))
    }
  }

  const active = activeFilterCount(filters)
  const facetFor = (key: string): number | null => {
    const v = (facets as Record<string, number | null>)[key]
    return typeof v === "number" ? v : null
  }
  const groups = Array.from(new Set(TOGGLES.map(t => t.group)))

  return (
    <div className="space-y-3">
      {/* Search + sort + the filters toggle */}
      <form className="flex flex-wrap gap-2 items-center" action="/tools/customers" onSubmit={e => { e.preventDefault(); go({ q: q.trim() }) }}>
        <button type="button" onClick={toggleOpen} aria-expanded={open} aria-controls="customer-filters"
          className={`${btn} gap-2 ${active ? "border-indigo-500" : ""}`}>
          <span aria-hidden="true">☰</span> Filters{active > 0 && <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-indigo-600 text-white text-xs">{active}</span>}
        </button>
        <label htmlFor="customers-q" className="sr-only">Search</label>
        <input id="customers-q" name="q" value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, email, postcode, phone or customer number…"
          className={`${input} flex-1 min-w-[240px]`} />
        <button className="min-h-[44px] px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold">Search</button>
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">Sort
          <select value={filters.sort} onChange={e => go({ sort: e.target.value as SortKey })} className={input} aria-label="Sort">
            {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      </form>

      <div className="flex flex-wrap gap-4 items-start">
        {/* Filters */}
        {open && (
          <aside id="customer-filters" aria-label="Filters" className="flex-[0_1_250px] min-w-[220px] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">Filters</h2>
              {active > 0 && <Link href="/tools/customers" className="text-xs text-indigo-700 dark:text-indigo-300">Clear</Link>}
            </div>
            <fieldset>
              <legend className="text-[11px] uppercase tracking-wider font-bold text-gray-500 dark:text-gray-400 mb-1">Type</legend>
              {TYPES.map(t => {
                const n = t.key === "all" ? facets.people : t.key === "seller" ? facets.sellers : t.key === "buyer" ? facets.buyers : t.key === "both" ? facets.both : facets.web
                return (
                  <label key={t.key} className="flex items-center gap-2.5 min-h-[36px] text-sm text-gray-800 dark:text-gray-100 cursor-pointer">
                    <input type="radio" name="type" className="w-[18px] h-[18px] accent-indigo-600" checked={filters.type === t.key} onChange={() => go({ type: t.key as TypeKey })} />
                    <span className="flex-1">{t.label}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">{n.toLocaleString()}</span>
                  </label>
                )
              })}
            </fieldset>
            {groups.map(g => (
              <fieldset key={g}>
                <legend className="text-[11px] uppercase tracking-wider font-bold text-gray-500 dark:text-gray-400 mb-1">{g}</legend>
                {TOGGLES.filter(t => t.group === g).map(t => {
                  const n = facetFor(t.facet)
                  const needsNotes = t.key === "notes" || t.key === "followUp"
                  return (
                    <label key={t.key} className={`flex items-center gap-2.5 min-h-[36px] text-sm cursor-pointer ${needsNotes && !notesReady ? "text-gray-400 dark:text-gray-500" : "text-gray-800 dark:text-gray-100"}`}>
                      <input type="checkbox" className="w-[18px] h-[18px] accent-indigo-600" checked={filters.toggles[t.key]} disabled={needsNotes && !notesReady}
                        onChange={e => setToggle(t.key, e.target.checked)} />
                      <span className="flex-1">{t.label}</span>
                      {n !== null && <span className={`text-xs tabular-nums ${"warn" in t && t.warn && n > 0 ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-gray-500 dark:text-gray-400"}`}>{n.toLocaleString()}</span>}
                    </label>
                  )
                })}
              </fieldset>
            ))}
            <fieldset>
              <legend className="text-[11px] uppercase tracking-wider font-bold text-gray-500 dark:text-gray-400 mb-1">Quick views</legend>
              {QUICK_VIEWS.map(v => (
                <Link key={v.key} href={quickViewHref(v)} className="block py-2 text-sm text-indigo-700 dark:text-indigo-300 hover:underline">{v.label}</Link>
              ))}
            </fieldset>
            {!notesReady && <p className="text-xs text-amber-700 dark:text-amber-300">Notes need Run Migrations before they can be filtered on.</p>}
          </aside>
        )}

        {/* Results */}
        <div className="flex-[1_1_560px] min-w-0 space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {total === 0
              ? (filters.q || active ? "Nobody matches those filters." : "No customers copied yet — an admin runs Copy from BC, or tonight's copy fills it.")
              : <><b className="text-gray-900 dark:text-white">{total.toLocaleString()} {total === 1 ? "person" : "people"}</b>{filters.q ? ` matching “${filters.q}”` : ""} · page {filters.page} of {pages}</>}
          </p>
          {rows.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800 text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="px-3 py-2">Customer</th><th className="px-3 py-2">No.</th><th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Phone</th><th className="px-3 py-2">Town / postcode</th>
                    <th className="px-3 py-2 text-right">Receipts</th><th className="px-3 py-2 text-right">Totes</th><th className="px-3 py-2 text-right">Lots (sold)</th>
                    <th className="px-3 py-2">Last activity</th><th className="px-3 py-2 text-right">Notes</th><th className="px-3 py-2"><span className="sr-only">Preview</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {rows.map(r => {
                    const la = lastActivity(r)
                    const sel = r.id === selectedId
                    const due = r.followUpAt && new Date(r.followUpAt).getTime() < Date.now() + 86_400_000
                    return (
                      <tr key={r.id} onClick={() => select(r.id)} aria-selected={sel}
                        className={`cursor-pointer ${sel ? "bg-indigo-50 dark:bg-indigo-950/40" : "hover:bg-gray-50 dark:hover:bg-white/5"}`}>
                        <td className="px-3 py-2">
                          <Link href={`/tools/customers/${r.id}`} onClick={e => e.stopPropagation()} className="font-semibold text-indigo-700 dark:text-indigo-300 hover:underline">{r.name || r.name2 || "(no name)"}</Link>
                          <div className={`text-xs ${r.email ? "text-gray-500 dark:text-gray-400" : "text-amber-600 dark:text-amber-400"}`}>{r.email ?? "No email address"}</div>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-800 dark:text-gray-200">
                          {(() => { const n = customerNumber(r); return (<>
                            {n.main ?? "—"}
                            {n.alsoSeller && <span className="block text-gray-500 dark:text-gray-400">also seller {n.alsoSeller}</span>}
                            {n.alsoBuyer && <span className="block text-gray-500 dark:text-gray-400">also buyer {n.alsoBuyer}</span>}
                            {n.odd && <span className="block text-amber-600 dark:text-amber-400 font-sans" title={`BC's contact no. is “${r.contactNo}” — fix it in BC`}>odd contact no. in BC</span>}
                          </>) })()}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap space-x-1">
                          {r.vendorNo && <span className={SELLER}>S</span>}{r.buyerNo && <span className={BUYER}>B</span>}{r.websiteId && <span className={WEB}>W</span>}{r.blocked && <span className={BLOCK} title={`Blocked: ${r.blocked}`}>!</span>}
                        </td>
                        <td className="px-3 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">{r.mobile || r.phone || "—"}</td>
                        <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{[r.city, r.postCode].filter(Boolean).join(", ") || "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-gray-800 dark:text-gray-200">{r.vendorNo ? r.receipts.toLocaleString() : <span className="text-gray-400">—</span>}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-gray-800 dark:text-gray-200">{r.vendorNo ? r.totes.toLocaleString() : <span className="text-gray-400">—</span>}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-gray-800 dark:text-gray-200 whitespace-nowrap">
                          {r.vendorNo ? <>{r.lots.toLocaleString()} <span className="text-gray-500 dark:text-gray-400">({r.sold.toLocaleString()})</span>{r.hubLots > 0 && <span className="block text-indigo-600 dark:text-indigo-300">+{r.hubLots} in the Hub</span>}</> : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-3 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                          {r.uncollected > 0 ? <span className="text-amber-600 dark:text-amber-400 font-semibold">Paid, not collected</span>
                            : due ? <span className="text-amber-600 dark:text-amber-400 font-semibold">Follow-up {shortDay(r.followUpAt)}</span>
                            : la ? <>{la.what} · <span className="text-gray-500 dark:text-gray-400">{la.when}</span></> : "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-gray-800 dark:text-gray-200">{r.notes > 0 ? r.notes : <span className="text-gray-400">—</span>}</td>
                        <td className="px-2 py-2 text-right">
                          <button type="button" onClick={e => { e.stopPropagation(); select(r.id); asideRef.current?.scrollIntoView({ block: "nearest" }) }}
                            aria-label={`Preview ${r.name ?? "this person"}`} className="min-w-[44px] min-h-[44px] rounded-lg text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-300 text-lg">›</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <div className="flex gap-2 items-center">
              {filters.page > 1 && <Link href={filtersToHref(filters, { page: filters.page - 1 })} className={btn}>← Previous</Link>}
              <span className="text-xs text-gray-500 dark:text-gray-400">Page {filters.page} of {pages}</span>
              {filters.page < pages && <Link href={filtersToHref(filters, { page: filters.page + 1 })} className={btn}>Next →</Link>}
            </div>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400">No. = the person&apos;s BC customer number, the same for selling and buying; a few people have a separate buyer or seller account, named underneath · S seller · B buyer · W website account · ! blocked in BC · receipts, totes and lots are from the Hub&apos;s own BC copies, plus lots catalogued in the Hub not yet in BC.</p>
        </div>

        {/* Preview */}
        {selected && (
          <aside ref={asideRef} aria-label="Selected customer" className="flex-[0_1_340px] min-w-[280px] rounded-xl border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-gray-900 p-4 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-gray-500 dark:text-gray-400">Selected</p>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white truncate">{selected.name || selected.name2 || "(no name)"}</h2>
                <p className="flex flex-wrap gap-1.5 items-center mt-1">
                  <span className="font-mono text-sm text-indigo-700 dark:text-indigo-300">{customerNumber(selected).main}</span>
                  {selected.vendorNo && <span className={SELLER}>Seller</span>}{selected.buyerNo && <span className={BUYER}>Buyer</span>}{selected.websiteId && <span className={WEB}>Website</span>}{selected.blocked && <span className={BLOCK}>Blocked</span>}
                </p>
              </div>
              <button type="button" onClick={() => setSelectedId(null)} aria-label="Close preview" className="min-w-[44px] min-h-[44px] rounded-lg text-gray-500 hover:text-gray-900 dark:hover:text-white text-xl">✕</button>
            </div>
            {selected.vendorNo && (
              <div className="grid grid-cols-3 gap-2">
                {[["Receipts", selected.receipts], ["Totes", selected.totes], ["Lots", selected.lots]].map(([l, v]) => (
                  <div key={String(l)} className="rounded-lg bg-gray-50 dark:bg-gray-800 p-2.5"><b className="block text-xl text-gray-900 dark:text-white">{Number(v).toLocaleString()}</b><span className="text-xs text-gray-500 dark:text-gray-400">{l}{l === "Lots" ? ` · ${selected.sold.toLocaleString()} sold` : ""}</span></div>
                ))}
              </div>
            )}
            <dl className="text-sm divide-y divide-gray-100 dark:divide-gray-800">
              {[["Email", selected.email], ["Phone", selected.mobile || selected.phone], ["Town", [selected.city, selected.postCode].filter(Boolean).join(", ")]].map(([k, v]) => v ? (
                <div key={String(k)} className="flex justify-between gap-3 py-1.5"><dt className="text-gray-500 dark:text-gray-400">{k}</dt><dd className="text-gray-900 dark:text-gray-100 text-right break-all">{v}</dd></div>
              ) : null)}
              <SummaryRows s={summary[selected.id]} />
            </dl>
            <SummaryNotes s={summary[selected.id]} />
            <div className="flex gap-2">
              <Link href={`/tools/customers/${selected.id}`} className="flex-1 min-h-[44px] inline-flex items-center justify-center rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold">Open</Link>
              <Link href={`/tools/customers/${selected.id}?tab=notes`} className={`flex-1 ${btn}`}>Add note</Link>
            </div>
            {isAdmin && selected.uncollected > 0 && <p className="text-xs text-amber-700 dark:text-amber-300">{selected.uncollected} paid, not collected {selected.uncollected === 1 ? "case" : "cases"} — <Link href="/tools/accounts/uncollected" className="underline">Accounts</Link></p>}
          </aside>
        )}
      </div>
    </div>
  )
}

function SummaryRows({ s }: { s: Summary | { error: string } | "loading" | undefined }) {
  if (!s || s === "loading") return <div className="py-1.5 text-xs text-gray-500 dark:text-gray-400">Reading…</div>
  if ("error" in s) return <div className="py-1.5 text-xs text-red-600 dark:text-red-400">Couldn&apos;t read the rest: {s.error}</div>
  const rows: [string, React.ReactNode][] = []
  if (s.address) rows.push(["Address", s.address])
  if (s.cardReady) {
    rows.push(["ID check", s.idStatus ? <span className={s.idStatus.toLowerCase() === "valid" ? "text-green-700 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}>{s.idStatus}{s.idChecked ? ` · ${day(s.idChecked)}` : ""}</span> : "—"])
    rows.push(["Approved", [s.approvedSell && "to sell", s.approvedBuy && "to buy"].filter(Boolean).join(" and ") || "Not yet"])
    if (s.highRisk) rows.push(["Risk", <span className="text-red-600 dark:text-red-400 font-semibold">High risk</span>])
  } else rows.push(["ID check", <span className="text-gray-500 dark:text-gray-400">BC card not copied yet</span>])
  if (s.since) rows.push(["In BC since", day(s.since)])
  return <>{rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3 py-1.5"><dt className="text-gray-500 dark:text-gray-400">{k}</dt><dd className="text-gray-900 dark:text-gray-100 text-right">{v}</dd></div>)}</>
}

function SummaryNotes({ s }: { s: Summary | { error: string } | "loading" | undefined }) {
  if (!s || s === "loading" || "error" in s) return null
  if (!s.notesReady) return <p className="text-xs text-amber-700 dark:text-amber-300">Notes need Run Migrations.</p>
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider font-bold text-gray-500 dark:text-gray-400 mb-1">Latest notes</p>
      {s.notes.length === 0 ? <p className="text-xs text-gray-500 dark:text-gray-400">No notes yet.</p> : (
        <div className="space-y-2">
          {s.notes.map(n => (
            <div key={n.id} className="rounded-lg bg-gray-50 dark:bg-gray-800 p-2.5 text-sm text-gray-800 dark:text-gray-200">
              <p className="text-xs text-gray-500 dark:text-gray-400">{day(n.createdAt)} · {KIND_LABEL[n.kind] ?? n.kind}{n.byName ? ` · ${n.byName}` : ""}{n.followUpAt && !n.followUpDone ? <span className="text-amber-600 dark:text-amber-400"> · follow up {day(n.followUpAt)}</span> : ""}</p>
              <p className="whitespace-pre-line line-clamp-3">{n.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
