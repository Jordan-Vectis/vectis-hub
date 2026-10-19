"use client"

import { useEffect, useRef, useState } from "react"
import { moveEverything } from "@/lib/actions/goods-in-locations"
import { normaliseCode } from "@/lib/goods-in/model"
import { btn, btnGo, input, label, mono } from "../_components/ui"
import { goodsWords, n, plural, type Row } from "./filters"
import type { Outcome, OutcomeList } from "./outcome"

// Goods In → Locations → Move everything to… (anyone in Goods In — the same as Scan to move).
// Empties every ticked location that holds goods into ONE other location — clearing an aisle for
// racking work, or before removing it. The browser drives it one location at a time, each a
// moveEverything call (its own transaction), so the screen shows a count that moves, there is a
// Stop, and the end says in numbers what was done (RULES design rule 7b). Stopping keeps every
// location already emptied; the ones not reached are untouched and listed.

type Progress = { at: number; total: number; current: string; emptied: number }

const SAME_PROBLEM_LIMIT = 3

export default function MoveAllPanel({ rows, lookup, onFinish, onCancel, onBusyChange, className }: {
  /** The ticked locations. Only the ones holding goods (by the list as loaded) are emptied. */
  rows: Row[]
  /** A location from the list, to check the target before starting. */
  lookup: (code: string) => Row | undefined
  onFinish: (outcome: Outcome) => void
  onCancel: () => void
  onBusyChange: (busy: boolean) => void
  className: string
}) {
  const [to, setTo] = useState("")
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const stop = useRef(false)
  const [stopping, setStopping] = useState(false)

  const sources = rows.filter(r => r.totes > 0 || r.lots > 0)
  const empty = rows.length - sources.length
  const totes = sources.reduce((s, r) => s + r.totes, 0)
  const lots = sources.reduce((s, r) => s + r.lots, 0)
  const running = progress !== null

  // Leaving the page part-way would leave the rest unmoved without a word — ask first.
  useEffect(() => {
    if (!running) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [running])

  const start = async () => {
    if (running) return
    const target = normaliseCode(to)
    if (!target) { setError("Scan or type the location everything is going to."); return }
    const dest = lookup(target)
    if (!dest) { setError(`There's no location ${target} — check the code, or add it first.`); return }
    if (!dest.active) { setError(`${target} is switched off — choose another location, or switch it on first.`); return }
    const list = sources.filter(r => r.code !== target)
    const targetTicked = sources.length !== list.length
    if (list.length === 0) { setError(`None of the ticked locations holds goods${targetTicked ? ` apart from ${target} itself` : ""} — there's nothing to move.`); return }

    setError(null)
    stop.current = false
    setStopping(false)
    onBusyChange(true)
    const userNote = note.trim() || null
    const emptied: { code: string; note: string }[] = []
    const nothing: string[] = []
    const failed: { code: string; note: string }[] = []
    let movedTotes = 0, movedLots = 0
    let lastProblem = "", repeats = 0
    let stoppedAt: number | null = null
    let gaveUp: string | null = null

    for (let i = 0; i < list.length; i++) {
      if (stop.current) { stoppedAt = i; break }
      const r = list[i]
      setProgress({ at: i + 1, total: list.length, current: r.code, emptied: emptied.length })
      let res: Awaited<ReturnType<typeof moveEverything>>
      try {
        res = await moveEverything(r.code, target, userNote)
      } catch {
        res = { ok: false, error: "The Hub couldn't be reached — check the connection." }
      }
      if (res.ok) {
        movedTotes += res.data.totes.length
        movedLots += res.data.lots
        emptied.push({ code: r.code, note: goodsWords(res.data.totes.length, res.data.lots) })
        lastProblem = ""; repeats = 0
        continue
      }
      if (res.error.startsWith("There's nothing at ")) { nothing.push(r.code); continue }
      failed.push({ code: r.code, note: res.error })
      // The same answer for three locations in a row is about the target or the connection, not
      // those locations — carrying on would only say it again for every one left.
      repeats = res.error === lastProblem ? repeats + 1 : 1
      lastProblem = res.error
      if (repeats >= SAME_PROBLEM_LIMIT) { gaveUp = res.error; stoppedAt = i + 1; break }
    }

    setProgress(null)
    setStopping(false)
    onBusyChange(false)

    const notReached = stoppedAt === null ? [] : list.slice(stoppedAt).map(r => r.code)
    const lines: string[] = []
    if (emptied.length) {
      lines.push(`Emptied ${plural(emptied.length, "location", "locations")} into ${target} — ${goodsWords(movedTotes, movedLots)} moved, each one recorded.`)
    } else {
      lines.push("Nothing was moved.")
    }
    if (gaveUp) lines.push(`Stopped: the same problem came up ${SAME_PROBLEM_LIMIT} times in a row — ${gaveUp}`)
    else if (notReached.length) lines.push(`Stopped after ${n(stoppedAt ?? 0)} of ${n(list.length)}. The locations already emptied stay emptied.`)
    if (notReached.length) lines.push(`${plural(notReached.length, "location wasn't", "locations weren't")} reached and ${notReached.length === 1 ? "is" : "are"} as ${notReached.length === 1 ? "it was" : "they were"}.`)
    if (nothing.length) lines.push(`${plural(nothing.length, "location had", "locations had")} nothing there any more.`)
    if (failed.length && !gaveUp) lines.push(`${plural(failed.length, "location", "locations")} couldn't be emptied — see why below.`)
    if (targetTicked) lines.push(`${target} itself was ticked and was left as it is.`)
    if (empty) lines.push(`${plural(empty, "ticked location holds", "ticked locations hold")} nothing, so ${empty === 1 ? "it was" : "they were"} skipped.`)

    const lists: OutcomeList[] = [
      ...(emptied.length ? [{ label: `Emptied into ${target}`, items: emptied }] : []),
      ...(failed.length ? [{ label: "Couldn't be emptied", items: failed }] : []),
      ...(notReached.length ? [{ label: "Not reached", items: notReached.map(code => ({ code })) }] : []),
      ...(nothing.length ? [{ label: "Nothing there any more", items: nothing.map(code => ({ code })) }] : []),
    ]
    const clean = emptied.length > 0 && !failed.length && !notReached.length
    onFinish({ tone: clean ? "ok" : "warn", lines, lists })
  }

  return (
    <div className={`${className} border-indigo-300 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 text-gray-900 dark:text-gray-100`} role="region" aria-labelledby="move-all-title">
      <p id="move-all-title" className="font-semibold">Move everything at the ticked locations to one location</p>
      {sources.length === 0 ? (
        <p>None of the ticked locations holds goods, so there&apos;s nothing to move.</p>
      ) : (
        <>
          <p>
            {plural(sources.length, "ticked location holds", "ticked locations hold")} {goodsWords(totes, lots)} (as the list was loaded).
            Each location is emptied in turn and every tote, pallet and lot gets its own recorded move.
            {empty > 0 && ` ${plural(empty, "other ticked location is", "other ticked locations are")} empty and will be skipped.`}
          </p>
          <details>
            <summary className="cursor-pointer min-h-11 flex items-center font-medium select-none">Which locations ({n(sources.length)})</summary>
            <ul className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
              {sources.map(r => <li key={r.code} className="min-w-0 break-words"><span className={`${mono} font-semibold`}>{r.code}</span> — {goodsWords(r.totes, r.lots)}</li>)}
            </ul>
          </details>
          {progress ? (
            <div role="status" aria-live="polite" className="space-y-2">
              <p className="font-semibold">
                Emptying <span className={mono}>{progress.current}</span> — {n(progress.at)} of {n(progress.total)}. {plural(progress.emptied, "location", "locations")} emptied so far.
              </p>
              <div className="h-2 w-full rounded-full bg-indigo-100 dark:bg-indigo-900/60 overflow-hidden" aria-hidden>
                <div className="h-full bg-indigo-600 transition-[width]" style={{ width: `${Math.round(((progress.at - 1) / progress.total) * 100)}%` }} />
              </div>
              <button type="button" className={btn} disabled={stopping} onClick={() => { stop.current = true; setStopping(true) }}>
                {stopping ? "Stopping after this one…" : "Stop"}
              </button>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <label htmlFor="move-all-to" className={label}>Where to — scan or type the location</label>
                  <input
                    id="move-all-to"
                    className={`${input} ${mono} uppercase`}
                    value={to}
                    onChange={e => { setTo(e.target.value); setError(null) }}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void start() } }}
                    placeholder="e.g. BENCH3"
                    autoFocus
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    enterKeyHint="go"
                  />
                </div>
                <div className="min-w-0">
                  <label htmlFor="move-all-note" className={label}>Note (optional — saved on every move)</label>
                  <input id="move-all-note" className={input} value={note} maxLength={300} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void start() } }} placeholder="e.g. clearing aisle 10 for racking work" autoComplete="off" />
                </div>
              </div>
              {error && <p role="alert" className="font-medium text-red-700 dark:text-red-300">{error}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnGo} onClick={() => void start()} disabled={!to.trim()}>Move everything</button>
                <button type="button" className={btn} onClick={onCancel}>Cancel</button>
              </div>
            </>
          )}
        </>
      )}
      {sources.length === 0 && <button type="button" className={btn} onClick={onCancel}>Close</button>}
    </div>
  )
}
