"use client"

import type { BulkProblem } from "@/lib/actions/goods-in-locations"
import type { LocationKind } from "@/lib/goods-in/model"
import { mono } from "../_components/ui"
import { KIND } from "./chips"
import { goodsWords, n, plural } from "./filters"

// Goods In → Locations: what a change actually did, as the SERVER reported it — never what the
// screen expected. A count of zero is said plainly, with why (RULES design rule 7: "nothing
// happened" must never look like success). Long lists of codes fold away under their heading.

export type OutcomeList = { label: string; items: { code: string; note?: string }[] }
export type Outcome = { tone: "ok" | "warn" | "error"; lines: string[]; lists?: OutcomeList[] }

const codes = (label: string, list: string[]): OutcomeList[] => (list.length ? [{ label, items: list.map(code => ({ code })) }] : [])
const problems = (label: string, list: BulkProblem[]): OutcomeList[] => (list.length ? [{ label, items: list.map(p => ({ code: p.code, note: p.reason })) }] : [])

const gone = (missing: string[]) =>
  missing.length ? [`${plural(missing.length, "location no longer exists", "locations no longer exist")} — someone may have just removed ${missing.length === 1 ? "it" : "them"}.`] : []
const one = (list: string[]) => (list.length === 1 ? ` (${list[0]})` : "")

/**
 * Remove's result. The server lists a location that was ALREADY switched off under `switchedOff`
 * too, so `wasOff` (from the list as it stood) separates "switched off now" from "already was".
 */
export function removeOutcome(d: { removed: string[]; switchedOff: string[]; blocked: BulkProblem[] }, wasOff: ReadonlySet<string>): Outcome {
  const newlyOff = d.switchedOff.filter(c => !wasOff.has(c))
  const stayedOff = d.switchedOff.filter(c => wasOff.has(c))
  const lines: string[] = []
  if (d.removed.length) lines.push(`Deleted ${plural(d.removed.length, "location", "locations")}${one(d.removed)}.`)
  if (newlyOff.length) lines.push(`Switched off ${plural(newlyOff.length, "location", "locations")}${one(newlyOff)} — ${newlyOff.length === 1 ? "it has" : "they have"} been used before, so ${newlyOff.length === 1 ? "it stays" : "they stay"} for ${newlyOff.length === 1 ? "its" : "their"} history and nothing new can be moved there.`)
  if (stayedOff.length) lines.push(`${plural(stayedOff.length, "was", "were")} already switched off${one(stayedOff)} and ${stayedOff.length === 1 ? "has" : "have"} been used before, so ${stayedOff.length === 1 ? "it stays" : "they stay"} as ${stayedOff.length === 1 ? "it is" : "they are"}.`)
  if (d.blocked.length) lines.push(`${plural(d.blocked.length, "location wasn't", "locations weren't")} removed${d.blocked.length === 1 ? `: ${d.blocked[0].reason}` : " — see why below."}`)
  const nothingDone = !d.removed.length && !newlyOff.length
  if (nothingDone) lines.unshift("Nothing was removed.")
  return {
    tone: nothingDone || d.blocked.length ? "warn" : "ok",
    lines,
    lists: [
      ...(d.removed.length > 1 ? codes("Deleted", d.removed) : []),
      ...(newlyOff.length > 1 ? codes("Switched off", newlyOff) : []),
      ...(stayedOff.length > 1 ? codes("Already switched off", stayedOff) : []),
      ...(d.blocked.length > 1 ? problems("Not removed", d.blocked) : []),
    ],
  }
}

/**
 * Switch on / off's result. The server's `changed` includes locations that were already in that
 * state, so `already` (from the list as it stood) separates the two.
 */
export function activeOutcome(
  active: boolean,
  d: { changed: string[]; withGoods: { code: string; totes: number; lots: number }[]; missing: string[] },
  already: ReadonlySet<string>,
): Outcome {
  const state = active ? "on" : "off"
  const newly = d.changed.filter(c => !already.has(c))
  const stayed = d.changed.filter(c => already.has(c))
  const lines: string[] = []
  if (newly.length) lines.push(`Switched ${state} ${plural(newly.length, "location", "locations")}${one(newly)}.`)
  else if (stayed.length) lines.push(`Nothing changed — ${stayed.length === 1 ? "it was" : `all ${n(stayed.length)} were`} already switched ${state}.`)
  else lines.push("Nothing changed.")
  if (newly.length && stayed.length) lines.push(`${plural(stayed.length, "was", "were")} already switched ${state}.`)
  lines.push(...gone(d.missing))
  if (!active && d.withGoods.length) {
    lines.push(`${plural(d.withGoods.length, "of them still holds", "of them still hold")} goods. Switching off doesn't move anything — if the goods aren't really there any more, move them somewhere else.`)
  }
  return {
    tone: !newly.length || d.withGoods.length || d.missing.length ? "warn" : "ok",
    lines,
    lists: [
      ...(!active && d.withGoods.length ? [{ label: "Still holding goods", items: d.withGoods.map(g => ({ code: g.code, note: goodsWords(g.totes, g.lots) })) }] : []),
      ...codes("No longer there", d.missing),
      ...(newly.length > 1 ? codes(`Switched ${state}`, newly) : []),
    ],
  }
}

/** Change kind's result — `already` holds the ones that were that kind before. */
export function kindOutcome(kind: LocationKind, d: { changed: string[]; missing: string[] }, already: ReadonlySet<string>): Outcome {
  const k = KIND[kind].label
  const newly = d.changed.filter(c => !already.has(c))
  const stayed = d.changed.length - newly.length
  const lines: string[] = []
  if (newly.length) lines.push(`Changed ${plural(newly.length, "location", "locations")}${one(newly)} to ${k}. Totes and pallets already there keep their status until they're next moved.`)
  else if (stayed) lines.push(`Nothing changed — ${stayed === 1 ? "it was" : `all ${n(stayed)} were`} already ${k}.`)
  else lines.push("Nothing changed.")
  if (newly.length && stayed) lines.push(`${plural(stayed, "was", "were")} already ${k}.`)
  lines.push(...gone(d.missing))
  return {
    tone: !newly.length || d.missing.length ? "warn" : "ok",
    lines,
    lists: [...codes("No longer there", d.missing), ...(newly.length > 1 ? codes("Changed", newly) : [])],
  }
}

/** Names' result — `already` holds the ones that had that name (or no name, for "clear") before. */
export function namesOutcome(mode: "usual" | "clear", d: { changed: string[]; skipped: string[]; missing: string[] }, already: ReadonlySet<string>): Outcome {
  const newly = d.changed.filter(c => !already.has(c))
  const stayed = d.changed.length - newly.length
  const lines: string[] = []
  const did = mode === "usual" ? "Gave" : "Cleared the names of"
  const state = mode === "usual" ? "had their usual name" : "had no name"
  if (newly.length) lines.push(`${did} ${plural(newly.length, "location", "locations")}${one(newly)}${mode === "usual" ? " their usual name" : ""}.`)
  else if (stayed) lines.push(`Nothing changed — ${stayed === 1 ? "it" : `all ${n(stayed)}`} already ${state}.`)
  else lines.push("Nothing changed.")
  if (newly.length && stayed) lines.push(`${plural(stayed, "location", "locations")} already ${state}.`)
  if (d.skipped.length) lines.push(`${plural(d.skipped.length, "is a named area", "are named areas")} with no usual name, so ${d.skipped.length === 1 ? "its name was" : "their names were"} left as ${d.skipped.length === 1 ? "it was" : "they were"}.`)
  lines.push(...gone(d.missing))
  return {
    tone: !newly.length || d.missing.length ? "warn" : "ok",
    lines,
    lists: [...codes("Named areas left alone", d.skipped), ...codes("No longer there", d.missing), ...(newly.length > 1 ? codes("Changed", newly) : [])],
  }
}

const TONE: Record<Outcome["tone"], string> = {
  ok: "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100",
  warn: "border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100",
  error: "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200",
}

export function OutcomePanel({ outcome, onDismiss }: { outcome: Outcome; onDismiss: () => void }) {
  return (
    <div role={outcome.tone === "error" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm max-h-[40vh] overflow-y-auto ${TONE[outcome.tone]}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 space-y-1">
          {outcome.lines.map((l, i) => <p key={i} className={i === 0 ? "font-semibold" : ""}>{l}</p>)}
        </div>
        <button type="button" className="shrink-0 min-h-11 px-2 text-xs underline underline-offset-2" onClick={onDismiss}>Dismiss</button>
      </div>
      {outcome.lists?.map(list => (
        <details key={list.label} className="mt-2">
          <summary className="cursor-pointer min-h-11 flex items-center font-medium select-none">{list.label} ({n(list.items.length)})</summary>
          <ul className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {list.items.map(it => (
              <li key={it.code} className="min-w-0 break-words">
                <span className={`${mono} font-semibold`}>{it.code}</span>
                {it.note && <span className="opacity-90"> — {it.note}</span>}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  )
}
