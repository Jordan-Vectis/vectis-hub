"use client"

import Link from "next/link"
import { useRef, useState, type RefObject } from "react"
import { useRouter } from "next/navigation"
import { moveEverything } from "@/lib/actions/goods-in-locations"
import { normaliseCode } from "@/lib/goods-in/model"
import { ErrorBox, OkBox, btn, btnGo, input, label, mono } from "../../_components/ui"
import { useScanFocus } from "../../_components/use-scan-focus"
import { findHref } from "../../history/move-parts"
import { plural } from "../../move/words"

// Goods In → a location → "Move everything here to…" (anyone in Goods In — the same as Scan to
// move): every tote and pallet here that hasn't gone back to the customer, and every lot whose
// latest move is here, to one other location in one go (moveEverything — one transaction, one
// recorded move each). Used on a location's page, and on the "no such location" page for goods
// still recorded at a code that is no longer a location.

export type Moved = { from: string; to: string; totes: string[]; lots: number }

const LIST = "/tools/warehouse/locations"
export const locationHref = (code: string) => `${LIST}/${encodeURIComponent(code)}`

/** "3 totes and pallets and 2 lots". */
export const goodsWordsFor = (totes: number, lots: number) =>
  [totes > 0 ? plural(totes, "tote or pallet", "totes and pallets") : null, lots > 0 ? plural(lots, "lot") : null].filter(Boolean).join(" and ")

export function MoveEverythingPanel({ code, active, totes, lots, targetRef, onMoved, onCancel, onBusyChange }: {
  code: string
  /** False when the location is switched off (or no longer exists) — emptying it is still fine. */
  active: boolean
  totes: number
  lots: number
  /** The scan box — the page keeps a scanned label landing in it. */
  targetRef: RefObject<HTMLInputElement | null>
  onMoved: (m: Moved) => void
  onCancel: () => void
  onBusyChange?: (busy: boolean) => void
}) {
  const [target, setTarget] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const what = goodsWordsFor(totes, lots) || "goods"

  const run = async () => {
    if (busy) return
    const to = normaliseCode(target)
    if (!to) { setError("Scan or type the location everything is going to."); targetRef.current?.focus(); return }
    if (to === code) { setError(`That's ${code} itself — scan the location everything is going to.`); setTarget(""); targetRef.current?.focus(); return }
    setBusy(true); onBusyChange?.(true); setError(null)
    try {
      const res = await moveEverything(code, to, note.trim() || null)
      if (!res.ok) { setError(res.error); targetRef.current?.select(); return }
      onMoved({ from: code, to: res.data.to, totes: res.data.totes, lots: res.data.lots })
    } catch {
      setError("The Hub couldn't be reached — check the connection and try again. Nothing was moved.")
    } finally {
      setBusy(false); onBusyChange?.(false)
    }
  }

  return (
    <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 p-4 space-y-3" role="region" aria-labelledby={`move-all-${code}`}>
      <p id={`move-all-${code}`} className="font-semibold text-gray-900 dark:text-white">Move everything at <span className={mono}>{code}</span> to another location</p>
      <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed">
        This moves the {what} recorded here in one go, and records a move for each one. Scan or type where they&apos;re going and press Enter.
        {!active && " (Emptying a location that is switched off or gone is fine.)"}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <label htmlFor={`move-to-${code}`} className={label}>Where to — scan or type the location</label>
          <input
            id={`move-to-${code}`}
            ref={targetRef}
            className={`${input} ${mono} !text-lg uppercase`}
            value={target}
            onChange={e => { setTarget(e.target.value); setError(null) }}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void run() } }}
            placeholder="e.g. BENCH3"
            disabled={busy}
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="go"
          />
        </div>
        <div className="min-w-0">
          <label htmlFor={`move-note-${code}`} className={label}>Note (optional — saved on every move)</label>
          <input
            id={`move-note-${code}`}
            className={input}
            value={note}
            maxLength={300}
            onChange={e => setNote(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void run() } }}
            placeholder="e.g. clearing the aisle for racking work"
            disabled={busy}
            autoComplete="off"
          />
        </div>
      </div>
      {error && <ErrorBox onDismiss={() => setError(null)}>{error}</ErrorBox>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnGo} disabled={busy || !target.trim()} onClick={() => void run()}>
          {busy ? `Moving the ${what}…` : "Move everything"}
        </button>
        <button type="button" className={btn} disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

/** What "Move everything" did, in numbers — and which totes, so any one can be found again. */
export function MovedSummary({ moved }: { moved: Moved }) {
  const { from, to, totes, lots } = moved
  return (
    <OkBox>
      <p>
        Moved {goodsWordsFor(totes.length, lots) || "nothing"} from <span className={`${mono} font-semibold`}>{from}</span> to{" "}
        <Link href={locationHref(to)} className={`${mono} inline-flex items-center min-h-11 font-semibold underline underline-offset-2`}>{to}</Link>.
      </p>
      {totes.length > 0 && (
        <details className="mt-1">
          <summary className="inline-flex items-center min-h-11 cursor-pointer font-medium underline underline-offset-2">Which totes and pallets</summary>
          <ul className="flex flex-wrap gap-x-3 pb-1">
            {totes.map(t => (
              <li key={t}><Link href={findHref(t)} className={`${mono} inline-flex items-center min-h-11 hover:underline`}>{t}</Link></li>
            ))}
          </ul>
        </details>
      )}
    </OkBox>
  )
}

/**
 * Goods still recorded at a code that is no longer a location (removed, or never added — History
 * keeps codes as text). They can be emptied into a real location in one go, like any other.
 */
export function StrandedGoods({ code, totes, lots }: { code: string; totes: number; lots: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [moved, setMoved] = useState<Moved | null>(null)
  const box = useRef<HTMLInputElement>(null)
  useScanFocus(box)
  // Rendered whether or not anything is there, so the result survives the refresh that empties it.
  if (!moved && totes + lots === 0) return null
  return (
    <div className="space-y-3">
      {moved && <MovedSummary moved={moved} />}
      {!moved && !open && (
        <button type="button" className={btnGo} onClick={() => setOpen(true)}>Move them all to a location…</button>
      )}
      {!moved && open && (
        <MoveEverythingPanel
          code={code}
          active={false}
          totes={totes}
          lots={lots}
          targetRef={box}
          onCancel={() => setOpen(false)}
          onMoved={m => { setMoved(m); setOpen(false); router.refresh() }}
        />
      )}
    </div>
  )
}
