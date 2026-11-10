"use client"

import { useRef, useState } from "react"
import { bcSandboxSendContainer, bcSandboxStart } from "@/lib/actions/goods-in-bc-sandbox"
import type { BcStep } from "@/lib/goods-in/bc-sandbox"
import { ErrorBox, box, btn, btnGo, mono } from "../../_components/ui"

// Goods In → a receipt → "Send to a BC test environment" (never live BC) — Warehouse admins only. The
// rules are in lib/goods-in/bc-sandbox.ts and lib/actions/goods-in-bc-sandbox.ts.
//
// The browser drives it, one call per tote (RULES.md 7b): the count moves as each one goes, Stop
// works between them, and the end says what happened in numbers. It asks in place before sending
// (never window.confirm). Nothing in the Hub changes — only the BC test environment.

const MARK: Record<BcStep["outcome"], { sym: string; cls: string; word: string }> = {
  made: { sym: "✓", cls: "text-emerald-700 dark:text-emerald-300", word: "made in the BC test environment now" },
  there: { sym: "=", cls: "text-gray-500 dark:text-gray-400", word: "it was already there, nothing sent" },
  failed: { sym: "✗", cls: "text-red-700 dark:text-red-300", word: "Business Central refused it (its words shown)" },
}

type Phase = "idle" | "confirm" | "running" | "done"

export default function BcSandboxTest({ receiptId, vendorNo, containerCount, environment, offReason, live = false, liveReceipt = null }: {
  receiptId: string
  vendorNo: string | null
  containerCount: number
  /** The BC environment writes go to; null when switched off. */
  environment: string | null
  /** Why it's switched off, in words; null when it can run. */
  offReason: string | null
  /** True when writes go to LIVE BC (the one-receipt test from the Hub sandbox). */
  live?: boolean
  /** The ONE receipt allowed to go to live BC (BC_WRITE_LIVE_RECEIPT). */
  liveReceipt?: string | null
}) {
  const [phase, setPhase] = useState<Phase>("idle")
  const [typed, setTyped] = useState("")
  const typedOk = !live || typed.trim().toUpperCase() === receiptId.toUpperCase()
  const notThisOne = live && liveReceipt && liveReceipt.toUpperCase() !== receiptId.toUpperCase()
  const [steps, setSteps] = useState<BcStep[]>([])
  const [error, setError] = useState<string | null>(null)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; current: string | null } | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const stopRef = useRef(false)

  const off = offReason ?? (environment ? null : "Switched off on this server.")

  async function run() {
    stopRef.current = false
    setPhase("running")
    setSteps([])
    setError(null)
    setNeedsSignIn(false)
    setSummary(null)
    setProgress({ done: 0, total: containerCount, current: `receipt ${receiptId}` })

    const start = await bcSandboxStart(receiptId, typed).catch(e => ({ ok: false as const, error: String(e?.message ?? e) }))
    if (!start.ok) {
      if (start.error === "NO_BC_SIGN_IN") setNeedsSignIn(true)
      else setError(start.error)
      setProgress(null)
      setPhase("done")
      setSummary("Nothing was sent.")
      return
    }
    const all: BcStep[] = [start.data.receipt]
    setSteps([...all])
    if (start.data.receipt.outcome === "failed") {
      setProgress(null)
      setPhase("done")
      setSummary("The receipt didn't go, so no totes were sent.")
      return
    }

    const list = start.data.containers
    let sent = 0
    let failedTotes = 0
    let stopped = false
    for (let i = 0; i < list.length; i++) {
      if (stopRef.current) { stopped = true; break }
      setProgress({ done: i, total: list.length, current: list[i].id })
      const res = await bcSandboxSendContainer(receiptId, list[i].id, typed).catch(e => ({ ok: false as const, error: String(e?.message ?? e) }))
      if (!res.ok) {
        all.push({ what: `Tote ${list[i].id}`, outcome: "failed", detail: res.error })
        failedTotes++
      } else {
        all.push(...res.data)
        if (res.data.some(s => s.outcome === "failed")) failedTotes++
        else sent++
      }
      setSteps([...all])
    }
    setProgress(null)
    setPhase("done")

    const receiptWord = start.data.receipt.outcome === "made" ? `Receipt made in ${start.data.environment}` : `Receipt already in ${start.data.environment}`
    const totesWord = list.length === 0
      ? "this receipt has no totes or pallets, so none were sent"
      : `${sent} of ${list.length} totes and pallets sent in full${failedTotes ? `, ${failedTotes} refused` : ""}`
    setSummary(stopped
      ? `Stopped. ${receiptWord}; ${sent} of ${list.length} totes and pallets were sent before you stopped — the rest weren't.`
      : `${receiptWord}; ${totesWord}.`)
  }

  return (
    <section className={`${live ? "rounded-xl border-2 border-red-500 dark:border-red-600 bg-red-50 dark:bg-red-950/40" : box} mb-6 px-4 py-3`} aria-labelledby="bc-sandbox-heading">
      <h2 id="bc-sandbox-heading" className={`text-sm font-semibold ${live ? "text-red-800 dark:text-red-200" : "text-gray-900 dark:text-white"}`}>
        {live ? "⚠ LIVE BUSINESS CENTRAL — one test receipt" : "Business Central test"}
      </h2>
      {live ? (
        <p className="mt-1 text-sm text-red-900 dark:text-red-100">
          Admins only. Sends this receipt and its totes and pallets to <b>LIVE</b> Business Central (<b className={mono}>{environment}</b>), signed in as you.
          They become real records that staff can see — delete them in BC after the test. Only receipt{" "}
          <b className={mono}>{liveReceipt ?? "—"}</b> can go (BC_WRITE_LIVE_RECEIPT).
        </p>
      ) : (
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Admins only. Sends this receipt and its totes and pallets to a BC <b>test</b> environment{environment ? <> — <b className={mono}>{environment}</b></> : null} — never live BC — signed in as you. Nothing in the Hub changes.
        </p>
      )}

      {off ? (
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{off}</p>
      ) : notThisOne ? (
        <p className="mt-2 text-sm text-red-800 dark:text-red-200">Only receipt <b className={mono}>{liveReceipt}</b> may be sent to live Business Central — not this one.</p>
      ) : !vendorNo ? (
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">This receipt has no vendor number, and Business Central refuses a tote on a receipt without one — try a receipt for a customer who has one.</p>
      ) : (
        <>
          {phase === "idle" && (
            <button type="button" className={`${btn} mt-3`} onClick={() => { setTyped(""); setPhase("confirm") }}>
              {live ? "Send to LIVE Business Central…" : "Send to BC test environment…"}
            </button>
          )}

          {phase === "confirm" && (
            <div className={`mt-3 rounded-lg border px-3 py-3 text-sm ${live
              ? "border-red-400 dark:border-red-700 bg-white dark:bg-gray-900 text-red-900 dark:text-red-100"
              : "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100"}`}>
              <p>
                This makes receipt <span className={mono}>{receiptId}</span> (vendor <span className={mono}>{vendorNo}</span>) and its{" "}
                {containerCount} {containerCount === 1 ? "tote or pallet" : "totes and pallets"} in Business Central&apos;s{" "}
                <b className={mono}>{environment}</b> environment{live ? <> — <b>LIVE BC</b></> : null}, under the same numbers, with you as the person who made them.
                Anything it already has is left alone.
              </p>
              {live && (
                <label className="mt-3 block">
                  <span className="block font-medium">Type <span className={mono}>{receiptId}</span> to confirm sending it to live Business Central</span>
                  <input
                    value={typed}
                    onChange={e => setTyped(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    className={`${mono} mt-1 w-full max-w-xs min-h-11 rounded-lg border border-red-400 dark:border-red-700 bg-white dark:bg-gray-950 px-3 text-gray-900 dark:text-white`}
                  />
                </label>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={btnGo} onClick={run} disabled={!typedOk}>
                  {live ? "Send to LIVE Business Central" : <>Send to {environment}</>}
                </button>
                <button type="button" className={btn} onClick={() => setPhase("idle")}>Cancel</button>
              </div>
            </div>
          )}

          {phase === "running" && progress && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-gray-700 dark:text-gray-200" role="status" aria-live="polite">
              <span>
                {progress.current?.startsWith("receipt")
                  ? <>Sending the receipt…</>
                  : <>Tote {Math.min(progress.done + 1, progress.total)} of {progress.total}: <span className={mono}>{progress.current}</span>…</>}
              </span>
              <button type="button" className={btn} onClick={() => { stopRef.current = true }}>Stop after this one</button>
            </div>
          )}

          {needsSignIn && (
            <p className="mt-3 text-sm text-amber-800 dark:text-amber-200">
              The Hub doesn&apos;t have a Business Central sign-in for you on this server.{" "}
              <a className="font-medium underline text-indigo-700 dark:text-indigo-300 inline-flex items-center min-h-11"
                href={`/api/bc/auth?return=${encodeURIComponent(`/tools/warehouse/receipts/${receiptId}`)}`}>
                Sign in to Business Central
              </a>
              , then press it again.
            </p>
          )}

          {error && <div className="mt-3"><ErrorBox>{error}</ErrorBox></div>}

          {steps.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden className={`w-4 shrink-0 font-bold ${MARK[s.outcome].cls}`}>{MARK[s.outcome].sym}</span>
                  <span>
                    <span className={`${mono} font-medium text-gray-900 dark:text-white`}>{s.what}</span>
                    <span className="sr-only"> — {MARK[s.outcome].word}</span>
                    <span className={s.outcome === "failed" ? " text-red-700 dark:text-red-300" : " text-gray-600 dark:text-gray-300"}> — {s.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {phase === "done" && (
            <div className="mt-3 space-y-2">
              {summary && <p className="text-sm font-medium text-gray-900 dark:text-white">{summary}</p>}
              {steps.length > 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {(["made", "there", "failed"] as const).map(k => (
                    <span key={k} className="mr-3"><b className={MARK[k].cls}>{MARK[k].sym}</b> {MARK[k].word}</span>
                  ))}
                </p>
              )}
              <button type="button" className={btn} onClick={() => { setTyped(""); setPhase("confirm") }}>Send again…</button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
