"use client"

import { useLayoutEffect, useRef, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from "react"
import { CONTAINER_KINDS, type ContainerKind } from "@/lib/goods-in/model"
import { box, btn, btnDanger, input, label } from "../_components/ui"
import { CATEGORIES, MAX_ROWS, blankRow, countKinds, isBlankRow, kindsPhrase, newKey, type GoodsRow } from "./shared"

// Step 2 — what they've brought. One row per tote or pallet, grouped by CATEGORY not item
// ("5x boxes of comics" is one tote). Built for the counter: the first row is ready to type in,
// Enter in a description starts the next row (a keyboard or a scanner's Enter both work), and
// duplicate / remove are a tap each, with Undo for a slip. No numbers yet — they are handed out
// at Book in, all together, so two clerks can never be given the same one.

const DATALIST_ID = "gi-checkin-categories"

export default function GoodsStep({ rows, setRows }: { rows: GoodsRow[]; setRows: Dispatch<SetStateAction<GoodsRow[]>> }) {
  const fields = useRef(new Map<string, HTMLInputElement>())
  // Where the cursor goes after the next render: the first row on arrival, a new row when one is added.
  const pendingFocus = useRef<string | null>(rows[0] && isBlankRow(rows[0]) ? `${rows[0].key}:cat` : null)
  const [removed, setRemoved] = useState<{ row: GoodsRow; index: number } | null>(null)

  useLayoutEffect(() => {
    const k = pendingFocus.current
    if (!k) return
    pendingFocus.current = null
    const el = fields.current.get(k)
    if (el) { el.focus(); el.scrollIntoView({ block: "nearest" }) }
  })

  const { totes, pallets } = countKinds(rows)
  const full = rows.length >= MAX_ROWS

  const bind = (key: string) => (el: HTMLInputElement | null) => {
    if (el) fields.current.set(key, el)
    else fields.current.delete(key)
  }
  const update = (key: string, patch: Partial<GoodsRow>) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)))

  const add = (kind: ContainerKind) => {
    if (full) return
    const r = blankRow(kind)
    setRows(rs => [...rs, r])
    setRemoved(null)
    pendingFocus.current = `${r.key}:cat`
  }
  const duplicate = (i: number) => {
    if (full) return
    const r = { ...rows[i], key: newKey() }
    setRows(rs => [...rs.slice(0, i + 1), r, ...rs.slice(i + 1)])
    setRemoved(null)
    pendingFocus.current = `${r.key}:desc`
  }
  const remove = (i: number) => {
    const row = rows[i]
    setRows(rs => rs.filter(r => r.key !== row.key))
    setRemoved({ row, index: i })
    const next = rows[i + 1] ?? rows[i - 1]
    if (next) pendingFocus.current = `${next.key}:cat`
  }
  const undo = () => {
    if (!removed) return
    setRows(rs => [...rs.slice(0, removed.index), removed.row, ...rs.slice(removed.index)])
    pendingFocus.current = `${removed.row.key}:desc`
    setRemoved(null)
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

  return (
    <section aria-labelledby="gi-step-1-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h2 id="gi-step-1-heading" tabIndex={-1} className="text-lg font-bold text-gray-900 dark:text-white outline-none">What they&apos;ve brought</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 max-w-3xl">
            One row for each tote or pallet. Group by category, not by item — &ldquo;5x boxes of comics&rdquo; is one tote.
            Press Enter in <b>What&apos;s in it</b> to start the next row.
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-gray-900 dark:text-white" aria-live="polite">{kindsPhrase(totes, pallets)}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Numbers are given when you book in.</p>
        </div>
      </div>

      <datalist id={DATALIST_ID}>
        {CATEGORIES.map(c => <option key={c} value={c} />)}
      </datalist>

      {rows.length > 0 && (
        <div className="hidden @4xl:grid grid-cols-[10rem_minmax(9rem,14rem)_minmax(0,1fr)_auto] gap-3 px-[13px] text-xs font-semibold text-gray-500 dark:text-gray-400">
          <span>Tote or pallet</span><span>Category</span><span>What&apos;s in it</span><span aria-hidden />
        </div>
      )}

      <ol className="space-y-2">
        {rows.map((r, i) => {
          const n = i + 1
          return (
            <li key={r.key} className={`${box} p-3`}>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 @4xl:grid-cols-[10rem_minmax(9rem,14rem)_minmax(0,1fr)_auto] @4xl:items-center">
                {/* Row number + tote/pallet */}
                <div className="order-1 col-span-2 @xl:col-span-1 flex items-center gap-2">
                  <span className="w-7 shrink-0 text-right font-mono text-sm font-semibold text-gray-500 dark:text-gray-400">{n}</span>
                  <div role="group" aria-label={`Row ${n}: tote or pallet`} className="inline-flex overflow-hidden rounded-lg border border-gray-300 dark:border-gray-700">
                    {CONTAINER_KINDS.map(k => {
                      const on = r.kind === k.value
                      return (
                        <button
                          key={k.value}
                          type="button"
                          aria-pressed={on}
                          onClick={() => update(r.key, { kind: k.value })}
                          className={`min-h-11 min-w-[3.25rem] px-2.5 text-sm font-semibold transition-colors ${on ? "bg-indigo-600 text-white" : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"}`}
                        >
                          {k.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Duplicate / remove — beside the row number on tablets, at the end of the line on a wide screen */}
                <div className="order-4 col-span-2 @xl:order-2 @xl:col-span-1 @4xl:order-4 flex justify-end gap-2">
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
                    onChange={e => update(r.key, { category: e.target.value })}
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
                    onChange={e => update(r.key, { description: e.target.value })}
                    onKeyDown={e => onDescriptionKey(e, i)}
                    placeholder="e.g. 5x boxes of comics"
                    maxLength={500}
                    autoComplete="off"
                    enterKeyHint={i === rows.length - 1 ? "enter" : "next"}
                  />
                </div>
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
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm text-gray-700 dark:text-gray-300">
          <span className="flex-1 min-w-0">
            Removed row {removed.index + 1} ({removed.row.kind === "pallet" ? "pallet" : "tote"}
            {removed.row.category.trim() ? ` — ${removed.row.category.trim()}` : ""}).
          </span>
          <button type="button" className={btn} onClick={undo}>Undo</button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={`${btn} !min-h-12 font-semibold`} onClick={() => add("tote")} disabled={full}>+ Add tote</button>
        <button type="button" className={`${btn} !min-h-12 font-semibold`} onClick={() => add("pallet")} disabled={full}>+ Add pallet</button>
        {full && <span className="text-sm text-amber-700 dark:text-amber-300">That&apos;s the most one receipt can hold ({MAX_ROWS}) — book these in, then start a second receipt.</span>}
      </div>
    </section>
  )
}
