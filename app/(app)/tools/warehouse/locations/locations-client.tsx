"use client"

import Link from "next/link"
import { useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { importLocationList, saveLocation } from "@/lib/actions/goods-in"
import { LOCATION_KINDS, normaliseCode, type LocationKind } from "@/lib/goods-in/model"
import { box, btn, btnGo, ErrorBox, input, label, mono, OkBox, PageHeader, td, th } from "../_components/ui"
import { useScanFocus } from "../_components/use-scan-focus"

// Goods In → Locations, the interactive part. A barcode scanner works in the search box: scan a
// location's label and press Enter (the scanner does) and that location is ticked for printing,
// ready for the next scan. Ticked locations print as 100 × 50 mm labels in a new tab.

export type LocationItem = { code: string; name: string | null; kind: LocationKind; active: boolean; totes: number; lots: number }

const MAX_LABELS = 500
const PAGE = 150
const CODE_RULE = /^[A-Z0-9][A-Z0-9\-/.]{0,23}$/

const KIND_TONE: Record<LocationKind, string> = {
  storage: "bg-sky-50 text-sky-800 border-sky-300 dark:bg-sky-950/50 dark:text-sky-200 dark:border-sky-800",
  bench: "bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800",
  shelf: "bg-teal-50 text-teal-800 border-teal-300 dark:bg-teal-950/50 dark:text-teal-200 dark:border-teal-800",
  other: "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600",
}
const KIND = Object.fromEntries(LOCATION_KINDS.map(k => [k.value, k])) as Record<LocationKind, (typeof LOCATION_KINDS)[number]>

function KindChip({ kind }: { kind: LocationKind }) {
  return <span title={KIND[kind].help} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${KIND_TONE[kind]}`}>{KIND[kind].label}</span>
}

function OffChip() {
  return <span title="Switched off — kept for its history; nothing new can be moved here." className="inline-flex items-center rounded-full border border-dashed border-gray-400 dark:border-gray-500 px-2 py-0.5 text-xs font-medium text-gray-500 dark:text-gray-300 whitespace-nowrap">Switched off</span>
}

const collator = new Intl.Collator("en-GB", { numeric: true, sensitivity: "base" })
const n = (x: number) => x.toLocaleString("en-GB")
const plural = (x: number, one: string, many: string) => `${n(x)} ${x === 1 ? one : many}`

type Form = { mode: "add" | "edit"; code: string; name: string; kind: LocationKind; active: boolean; wasActive: boolean; totes: number }

export default function LocationsClient({ rows, canEdit }: { rows: LocationItem[]; canEdit: boolean }) {
  const router = useRouter()
  const [kind, setKind] = useState<LocationKind | "all">("all")
  const [q, setQ] = useState("")
  const [hideOff, setHideOff] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [ticked, setTicked] = useState<Set<string>>(() => new Set())
  const [form, setForm] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [ok, setOk] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const printForm = useRef<HTMLFormElement>(null)
  const searchBox = useRef<HTMLInputElement>(null)
  const formTop = useRef<HTMLDivElement>(null)
  // After a tap on a tick box, a Label button or a link, a scanned location label still lands in the search box.
  useScanFocus(searchBox)

  const sorted = useMemo(() => [...rows].sort((a, b) => collator.compare(a.code, b.code)), [rows])
  const byCode = useMemo(() => new Map(rows.map(r => [r.code, r])), [rows])

  const kindCounts = useMemo(() => {
    const c: Record<string, number> = { all: 0 }
    for (const r of rows) if (!hideOff || r.active) { c.all++; c[r.kind] = (c[r.kind] ?? 0) + 1 }
    return c
  }, [rows, hideOff])

  const filtered = useMemo(() => {
    const code = normaliseCode(q)
    const words = q.trim().toLowerCase()
    return sorted.filter(r =>
      (kind === "all" || r.kind === kind) &&
      (!hideOff || r.active) &&
      (!words || r.code.includes(code) || (r.name ?? "").toLowerCase().includes(words)))
  }, [sorted, kind, hideOff, q])

  const shown = filtered.slice(0, limit)
  const allFilteredTicked = filtered.length > 0 && filtered.every(r => ticked.has(r.code))
  const offCount = rows.filter(r => !r.active).length

  const flash = (msg: string) => { setOk(msg); setError(null) }
  const toggle = (code: string) => setTicked(prev => {
    const next = new Set(prev)
    if (next.has(code)) next.delete(code); else next.add(code)
    return next
  })
  const tickAllFiltered = () => setTicked(prev => {
    const next = new Set(prev)
    if (allFilteredTicked) for (const r of filtered) next.delete(r.code)
    else for (const r of filtered) next.add(r.code)
    return next
  })

  // Enter in the search box — what a scanner sends after a location label's code.
  const onSearchEnter = () => {
    const code = normaliseCode(q)
    if (!code) return
    const hit = byCode.get(code)
    if (hit) {
      const already = ticked.has(code)
      const next = new Set(ticked); next.add(code)
      setTicked(next)
      flash(already ? `${code} was already ticked — ${plural(next.size, "location", "locations")} ticked for labels.` : `Ticked ${code} for labels — ${plural(next.size, "location", "locations")} ticked.`)
      setQ("")
      searchBox.current?.focus()
    } else if (filtered.length === 0) {
      setOk(null)
      setError(`There's no location ${code}.${canEdit ? " Add it with “Add a location” above." : " A manager can add it."}`)
    }
  }

  const printLabels = () => {
    if (ticked.size === 0 || ticked.size > MAX_LABELS) return
    printForm.current?.submit()
  }

  const openAdd = () => {
    const code = normaliseCode(q)
    setForm({ mode: "add", code: code && !byCode.has(code) ? code : "", name: "", kind: kind === "all" ? "storage" : kind, active: true, wasActive: true, totes: 0 })
    setFormError(null); setImportOpen(false)
    requestAnimationFrame(() => formTop.current?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }
  const openEdit = (r: LocationItem) => {
    setForm({ mode: "edit", code: r.code, name: r.name ?? "", kind: r.kind, active: r.active, wasActive: r.active, totes: r.totes })
    setFormError(null); setImportOpen(false)
    requestAnimationFrame(() => formTop.current?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }

  const save = async () => {
    if (!form) return
    const code = normaliseCode(form.code)
    if (!CODE_RULE.test(code)) { setFormError("A location code is letters and numbers (and - / .), up to 24 characters, with no spaces."); return }
    if (form.mode === "add" && byCode.has(code)) { setFormError(`${code} is already a location — find it in the list and press Edit instead.`); return }
    setSaving(true); setFormError(null)
    const res = await saveLocation({ code, name: form.name, kind: form.kind, active: form.active })
    setSaving(false)
    if (!res.ok) { setFormError(res.error); return }
    setForm(null)
    flash(form.mode === "add" ? `Added ${code} (${KIND[form.kind].label.toLowerCase()}).` : `Saved ${code}.`)
    router.refresh()
  }

  const runImport = async () => {
    setImporting(true); setError(null); setOk(null)
    const res = await importLocationList()
    setImporting(false)
    if (!res.ok) { setError(res.error); return }
    setImportOpen(false)
    const { added, already } = res.data
    if (added === 0) flash(`Nothing new to add — all ${plural(already, "location", "locations")} on the warehouse's list ${already === 1 ? "is" : "are"} already here.`)
    else flash(`Added ${plural(added, "location", "locations")}, ${n(already)} already here.`)
    router.refresh()
  }

  return (
    <div className="pb-24">
      <PageHeader
        title="Locations"
        back={{ href: "/tools/warehouse", label: "Goods In" }}
        intro={<>Every place a tote, pallet or lot can be. Tick locations to print their barcode labels — or scan a label into the search box to tick it.{canEdit ? " Managers add and change locations here." : ""}</>}
        actions={canEdit ? (
          <>
            <button type="button" className={btnGo} onClick={openAdd}>Add a location</button>
            <button type="button" className={btn} onClick={() => { setImportOpen(o => !o); setForm(null) }} aria-expanded={importOpen}>Import the warehouse&apos;s location list</button>
          </>
        ) : undefined}
      />

      <div className="space-y-4">
        {ok && <OkBox>{ok}</OkBox>}
        {error && <ErrorBox onDismiss={() => setError(null)}>{error}</ErrorBox>}

        {/* ── Import ── */}
        {canEdit && importOpen && (
          <div className={`${box} p-4 sm:p-5 space-y-3`}>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Import the warehouse&apos;s location list</h2>
            <ul className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed list-disc pl-5 space-y-1">
              <li>Adds every aisle, bay, shelf and bench code from the warehouse&apos;s own location list (the one already used on the shelves).</li>
              <li>Codes that start with BENCH come in as <b>benches</b>; everything else comes in as <b>storage</b>.</li>
              <li>Locations already here are left exactly as they are — their names, kinds and on/off setting don&apos;t change. Safe to press more than once.</li>
            </ul>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnGo} onClick={runImport} disabled={importing}>{importing ? "Importing the list — this takes a few seconds…" : "Import the list"}</button>
              <button type="button" className={btn} onClick={() => setImportOpen(false)} disabled={importing}>Cancel</button>
            </div>
          </div>
        )}

        {/* ── Add / edit ── */}
        <div ref={formTop} className="scroll-mt-4" />
        {canEdit && form && (
          <div className={`${box} p-4 sm:p-5 space-y-4`}>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">{form.mode === "add" ? "Add a location" : <>Change location <span className={mono}>{form.code}</span></>}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="loc-code" className={label}>Code (what the barcode says)</label>
                <input
                  id="loc-code"
                  className={`${input} ${mono} uppercase disabled:opacity-60`}
                  value={form.code}
                  disabled={form.mode === "edit"}
                  onChange={e => setForm({ ...form, code: e.target.value })}
                  placeholder="e.g. A10A1 or BENCH3"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus={form.mode === "add"}
                />
                {form.mode === "edit" && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">A code can&apos;t be changed — it&apos;s printed on the label. Add a new location instead.</p>}
              </div>
              <div>
                <label htmlFor="loc-name" className={label}>Name (optional)</label>
                <input id="loc-name" className={input} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Aisle 10, Bay A, Shelf 1" autoComplete="off" />
              </div>
            </div>
            <fieldset>
              <legend className={label}>Kind</legend>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {LOCATION_KINDS.map(k => (
                  <label key={k.value} className={`flex items-start gap-3 rounded-lg border px-3 py-3 min-h-11 cursor-pointer transition-colors ${form.kind === k.value ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40" : "border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                    <input type="radio" name="loc-kind" className="mt-1 h-5 w-5 accent-indigo-600" checked={form.kind === k.value} onChange={() => setForm({ ...form, kind: k.value })} />
                    <span>
                      <span className="block text-sm font-semibold text-gray-900 dark:text-white">{k.label}</span>
                      <span className="block text-xs text-gray-500 dark:text-gray-400 leading-snug">{k.help}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-start gap-3 min-h-11 cursor-pointer">
              <input type="checkbox" className="mt-1 h-5 w-5 accent-indigo-600" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />
              <span className="text-sm text-gray-800 dark:text-gray-200">
                In use
                <span className="block text-xs text-gray-500 dark:text-gray-400">Untick to switch it off: it stays for its history, but nothing new can be moved there.</span>
              </span>
            </label>
            {form.mode === "edit" && form.wasActive && !form.active && form.totes > 0 && (
              <p className="rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 px-3 py-2 text-sm">
                {plural(form.totes, "tote or pallet is", "totes and pallets are")} still recorded at {form.code}. Switching it off doesn&apos;t move them — move them somewhere else first if they&apos;re no longer there.
              </p>
            )}
            {formError && <ErrorBox>{formError}</ErrorBox>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnGo} onClick={save} disabled={saving || !form.code.trim()}>{saving ? "Saving…" : form.mode === "add" ? "Add location" : "Save changes"}</button>
              <button type="button" className={btn} onClick={() => { setForm(null); setFormError(null) }} disabled={saving}>Cancel</button>
            </div>
          </div>
        )}

        {/* ── Key ── */}
        <div className={`${box} px-4 py-3`}>
          <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">What the kinds mean</p>
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-5 text-xs text-gray-600 dark:text-gray-300">
            {LOCATION_KINDS.map(k => (
              <span key={k.value} className="flex items-start gap-2"><KindChip kind={k.value} /><span className="leading-snug">{k.help}</span></span>
            ))}
            <span className="flex items-start gap-2"><OffChip /><span className="leading-snug">Kept for its history; nothing new can be moved there.</span></span>
          </div>
        </div>

        {/* ── Filters ── */}
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by kind">
            {([{ value: "all", label: "All" }, ...LOCATION_KINDS] as { value: LocationKind | "all"; label: string }[]).map(k => (
              <button
                key={k.value}
                type="button"
                role="tab"
                aria-selected={kind === k.value}
                onClick={() => { setKind(k.value); setLimit(PAGE) }}
                className={`min-h-11 px-4 rounded-lg border text-sm font-medium transition-colors ${kind === k.value ? "border-indigo-500 bg-indigo-600 text-white" : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"}`}
              >
                {k.label} <span className={kind === k.value ? "text-indigo-100" : "text-gray-400 dark:text-gray-400"}>{n(kindCounts[k.value] ?? 0)}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="flex-1 min-w-0">
              <label htmlFor="loc-search" className="sr-only">Search or scan a location</label>
              <input
                id="loc-search"
                ref={searchBox}
                className={`${input} ${mono}`}
                value={q}
                onChange={e => { setQ(e.target.value); setLimit(PAGE); setError(null) }}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onSearchEnter() } }}
                placeholder="Search by code or name — or scan a location label"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                enterKeyHint="search"
              />
            </div>
            {offCount > 0 && (
              <label className="flex items-center gap-2 min-h-11 text-sm text-gray-700 dark:text-gray-200 cursor-pointer whitespace-nowrap">
                <input type="checkbox" className="h-5 w-5 accent-indigo-600" checked={hideOff} onChange={e => { setHideOff(e.target.checked); setLimit(PAGE) }} />
                Hide switched-off ({n(offCount)})
              </label>
            )}
          </div>
        </div>

        {/* ── The list ── */}
        {rows.length === 0 ? (
          <div className={`${box} px-6 py-10 text-center text-sm text-gray-500 dark:text-gray-400 space-y-2`}>
            <p className="font-semibold text-gray-700 dark:text-gray-200">No locations yet.</p>
            <p>{canEdit ? "Import the warehouse's location list to bring in every aisle, bay, shelf and bench code at once, or add them one by one." : "A Warehouse manager or admin adds them here."}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className={`${box} px-6 py-10 text-center text-sm text-gray-500 dark:text-gray-400`}>
            No {kind === "all" ? "" : `${KIND[kind].label.toLowerCase()} `}locations match {q.trim() ? <b className={mono}>{q.trim()}</b> : "these filters"}.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600 dark:text-gray-300">
              <span>Showing {n(shown.length)} of {plural(filtered.length, "location", "locations")}{filtered.length !== rows.length ? ` (${n(rows.length)} in all)` : ""}.</span>
              <button type="button" className={btn} onClick={tickAllFiltered}>
                {allFilteredTicked ? `Untick these ${n(filtered.length)}` : `Tick all ${n(filtered.length)}`}
              </button>
            </div>

            {/* Phones and small tablets: cards */}
            <ul className="md:hidden space-y-2">
              {shown.map(r => (
                <li key={r.code} className={`${box} p-3 ${ticked.has(r.code) ? "ring-2 ring-indigo-500" : ""} ${r.active ? "" : "opacity-70"}`}>
                  <div className="flex items-start gap-2">
                    <label className="flex items-center justify-center min-h-11 min-w-11 -m-1 cursor-pointer">
                      <input type="checkbox" className="h-6 w-6 accent-indigo-600" checked={ticked.has(r.code)} onChange={() => toggle(r.code)} aria-label={`Tick ${r.code} for labels`} />
                    </label>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`${mono} text-lg font-bold text-gray-900 dark:text-white`}>{r.code}</span>
                        <KindChip kind={r.kind} />
                        {!r.active && <OffChip />}
                      </div>
                      {r.name && <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">{r.name}</p>}
                      <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                        {r.totes > 0 ? <Link href={`/tools/warehouse/find?q=${encodeURIComponent(r.code)}`} className="text-indigo-700 dark:text-indigo-300 underline underline-offset-2">{plural(r.totes, "tote/pallet", "totes/pallets")} here</Link> : "No totes here"}
                        {r.lots > 0 && <> · {plural(r.lots, "lot", "lots")}</>}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2 pl-11">
                    <a href={`/api/goods-in/labels?locations=${encodeURIComponent(r.code)}`} target="_blank" rel="noopener" className={btn}>Label</a>
                    {canEdit && <button type="button" className={btn} onClick={() => openEdit(r)}>Edit</button>}
                  </div>
                </li>
              ))}
            </ul>

            {/* Tablets in landscape and desktops: a table */}
            <div className={`${box} hidden md:block overflow-x-auto`}>
              <table className="w-full">
                <thead className="border-b border-gray-200 dark:border-gray-800">
                  <tr>
                    <th className={`${th} w-12`}>
                      <label className="flex items-center justify-center min-h-11 min-w-11 cursor-pointer" title={allFilteredTicked ? "Untick all of these" : "Tick all of these"}>
                        <input type="checkbox" className="h-5 w-5 accent-indigo-600" checked={allFilteredTicked} onChange={tickAllFiltered} aria-label="Tick all locations in this list" />
                      </label>
                    </th>
                    <th className={th}>Code</th>
                    <th className={th}>Name</th>
                    <th className={th}>Kind</th>
                    <th className={`${th} text-right`}>Totes &amp; pallets here</th>
                    <th className={`${th} text-right`}>Lots here</th>
                    <th className={th}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {shown.map(r => (
                    <tr key={r.code} className={`${ticked.has(r.code) ? "bg-indigo-50 dark:bg-indigo-950/30" : "hover:bg-gray-50 dark:hover:bg-gray-800/50"} ${r.active ? "" : "opacity-70"}`}>
                      <td className={`${td} !py-0 align-middle`}>
                        <label className="flex items-center justify-center min-h-11 min-w-11 cursor-pointer">
                          <input type="checkbox" className="h-5 w-5 accent-indigo-600" checked={ticked.has(r.code)} onChange={() => toggle(r.code)} aria-label={`Tick ${r.code} for labels`} />
                        </label>
                      </td>
                      <td className={`${td} align-middle`}><span className={`${mono} font-bold text-gray-900 dark:text-white`}>{r.code}</span></td>
                      <td className={`${td} align-middle`}>{r.name ?? <span className="text-gray-500 dark:text-gray-400">—</span>}</td>
                      <td className={`${td} align-middle`}><span className="inline-flex flex-wrap gap-1.5"><KindChip kind={r.kind} />{!r.active && <OffChip />}</span></td>
                      <td className={`${td} align-middle text-right ${mono}`}>
                        {r.totes > 0 ? <Link href={`/tools/warehouse/find?q=${encodeURIComponent(r.code)}`} className="text-indigo-700 dark:text-indigo-300 underline underline-offset-2 font-semibold">{n(r.totes)}</Link> : <span className="text-gray-500 dark:text-gray-400">0</span>}
                      </td>
                      <td className={`${td} align-middle text-right ${mono}`}>{r.lots > 0 ? n(r.lots) : <span className="text-gray-500 dark:text-gray-400">0</span>}</td>
                      <td className={`${td} align-middle`}>
                        <div className="flex justify-end gap-2">
                          <a href={`/api/goods-in/labels?locations=${encodeURIComponent(r.code)}`} target="_blank" rel="noopener" className={btn}>Label</a>
                          {canEdit && <button type="button" className={btn} onClick={() => openEdit(r)}>Edit</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filtered.length > shown.length && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button type="button" className={btn} onClick={() => setLimit(l => l + PAGE)}>Show {n(Math.min(PAGE, filtered.length - shown.length))} more</button>
                <button type="button" className={btn} onClick={() => setLimit(filtered.length)}>Show all {n(filtered.length)}</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* The ticked locations go to the labels route as a form post, so a long list never makes the address too long. */}
      <form ref={printForm} method="post" action="/api/goods-in/labels" target="_blank" className="hidden">
        <input type="hidden" name="locations" value={[...ticked].join(",")} readOnly />
      </form>

      {/* ── What's ticked, always in reach ── */}
      {ticked.size > 0 && (
        <div className="sticky bottom-0 z-10 mt-4 -mx-4 sm:-mx-6 lg:-mx-8 border-t border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 backdrop-blur px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-gray-900 dark:text-white mr-auto">
              {plural(ticked.size, "location", "locations")} ticked
              {ticked.size > MAX_LABELS && <span className="block text-xs font-normal text-red-700 dark:text-red-300">Labels print {MAX_LABELS} at a time — untick {n(ticked.size - MAX_LABELS)}.</span>}
            </span>
            <button type="button" className={btnGo} onClick={printLabels} disabled={ticked.size > MAX_LABELS}>Print {ticked.size === 1 ? "label" : `${n(ticked.size)} labels`}</button>
            <button type="button" className={btn} onClick={() => setTicked(new Set())}>Untick all</button>
          </div>
        </div>
      )}
    </div>
  )
}
