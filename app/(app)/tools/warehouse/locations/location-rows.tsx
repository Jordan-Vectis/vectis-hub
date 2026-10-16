"use client"

import Link from "next/link"
import { Fragment, type ChangeEvent } from "react"
import { box, btn, btnDanger, mono, td, th } from "../_components/ui"
import { KindChip, OffChip } from "./chips"
import { lastUsedWords } from "./export"
import { goodsWords, n, plural, type Row } from "./filters"

// Goods In → Locations: the list itself — cards on a phone, a table from a tablet up. Each code
// opens that location's own page. Remove asks on the row itself and says what will happen
// before anything does: deleted if it has never been used, switched off (kept for its history)
// if it has, refused while goods are still recorded there. Shift-click a tick box to tick (or
// untick) every location between it and the one ticked before.

const detailHref = (code: string) => `/tools/warehouse/locations/${encodeURIComponent(code)}`
/** The Lots section of a location's page. */
const lotsHref = (code: string) => `${detailHref(code)}#lots`
const findHref = (code: string) => `/tools/warehouse/find?q=${encodeURIComponent(code)}`
const rowBtn = "!px-3"

type Props = {
  rows: Row[]
  ticked: ReadonlySet<string>
  /** `range` — shift was held: tick or untick everything between this and the one ticked before. */
  onToggle: (code: string, range: boolean) => void
  allTicked: boolean
  onTickAll: () => void
  canEdit: boolean
  onEdit: (r: Row) => void
  /** The row whose Remove is being confirmed. */
  confirmCode: string | null
  /** The row being removed right now. */
  busyCode: string | null
  onAskRemove: (code: string | null) => void
  onRemove: (r: Row) => void
}

function RemoveConfirm({ r, busy, onConfirm, onCancel }: { r: Row; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const code = <b className={mono}>{r.code}</b>
  if (r.totes > 0 || r.lots > 0) {
    return (
      <div role="alert" className="rounded-lg border border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100 p-3 text-sm space-y-2">
        <p>{code} can&apos;t be removed while goods are recorded there — {goodsWords(r.totes, r.lots)}. Move them somewhere else first.</p>
        <div className="flex flex-wrap gap-2">
          <Link href={detailHref(r.code)} prefetch={false} className={btn}>Open {r.code} to move everything</Link>
          <button type="button" className={btn} onClick={onCancel}>Close</button>
        </div>
      </div>
    )
  }
  if (r.everUsed && !r.active) {
    return (
      <div role="status" className="rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-gray-800 dark:text-gray-100 p-3 text-sm space-y-2">
        <p>{code} is already switched off. It has been used before, so it&apos;s kept for its history and can&apos;t be deleted.</p>
        <button type="button" className={btn} onClick={onCancel}>Close</button>
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-gray-900 dark:text-gray-100 p-3 text-sm space-y-2">
      {r.everUsed
        ? <p>{code} has been used before, so it will be <b>switched off</b> rather than deleted — it stays for its history, and nothing new can be moved there.</p>
        : <p>{code} has never been used and is empty, so it will be <b>deleted</b> for good.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnDanger} onClick={onConfirm} disabled={busy}>
          {busy ? (r.everUsed ? "Switching off…" : "Deleting…") : r.everUsed ? `Switch off ${r.code}` : `Delete ${r.code}`}
        </button>
        <button type="button" className={btn} onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  )
}

function Actions({ r, canEdit, onEdit, onAskRemove, confirming }: { r: Row; canEdit: boolean; onEdit: (r: Row) => void; onAskRemove: (code: string | null) => void; confirming: boolean }) {
  return (
    <>
      <a href={`/api/goods-in/labels?locations=${encodeURIComponent(r.code)}`} target="_blank" rel="noopener" className={`${btn} ${rowBtn}`} aria-label={`Print the label for ${r.code}`}>Label</a>
      {canEdit && <button type="button" className={`${btn} ${rowBtn}`} onClick={() => onEdit(r)} aria-label={`Edit ${r.code}`}>Edit</button>}
      {canEdit && (
        <button type="button" className={`${btnDanger} ${rowBtn}`} onClick={() => onAskRemove(confirming ? null : r.code)} aria-expanded={confirming} aria-label={`Remove ${r.code}`}>Remove</button>
      )}
    </>
  )
}

const muted = "text-gray-500 dark:text-gray-400"

/** React fires a tick box's change from its click, so the click's shift key is on the native event. */
const shiftHeld = (e: ChangeEvent<HTMLInputElement>) => !!(e.nativeEvent as Partial<MouseEvent>).shiftKey

export default function LocationRows({ rows, ticked, onToggle, allTicked, onTickAll, canEdit, onEdit, confirmCode, busyCode, onAskRemove, onRemove }: Props) {
  const confirm = (r: Row) => (
    <RemoveConfirm r={r} busy={busyCode === r.code} onConfirm={() => onRemove(r)} onCancel={() => onAskRemove(null)} />
  )
  return (
    <>
      {/* Phones and small tablets: cards */}
      <ul className="md:hidden space-y-2">
        {rows.map(r => (
          <li key={r.code} className={`${box} p-3 ${ticked.has(r.code) ? "ring-2 ring-indigo-500" : ""}`}>
            <div className={`flex items-start gap-2 ${r.active ? "" : "opacity-75"}`}>
              <label className="flex items-center justify-center min-h-11 min-w-11 -m-1 cursor-pointer">
                <input type="checkbox" className="h-6 w-6 accent-indigo-600" checked={ticked.has(r.code)} onChange={e => onToggle(r.code, shiftHeld(e))} aria-label={`Tick ${r.code}`} />
              </label>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2">
                  <Link href={detailHref(r.code)} prefetch={false} className={`${mono} inline-flex items-center min-h-11 text-lg font-bold text-gray-900 dark:text-white underline decoration-gray-300 dark:decoration-gray-600 underline-offset-4 hover:decoration-indigo-500 break-all`}>{r.code}</Link>
                  <KindChip kind={r.kind} />
                  {!r.active && <OffChip />}
                </div>
                {r.name && <p className="text-sm text-gray-600 dark:text-gray-300 break-words">{r.name}</p>}
                <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                  {r.totes > 0
                    ? <Link href={findHref(r.code)} prefetch={false} className="inline-flex items-center min-h-11 text-indigo-700 dark:text-indigo-300 underline underline-offset-2">{plural(r.totes, "tote or pallet", "totes or pallets")} here</Link>
                    : "No totes here"}
                  {r.lots > 0 && <> · <Link href={lotsHref(r.code)} prefetch={false} className="inline-flex items-center min-h-11 text-indigo-700 dark:text-indigo-300 underline underline-offset-2">{plural(r.lots, "lot", "lots")}</Link></>}
                </p>
                <p className={`text-xs mt-0.5 ${muted}`}>Last used: {lastUsedWords(r)}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-2 pl-11">
              <Actions r={r} canEdit={canEdit} onEdit={onEdit} onAskRemove={onAskRemove} confirming={confirmCode === r.code} />
            </div>
            {canEdit && confirmCode === r.code && <div className="mt-3">{confirm(r)}</div>}
          </li>
        ))}
      </ul>

      {/* Tablets and desktops: a table */}
      <div className={`${box} hidden md:block overflow-x-auto`}>
        <table className="w-full">
          <thead className="border-b border-gray-200 dark:border-gray-800">
            <tr>
              <th className={`${th} w-12`}>
                <label className="flex items-center justify-center min-h-11 min-w-11 cursor-pointer" title={allTicked ? "Untick all of these" : "Tick all of these"}>
                  <input type="checkbox" className="h-5 w-5 accent-indigo-600" checked={allTicked} onChange={onTickAll} aria-label="Tick every location in this list" />
                </label>
              </th>
              <th className={th}>Code</th>
              <th className={`${th} hidden xl:table-cell`}>Name</th>
              <th className={th}>Kind</th>
              <th className={`${th} text-right !whitespace-normal`}>Totes &amp; pallets</th>
              <th className={`${th} text-right`}>Lots</th>
              <th className={th}>Last used</th>
              <th className={th}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map(r => (
              <Fragment key={r.code}>
                <tr className={ticked.has(r.code) ? "bg-indigo-50 dark:bg-indigo-950/30" : "hover:bg-gray-50 dark:hover:bg-gray-800/50"}>
                  <td className={`${td} !py-0 align-middle`}>
                    <label className="flex items-center justify-center min-h-11 min-w-11 cursor-pointer">
                      <input type="checkbox" className="h-5 w-5 accent-indigo-600" checked={ticked.has(r.code)} onChange={e => onToggle(r.code, shiftHeld(e))} aria-label={`Tick ${r.code}`} />
                    </label>
                  </td>
                  <td className={`${td} align-middle ${r.active ? "" : "opacity-75"}`}>
                    {/* The padding gives the link a 44px tap height without making the row taller. */}
                    <Link href={detailHref(r.code)} prefetch={false} className={`${mono} inline-block py-3 -my-3 font-bold text-gray-900 dark:text-white underline decoration-gray-300 dark:decoration-gray-600 underline-offset-4 hover:decoration-indigo-500`}>{r.code}</Link>
                    {r.name && <span className="block xl:hidden text-xs text-gray-600 dark:text-gray-300 mt-0.5">{r.name}</span>}
                  </td>
                  <td className={`${td} align-middle hidden xl:table-cell ${r.active ? "" : "opacity-75"}`}>{r.name ?? <span className={muted}>—</span>}</td>
                  <td className={`${td} align-middle`}><span className="inline-flex flex-wrap gap-1.5"><KindChip kind={r.kind} />{!r.active && <OffChip />}</span></td>
                  <td className={`${td} align-middle text-right ${mono}`}>
                    {r.totes > 0
                      ? <Link href={findHref(r.code)} prefetch={false} className="inline-block py-3 -my-3 px-2 -mx-2 text-indigo-700 dark:text-indigo-300 underline underline-offset-2 font-semibold" aria-label={`${plural(r.totes, "tote or pallet", "totes or pallets")} at ${r.code} — find them`}>{n(r.totes)}</Link>
                      : <span className={muted}>0</span>}
                  </td>
                  <td className={`${td} align-middle text-right ${mono}`}>
                    {r.lots > 0
                      ? <Link href={lotsHref(r.code)} prefetch={false} className="inline-block py-3 -my-3 px-2 -mx-2 text-indigo-700 dark:text-indigo-300 underline underline-offset-2 font-semibold" aria-label={`${plural(r.lots, "lot", "lots")} at ${r.code} — see them`}>{n(r.lots)}</Link>
                      : <span className={muted}>0</span>}
                  </td>
                  <td className={`${td} align-middle whitespace-nowrap ${r.lastUsedAt ? "" : muted}`}>{lastUsedWords(r)}</td>
                  <td className={`${td} align-middle`}>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Actions r={r} canEdit={canEdit} onEdit={onEdit} onAskRemove={onAskRemove} confirming={confirmCode === r.code} />
                    </div>
                  </td>
                </tr>
                {canEdit && confirmCode === r.code && (
                  <tr className="bg-gray-50/60 dark:bg-gray-800/30">
                    <td colSpan={8} className="px-3 pb-3 pt-1">{confirm(r)}</td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
