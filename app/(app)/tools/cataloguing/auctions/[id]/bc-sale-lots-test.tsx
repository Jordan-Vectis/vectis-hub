"use client"

import { useRef, useState } from "react"
import { bcSaleLotSend, bcSaleLotsStart, bcSaleReceiptCheck, type BcEodSale, type BcSaleLotsStart, type BcSaleReceipt } from "@/lib/actions/goods-in-bc-sandbox"
import type { BcStep } from "@/lib/goods-in/bc-sandbox"
import { ErrorBox, box, btn, btnGo, input, mono } from "../../../warehouse/_components/ui"
import { BcLink, LiveBanner, LiveConfirm, LotCard, MARK, StepKey, StepList, liveConfirmed, lotOutcome } from "../../../warehouse/_components/bc-lot-parts"

// A sale → 📤 Push to BC → "Send lots to BC" — admins only (Jack, 2026-11-12). The receipt page's
// "Lots → Business Central test" send, started from the sale: every lot on the sale goes to a BC TEST
// environment as a line on the receipt it was catalogued onto, allocated to this sale. The rules are in
// lib/goods-in/bc-sandbox.ts (sendLot) and lib/actions/goods-in-bc-sandbox.ts (bcSaleLotsStart /
// bcSaleReceiptCheck / bcSaleLotSend).
//
// Pressing the button sends NOTHING: it lists every lot by receipt and checks each receipt is in BC (a
// count that moves), then shows exactly what each lot sends. Only "Send N lots" sends — one call per lot,
// Stop between lots, and the end says what happened in numbers (RULES.md 7b). On LIVE BC (the production Hub)
// the number of lots is typed to confirm, and each lot sent is noted on its change log so End of Day leaves it
// off the overnight sheet.
//
// 2026-11-18 — lots already in BC can take the Hub's new details, and the sale is chosen. Before pressing it:
// which sale the lots go on (this one, or one other sale code for all of them),
// and "Update lots BC already has" — off by default, so a lot staff have edited in BC is never written over
// without someone choosing to. Both are fixed at the moment it's pressed (planSale / planUpdate), so changing
// them afterwards can't change what goes without a fresh check.

type Phase = "idle" | "listing" | "checking" | "confirm" | "running" | "done"

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export default function BcSaleLotsTest({ auctionId, saleCode, environment, offReason, live, otherSales = [] }: {
  auctionId: string
  saleCode: string
  /** The BC environment writes go to; null when switched off. */
  environment: string | null
  /** Why it's switched off, in words; null when it can run. */
  offReason: string | null
  /** Writes go to LIVE Business Central (the production Hub only). */
  live: boolean
  /** The Hub's sales, offered when the lots go on another sale (any BC sale code can be typed). */
  otherSales?: { code: string; name: string }[]
}) {
  const [phase, setPhase] = useState<Phase>("idle")
  const [typed, setTyped] = useState("")
  const [saleMode, setSaleMode] = useState<"own" | "one">("own")
  const [otherCode, setOtherCode] = useState("")
  const [update, setUpdate] = useState(false)
  const [planSale, setPlanSale] = useState<BcEodSale>({ mode: "own" })
  const [planUpdate, setPlanUpdate] = useState(false)
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
  const isLive = plan?.live ?? live
  const where = isLive ? "live BC" : "the BC test environment"
  const sendReady = liveConfirmed(isLive, typed, String(goingLots))
  const sale: BcEodSale = saleMode === "one" ? { mode: "one", code: otherCode.trim().toUpperCase() } : { mode: "own" }
  const saleReady = saleMode === "own" || !!otherCode.trim()
  const elsewhere = !!plan && plan.saleCode.toUpperCase() !== plan.ownSaleCode.toUpperCase()

  async function check() {
    if (!saleReady) return
    setPhase("listing")
    setTyped("")
    setError(null)
    setNotice(null)
    setNeedsSignIn(false)
    setSteps([])
    setSummary(null)
    setInBc({})
    setPlanSale(sale)
    setPlanUpdate(update)
    const res = await bcSaleLotsStart(auctionId, sale).catch(e => ({ ok: false as const, error: String(e?.message ?? e) }))
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
    if (!plan || !sendReady) return
    // On LIVE BC the server checks this on every call too.
    const confirm = plan.live ? { typed, expected: String(goingLots) } : undefined
    const lots = going.flatMap(r => r.lots.map(l => ({ ...l, receiptId: r.receiptId })))
    stopRef.current = false
    setPhase("running")
    const all: BcStep[] = []
    setSteps([])
    let full = 0
    let updated = 0
    let already = 0
    let refused = 0
    let noSale = 0
    let notCleared = 0
    let stopped = false
    for (let i = 0; i < lots.length; i++) {
      if (stopRef.current) { stopped = true; break }
      const lot = lots[i]
      setProgress({ done: i, total: lots.length, current: `${lot.barcode || lot.shortDescription.slice(0, 30)} on ${lot.receiptId}` })
      const res = await bcSaleLotSend(auctionId, lot.id, confirm, { sale: planSale, update: planUpdate }).catch(e => ({ ok: false as const, error: String(e?.message ?? e) }))
      if (!res.ok) {
        all.push({ what: lot.barcode ? `Lot ${lot.barcode}` : `Lot "${lot.shortDescription.slice(0, 40)}"`, outcome: "failed", detail: res.error })
        refused++
      } else {
        all.push(...res.data)
        const outcome = lotOutcome(res.data)
        if (outcome === "refused") refused++
        else if (outcome === "noSale") noSale++
        else if (outcome === "notCleared") notCleared++
        else if (outcome === "full") full++
        else if (outcome === "updated") updated++
        else already++
      }
      setSteps([...all])
    }
    setProgress(null)
    setPhase("done")
    const done = full + updated + already + refused + noSale + notCleared
    setSummary(`${stopped ? `Stopped after ${done} of ${lots.length} lots — the rest weren't sent. ` : ""}`
      + `${full} sent in full, ${planUpdate ? `${updated} already in BC and updated, ` : ""}${noSale ? `${noSale} in BC but not on ${plan.saleCode}, ` : ""}${notCleared ? `${notCleared} in BC but not cleared for sale, ` : ""}`
      + `${already} already in BC ${planUpdate ? "and already matching the Hub" : "and not updated"}, ${refused} refused`
      + `${stopped ? "" : ` — of ${plural(lots.length, "lot", "lots")}`}.`
      + (leftOut ? ` ${plural(leftOut, "lot was", "lots were")} left out before sending (no receipt, or a receipt BC doesn't have).` : "")
      + (!planUpdate && already ? ` To change lots BC already has, tick "Update lots BC already has" and press it again.` : ""))
  }

  const failed = steps.filter(s => s.outcome === "failed")

  function sendButtons() {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {goingLots > 0 && plan && (
          <button type="button" className={btnGo} onClick={run} disabled={!sendReady}>
            Send {plural(goingLots, "lot", "lots")} to {plan.live ? "live BC" : plan.environment}
          </button>
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
      <h2 id="bc-sale-lots-heading" className="text-sm font-semibold text-gray-900 dark:text-white">
        {live ? "Send lots to Business Central — LIVE" : "Send lots to Business Central (test)"}
      </h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        Admins only. Sends every lot on <span className={mono}>{saleCode}</span> to{" "}
        {live
          ? <><b>live</b> Business Central</>
          : <>a BC <b>test</b> environment{environment ? <> — <b className={mono}>{environment}</b></> : null} — never live BC —</>}{" "}
        as a line on the receipt it was
        catalogued onto, allocated to the sale you choose below and ticked Cleared For Sale: short description, description, estimates,
        category, subcategory, tote, size and internal barcode. BC gives each its UniqueID. Lots BC already has are left as they are
        unless you tick &ldquo;Update lots BC already has&rdquo;. Signed in as you.{" "}
        {live
          ? <>Each lot sent is noted on its change log, and End of Day leaves it off the overnight sheet.</>
          : <>Nothing in the Hub changes.</>}
      </p>
      {live && !off && <LiveBanner environment={environment} />}

      {off ? (
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{off}</p>
      ) : (
        <>
          {phase === "idle" && (
            <div className="mt-3 space-y-3">
              <fieldset className="rounded-lg border border-gray-200 dark:border-gray-800 px-4 py-3">
                <legend className="px-1 text-sm font-semibold text-gray-900 dark:text-white">Which sale do the lots go on in BC?</legend>
                <label className="flex items-center gap-3 min-h-11 text-sm text-gray-800 dark:text-gray-200 cursor-pointer">
                  <input type="radio" name="bc-sale-lots-sale" className="h-5 w-5 accent-indigo-600" checked={saleMode === "own"} onChange={() => setSaleMode("own")} />
                  <span>This sale — <b className={mono}>{saleCode}</b></span>
                </label>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <label className="flex items-center gap-3 min-h-11 text-sm text-gray-800 dark:text-gray-200 cursor-pointer">
                    <input type="radio" name="bc-sale-lots-sale" className="h-5 w-5 accent-indigo-600" checked={saleMode === "one"} onChange={() => setSaleMode("one")} />
                    <span>Another sale, for every lot:</span>
                  </label>
                  <input
                    list="bc-sale-lots-other-sales"
                    value={otherCode}
                    onChange={e => { setOtherCode(e.target.value); setSaleMode("one") }}
                    placeholder="Sale code, e.g. F159"
                    aria-label="Sale code every lot goes on"
                    maxLength={20}
                    className={`${input} ${mono} max-w-xs`}
                  />
                  <datalist id="bc-sale-lots-other-sales">
                    {otherSales.filter(s => s.code !== saleCode).map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
                  </datalist>
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  This is BC&apos;s Sales Allocation. Pick a sale from the list or type any BC sale code. A sale BC won&apos;t take leaves the
                  lot on its receipt, and the result says so.
                </p>
              </fieldset>

              <label className="flex items-start gap-3 min-h-11 rounded-lg border border-gray-200 dark:border-gray-800 px-4 py-3 text-sm text-gray-800 dark:text-gray-200 cursor-pointer">
                <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-indigo-600" checked={update} onChange={e => setUpdate(e.target.checked)} />
                <span>
                  <b className="text-gray-900 dark:text-white">Update lots BC already has</b> with the Hub&apos;s short description, description,
                  estimate, category, size and sale. Only what&apos;s different is sent, and a blank in the Hub never blanks BC. The tote and
                  barcode are never changed.{" "}
                  <span className="text-amber-800 dark:text-amber-200">Anything changed in BC by hand is replaced by the Hub&apos;s version.</span>
                </span>
              </label>

              <button type="button" className={btn} onClick={check} disabled={!saleReady}>Send lots to BC…</button>
              {!saleReady && <p className="text-xs text-amber-800 dark:text-amber-200">Type the sale code the lots should go on, or choose this sale.</p>}
            </div>
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
                <>
                  <p>
                    This sends <b>{plural(goingLots, "lot", "lots")}</b> on <b>{plural(going.length, "receipt", "receipts")}</b> to
                    Business Central&apos;s <b className={mono}>{plan.environment}</b> environment, each allocated to sale <b className={mono}>{plan.saleCode}</b> and
                    cleared for sale. A lot BC doesn&apos;t have yet is made as a new line.
                  </p>
                  {planUpdate ? (
                    <p className="mt-2">
                      <b>A lot BC already has on its receipt is UPDATED to match the Hub:</b> its short description, description, estimate,
                      category, size and sale — only what&apos;s different. Its tote and barcode stay as they are. Anything changed in BC by hand
                      on those lots is replaced.
                    </p>
                  ) : (
                    <p className="mt-2">
                      A lot BC already has on its receipt is <b>left as it is</b> — it&apos;s only ticked Cleared For Sale if it isn&apos;t yet. To
                      send the Hub&apos;s new descriptions and estimates for those, press Cancel, tick &ldquo;Update lots BC already has&rdquo;,
                      and check again.
                    </p>
                  )}
                  {elsewhere && (
                    <p className="mt-2">
                      ⚠ <b className={mono}>{plan.saleCode}</b> isn&apos;t this sale ({plan.ownSaleCode}).{" "}
                      {planUpdate
                        ? <>A lot BC already has on another sale is moved: BC takes it off that sale (and clears its lot number there) if that
                          sale hasn&apos;t happened yet, and refuses to move a lot that has sold.</>
                        : <>Only lots BC doesn&apos;t have yet go on it — lots BC already has stay on their current sale.</>}
                    </p>
                  )}
                </>
              ) : (
                <p className="font-medium">Nothing on {plan.saleCode} can be sent — no lot is on a receipt {where} has.</p>
              )}
              {notInBcLots > 0 && (
                <p className="mt-2">
                  <b>{plural(notInBcLots, "lot", "lots")}</b> on {plural(notInBc.length, "receipt", "receipts")} won&apos;t be sent — {where}{" "}
                  doesn&apos;t have the receipt ({notInBc.map(r => r.receiptId).join(", ")}). A Hub receipt can be sent first from its
                  Goods In page.
                </p>
              )}
              {hubHeldLots > 0 && (
                <p className="mt-2"><b>{plural(hubHeldLots, "lot", "lots")}</b> on a receipt that isn&apos;t booked in or is void won&apos;t be sent ({hubHeld.map(r => r.receiptId).join(", ")}).</p>
              )}
              {plan.noReceipt.length > 0 && (
                <p className="mt-2"><b>{plural(plan.noReceipt.length, "lot has", "lots have")}</b> no receipt in the Hub, so {plan.noReceipt.length === 1 ? "it has" : "they have"} nowhere to go in BC — not sent.</p>
              )}

              {goingLots > 0 && plan.live && (
                <LiveConfirm expected={String(goingLots)} what={plural(goingLots, "lot", "lots")} value={typed} onChange={setTyped} />
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
                  <p className="text-sm font-medium text-red-700 dark:text-red-300">What didn&apos;t go through ({failed.length}):</p>
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
              <button type="button" className={btn} onClick={() => { setPhase("idle"); setPlan(null); setSteps([]); setSummary(null) }}>
                Start again…
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
