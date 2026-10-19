"use client"

import { useMemo, useRef, useState, type FocusEvent, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { createLocations, type BulkProblem } from "@/lib/actions/goods-in-locations"
import { LOCATION_KINDS, type LocationKind } from "@/lib/goods-in/model"
import { compareCodes, expandRange, type NewLocation, type RangeSpec } from "@/lib/goods-in/location-codes"
import { box, btn, btnGo, ErrorBox, input, label, mono, OkBox } from "../_components/ui"
import { KIND, KindChip } from "./chips"

// Goods In → Locations → Add a range (managers). Makes a run of location codes in one go — a new
// aisle's shelves, more benches, a cabinet — from a pattern, shows exactly what it will make before
// anything is saved, and sends only the codes that aren't locations yet. An existing location is
// never changed: createLocations reports one as "already" and leaves it exactly as it is.
//
// Paste a list (./paste-list) shares the saving half below (useAddLocations, AddOutcome, the
// labels tab) so both panels add, print and report in the same words.

/** Labels print this many at a time — the labels route refuses more. */
export const MAX_LABELS = 500

const n = (x: number) => x.toLocaleString("en-GB")
export const plural = (x: number, one: string, many: string) => `${n(x)} ${x === 1 ? one : many}`

// ─── Saving, shared with Paste a list ───────────────────────────────────────────────────────

export type AddOutcome = {
  /** How many were added on the last press. */
  added: number
  /** What was added, for the green box and for onDone — null when nothing was. */
  message: string | null
  /** Said plainly when nothing was added, so it never reads as done. */
  nothingAdded: string | null
  problems: BulkProblem[]
}

type LabelsTab = { name: string; win: Window }

/**
 * Opens the labels tab NOW, while the tap still counts as the person's own: a tab opened after
 * waiting for the Hub to answer is blocked as a pop-up. It shows a holding line until the labels
 * are posted into it, and is closed again if nothing gets added.
 */
function openLabelsTab(): LabelsTab | null {
  const name = `goods-in-labels-${Math.random().toString(36).slice(2)}`
  let win: Window | null = null
  try { win = window.open("about:blank", name) } catch { win = null }
  if (!win) return null
  try {
    const d = win.document
    d.title = "Location labels"
    d.body.style.cssText = "font: 16px/1.5 system-ui, sans-serif; padding: 24px; color-scheme: light dark"
    d.body.textContent = "Adding the locations — their labels will appear here in a moment…"
  } catch { /* only a holding message */ }
  return { name, win }
}

function closeTab(tab: LabelsTab | null) {
  try { tab?.win.close() } catch { /* already gone */ }
}

/** Posts the codes to the labels route into the tab opened for them (a form, so a long list never makes the address too long). */
function postLabels(codes: string[], target: string) {
  const form = document.createElement("form")
  form.method = "post"
  form.action = "/api/goods-in/labels"
  form.target = target
  form.hidden = true
  const field = document.createElement("input")
  field.type = "hidden"
  field.name = "locations"
  field.value = codes.join(",")
  form.append(field)
  document.body.append(form)
  form.submit()
  setTimeout(() => form.remove(), 1000)
}

function describeAdded(codes: string[], how: "range" | "list") {
  if (codes.length === 1) return `Added ${codes[0]}.`
  if (how === "range") return `Added ${n(codes.length)} locations, ${codes[0]} to ${codes[codes.length - 1]}.`
  if (codes.length <= 6) return `Added ${n(codes.length)} locations: ${codes.slice(0, -1).join(", ")} and ${codes[codes.length - 1]}.`
  return `Added ${n(codes.length)} locations: ${codes.slice(0, 5).join(", ")} and ${n(codes.length - 5)} more.`
}

const leftAsTheyAre = (k: number) =>
  k === 1 ? "1 was already there and was left as it is." : `${n(k)} were already there and were left as they are.`

/**
 * The saving half of Add a range and Paste a list. `add` sends only NEW rows to createLocations.
 * All added with no problems → onDone(message) and the panel closes. Otherwise the panel stays
 * open with what happened — what was added (with a Done button that passes the message on), the
 * locations the Hub refused and why, or a plain "nothing was added".
 */
export function useAddLocations(onDone: (message: string) => void, onBusyChange?: (busy: boolean) => void) {
  const router = useRouter()
  const busy = useRef(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<AddOutcome | null>(null)
  /** Codes this panel has just added (or found already there), so its preview stops offering them before the list behind has refreshed. */
  const [justAdded, setJustAdded] = useState<ReadonlySet<string>>(() => new Set())

  const add = async (rows: NewLocation[], o: { alreadyBefore: number; describe: "range" | "list"; printLabels: boolean }) => {
    if (busy.current || rows.length === 0) return
    busy.current = true
    const tab = o.printLabels && rows.length <= MAX_LABELS ? openLabelsTab() : null
    setSaving(true); setError(null); setOutcome(null)
    // The list keeps this panel open (Escape and the header buttons do nothing) until the answer is in,
    // so what was refused — or that nothing was added — is never lost with the panel.
    onBusyChange?.(true)
    let res: Awaited<ReturnType<typeof createLocations>>
    try {
      res = await createLocations(rows.map(r => ({ code: r.code, name: r.name, kind: r.kind })))
    } catch {
      res = { ok: false, error: "The Hub didn't answer — check the connection and press Add again. Any that did get added will be left as they are." }
    }
    busy.current = false
    setSaving(false)
    onBusyChange?.(false)
    if (!res.ok) { closeTab(tab); setError(res.error); return }

    const { added, already, problems } = res.data
    const addedSet = new Set(added)
    let ordered = rows.map(r => r.code).filter(c => addedSet.has(c))
    if (ordered.length !== added.length) ordered = [...added].sort(compareCodes)
    const alreadyTotal = o.alreadyBefore + already.length

    let message = ""
    let printed = false
    if (added.length > 0) {
      message = describeAdded(ordered, o.describe)
      if (alreadyTotal > 0) message += ` ${leftAsTheyAre(alreadyTotal)}`
      if (o.printLabels) {
        if (rows.length > MAX_LABELS) message += ` Their labels weren't printed — no more than ${MAX_LABELS} print at once, so tick them in the list and print them in batches.`
        else if (!tab) message += " The browser blocked the labels tab — tick them in the list and press Print labels."
        else if (tab.win.closed) message += " The labels tab was closed before they were ready — tick them in the list and press Print labels."
        else { postLabels(ordered, tab.name); printed = true; message += " Their labels are opening in a new tab." }
      }
    }
    if (!printed) closeTab(tab)

    if (added.length > 0 && problems.length === 0) { onDone(message); return }

    // Something needs reading before the panel closes: refused locations, or nothing added at all.
    if (added.length > 0 || already.length > 0) {
      setJustAdded(prev => new Set([...prev, ...added, ...already]))
      router.refresh()
    }
    let nothingAdded: string | null = null
    if (added.length === 0) {
      if (problems.length > 0 && already.length > 0) nothingAdded = `Nothing was added. ${leftAsTheyAre(already.length)} The rest couldn't be added — the reasons are below.`
      else if (problems.length > 0) nothingAdded = "Nothing was added — the reasons are below."
      else if (already.length > 0) nothingAdded = `Nothing was added — every one of them is already a location (someone may have added them a moment ago). ${already.length === 1 ? "It was left as it is." : "They were left as they are."}`
      else nothingAdded = "Nothing was added."
    }
    setOutcome({ added: added.length, message: added.length > 0 ? message : null, nothingAdded, problems })
  }

  /** The Done button after a partly-successful add: pass on what was added and close. */
  const finish = () => { if (outcome?.message) onDone(outcome.message) }

  return { saving, error, setError, outcome, justAdded, add, finish }
}

/** What the last press did, when the panel stays open to show it. */
export function AddOutcomeView({ outcome }: { outcome: AddOutcome }) {
  const [all, setAll] = useState(false)
  const SHOW = 20
  const problems = all ? outcome.problems : outcome.problems.slice(0, SHOW)
  return (
    <div className="space-y-3">
      {outcome.message && <OkBox>{outcome.message}</OkBox>}
      {outcome.nothingAdded && <Notice>{outcome.nothingAdded}</Notice>}
      {outcome.problems.length > 0 && (
        <div role="alert" className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200 px-4 py-3 text-sm space-y-2">
          <p className="font-semibold">{plural(outcome.problems.length, "location wasn't", "locations weren't")} added:</p>
          <ul className="space-y-1">
            {problems.map((p, i) => (
              <li key={`${i}-${p.code}`} className="break-words">{p.code && <><span className={`${mono} font-semibold`}>{p.code}</span> — </>}{p.reason}</li>
            ))}
          </ul>
          {outcome.problems.length > SHOW && (
            <button type="button" className="min-h-11 text-sm underline underline-offset-2" onClick={() => setAll(a => !a)}>
              {all ? "Show fewer" : `Show all ${n(outcome.problems.length)}`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function Notice({ children }: { children: ReactNode }) {
  return <div role="status" className="rounded-lg border border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 px-4 py-3 text-sm">{children}</div>
}

/** The "Print their labels now" tick, shared by both panels. */
export function PrintLabelsTick({ checked, onChange, count }: { checked: boolean; onChange: (v: boolean) => void; count: number }) {
  return (
    <label className="flex items-start gap-3 min-h-11 cursor-pointer">
      <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-indigo-600" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="text-sm text-gray-800 dark:text-gray-200">
        Print their labels now
        <span className="block text-xs text-gray-500 dark:text-gray-400 leading-snug">
          {count > MAX_LABELS
            ? `That's more than the ${MAX_LABELS} labels that print at once, so they won't print now — tick them in the list afterwards and print them in batches.`
            : "Once they're added, a 100 × 50 mm label for each new location opens in a new tab."}
        </span>
      </span>
    </label>
  )
}

// ─── Add a range ────────────────────────────────────────────────────────────────────────────

type Pattern = RangeSpec["pattern"]

const PATTERNS: { value: Pattern; label: string; example: string }[] = [
  { value: "aisle", label: "Aisle shelves", example: "A70A1 … A70F6" },
  { value: "bench", label: "Benches", example: "BENCH65 … BENCH70" },
  { value: "cabinet", label: "Cabinet shelves", example: "CAB7A … CAB7E" },
  { value: "custom", label: "Something else", example: "BAY01 … BAY20" },
]

const PADS: { value: number; label: string }[] = [
  { value: 0, label: "No — 1, 2 … 10" },
  { value: 2, label: "2 digits — 01, 02 … 10" },
  { value: 3, label: "3 digits — 001, 002 …" },
  { value: 4, label: "4 digits — 0001, 0002 …" },
  { value: 5, label: "5 digits — 00001 …" },
  { value: 6, label: "6 digits — 000001 …" },
]

type Fields = {
  aisleFrom: string; aisleTo: string; bayFrom: string; bayTo: string; shelfFrom: string; shelfTo: string
  benchFrom: string; benchTo: string
  cabFrom: string; cabTo: string; cabShelfFrom: string; cabShelfTo: string
  prefix: string; numFrom: string; numTo: string; pad: number; namePrefix: string
}

const START: Fields = {
  aisleFrom: "", aisleTo: "", bayFrom: "A", bayTo: "", shelfFrom: "1", shelfTo: "",
  benchFrom: "", benchTo: "",
  cabFrom: "", cabTo: "", cabShelfFrom: "A", cabShelfTo: "",
  prefix: "", numFrom: "1", numTo: "", pad: 0, namePrefix: "",
}

const num = (s: string) => (s.trim() === "" ? Number.NaN : Number(s))
/** An empty "to" box means just the one. */
const orSame = (to: string, from: string) => (to.trim() === "" ? from : to)
const digitsOnly = (v: string, max: number) => v.replace(/\D/g, "").slice(0, max)
/** One letter; typing another letter into a box that has one replaces it. */
const oneLetter = (v: string, prev: string) => {
  const l = v.replace(/[^a-z]/gi, "").toUpperCase()
  return l.length > 1 ? (l.replace(prev, "") || l).slice(-1) : l
}

/** The range the boxes describe, or null while a box it needs is still empty. */
function specFor(p: Pattern, f: Fields, kind: LocationKind): RangeSpec | null {
  switch (p) {
    case "aisle":
      if (!f.aisleFrom || !f.bayFrom || !f.shelfFrom) return null
      return {
        pattern: "aisle",
        aisleFrom: num(f.aisleFrom), aisleTo: num(orSame(f.aisleTo, f.aisleFrom)),
        bayFrom: f.bayFrom, bayTo: orSame(f.bayTo, f.bayFrom),
        shelfFrom: num(f.shelfFrom), shelfTo: num(orSame(f.shelfTo, f.shelfFrom)),
        kind,
      }
    case "bench":
      if (!f.benchFrom) return null
      return { pattern: "bench", from: num(f.benchFrom), to: num(orSame(f.benchTo, f.benchFrom)) }
    case "cabinet":
      if (!f.cabFrom || !f.cabShelfFrom) return null
      return {
        pattern: "cabinet",
        cabinetFrom: num(f.cabFrom), cabinetTo: num(orSame(f.cabTo, f.cabFrom)),
        shelfFrom: f.cabShelfFrom, shelfTo: orSame(f.cabShelfTo, f.cabShelfFrom),
        kind,
      }
    case "custom":
      if (!f.prefix || !f.numFrom) return null
      return { pattern: "custom", prefix: f.prefix, from: num(f.numFrom), to: num(orSame(f.numTo, f.numFrom)), pad: f.pad, namePrefix: f.namePrefix, kind }
  }
}

const HEAD = 12
const TAIL = 3

export default function AddRange({ existing, onDone, onCancel, onBusyChange }: {
  existing: ReadonlySet<string>
  onDone: (message: string) => void
  onCancel: () => void
  /** Saving started (true) or finished (false) — the list holds the panel open meanwhile. */
  onBusyChange?: (busy: boolean) => void
}) {
  const [pattern, setPattern] = useState<Pattern>("aisle")
  const [f, setF] = useState<Fields>(START)
  const [kind, setKind] = useState<LocationKind>("storage")
  const [printLabels, setPrintLabels] = useState(false)
  const { saving, error, setError, outcome, justAdded, add, finish } = useAddLocations(onDone, onBusyChange)

  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => setF(prev => ({ ...prev, [k]: v }))

  const preview = useMemo(() => {
    const spec = specFor(pattern, f, kind)
    if (!spec) return { state: "blank" as const }
    const r = expandRange(spec)
    if (!r.ok) return { state: "error" as const, error: r.error }
    const already = new Set(r.rows.filter(x => existing.has(x.code) || justAdded.has(x.code)).map(x => x.code))
    const fresh = r.rows.filter(x => !already.has(x.code))
    const long = r.rows.length > HEAD + TAIL + 1
    return {
      state: "ok" as const,
      rows: r.rows,
      fresh,
      already,
      head: long ? r.rows.slice(0, HEAD) : r.rows,
      gap: long ? r.rows.length - HEAD - TAIL : 0,
      tail: long ? r.rows.slice(-TAIL) : [],
    }
  }, [pattern, f, kind, existing, justAdded])

  const fresh = preview.state === "ok" ? preview.fresh : []

  const submit = () => {
    if (preview.state !== "ok" || preview.fresh.length === 0) return
    void add(preview.fresh, { alreadyBefore: preview.already.size, describe: "range", printLabels })
  }

  return (
    <div className={`${box} p-4 sm:p-5 space-y-4`}>
      <div>
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">Add a range of locations</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
          Makes a run of codes in one go. Codes that are already locations are left exactly as they are. Leave a &ldquo;to&rdquo; box empty for just one.
        </p>
      </div>

      <fieldset disabled={saving} className="min-w-0 space-y-4">
        <div>
          <p className={label} id="range-what">What to add</p>
          <div role="radiogroup" aria-labelledby="range-what" className="grid gap-2 grid-cols-2 lg:grid-cols-4">
            {PATTERNS.map(p => (
              <label key={p.value} className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 min-h-11 cursor-pointer transition-colors ${pattern === p.value ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40" : "border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                <input type="radio" name="range-pattern" className="mt-1 h-5 w-5 shrink-0 accent-indigo-600" checked={pattern === p.value} onChange={() => setPattern(p.value)} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-gray-900 dark:text-white">{p.label}</span>
                  <span className={`block text-xs text-gray-500 dark:text-gray-400 ${mono} break-words`}>{p.example}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {pattern === "aisle" && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Pair legend="Aisles" from={f.aisleFrom} to={f.aisleTo} onFrom={v => set("aisleFrom", digitsOnly(v, 3))} onTo={v => set("aisleTo", digitsOnly(v, 3))} example="70" />
            <Pair legend="Bays" letters from={f.bayFrom} to={f.bayTo} onFrom={v => set("bayFrom", oneLetter(v, f.bayFrom))} onTo={v => set("bayTo", oneLetter(v, f.bayTo))} example="A" />
            <Pair legend="Shelves" from={f.shelfFrom} to={f.shelfTo} onFrom={v => set("shelfFrom", digitsOnly(v, 2))} onTo={v => set("shelfTo", digitsOnly(v, 2))} example="1" />
          </div>
        )}

        {pattern === "bench" && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Pair legend="Bench numbers" from={f.benchFrom} to={f.benchTo} onFrom={v => set("benchFrom", digitsOnly(v, 4))} onTo={v => set("benchTo", digitsOnly(v, 4))} example="65" />
            <p className="sm:col-span-2 self-end text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
              Made as <KindChip kind="bench" /> locations, named Bench 65, Bench 66 and so on.
            </p>
          </div>
        )}

        {pattern === "cabinet" && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Pair legend="Cabinets" from={f.cabFrom} to={f.cabTo} onFrom={v => set("cabFrom", digitsOnly(v, 3))} onTo={v => set("cabTo", digitsOnly(v, 3))} example="7" />
            <Pair legend="Shelves" letters from={f.cabShelfFrom} to={f.cabShelfTo} onFrom={v => set("cabShelfFrom", oneLetter(v, f.cabShelfFrom))} onTo={v => set("cabShelfTo", oneLetter(v, f.cabShelfTo))} example="A" />
          </div>
        )}

        {pattern === "custom" && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0">
              <label htmlFor="range-prefix" className={label}>Start of the code</label>
              <input
                id="range-prefix"
                className={`${input} ${mono} uppercase`}
                value={f.prefix}
                onChange={e => set("prefix", e.target.value.replace(/\s+/g, "").toUpperCase().slice(0, 23))}
                placeholder="e.g. BAY"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <Pair legend="Numbers" from={f.numFrom} to={f.numTo} onFrom={v => set("numFrom", digitsOnly(v, 9))} onTo={v => set("numTo", digitsOnly(v, 9))} example="1" />
            <div className="min-w-0">
              <label htmlFor="range-pad" className={label}>Put noughts in front?</label>
              <select id="range-pad" className={input} value={f.pad} onChange={e => set("pad", Number(e.target.value))}>
                {PADS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div className="min-w-0">
              <label htmlFor="range-name" className={label}>Start of the name (optional)</label>
              <input id="range-name" className={input} value={f.namePrefix} onChange={e => set("namePrefix", e.target.value.slice(0, 100))} placeholder="e.g. Bay" autoComplete="off" />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">&ldquo;Bay&rdquo; names them Bay 1, Bay 2… Leave it empty for no name.</p>
            </div>
          </div>
        )}

        {pattern !== "bench" && (
          <div className="sm:max-w-sm">
            <label htmlFor="range-kind" className={label}>Kind</label>
            <select id="range-kind" className={input} value={kind} onChange={e => setKind(e.target.value as LocationKind)}>
              {LOCATION_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-snug">{KIND[kind].help}</p>
          </div>
        )}

        {/* ── What it makes ── */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 p-3 sm:p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">What this adds</h3>
          <div aria-live="polite">
            {preview.state === "blank" && <p className="text-sm text-gray-500 dark:text-gray-400">Fill in the boxes above to see the locations this makes.</p>}
            {preview.state === "error" && <p className="text-sm font-medium text-red-700 dark:text-red-300">{preview.error}</p>}
            {preview.state === "ok" && (
              <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
                This makes <b>{plural(preview.rows.length, "location", "locations")}</b> — kind <KindChip kind={preview.rows[0]?.kind ?? kind} />.
                {preview.already.size > 0 && preview.fresh.length > 0 && (
                  <> <b>{n(preview.already.size)}</b> {preview.already.size === 1 ? "is already a location and will be left exactly as it is" : "are already locations and will be left exactly as they are"}, so <b>{n(preview.fresh.length)}</b> will be added.</>
                )}
                {preview.fresh.length === 0 && <> {preview.rows.length === 1 ? "It is already a location" : "All of them are already locations"} — there&apos;s nothing to add.</>}
              </p>
            )}
          </div>
          {preview.state === "ok" && (
            <ol className="divide-y divide-gray-200 dark:divide-gray-800 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm">
              {preview.head.map(r => <SampleRow key={r.code} row={r} already={preview.already.has(r.code)} />)}
              {preview.gap > 0 && <li className="px-3 py-2 text-center text-gray-500 dark:text-gray-400">… {n(preview.gap)} more …</li>}
              {preview.tail.map(r => <SampleRow key={r.code} row={r} already={preview.already.has(r.code)} />)}
            </ol>
          )}
        </div>

        <PrintLabelsTick checked={printLabels} onChange={setPrintLabels} count={fresh.length} />
      </fieldset>

      {outcome && <AddOutcomeView outcome={outcome} />}
      {error && <ErrorBox onDismiss={() => setError(null)}>{error}</ErrorBox>}

      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnGo} onClick={submit} disabled={saving || fresh.length === 0}>
          {saving ? `Adding ${plural(fresh.length, "location", "locations")} — a few seconds…` : fresh.length > 0 ? `Add ${plural(fresh.length, "location", "locations")}` : "Add locations"}
        </button>
        {outcome?.message
          ? <button type="button" className={btn} onClick={finish} disabled={saving}>Done</button>
          : <button type="button" className={btn} onClick={onCancel} disabled={saving}>Cancel</button>}
      </div>
    </div>
  )
}

function SampleRow({ row, already }: { row: NewLocation; already: boolean }) {
  return (
    <li className={`flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 ${already ? "opacity-70" : ""}`}>
      <span className={`${mono} font-bold text-gray-900 dark:text-white`}>{row.code}</span>
      <span className="min-w-0 break-words text-gray-600 dark:text-gray-300">{row.name ?? <span className="text-gray-500 dark:text-gray-400">No name</span>}</span>
      {already && <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">Already here — left as it is</span>}
    </li>
  )
}

/** A from–to pair of boxes: numbers, or single letters. */
function Pair({ legend, from, to, onFrom, onTo, letters = false, example }: {
  legend: string; from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void; letters?: boolean; example: string
}) {
  const common = {
    className: `${input} ${mono} text-center`,
    autoComplete: "off",
    spellCheck: false,
    ...(letters
      ? { inputMode: "text" as const, autoCapitalize: "characters", onFocus: (e: FocusEvent<HTMLInputElement>) => e.currentTarget.select() }
      : { inputMode: "numeric" as const, pattern: "[0-9]*" }),
  }
  return (
    <fieldset className="min-w-0">
      <legend className={label}>{legend}</legend>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <input {...common} aria-label={`${legend}: first`} value={from} onChange={e => onFrom(e.target.value)} placeholder={`e.g. ${example}`} />
        <span className="text-sm text-gray-500 dark:text-gray-400">to</span>
        <input {...common} aria-label={`${legend}: last (empty for just one)`} value={to} onChange={e => onTo(e.target.value)} placeholder={from || "same"} />
      </div>
    </fieldset>
  )
}
