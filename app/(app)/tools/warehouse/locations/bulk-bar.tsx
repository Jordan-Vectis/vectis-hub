"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { goodsAtLocations, removeLocations, setLocationsActive, setLocationsKind, setLocationsName } from "@/lib/actions/goods-in-locations"
import { LOCATION_KINDS, type LocationKind } from "@/lib/goods-in/model"
import { MAX_BULK_LOCATIONS, defaultLocationName } from "@/lib/goods-in/location-codes"
import { btn, btnDanger, btnGo, input, mono } from "../_components/ui"
import { KIND } from "./chips"
import { downloadGoodsHereCsv, downloadLocationsCsv } from "./export"
import { goodsWords, n, plural, predictRemoval, type Row } from "./filters"
import MoveAllPanel from "./move-all"
import { activeOutcome, kindOutcome, namesOutcome, removeOutcome, type Outcome } from "./outcome"
import { useLetGoAfterMouse } from "./select-focus"

// Goods In → Locations: what can be done to the ticked locations, kept in reach at the foot of
// the screen. Everyone can print their labels, export them (or what is at them), and move
// everything at them to one location; managers can also switch them off or on, change their kind
// or names, and remove them. Every change is confirmed IN the page (never window.confirm), says
// beforehand what will happen to each — from the list's own figures, with the codes under each
// heading — and then shows what the server actually did. A tick the filters now hide still counts,
// so every panel says how many of them aren't on screen.

export const MAX_LABELS = 500

type Panel = "remove" | "off" | "kind" | "names" | "move"

export default function BulkBar({ rows, hidden, tickedOnly, onToggleTickedOnly, canEdit, lookup, onUntickAll, onResult, onPanelOpen, onBusyChange }: {
  /** The ticked locations that still exist, in code order. */
  rows: Row[]
  /** How many of them the list's filters hide right now. */
  hidden: number
  /** The list is showing the ticked locations only. */
  tickedOnly: boolean
  onToggleTickedOnly: () => void
  canEdit: boolean
  /** Any location in the list, by code. */
  lookup: (code: string) => Row | undefined
  onUntickAll: () => void
  /** A change finished: show this, refresh, and untick `gone` (deleted or no longer there). */
  onResult: (outcome: Outcome, gone: string[]) => void
  /** A confirm panel opened — clear the last result so the panel and its explanation fit on screen. */
  onPanelOpen: () => void
  /** Something is running — the list holds its ticks still until it's done. */
  onBusyChange: (busy: boolean) => void
}) {
  const [panel, setPanel] = useState<Panel | null>(null)
  const [kind, setKind] = useState<LocationKind>("storage")
  const [busy, setBusyState] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [more, setMore] = useState(false)
  const printForm = useRef<HTMLFormElement>(null)
  const kindFocus = useLetGoAfterMouse()

  const setBusy = (b: boolean) => { setBusyState(b); onBusyChange(b) }

  const count = rows.length
  const tooMany = count > MAX_BULK_LOCATIONS
  const codes = rows.map(r => r.code)

  const open = (p: Panel) => { onPanelOpen(); setPanel(p) }

  // Escape closes an open confirm panel (not while a change is being saved).
  useEffect(() => {
    if (!panel) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) setPanel(null) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [panel, busy])

  const run = async (work: () => Promise<{ outcome: Outcome; gone: string[] }>) => {
    setBusy(true)
    try {
      const { outcome, gone } = await work()
      setPanel(null)
      onResult(outcome, gone)
    } catch {
      onResult({ tone: "error", lines: ["The change couldn't be sent — check the connection and try again."] }, [])
    } finally {
      setBusy(false)
    }
  }

  // What each location was before the change, so the result can say which ones actually changed.
  const codesWhere = (test: (r: Row) => boolean): ReadonlySet<string> => new Set(rows.filter(test).map(r => r.code))

  const doRemove = () => run(async () => {
    const wasOff = codesWhere(r => !r.active)
    const res = await removeLocations(codes)
    if (!res.ok) return { outcome: { tone: "error", lines: [res.error] }, gone: [] }
    return { outcome: removeOutcome(res.data, wasOff), gone: [...res.data.removed, ...res.data.missing] }
  })
  const doActive = (active: boolean) => run(async () => {
    const already = codesWhere(r => r.active === active)
    const res = await setLocationsActive(codes, active)
    if (!res.ok) return { outcome: { tone: "error", lines: [res.error] }, gone: [] }
    return { outcome: activeOutcome(active, res.data, already), gone: res.data.missing }
  })
  const doKind = () => run(async () => {
    const already = codesWhere(r => r.kind === kind)
    const res = await setLocationsKind(codes, kind)
    if (!res.ok) return { outcome: { tone: "error", lines: [res.error] }, gone: [] }
    return { outcome: kindOutcome(kind, res.data, already), gone: res.data.missing }
  })
  const doNames = (mode: "usual" | "clear") => run(async () => {
    const already = codesWhere(r => (mode === "usual" ? r.name === defaultLocationName(r.code) : !r.name))
    const res = await setLocationsName(codes, mode)
    if (!res.ok) return { outcome: { tone: "error", lines: [res.error] }, gone: [] }
    return { outcome: namesOutcome(mode, res.data, already), gone: res.data.missing }
  })

  // Everything at the ticked locations as a spreadsheet — read fresh from the server, not the list.
  const exportGoods = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const res = await goodsAtLocations(codes)
      if (!res.ok) { onResult({ tone: "error", lines: [res.error] }, []); return }
      const { rows: goods, truncated } = res.data
      if (goods.length === 0) {
        onResult({ tone: "warn", lines: [`Nothing is at the ${plural(count, "ticked location", "ticked locations")} right now, so no file was made.`] }, [])
        return
      }
      downloadGoodsHereCsv(goods, codes)
      const places = new Set(goods.map(g => g.location)).size
      onResult({
        tone: truncated ? "warn" : "ok",
        lines: [
          `Saved a spreadsheet of ${plural(goods.length, "tote, pallet or lot", "totes, pallets and lots")} at ${plural(places, "location", "locations")}.`,
          ...(truncated ? ["There were more than 20,000 of one kind, so the file stops there — tick fewer locations to get the rest."] : []),
        ],
      }, [])
    } catch {
      onResult({ tone: "error", lines: ["The Hub couldn't be reached — check the connection and try again."] }, [])
    } finally {
      setExporting(false)
    }
  }

  // Switching off asks first only when some of them still hold goods.
  const withGoods = rows.filter(r => r.active && (r.totes > 0 || r.lots > 0))
  const switchOff = () => (withGoods.length ? open("off") : doActive(false))

  const panelBox = "rounded-lg border px-4 py-3 text-sm space-y-3 max-h-[50vh] overflow-y-auto"
  const hiddenNote = hidden > 0 ? <HiddenNote hidden={hidden} tickedOnly={tickedOnly} onToggle={onToggleTickedOnly} /> : null
  const working = busy || exporting

  return (
    <div className="space-y-3">
      {panel === "move" && (
        <MoveAllPanel
          rows={rows}
          lookup={lookup}
          className={panelBox}
          onBusyChange={setBusy}
          onCancel={() => setPanel(null)}
          onFinish={o => { setPanel(null); onResult(o, []) }}
        />
      )}

      {canEdit && panel === "remove" && (
        <RemovePanel rows={rows} busy={busy} onConfirm={doRemove} onCancel={() => setPanel(null)} onMoveFirst={() => setPanel("move")} className={panelBox} hiddenNote={hiddenNote} />
      )}

      {canEdit && panel === "off" && (
        <div className={`${panelBox} border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100`}>
          <p className="font-semibold">{plural(withGoods.length, "of the ticked locations still holds", "of the ticked locations still hold")} goods.</p>
          <p>Switching a location off doesn&apos;t move anything — what&apos;s recorded there stays there, but nothing new can be moved in. If the goods aren&apos;t really there any more, move them first.</p>
          {hiddenNote}
          <CodeList items={withGoods.map(r => ({ code: r.code, note: goodsWords(r.totes, r.lots) }))} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnDanger} onClick={() => doActive(false)} disabled={busy}>{busy ? "Switching off…" : `Switch off all ${n(count)}`}</button>
            <button type="button" className={btn} onClick={() => setPanel("move")} disabled={busy}>Move the goods out first…</button>
            <button type="button" className={btn} onClick={() => setPanel(null)} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}

      {canEdit && panel === "kind" && (() => {
        const now = new Map<LocationKind, number>()
        for (const r of rows) now.set(r.kind, (now.get(r.kind) ?? 0) + 1)
        const same = now.get(kind) ?? 0
        const changing = rows.filter(r => r.kind !== kind)
        return (
          <div className={`${panelBox} border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-gray-800 dark:text-gray-100`}>
            <p className="font-semibold">Change {plural(count, "location", "locations")} to {KIND[kind].label}?</p>
            <p>
              Now: {[...now.entries()].map(([k, c]) => `${n(c)} ${KIND[k].label.toLowerCase()}`).join(", ")}.
              {same > 0 && same < count && ` ${plural(same, "is", "are")} ${KIND[kind].label.toLowerCase()} already and won't change.`}
            </p>
            <p className="text-gray-600 dark:text-gray-300">Totes and pallets already there keep their status — it follows the new kind the next time they&apos;re moved.</p>
            {hiddenNote}
            {changing.length > 0 && <Fold label="Which ones change" items={changing.map(r => ({ code: r.code, note: KIND[r.kind].label }))} />}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnGo} onClick={doKind} disabled={busy || same === count}>{busy ? "Changing…" : same === count ? `They're all ${KIND[kind].label.toLowerCase()} already` : `Change to ${KIND[kind].label}`}</button>
              <button type="button" className={btn} onClick={() => setPanel(null)} disabled={busy}>Cancel</button>
            </div>
          </div>
        )
      })()}

      {canEdit && panel === "names" && (() => {
        const usual = rows.map(r => ({ r, name: defaultLocationName(r.code) }))
        const willGet = usual.filter(x => x.name && x.r.name !== x.name)
        const noUsual = usual.filter(x => !x.name).length
        const named = rows.filter(r => r.name)
        return (
          <div className={`${panelBox} border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-gray-800 dark:text-gray-100`}>
            <p className="font-semibold">Change the names of {plural(count, "location", "locations")}</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><b>Usual names</b> come from the code — A10A1 is &ldquo;Aisle 10, Bay A, Shelf 1&rdquo;, BENCH3 &ldquo;Bench 3&rdquo;, CAB5E &ldquo;Cabinet 5, Shelf E&rdquo;. {willGet.length ? `${plural(willGet.length, "location", "locations")} would change.` : "They all have theirs already."}</li>
              {noUsual > 0 && <li>{plural(noUsual, "is a named area", "are named areas")} (like RETURNED) with no usual name — {noUsual === 1 ? "its name stays" : "their names stay"} as {noUsual === 1 ? "it is" : "they are"}.</li>}
              <li><b>Clearing</b> takes the name off {named.length ? plural(named.length, "location that has one", "locations that have one") : "— none of them has one"}. The code is always shown.</li>
            </ul>
            {hiddenNote}
            {willGet.length > 0 && <Fold label="Which ones get their usual name" items={willGet.map(x => ({ code: x.r.code, note: `${x.r.name ? `“${x.r.name}” → ` : ""}${x.name}` }))} />}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnGo} onClick={() => doNames("usual")} disabled={busy || willGet.length === 0}>{busy ? "Saving…" : `Give ${willGet.length === 1 ? "it its" : "them their"} usual name${willGet.length === 1 ? "" : "s"}`}</button>
              <button type="button" className={btnDanger} onClick={() => doNames("clear")} disabled={busy || named.length === 0}>Clear {plural(named.length, "name", "names")}</button>
              <button type="button" className={btn} onClick={() => setPanel(null)} disabled={busy}>Cancel</button>
            </div>
          </div>
        )
      })()}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-gray-900 dark:text-white mr-auto">
          {plural(count, "location", "locations")} ticked
          {hidden > 0 && !tickedOnly && (
            <span className="block text-xs font-normal text-gray-600 dark:text-gray-300">
              {plural(hidden, "isn't", "aren't")} in the list as it&apos;s filtered —{" "}
              <button type="button" className="inline-flex items-center min-h-11 underline underline-offset-2 text-indigo-700 dark:text-indigo-300" onClick={onToggleTickedOnly}>show the ticked ones</button>
            </span>
          )}
          {count > MAX_LABELS && <span className="block text-xs font-normal text-red-700 dark:text-red-300">Labels print {MAX_LABELS} at a time — untick {n(count - MAX_LABELS)} to print.</span>}
          {tooMany && <span className="block text-xs font-normal text-red-700 dark:text-red-300">Changes work on up to {n(MAX_BULK_LOCATIONS)} at a time — untick {n(count - MAX_BULK_LOCATIONS)}.</span>}
        </span>
        <button type="button" className={btnGo} onClick={() => printForm.current?.submit()} disabled={count > MAX_LABELS}>Print {count === 1 ? "label" : `${n(count)} labels`}</button>
        <button type="button" className={btn} onClick={() => downloadLocationsCsv(rows)}>Export ticked</button>
        <button type="button" className={`${btn} md:hidden`} onClick={() => setMore(m => !m)} aria-expanded={more}>{more ? "Fewer options" : "More…"}</button>
        <button type="button" className={btn} onClick={() => { setPanel(null); onUntickAll() }} disabled={working}>Untick all</button>
      </div>

      <div className={`${more ? "flex" : "hidden"} md:flex flex-wrap items-center gap-2 border-t border-gray-200 dark:border-gray-800 pt-3`}>
        <button type="button" className={btn} onClick={() => open("move")} disabled={working || tooMany}>Move everything to…</button>
        <button type="button" className={btn} onClick={() => void exportGoods()} disabled={working || tooMany}>{exporting ? "Reading what's there…" : "Export what's there"}</button>
        {canEdit && (
          <>
            <button type="button" className={btn} onClick={switchOff} disabled={working || tooMany}>Switch off</button>
            <button type="button" className={btn} onClick={() => doActive(true)} disabled={working || tooMany}>Switch on</button>
            <span className="inline-flex items-center gap-2">
              <label htmlFor="bulk-kind" className="sr-only">New kind</label>
              <select
                id="bulk-kind"
                className={`${input} !w-auto dark:[color-scheme:dark]`}
                value={kind}
                onPointerDown={kindFocus.onPointerDown}
                onKeyDown={kindFocus.onKeyDown}
                onChange={e => { setKind(e.target.value as LocationKind); kindFocus.letGo(e.currentTarget) }}
                disabled={working}
              >
                {LOCATION_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
              <button type="button" className={btn} onClick={() => open("kind")} disabled={working || tooMany}>Change kind</button>
            </span>
            <button type="button" className={btn} onClick={() => open("names")} disabled={working || tooMany}>Names…</button>
            <button type="button" className={btnDanger} onClick={() => open("remove")} disabled={working || tooMany}>Remove…</button>
          </>
        )}
        {busy && panel !== "move" && <span className="text-sm text-gray-600 dark:text-gray-300">Saving — this can take a few seconds for a long list…</span>}
      </div>

      {/* Ticked locations go to the labels route as a form post, so a long list never makes the address too long. */}
      <form ref={printForm} method="post" action="/api/goods-in/labels" target="_blank" className="hidden">
        <input type="hidden" name="locations" value={codes.join(",")} readOnly />
      </form>
    </div>
  )
}

/** Ticked locations the filters hide still count — said in every panel, with the way to see them. */
function HiddenNote({ hidden, tickedOnly, onToggle }: { hidden: number; tickedOnly: boolean; onToggle: () => void }) {
  if (tickedOnly) return null
  return (
    <p className="rounded-md border border-dashed border-gray-400 dark:border-gray-500 px-3 py-1">
      <b>{plural(hidden, "of these isn't", "of these aren't")} in the list as it&apos;s filtered now</b> — {hidden === 1 ? "it" : "they"} still count{hidden === 1 ? "s" : ""}.{" "}
      <button type="button" className="inline-flex items-center min-h-11 underline underline-offset-2" onClick={onToggle}>Show the ticked ones only</button>
    </p>
  )
}

function CodeList({ items }: { items: { code: string; note?: string }[] }) {
  return (
    <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(it => (
        <li key={it.code} className="min-w-0 break-words">
          <span className={`${mono} font-semibold`}>{it.code}</span>{it.note && <span> — {it.note}</span>}
        </li>
      ))}
    </ul>
  )
}

/** A heading's codes, folded away until asked for. */
function Fold({ label, items, open = false }: { label: string; items: { code: string; note?: string }[]; open?: boolean }) {
  if (items.length === 0) return null
  return (
    <details open={open}>
      <summary className="cursor-pointer min-h-11 flex items-center font-medium select-none">{label} ({n(items.length)})</summary>
      <div className="mt-1"><CodeList items={items} /></div>
    </details>
  )
}

/** What Remove will do to the ticked locations, before it does it. */
function RemovePanel({ rows, busy, onConfirm, onCancel, onMoveFirst, className, hiddenNote }: {
  rows: Row[]; busy: boolean; onConfirm: () => void; onCancel: () => void; onMoveFirst: () => void; className: string; hiddenNote: ReactNode
}) {
  const p = predictRemoval(rows)
  const acting = p.deleted.length + p.switchedOff.length
  const go = [
    p.deleted.length ? `delete ${n(p.deleted.length)}` : null,
    p.switchedOff.length ? `switch off ${n(p.switchedOff.length)}` : null,
  ].filter(Boolean).join(" and ")
  return (
    <div className={`${className} border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-gray-900 dark:text-gray-100`}>
      <p className="font-semibold">Remove {plural(rows.length, "location", "locations")}?</p>
      <ul className="list-disc pl-5 space-y-1">
        {p.deleted.length > 0 && <li><b>{plural(p.deleted.length, "has", "have")} never been used</b> and {p.deleted.length === 1 ? "is" : "are"} empty — {p.deleted.length === 1 ? "it" : "they"} will be <b>deleted</b> for good.</li>}
        {p.switchedOff.length > 0 && <li><b>{plural(p.switchedOff.length, "has", "have")} been used before</b> — {p.switchedOff.length === 1 ? "it" : "they"} will be <b>switched off</b> instead, kept for {p.switchedOff.length === 1 ? "its" : "their"} history. Nothing new can be moved there.</li>}
        {p.alreadyOff.length > 0 && <li>{plural(p.alreadyOff.length, "is", "are")} already switched off and {p.alreadyOff.length === 1 ? "has" : "have"} been used before, so {p.alreadyOff.length === 1 ? "it stays" : "they stay"} as {p.alreadyOff.length === 1 ? "it is" : "they are"}.</li>}
        {p.refused.length > 0 && <li><b>{plural(p.refused.length, "still holds", "still hold")} goods</b> and won&apos;t be touched — move the goods somewhere else first.</li>}
      </ul>
      {hiddenNote}
      <Fold label="To be deleted" items={p.deleted.map(r => ({ code: r.code, note: r.name ?? undefined }))} />
      <Fold label="To be switched off" items={p.switchedOff.map(r => ({ code: r.code, note: r.name ?? undefined }))} />
      <Fold label="Already switched off" items={p.alreadyOff.map(r => ({ code: r.code }))} />
      <Fold label="Still holding goods — not touched" open items={p.refused.map(r => ({ code: r.code, note: goodsWords(r.totes, r.lots) }))} />
      <p className="text-xs text-gray-600 dark:text-gray-300">The server checks each one again as it goes, and you&apos;ll see exactly what it did.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnDanger} onClick={onConfirm} disabled={busy || acting === 0}>
          {busy ? "Removing…" : acting === 0 ? "Nothing here can be removed" : `Yes — ${go}`}
        </button>
        {p.refused.length > 0 && <button type="button" className={btn} onClick={onMoveFirst} disabled={busy}>Move the goods out first…</button>}
        <button type="button" className={btn} onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  )
}
