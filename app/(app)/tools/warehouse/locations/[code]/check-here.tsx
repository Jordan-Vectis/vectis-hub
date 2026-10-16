"use client"

import Link from "next/link"
import { useMemo, useState, type RefObject } from "react"
import { useRouter } from "next/navigation"
import { lookupCode, moveTo, type ScanHit } from "@/lib/actions/goods-in"
import { normaliseCode } from "@/lib/goods-in/model"
import { btn, btnGo, input, label, mono } from "../../_components/ui"
import { findHref } from "../../history/move-parts"
import { plural } from "../../move/words"
import { locationHref } from "./move-everything"

// Goods In → a location → "Check what's here" (anyone in Goods In). The routine shelf check:
// scan every tote, pallet and lot barcode actually on the shelf. Each one the Hub records here is
// ticked off; anything else is looked up and said plainly — recorded somewhere else, booked in but
// never put away, or a code the Hub doesn't know — with "Move it here" to put the record right
// (moveTo, the same as Scan to move). At the end, what the Hub records here but nobody scanned is
// listed. It all happens in this browser tab and nothing new is stored — only a "Move it here"
// press writes anything, and that is an ordinary recorded move.

export type Expected = { code: string; kind: "tote" | "pallet" | "lot"; label: string | null }

type Extra =
  | { code: string; state: "checking" }
  | { code: string; state: "here"; what: string }
  | { code: string; state: "elsewhere"; what: string; where: string | null; movable: boolean }
  | { code: string; state: "not-goods"; what: string }
  | { code: string; state: "unknown" }
  | { code: string; state: "failed"; error: string }
  | { code: string; state: "moving"; what: string; where: string | null }
  | { code: string; state: "moved"; what: string; from: string | null }

const KIND_WORD = { tote: "Tote", pallet: "Pallet", lot: "Lot" } as const

/** What a looked-up code is, and where the Hub has it. */
function describe(hit: ScanHit): { kind: "goods"; what: string; where: string | null; returned: boolean } | { kind: "other"; what: string } {
  switch (hit.type) {
    case "container": return { kind: "goods", what: `${hit.kind === "pallet" ? "Pallet" : "Tote"} for ${hit.customer}`, where: hit.locationCode, returned: hit.status === "returned" }
    case "lot": return { kind: "goods", what: `Lot — ${hit.title}`, where: hit.locationCode, returned: false }
    case "location": return { kind: "other", what: `That's the label for location ${hit.code}, not a tote, pallet or lot.` }
    case "receipt": return { kind: "other", what: `That's receipt ${hit.id} (${hit.customer}), not a tote, pallet or lot.` }
    case "customer": return { kind: "other", what: `That's the vendor number for ${hit.name}, not a tote, pallet or lot.` }
  }
}

export default function CheckHere({ code, active, expected, totalTotes, totalLots, scanRef, onClose }: {
  code: string
  active: boolean
  /** What the Hub records here now, as loaded on the page. */
  expected: Expected[]
  /** The true counts — more than `expected` holds when the page only loaded the newest. */
  totalTotes: number
  totalLots: number
  scanRef: RefObject<HTMLInputElement | null>
  onClose: () => void
}) {
  const router = useRouter()
  const [text, setText] = useState("")
  const [found, setFound] = useState<ReadonlySet<string>>(() => new Set())
  const [extras, setExtras] = useState<Extra[]>([])
  const [last, setLast] = useState<{ tone: "ok" | "warn"; text: string } | null>(null)

  const byCode = useMemo(() => new Map(expected.map(e => [normaliseCode(e.code), e])), [expected])
  const total = totalTotes + totalLots
  const capped = expected.length < total
  const missing = expected.filter(e => !found.has(normaliseCode(e.code)))
  const foundHere = found.size
  const unexpected = extras.filter(x => x.state !== "here")

  const setExtra = (x: Extra) => setExtras(list => list.map(e => (e.code === x.code ? x : e)))

  const scan = async () => {
    const c = normaliseCode(text)
    setText("")
    scanRef.current?.focus()
    if (!c) return
    if (c === code) { setLast({ tone: "warn", text: `That's this location's own label (${code}) — scan the totes, pallets and lots on it.` }); return }
    const known = byCode.get(c)
    if (known) {
      if (found.has(c)) { setLast({ tone: "warn", text: `${c} was already ticked off.` }); return }
      setFound(prev => new Set(prev).add(c))
      setLast({ tone: "ok", text: `${c} — ${KIND_WORD[known.kind].toLowerCase()} recorded here. Ticked off.` })
      return
    }
    if (extras.some(x => x.code === c)) { setLast({ tone: "warn", text: `${c} was already scanned — it's in the list below.` }); return }
    setExtras(list => [{ code: c, state: "checking" }, ...list])
    setLast(null)
    try {
      const res = await lookupCode(c)
      if (!res.ok) { setExtra({ code: c, state: "failed", error: res.error }); return }
      if (!res.data) { setExtra({ code: c, state: "unknown" }); return }
      const d = describe(res.data)
      if (d.kind === "other") { setExtra({ code: c, state: "not-goods", what: d.what }); return }
      // Recorded here, but past the newest the page loaded: it IS here.
      if (d.where === code && !d.returned) {
        setFound(prev => new Set(prev).add(c))
        setExtra({ code: c, state: "here", what: d.what })
        return
      }
      setExtra({ code: c, state: "elsewhere", what: d.returned ? `${d.what} — marked as returned to the customer` : d.what, where: d.where, movable: active })
    } catch {
      setExtra({ code: c, state: "failed", error: "The Hub couldn't be reached — scan it again." })
    }
  }

  const moveHere = async (x: Extract<Extra, { state: "elsewhere" }>) => {
    setExtra({ code: x.code, state: "moving", what: x.what, where: x.where })
    try {
      const res = await moveTo(x.code, code, `Found at ${code} in a location check`)
      if (!res.ok) { setExtra({ ...x, what: `${x.what}. Couldn't move it: ${res.error}` }); return }
      setExtra({ code: x.code, state: "moved", what: x.what, from: x.where })
      setFound(prev => new Set(prev).add(x.code))
      router.refresh()
    } catch {
      setExtra({ ...x, what: `${x.what}. Couldn't move it — the Hub couldn't be reached.` })
    }
  }

  const restart = () => { setFound(new Set()); setExtras([]); setLast(null); setText(""); scanRef.current?.focus() }

  return (
    <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 p-4 space-y-4" role="region" aria-labelledby="check-title">
      <div>
        <p id="check-title" className="font-semibold text-gray-900 dark:text-white">Check what&apos;s at <span className={mono}>{code}</span></p>
        <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed mt-1">
          Scan every tote, pallet and lot barcode that is really on it. What the Hub records here is ticked off; anything else is said plainly, with a button to record it here.
          Nothing is saved by checking — closing this forgets the check.
        </p>
      </div>

      <div className="max-w-md">
        <label htmlFor="check-scan" className={label}>Scan or type a barcode</label>
        <input
          id="check-scan"
          ref={scanRef}
          className={`${input} ${mono} !text-lg uppercase`}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void scan() } }}
          placeholder="e.g. T027657"
          autoFocus
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          enterKeyHint="go"
        />
      </div>

      {last && (
        <p role="status" className={`text-sm font-medium ${last.tone === "ok" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-800 dark:text-amber-200"}`}>{last.text}</p>
      )}

      <p className="text-sm text-gray-900 dark:text-gray-100" aria-live="polite">
        <b>{plural(foundHere, "item", "items")} ticked off</b> of {plural(total, "recorded here", "recorded here")}
        {unexpected.length > 0 && <> · <b>{plural(unexpected.length, "scan", "scans")}</b> not recorded here</>}.
      </p>

      {unexpected.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">Scanned here, but not recorded here</p>
          <ul className="divide-y divide-gray-200 dark:divide-gray-700 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
            {unexpected.map(x => <ExtraRow key={x.code} x={x} here={code} onMove={moveHere} />)}
          </ul>
        </div>
      )}

      <details open={missing.length > 0 && missing.length <= 20}>
        <summary className="cursor-pointer min-h-11 flex items-center text-sm font-semibold text-gray-900 dark:text-white select-none">
          Recorded here, not scanned yet ({Math.max(0, total - foundHere).toLocaleString("en-GB")})
        </summary>
        {missing.length === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-300 py-2">{capped ? "Every one the page loaded has been scanned." : "Every one has been scanned."}</p>
        ) : (
          <ul className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3 text-sm">
            {missing.map(e => (
              <li key={e.code} className="min-w-0 break-words">
                <Link href={findHref(e.code)} className={`${mono} inline-flex items-center min-h-11 font-semibold text-indigo-700 dark:text-indigo-300 hover:underline`}>{e.code}</Link>{" "}
                <span className="text-gray-600 dark:text-gray-300">{KIND_WORD[e.kind]}{e.label ? ` — ${e.label}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
        {capped && <p className="text-xs text-gray-500 dark:text-gray-400 pt-1">Only the newest {expected.length.toLocaleString("en-GB")} of {total.toLocaleString("en-GB")} are listed here; a scan of an older one is still recognised.</p>}
        <p className="text-xs text-gray-500 dark:text-gray-400 pt-1">If one of these really isn&apos;t here, find where it went and move it there with Scan to move.</p>
      </details>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} onClick={restart} disabled={!foundHere && !extras.length}>Start again</button>
        <button type="button" className={btn} onClick={onClose}>Close the check</button>
      </div>
    </div>
  )
}

function ExtraRow({ x, here, onMove }: { x: Extra; here: string; onMove: (x: Extract<Extra, { state: "elsewhere" }>) => void }) {
  const codeEl = <Link href={findHref(x.code)} className={`${mono} inline-flex items-center min-h-11 font-semibold text-indigo-700 dark:text-indigo-300 hover:underline`}>{x.code}</Link>
  const where = (w: string | null) => (w ? <>recorded at <Link href={locationHref(w)} className={`${mono} inline-flex items-center min-h-11 font-semibold underline underline-offset-2`}>{w}</Link></> : "booked in but never put anywhere")
  return (
    <li className="px-3 py-2 text-sm text-gray-800 dark:text-gray-200 flex flex-wrap items-center gap-x-3">
      {codeEl}
      <span className="min-w-0 flex-1 break-words">
        {x.state === "checking" && <span className="text-gray-500 dark:text-gray-400">Looking it up…</span>}
        {x.state === "unknown" && <>The Hub doesn&apos;t know this code — not a tote, pallet or lot barcode it has.</>}
        {x.state === "failed" && <span className="text-red-700 dark:text-red-300">{x.error}</span>}
        {x.state === "not-goods" && x.what}
        {(x.state === "elsewhere" || x.state === "moving") && <>{x.what} — {where(x.where)}.</>}
        {x.state === "moved" && <span className="text-emerald-700 dark:text-emerald-300">{x.what} — now recorded here at {here}{x.from ? ` (moved from ${x.from})` : ""}.</span>}
      </span>
      {x.state === "elsewhere" && x.movable && <button type="button" className={btnGo} onClick={() => onMove(x)}>Move it here</button>}
      {x.state === "elsewhere" && !x.movable && <span className="text-xs text-gray-500 dark:text-gray-400">This location is switched off, so nothing can be moved here.</span>}
      {x.state === "moving" && <span className="text-sm text-gray-600 dark:text-gray-300">Moving…</span>}
    </li>
  )
}
