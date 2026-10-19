"use client"

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { importLocationList } from "@/lib/actions/goods-in"
import { createLocations, removeLocations, setLocationsActive, updateLocation } from "@/lib/actions/goods-in-locations"
import { LOCATION_KINDS, normaliseCode, type LocationKind } from "@/lib/goods-in/model"
import { LOCATION_CODE_HELP, LOCATION_CODE_RULE } from "@/lib/goods-in/location-codes"
import { box, btn, btnGo, ErrorBox, input, label, mono, OkBox, PageHeader } from "../_components/ui"
import { useScanFocus } from "../_components/use-scan-focus"
import AddRange from "./add-range"
import BulkBar from "./bulk-bar"
import { KIND, KindChip, OffChip } from "./chips"
import { downloadLocationsCsv } from "./export"
import FilterBar from "./filter-bar"
import {
  DEFAULT_FILTERS, LIST_QUERY_KEY, TICKED_KEY, clearedFilters, computeFacets, filterChips, filtersToQuery, goodsWords, makeMatcher, n, plural, readFilters, sortRows, tidyFilters, toRows,
  type Filters, type LocationItem, type Row,
} from "./filters"
import LocationRows from "./location-rows"
import { OutcomePanel, removeOutcome, type Outcome } from "./outcome"
import PasteList from "./paste-list"

// Goods In → Locations, the interactive part. Filter the list (every filter is kept in the
// address, so Back, a refresh and a shared link keep them), tick locations to print their labels,
// export them, move everything at them somewhere else, or — managers — switch them off or on,
// change their kind or names, or remove them. A barcode scanner works in the search box: scan a
// location's label and press Enter (the scanner does) and that location is ticked, ready for the
// next scan. Shift-click ticks a run of rows.

export type { LocationItem } from "./filters"

const PAGE = 150
const SEND_FAILED = "The change couldn't be sent — check the connection and try again."

type Form = {
  mode: "add" | "edit"; code: string; name: string; kind: LocationKind; active: boolean
  /** What the location was when Edit was pressed — only what changes from it is saved. */
  origName: string | null; origKind: LocationKind; wasActive: boolean
  totes: number; lots: number
}
type Panel = "form" | "range" | "paste" | "import"

// Ticks are kept for the tab in sessionStorage (a convenience, so a look at one location and Back
// keeps them). Read through useSyncExternalStore: the server can't see them, so the first render
// matches the server's (nothing ticked) and React fills them in straight after — no mismatch.
const noSubscribe = () => () => {}
const storedTicks = () => { try { return sessionStorage.getItem(TICKED_KEY) } catch { return null } }
const noStoredTicks = () => null
function parseTicks(raw: string | null): Set<string> {
  try {
    const list: unknown = JSON.parse(raw ?? "[]")
    return new Set(Array.isArray(list) ? list.filter((c): c is string => typeof c === "string") : [])
  } catch {
    return new Set()
  }
}

const sameApartFromSearch = (a: Filters, b: Filters) =>
  (Object.keys(a) as (keyof Filters)[]).every(k => k === "q" || a[k] === b[k])

export default function LocationsClient({ rows: items, canEdit, asOf }: { rows: LocationItem[]; canEdit: boolean; asOf: number }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlQuery = searchParams.toString()

  const [filters, setFilters] = useState<Filters>(() => readFilters(searchParams))
  const [seenQuery, setSeenQuery] = useState(urlQuery)
  const [pendingQueries, setPendingQueries] = useState<string[]>([])
  const [limit, setLimit] = useState(PAGE)
  const stored = useSyncExternalStore(noSubscribe, storedTicks, noStoredTicks)
  const restored = useMemo(() => parseTicks(stored), [stored])
  /** null until someone ticks or unticks here — until then the ticks are the ones kept from before. */
  const [chosen, setChosen] = useState<Set<string> | null>(null)
  const ticked = chosen ?? restored
  const setTicked = (update: Set<string> | ((prev: Set<string>) => Set<string>)) =>
    setChosen(prev => (typeof update === "function" ? update(prev ?? restored) : update))
  const [tickedOnly, setTickedOnly] = useState(false)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  // A location's page sends a manager back here after deleting it, with ?removed=CODE. Said only if
  // CODE really is gone, so a link can't make the screen claim something it didn't do.
  const [ok, setOk] = useState<string | null>(() => {
    const gone = normaliseCode(searchParams.get("removed") ?? "")
    return gone && LOCATION_CODE_RULE.test(gone) && !items.some(i => i.code === gone) ? `Deleted ${gone}.` : null
  })
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [confirmCode, setConfirmCode] = useState<string | null>(null)
  const [busyCode, setBusyCode] = useState<string | null>(null)
  /** Add a range or Paste a list is saving — its panel must stay open to show the answer. */
  const [toolBusy, setToolBusy] = useState(false)
  /** A bulk change is running — the ticks it is working on hold still. */
  const [bulkBusy, setBulkBusy] = useState(false)
  const searchBox = useRef<HTMLInputElement>(null)
  const panelTop = useRef<HTMLDivElement>(null)
  /** The last tick box pressed, for shift-click ranges. */
  const anchor = useRef<string | null>(null)
  const lastFilters = useRef<Filters | null>(null)
  // After a tap on a tick box, a Label button or a link, a scanned location label still lands in the search box.
  useScanFocus(searchBox)

  useEffect(() => {
    if (!chosen) return
    try { sessionStorage.setItem(TICKED_KEY, JSON.stringify([...chosen])) } catch { /* a convenience only */ }
  }, [chosen])

  // The address changed under us — a link to this page with other filters, or the sidebar's
  // Locations link — so take its filters. Our own writes (below) come back through here too;
  // those are expected and skipped, so typing is never undone by a late echo of itself.
  if (urlQuery !== seenQuery) {
    setSeenQuery(urlQuery)
    const i = pendingQueries.indexOf(urlQuery)
    if (i >= 0) setPendingQueries(pendingQueries.slice(i + 1))
    else if (urlQuery !== filtersToQuery(filters)) { setFilters(readFilters(new URLSearchParams(urlQuery))); setLimit(PAGE) }
  }

  // Keep the address in step with the filters: a choice is written straight away (so Back always
  // has it); typing in the search box a moment after the last key, so it isn't rewritten per key.
  useEffect(() => {
    const query = filtersToQuery(filters)
    const prev = lastFilters.current
    lastFilters.current = filters
    const typing = prev !== null && prev.q !== filters.q && sameApartFromSearch(prev, filters)
    const t = window.setTimeout(() => {
      try { sessionStorage.setItem(LIST_QUERY_KEY, query) } catch { /* a convenience only */ }
      if (new URLSearchParams(window.location.search).toString() === query) return
      setPendingQueries(p => [...p.slice(-9), query])
      window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname)
    }, typing ? 250 : 0)
    return () => window.clearTimeout(t)
  }, [filters])

  // Each code is read once per load; everything below works on these.
  const all = useMemo(() => toRows(items), [items])
  const byCode = useMemo(() => new Map(all.map(r => [r.code, r])), [all])
  const codesSet = useMemo<ReadonlySet<string>>(() => new Set(all.map(r => r.code)), [all])
  const filtered = useMemo(() => {
    const m = makeMatcher(filters, asOf)
    return sortRows(all.filter(r => m(r)), filters.sort)
  }, [all, filters, asOf])
  const facets = useMemo(() => computeFacets(all, filters, asOf), [all, filters, asOf])
  // Only codes that still exist count as ticked — a removed one simply drops out.
  const tickedRows = useMemo(() => all.filter(r => ticked.has(r.code)), [all, ticked])
  const hiddenTicked = useMemo(() => {
    const inList = new Set(filtered.map(r => r.code))
    return tickedRows.filter(r => !inList.has(r.code)).length
  }, [filtered, tickedRows])
  // "Show the ticked ones only" sets the filters aside (all but the search box, so a scan still
  // works); it ends by itself when nothing is ticked.
  const showTicked = tickedOnly && tickedRows.length > 0
  const visible = useMemo(() => {
    if (!showTicked) return filtered
    const m = makeMatcher({ ...DEFAULT_FILTERS, status: "all", q: filters.q }, asOf)
    return sortRows(tickedRows.filter(r => m(r)), filters.sort)
  }, [showTicked, tickedRows, filtered, filters.q, filters.sort, asOf])
  const allVisibleTicked = visible.length > 0 && visible.every(r => ticked.has(r.code))

  const shown = visible.slice(0, limit)
  const hiddenOff = filters.status === "on" ? facets.status.off : 0
  const anyFilters = filterChips(filters).length > 0

  const flash = (msg: string) => { setOk(msg); setError(null) }

  const changeFilters = (patch: Partial<Filters>) => {
    setFilters(f => tidyFilters({ ...f, ...patch }))
    setLimit(PAGE)
    setConfirmCode(null)
    // Choosing a filter means "show me the filtered list" again; the search box doesn't.
    if (Object.keys(patch).some(k => k !== "q")) setTickedOnly(false)
    // A new search clears the last message, so an old "Ticked …" never sits beside a new scan.
    if ("q" in patch) { setError(null); setOk(null) }
  }

  const toggle = (code: string, range: boolean) => {
    if (bulkBusy) return
    const from = anchor.current
    anchor.current = code
    const on = !ticked.has(code)
    let codes = [code]
    if (range && from && from !== code) {
      const a = shown.findIndex(r => r.code === from)
      const b = shown.findIndex(r => r.code === code)
      if (a >= 0 && b >= 0) codes = shown.slice(Math.min(a, b), Math.max(a, b) + 1).map(r => r.code)
    }
    setTicked(prev => {
      const next = new Set(prev)
      for (const c of codes) { if (on) next.add(c); else next.delete(c) }
      return next
    })
  }
  const tickAllVisible = () => {
    if (bulkBusy) return
    setTicked(prev => {
      const next = new Set(prev)
      if (allVisibleTicked) for (const r of visible) next.delete(r.code)
      else for (const r of visible) next.add(r.code)
      return next
    })
  }
  const untick = (codes: string[]) => {
    if (!codes.length) return
    setTicked(prev => {
      const next = new Set(prev)
      for (const c of codes) next.delete(c)
      return next
    })
  }

  /** The filters that keep a location out of the list, in words — or "" if it would be shown. */
  const whyHidden = (r: Row): string => {
    const base = { ...filters, q: "" }
    if (makeMatcher(base, asOf)(r)) return ""
    // "In use" is the default, so it has no chip — but it is what hides a switched-off location.
    const chips = [...filterChips(base), ...(base.status === "on" ? [{ label: "in use only", clear: { status: "all" as const } }] : [])]
    const culprits = chips.filter(c => makeMatcher(tidyFilters({ ...base, ...c.clear }), asOf)(r)).map(c => c.label)
    return culprits.length ? culprits.join(", ") : "the filters together"
  }

  // Enter in the search box — what a scanner sends after a location label's code.
  const onSearchEnter = () => {
    const code = normaliseCode(filters.q)
    if (!code) return
    const hit = byCode.get(code)
    if (hit) {
      if (bulkBusy) { setOk(null); setError("Wait for the change at the foot of the screen to finish, then scan again."); return }
      const already = ticked.has(code)
      const next = new Set(ticked); next.add(code)
      setTicked(next)
      anchor.current = code
      const count = [...next].filter(c => byCode.has(c)).length
      const why = showTicked ? "" : whyHidden(hit)
      changeFilters({ q: "" })
      flash(`${already ? `${code} was already ticked` : `Ticked ${code}`} — ${plural(count, "location", "locations")} ticked.${why ? ` It isn't in the list as it's filtered (${why}), but it is ticked.` : ""}`)
      searchBox.current?.focus()
    } else {
      // Never leave an earlier "Ticked …" showing when this scan found nothing.
      setOk(null)
      const near = visible.length
      setError(`There's no location ${code}.${near ? ` ${plural(near, "code contains", "codes contain")} it — ${near === 1 ? "it's" : "they're"} listed below.` : ""}${canEdit ? " Add it with “Add a location” above." : " A manager can add it."}`)
    }
  }

  // ── The panels under the heading: one open at a time, Escape closes it ──

  const openPanel = (p: Panel) => {
    if (toolBusy) return
    setPanel(p); setFormError(null); setError(null); setConfirmCode(null)
    requestAnimationFrame(() => panelTop.current?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }
  const closePanel = () => { setPanel(null); setForm(null); setFormError(null) }
  const togglePanel = (p: Exclude<Panel, "form">) => {
    if (toolBusy) return
    if (panel === p) closePanel(); else openPanel(p)
  }

  const openAdd = () => {
    if (toolBusy) return
    if (panel === "form" && form?.mode === "add") { closePanel(); return }
    const code = normaliseCode(filters.q)
    const kind = filters.kind === "all" ? "storage" : filters.kind
    setForm({ mode: "add", code: code && !byCode.has(code) ? code : "", name: "", kind, active: true, origName: null, origKind: kind, wasActive: true, totes: 0, lots: 0 })
    openPanel("form")
  }
  const openEdit = (r: Row) => {
    if (toolBusy) return
    setForm({ mode: "edit", code: r.code, name: r.name ?? "", kind: r.kind, active: r.active, origName: r.name, origKind: r.kind, wasActive: r.active, totes: r.totes, lots: r.lots })
    openPanel("form")
  }

  useEffect(() => {
    if (!panel && !confirmCode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (confirmCode) { if (!busyCode) setConfirmCode(null); return }
      if (!saving && !importing && !toolBusy) { setPanel(null); setForm(null); setFormError(null) }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [panel, confirmCode, busyCode, saving, importing, toolBusy])

  // Add makes a NEW location only (createLocations never changes one that exists), and Edit writes
  // only what was changed (updateLocation never brings back one that was removed meanwhile) — so a
  // stale screen can't undo another manager's work.
  const addOne = async (code: string, f: Form) => {
    const res = await createLocations([{ code, name: f.name, kind: f.kind }])
    if (!res.ok) { setFormError(res.error); return }
    const { added, already, problems } = res.data
    if (problems.length) { setFormError(problems[0].reason); return }
    if (!added.length) {
      closePanel()
      flash(`${already[0] ?? code} was added by someone else a moment ago — it's in the list now, left exactly as they made it.`)
      router.refresh()
      return
    }
    let msg = `Added ${code} (${KIND[f.kind].label.toLowerCase()}).`
    if (!f.active) {
      try {
        const off = await setLocationsActive([code], false)
        msg += off.ok ? " It's switched off, as asked." : ` It couldn't be switched off just now (${off.error}) — press Edit to try again.`
      } catch {
        msg += " It couldn't be switched off just now — press Edit to try again."
      }
    }
    closePanel()
    flash(msg)
    router.refresh()
  }

  const editOne = async (code: string, f: Form) => {
    const patch: { name?: string | null; kind?: LocationKind; active?: boolean } = {}
    const name = f.name.trim() || null
    if (name !== (f.origName ?? null)) patch.name = name
    if (f.kind !== f.origKind) patch.kind = f.kind
    if (f.active !== f.wasActive) patch.active = f.active
    if (Object.keys(patch).length === 0) { closePanel(); flash(`Nothing was changed — ${code} is as it was.`); return }
    const res = await updateLocation({ code, ...patch })
    if (!res.ok) { setFormError(res.error); return }
    closePanel()
    if (!res.data.found) {
      setOk(null)
      setError(`${code} no longer exists — someone may have just removed it. Nothing was saved.`)
    } else {
      flash(`Saved ${code}.`)
    }
    router.refresh()
  }

  const save = async () => {
    if (!form) return
    const code = normaliseCode(form.code)
    if (!LOCATION_CODE_RULE.test(code)) { setFormError(LOCATION_CODE_HELP); return }
    if (form.mode === "add" && byCode.has(code)) { setFormError(`${code} is already a location — find it in the list and press Edit instead.`); return }
    setSaving(true); setFormError(null)
    try {
      if (form.mode === "add") await addOne(code, form)
      else await editOne(code, form)
    } catch {
      setFormError(SEND_FAILED)
    } finally {
      setSaving(false)
    }
  }

  const runImport = async () => {
    setImporting(true); setError(null); setOk(null)
    try {
      const res = await importLocationList()
      if (!res.ok) { setError(res.error); return }
      closePanel()
      const { added, already } = res.data
      if (added === 0) flash(`Nothing new to add — all ${plural(already, "location", "locations")} on the warehouse's list ${already === 1 ? "is" : "are"} already here.`)
      else flash(`Added ${plural(added, "location", "locations")}, ${n(already)} already here.`)
      router.refresh()
    } catch {
      setError(SEND_FAILED)
    } finally {
      setImporting(false)
    }
  }

  // Add a range / Paste a list finished.
  const onToolDone = (message: string) => { setToolBusy(false); closePanel(); flash(message); router.refresh() }

  // ── Changes, from a row or from the bar at the foot ──

  const removeOne = async (r: Row) => {
    setBusyCode(r.code)
    try {
      const res = await removeLocations([r.code])
      setConfirmCode(null)
      if (!res.ok) { setOutcome({ tone: "error", lines: [res.error] }); return }
      setOutcome(removeOutcome(res.data, new Set(r.active ? [] : [r.code])))
      untick([...res.data.removed, ...res.data.missing])
      router.refresh()
    } catch {
      setOutcome({ tone: "error", lines: [SEND_FAILED] })
    } finally {
      setBusyCode(null)
    }
  }

  const onBulkResult = (o: Outcome, gone: string[]) => {
    setOutcome(o)
    untick(gone)
    if (o.tone !== "error") router.refresh()
  }

  const typedCode = normaliseCode(filters.q)
  const headerBusy = toolBusy || saving || importing

  return (
    <div className="pb-24">
      <PageHeader
        title="Locations"
        back={{ href: "/tools/warehouse", label: "Goods In" }}
        intro={<>Every place a tote, pallet or lot can be. Filter the list, tick locations to print their labels, export them or move everything at them — or scan a label into the search box to tick it. Tap a code to see what&apos;s there and its moves.{canEdit ? " Managers add, change, switch off and remove locations here." : ""}</>}
        actions={canEdit ? (
          <>
            <button type="button" className={btnGo} onClick={openAdd} disabled={headerBusy} aria-expanded={panel === "form" && form?.mode === "add"}>Add a location</button>
            <button type="button" className={btn} onClick={() => togglePanel("range")} disabled={headerBusy} aria-expanded={panel === "range"}>Add a range</button>
            <button type="button" className={btn} onClick={() => togglePanel("paste")} disabled={headerBusy} aria-expanded={panel === "paste"}>Paste a list</button>
            <button type="button" className={btn} onClick={() => togglePanel("import")} disabled={headerBusy} aria-expanded={panel === "import"}>Import the warehouse&apos;s list</button>
          </>
        ) : undefined}
      />

      <div className="space-y-4">
        {ok && <OkBox>{ok}</OkBox>}
        {error && <ErrorBox onDismiss={() => setError(null)}>{error}</ErrorBox>}

        <div ref={panelTop} className="scroll-mt-4" />

        {/* ── Import ── */}
        {canEdit && panel === "import" && (
          <div className={`${box} p-4 sm:p-5 space-y-3`}>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Import the warehouse&apos;s location list</h2>
            <ul className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed list-disc pl-5 space-y-1">
              <li>Adds every aisle, bay, shelf and bench code from the warehouse&apos;s own location list (the one already used on the shelves).</li>
              <li>Codes that start with BENCH come in as <b>benches</b>; everything else comes in as <b>storage</b>.</li>
              <li>Locations already here are left exactly as they are — their names, kinds and on/off setting don&apos;t change. Safe to press more than once.</li>
            </ul>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnGo} onClick={runImport} disabled={importing}>{importing ? "Importing the list — this takes a few seconds…" : "Import the list"}</button>
              <button type="button" className={btn} onClick={closePanel} disabled={importing}>Cancel</button>
            </div>
          </div>
        )}

        {/* ── Add / edit one ── */}
        {canEdit && panel === "form" && form && (
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
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void save() } }}
                  placeholder="e.g. A10A1 or BENCH3"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus={form.mode === "add"}
                />
                {form.mode === "edit" && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">A code can&apos;t be changed — it&apos;s printed on the label. Open the location and use &ldquo;Replace with a new code&rdquo; instead.</p>}
              </div>
              <div>
                <label htmlFor="loc-name" className={label}>Name (optional)</label>
                <input id="loc-name" className={input} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Aisle 10, Bay A, Shelf 1" autoComplete="off" maxLength={120} />
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
            {form.mode === "edit" && form.wasActive && !form.active && (form.totes > 0 || form.lots > 0) && (
              <p className="rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 px-3 py-2 text-sm">
                {goodsWords(form.totes, form.lots)} {form.totes + form.lots === 1 ? "is" : "are"} still recorded at {form.code}. Switching it off doesn&apos;t move them — move them somewhere else first if they&apos;re no longer there.
              </p>
            )}
            {form.mode === "edit" && form.kind !== form.origKind && form.totes > 0 && (
              <p className="text-sm text-gray-600 dark:text-gray-300">The {plural(form.totes, "tote or pallet", "totes and pallets")} already there keep their status — it follows the new kind the next time they&apos;re moved.</p>
            )}
            {formError && <ErrorBox>{formError}</ErrorBox>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnGo} onClick={save} disabled={saving || !form.code.trim()}>{saving ? "Saving…" : form.mode === "add" ? "Add location" : "Save changes"}</button>
              <button type="button" className={btn} onClick={closePanel} disabled={saving}>Cancel</button>
            </div>
          </div>
        )}

        {/* ── Add a range / Paste a list ── */}
        {canEdit && panel === "range" && <AddRange existing={codesSet} onDone={onToolDone} onCancel={closePanel} onBusyChange={setToolBusy} />}
        {canEdit && panel === "paste" && <PasteList existing={codesSet} onDone={onToolDone} onCancel={closePanel} onBusyChange={setToolBusy} />}

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
        <FilterBar
          filters={filters}
          facets={facets}
          onChange={changeFilters}
          onClearAll={() => changeFilters(clearedFilters(filters))}
          searchRef={searchBox}
          onSearchEnter={onSearchEnter}
        />

        {/* ── The list ── */}
        {all.length === 0 ? (
          <div className={`${box} px-6 py-10 text-center text-sm text-gray-500 dark:text-gray-400 space-y-2`}>
            <p className="font-semibold text-gray-700 dark:text-gray-200">No locations yet.</p>
            <p>{canEdit ? "Import the warehouse's location list to bring in every aisle, bay, shelf and bench code at once — or add a range, paste a list, or add them one by one." : "A Warehouse manager or admin adds them here."}</p>
          </div>
        ) : visible.length === 0 ? (
          <div className={`${box} px-6 py-10 text-center text-sm text-gray-500 dark:text-gray-400 space-y-3`}>
            <p>No locations match {filters.q.trim() && filterChips(filters).length === 1 ? <b className={mono}>{filters.q.trim()}</b> : "these filters"}.</p>
            {hiddenOff > 0 && <p>{plural(hiddenOff, "switched-off location matches", "switched-off locations match")}, but the list shows locations in use only.</p>}
            <div className="flex flex-wrap justify-center gap-2">
              {hiddenOff > 0 && <button type="button" className={btn} onClick={() => changeFilters({ status: "all" })}>Show switched-off ones too</button>}
              {anyFilters && <button type="button" className={btn} onClick={() => changeFilters(clearedFilters(filters))}>Clear all filters</button>}
              {tickedRows.length > 0 && <button type="button" className={btn} onClick={() => setTickedOnly(true)}>Show the {plural(tickedRows.length, "ticked location", "ticked locations")}</button>}
              {canEdit && typedCode && LOCATION_CODE_RULE.test(typedCode) && !byCode.has(typedCode) && <button type="button" className={btnGo} onClick={openAdd}>Add {typedCode}</button>}
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              {showTicked ? (
                <span className="mr-auto min-w-0">
                  Showing the {plural(visible.length, "ticked location", "ticked locations")} only — the filters are set aside.{" "}
                  <button type="button" className="inline-flex items-center min-h-11 underline underline-offset-2 text-indigo-700 dark:text-indigo-300" onClick={() => setTickedOnly(false)}>Back to the filtered list</button>
                </span>
              ) : (
                <span className="mr-auto min-w-0">
                  Showing {n(shown.length)} of {plural(visible.length, "location", "locations")}{visible.length !== all.length ? ` (${n(all.length)} in all)` : ""}.
                  {hiddenOff > 0 && (
                    <> {plural(hiddenOff, "switched-off one isn't", "switched-off ones aren't")} shown —{" "}
                      <button type="button" className="inline-flex items-center min-h-11 underline underline-offset-2 text-indigo-700 dark:text-indigo-300" onClick={() => changeFilters({ status: "all" })}>show {hiddenOff === 1 ? "it" : "them"} too</button>.
                    </>
                  )}
                </span>
              )}
              {!showTicked && tickedRows.length > 0 && (
                <button type="button" className={btn} onClick={() => setTickedOnly(true)}>Show ticked only</button>
              )}
              <button type="button" className={btn} onClick={tickAllVisible} disabled={bulkBusy}>
                {allVisibleTicked ? `Untick these ${n(visible.length)}` : `Tick all ${n(visible.length)}`}
              </button>
              <button type="button" className={btn} onClick={() => downloadLocationsCsv(visible)}>Export {visible.length === all.length ? "all" : `these ${n(visible.length)}`} to CSV</button>
            </div>
            <p className="hidden md:block text-xs text-gray-500 dark:text-gray-400 -mt-2">Tip: hold Shift and click a tick box to tick everything between it and the one ticked before.</p>

            <LocationRows
              rows={shown}
              ticked={ticked}
              onToggle={toggle}
              allTicked={allVisibleTicked}
              onTickAll={tickAllVisible}
              canEdit={canEdit}
              onEdit={openEdit}
              confirmCode={confirmCode}
              busyCode={busyCode}
              onAskRemove={code => { if (!busyCode) setConfirmCode(code) }}
              onRemove={removeOne}
            />

            {visible.length > shown.length && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button type="button" className={btn} onClick={() => setLimit(l => l + PAGE)}>Show {n(Math.min(PAGE, visible.length - shown.length))} more</button>
                <button type="button" className={btn} onClick={() => setLimit(visible.length)}>Show all {n(visible.length)}</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── What a change did, and what's ticked — always in reach at the foot, never taller than the screen ── */}
      {(outcome || tickedRows.length > 0) && (
        <div className="sticky bottom-0 z-20 mt-4 -mx-4 sm:-mx-6 lg:-mx-8 max-h-[85dvh] overflow-y-auto overscroll-contain border-t border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 backdrop-blur px-4 sm:px-6 lg:px-8 py-3 space-y-3">
          {outcome && <OutcomePanel outcome={outcome} onDismiss={() => setOutcome(null)} />}
          {tickedRows.length > 0 && (
            <BulkBar
              rows={tickedRows}
              hidden={hiddenTicked}
              tickedOnly={showTicked}
              onToggleTickedOnly={() => setTickedOnly(t => !t)}
              canEdit={canEdit}
              lookup={code => byCode.get(normaliseCode(code))}
              onUntickAll={() => { setTicked(new Set()); setTickedOnly(false) }}
              onResult={onBulkResult}
              onPanelOpen={() => setOutcome(null)}
              onBusyChange={setBulkBusy}
            />
          )}
        </div>
      )}
    </div>
  )
}
