"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  bcEodCheckSent, bcEodLotSend, bcEodMarkFixed, bcEodSentToCheck, bcEodToAmend,
  type BcAmendLot, type BcEodSale,
} from "@/lib/actions/goods-in-bc-sandbox"
import { ErrorBox, btn, btnGo, mono, td, th } from "../../warehouse/_components/ui"
import { LiveConfirm, liveConfirmed, lotOutcome } from "../../warehouse/_components/bc-lot-parts"

// End of Day → Send to BC → "Sent to BC but needs amending" (2026-11-18).
//
// A lot whose line reached BC but whose sale, details, Cleared For Sale tick or barcode then failed comes off
// tonight's sheet (BC has it — importing it again would double it), and until this it was never seen again:
// half-made in BC with nothing in the Hub to say so. This lists every such lot — the newest "bc_sent" note on
// its change log says it needs amending (bcEodToAmend) — with what went wrong in BC's words, and:
// • Try them all again — bcEodLotSend with `update`, on the sale each was sent for, so a line BC already has is
//   brought up to date (sale, details, tick, size) and a line without its barcode is finished. Typed confirm on
//   live BC, one lot at a time, a count and a Stop (RULES.md 7b). A lot that goes through cleanly leaves the list.
// • Mark fixed — after putting it right in BC by hand. Writes only the Hub's note.
// • Check lots already sent — lots sent before this list existed carry no record of a failure, so this READS BC
//   for lots sent in the last 14 days and lists any whose line is missing, on another receipt or sale, or not
//   cleared for sale.

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`
const caught = (e: unknown) => ({ ok: false as const, error: String((e as { message?: string })?.message ?? e) })
/** BC puts a different CorrelationId on every answer — compare errors without it. */
const words = (e: string) => e.replace(/\s*CorrelationId:\s*[0-9a-f-]+\.?/gi, "").trim()
const CHECK_BATCH = 12
const CHECK_DAYS = 14

function when(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

export default function BcAmendPanel({ active, live, reloadKey }: {
  /** The Send to BC tab is on screen — the list is read then, and again after every send. */
  active: boolean
  /** Writes go to LIVE Business Central (the production Hub). */
  live: boolean
  /** Bumped by the tab after a send, so the list reads afresh. */
  reloadKey: number
}) {
  const [lots, setLots] = useState<BcAmendLot[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | "retrying" | "checking">(null)
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState("")
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [fixing, setFixing] = useState<string | null>(null)
  const stopRef = useRef(false)

  const load = useCallback(async () => {
    const res = await bcEodToAmend().catch(caught)
    if (!res.ok) { setLoadError(res.error); return }
    setLoadError(null)
    setLots(res.data)
  }, [])

  // Read when the tab is on screen and after every send (reloadKey). An answer that arrives after the tab was
  // left is dropped.
  useEffect(() => {
    if (!active) return
    let cancelled = false
    bcEodToAmend().catch(caught).then(res => {
      if (cancelled) return
      if (!res.ok) { setLoadError(res.error); return }
      setLoadError(null)
      setLots(res.data)
    })
    return () => { cancelled = true }
  }, [active, reloadKey])

  const n = lots?.length ?? 0
  const retryReady = liveConfirmed(live, typed, String(n))

  async function retry() {
    if (!lots?.length || !retryReady) return
    const list = lots
    const confirm = live ? { typed, expected: String(list.length) } : undefined
    stopRef.current = false
    setBusy("retrying"); setConfirming(false); setSummary(null); setNeedsSignIn(false)
    let putRight = 0
    let still = 0
    let couldnt = 0
    let stopped = false
    let lastError = ""
    let same = 0
    for (let i = 0; i < list.length; i++) {
      if (stopRef.current) { stopped = true; break }
      setProgress({ done: i, total: list.length })
      const l = list[i]
      const sale: BcEodSale = l.saleCode ? { mode: "one", code: l.saleCode } : { mode: "own" }
      const res = await bcEodLotSend(l.lotId, sale, confirm, { update: true }).catch(caught)
      if (!res.ok) {
        if (res.error === "NO_BC_SIGN_IN") { setNeedsSignIn(true); stopped = true; break }
        couldnt++
        const w = words(res.error)
        same = w === lastError ? same + 1 : 1
        lastError = w
        if (same >= 3) { stopped = true; break }
        continue
      }
      same = 0
      lastError = ""
      const outcome = lotOutcome(res.data)
      if (outcome === "refused" || outcome === "noSale" || outcome === "notCleared") still++
      else putRight++
    }
    setProgress(null)
    setTyped("")
    setBusy(null)
    setSummary(`${stopped ? "Stopped part-way. " : ""}${plural(putRight, "lot", "lots")} put right in BC, ${still} still not right (still listed, with BC's newest words)`
      + `${couldnt ? `, ${couldnt} couldn't be tried${lastError ? ` — “${lastError}”` : ""}` : ""}.`)
    await load()
  }

  async function checkSent() {
    stopRef.current = false
    setBusy("checking"); setSummary(null); setNeedsSignIn(false); setConfirming(false)
    const res = await bcEodSentToCheck(CHECK_DAYS).catch(caught)
    if (!res.ok) { setLoadError(res.error); setBusy(null); return }
    const all = res.data
    let fine = 0
    let flagged = 0
    let couldnt = 0
    let lastError = ""
    let same = 0
    let stopped = false
    for (let i = 0; i < all.length; i += CHECK_BATCH) {
      if (stopRef.current) { stopped = true; break }
      setProgress({ done: i, total: all.length })
      const batch = all.slice(i, i + CHECK_BATCH)
      const r = await bcEodCheckSent(batch.map(b => b.lotId)).catch(caught)
      if (!r.ok) {
        if (r.error === "NO_BC_SIGN_IN") { setNeedsSignIn(true); stopped = true; break }
        couldnt += batch.length
        const w = words(r.error)
        same = w === lastError ? same + 1 : 1
        lastError = w
        if (same >= 3) { stopped = true; break }
        continue
      }
      same = 0
      for (const x of r.data) { if (x.problem) flagged++; else fine++ }
    }
    setProgress(null)
    setBusy(null)
    setSummary(all.length === 0
      ? `No lot was sent to BC through the Hub in the last ${CHECK_DAYS} days without a problem already noted — nothing to check.`
      : `${stopped ? "Stopped part-way. " : ""}Checked ${plural(fine + flagged, "lot", "lots")} sent in the last ${CHECK_DAYS} days: ${fine} as they should be in BC, `
        + `${flagged} need amending (added to the list)${couldnt ? `, ${couldnt} couldn't be checked — “${lastError}”` : ""}.`)
    await load()
  }

  async function markFixed(lotId: string) {
    setFixing(lotId)
    const res = await bcEodMarkFixed(lotId).catch(caught)
    setFixing(null)
    if (!res.ok) { setLoadError(res.error); return }
    await load()
  }

  if (!lots && !loadError) {
    return <p className="mt-4 text-sm text-gray-700 dark:text-gray-200" role="status">Looking for lots sent to BC that need amending…</p>
  }

  return (
    <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${n
      ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-100"
      : "border-gray-200 dark:border-gray-800 text-gray-800 dark:text-gray-200"}`}>
      <h3 className="font-semibold">
        {n ? <>⚠ Sent to BC but needs amending ({n})</> : <>Sent to BC — nothing needs amending</>}
      </h3>
      <p className="mt-1 text-xs opacity-90">
        A lot whose line reached BC but where something after it failed — the sale, the description and details, the Cleared For Sale
        tick, or the barcode. BC already has the line, so it&apos;s off tonight&apos;s sheet; it stays here until it&apos;s put right.
      </p>
      {loadError && <div className="mt-2"><ErrorBox onDismiss={() => setLoadError(null)}>{loadError}</ErrorBox></div>}

      {n > 0 && lots && (
        <div className="mt-3 overflow-x-auto rounded-md border border-red-200 dark:border-red-900 bg-white dark:bg-gray-950">
          <table className="w-full text-xs text-gray-800 dark:text-gray-200">
            <thead>
              <tr>
                <th className={th}>Barcode</th><th className={th}>Receipt</th><th className={th}>Sale</th>
                <th className={th}>What went wrong (BC&apos;s words)</th><th className={th}>Sent</th><th className={th}><span className="sr-only">Mark fixed</span></th>
              </tr>
            </thead>
            <tbody>
              {lots.map(l => (
                <tr key={l.lotId} className="border-t border-gray-200 dark:border-gray-800 align-top">
                  <td className={`${td} ${mono} font-semibold`}>{l.barcode ?? "—"}<div className="font-sans font-normal text-gray-500 dark:text-gray-400 max-w-[14rem] truncate">{l.title}</div></td>
                  <td className={`${td} ${mono}`}>{l.receipt ?? "—"}</td>
                  <td className={`${td} ${mono}`}>{l.saleCode ?? "its own"}</td>
                  <td className={`${td} text-red-800 dark:text-red-200 min-w-[18rem]`}>{l.problem}</td>
                  <td className={`${td} whitespace-nowrap text-gray-600 dark:text-gray-400`}>{when(l.at)}<div>{l.by}</div></td>
                  <td className={td}>
                    <button type="button" className={btn} disabled={!!busy || fixing === l.lotId} onClick={() => markFixed(l.lotId)}
                      title="Use this after putting it right in BC by hand — it takes the lot off this list">
                      {fixing === l.lotId ? "…" : "Mark fixed"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!busy && (
        <div className="mt-3 flex flex-wrap gap-2">
          {n > 0 && !confirming && (
            <button type="button" className={btnGo} onClick={() => { setConfirming(true); setTyped(""); setSummary(null) }}>
              Try them all again ({n})…
            </button>
          )}
          <button type="button" className={btn} onClick={checkSent}>Check lots already sent…</button>
        </div>
      )}

      {confirming && !busy && n > 0 && (
        <div className="mt-3 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-3 text-amber-900 dark:text-amber-100">
          <p>
            Sends each of the {plural(n, "lot", "lots")} again, on the sale it was sent for. A line BC already has is brought up to date —
            sale, description, estimates, category, size and the Cleared For Sale tick; a line missing its barcode is finished. Its tote
            isn&apos;t changed. A lot that goes through cleanly comes off this list.
          </p>
          {live && <LiveConfirm expected={String(n)} what={plural(n, "lot", "lots")} value={typed} onChange={setTyped} />}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={btnGo} onClick={retry} disabled={!retryReady}>Send {plural(n, "lot", "lots")} again</button>
            <button type="button" className={btn} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}

      {busy && progress && (
        <div className="mt-3 flex flex-wrap items-center gap-3" role="status" aria-live="polite">
          <span>
            {busy === "retrying"
              ? <>Sending lot {Math.min(progress.done + 1, progress.total)} of {progress.total} again…</>
              : <>Checking BC: {progress.done.toLocaleString("en-GB")} of {progress.total.toLocaleString("en-GB")} lots sent in the last {CHECK_DAYS} days…</>}
          </span>
          <button type="button" className={btn} onClick={() => { stopRef.current = true }}>Stop after this one</button>
        </div>
      )}
      {busy === "checking" && !progress && <p className="mt-3" role="status">Finding the lots sent in the last {CHECK_DAYS} days…</p>}

      {needsSignIn && (
        <p className="mt-3 text-amber-800 dark:text-amber-200">
          The Hub doesn&apos;t have a Business Central sign-in for you.{" "}
          <a className="font-medium underline text-indigo-700 dark:text-indigo-300 inline-flex items-center min-h-11"
            href={`/api/bc/auth?return=${encodeURIComponent("/tools/cataloguing/end-of-day")}`}>Sign in to Business Central</a>, then try again.
        </p>
      )}
      {summary && <p className="mt-3 font-medium">{summary}</p>}
    </div>
  )
}
