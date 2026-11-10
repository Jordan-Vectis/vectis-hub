"use client"

import { useRef, useState } from "react"
import { bcSandboxSendContainer, bcSandboxStart } from "@/lib/actions/goods-in-bc-sandbox"
import type { BcStep } from "@/lib/goods-in/bc-sandbox"
import { ErrorBox, box, btn, btnGo, mono } from "../../_components/ui"

// Goods In → a receipt → "Send to BC sandbox (test)" — Warehouse admins only. The rules are in
// lib/goods-in/bc-sandbox.ts and lib/actions/goods-in-bc-sandbox.ts.
//
// The browser drives it, one call per tote (RULES.md 7b): the count moves as each one goes, Stop
// works between them, and the end says what happened in numbers. It asks in place before sending
// (never window.confirm). Nothing in the Hub changes — only the sandbox.

const MARK: Record<BcStep["outcome"], { sym: string; cls: string; word: string }> = {
  made: { sym: "✓", cls: "text-emerald-700 dark:text-emerald-300", word: "made in the sandbox now" },
  there: { sym: "=", cls: "text-gray-500 dark:text-gray-400", word: "the sandbox already had it, nothing sent" },
  failed: { sym: "✗", cls: "text-red-700 dark:text-red-300", word: "Business Central refused it (its words shown)" },
}

type Phase = "idle" | "confirm" | "running" | "done"

export default function BcSandboxTest({ receiptId, vendorNo, containerCount, environment, offReason }: {
  receiptId: string
  vendorNo: string | null
  containerCount: number
  /** The sandbox environment test writes go to; null when switched off. */
  environment: string | null
  /** Why it's switched off, in words; null when it can run. */
  offReason: string | null
}) {
  const [phase, setPhase] = useState<Phase>("idle")
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

    const start = await bcSandboxStart(receiptId).catch(e => ({ ok: false as const, error: String(e?.message ?? e) }))
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
      const res = await bcSandboxSendContainer(receiptId, list[i].id).catch(e => ({ ok: false as const, error: String(e?.message ?? e) }))
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

    const receiptWord = start.data.receipt.outcome === "made" ? "Receipt made in the sandbox" : "Receipt already in the sandbox"
    const totesWord = list.length === 0
      ? "this receipt has no totes or pallets, so none were sent"
      : `${sent} of ${list.length} totes and pallets sent in full${failedTotes ? `, ${failedTotes} refused` : ""}`
    setSummary(stopped
      ? `Stopped. ${receiptWord}; ${sent} of ${list.length} totes and pallets were sent before you stopped — the rest weren't.`
      : `${receiptWord}; ${totesWord}.`)
  }

  return (
    <section className={`${box} mb-6 px-4 py-3`} aria-labelledby="bc-sandbox-heading">
      <h2 id="bc-sandbox-heading" className="text-sm font-semibold text-gray-900 dark:text-white">Business Central sandbox test</h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        Admins only. Sends this receipt and its totes and pallets to BC&apos;s <b>sandbox</b> — never live BC — signed in as you. Nothing in the Hub changes.
      </p>

      {off ? (
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{off}</p>
      ) : !vendorNo ? (
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">This receipt has no vendor number, and Business Central refuses a tote on a receipt without one — try a receipt for a customer who has one.</p>
      ) : (
        <>
          {phase === "idle" && (
            <button type="button" className={`${btn} mt-3`} onClick={() => setPhase("confirm")}>Send to BC sandbox (test)…</button>
          )}

          {phase === "confirm" && (
            <div className="mt-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-3 text-sm text-amber-900 dark:text-amber-100">
              <p>
                This makes receipt <span className={mono}>{receiptId}</span> (vendor <span className={mono}>{vendorNo}</span>) and its{" "}
                {containerCount} {containerCount === 1 ? "tote or pallet" : "totes and pallets"} in Business Central&apos;s{" "}
                <b className={mono}>{environment}</b> environment, under the same numbers, with you as the person who made them.
                Anything the sandbox already has is left alone.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={btnGo} onClick={run}>Send to the sandbox</button>
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
              <button type="button" className={btn} onClick={() => setPhase("confirm")}>Send again…</button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
