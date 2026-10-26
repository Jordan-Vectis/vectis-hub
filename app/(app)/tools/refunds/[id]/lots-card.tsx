"use client"

import { useRouter } from "next/navigation"
import { useRef, useState, useTransition, type ReactNode } from "react"
import {
  lotsFromBc, saveRefundLots, updateRefund, type RefundLotInput, type RefundPatch, type RefundTotalSaved,
} from "@/lib/actions/refunds"
import type { RefundBcFound, RefundBcProposal } from "@/lib/refunds-bc"
import {
  REFUND_BASES, REFUND_BASIS_LABELS, REFUND_LIMITS, REFUNDS_PATH, commissionFor, formatPence, isRefundBasis, lotRefundPence,
  poundsToPence, refundTotalToSave,
  type RefundBasis, type RefundDetail, type RefundLotMoney,
} from "@/lib/refunds"
import { bcConnectHref } from "@/lib/uncollected"
import { Flash, NO_ANSWER, Spinner, btn, btnGo, card, cardTitle, field, inlineLink, label, muted, plural, type FlashMessage } from "../ui"

// Lots & money: the lots the request is about and what each refunds — % of hammer + commission, % of
// the hammer only, or a set amount (lib/refunds.ts, the old log's rules: commission is 27% of the
// hammer inc VAT, editable) — plus postage refunded and the accounts ref code, with the total worked
// out LIVE as you type, by the same functions the server uses when it saves (refundTotalToSave: only a
// WHOLE total is saved, and an old-log request keeps the log's total until its lots can work one out —
// the log often gave one total for "808 & 809", so its lots came in with no money of their own).
//
// "Fill from BC" asks lotsFromBc (READ ONLY, the admin's own BC sign-in) for the buyer's lots in the
// sale that are on the request, shows them, and "Use these" puts them in the rows — nothing is saved
// until Save. One set of boxes for every screen: a row of columns on a wide screen (lg), a small card
// per lot below that, so nothing scrolls sideways.

type Row = {
  key: string
  saleCode: string
  lotNo: string
  uniqueId: string | null
  description: string
  hammer: string
  /** "" = 27% of the hammer, worked out. */
  commission: string
  basis: RefundBasis
  pct: string
  amount: string
  fromBc: boolean
}

type Saved = { rows: Row[]; postage: string; refCode: string }

const poundsOf = (p: number | null | undefined) => (p == null ? "" : (p / 100).toFixed(2))
/** A typed money box: blank → null; something that isn't money → undefined. */
const moneyIn = (s: string): number | null | undefined => (!s.trim() ? null : poundsToPence(s) ?? undefined)
/** A typed % box: blank → null; "20" or "20%" (0–100) → 20; anything else → undefined. */
function pctIn(s: string): number | null | undefined {
  const t = s.trim().replace(/%$/, "").trim()
  if (!t) return null
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return undefined
  const n = Number(t)
  return n <= 100 ? n : undefined
}

/** The % in the request's "% agreed" when it's a plain one ("20%"), for new rows. */
function plainPercent(text: string | null): string {
  const m = /^\s*(\d{1,3}(?:\.\d{1,2})?)\s*%\s*$/.exec(text ?? "")
  return m && Number(m[1]) <= 100 ? m[1] : ""
}

function savedOf(r: RefundDetail): Saved {
  return {
    rows: r.lots.map(l => ({
      key: l.id,
      saleCode: l.saleCode ?? "",
      lotNo: l.lotNo,
      uniqueId: l.uniqueId,
      description: l.description ?? "",
      hammer: poundsOf(l.hammerPence),
      commission: poundsOf(l.commissionPence),
      basis: l.basis,
      pct: l.percent == null ? "" : String(l.percent),
      amount: poundsOf(l.setAmountPence),
      fromBc: l.fromBc,
    })),
    postage: poundsOf(r.postagePence),
    refCode: r.refCode ?? "",
  }
}

/** One row's money as typed, and which boxes don't read. */
function readRow(x: Row): { money: RefundLotMoney; bad: string[] } {
  const hammer = moneyIn(x.hammer), commission = moneyIn(x.commission), pct = pctIn(x.pct), amount = moneyIn(x.amount)
  const bad: string[] = []
  if (hammer === undefined) bad.push("the hammer isn't a sum of money (for example 90.00)")
  if (commission === undefined) bad.push("the commission isn't a sum of money")
  if (x.basis !== "set" && pct === undefined) bad.push("the % must be a number from 0 to 100")
  if (x.basis === "set" && amount === undefined) bad.push("the set amount isn't a sum of money")
  return {
    money: { hammerPence: hammer ?? null, commissionPence: commission ?? null, basis: x.basis, percent: pct ?? null, setAmountPence: amount ?? null },
    bad,
  }
}

/** Why a row's refund can't be worked out yet, in a few words. */
function whyNot(m: RefundLotMoney, bad: string[]): string {
  if (bad.length) return "check the boxes"
  if (m.basis === "set") return "needs the amount"
  if (m.hammerPence == null && m.percent == null) return "needs the hammer and %"
  return m.hammerPence == null ? "needs the hammer" : "needs the %"
}

const sameSaved = (a: Saved, b: Saved) => JSON.stringify(a) === JSON.stringify(b)

/** The old log's cell under one of its column names (they have spaces round them: " Hammer price "). */
const rawCell = (raw: Record<string, string> | null, name: string) => {
  if (!raw) return ""
  const k = Object.keys(raw).find(key => key.trim().toLowerCase() === name)
  return k ? raw[k].trim() : ""
}

type Bc =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; text: string; connect: boolean }
  | { kind: "done"; found: RefundBcFound; pick: boolean[] }

export default function LotsCard({ r }: { r: RefundDetail }) {
  const router = useRouter()
  const server = savedOf(r)
  const sig = JSON.stringify(server)
  const [opened, setOpened] = useState<Saved>(server)
  const [rows, setRows] = useState<Row[]>(server.rows)
  const [postage, setPostage] = useState(server.postage)
  const [refCode, setRefCode] = useState(server.refCode)
  const now: Saved = { rows, postage, refCode }
  const dirty = !sameSaved(now, opened)
  // When the request changes on the server (our own save coming back, or someone else's) and nothing
  // is being edited here, the boxes follow it. Edits in progress are never thrown away.
  const [seen, setSeen] = useState(sig)
  if (seen !== sig) {
    setSeen(sig)
    if (!dirty) { setOpened(server); setRows(server.rows); setPostage(server.postage); setRefCode(server.refCode) }
  }

  const [msg, setMsg] = useState<FlashMessage | null>(null)
  const [saving, startSaving] = useTransition()
  const [bc, setBc] = useState<Bc>({ kind: "idle" })
  const counter = useRef(0)
  const newKey = () => `new-${++counter.current}`
  const defaultPct = plainPercent(r.percentText)

  const read = rows.map(readRow)
  const postagePence = moneyIn(postage)
  // What Save would save — the same rule as the server — with what the lots that CAN be worked out
  // come to (`worked`) for the "at least".
  const total = refundTotalToSave(read.map(x => x.money), postagePence ?? null, { source: r.source, totalPence: r.totalPence })
  const nothing = !rows.length && postagePence == null && !total.kept
  // Whose total stands while the lots can't work one out: the old log's, unless it has been changed since.
  const logTotal = poundsToPence(rawCell(r.importedRaw, "total to refund"))
  const keptWhose = logTotal != null && logTotal === r.totalPence ? "the old log's total" : "the saved total"

  // Fill from BC: a buyer's lots, by C-number and the sale (or the auction date).
  const bcWhyNot = r.party === "vendor"
    ? "BC lookup is for a buyer's lots — add a vendor's lots and amounts by hand."
    : !r.customerNo
      ? "Add the buyer's C-number under Details to look their lots up in BC."
      : !r.saleCode && !r.auctionDate
        ? "Add the sale (or the auction date) under Details to look the lots up in BC."
        : null

  function change(key: string, patch: Partial<Row>) {
    setRows(rs => rs.map(x => (x.key === key ? { ...x, ...patch } : x)))
  }
  function addRow() {
    if (rows.length >= REFUND_LIMITS.lots) { setMsg({ tone: "error", text: `A request can hold ${REFUND_LIMITS.lots} lots at most.` }); return }
    setRows(rs => [...rs, { key: newKey(), saleCode: r.saleCode ?? "", lotNo: "", uniqueId: null, description: "", hammer: "", commission: "", basis: "percent", pct: defaultPct, amount: "", fromBc: false }])
  }
  function removeRow(key: string) {
    setRows(rs => rs.filter(x => x.key !== key))
  }
  function undo() {
    setRows(opened.rows); setPostage(opened.postage); setRefCode(opened.refCode); setMsg(null)
  }

  async function askBc() {
    if (bc.kind === "loading" || bcWhyNot) return
    setBc({ kind: "loading" })
    setMsg(null)
    try {
      const res = await lotsFromBc(r.id)
      setBc(res.ok ? { kind: "done", found: res.data, pick: res.data.lots.map(() => true) } : { kind: "error", text: res.error, connect: !!res.needsBc })
    } catch {
      setBc({ kind: "error", text: "The Hub didn't answer — check the connection and try again.", connect: false })
    }
  }

  function applyBc() {
    if (bc.kind !== "done") return
    const chosen = bc.found.lots.filter((_, i) => bc.pick[i])
    if (!chosen.length) { setMsg({ tone: "info", text: "None are ticked — nothing was added." }); return }
    const next = rows.filter(x => x.lotNo.trim() || x.hammer.trim() || x.description.trim())   // an empty starter row goes
    let added = 0, filled = 0
    for (const p of chosen) {
      const i = next.findIndex(x => x.lotNo.trim().toUpperCase() === p.lotNo && (!x.saleCode.trim() || !p.saleCode || x.saleCode.trim().toUpperCase() === p.saleCode))
      const fromBc = { saleCode: p.saleCode ?? "", lotNo: p.lotNo, uniqueId: p.uniqueId, description: p.description ?? "", hammer: poundsOf(p.hammerPence), fromBc: true }
      if (i >= 0) { next[i] = { ...next[i], ...fromBc }; filled++ }
      else { next.push({ key: newKey(), ...fromBc, commission: "", basis: "percent", pct: defaultPct, amount: "" }); added++ }
    }
    const over = next.length - REFUND_LIMITS.lots
    setRows(over > 0 ? next.slice(0, REFUND_LIMITS.lots) : next)
    setBc({ kind: "idle" })
    setMsg({
      tone: "info",
      text: `${[added ? `${plural(added, "lot")} added` : null, filled ? `${plural(filled, "lot")} filled in` : null].filter(Boolean).join(", ")} from BC`
        + `${over > 0 ? ` (${plural(over, "lot")} left out — a request holds ${REFUND_LIMITS.lots} at most)` : ""}. `
        + `Check the % or amounts, then press Save — nothing is saved until you do.`,
    })
  }

  function save() {
    if (saving) return
    const blank = rows.findIndex(x => !x.lotNo.trim())
    if (blank >= 0) { setMsg({ tone: "error", text: `Row ${blank + 1} has no lot number — fill it in or take the row out. Nothing was saved.` }); return }
    const badRow = read.findIndex(x => x.bad.length)
    if (badRow >= 0) { setMsg({ tone: "error", text: `Lot ${rows[badRow].lotNo.trim()}: ${read[badRow].bad[0]}. Nothing was saved.` }); return }
    if (postagePence === undefined) { setMsg({ tone: "error", text: "Postage refunded isn't a sum of money (for example 4.50). Nothing was saved." }); return }

    const lotsChanged = JSON.stringify(rows) !== JSON.stringify(opened.rows)
    const patch: RefundPatch = {}
    if (postage.trim() !== opened.postage.trim()) patch.postagePence = postagePence
    if (refCode.trim() !== opened.refCode.trim()) patch.refCode = refCode
    const lots: RefundLotInput[] = rows.map((x, i) => ({
      saleCode: x.saleCode, lotNo: x.lotNo, uniqueId: x.uniqueId, description: x.description,
      hammerPence: read[i].money.hammerPence, commissionPence: read[i].money.commissionPence, basis: x.basis,
      percent: x.basis === "set" ? null : read[i].money.percent, setAmountPence: x.basis === "set" ? read[i].money.setAmountPence : null,
      fromBc: x.fromBc,
    }))
    const was = now
    setMsg(null)
    startSaving(async () => {
      try {
        // What the server worked the total out as — what was saved is what is said.
        let saved: RefundTotalSaved | null = null
        let detailsSaved: string[] | null = null
        if (Object.keys(patch).length) {
          const res = await updateRefund(r.id, patch)
          if (!res.ok) { setMsg({ tone: "error", text: `${res.error}${lotsChanged ? " The lots weren't saved either." : ""}` }); return }
          detailsSaved = res.data.changed
          saved = res.data.total
        }
        if (lotsChanged) {
          const res = await saveRefundLots(r.id, lots)
          if (!res.ok) {
            setMsg({ tone: "error", text: detailsSaved ? `The postage and ref code were saved, but the lots weren't — ${res.error}` : res.error })
            router.refresh()
            return
          }
          saved = res.data
        } else if (!detailsSaved) {
          setMsg({ tone: "info", text: "Nothing was changed, so nothing was saved." })
          return
        }
        setOpened(was)
        setMsg(saved
          ? { tone: "ok", text: savedWords(saved, keptWhose) }
          : detailsSaved?.length
            ? { tone: "ok", text: `Saved — ${detailsSaved.join(", ")}.` }
            : { tone: "info", text: "It already said that — nothing needed saving." })
        router.refresh()
      } catch {
        setMsg({ tone: "error", text: NO_ANSWER })
      }
    })
  }

  const oldPct = rawCell(r.importedRaw, "%")
  const oldBits = r.importedRaw
    ? [
        ["%", oldPct], ["Hammer", rawCell(r.importedRaw, "hammer price")], ["Commission", rawCell(r.importedRaw, "commission")],
        ["Postage", rawCell(r.importedRaw, "postage")], ["Total to refund", rawCell(r.importedRaw, "total to refund")],
      ].filter(([, v]) => v)
    : []

  return (
    <section className={`${card} p-4 sm:p-5`} aria-labelledby="lots-title">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 id="lots-title" className={cardTitle}>Lots &amp; money</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={askBc} disabled={!!bcWhyNot || bc.kind === "loading" || saving} title={bcWhyNot ?? "Look the buyer's lots up in BC (read only)"} className={btn}>
            {bc.kind === "loading" ? <><Spinner /> Reading BC…</> : "🔎 Fill from BC"}
          </button>
          <button type="button" onClick={addRow} disabled={saving} className={btn}>＋ Add a lot</button>
        </div>
      </div>
      {bcWhyNot && <p className={`text-xs ${muted} -mt-1 mb-3`}>{bcWhyNot}</p>}

      {/* What BC offers — nothing is used until "Use these". */}
      {bc.kind === "error" && (
        <p role="alert" className="mb-3 rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200">
          {bc.text}
          {bc.connect && <> <a href={bcConnectHref(`${REFUNDS_PATH}/${r.id}`)} className={inlineLink}>Sign in to BC →</a></>}
        </p>
      )}
      {bc.kind === "done" && <BcProposals found={bc.found} pick={bc.pick} onPick={pick => setBc({ ...bc, pick })} onUse={applyBc} onCancel={() => setBc({ kind: "idle" })} />}

      {rows.length === 0 ? (
        <p className={`text-sm ${muted}`}>No lots yet — {bcWhyNot ? "add them by hand" : "fill them from BC, or add them by hand"}.</p>
      ) : (
        <div>
          {/* Column names on a wide screen; each box has its own small label below that. */}
          <div className="hidden lg:grid lg:grid-cols-[7rem_minmax(0,1fr)_7rem_7rem_12rem_7rem_2.75rem] gap-2 pb-2 border-b border-gray-200 dark:border-gray-800 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            <span>Sale · lot</span><span>Description</span><span>Hammer £</span><span>Commission £</span><span>Worked out as</span><span className="text-right">Refund</span><span className="sr-only">Remove</span>
          </div>
          <ul className="space-y-2 lg:space-y-0 lg:divide-y lg:divide-gray-100 lg:dark:divide-gray-800">
            {rows.map((x, i) => {
              const { money, bad } = read[i]
              const amount = bad.length ? null : lotRefundPence(money)
              const autoCommission = money.hammerPence != null ? formatPence(commissionFor(money.hammerPence)).replace("£", "") : "27%"
              const n = x.lotNo.trim() || `row ${i + 1}`
              return (
                <li key={x.key} className="rounded-xl border border-gray-200 dark:border-gray-800 p-3 lg:rounded-none lg:border-0 lg:px-0 lg:py-2">
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-[7rem_minmax(0,1fr)_7rem_7rem_12rem_7rem_2.75rem] gap-2 items-start">
                    <div className="col-span-2 lg:col-span-1 grid grid-cols-2 lg:grid-cols-1 gap-2">
                      <Cell name="Sale"><input value={x.saleCode} onChange={e => change(x.key, { saleCode: e.target.value })} maxLength={REFUND_LIMITS.saleCode} placeholder="Sale" aria-label={`Sale for ${n}`} className={`${field} w-full font-mono`} /></Cell>
                      <Cell name="Lot *"><input value={x.lotNo} onChange={e => change(x.key, { lotNo: e.target.value })} maxLength={12} placeholder="Lot" aria-label={`Lot number, ${n}`} className={`${field} w-full font-mono`} /></Cell>
                    </div>
                    <div className="col-span-2 lg:col-span-1 min-w-0">
                      <Cell name="Description">
                        <input value={x.description} onChange={e => change(x.key, { description: e.target.value })} maxLength={300} placeholder="What the lot is" aria-label={`Description, ${n}`} className={`${field} w-full`} />
                      </Cell>
                      {(x.fromBc || x.uniqueId) && (
                        <p className={`text-xs ${muted} mt-1 truncate`}>{x.fromBc && "From BC"}{x.fromBc && x.uniqueId && " · "}{x.uniqueId && <span className="font-mono">{x.uniqueId}</span>}</p>
                      )}
                    </div>
                    <Cell name="Hammer £">
                      <input value={x.hammer} onChange={e => change(x.key, { hammer: e.target.value })} inputMode="decimal" placeholder="0.00" aria-label={`Hammer in pounds, ${n}`} aria-invalid={moneyIn(x.hammer) === undefined} className={`${field} w-full tabular-nums ${moneyIn(x.hammer) === undefined ? "border-red-500 dark:border-red-500" : ""}`} />
                    </Cell>
                    <Cell name="Commission £">
                      <input value={x.commission} onChange={e => change(x.key, { commission: e.target.value })} inputMode="decimal" placeholder={`auto ${autoCommission}`} aria-label={`Commission in pounds (blank is 27% of the hammer), ${n}`} aria-invalid={moneyIn(x.commission) === undefined} className={`${field} w-full tabular-nums ${moneyIn(x.commission) === undefined ? "border-red-500 dark:border-red-500" : ""}`} />
                    </Cell>
                    <div className="col-span-2 lg:col-span-1 grid grid-cols-[minmax(0,1fr)_6rem] lg:grid-cols-1 gap-2">
                      <Cell name="Worked out as">
                        <select value={x.basis} onChange={e => { if (isRefundBasis(e.target.value)) change(x.key, { basis: e.target.value }) }} aria-label={`How the refund on ${n} is worked out`} className={`${field} w-full`}>
                          {REFUND_BASES.map(b => <option key={b} value={b}>{REFUND_BASIS_LABELS[b]}</option>)}
                        </select>
                      </Cell>
                      {x.basis === "set" ? (
                        <Cell name="Amount £">
                          <input value={x.amount} onChange={e => change(x.key, { amount: e.target.value })} inputMode="decimal" placeholder="£ amount" aria-label={`Set amount in pounds, ${n}`} aria-invalid={moneyIn(x.amount) === undefined} className={`${field} w-full tabular-nums ${moneyIn(x.amount) === undefined ? "border-red-500 dark:border-red-500" : ""}`} />
                        </Cell>
                      ) : (
                        <Cell name="%">
                          <input value={x.pct} onChange={e => change(x.key, { pct: e.target.value })} inputMode="decimal" placeholder="%" aria-label={`Percentage, ${n}`} aria-invalid={pctIn(x.pct) === undefined} className={`${field} w-full tabular-nums ${pctIn(x.pct) === undefined ? "border-red-500 dark:border-red-500" : ""}`} />
                        </Cell>
                      )}
                    </div>
                    <div className="lg:text-right lg:pt-2.5">
                      <span className={`block text-xs ${muted} lg:hidden`}>Refund</span>
                      {amount != null
                        ? <span className="font-semibold tabular-nums text-gray-900 dark:text-white">{formatPence(amount)}</span>
                        : <span className="text-xs text-amber-700 dark:text-amber-300">{whyNot(money, bad)}</span>}
                    </div>
                    <div className="flex justify-end">
                      <button type="button" onClick={() => removeRow(x.key)} disabled={saving} aria-label={`Take out ${n}`} title="Take this lot out" className="inline-flex items-center justify-center h-11 w-11 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:text-red-600 hover:border-red-400 dark:hover:text-red-400 disabled:opacity-40">
                        ✕
                      </button>
                    </div>
                  </div>
                  {bad.length > 0 && <p role="alert" className="text-xs text-red-700 dark:text-red-300 mt-1">{capital(bad.join("; "))}.</p>}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Postage, the ref code and the total */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[12rem_12rem_minmax(0,1fr)] items-start">
        <label className="block">
          <span className={label}>Postage refunded £</span>
          <input value={postage} onChange={e => setPostage(e.target.value)} inputMode="decimal" placeholder="0.00" aria-invalid={postagePence === undefined} className={`${field} w-full tabular-nums ${postagePence === undefined ? "border-red-500 dark:border-red-500" : ""}`} />
        </label>
        <label className="block">
          <span className={label}>Ref code (accounts)</span>
          <input value={refCode} onChange={e => setRefCode(e.target.value)} maxLength={REFUND_LIMITS.refCode} placeholder="e.g. 4413" autoComplete="off" className={`${field} w-full font-mono`} />
        </label>
        <div className="sm:col-span-2 lg:col-span-1 rounded-xl bg-gray-50 dark:bg-gray-800/60 px-4 py-3" aria-live="polite">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">
            Total to refund{total.kept ? ` — ${keptWhose}` : ""}{dirty ? " (not saved yet)" : ""}
          </p>
          {nothing ? (
            <p className={`text-sm ${muted} mt-1`}>Nothing to work out yet — add the lots{bcWhyNot ? "" : " (or fill them from BC)"}.</p>
          ) : total.kept ? (
            // An old-log request whose lots can't work a whole total out: the saved one stands, said so.
            <>
              <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white mt-0.5">{formatPence(total.totalPence)}</p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                {rows.length
                  ? <>The lots here come to at least {formatPence(total.worked)} — {plural(total.missing, "lot")} can&apos;t be worked out yet, so {keptWhose} stands until every lot can be.</>
                  : <>No lots to work it out from, so {keptWhose} stands. Add the lots — each with a hammer and a %, or a set amount — to work it out here.</>}
              </p>
            </>
          ) : (
            <>
              <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white mt-0.5">
                {total.missing ? <span className="text-base font-semibold text-amber-700 dark:text-amber-300">at least </span> : null}{formatPence(total.worked)}
              </p>
              {total.missing > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                  {plural(total.missing, "lot")} can&apos;t be worked out yet — each needs a hammer and a %, or a set amount. Until every lot
                  can be, the list shows it as not worked out (never a total that&apos;s short).
                </p>
              )}
              {postagePence ? <p className={`text-xs ${muted} mt-1`}>Includes {formatPence(postagePence)} postage.</p> : null}
            </>
          )}
        </div>
      </div>

      {(r.percentText || oldBits.length > 0) && (
        <div className={`mt-3 text-xs ${muted} space-y-0.5`}>
          {r.percentText && <p>% agreed (in words): <span className="text-gray-700 dark:text-gray-200">&ldquo;{r.percentText}&rdquo;</span></p>}
          {oldBits.length > 0 && (
            <p>From the old log: {oldBits.map(([k, v], i) => <span key={k}>{i > 0 && " · "}{k} <span className="text-gray-700 dark:text-gray-200">{v}</span></span>)}</p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <button type="button" onClick={save} disabled={saving || !dirty} className={btnGo}>{saving ? "Saving…" : "Save lots & money"}</button>
        {dirty && <button type="button" onClick={undo} disabled={saving} className={btn}>Undo changes</button>}
        {dirty && <span className="text-xs text-amber-700 dark:text-amber-300">Unsaved changes</span>}
      </div>

      <Flash msg={msg} />
    </section>
  )
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** What a save did to the total, in words — the server's own working out. */
function savedWords(s: RefundTotalSaved, keptWhose: string): string {
  if (s.kept) return `Saved — the total stays ${formatPence(s.totalPence)} (${keptWhose}) until every lot can be worked out.`
  if (s.totalPence != null) return `Saved — total to refund ${formatPence(s.totalPence)}.`
  if (s.missing) return `Saved — the total isn't worked out yet: ${plural(s.missing, "lot")} can't be (the rest come to ${formatPence(s.worked)}).`
  return "Saved — there's nothing to work out a total from yet."
}

function Cell({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className={`block text-xs ${muted} mb-0.5 lg:hidden`} aria-hidden>{name}</span>
      {children}
    </div>
  )
}

/** The lots BC found, each with a tick (all ticked to start with), and Use these / Cancel. */
function BcProposals({ found, pick, onPick, onUse, onCancel }: {
  found: RefundBcFound; pick: boolean[]; onPick: (pick: boolean[]) => void; onUse: () => void; onCancel: () => void
}) {
  const ticked = pick.filter(Boolean).length
  const toggle = (i: number) => onPick(pick.map((p, j) => (j === i ? !p : p)))
  return (
    <div className="mb-4 rounded-xl border border-emerald-500/50 bg-emerald-50/60 dark:bg-emerald-500/5 p-4">
      <p className="text-sm font-semibold text-gray-900 dark:text-white">From BC</p>
      <p className="text-sm text-gray-700 dark:text-gray-200 mt-1">{found.note}</p>
      {found.lots.length > 0 && (
        <>
          <ul className="mt-3 divide-y divide-emerald-500/20">
            {found.lots.map((l: RefundBcProposal, i) => (
              <li key={`${l.saleCode}-${l.lotNo}-${l.uniqueId ?? i}`}>
                <label className="flex items-start gap-3 min-h-11 py-2 cursor-pointer">
                  <input type="checkbox" checked={pick[i] ?? false} onChange={() => toggle(i)} className="mt-1 h-5 w-5 shrink-0 accent-emerald-600" />
                  <span className="min-w-0 flex-1 grid gap-x-4 sm:grid-cols-[8rem_minmax(0,1fr)_auto] text-sm">
                    <span className="font-mono font-semibold text-gray-900 dark:text-white">{l.saleCode} · {l.lotNo}</span>
                    <span className="text-gray-700 dark:text-gray-200 break-words">{l.description ?? <span className={muted}>No description</span>}</span>
                    <span className="tabular-nums text-gray-900 dark:text-white sm:text-right whitespace-nowrap">
                      {formatPence(l.hammerPence)} <span className={`text-xs ${muted}`}>+ {formatPence(l.commissionPence)} commission</span>
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className={`text-xs ${muted} mt-2`}>Using them fills in each lot&apos;s sale, hammer, description and unique ID — a lot already on the list keeps its % or amount. Nothing is saved until you press Save.</p>
        </>
      )}
      <div className="flex flex-wrap gap-2 mt-3">
        {found.lots.length > 0 && <button type="button" onClick={onUse} disabled={!ticked} className={btnGo}>Use {ticked === found.lots.length ? "these" : `these ${ticked}`}</button>}
        <button type="button" onClick={onCancel} className={btn}>{found.lots.length ? "Cancel" : "Close"}</button>
      </div>
    </div>
  )
}
