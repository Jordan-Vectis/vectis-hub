"use client"

import { useRef, useState } from "react"
import { bcLotSend, bcLotsStart, type BcLotsStart } from "@/lib/actions/goods-in-bc-sandbox"
import type { BcStep } from "@/lib/goods-in/bc-sandbox"
import { ErrorBox, box, btn, btnGo, mono } from "../../_components/ui"

// Goods In → a receipt → "Send lots to BC test environment" — Warehouse admins only. Sends every lot
// catalogued onto this receipt to BC as a receipt line, on this receipt and on the lot's sale. The rules
// are in lib/goods-in/bc-sandbox.ts (sendLot) and lib/actions/goods-in-bc-sandbox.ts (bcLotsStart / bcLotSend).
//
// "Check" is read-only (is the receipt in BC? which lots?), then it asks in place before sending. The
// browser drives one call per lot (RULES.md 7b): the count moves, Stop works between lots, and the end
// says what happened in numbers. Nothing in the Hub changes — BC's UniqueIDs only show here.

const MARK: Record<BcStep["outcome"], { sym: string; cls: string; word: string }> = {
  made: { sym: "✓", cls: "text-emerald-700 dark:text-emerald-300", word: "made in the BC test environment now" },
  there: { sym: "=", cls: "text-gray-500 dark:text-gray-400", word: "it was already there, nothing sent" },
  failed: { sym: "✗", cls: "text-red-700 dark:text-red-300", word: "Business Central refused it (its words shown)" },
}

type Phase = "idle" | "checking" | "confirm" | "running" | "done"

type PlanLot = BcLotsStart["lots"][number]

const money = (n: number) => `£${n.toLocaleString("en-GB")}`

function estimateText(lo: number | null, hi: number | null): string | null {
  if (lo == null && hi == null) return null
  if (lo != null && hi != null) return `${money(lo)}–${money(hi)}`
  return lo != null ? `low ${money(lo)}` : `high ${money(hi as number)}`
}

/** One field on a lot card: the value as it goes to BC, or a plain "not sent" when the lot has none. */
function Field({ label, value, note }: { label: string; value: string | null; note?: string | null }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-amber-800/80 dark:text-amber-200/70">{label} </span>
      {value
        ? <b className="font-medium text-gray-900 dark:text-white">{value}</b>
        : <span className="italic text-gray-500 dark:text-gray-400">not sent{note ? ` (${note})` : ""}</span>}
    </span>
  )
}

/** What one lot will put on its BC line — the same values the send uses (lotPreview in bc-sandbox.ts). */
function LotCard({ n, lot }: { n: number; lot: PlanLot }) {
  const category = lot.category ? `${lot.category}${lot.subCategory ? ` / ${lot.subCategory}` : ""}` : null
  return (
    <li className="rounded-md border border-amber-200 dark:border-amber-900 bg-white/70 dark:bg-gray-900/50 px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-xs text-gray-500 dark:text-gray-400">{n}.</span>
        <span className={`${mono} font-semibold text-gray-900 dark:text-white`}>{lot.barcode ?? "no barcode"}</span>
        <span className="text-gray-900 dark:text-white">{lot.shortDescription}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <Field label="Sale" value={lot.sale} />
        <Field label="Estimate" value={estimateText(lot.estimateLow, lot.estimateHigh)} />
        <Field label="Category" value={category} />
        <Field label="Tote" value={lot.tote} />
        <Field label="Size" value={lot.size} note={lot.sizeUnknown ? `"${lot.sizeUnknown}" isn't a size BC has` : null} />
      </div>
      {lot.description ? (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer select-none text-indigo-700 dark:text-indigo-300 min-h-8 inline-flex items-center">
            Description ({lot.description.length} characters)
          </summary>
          <p className="mt-1 whitespace-pre-wrap text-gray-800 dark:text-gray-200">{lot.description}</p>
        </details>
      ) : (
        <p className="mt-1 text-xs"><Field label="Description" value={null} /></p>
      )}
    </li>
  )
}

/** BC's own Receipt Lines list for this receipt, in the test environment — where the lines can be seen. */
function BcLink({ url, environment, receiptId }: { url: string; environment: string; receiptId: string }) {
  return (
    <p className="mt-3 text-sm">
      <a href={url} target="_blank" rel="noreferrer"
        className="font-medium underline text-indigo-700 dark:text-indigo-300 inline-flex items-center min-h-11">
        See {receiptId}&apos;s lines in BC ({environment}) ↗
      </a>
    </p>
  )
}

export default function BcLotsTest({ receiptId, environment, offReason }: {
  receiptId: string
  /** The BC test environment writes go to (never live BC); null when switched off. */
  environment: string | null
  /** Why it's switched off, in words; null when it can run. */
  offReason: string | null
}) {
  const [phase, setPhase] = useState<Phase>("idle")
  const [plan, setPlan] = useState<BcLotsStart | null>(null)
  const [steps, setSteps] = useState<BcStep[]>([])
  const [error, setError] = useState<string | null>(null)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const stopRef = useRef(false)

  const off = offReason ?? (environment ? null : "Switched off on this server.")

  async function check() {
    setPhase("checking")
    setError(null)
    setNeedsSignIn(false)
    setSteps([])
    setSummary(null)
    const res = await bcLotsStart(receiptId).catch(e => ({ ok: false as const, error: String(e?.message ?? e) }))
    if (!res.ok) {
      if (res.error === "NO_BC_SIGN_IN") setNeedsSignIn(true)
      else setError(res.error)
      setPhase("idle")
      return
    }
    setPlan(res.data)
    setSteps([res.data.receipt])
    setPhase(res.data.receipt.outcome === "failed" ? "done" : "confirm")
    if (res.data.receipt.outcome === "failed") setSummary("The receipt isn't in the BC test environment, so no lots were sent.")
  }

  async function run() {
    if (!plan) return
    stopRef.current = false
    setPhase("running")
    const all: BcStep[] = [plan.receipt]
    setSteps([...all])
    let full = 0
    let already = 0
    let refused = 0
    let stopped = false
    for (let i = 0; i < plan.lots.length; i++) {
      if (stopRef.current) { stopped = true; break }
      const lot = plan.lots[i]
      setProgress({ done: i, total: plan.lots.length, current: lot.barcode || lot.shortDescription.slice(0, 30) })
      const res = await bcLotSend(receiptId, lot.id).catch(e => ({ ok: false as const, error: String(e?.message ?? e) }))
      if (!res.ok) {
        all.push({ what: lot.barcode ? `Lot ${lot.barcode}` : `Lot "${lot.shortDescription.slice(0, 40)}"`, outcome: "failed", detail: res.error })
        refused++
      } else {
        all.push(...res.data)
        if (res.data.some(s => s.outcome === "failed")) refused++
        else if (res.data.some(s => s.outcome === "made")) full++
        else already++
      }
      setSteps([...all])
    }
    setProgress(null)
    setPhase("done")
    const done = full + already + refused
    setSummary(`${stopped ? `Stopped after ${done} of ${plan.lots.length} lots — the rest weren't sent. ` : ""}`
      + `${full} sent in full, ${already} already in BC, ${refused} refused${stopped ? "" : ` — of ${plan.lots.length} lots`}.`)
  }

  return (
    <section className={`${box} mb-6 px-4 py-3`} aria-labelledby="bc-lots-heading">
      <h2 id="bc-lots-heading" className="text-sm font-semibold text-gray-900 dark:text-white">Lots → Business Central test</h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        Admins only. Sends every lot catalogued onto <span className={mono}>{receiptId}</span> to a BC <b>test</b> environment
        {environment ? <> — <b className={mono}>{environment}</b></> : null} — never live BC — as a line on this receipt and on the
        lot&apos;s sale: short description, description, estimates, category, subcategory, tote, size and internal barcode. BC gives each its
        UniqueID. Signed in as you; nothing in the Hub changes.
      </p>

      {off ? (
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{off}</p>
      ) : (
        <>
          {phase === "idle" && (
            <button type="button" className={`${btn} mt-3`} onClick={check}>Check and send lots…</button>
          )}
          {phase === "checking" && (
            <p className="mt-3 text-sm text-gray-700 dark:text-gray-200" role="status">Checking {receiptId} is in BC and finding its lots…</p>
          )}

          {phase === "confirm" && plan && (
            <div className="mt-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-3 text-sm text-amber-900 dark:text-amber-100">
              {plan.lots.length === 0 ? (
                <p>No lots are catalogued onto {receiptId} yet, so there&apos;s nothing to send.</p>
              ) : (
                <p>
                  This makes <b>{plan.lots.length}</b> {plan.lots.length === 1 ? "line" : "lines"} on receipt <span className={mono}>{receiptId}</span> in
                  Business Central&apos;s <b className={mono}>{plan.environment}</b> environment, each on its lot&apos;s sale. A lot whose barcode
                  BC already has is left alone.
                </p>
              )}
              {plan.elsewhere > 0 && (
                <p className="mt-2">{plan.elsewhere} other {plan.elsewhere === 1 ? "lot sits" : "lots sit"} on this receipt&apos;s totes but {plan.elsewhere === 1 ? "is" : "are"} catalogued onto another receipt — left out; send {plan.elsewhere === 1 ? "it" : "them"} from that receipt.</p>
              )}
              {plan.lots.length > 0 && (
                <>
                  <p className="mt-3 font-medium">What each lot sends — nothing is sent until you press Send:</p>
                  <ol className="mt-2 space-y-2">
                    {plan.lots.map((l, i) => <LotCard key={l.id} n={i + 1} lot={l} />)}
                  </ol>
                  <p className="mt-2 text-xs">
                    BC adds the rest itself: the article number and UniqueID (e.g. {receiptId}-1), and the vendor and contact from the receipt.
                    A value marked &ldquo;not sent&rdquo; is blank on the lot in the Hub.
                  </p>
                </>
              )}
              {plan.bcLinesUrl && <BcLink url={plan.bcLinesUrl} environment={plan.environment} receiptId={receiptId} />}
              <div className="mt-3 flex flex-wrap gap-2">
                {plan.lots.length > 0 && (
                  <button type="button" className={btnGo} onClick={run}>Send {plan.lots.length} {plan.lots.length === 1 ? "lot" : "lots"} to {plan.environment}</button>
                )}
                <button type="button" className={btn} onClick={() => { setPhase("idle"); setSteps([]) }}>Cancel</button>
              </div>
            </div>
          )}

          {phase === "running" && progress && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-gray-700 dark:text-gray-200" role="status" aria-live="polite">
              <span>Lot {Math.min(progress.done + 1, progress.total)} of {progress.total}: <span className={mono}>{progress.current}</span>…</span>
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
              {plan?.bcLinesUrl && <BcLink url={plan.bcLinesUrl} environment={plan.environment} receiptId={receiptId} />}
              <button type="button" className={btn} onClick={check}>Check and send again…</button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
