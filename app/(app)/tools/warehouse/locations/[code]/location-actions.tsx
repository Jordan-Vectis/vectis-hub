"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import type { Result } from "@/lib/actions/goods-in"
import { createLocations, goodsAtLocations, moveEverything, removeLocations, setLocationsActive, updateLocation } from "@/lib/actions/goods-in-locations"
import { LOCATION_KINDS, normaliseCode, type LocationKind } from "@/lib/goods-in/model"
import { LOCATION_CODE_HELP, LOCATION_CODE_RULE, defaultLocationName } from "@/lib/goods-in/location-codes"
import { ErrorBox, OkBox, btn, btnDanger, btnGo, input, label, mono } from "../../_components/ui"
import { useScanFocus } from "../../_components/use-scan-focus"
import { plural } from "../../move/words"
import { KIND } from "../chips"
import { downloadGoodsHereCsv } from "../export"
import { LIST_QUERY_KEY } from "../filters"
import CheckHere, { type Expected } from "./check-here"
import { MoveEverythingPanel, MovedSummary, goodsWordsFor, locationHref, type Moved } from "./move-everything"

// The buttons on a location's own page, and the panels they open — one panel at a time, Escape
// closes it. Everyone: print the label, move things here, move EVERYTHING here to another location,
// check what is really on the shelf, and export what is here. Managers: change the name or kind
// (updateLocation — only what changed is written, and a location removed meanwhile is never brought
// back), switch it off or on (setLocationsActive), replace its code, and remove it (removeLocations
// — deleted if it has never been used, switched off if it has, refused while goods are still here;
// the panel says which BEFORE the press).
//
// ⚠ Confirmation is in the page, never window.confirm — a modal is easy to dismiss by accident on
// an iPad and blocks the page. Every action returns { ok, error }; a network failure is caught too,
// so a press never ends in silence (RULES design rule 7).

type Panel = "move" | "check" | "edit" | "off" | "remove" | "replace" | null
type Replaced = { from: string; to: string; steps: string[]; problem: string | null; oldGone: boolean }

const LIST = "/tools/warehouse/locations"
const dangerSolid = "inline-flex items-center justify-center min-h-11 px-5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold disabled:opacity-40"
const warnPanel = "rounded-xl border border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 p-4 space-y-3"
const plainPanel = "rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 p-4 space-y-3"
const GONE = (code: string) => `${code} no longer exists — someone may have just removed it. Nothing was changed.`

export default function LocationActions({ code, name, kind, active, totes, lots, everUsed, moveCount, canEdit, defaultName, expected }: {
  code: string
  name: string | null
  kind: LocationKind
  active: boolean
  /** Totes and pallets here now (not returned). */
  totes: number
  /** Lots whose latest move is to here. */
  lots: number
  /** Anything ever moved in or out, or any tote — even a returned one — recorded here. */
  everUsed: boolean
  moveCount: number
  canEdit: boolean
  /** The usual name for this code ("Aisle 10, Bay A, Shelf 1"), or null for a named area. */
  defaultName: string | null
  /** What is recorded here now, as the page loaded it — for "Check what's here". */
  expected: Expected[]
}) {
  const router = useRouter()
  const [panel, setPanel] = useState<Panel>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [moved, setMoved] = useState<Moved | null>(null)
  const [replaced, setReplaced] = useState<Replaced | null>(null)
  const [editName, setEditName] = useState(name ?? "")
  const [editKind, setEditKind] = useState<LocationKind>(kind)
  const [newCode, setNewCode] = useState("")
  const [newName, setNewName] = useState("")
  const [newKind, setNewKind] = useState<LocationKind>(kind)
  const [nameTouched, setNameTouched] = useState(false)
  // The move and check panels' scan boxes: a scanned label lands there even after a tap elsewhere.
  const scanBox = useRef<HTMLInputElement>(null)
  useScanFocus(scanBox)

  const hasGoods = totes > 0 || lots > 0
  const goodsWords = goodsWordsFor(totes, lots)
  const usedWords = moveCount > 0 ? `${plural(moveCount, "move")} in and out` : "totes or pallets have been recorded here"

  // Escape closes the open panel (not while something is saving).
  useEffect(() => {
    if (!panel) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) setPanel(null) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [panel, busy])

  const open = (p: Exclude<Panel, null>) => {
    if (busy) return
    setError(null); setOk(null); setMoved(null); setReplaced(null)
    if (p === "edit") { setEditName(name ?? ""); setEditKind(kind) }
    if (p === "replace") { setNewCode(""); setNewName(name ?? ""); setNewKind(kind); setNameTouched(false) }
    setPanel(p)
  }

  /** Run a server action: busy while it runs, its error (or a lost connection) shown, the data back on success. */
  async function attempt<T>(key: string, fn: () => Promise<Result<T>>): Promise<{ data: T } | null> {
    setBusy(key); setError(null); setOk(null)
    try {
      const res = await fn()
      if (!res.ok) { setError(res.error); return null }
      return { data: res.data }
    } catch {
      setError("The Hub couldn't be reached — check the connection and try again. Nothing was changed.")
      return null
    } finally {
      setBusy(null)
    }
  }

  // ── Name and kind: only what changed is written ──
  const saveEdit = async () => {
    const patch: { name?: string | null; kind?: LocationKind } = {}
    const nm = editName.trim() || null
    if (nm !== (name ?? null)) patch.name = nm
    if (editKind !== kind) patch.kind = editKind
    if (Object.keys(patch).length === 0) { setPanel(null); setOk(`Nothing was changed — ${code} is as it was.`); return }
    const r = await attempt("edit", () => updateLocation({ code, ...patch }))
    if (!r) return
    setPanel(null)
    if (!r.data.found) setError(GONE(code)); else setOk(`Saved ${code}.`)
    router.refresh()
  }

  // ── Switch off / on: only the on/off setting is written ──
  const setActive = async (on: boolean) => {
    const r = await attempt(on ? "on" : "off", () => setLocationsActive([code], on))
    if (!r) return
    setPanel(null)
    if (r.data.missing.includes(code)) { setError(GONE(code)); router.refresh(); return }
    const still = r.data.withGoods.find(g => g.code === code)
    setOk(on
      ? `${code} is switched on again — things can be moved here.`
      : `${code} is switched off. It stays for its history, and nothing new can be moved here.${still ? ` The ${goodsWordsFor(still.totes, still.lots)} recorded here haven't moved.` : ""}`)
    router.refresh()
  }

  // ── Remove ──
  const runRemove = async () => {
    const r = await attempt("remove", () => removeLocations([code]))
    if (!r) return
    const { removed, switchedOff, blocked } = r.data
    setPanel(null)
    if (removed.includes(code)) {
      setOk(`Deleted ${code}. Taking you back to Locations…`)
      // Back to the list as it was last filtered in this tab, which says it was deleted.
      let query = ""
      try { query = sessionStorage.getItem(LIST_QUERY_KEY) ?? "" } catch { /* a convenience only */ }
      const sp = new URLSearchParams(query)
      sp.set("removed", code)
      router.replace(`${LIST}?${sp.toString()}`)
      return
    }
    if (switchedOff.includes(code)) {
      setOk(`${code} has been used before, so it was switched off rather than deleted. It stays for its history, and nothing new can be moved here.`)
    } else {
      setError(blocked.find(b => b.code === code)?.reason ?? blocked[0]?.reason ?? `${code} wasn't removed.`)
    }
    router.refresh()
  }

  // ── Export what's here ──
  const exportHere = async () => {
    const r = await attempt("export", () => goodsAtLocations([code]))
    if (!r) return
    if (r.data.rows.length === 0) { setError(`Nothing is at ${code} right now, so no file was made.`); return }
    downloadGoodsHereCsv(r.data.rows, [code])
    setOk(`Saved a spreadsheet of the ${plural(r.data.rows.length, "tote, pallet or lot", "totes, pallets and lots")} at ${code}.${r.data.truncated ? " There were more than 20,000 of one kind, so the file stops there." : ""}`)
  }

  // ── Replace with a new code: add it, move everything over, remove this one ──
  const replaceTo = normaliseCode(newCode)
  const replaceProblem = !replaceTo ? null : !LOCATION_CODE_RULE.test(replaceTo) ? LOCATION_CODE_HELP : replaceTo === code ? `That's ${code} itself — type the new code.` : null
  const onNewCode = (v: string) => {
    setNewCode(v)
    // Keep the name in step with the code while it is still the usual one for the old code.
    const usualNow = defaultLocationName(normaliseCode(v))
    if (!nameTouched && (!name || name === defaultName)) setNewName(usualNow ?? name ?? "")
  }
  const runReplace = async () => {
    if (!replaceTo || replaceProblem || busy) return
    setBusy("replace"); setError(null); setOk(null)
    const steps: string[] = []
    let problem: string | null = null
    let oldGone = false
    try {
      const made = await createLocations([{ code: replaceTo, name: newName, kind: newKind }])
      if (!made.ok) throw new Error(made.error)
      if (made.data.problems.length) throw new Error(made.data.problems[0].reason)
      if (!made.data.added.length) throw new Error(`${replaceTo} is already a location, so nothing was changed. To put everything from ${code} there, use “Move everything here to…” instead.`)
      steps.push(`Added ${replaceTo} (${KIND[newKind].label.toLowerCase()}${newName.trim() ? `, “${newName.trim()}”` : ""}).`)

      const mv = await moveEverything(code, replaceTo, `Replaced by ${replaceTo}`)
      if (mv.ok) steps.push(`Moved ${goodsWordsFor(mv.data.totes.length, mv.data.lots)} from ${code} to ${replaceTo}, each one recorded.`)
      else if (mv.error.startsWith("There's nothing at ")) steps.push(`Nothing was at ${code}, so nothing needed moving.`)
      else { problem = `Moving the goods from ${code} didn't work: ${mv.error} ${code} has been left as it is — try “Move everything here to…” with ${replaceTo}.`; return }

      const rm = await removeLocations([code])
      if (!rm.ok) { problem = `Removing ${code} didn't work: ${rm.error}`; return }
      if (rm.data.removed.includes(code)) { steps.push(`Deleted ${code} — it had never been used.`); oldGone = true }
      else if (rm.data.switchedOff.includes(code)) steps.push(`Switched ${code} off — it has been used, so it stays for its history.`)
      else problem = `${code} wasn't removed: ${rm.data.blocked.find(b => b.code === code)?.reason ?? "the Hub didn't say why."}`
    } catch (e) {
      problem = e instanceof Error && e.message && !/fetch|network/i.test(e.message) ? e.message : "The Hub couldn't be reached — check the connection. What was done before that is listed."
    } finally {
      setBusy(null)
      if (steps.length || problem) {
        setPanel(steps.length ? null : "replace")
        if (!steps.length && problem) setError(problem)
        else setReplaced({ from: code, to: replaceTo, steps, problem, oldGone })
        // A deleted location's page has nothing left to show — the summary below links on instead.
        if (steps.length && !oldGone) router.refresh()
      }
    }
  }

  // What Remove will do, worked out from what this page knows — the server checks again.
  const removeOutcome: "refused" | "delete" | "switch-off" | "already-off" = hasGoods ? "refused" : !everUsed ? "delete" : active ? "switch-off" : "already-off"

  // Replaced and deleted: there is nothing left here to act on — only the summary and where to go next.
  if (replaced?.oldGone) {
    return (
      <div className="border-t border-gray-200 dark:border-gray-800 pt-4 space-y-3">
        <ReplacedSummary r={replaced} />
      </div>
    )
  }

  return (
    <div className="border-t border-gray-200 dark:border-gray-800 pt-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        <a href={`/api/goods-in/labels?locations=${encodeURIComponent(code)}`} target="_blank" rel="noopener" className={btn}>Print label</a>
        {active && <Link href={`/tools/warehouse/move?to=${encodeURIComponent(code)}`} className={btn}>Move things here</Link>}
        {hasGoods && (
          <button type="button" className={btnGo} disabled={!!busy} onClick={() => open("move")} aria-expanded={panel === "move"}>
            Move everything here to…
          </button>
        )}
        <button type="button" className={btn} disabled={!!busy} onClick={() => open("check")} aria-expanded={panel === "check"}>Check what&apos;s here</button>
        {hasGoods && (
          <button type="button" className={btn} disabled={!!busy} onClick={() => void exportHere()}>{busy === "export" ? "Reading what's here…" : "Export what's here"}</button>
        )}
        {canEdit && (
          <>
            <button type="button" className={btn} disabled={!!busy} onClick={() => open("edit")} aria-expanded={panel === "edit"}>Change name or kind</button>
            {active ? (
              <button type="button" className={btn} disabled={!!busy} onClick={() => (hasGoods ? open("off") : void setActive(false))}>
                {busy === "off" ? "Switching off…" : "Switch off"}
              </button>
            ) : (
              <button type="button" className={btn} disabled={!!busy} onClick={() => void setActive(true)}>
                {busy === "on" ? "Switching on…" : "Switch on"}
              </button>
            )}
            <button type="button" className={btn} disabled={!!busy} onClick={() => open("replace")} aria-expanded={panel === "replace"}>Replace with a new code…</button>
            <button type="button" className={btnDanger} disabled={!!busy} onClick={() => open("remove")} aria-expanded={panel === "remove"}>Remove…</button>
          </>
        )}
      </div>

      {/* ── Move everything ── */}
      {panel === "move" && (
        <MoveEverythingPanel
          code={code}
          active={active}
          totes={totes}
          lots={lots}
          targetRef={scanBox}
          onBusyChange={b => setBusy(b ? "move" : null)}
          onCancel={() => setPanel(null)}
          onMoved={m => { setMoved(m); setPanel(null); router.refresh() }}
        />
      )}

      {/* ── Check what's here ── */}
      {panel === "check" && (
        <CheckHere code={code} active={active} expected={expected} totalTotes={totes} totalLots={lots} scanRef={scanBox} onClose={() => setPanel(null)} />
      )}

      {/* ── Name and kind ── */}
      {canEdit && panel === "edit" && (
        <div className={plainPanel} role="region" aria-labelledby="edit-title">
          <p id="edit-title" className="font-semibold text-gray-900 dark:text-white">Change <span className={mono}>{code}</span></p>
          <div>
            <label htmlFor="edit-name" className={label}>Name (optional)</label>
            <input id="edit-name" className={input} value={editName} maxLength={120} onChange={e => setEditName(e.target.value)} placeholder={defaultName ?? "e.g. Returns shelf by the door"} autoComplete="off" autoFocus />
            {defaultName && editName.trim() !== defaultName && (
              <button type="button" className="mt-1 inline-flex items-center min-h-11 text-sm font-medium text-indigo-700 dark:text-indigo-300 underline underline-offset-2" onClick={() => setEditName(defaultName)}>
                Use the usual name: {defaultName}
              </button>
            )}
          </div>
          <KindPicker name="edit-kind" value={editKind} onChange={setEditKind} />
          {editKind !== kind && totes > 0 && (
            <p className="text-sm text-gray-600 dark:text-gray-300">Changing the kind doesn&apos;t change the status of the {plural(totes, "tote or pallet", "totes and pallets")} already here — only of things moved here from now on.</p>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400">The code can&apos;t be changed — it&apos;s printed on the label. Use &ldquo;Replace with a new code&rdquo; for that.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnGo} disabled={!!busy} onClick={() => void saveEdit()}>{busy === "edit" ? "Saving…" : "Save changes"}</button>
            <button type="button" className={btn} disabled={busy === "edit"} onClick={() => setPanel(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Replace with a new code ── */}
      {canEdit && panel === "replace" && (
        <div className={plainPanel} role="region" aria-labelledby="replace-title">
          <p id="replace-title" className="font-semibold text-gray-900 dark:text-white">Replace <span className={mono}>{code}</span> with a new code</p>
          <ol className="list-decimal pl-5 text-sm text-gray-700 dark:text-gray-200 space-y-1 leading-relaxed">
            <li>The new code is added as a new location (it mustn&apos;t be one already).</li>
            <li>{hasGoods ? <>Everything here — {goodsWords} — is moved to it, each move recorded.</> : "Anything recorded here is moved to it (nothing is, as the page stands)."}</li>
            <li>{code} is removed: {everUsed ? "it has been used, so it is switched off and kept for its history." : "it has never been used, so it is deleted."}</li>
          </ol>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor="replace-code" className={label}>New code (what the new label will say)</label>
              <input id="replace-code" className={`${input} ${mono} uppercase`} value={newCode} onChange={e => onNewCode(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void runReplace() } }} placeholder="e.g. A11A1" autoFocus autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={busy === "replace"} />
              {replaceProblem && <p className="text-sm text-red-700 dark:text-red-300 mt-1">{replaceProblem}</p>}
            </div>
            <div className="min-w-0">
              <label htmlFor="replace-name" className={label}>Its name (optional)</label>
              <input id="replace-name" className={input} value={newName} maxLength={120} onChange={e => { setNewName(e.target.value); setNameTouched(true) }} autoComplete="off" disabled={busy === "replace"} />
            </div>
          </div>
          <KindPicker name="replace-kind" value={newKind} onChange={setNewKind} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnGo} disabled={!!busy || !replaceTo || !!replaceProblem} onClick={() => void runReplace()}>
              {busy === "replace" ? "Replacing — adding, moving, removing…" : replaceTo && !replaceProblem ? `Replace ${code} with ${replaceTo}` : "Replace"}
            </button>
            <button type="button" className={btn} disabled={busy === "replace"} onClick={() => setPanel(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Switch off while goods are here ── */}
      {canEdit && panel === "off" && (
        <div className={warnPanel} role="alertdialog" aria-labelledby="off-title">
          <p id="off-title" className="font-semibold">Switch off <span className={mono}>{code}</span> while goods are still here?</p>
          <p className="text-sm leading-relaxed">
            The {goodsWords} recorded here stay recorded here — switching it off doesn&apos;t move them, and nothing new can be moved here.
            If they&apos;re no longer here, move them to where they are first.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnGo} disabled={!!busy} onClick={() => open("move")}>Move everything here first</button>
            <button type="button" className={btn} disabled={!!busy} onClick={() => void setActive(false)}>{busy === "off" ? "Switching off…" : "Switch it off anyway"}</button>
            <button type="button" className={btn} disabled={busy === "off"} onClick={() => setPanel(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Remove ── */}
      {canEdit && panel === "remove" && (
        <div role="alertdialog" aria-labelledby="remove-title" className={removeOutcome === "refused" || removeOutcome === "already-off" ? warnPanel : "rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200 p-4 space-y-3"}>
          {removeOutcome === "refused" && (
            <>
              <p id="remove-title" className="font-semibold"><span className={mono}>{code}</span> can&apos;t be removed while goods are here</p>
              <p className="text-sm leading-relaxed">The {goodsWords} here would be left recorded at a location that no longer exists. Move them somewhere else first, then remove it.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnGo} onClick={() => open("move")}>Move everything here to…</button>
                <button type="button" className={btn} onClick={() => setPanel(null)}>Cancel</button>
              </div>
            </>
          )}
          {removeOutcome === "already-off" && (
            <>
              <p id="remove-title" className="font-semibold"><span className={mono}>{code}</span> is already switched off</p>
              <p className="text-sm leading-relaxed">
                It has been used before ({usedWords}), so it is kept for its history rather than deleted — Find and History still show where things went.
                Switched off is as far as removing goes for a location that has been used.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btn} onClick={() => setPanel(null)}>Close</button>
              </div>
            </>
          )}
          {removeOutcome === "switch-off" && (
            <>
              <p id="remove-title" className="font-semibold">Remove <span className={mono}>{code}</span>?</p>
              <p className="text-sm leading-relaxed">
                It has been used before ({usedWords}), so it <b>can&apos;t be deleted</b> — removing it <b>switches it off</b> instead.
                It stays for its history, so Find and History still show where things went, but nothing new can be moved here. It can be switched back on later.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={dangerSolid} disabled={!!busy} onClick={() => void runRemove()}>{busy === "remove" ? "Switching it off…" : "Yes, switch it off"}</button>
                <button type="button" className={btn} disabled={busy === "remove"} onClick={() => setPanel(null)}>Keep it</button>
              </div>
            </>
          )}
          {removeOutcome === "delete" && (
            <>
              <p id="remove-title" className="font-semibold">Remove <span className={mono}>{code}</span>?</p>
              <p className="text-sm leading-relaxed">
                Nothing has ever been moved in or out of it, so it will be <b>deleted completely</b>. Its printed label will stop working — scanning it will say there&apos;s no such location.
                The code can be added again later if it&apos;s needed.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={dangerSolid} disabled={!!busy} onClick={() => void runRemove()}>{busy === "remove" ? "Removing…" : "Yes, remove it"}</button>
                <button type="button" className={btn} disabled={busy === "remove"} onClick={() => setPanel(null)}>Keep it</button>
              </div>
            </>
          )}
        </div>
      )}

      {error && <ErrorBox onDismiss={() => setError(null)}>{error}</ErrorBox>}
      {ok && <OkBox>{ok}</OkBox>}
      {moved && <MovedSummary moved={moved} />}
      {replaced && <ReplacedSummary r={replaced} />}
    </div>
  )
}

function KindPicker({ name, value, onChange }: { name: string; value: LocationKind; onChange: (k: LocationKind) => void }) {
  return (
    <fieldset>
      <legend className={label}>Kind</legend>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {LOCATION_KINDS.map(k => (
          <label key={k.value} className={`flex items-start gap-3 rounded-lg border px-3 py-3 min-h-11 cursor-pointer transition-colors ${value === k.value ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40" : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
            <input type="radio" name={name} className="mt-1 h-5 w-5 accent-indigo-600" checked={value === k.value} onChange={() => onChange(k.value)} />
            <span>
              <span className="block text-sm font-semibold text-gray-900 dark:text-white">{k.label}</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400 leading-snug">{k.help}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** What "Replace with a new code" did, step by step — and where it stopped, if it did. */
function ReplacedSummary({ r }: { r: Replaced }) {
  const box = r.problem
    ? "rounded-lg border border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100"
    : "rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100"
  return (
    <div role="status" className={`${box} px-4 py-3 text-sm space-y-2`}>
      <p className="font-semibold">{r.problem ? `Replacing ${r.from} stopped part-way.` : `Replaced ${r.from} with ${r.to}.`}</p>
      <ol className="list-decimal pl-5 space-y-1">
        {r.steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      {r.problem && <p>{r.problem}</p>}
      <div className="flex flex-wrap gap-2">
        <Link href={locationHref(r.to)} className={btnGo}>Open {r.to}</Link>
        <a href={`/api/goods-in/labels?locations=${encodeURIComponent(r.to)}`} target="_blank" rel="noopener" className={btn}>Print {r.to}&apos;s label</a>
        {r.oldGone && <Link href={LIST} className={btn}>Back to Locations</Link>}
      </div>
    </div>
  )
}
