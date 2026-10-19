"use client"

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { CONTAINER_KINDS, type ContainerKind } from "@/lib/goods-in/model"
import { box, btn, btnDanger, btnGo, input, label, mono } from "../_components/ui"
import type { SaveWhen } from "./save-engine"
import { CATEGORIES, LABEL_WORDS, MAX_ROWS, NOTE, blankRow, countKinds, isBlankRow, isPrinted, kindsPhrase, labelState, rowNumber, type GoodsRow } from "./shared"

// Step 2 — what they've brought. One row per tote or pallet, grouped by CATEGORY not item
// ("5x boxes of comics" is one tote). Built for the counter: the first row is ready to type in,
// Enter in a description starts the next row (a keyboard or a scanner's Enter both work), and
// duplicate / remove are a tap each, with Undo for a slip.
//
// Every row gets its real number as soon as it exists (the check-in is saved as a receipt that
// isn't booked in yet — check-in-flow.tsx), so its label can be printed from here: one Print
// labels (N) button for every label not printed yet (a row with nothing written in it waits — its
// label would be for an empty tote), and a Print / Reprint on each row. A row whose contents change
// after its label was printed says "Needs reprint", and its Reprint is marked, so it is the obvious
// tap. A number is never used twice, so a numbered row switched between tote and pallet, or
// removed, gives its number up for good — the screen says so before it happens, and says to throw
// a printed label away. The receipt number and "Saved" sit in the strip above the step.

const DATALIST_ID = "gi-checkin-categories"

// One template for the column headings and every row on a wide screen. "What's in it" never goes
// below 12rem: the number and Print button made the row longer, and the category gives up width
// first on a narrow desktop, so the description stays roomy and the row stays one line.
const WIDE_COLS = "@4xl:grid-cols-[13rem_minmax(9rem,14rem)_minmax(12rem,1fr)_auto]"

// Print / Reprint — one width, so the buttons line up down the list. Not printed yet: indigo, the
// tap still to do; printed: plain; changed since it was printed: amber.
const PRINT_BTN = {
  none: `${btn} min-w-[5.25rem] font-semibold !border-indigo-300 dark:!border-indigo-700 !text-indigo-700 dark:!text-indigo-300`,
  printed: `${btn} min-w-[5.25rem]`,
  changed: `${btn} min-w-[5.25rem] font-semibold !border-amber-400 dark:!border-amber-700 !text-amber-800 dark:!text-amber-200`,
} as const

export default function GoodsStep({ rows, editRows, numbering, goneIds, rowNotes, onRowNote, onPrint, printing, printNote, printedAs }: {
  rows: GoodsRow[]
  /** Change the rows; `when` says how soon the check-in is saved. */
  editRows: (fn: (rs: GoodsRow[]) => GoodsRow[], when: SaveWhen) => void
  /** A save is under way or due — a row with no number yet is being numbered. */
  numbering: boolean
  /** Numbers the Hub has already given up (a removed row that was saved without it). */
  goneIds: ReadonlySet<string>
  /** A note under a row, by row key (a row that had to be given a new number). */
  rowNotes: Record<string, string>
  onRowNote: (key: string, note: string | null) => void
  /** Print these rows' labels (row keys). */
  onPrint: (keys: string[]) => void
  printing: boolean
  printNote: ReactNode
  /** What each row's label said when it was printed, by row key — a row changed since says so. */
  printedAs: Readonly<Record<string, string>>
}) {
  const fields = useRef(new Map<string, HTMLInputElement>())
  // Where the cursor goes after the next render: the first row on arrival, a new row when one is added.
  const pendingFocus = useRef<string | null>(rows[0] && isBlankRow(rows[0]) ? `${rows[0].key}:cat` : null)
  const [removed, setRemoved] = useState<{ row: GoodsRow; index: number } | null>(null)
  // A numbered row about to switch between tote and pallet — asked in the row first.
  const [kindAsk, setKindAsk] = useState<{ key: string; to: ContainerKind } | null>(null)

  useLayoutEffect(() => {
    const k = pendingFocus.current
    if (!k) return
    pendingFocus.current = null
    const el = fields.current.get(k)
    if (el) { el.focus(); el.scrollIntoView({ block: "nearest" }) }
  })

  const { totes, pallets } = countKinds(rows)
  const full = rows.length >= MAX_ROWS
  // A row with nothing written in it yet (the one Enter has just started) isn't printed by the main
  // button — its label would be for an empty tote. Its own Print button still prints it.
  const unprinted = rows.filter(r => !isPrinted(r) && !isBlankRow(r))
  const waitingForWords = rows.some(r => !isPrinted(r) && isBlankRow(r))
  const allPrinted = rows.length > 0 && rows.every(isPrinted)
  // Every row that says what's in it is printed, and only a new blank row is left (Enter in the
  // last row starts one): that's a status, not a dead button — its label prints once it has words.
  const labelsDone = allPrinted || (unprinted.length === 0 && rows.some(isPrinted))

  const bind = (key: string) => (el: HTMLInputElement | null) => {
    if (el) fields.current.set(key, el)
    else fields.current.delete(key)
  }
  const update = (key: string, patch: Partial<GoodsRow>, when: SaveWhen) => editRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)), when)

  const add = (kind: ContainerKind) => {
    if (full) return
    const r = blankRow(kind)
    editRows(rs => [...rs, r], "now")
    setRemoved(null)
    pendingFocus.current = `${r.key}:cat`
  }
  const duplicate = (i: number) => {
    if (full) return
    const { kind, category, description } = rows[i]
    const r: GoodsRow = { ...blankRow(kind), category, description }
    editRows(rs => [...rs.slice(0, i + 1), r, ...rs.slice(i + 1)], "now")
    setRemoved(null)
    pendingFocus.current = `${r.key}:desc`
  }
  const remove = (i: number) => {
    const row = rows[i]
    // Not saved straight away: an Undo before the next save keeps the same number.
    editRows(rs => rs.filter(r => r.key !== row.key), "removal")
    setRemoved({ row, index: i })
    if (kindAsk?.key === row.key) setKindAsk(null)
    onRowNote(row.key, null)
    const next = rows[i + 1] ?? rows[i - 1]
    if (next) pendingFocus.current = `${next.key}:cat`
  }
  const undo = () => {
    if (!removed) return
    const was = removed.row
    // Already saved without it: the Hub has given that number up, so it comes back with a new one.
    const gone = !!was.id && goneIds.has(was.id)
    const back: GoodsRow = gone ? { ...was, id: null, idKind: null, labelPrintedAt: null } : was
    editRows(rs => [...rs.slice(0, removed.index), back, ...rs.slice(removed.index)], "now")
    if (gone) onRowNote(back.key, `${was.id} had already been given up, so this row gets a new number${isPrinted(was) ? ` — throw away the ${was.id} label` : ""}.`)
    pendingFocus.current = `${back.key}:desc`
    setRemoved(null)
  }

  const setKind = (r: GoodsRow, kind: ContainerKind) => {
    if (r.kind === kind) { if (kindAsk?.key === r.key) setKindAsk(null); return }
    // A row showing its number gives it up by changing kind — say so first.
    if (rowNumber(r)) { setKindAsk({ key: r.key, to: kind }); return }
    update(r.key, { kind }, "now")
  }
  const confirmKind = (r: GoodsRow) => {
    if (!kindAsk || kindAsk.key !== r.key) return
    const num = rowNumber(r)
    update(r.key, { kind: kindAsk.to }, "now")
    onRowNote(r.key, num && isPrinted(r) ? `The ${num} label isn't used any more — throw it away.` : null)
    setKindAsk(null)
  }

  const onCategoryKey = (e: KeyboardEvent<HTMLInputElement>, row: GoodsRow) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return
    e.preventDefault()
    // Let a category picked from the suggestions land first, then move along.
    setTimeout(() => fields.current.get(`${row.key}:desc`)?.focus(), 0)
  }
  const onDescriptionKey = (e: KeyboardEvent<HTMLInputElement>, i: number) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return
    e.preventDefault()
    const next = rows[i + 1]
    if (next) fields.current.get(`${next.key}:cat`)?.focus()
    else add(rows[i].kind)
  }

  const kindWord = (k: ContainerKind) => (k === "pallet" ? "pallet" : "tote")
  const removedNo = removed ? rowNumber(removed.row) : null

  return (
    <section aria-labelledby="gi-step-1-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h2 id="gi-step-1-heading" tabIndex={-1} className="text-lg font-bold text-gray-900 dark:text-white outline-none">What they&apos;ve brought</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 max-w-3xl">
            One row for each tote or pallet, grouped by category, not by item — &ldquo;5x boxes of comics&rdquo; is one tote.
            Each row is numbered as it&apos;s added, so its label can go on straight away.
            Press Enter in <b className="text-gray-800 dark:text-gray-200">What&apos;s in it</b> to start the next row.
          </p>
        </div>
        <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white" aria-live="polite">{kindsPhrase(totes, pallets)}</p>
      </div>

      <datalist id={DATALIST_ID}>
        {CATEGORIES.map(c => <option key={c} value={c} />)}
      </datalist>

      {rows.length > 0 && (
        <div className={`hidden @4xl:grid ${WIDE_COLS} gap-3 px-[13px] text-xs font-semibold text-gray-500 dark:text-gray-400`}>
          <span>Tote or pallet</span><span>Category</span><span>What&apos;s in it</span><span aria-hidden />
        </div>
      )}

      <ol className="space-y-2">
        {rows.map((r, i) => {
          const num = rowNumber(r)
          const printed = isPrinted(r)
          const labelIs = labelState(r, printedAs)
          const name = num ?? `Row ${i + 1}`
          const ask = kindAsk?.key === r.key ? kindAsk : null
          const note = rowNotes[r.key]
          return (
            <li key={r.key} className={`${box} p-3`}>
              <div className={`grid grid-cols-2 gap-x-3 gap-y-2 ${WIDE_COLS} @4xl:items-center`}>
                {/* The row's number + tote/pallet */}
                <div className="order-1 col-span-2 @xl:col-span-1 flex items-center gap-2">
                  <div className="w-[5.75rem] shrink-0">
                    {num ? (
                      <span className={`${mono} block text-lg font-bold leading-7 tabular-nums text-gray-900 dark:text-white`}>{num}</span>
                    ) : (
                      // Calm while the Hub gives it a number — the same height as the number, so nothing jumps.
                      <span className="flex h-7 items-center gap-1.5 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                        {numbering && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400 motion-safe:animate-pulse" />}
                        {numbering ? "Numbering…" : "No number yet"}
                      </span>
                    )}
                    {labelIs !== "none" && (
                      <span className={`block text-[11px] font-semibold leading-4 ${labelIs === "printed" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
                        {LABEL_WORDS[labelIs]}
                      </span>
                    )}
                  </div>
                  <div role="group" aria-label={`${name}: tote or pallet`} className="inline-flex overflow-hidden rounded-lg border border-gray-300 dark:border-gray-700">
                    {CONTAINER_KINDS.map(k => {
                      const on = r.kind === k.value
                      return (
                        <button
                          key={k.value}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setKind(r, k.value)}
                          className={`min-h-11 min-w-[3.25rem] px-2.5 text-sm font-semibold transition-colors ${on ? "bg-indigo-600 text-white" : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"}`}
                        >
                          {k.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Print / duplicate / remove — beside the number on tablets, at the end of the line on a wide screen */}
                <div className="order-4 col-span-2 @xl:order-2 @xl:col-span-1 @4xl:order-4 flex flex-wrap @4xl:flex-nowrap justify-end gap-2">
                  <button
                    type="button"
                    // A row with nothing written yet isn't nudged indigo — the main button leaves it out too.
                    className={PRINT_BTN[labelIs === "none" && isBlankRow(r) ? "printed" : labelIs]}
                    onClick={() => onPrint([r.key])}
                    disabled={!num || printing}
                    aria-label={num
                      ? `${printed ? "Reprint" : "Print"} the label for ${num}${labelIs === "changed" ? " (what's in it has changed since it was printed)" : ""}`
                      : "Print this row's label (once it has its number)"}
                  >
                    {printed ? "Reprint" : "Print"}
                  </button>
                  <button type="button" className={btn} onClick={() => duplicate(i)} disabled={full} title="Add another row just like this one">Duplicate</button>
                  <button type="button" className={btnDanger} onClick={() => remove(i)}>Remove</button>
                </div>

                <div className="order-2 col-span-2 @xl:order-3 @xl:col-span-1 @4xl:order-2 min-w-0">
                  <label htmlFor={`gi-row-${i}-cat`} className={`${label} @4xl:sr-only`}>Category</label>
                  <input
                    id={`gi-row-${i}-cat`}
                    ref={bind(`${r.key}:cat`)}
                    className={`${input} scroll-mb-28`}
                    list={DATALIST_ID}
                    value={r.category}
                    onChange={e => update(r.key, { category: e.target.value }, "typing")}
                    onKeyDown={e => onCategoryKey(e, r)}
                    placeholder="e.g. Comics"
                    maxLength={80}
                    autoComplete="off"
                    enterKeyHint="next"
                  />
                </div>

                <div className="order-3 col-span-2 @xl:order-4 @xl:col-span-1 @4xl:order-3 min-w-0">
                  <label htmlFor={`gi-row-${i}-desc`} className={`${label} @4xl:sr-only`}>What&apos;s in it</label>
                  <input
                    id={`gi-row-${i}-desc`}
                    ref={bind(`${r.key}:desc`)}
                    className={`${input} scroll-mb-28`}
                    value={r.description}
                    onChange={e => update(r.key, { description: e.target.value }, "typing")}
                    onKeyDown={e => onDescriptionKey(e, i)}
                    placeholder="e.g. 5x boxes of comics"
                    maxLength={500}
                    autoComplete="off"
                    enterKeyHint={i === rows.length - 1 ? "enter" : "next"}
                  />
                </div>

                {ask && num && (
                  <div role="alert" className="order-5 col-span-2 @4xl:col-span-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
                    <span className="flex-1 min-w-[14rem]">
                      Make <b className={mono}>{num}</b> a {kindWord(ask.to)}? A {kindWord(ask.to)} has its own numbers, so this row gets a new one and{" "}
                      <span className={mono}>{num}</span> won&apos;t be used again.
                      {printed && <> Throw away the <span className={mono}>{num}</span> label you printed.</>}
                    </span>
                    <button type="button" className={btn} onClick={() => confirmKind(r)}>Make it a {kindWord(ask.to)}</button>
                    <button type="button" className={btn} onClick={() => setKindAsk(null)}>Keep it a {kindWord(r.kind)}</button>
                  </div>
                )}

                {note && (
                  <p role="status" className="order-6 col-span-2 @4xl:col-span-4 text-sm text-amber-800 dark:text-amber-300">{note}</p>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      {rows.length === 0 && (
        <div className={`${box} px-6 py-8 text-center text-sm text-gray-600 dark:text-gray-400`}>
          No totes or pallets on this receipt yet — add one below.
        </div>
      )}

      {removed && (
        <div role="status" className={`${NOTE.plain} flex flex-wrap items-center gap-x-3 gap-y-2 !py-2`}>
          <span className="flex-1 min-w-0 basis-64">
            {removedNo ? <>Removed <b className={mono}>{removedNo}</b></> : <>Removed row {removed.index + 1}</>}
            {" "}({kindWord(removed.row.kind)}{removed.row.category.trim() ? ` — ${removed.row.category.trim()}` : ""}).
            {removedNo && <> Its number won&apos;t be used again{isPrinted(removed.row) ? " — throw its label away" : ""}.</>}
          </span>
          <button type="button" className={btn} onClick={undo}>Undo</button>
        </div>
      )}

      {/* Adding on the left; the one Print labels on the right, apart from them. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 dark:border-gray-800 pt-4">
        <button type="button" className={`${btn} !min-h-12 font-semibold`} onClick={() => add("tote")} disabled={full}>+ Add tote</button>
        <button type="button" className={`${btn} !min-h-12 font-semibold`} onClick={() => add("pallet")} disabled={full}>+ Add pallet</button>
        <div className="ml-auto flex min-h-12 items-center">
          {labelsDone && !printing ? (
            <p role="status" className="px-1 text-right text-sm font-semibold text-emerald-700 dark:text-emerald-300">
              ✓ {allPrinted ? "All labels printed" : "Labels printed"}
              {waitingForWords && <span className="block text-xs font-normal text-gray-500 dark:text-gray-400">A new row&apos;s label prints once it says what&apos;s in it</span>}
            </p>
          ) : (
            <button
              type="button"
              className={`${btnGo} !min-h-12`}
              onClick={() => onPrint(unprinted.map(r => r.key))}
              disabled={printing || unprinted.length === 0}
              aria-busy={printing}
              title={unprinted.length === 0 && waitingForWords ? "Write what's in a row first — or use that row's own Print button" : undefined}
            >
              {printing ? "Getting the labels ready…" : unprinted.length ? `Print labels (${unprinted.length})` : "Print labels"}
            </button>
          )}
        </div>
        {full && <p className="basis-full text-sm text-amber-700 dark:text-amber-300">That&apos;s the most one receipt can hold ({MAX_ROWS}) — book these in, then start a second receipt.</p>}
      </div>
      {printNote}
    </section>
  )
}
