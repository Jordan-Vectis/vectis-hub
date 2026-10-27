"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { matchRefundSales, refundSalesToMatch, type RefundSalesMatched } from "@/lib/actions/refunds"
import { REFUNDS_PATH, refundRefWords } from "@/lib/refunds"
import { bcConnectHref } from "@/lib/uncollected"
import { Spinner, btn, btnGo, inlineLink, muted, plural } from "./ui"

// Refunds → "Match sales from BC" (Jack, 2026-10-26: "the sale is either an F/E number but these say no
// sale or it's a date — can you match it and import it"). The requests with no sale code — the old
// log's (it kept the auction date, not the sale), and public-form ones (customers give the date) — are
// looked up in BC slice by slice (matchRefundSales, READ ONLY, the admin's own BC sign-in): only a sale
// that's the ONLY one fitting the buyer's C-number, the auction date and the lot numbers is saved, with
// each lot's unique ID, barcode and receipt. Money is never changed. What couldn't be matched is listed
// with why, to check by hand. Stop ends it after the slice in hand; Carry on matching goes on from there.

/** Requests per call — small, so the count moves and Stop is quick (each is a BC read or three). */
const SLICE = 8
const SHOWN = 8

type NotMatched = RefundSalesMatched["notMatched"][number]

export default function MatchSales() {
  const router = useRouter()
  const [count, setCount] = useState<number | null>(null)
  const [countFailed, setCountFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null)
  const [matched, setMatched] = useState(0)
  const [lotsFilled, setLotsFilled] = useState(0)
  const [notMatched, setNotMatched] = useState<NotMatched[]>([])
  const [finished, setFinished] = useState<null | "done" | "stopped">(null)
  const [error, setError] = useState<string | null>(null)
  const [needsBc, setNeedsBc] = useState(false)
  const [barcodesFailed, setBarcodesFailed] = useState(false)
  const stop = useRef(false)
  const [stopping, setStopping] = useState(false)
  // Where a stopped (or failed) run got to — Match carries on from there; "start again" from the top.
  const cursor = useRef(0)
  const [resumable, setResumable] = useState(false)
  const live = useRef(true)

  function recount() {
    setCountFailed(false)
    refundSalesToMatch().then(
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
    if (!resume) { cursor.current = 0; setMatched(0); setLotsFilled(0); setNotMatched([]) }
    setBusy(true); setError(null); setNeedsBc(false); setFinished(null); setBarcodesFailed(false)
    stop.current = false; setStopping(false)
    let gotMatched = resume ? matched : 0, gotLots = resume ? lotsFilled : 0
    const missed: NotMatched[] = resume ? [...notMatched] : []
    let done = gotMatched + missed.length
    let savedThisRun = 0
    setProgress({ done, of: done + (count ?? 0) })
    try {
      for (;;) {
        const res = await matchRefundSales(cursor.current, SLICE)
        if (!live.current) return
        if (!res.ok) {
          if (res.needsBc) setNeedsBc(true)
          setError(savedThisRun ? `${plural(savedThisRun, "sale")} matched and saved before this. ${res.error} Press Match to carry on from here.` : res.error)
          setResumable(true)
          return
        }
        const d = res.data
        gotMatched += d.matched.length
        savedThisRun += d.matched.length
        gotLots += d.matched.reduce((s, m) => s + m.lots, 0)
        missed.push(...d.notMatched)
        done += d.matched.length + d.notMatched.length
        setMatched(gotMatched); setLotsFilled(gotLots); setNotMatched([...missed])
        if (d.barcodesFailed) setBarcodesFailed(true)
        setProgress({ done, of: done + d.remaining })
        if (d.lastRef == null || d.remaining === 0) { setFinished("done"); setResumable(false); cursor.current = 0; break }
        cursor.current = d.lastRef
        if (stop.current) { setFinished("stopped"); setResumable(true); break }
      }
    } catch {
      if (live.current) {
        setError(`${savedThisRun ? `${plural(savedThisRun, "sale")} matched and saved, then the` : "The"} Hub stopped answering — press Match to carry on from here (a request given its sale isn't looked at again).`)
        setResumable(true)
      }
    } finally {
      if (live.current) {
        setBusy(false); setStopping(false)
        if (savedThisRun) router.refresh()
        recount()
      }
    }
  }

  const pct = progress && progress.of > 0 ? Math.round((progress.done / progress.of) * 100) : 0
  const ambiguous = notMatched.filter(n => n.kind === "ambiguous").length
  const none = notMatched.filter(n => n.kind === "none").length
  const cant = notMatched.filter(n => n.kind === "cant").length

  return (
    <div>
      <p className="text-sm text-gray-600 dark:text-gray-300 max-w-3xl">
        {countFailed ? <>The requests with no sale couldn&apos;t be counted just now. <button type="button" onClick={recount} className={inlineLink}>Try again</button></> : count == null ? "Counting the requests with no sale…" : count === 0
          ? "Every request has its sale (F or E number)."
          : <><b>{plural(count, "request")}</b> {count === 1 ? "has" : "have"} no sale (F or E number) — the old log kept the auction date instead, and the refund form asks for the date.</>}
      </p>
      <p className={`text-xs ${muted} mt-1 max-w-3xl`}>
        This asks BC (read only, your own BC sign-in) which sale each was in, from the buyer&apos;s C-number, the auction date and the lot
        numbers, and saves it — with each lot&apos;s unique ID, barcode and receipt number. Only a sale that&apos;s the <b>only one</b> that fits is
        saved; anything else is listed below to check by hand. Money is never changed, and a sale someone has typed in is never replaced.
      </p>

      <div className="mt-3 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
        <button type="button" onClick={() => run(false)} disabled={busy || count === 0 || (count == null && !countFailed)} className={btnGo}>
          {busy ? <><Spinner /> Matching…</> : resumable ? "🔗 Carry on matching" : count ? `🔗 Match ${plural(count, "sale")} from BC` : "🔗 Match sales from BC"}
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
            <span>Looking them up — {progress.done.toLocaleString("en-GB")} of {progress.of.toLocaleString("en-GB")} · {plural(matched, "sale")} matched{stopping ? " · stopping after this batch" : ""}</span>
            <span className="font-mono shrink-0">{pct}%</span>
          </div>
          <div className="h-1.5 rounded bg-gray-200 dark:bg-gray-800 overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {finished && (
        <p role="status" className="mt-3 rounded-xl border px-4 py-3 text-sm border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200">
          {finished === "stopped" ? "Stopped — " : "✓ "}{plural(matched, "sale")} matched and saved{lotsFilled ? ` (${plural(lotsFilled, "lot")} given BC's unique ID, barcode and receipt)` : ""}
          {notMatched.length > 0 && <>; {plural(notMatched.length, "request")} couldn&apos;t be matched — listed below</>}
          {finished === "stopped" && <>. Press Carry on matching to go on from here.</>}
          {barcodesFailed && <> BC&apos;s receipt lines couldn&apos;t be read for some, so their barcodes aren&apos;t in — &ldquo;Get barcodes from BC&rdquo; on the request fills them later.</>}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-xl border px-4 py-3 text-sm border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200">
          {error}
          {needsBc && <> <a href={bcConnectHref(REFUNDS_PATH)} target="_blank" rel="noopener noreferrer" className={inlineLink}>Sign in to BC ↗</a> (a new tab), then press Match again.</>}
        </p>
      )}

      {notMatched.length > 0 && (
        <div className="mt-3 text-sm">
          <p className="font-semibold text-gray-800 dark:text-gray-200">Not matched — {[ambiguous && `${ambiguous} could be more than one sale`, none && `${none} not found in BC`, cant && `${cant} with nothing to find them by`].filter(Boolean).join(", ")}</p>
          <ul className="mt-1 space-y-0.5">
            {notMatched.slice(0, SHOWN).map(n => <NotMatchedLine key={n.id} n={n} />)}
          </ul>
          {notMatched.length > SHOWN && (
            <details className="mt-1">
              <summary className="cursor-pointer min-h-11 inline-flex items-center text-xs font-semibold text-emerald-700 dark:text-emerald-400">Show the other {notMatched.length - SHOWN}</summary>
              <ul className="mt-1 space-y-0.5">
                {notMatched.slice(SHOWN).map(n => <NotMatchedLine key={n.id} n={n} />)}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

function NotMatchedLine({ n }: { n: NotMatched }) {
  return (
    <li className="text-gray-700 dark:text-gray-300">
      <Link href={`${REFUNDS_PATH}/${n.id}`} prefetch={false} className="font-mono font-semibold underline underline-offset-2">{refundRefWords(n.ref)}</Link>
      <span className={muted}> — {n.why}</span>
    </li>
  )
}
