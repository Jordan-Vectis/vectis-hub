"use client"

import { useDeferredValue, useMemo, useState } from "react"
import { LOCATION_KINDS, type LocationKind } from "@/lib/goods-in/model"
import { MAX_BULK_LOCATIONS, parsePastedLocations, type NewLocation } from "@/lib/goods-in/location-codes"
import { box, btn, btnGo, ErrorBox, input, label, mono, td, th } from "../_components/ui"
import { KIND, KindChip } from "./chips"
import { AddOutcomeView, Notice, plural, PrintLabelsTick, useAddLocations } from "./add-range"

// Goods In → Locations → Paste a list (managers). One location per line — typed, or copied
// straight out of a spreadsheet — read as it is typed with parsePastedLocations, shown line by line
// (new, or already here), with every line that can't be read listed with its line number and why.
// Only the NEW ones are sent to createLocations: a location that is already here is never changed —
// not its name, its kind, or whether it is switched on.

const PREVIEW = 100
const PROBLEMS = 50
const n = (x: number) => x.toLocaleString("en-GB")
/** A pasted line, cut short for the problem list. */
const clip = (s: string) => (s.length > 80 ? `${s.slice(0, 80)}…` : s)

type Row = NewLocation & { already: boolean }

export default function PasteList({ existing, onDone, onCancel, onBusyChange }: {
  existing: ReadonlySet<string>
  onDone: (message: string) => void
  onCancel: () => void
  /** Saving started (true) or finished (false) — the list holds the panel open meanwhile. */
  onBusyChange?: (busy: boolean) => void
}) {
  const [text, setText] = useState("")
  const [fallbackKind, setFallbackKind] = useState<LocationKind>("storage")
  const [printLabels, setPrintLabels] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [showAllProblems, setShowAllProblems] = useState(false)
  const { saving, error, setError, outcome, justAdded, add, finish } = useAddLocations(onDone, onBusyChange)

  // A pasted list of 2,000 lines is read again on every key — deferred, so typing stays quick.
  const pasted = useDeferredValue(text)
  const parsed = useMemo(() => parsePastedLocations(pasted, fallbackKind), [pasted, fallbackKind])
  const rows: Row[] = useMemo(() => parsed.rows.map(r => ({ ...r, already: existing.has(r.code) || justAdded.has(r.code) })), [parsed, existing, justAdded])
  const fresh = useMemo(() => rows.filter(r => !r.already), [rows])
  const alreadyCount = rows.length - fresh.length
  const problems = parsed.problems
  const tooMany = fresh.length > MAX_BULK_LOCATIONS
  const shown = showAll ? rows : rows.slice(0, PREVIEW)
  const shownProblems = showAllProblems ? problems : problems.slice(0, PROBLEMS)
  const stale = pasted !== text

  const submit = () => {
    if (fresh.length === 0 || tooMany || stale) return
    void add(fresh.map(r => ({ code: r.code, name: r.name, kind: r.kind })), { alreadyBefore: alreadyCount, describe: "list", printLabels })
  }

  return (
    <div className={`${box} p-4 sm:p-5 space-y-4`}>
      <div>
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">Paste a list of locations</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
          Adds every location on the list that isn&apos;t here yet. Locations already here are never changed — not their names, their kinds, or whether they&apos;re switched on.
        </p>
      </div>

      <fieldset disabled={saving} className="min-w-0 space-y-4">
        <div>
          <div className="flex flex-wrap items-end justify-between gap-2 mb-1">
            <label htmlFor="paste-list" className={`${label} !mb-0`}>One location per line</label>
            {text && <button type="button" className={btn} onClick={() => { setText(""); setShowAll(false); setShowAllProblems(false) }}>Clear the list</button>}
          </div>
          <textarea
            id="paste-list"
            className={`${input} ${mono} min-h-44 resize-y`}
            rows={8}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={"A70A1\nBENCH65, Bench by the window\nDISPATCH, Dispatch bay, other"}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
          />
          <ul className="mt-2 text-xs text-gray-500 dark:text-gray-400 leading-relaxed list-disc pl-5 space-y-0.5">
            <li>Just the code; or the code, a comma and its name; or code, name and kind (storage, bench, shelf or other).</li>
            <li>Columns copied from a spreadsheet work too — code, then name, then kind. A heading line starting &ldquo;Code&rdquo; is skipped.</li>
            <li>A name with a comma in it goes in &ldquo;double quotes&rdquo;, as a saved CSV has it — so the Locations export pastes straight back in.</li>
            <li>With no name, aisle, bench and cabinet codes get the usual one (A10A1 → Aisle 10, Bay A, Shelf 1).</li>
          </ul>
        </div>

        <div className="sm:max-w-sm">
          <label htmlFor="paste-kind" className={label}>Kind for lines that don&apos;t say</label>
          <select id="paste-kind" className={input} value={fallbackKind} onChange={e => setFallbackKind(e.target.value as LocationKind)}>
            {LOCATION_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-snug">{KIND[fallbackKind].help} BENCH codes are always benches.</p>
        </div>

        {/* ── What it adds ── */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 p-3 sm:p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">What this adds</h3>
          <div aria-live="polite" className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
            {rows.length === 0 && problems.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400">Paste or type the locations above to see what will be added.</p>
            ) : (
              <p>
                {rows.length > 0 ? <>Read <b>{plural(rows.length, "location", "locations")}</b>: <b>{n(fresh.length)}</b> new</> : "No locations could be read."}
                {alreadyCount > 0 && <>, <b>{n(alreadyCount)}</b> already here (left exactly as {alreadyCount === 1 ? "it is" : "they are"})</>}
                {rows.length > 0 && "."}
                {problems.length > 0 && <> <b>{plural(problems.length, "line has", "lines have")}</b> a problem and won&apos;t be added — see below.</>}
                {rows.length > 0 && fresh.length === 0 && <> {rows.length === 1 ? "It is" : "They are all"} already here — there&apos;s nothing to add.</>}
              </p>
            )}
          </div>

          {tooMany && <Notice>That&apos;s {n(fresh.length)} new locations — no more than {n(MAX_BULK_LOCATIONS)} can be added at once. Add the first {n(MAX_BULK_LOCATIONS)} lines, then paste the rest.</Notice>}

          {rows.length > 0 && (
            <>
              {/* Phones: one card per location */}
              <ul className="md:hidden divide-y divide-gray-200 dark:divide-gray-800 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm">
                {shown.map(r => (
                  <li key={r.code} className={`px-3 py-2 ${r.already ? "opacity-70" : ""}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`${mono} font-bold text-gray-900 dark:text-white break-all`}>{r.code}</span>
                      <KindChip kind={r.kind} />
                      <Status already={r.already} />
                    </div>
                    {r.name && <p className="text-gray-600 dark:text-gray-300 mt-0.5 break-words">{r.name}</p>}
                  </li>
                ))}
              </ul>

              {/* Tablets in landscape and desktops: a table */}
              <div className="hidden md:block overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <table className="w-full">
                  <thead className="border-b border-gray-200 dark:border-gray-800">
                    <tr>
                      <th className={th}>Code</th>
                      <th className={th}>Name</th>
                      <th className={th}>Kind</th>
                      <th className={th}>What happens</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {shown.map(r => (
                      <tr key={r.code} className={r.already ? "opacity-70" : ""}>
                        <td className={`${td} ${mono} font-bold text-gray-900 dark:text-white`}>{r.code}</td>
                        <td className={`${td} break-words`}>{r.name ?? <span className="text-gray-500 dark:text-gray-400">—</span>}</td>
                        <td className={td}><KindChip kind={r.kind} /></td>
                        <td className={td}><Status already={r.already} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {rows.length > PREVIEW && (
                <button type="button" className={btn} onClick={() => setShowAll(a => !a)}>
                  {showAll ? `Show the first ${n(PREVIEW)} only` : `Show all ${n(rows.length)}`}
                </button>
              )}
            </>
          )}

          {problems.length > 0 && (
            <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200 px-4 py-3 text-sm space-y-2">
              <p className="font-semibold">{problems.length === 1 ? "This line won't be added:" : `These ${n(problems.length)} lines won't be added:`}</p>
              <ul className="space-y-1.5">
                {shownProblems.map(p => (
                  <li key={p.line} className="break-words">
                    <span className="font-semibold">Line {n(p.line)}</span>{" "}
                    <span className={`${mono} break-all`}>{clip(p.text.trim()) || "(blank)"}</span>
                    <span className="block text-red-700 dark:text-red-300">{p.reason}</span>
                  </li>
                ))}
              </ul>
              {problems.length > PROBLEMS && (
                <button type="button" className="min-h-11 text-sm underline underline-offset-2" onClick={() => setShowAllProblems(a => !a)}>
                  {showAllProblems ? "Show fewer" : `Show all ${n(problems.length)}`}
                </button>
              )}
            </div>
          )}
        </div>

        <PrintLabelsTick checked={printLabels} onChange={setPrintLabels} count={fresh.length} />
      </fieldset>

      {outcome && <AddOutcomeView outcome={outcome} />}
      {error && <ErrorBox onDismiss={() => setError(null)}>{error}</ErrorBox>}

      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnGo} onClick={submit} disabled={saving || stale || tooMany || fresh.length === 0}>
          {saving ? `Adding ${plural(fresh.length, "location", "locations")} — a few seconds…` : fresh.length > 0 ? `Add ${plural(fresh.length, "location", "locations")}` : "Add locations"}
        </button>
        {outcome?.message
          ? <button type="button" className={btn} onClick={finish} disabled={saving}>Done</button>
          : <button type="button" className={btn} onClick={onCancel} disabled={saving}>Cancel</button>}
      </div>
    </div>
  )
}

function Status({ already }: { already: boolean }) {
  return already
    ? <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">Already here — left as it is</span>
    : <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 whitespace-nowrap">Will be added</span>
}
