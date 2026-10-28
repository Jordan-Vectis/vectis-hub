"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { checkRefundMoney, refundsToCheck, type RefundMoneyChecked, type RefundMoneyProblem } from "@/lib/actions/refunds"
import { REFUNDS_PATH, REFUND_STATUS_META, refundRefWords } from "@/lib/refunds"
import { bcConnectHref } from "@/lib/uncollected"
import { Spinner, btn, btnGo, inlineLink, muted, plural } from "./ui"

// Refunds → "Check the money" (Jack, 2026-10-28: "all of these need to be accurate — are they?", and
// "only flag — I'll check each one"). Every request, slice by slice (checkRefundMoney — READ ONLY, BC
// with the admin's own sign-in): each lot's hammer and commission against BC (the commission BC charged:
// buyer's premium + any web premium, inc VAT), the total against the old log's and what the lots work
// out at, lots that can't be worked out, and a day it came in that can't be right. NOTHING IS CHANGED —
// the requests with something to look at are listed, each linked, to put right on the request itself.
// Stop ends it after the slice in hand; Carry on checking goes on from there.

/** Requests per call — small, so the count moves and Stop is quick (a BC read each). */
const SLICE = 10
const SHOWN = 10

type Flagged = RefundMoneyChecked["flagged"][number]

/** The groups, in the order they're listed — each request goes under its first problem's. */
const KINDS: { kind: RefundMoneyProblem["kind"]; title: string }[] = [
  { kind: "bc", title: "BC has other figures" },
  { kind: "sums", title: "The total doesn't add up" },
  { kind: "date", title: "A date that can't be right" },
  { kind: "incomplete", title: "Lots that can't be worked out" },
  { kind: "nolots", title: "No lots to check" },
]

export default function MoneyCheck() {
  const [count, setCount] = useState<number | null>(null)
  const [countFailed, setCountFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null)
  const [checked, setChecked] = useState(0)
  const [flagged, setFlagged] = useState<Flagged[]>([])
  const [finished, setFinished] = useState<null | "done" | "stopped">(null)
  const [error, setError] = useState<string | null>(null)
  const [needsBc, setNeedsBc] = useState(false)
  const stop = useRef(false)
  const [stopping, setStopping] = useState(false)
  // Where a stopped (or failed) run got to — Check carries on from there; "start again" from the top.
  const cursor = useRef(0)
  const [resumable, setResumable] = useState(false)
  const live = useRef(true)

  function recount() {
    setCountFailed(false)
    refundsToCheck().then(
      res => { if (!live.current) return; if (res.ok) setCount(res.data.count); else setCountFailed(true) },
      () => { if (live.current) setCountFailed(true) },
    )
  }
  useEffect(() => {
    live.current = true
    recount()
    // Leaving the page stops the run after the batch in hand (nothing left asking BC unseen).
    return () => { live.current = false; stop.current = true }
  }, [])

  async function run(fromTop: boolean) {
    if (busy) return
    const resume = !fromTop && resumable
    if (!resume) { cursor.current = 0; setChecked(0); setFlagged([]) }
    setBusy(true); setError(null); setNeedsBc(false); setFinished(null)
    stop.current = false; setStopping(false)
    let done = resume ? checked : 0
    const found: Flagged[] = resume ? [...flagged] : []
    setProgress({ done, of: Math.max(done, count ?? 0) })
    try {
      for (;;) {
        const res = await checkRefundMoney(cursor.current, SLICE)
        if (!live.current) return
        if (!res.ok) {
          if (res.needsBc) setNeedsBc(true)
          setError(`${res.error}${done ? " Press Check to carry on from here." : ""}`)
          setResumable(done > 0)
          return
        }
        const d = res.data
        done += d.checked
        found.push(...d.flagged)
        setChecked(done); setFlagged([...found])
        setProgress({ done, of: done + d.remaining })
        if (d.lastRef == null || d.remaining === 0) { setFinished("done"); setResumable(false); cursor.current = 0; break }
        cursor.current = d.lastRef
        if (stop.current) { setFinished("stopped"); setResumable(true); break }
      }
    } catch {
      if (live.current) {
        setError("The Hub stopped answering — press Check to carry on from here.")
        setResumable(done > 0)
      }
    } finally {
      if (live.current) { setBusy(false); setStopping(false); recount() }
    }
  }

  const pct = progress && progress.of > 0 ? Math.round((progress.done / progress.of) * 100) : 0
  const groups = KINDS.map(k => ({ ...k, items: flagged.filter(f => f.problems[0]?.kind === k.kind) })).filter(g => g.items.length)

  return (
    <div>
      <p className="text-sm text-gray-600 dark:text-gray-300 max-w-3xl">
        Goes through {countFailed ? <>every request (they couldn&apos;t be counted just now — <button type="button" onClick={recount} className={inlineLink}>try again</button>)</> : count == null ? "every request" : <b>{plural(count, "request")}</b>} and
        lists the ones whose money or dates don&apos;t add up — <b>nothing is changed</b>. Put each right on the request itself.
      </p>
      <p className={`text-xs ${muted} mt-1 max-w-3xl`}>
        Each lot&apos;s hammer and commission are checked against BC (read only, your own BC sign-in) — the commission is what BC charged the
        buyer: the 22.5% premium + VAT, plus the web premium for anyone who bid online (32.94% in all). Then the total against the old log&apos;s
        and against what the lots work out at, lots that can&apos;t be worked out, and a day it came in that&apos;s in the future or before its sale.
      </p>

      <div className="mt-3 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
        <button type="button" onClick={() => run(false)} disabled={busy || count === 0 || (count == null && !countFailed)} className={btnGo}>
          {busy ? <><Spinner /> Checking…</> : resumable ? "🔎 Carry on checking" : count ? `🔎 Check the money on ${plural(count, "request")}` : "🔎 Check the money"}
        </button>
        {resumable && !busy && (
          <button type="button" onClick={() => run(true)} className={btn}>Start again from the first</button>
        )}
        {busy && (
          <button type="button" onClick={() => { stop.current = true; setStopping(true) }} disabled={stopping} className={btn}>
            {stopping ? "Stopping after this batch…" : "Stop"}
          </button>
        )}
      </div>

      {progress && busy && (
        <div className="mt-3 text-sm text-gray-700 dark:text-gray-300" aria-live="polite">
          <div className="flex flex-wrap justify-between gap-2 mb-1">
            <span>Checking — {progress.done.toLocaleString("en-GB")} of {progress.of.toLocaleString("en-GB")} · {plural(flagged.length, "to look at", "to look at")}{stopping ? " · stopping after this batch" : ""}</span>
            <span className="font-mono shrink-0">{pct}%</span>
          </div>
          <div className="h-1.5 rounded bg-gray-200 dark:bg-gray-800 overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {finished && (
        <p role="status" className="mt-3 rounded-xl border px-4 py-3 text-sm border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200">
          {finished === "stopped" ? "Stopped — " : "✓ "}{plural(checked, "request")} checked
          {flagged.length ? <>; {plural(flagged.length, "has", "have")} something to look at — listed below</> : <> — every one adds up</>}
          {finished === "stopped" && <>. Press Carry on checking to go on from here.</>} Nothing was changed.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-xl border px-4 py-3 text-sm border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200">
          {error}
          {needsBc && <> <a href={bcConnectHref(REFUNDS_PATH)} target="_blank" rel="noopener noreferrer" className={inlineLink}>Sign in to BC ↗</a> (a new tab), then press Check again.</>}
        </p>
      )}

      {groups.map(g => (
        <div key={g.kind} className="mt-4 text-sm">
          <p className="font-semibold text-gray-800 dark:text-gray-200">{g.title} — {plural(g.items.length, "request")}</p>
          <ul className="mt-1 space-y-1.5">
            {g.items.slice(0, SHOWN).map(f => <FlaggedLine key={f.id} f={f} />)}
          </ul>
          {g.items.length > SHOWN && (
            <details className="mt-1">
              <summary className="cursor-pointer min-h-11 inline-flex items-center text-xs font-semibold text-emerald-700 dark:text-emerald-400">Show the other {g.items.length - SHOWN}</summary>
              <ul className="mt-1 space-y-1.5">
                {g.items.slice(SHOWN).map(f => <FlaggedLine key={f.id} f={f} />)}
              </ul>
            </details>
          )}
        </div>
      ))}
    </div>
  )
}

function FlaggedLine({ f }: { f: Flagged }) {
  return (
    <li className="text-gray-700 dark:text-gray-300">
      <Link href={`${REFUNDS_PATH}/${f.id}`} prefetch={false} className="font-mono font-semibold underline underline-offset-2">{refundRefWords(f.ref)}</Link>
      <span className={`text-xs ${muted}`}> · {REFUND_STATUS_META[f.status].label}</span>
      <ul className="mt-0.5 ml-4 list-disc text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
        {f.problems.map((p, i) => <li key={i} className="break-words">{p.text}</li>)}
      </ul>
    </li>
  )
}
