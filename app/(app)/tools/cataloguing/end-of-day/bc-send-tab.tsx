"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  bcEodList, bcEodLotSend, bcEodLotsStart, bcEodReceiptCheck,
  type BcEodList, type BcEodLotsStart, type BcEodSale, type BcSaleReceipt,
} from "@/lib/actions/goods-in-bc-sandbox"
import type { BcStep } from "@/lib/goods-in/bc-sandbox"
import { ErrorBox, box, btn, btnGo, input, mono, td, th } from "../../warehouse/_components/ui"
import { BcLink, LotCard, MARK, StepKey, StepList, lotOutcome } from "../../warehouse/_components/bc-lot-parts"

// End of Day → BC → "Send to BC (test)" — admins only (Jordan, 2026-11-13). Jack's send (the receipt
// page's and the sale page's "Lots → Business Central test"), started from the End of Day sheet: the lots
// on the sheet ON SCREEN go to a BC TEST environment as lines on the receipts they were catalogued onto.
// • By vendor or all at once: tick the vendors, or Tick all.
// • The sale is chosen: each lot's own, or one sale for every lot sent.
// The rules are in lib/actions/goods-in-bc-sandbox.ts (bcEodList / bcEodLotsStart / bcEodReceiptCheck /
// bcEodLotSend) and lib/goods-in/bc-sandbox.ts (sendLot).
//
// ⚠ It is a tab BESIDE the sheet: it reads the sheet's barcodes and nothing else, and it changes nothing
// about the sheet, the checks or the macro. Nothing in the Hub is written.
// Ticking and choosing send NOTHING. "Check and send…" lists exactly what each lot sends and checks each
// receipt is in BC (a count that moves, with a Stop); only "Send N lots" sends — one call per lot, Stop
// between lots, and the end says what happened in numbers (RULES.md 7b).

type Phase = "idle" | "preparing" | "checking" | "confirm" | "running" | "done"

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`
const caught = (e: unknown) => ({ ok: false as const, error: String((e as { message?: string })?.message ?? e) })

export default function BcSendTab({ active, receipts, environment, offReason }: {
  /** Whether this tab is the one on screen — the sheet's lots are only listed once it is. */
  active: boolean
  /** The End of Day sheet on screen (one row per receipt), or null while it is being pulled. */
  receipts: { receipt: string; barcodes: string[] }[] | null
  /** The BC test environment writes go to (never live BC); null when switched off. */
  environment: string | null
  /** Why it's switched off, in words; null when it can run. */
  offReason: string | null
}) {
  const [phase, setPhase] = useState<Phase>("idle")
  const [listing, setListing] = useState(false)
  const [list, setList] = useState<BcEodList | null>(null)
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [q, setQ] = useState("")
  const [saleMode, setSaleMode] = useState<"own" | "one">("own")
  const [saleCode, setSaleCode] = useState("")
  const [plan, setPlan] = useState<BcEodLotsStart | null>(null)
  const [planSale, setPlanSale] = useState<BcEodSale>({ mode: "own" })
  const [inBc, setInBc] = useState<Record<string, BcStep>>({})
  const [steps, setSteps] = useState<BcStep[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const stopRef = useRef(false)
  const listedFor = useRef<string[] | null>(null)

  const off = offReason ?? (environment ? null : "Switched off on this server.")
  const barcodes = useMemo(() => (receipts ? [...new Set(receipts.flatMap(r => r.barcodes))] : null), [receipts])

  // List the sheet's lots by vendor the first time the tab is opened, and again when the sheet on screen
  // has been refreshed — but only while nothing is being checked, shown or sent, so a refresh never pulls
  // the list out from under a send.
  useEffect(() => {
    if (!active || off || !barcodes || phase !== "idle" || listedFor.current === barcodes) return
    listedFor.current = barcodes
    setList(null)
    setTicked(new Set())
    setError(null)
    setNeedsSignIn(false)
    if (barcodes.length === 0) return
    let cancelled = false
    let finished = false
    setListing(true)
    bcEodList(barcodes).catch(caught).then(res => {
      if (cancelled) return
      finished = true
      setListing(false)
      if (!res.ok) {
        if (res.error === "NO_BC_SIGN_IN") setNeedsSignIn(true)
        else setError(res.error)
        return
      }
      setList(res.data)
    })
    // Left part-way (the tab was closed, or the sheet changed): forget it, so it is listed afresh next time.
    // A list that finished is kept — coming back from a check or a send keeps the vendors and the ticks.
    return () => {
      cancelled = true
      if (finished) return
      setListing(false)
      if (listedFor.current === barcodes) listedFor.current = null
    }
  }, [active, off, barcodes, phase])

  // ── Picking: vendors and the sale ──
  const shown = useMemo(() => {
    if (!list) return []
    const needle = q.trim().toLowerCase()
    if (!needle) return list.vendors
    return list.vendors.filter(v => [v.vendorNo, v.vendorName, ...v.receipts, ...v.sales].some(s => s.toLowerCase().includes(needle)))
  }, [list, q])
  const picked = list ? list.vendors.filter(v => ticked.has(v.vendorNo)) : []
  const pickedLots = picked.reduce((n, v) => n + v.lotIds.length, 0)
  const sale: BcEodSale = saleMode === "one" ? { mode: "one", code: saleCode.trim() } : { mode: "own" }
  const saleReady = saleMode === "own" || !!saleCode.trim()

  function tick(vendorNo: string) {
    setTicked(prev => {
      const next = new Set(prev)
      if (next.has(vendorNo)) next.delete(vendorNo)
      else next.add(vendorNo)
      return next
    })
  }
  function tickShown(on: boolean) {
    setTicked(prev => {
      const next = new Set(prev)
      for (const v of shown) { if (on) next.add(v.vendorNo); else next.delete(v.vendorNo) }
      return next
    })
  }

  // ── Checking and sending ──
  // A receipt's lots go only when the Hub has nothing against it AND BC has the receipt.
  const sendable = (r: BcSaleReceipt) => !r.hubNote && inBc[r.receiptId]?.outcome === "there"
  const going = plan ? plan.receipts.filter(sendable) : []
  const notGoing = plan ? plan.receipts.filter(r => !sendable(r)) : []
  const goingLots = going.reduce((n, r) => n + r.lots.length, 0)
  const notInBc = notGoing.filter(r => !r.hubNote)
  const notInBcLots = notInBc.reduce((n, r) => n + r.lots.length, 0)
  const hubHeld = notGoing.filter(r => r.hubNote)
  const hubHeldLots = hubHeld.reduce((n, r) => n + r.lots.length, 0)
  const leftOut = notInBcLots + hubHeldLots + (plan?.unsendable ?? 0)

  async function check() {
    if (!pickedLots || !saleReady) return
    const chosen = sale
    setError(null)
    setNotice(null)
    setNeedsSignIn(false)
    setSteps([])
    setSummary(null)
    setInBc({})
    setPhase("preparing")
    const res = await bcEodLotsStart(picked.flatMap(v => v.lotIds), chosen).catch(caught)
    if (!res.ok) {
      if (res.error === "NO_BC_SIGN_IN") setNeedsSignIn(true)
      else setError(res.error)
      setPhase("idle")
      return
    }
    setPlan(res.data)
    setPlanSale(chosen)

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
      const c = await bcEodReceiptCheck(r.receiptId).catch(caught)
      if (!c.ok && c.error === "NO_BC_SIGN_IN") { setProgress(null); setPlan(null); setNeedsSignIn(true); setPhase("idle"); return }
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
    let notCleared = 0
    let stopped = false
    for (let i = 0; i < lots.length; i++) {
      if (stopRef.current) { stopped = true; break }
      const lot = lots[i]
      setProgress({ done: i, total: lots.length, current: `${lot.barcode || lot.shortDescription.slice(0, 30)} on ${lot.receiptId}` })
      const res = await bcEodLotSend(lot.id, planSale).catch(caught)
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
        else already++
      }
      setSteps([...all])
    }
    setProgress(null)
    setPhase("done")
    const done = full + already + refused + noSale + notCleared
    setSummary(`${stopped ? `Stopped after ${done} of ${lots.length} lots — the rest weren't sent. ` : ""}`
      + `${full} sent in full, ${noSale ? `${noSale} on their receipt but not the sale, ` : ""}${notCleared ? `${notCleared} sent but not cleared for sale, ` : ""}${already} already in BC, ${refused} refused`
      + `${stopped ? "" : ` — of ${plural(lots.length, "lot", "lots")}`}.`
      + (leftOut ? ` ${plural(leftOut, "lot was", "lots were")} left out before sending (a receipt BC doesn't have, or one that isn't booked in).` : ""))
  }

  function backToVendors() {
    setPlan(null)
    setSteps([])
    setSummary(null)
    setPhase("idle")
  }

  const failed = steps.filter(s => s.outcome === "failed")
  const saleWords = plan?.saleCode
    ? <>every one allocated to sale <b className={mono}>{plan.saleCode}</b></>
    : <>each allocated to its own sale</>

  function sendButtons() {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {goingLots > 0 && plan && (
          <button type="button" className={btnGo} onClick={run}>Send {plural(goingLots, "lot", "lots")} to {plan.environment}</button>
        )}
        <button type="button" className={btn} onClick={backToVendors}>Cancel — back to the vendors</button>
      </div>
    )
  }

  /** One receipt's lots, with whether they go and why not. */
  function receiptGroup(r: BcSaleReceipt) {
    const checked = inBc[r.receiptId]
    const goes = sendable(r)
    return (
      <details key={r.receiptId} open={goes && going.length <= 3} className="rounded-lg border border-amber-200 dark:border-amber-900 px-3 py-2">
        <summary className="cursor-pointer select-none min-h-11 flex flex-wrap items-center gap-x-2">
          <span className={`${mono} font-semibold text-gray-900 dark:text-white`}>{r.receiptId}</span>
          <span>· {plural(r.lots.length, "lot", "lots")}</span>
          {goes ? (
            <span className={MARK.there.cls}>· in BC — {checked?.detail.replace(/ — lots go onto it\.$/, "")}</span>
          ) : (
            <span className="text-red-700 dark:text-red-300">
              · <span aria-hidden>{MARK.failed.sym} </span>not sent — {r.hubNote ?? checked?.detail ?? "not checked"}
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
    <section className={`${box} px-4 py-4`} aria-labelledby="bc-eod-send-heading">
      <h2 id="bc-eod-send-heading" className="text-base font-semibold text-gray-900 dark:text-white">Send the sheet&apos;s lots to Business Central (test)</h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300 max-w-5xl">
        Admins only. Sends the lots on the End of Day sheet to a BC <b>test</b> environment
        {environment ? <> — <b className={mono}>{environment}</b></> : null} — never live BC — each as a line on the receipt it was
        catalogued onto, on the sale you choose and ticked Cleared For Sale: short description, description, estimates, category,
        subcategory, tote, size and internal barcode. Signed in as you. Nothing in the Hub changes, and the sheet and the macro
        carry on exactly as they are.
      </p>

      {off ? (
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{off}</p>
      ) : (
        <>
          {needsSignIn && (
            <p className="mt-3 text-sm text-amber-800 dark:text-amber-200">
              The Hub doesn&apos;t have a Business Central sign-in for you on this server.{" "}
              <a className="font-medium underline text-indigo-700 dark:text-indigo-300 inline-flex items-center min-h-11"
                href={`/api/bc/auth?return=${encodeURIComponent("/tools/cataloguing/end-of-day")}`}>
                Sign in to Business Central
              </a>
              , then open this tab again.
            </p>
          )}
          {notice && <p className="mt-3 text-sm text-gray-700 dark:text-gray-200">{notice}</p>}
          {error && <div className="mt-3"><ErrorBox onDismiss={() => setError(null)}>{error}</ErrorBox></div>}

          {/* ── Pick the vendors and the sale ── */}
          {phase === "idle" && (
            <>
              {!barcodes && <p className="mt-3 text-sm text-gray-700 dark:text-gray-200" role="status">Waiting for the End of Day sheet to be pulled…</p>}
              {barcodes && barcodes.length === 0 && (
                <p className="mt-3 text-sm text-gray-700 dark:text-gray-200">Nothing is waiting on the sheet — every catalogued lot with a barcode and a receipt is already in BC.</p>
              )}
              {listing && barcodes && (
                <p className="mt-3 text-sm text-gray-700 dark:text-gray-200" role="status">
                  Sorting the sheet&apos;s {plural(barcodes.length, "lot", "lots")} by vendor…
                </p>
              )}

              {list && (
                <>
                  {list.notFound > 0 && (
                    <p className="mt-3 text-sm text-amber-800 dark:text-amber-200">
                      {plural(list.notFound, "barcode", "barcodes")} on the sheet {list.notFound === 1 ? "isn't" : "aren't"} on a lot with a receipt any
                      more, so {list.notFound === 1 ? "it isn't" : "they aren't"} listed here. Press ⟳ Refresh to bring the sheet up to date.
                    </p>
                  )}

                  <fieldset className="mt-4 rounded-lg border border-gray-200 dark:border-gray-800 px-4 py-3">
                    <legend className="px-1 text-sm font-semibold text-gray-900 dark:text-white">1. Which sale do the lots go on?</legend>
                    <label className="flex items-center gap-3 min-h-11 text-sm text-gray-800 dark:text-gray-200 cursor-pointer">
                      <input type="radio" name="bc-eod-sale" className="h-5 w-5 accent-indigo-600" checked={saleMode === "own"} onChange={() => setSaleMode("own")} />
                      <span>Each lot&apos;s own sale <span className="text-gray-500 dark:text-gray-400">— the sale it was catalogued in</span></span>
                    </label>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <label className="flex items-center gap-3 min-h-11 text-sm text-gray-800 dark:text-gray-200 cursor-pointer">
                        <input type="radio" name="bc-eod-sale" className="h-5 w-5 accent-indigo-600" checked={saleMode === "one"} onChange={() => setSaleMode("one")} />
                        <span>One sale for every lot sent:</span>
                      </label>
                      <input
                        list="bc-eod-open-sales"
                        value={saleCode}
                        onChange={e => { setSaleCode(e.target.value); setSaleMode("one") }}
                        placeholder="Sale code, e.g. F121"
                        aria-label="Sale code for every lot sent"
                        maxLength={20}
                        className={`${input} ${mono} max-w-xs`}
                      />
                      <datalist id="bc-eod-open-sales">
                        {list.openSales.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
                      </datalist>
                    </div>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      This is BC&apos;s Sales Allocation. Pick one of the Hub&apos;s open sales from the list or type any BC sale code.
                      A sale BC won&apos;t take leaves the lot on its receipt, and the result says so.
                    </p>
                  </fieldset>

                  <fieldset className="mt-4 rounded-lg border border-gray-200 dark:border-gray-800 px-4 py-3">
                    <legend className="px-1 text-sm font-semibold text-gray-900 dark:text-white">
                      2. Which vendors? <span className="font-normal text-gray-500 dark:text-gray-400">{plural(list.lots, "lot", "lots")} for {plural(list.vendors.length, "vendor", "vendors")} on the sheet</span>
                    </legend>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={q}
                        onChange={e => setQ(e.target.value)}
                        placeholder="Find a vendor, receipt or sale"
                        aria-label="Find a vendor, receipt or sale"
                        className={`${input} max-w-sm`}
                      />
                      <button type="button" className={btn} onClick={() => tickShown(true)} disabled={shown.length === 0}>
                        Tick all{q.trim() ? ` ${shown.length} shown` : ` ${list.vendors.length}`}
                      </button>
                      <button type="button" className={btn} onClick={() => tickShown(false)} disabled={ticked.size === 0}>Untick{q.trim() ? " those shown" : " all"}</button>
                      <span className="text-sm text-gray-600 dark:text-gray-300" role="status">
                        {ticked.size === 0 ? "None ticked — nothing will be sent." : <><b>{plural(picked.length, "vendor", "vendors")}</b> ticked · <b>{plural(pickedLots, "lot", "lots")}</b></>}
                      </span>
                    </div>
                    <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
                      <table className="w-full">
                        <thead className="bg-gray-50 dark:bg-gray-800/60">
                          <tr>
                            <th className={`${th} w-12`}><span className="sr-only">Send</span></th>
                            <th className={th}>Vendor</th>
                            <th className={th}>Lots</th>
                            <th className={th}>Receipts</th>
                            <th className={th}>Sale now</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                          {shown.length === 0 && (
                            <tr><td colSpan={5} className={`${td} text-gray-500 dark:text-gray-400`}>No vendor on the sheet matches &ldquo;{q.trim()}&rdquo;.</td></tr>
                          )}
                          {shown.map(v => {
                            const on = ticked.has(v.vendorNo)
                            const id = `bc-eod-vendor-${v.vendorNo || "none"}`
                            return (
                              <tr key={v.vendorNo} className={on ? "bg-indigo-50 dark:bg-indigo-950/30" : "hover:bg-gray-50 dark:hover:bg-gray-800/40"}>
                                <td className={td}>
                                  <input id={id} type="checkbox" className="h-5 w-5 accent-indigo-600 cursor-pointer" checked={on} onChange={() => tick(v.vendorNo)} />
                                </td>
                                <td className={td}>
                                  <label htmlFor={id} className="cursor-pointer block min-h-8">
                                    {v.vendorNo
                                      ? <><span className="font-medium text-gray-900 dark:text-white">{v.vendorName || "Name not in the BC data"}</span> <span className={`${mono} text-gray-500 dark:text-gray-400`}>{v.vendorNo}</span></>
                                      : <span className="italic text-gray-600 dark:text-gray-300">No vendor on the lot</span>}
                                  </label>
                                </td>
                                <td className={`${td} font-semibold`}>{v.lotIds.length.toLocaleString("en-GB")}</td>
                                <td className={`${td} ${mono} text-xs`}>{v.receipts.join(", ")}</td>
                                <td className={`${td} ${mono} text-xs`}>{v.sales.join(", ") || "—"}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </fieldset>

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button type="button" className={btnGo} onClick={check} disabled={!pickedLots || !saleReady}>
                      Check and send {pickedLots ? `${plural(pickedLots, "lot", "lots")} for ${plural(picked.length, "vendor", "vendors")}` : "lots"}…
                    </button>
                    <span className="text-sm text-gray-600 dark:text-gray-300">
                      {!pickedLots ? "Tick at least one vendor."
                        : !saleReady ? "Type the sale code, or choose each lot's own sale."
                        : "Nothing is sent yet — the next screen shows every lot first."}
                    </span>
                  </div>
                </>
              )}
            </>
          )}

          {/* ── Working ── */}
          {phase === "preparing" && (
            <p className="mt-3 text-sm text-gray-700 dark:text-gray-200" role="status">Getting {plural(pickedLots, "lot", "lots")} ready and finding their receipts…</p>
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

          {/* ── Everything that will go, before it goes ── */}
          {phase === "confirm" && plan && (
            <div className="mt-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-3 text-sm text-amber-900 dark:text-amber-100">
              {goingLots > 0 ? (
                <p>
                  This makes <b>{goingLots.toLocaleString("en-GB")}</b> {goingLots === 1 ? "line" : "lines"} on <b>{plural(going.length, "receipt", "receipts")}</b> in
                  Business Central&apos;s <b className={mono}>{plan.environment}</b> environment, {saleWords} and cleared for sale.
                  A lot whose barcode BC already has on its receipt isn&apos;t sent again — it&apos;s only ticked Cleared For Sale if it isn&apos;t yet.
                </p>
              ) : (
                <p className="font-medium">Nothing ticked can be sent — no lot is on a receipt the BC test environment has.</p>
              )}
              {notInBcLots > 0 && (
                <p className="mt-2">
                  <b>{plural(notInBcLots, "lot", "lots")}</b> on {plural(notInBc.length, "receipt", "receipts")} won&apos;t be sent — the BC test
                  environment doesn&apos;t have the receipt ({notInBc.map(r => r.receiptId).join(", ")}).
                </p>
              )}
              {hubHeldLots > 0 && (
                <p className="mt-2"><b>{plural(hubHeldLots, "lot", "lots")}</b> on a receipt that isn&apos;t booked in or is void won&apos;t be sent ({hubHeld.map(r => r.receiptId).join(", ")}).</p>
              )}
              {plan.unsendable > 0 && (
                <p className="mt-2"><b>{plural(plan.unsendable, "ticked lot", "ticked lots")}</b> can&apos;t be sent now — gone from the Hub, or no longer carrying a barcode and a receipt.</p>
              )}

              {goingLots > 0 && sendButtons()}

              <p className="mt-3 font-medium">What each lot sends, by receipt — nothing is sent until you press Send:</p>
              <div className="mt-2 space-y-2">
                {going.map(receiptGroup)}
                {notGoing.map(receiptGroup)}
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

          {/* ── What happened ── */}
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
              <button type="button" className={btn} onClick={backToVendors}>Back to the vendors</button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
