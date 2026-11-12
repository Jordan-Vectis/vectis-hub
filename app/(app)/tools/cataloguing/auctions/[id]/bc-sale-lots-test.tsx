"use client"

import { useRef, useState } from "react"
import { bcSaleLotSend, bcSaleLotsStart, bcSaleReceiptCheck, type BcSaleLotsStart, type BcSaleReceipt } from "@/lib/actions/goods-in-bc-sandbox"
import type { BcStep } from "@/lib/goods-in/bc-sandbox"
import { ErrorBox, box, btn, btnGo, mono } from "../../../warehouse/_components/ui"
import { BcLink, LotCard, MARK, StepKey, StepList, lotOutcome } from "../../../warehouse/_components/bc-lot-parts"

// A sale → 📤 Push to BC → "Send lots to BC" — admins only (Jack, 2026-11-12). The receipt page's
// "Lots → Business Central test" send, started from the sale: every lot on the sale goes to a BC TEST
// environment as a line on the receipt it was catalogued onto, allocated to this sale. The rules are in
// lib/goods-in/bc-sandbox.ts (sendLot) and lib/actions/goods-in-bc-sandbox.ts (bcSaleLotsStart /
// bcSaleReceiptCheck / bcSaleLotSend).
//
// Pressing the button sends NOTHING: it lists every lot by receipt and checks each receipt is in BC (a
// count that moves), then shows exactly what each lot sends. Only "Send N lots" sends — one call per lot,
// Stop between lots, and the end says what happened in numbers (RULES.md 7b). Nothing in the Hub changes.

type Phase = "idle" | "listing" | "checking" | "confirm" | "running" | "done"

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export default function BcSaleLotsTest({ auctionId, saleCode, environment, offReason }: {
  auctionId: string
  saleCode: string
  /** The BC test environment writes go to (never live BC); null when switched off. */
  environment: string | null
  /** Why it's switched off, in words; null when it can run. */
  offReason: string | null
}) {
  const [phase, setPhase] = useState<Phase>("idle")
  const [plan, setPlan] = useState<BcSaleLotsStart | null>(null)
  const [inBc, setInBc] = useState<Record<string, BcStep>>({})
  const [steps, setSteps] = useState<BcStep[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const stopRef = useRef(false)

  const off = offReason ?? (environment ? null : "Switched off on this server.")

  // A receipt's lots go only when the Hub has nothing against it AND BC has the receipt.
  const sendable = (r: BcSaleReceipt) => !r.hubNote && inBc[r.receiptId]?.outcome === "there"
  const going = plan ? plan.receipts.filter(sendable) : []
  const notGoing = plan ? plan.receipts.filter(r => !sendable(r)) : []
  const goingLots = going.reduce((n, r) => n + r.lots.length, 0)
  const notInBc = notGoing.filter(r => !r.hubNote)
  const notInBcLots = notInBc.reduce((n, r) => n + r.lots.length, 0)
  const hubHeld = notGoing.filter(r => r.hubNote)
  const hubHeldLots = hubHeld.reduce((n, r) => n + r.lots.length, 0)
  const leftOut = notInBcLots + hubHeldLots + (plan?.noReceipt.length ?? 0)

  async function check() {
    setPhase("listing")
    setError(null)
    setNotice(null)
    setNeedsSignIn(false)
    setSteps([])
    setSummary(null)
    setInBc({})
    const res = await bcSaleLotsStart(auctionId).catch(e => ({ ok: false as const, error: String(e?.message ?? e) }))
    if (!res.ok) {
      if (res.error === "NO_BC_SIGN_IN") setNeedsSignIn(true)
      else setError(res.error)
      setPhase("idle")
      return
    }
    setPlan(res.data)

    // Is each receipt in BC? One call each, so the count moves and Stop works.
    stopRef.current = false
    setPhase("checking")
    const toCheck = res.data.receipts.filter(r => !r.hubNote)
    const found: Record<string, BcStep> = {}
    for (let i = 0; i < toCheck.length; i++) {
      if (stopRef.current) {
        setProgress(null)
        setPlan(null)
        setPhase("idle")
        setNotice(`Checking stopped after ${i} of ${toCheck.length} receipts — nothing was sent.`)
        return
      }
      const r = toCheck[i]
      setProgress({ done: i, total: toCheck.length, current: r.receiptId })
      const c = await bcSaleReceiptCheck(auctionId, r.receiptId).catch(e => ({ ok: false as const, error: String(e?.message ?? e) }))
      if (!c.ok && c.error === "NO_BC_SIGN_IN") { setProgress(null); setNeedsSignIn(true); setPhase("idle"); return }
      found[r.receiptId] = c.ok ? c.data : { what: `Receipt ${r.receiptId}`, outcome: "failed", detail: c.error }
      setInBc({ ...found })
    }
    setProgress(null)
    setPhase("confirm")
  }

  async function run() {
    if (!plan) return
    const lots = going.flatMap(r => r.lots.map(l => ({ ...l, receiptId: r.receiptId })))
    stopRef.current = false
    setPhase("running")
    const all: BcStep[] = []
    setSteps([])
    let full = 0
    let already = 0
    let refused = 0
    let noSale = 0
    let stopped = false
    for (let i = 0; i < lots.length; i++) {
      if (stopRef.current) { stopped = true; break }
      const lot = lots[i]
      setProgress({ done: i, total: lots.length, current: `${lot.barcode || lot.shortDescription.slice(0, 30)} on ${lot.receiptId}` })
      const res = await bcSaleLotSend(auctionId, lot.id).catch(e => ({ ok: false as const, error: String(e?.message ?? e) }))
      if (!res.ok) {
        all.push({ what: lot.barcode ? `Lot ${lot.barcode}` : `Lot "${lot.shortDescription.slice(0, 40)}"`, outcome: "failed", detail: res.error })
        refused++
      } else {
        all.push(...res.data)
        const outcome = lotOutcome(res.data)
        if (outcome === "refused") refused++
        else if (outcome === "noSale") noSale++
        else if (outcome === "full") full++
        else already++
      }
      setSteps([...all])
    }
    setProgress(null)
    setPhase("done")
    const done = full + already + refused + noSale
    setSummary(`${stopped ? `Stopped after ${done} of ${lots.length} lots — the rest weren't sent. ` : ""}`
      + `${full} sent in full, ${noSale ? `${noSale} on their receipt but not the sale, ` : ""}${already} already in BC, ${refused} refused`
      + `${stopped ? "" : ` — of ${plural(lots.length, "lot", "lots")}`}.`
      + (leftOut ? ` ${plural(leftOut, "lot was", "lots were")} left out before sending (no receipt, or a receipt BC doesn't have).` : ""))
  }

  const failed = steps.filter(s => s.outcome === "failed")

  function sendButtons() {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {goingLots > 0 && plan && (
          <button type="button" className={btnGo} onClick={run}>Send {plural(goingLots, "lot", "lots")} to {plan.environment}</button>
        )}
        <button type="button" className={btn} onClick={() => { setPhase("idle"); setPlan(null) }}>Cancel</button>
      </div>
    )
  }

  /** One receipt's lots, with whether they go and why not. */
  function receiptGroup(r: BcSaleReceipt) {
    const check = inBc[r.receiptId]
    const goes = sendable(r)
    return (
      <details key={r.receiptId} open={goes} className="rounded-lg border border-amber-200 dark:border-amber-900 px-3 py-2">
        <summary className="cursor-pointer select-none min-h-11 flex flex-wrap items-center gap-x-2">
          <span className={`${mono} font-semibold text-gray-900 dark:text-white`}>{r.receiptId}</span>
          <span>· {plural(r.lots.length, "lot", "lots")}</span>
          {goes ? (
            <span className={MARK.there.cls}>· in BC — {check?.detail.replace(/ — lots go onto it\.$/, "")}</span>
          ) : (
            <span className="text-red-700 dark:text-red-300">
              · <span aria-hidden>{MARK.failed.sym} </span>not sent — {r.hubNote ?? check?.detail ?? "not checked"}
            </span>
          )}
        </summary>
        {r.bcLinesUrl && plan && goes && <BcLink url={r.bcLinesUrl} environment={plan.environment} receiptId={r.receiptId} />}
        <ol className="mt-2 mb-1 space-y-2">
          {r.lots.map((l, i) => <LotCard key={l.id} n={i + 1} lot={l} />)}
        </ol>
      </details>
    )
  }

  return (
    <section className={`${box} mb-6 px-4 py-3`} aria-labelledby="bc-sale-lots-heading">
      <h2 id="bc-sale-lots-heading" className="text-sm font-semibold text-gray-900 dark:text-white">Send lots to Business Central (test)</h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        Admins only. Sends every lot on <span className={mono}>{saleCode}</span> to a BC <b>test</b> environment
        {environment ? <> — <b className={mono}>{environment}</b></> : null} — never live BC — as a line on the receipt it was
        catalogued onto, allocated to this sale and ticked Cleared For Sale: short description, description, estimates, category,
        subcategory, tote, size and internal barcode. BC gives each its UniqueID. Signed in as you; nothing in the Hub changes.
      </p>

      {off ? (
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{off}</p>
      ) : (
        <>
          {phase === "idle" && (
            <button type="button" className={`${btn} mt-3`} onClick={check}>Send lots to BC…</button>
          )}
          {phase === "listing" && (
            <p className="mt-3 text-sm text-gray-700 dark:text-gray-200" role="status">Finding {saleCode}&apos;s lots and their receipts…</p>
          )}
          {(phase === "checking" || phase === "running") && progress && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-gray-700 dark:text-gray-200" role="status" aria-live="polite">
              {phase === "checking"
                ? <span>Checking receipt {Math.min(progress.done + 1, progress.total)} of {progress.total} is in BC: <span className={mono}>{progress.current}</span>…</span>
                : <span>Lot {Math.min(progress.done + 1, progress.total)} of {progress.total}: <span className={mono}>{progress.current}</span>…</span>}
              <button type="button" className={btn} onClick={() => { stopRef.current = true }}>
                {phase === "checking" ? "Stop checking" : "Stop after this one"}
              </button>
            </div>
          )}

          {phase === "confirm" && plan && (
            <div className="mt-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-3 text-sm text-amber-900 dark:text-amber-100">
              {goingLots > 0 ? (
                <p>
                  This makes <b>{goingLots}</b> {goingLots === 1 ? "line" : "lines"} on <b>{plural(going.length, "receipt", "receipts")}</b> in
                  Business Central&apos;s <b className={mono}>{plan.environment}</b> environment, each allocated to sale <b className={mono}>{plan.saleCode}</b> and cleared for sale.
                  A lot whose barcode BC already has is left alone.
                </p>
              ) : (
                <p className="font-medium">Nothing on {plan.saleCode} can be sent — no lot is on a receipt the BC test environment has.</p>
              )}
              {notInBcLots > 0 && (
                <p className="mt-2">
                  <b>{plural(notInBcLots, "lot", "lots")}</b> on {plural(notInBc.length, "receipt", "receipts")} won&apos;t be sent — the BC test
                  environment doesn&apos;t have the receipt ({notInBc.map(r => r.receiptId).join(", ")}). A Hub receipt can be sent first from its
                  Goods In page.
                </p>
              )}
              {hubHeldLots > 0 && (
                <p className="mt-2"><b>{plural(hubHeldLots, "lot", "lots")}</b> on a receipt that isn&apos;t booked in or is void won&apos;t be sent ({hubHeld.map(r => r.receiptId).join(", ")}).</p>
              )}
              {plan.noReceipt.length > 0 && (
                <p className="mt-2"><b>{plural(plan.noReceipt.length, "lot has", "lots have")}</b> no receipt in the Hub, so {plan.noReceipt.length === 1 ? "it has" : "they have"} nowhere to go in BC — not sent.</p>
              )}

              {goingLots > 0 && sendButtons()}

              <p className="mt-3 font-medium">What each lot sends, by receipt — nothing is sent until you press Send:</p>
              <div className="mt-2 space-y-2">
                {going.map(receiptGroup)}
                {notGoing.map(receiptGroup)}
                {plan.noReceipt.length > 0 && (
                  <details className="rounded-lg border border-amber-200 dark:border-amber-900 px-3 py-2">
                    <summary className="cursor-pointer select-none min-h-11 flex flex-wrap items-center gap-x-2">
                      <span className="font-semibold text-gray-900 dark:text-white">No receipt</span>
                      <span>· {plural(plan.noReceipt.length, "lot", "lots")}</span>
                      <span className="text-red-700 dark:text-red-300">· <span aria-hidden>{MARK.failed.sym} </span>not sent — nowhere to go in BC</span>
                    </summary>
                    <ol className="mt-2 mb-1 space-y-2">
                      {plan.noReceipt.map((l, i) => <LotCard key={l.id} n={i + 1} lot={l} />)}
                    </ol>
                  </details>
                )}
              </div>
              {goingLots > 0 && (
                <p className="mt-2 text-xs">
                  BC adds the rest itself: the article number and UniqueID, and the vendor and contact from the receipt.
                  A value marked &ldquo;not sent&rdquo; is blank on the lot in the Hub.
                </p>
              )}
              {sendButtons()}
            </div>
          )}

          {needsSignIn && (
            <p className="mt-3 text-sm text-amber-800 dark:text-amber-200">
              The Hub doesn&apos;t have a Business Central sign-in for you on this server.{" "}
              <a className="font-medium underline text-indigo-700 dark:text-indigo-300 inline-flex items-center min-h-11"
                href={`/api/bc/auth?return=${encodeURIComponent(`/tools/cataloguing/auctions/${auctionId}`)}`}>
                Sign in to Business Central
              </a>
              , then open Push to BC and press it again.
            </p>
          )}

          {notice && <p className="mt-3 text-sm text-gray-700 dark:text-gray-200">{notice}</p>}
          {error && <div className="mt-3"><ErrorBox>{error}</ErrorBox></div>}

          {(phase === "running" || phase === "done") && steps.length > 0 && (
            <>
              {failed.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-medium text-red-700 dark:text-red-300">What BC refused ({failed.length}):</p>
                  <StepList steps={failed} />
                </div>
              )}
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer select-none min-h-11 inline-flex items-center text-indigo-700 dark:text-indigo-300">
                  Every step ({steps.length})
                </summary>
                <StepList steps={steps} />
              </details>
            </>
          )}

          {phase === "done" && (
            <div className="mt-3 space-y-2">
              {summary && <p className="text-sm font-medium text-gray-900 dark:text-white">{summary}</p>}
              {steps.length > 0 && <StepKey />}
              {plan && going.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer select-none min-h-11 inline-flex items-center text-indigo-700 dark:text-indigo-300">
                    See the lines in BC, receipt by receipt ({going.length})
                  </summary>
                  {going.map(r => r.bcLinesUrl && <BcLink key={r.receiptId} url={r.bcLinesUrl} environment={plan.environment} receiptId={r.receiptId} />)}
                </details>
              )}
              <button type="button" className={btn} onClick={check}>Check and send again…</button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
