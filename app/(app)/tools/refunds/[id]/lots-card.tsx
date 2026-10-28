"use client"

import { useRouter } from "next/navigation"
import { useEffect, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react"
import {
  lookUpRefundLots, lotsFromBc, saveRefundLots, updateRefund, type RefundLotInput, type RefundPatch, type RefundTotalSaved,
} from "@/lib/actions/refunds"
import type { RefundBcFound, RefundBcProposal, RefundLotLookup } from "@/lib/refunds-bc"
import {
  CLOSED_REFUND_STATUSES, REFUND_BASES, REFUND_BASIS_LABELS, REFUND_LIMITS, REFUNDS_PATH, RETURNS_ACCOUNT, commissionDiffers, commissionFor, commissionUsed,
  formatPence, isRefundBasis, isSaleCode, lotRefundPence, oldLogCell, poundsToPence, refundTotalToSave,
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
//
// A row looks itself up as soon as it has a sale (or the request has an auction date) and a lot
// number (Jack, 2026-10-26: "when the lot number and the sale has been filled in, the barcode number
// and receipt number pull in with it along with hammer price") — lookUpRefundLots, LOOKUP_WAIT after
// the typing stops, every waiting row in one call. It fills the unique ID, BC's barcode for that sale
// and the receipt number, and the hammer, description and (a buyer's) commission where the box is blank
// or still holds what BC put in it — one typed in by hand is kept, with BC's said beside it ("Use
// BC's"). The commission is what BC CHARGED (Jack, 2026-10-28): the buyer's premium plus, for an online
// bidder, the web premium, inc VAT — 32.94% of the hammer, not 27%. Taken only with BC's own hammer.
//  • Opening the request (and each save) CHECKS its saved lots against BC (`check` — no barcode read):
//    BC's hammer and commission are said beside any that differ, or are missing — NOTHING in the boxes
//    changes (Jack: "only flag — I'll check each one"). "Use BC's" for a commission only on an open
//    request; a paid or closed one is left as it was.
//  • Each row remembers what BC last filled it with and for which sale + lot (`bc`, BcFill). Change
//    the sale or lot and the other lot's unique ID, barcode and receipt go — and any box still holding
//    BC's value for it — until the new one is looked up; change it back and they come back.
//  • Only rows that are new or whose sale or lot has been changed are looked up on their own — opening
//    a request never changes its boxes. Saved rows with no barcode or receipt yet (saved before this,
//    or the old log's) are looked up when "Get barcodes from BC" is pressed (`forced`).
//  • Save waits while a row is waiting or being looked up, so a row is never saved without its answer.
// Nothing is saved until Save.

/** How long after the last key press a row's sale + lot are looked up. */
const LOOKUP_WAIT = 700
/** A lot number BC could have: digits, then at most two letters. */
const LOT_NO_RE = /^\d{1,6}[A-Z]{0,2}$/

type Row = {
  key: string
  saleCode: string
  lotNo: string
  uniqueId: string | null
  /** BC's Internal Barcode for the lot in that sale, and its receipt — from BC, never typed. */
  barcode: string | null
  receiptNo: string | null
  description: string
  hammer: string
  /** "" = 27% of the hammer, worked out (a lookup fills in what BC charged). */
  commission: string
  basis: RefundBasis
  pct: string
  amount: string
  /** What BC last filled the row with — never saved as such (see BcFill). */
  bc: BcFill | null
}

/**
 * What BC last filled a row with, and for which sale + lot (`sig`): the unique ID, barcode and receipt
 * it gave, and the hammer, description and commission it PUT IN the boxes (null when it didn't — a box
 * typed in by hand is the person's). A box still holding BC's value is BC's to change; `refsDone` false
 * when BC's receipt lines couldn't be read (so the barcode is worth asking for again).
 */
type BcFill = {
  sig: string
  refsDone: boolean
  uniqueId: string | null
  barcode: string | null
  receiptNo: string | null
  hammer: string | null
  description: string | null
  commission: string | null
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
    rows: r.lots.map(l => {
      const x = {
        key: l.id,
        saleCode: l.saleCode ?? "",
        lotNo: l.lotNo,
        uniqueId: l.uniqueId,
        barcode: l.barcode,
        receiptNo: l.receiptNo,
        description: l.description ?? "",
        hammer: poundsOf(l.hammerPence),
        commission: poundsOf(l.commissionPence),
        basis: l.basis,
        pct: l.percent == null ? "" : String(l.percent),
        amount: poundsOf(l.setAmountPence),
      }
      // A saved row's BC details are for the sale + lot it was saved with; a box counts as BC's only
      // when it was saved as BC's (hammerFromBc / descriptionFromBc / commissionFromBc — older lots, with
      // just fromBc, count as typed in, so a lookup never replaces them). Only a barcode says its receipt
      // line was read (a receipt alone can be the unique ID's, from a read that failed).
      const bc: BcFill | null = l.hammerFromBc || l.descriptionFromBc || l.commissionFromBc || l.uniqueId || l.barcode || l.receiptNo
        ? {
            sig: lotSig(x), refsDone: !!l.barcode || l.refsRead, uniqueId: l.uniqueId, barcode: l.barcode, receiptNo: l.receiptNo,
            hammer: l.hammerFromBc && x.hammer ? x.hammer : null, description: l.descriptionFromBc && x.description ? x.description : null,
            commission: l.commissionFromBc && x.commission ? x.commission : null,
          }
        : null
      return { ...x, bc }
    }),
    postage: poundsOf(r.postagePence),
    refCode: r.refCode ?? "",
  }
}

/** A box still holds what BC put in it — for the sale + lot the row says now (the same figure typed in
 *  for another lot is the person's). */
const bcHammerIn = (x: Row) => x.bc?.hammer != null && x.bc.sig === lotSig(x) && x.hammer === x.bc.hammer
const bcDescriptionIn = (x: Row) => x.bc?.description != null && x.bc.sig === lotSig(x) && x.description === x.bc.description
const bcCommissionIn = (x: Row) => x.bc?.commission != null && x.bc.sig === lotSig(x) && x.commission === x.bc.commission
/** "From BC" — saved as RefundLot.fromBc: the hammer, description or commission is BC's. */
const isFromBc = (x: Row) => bcHammerIn(x) || bcDescriptionIn(x) || bcCommissionIn(x)

/** A row as it would be saved — what "unsaved changes" compares (never the BC bookkeeping). */
const persisted = (x: Row) => [
  x.saleCode, x.lotNo, x.uniqueId, x.barcode, x.receiptNo, x.description, x.hammer, x.commission, x.basis, x.pct, x.amount,
  bcHammerIn(x), bcDescriptionIn(x), bcCommissionIn(x),
]

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

const sameRows = (a: Row[], b: Row[]) => JSON.stringify(a.map(persisted)) === JSON.stringify(b.map(persisted))
const sameSaved = (a: Saved, b: Saved) => a.postage === b.postage && a.refCode === b.refCode && sameRows(a.rows, b.rows)

/** A row's sale + lot as BC would be asked — what decides whether it needs looking up again. */
const lotSig = (x: Pick<Row, "saleCode" | "lotNo">) => `${x.saleCode.trim().toUpperCase()}|${x.lotNo.trim().toUpperCase().replace(/\s+/g, "")}`

/** What BC has for a row's lot (the same item): its hammer, what it charged on top (inc VAT) and what
 *  that's made of, and whether BC has moved it to the returns account (refunded or returned in BC). */
type BcFigures = { hammerPence: number | null; commissionPence: number | null; commissionWords: string | null; returned: boolean }

/** A row's lookup: the sale + lot it was for, where it stands, what BC said beyond the boxes, and BC's
 *  figures for it (null when BC has no such lot, or it's another item) — said beside any that differ. */
type Look = { sig: string; state: "loading" | "done" | "error"; note: string | null; bc: BcFigures | null }

const figuresOf = (l: RefundLotLookup): BcFigures => ({
  hammerPence: l.hammerPence, commissionPence: l.commissionPence, commissionWords: l.commissionWords, returned: l.buyerNo === RETURNS_ACCOUNT,
})

/** The old log's cell under one of its column names (they have spaces round them: " Hammer price "). */
const rawCell = (raw: Record<string, string> | null, name: string) => oldLogCell(raw, name)

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
  // Each row's BC lookup (by row key), whether BC needs signing in to, and the saved rows "Get barcodes
  // from BC" asked to look up. `rowsNow` is the rows as last rendered — what a lookup's answer is put
  // into when it comes back (kept in step by an effect, never written during a render).
  const [looks, setLooks] = useState<Record<string, Look>>({})
  const [lookNeedsBc, setLookNeedsBc] = useState(false)
  // The check of the saved lots against BC couldn't run for want of a BC sign-in; `checkRun` asks again.
  const [checkNeedsBc, setCheckNeedsBc] = useState(false)
  const [checkRun, setCheckRun] = useState(0)
  // What the check of the saved lots found, by row key — kept apart from `looks`, so it never stands in
  // for (or stops) a row's own lookup, and an undo or a retype back to the saved lot shows it again.
  const [checks, setChecks] = useState<Record<string, Look>>({})
  const [forced, setForced] = useState<ReadonlySet<string>>(new Set())
  // Just saved, and the page hasn't come back with it yet — the saved total it shows is the old one.
  const [refreshing, setRefreshing] = useState(false)
  const rowsNow = useRef(rows)
  useEffect(() => { rowsNow.current = rows }, [rows])
  // A row with no sale of its own is looked up by the REQUEST's sale or auction date (and told apart by
  // its C-number): when Details changes those, what BC said for such rows was for the old ones — it goes
  // (a row BC didn't find is asked again — a saved one under "Get barcodes from BC"; an answer still on
  // its way for the old ones is ignored — `ctxGen`), and the check runs again (the lots, `sig`, haven't
  // changed). ⚠ Before the server sync below: when both change at once, the sync's rows (new keys) win.
  const ctxSig = JSON.stringify([r.saleCode, r.auctionDate, r.party, r.customerNo])
  const [seenCtx, setSeenCtx] = useState(ctxSig)
  const [ctxGen, setCtxGen] = useState(0)
  if (seenCtx !== ctxSig) {
    setSeenCtx(ctxSig)
    setCtxGen(g => g + 1)
    setChecks({})
    const blankSale = new Set(rows.filter(x => !x.saleCode.trim()).map(x => x.key))
    setLooks(ls => Object.fromEntries(Object.entries(ls).filter(([key]) => !blankSale.has(key))))
    // Only a not-found answer stays on a row with no sale (a found one fills its sale in) — it holds no
    // box of BC's, so forgetting it (or that its barcode was looked for) changes nothing to be saved.
    const savedAt = new Map(opened.rows.map(x => [x.key, lotSig(x)]))
    setRows(rs => rs.map(x => {
      if (x.saleCode.trim() || x.bc?.sig !== lotSig(x)) return x
      if (lotSig(x) !== savedAt.get(x.key)) return { ...x, bc: null }
      return !x.barcode && x.bc.refsDone ? { ...x, bc: { ...x.bc, refsDone: false } } : x
    }))
  }
  if (seen !== sig) {
    setSeen(sig)
    setRefreshing(false)
    if (!dirty) {
      setOpened(server); setRows(server.rows); setPostage(server.postage); setRefCode(server.refCode)
      setLooks({}); setForced(new Set())
    }
  }
  // Kept in step straight after each render (a layout effect), so a lookup timer that fires reads the
  // request's context as it is now.
  const ctxGenNow = useRef(ctxGen)
  useLayoutEffect(() => { ctxGenNow.current = ctxGen }, [ctxGen])

  const [msg, setMsg] = useState<FlashMessage | null>(null)
  const [saving, startSaving] = useTransition()
  const [bc, setBc] = useState<Bc>({ kind: "idle" })
  const counter = useRef(0)
  const newKey = () => `new-${++counter.current}`
  const defaultPct = plainPercent(r.percentText)
  // A buyer's commission is the premium BC charged them; a vendor's payout isn't worked from it.
  const buyer = r.party !== "vendor"
  const closed = CLOSED_REFUND_STATUSES.includes(r.status)

  /** A row BC could be asked about: a lot number it could have, and a sale (or the request's auction
   *  date) to find it in — and no answer from BC yet for this sale + lot. */
  const askable = (x: Row) => {
    const lot = x.lotNo.trim().toUpperCase().replace(/\s+/g, "")
    if (!LOT_NO_RE.test(lot) || (!x.saleCode.trim() && !isSaleCode(r.saleCode) && !r.auctionDate)) return false
    return !(x.bc?.sig === lotSig(x) && x.bc.refsDone)
  }
  // The rows that want looking up now: askable, not being (or just) looked up as this sale + lot, and
  // new or changed since opening — or a saved row "Get barcodes from BC" asked for.
  const openedSigs = new Map(opened.rows.map(x => [x.key, lotSig(x)]))
  const waiting = rows.filter(x => {
    if (!askable(x)) return false
    const sig = lotSig(x)
    if (looks[x.key]?.sig === sig) return false   // being looked up, or BC answered or failed — retyping asks again
    return sig !== openedSigs.get(x.key) || forced.has(x.key)
  })
  const waitingSig = waiting.map(x => `${x.key}=${lotSig(x)}`).join(",")
  const lookingUp = waiting.length > 0 || rows.some(x => looks[x.key]?.state === "loading" && looks[x.key].sig === lotSig(x))
  // Saved rows with a sale + lot but no barcode yet — "Get barcodes from BC".
  const unlooked = rows.filter(x => !x.barcode && askable(x) && lotSig(x) === openedSigs.get(x.key) && !forced.has(x.key))

  useEffect(() => {
    if (!waitingSig || saving) return
    const t = setTimeout(() => {
      const asks = waiting.map(x => ({ key: x.key, saleCode: x.saleCode.trim() || null, lotNo: x.lotNo.trim() }))
      const sent = new Map(waiting.map(x => [x.key, lotSig(x)]))
      // Rows asked by the request's sale or date — their answer is for the request as it was now (`gen`).
      const byRequest = new Set(asks.filter(a => !a.saleCode).map(a => a.key))
      const gen = ctxGenNow.current
      const stale = (key: string) => byRequest.has(key) && gen !== ctxGenNow.current
      const failed = (note: string) => setLooks(ls => {
        const next = { ...ls }
        for (const [key, s] of sent) if (next[key]?.sig === s && !stale(key)) next[key] = { sig: s, state: "error", note, bc: null }
        return next
      })
      setLooks(ls => {
        const next = { ...ls }
        for (const [key, s] of sent) next[key] = { sig: s, state: "loading", note: null, bc: null }
        return next
      })
      lookUpRefundLots(r.id, asks).then(res => {
        if (!res.ok) { if (res.needsBc) setLookNeedsBc(true); failed(res.error); return }
        setLookNeedsBc(false)
        applyLookups(res.data, new Map([...sent].filter(([key]) => !stale(key))))
      }, () => failed("The Hub didn't answer — retype the lot number to try again."))
    }, LOOKUP_WAIT)
    return () => clearTimeout(t)
    // `waiting` is worked out from `rows`, `looks`, `opened` and `forced` on every render; `waitingSig`
    // says when it changed (and `ctxGen` when the request's sale or date did — asked afresh).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingSig, saving, ctxGen])

  /** What BC said for each looked-up row, put in the row — only while the row still says the sale + lot
   *  it was asked about (typing on meanwhile asks again instead). A box is filled when it's blank or
   *  still holds BC's value; one typed in by hand is kept (BC's hammer is said beside it). */
  function applyLookups(found: RefundLotLookup[], sent: Map<string, string>) {
    const byKey = new Map(found.map(f => [f.key, f]))
    const notes = new Map<string, Look>()
    const nextRows = rowsNow.current.map(x => {
      const l = byKey.get(x.key)
      const s = sent.get(x.key)
      if (!l || !s || lotSig(x) !== s) return x
      // A saved row still at the sale + lot it was saved with ("Get barcodes from BC"): only what it's
      // missing is filled — its saved boxes and details are never changed by a lookup.
      const saved = s === openedSigs.get(x.key)
      if (!l.found) {
        notes.set(x.key, { sig: s, state: "done", note: l.note, bc: null })
        if (saved) return { ...x, bc: { ...(x.bc ?? { uniqueId: x.uniqueId, barcode: x.barcode, receiptNo: x.receiptNo, hammer: null, description: null, commission: null }), sig: s, refsDone: true } }
        // Not in BC: nothing to fill (the other lot's BC values already went when the lot changed).
        return { ...x, uniqueId: null, barcode: null, receiptNo: null, bc: { sig: s, refsDone: true, uniqueId: null, barcode: null, receiptNo: null, hammer: null, description: null, commission: null } }
      }
      // A saved row whose unique ID isn't BC's for this sale + lot is a different item — nothing of BC's
      // goes in beside it (said instead).
      const same = !saved || !x.uniqueId || x.uniqueId.toUpperCase() === (l.uniqueId ?? "").toUpperCase()
      // A saved row takes BC's barcode and receipt TOGETHER (the receipt is that barcode's line's).
      const takeRefs = saved && same && !x.barcode && !!l.barcode
      const bcHammer = l.hammerPence != null ? poundsOf(l.hammerPence) : null
      const takeHammer = same && bcHammer != null && (!x.hammer.trim() || (!saved && bcHammerIn(x)))
      const takeDescription = same && !!l.description && (!x.description.trim() || (!saved && bcDescriptionIn(x)))
      const next: Row = {
        ...x,
        // (never another item's sale, beside a saved row's own unique ID)
        saleCode: x.saleCode.trim() || !same ? x.saleCode : (l.saleCode ?? ""),
        lotNo: saved ? x.lotNo : (l.lotNo ?? x.lotNo),
        uniqueId: saved ? (x.uniqueId ?? l.uniqueId) : l.uniqueId,
        barcode: saved ? (takeRefs ? l.barcode : x.barcode) : l.barcode,
        receiptNo: saved ? (takeRefs ? l.receiptNo : (x.receiptNo ?? (same ? l.receiptNo : null))) : l.receiptNo,
        // BC's old value where BC now has none → blank (never for a saved row's own boxes).
        hammer: takeHammer ? bcHammer! : !saved && bcHammerIn(x) ? "" : x.hammer,
        description: takeDescription ? (l.description ?? "") : !saved && bcDescriptionIn(x) ? "" : x.description,
      }
      // A buyer's commission: what BC charged — only beside BC's own hammer (BC's commission for another
      // hammer would be wrong), into a box that's blank or still BC's. ⚠ Never into a SAVED row ("Get
      // barcodes from BC"): its blank box is the 27% its refund was worked out (maybe paid) at, not
      // something missing — BC's is said beside it instead, with "Use BC's" on an open request.
      // The same goes for a saved row whose sale was just typed in (the request's, say) while its
      // commission box is as saved — when it's BC's same item, or the request is paid or closed.
      const was = opened.rows.find(o => o.key === x.key)
      const keepSaved = !!was && x.commission === was.commission
        && (closed || (!!was.uniqueId && was.uniqueId.toUpperCase() === (l.uniqueId ?? "").toUpperCase()))
      const bcCommission = buyer && l.commissionPence != null ? poundsOf(l.commissionPence) : null
      const takeCommission = !saved && !keepSaved && same && bcCommission != null && l.hammerPence != null && moneyIn(next.hammer) === l.hammerPence
        && (!x.commission.trim() || bcCommissionIn(x))
      next.commission = takeCommission ? bcCommission! : !saved && bcCommissionIn(x) ? "" : x.commission
      const mismatch = same ? null
        : `The saved unique ID (${x.uniqueId}) isn't BC's for this sale and lot (${l.uniqueId ?? "none"}) — nothing was filled in; check the sale and lot number.`
      // Filling in the sale (from the auction date) or BC's suffix changes the row's sale + lot — it
      // was looked up as that, so it isn't asked again.
      next.bc = {
        sig: lotSig(next), refsDone: l.refsRead || !same, uniqueId: next.uniqueId, barcode: next.barcode, receiptNo: next.receiptNo,
        // What BC put in the boxes now — a saved row keeps what it was saved as for boxes left alone.
        hammer: takeHammer ? bcHammer : saved ? (x.bc?.hammer ?? null) : null,
        description: takeDescription ? l.description : saved ? (x.bc?.description ?? null) : null,
        commission: takeCommission ? bcCommission : saved ? (x.bc?.commission ?? null) : null,
      }
      // BC's figures for the row — said beside a hammer or commission that differs (never for another item).
      notes.set(x.key, { sig: lotSig(next), state: "done", note: [mismatch, l.note].filter(Boolean).join(" ") || null, bc: same ? figuresOf(l) : null })
      return next
    })
    rowsNow.current = nextRows
    setRows(nextRows)
    setLooks(ls => {
      const next = { ...ls }
      for (const [key, look] of notes) next[key] = look
      // A row whose answer wasn't used (it changed meanwhile) is left for the next look.
      for (const [key, s] of sent) if (!notes.has(key) && next[key]?.sig === s && next[key].state === "loading") delete next[key]
      return next
    })
  }

  // The saved lots checked against BC as the card opens, again after each save (the server's `sig`
  // changes) and when the request's sale, date or buyer change (`ctxSig`): BC's figures go beside the
  // rows (`checks`) — NOTHING in the boxes changes. Only while the rows are the saved ones (an edit in
  // hand has its own lookups); only the latest check's answer is used (`checkSeq`).
  const checkedFor = useRef<string | null>(null)
  const checkSeq = useRef(0)
  useEffect(() => {
    const at = `${sig}|${ctxSig}#${checkRun}`
    if (checkedFor.current === at) return
    const now = rowsNow.current
    // Being edited — checked once the rows are the saved ones again (saved, or undone: `dirty`).
    if (!sameRows(now, server.rows)) return
    checkedFor.current = at
    const seq = ++checkSeq.current
    const asks = now.filter(x => LOT_NO_RE.test(x.lotNo.trim().toUpperCase().replace(/\s+/g, "")) && (x.saleCode.trim() || isSaleCode(r.saleCode) || r.auctionDate))
      .map(x => ({ key: x.key, saleCode: x.saleCode.trim() || null, lotNo: x.lotNo.trim() }))
    if (!asks.length) return
    const sent = new Map(now.map(x => [x.key, lotSig(x)]))
    lookUpRefundLots(r.id, asks, true).then(res => {
      if (seq !== checkSeq.current) return
      if (!res.ok) { if (res.needsBc) setCheckNeedsBc(true); return }
      setCheckNeedsBc(false)
      const found: Record<string, Look> = {}
      for (const l of res.data) {
        const s = sent.get(l.key)
        const x = now.find(row => row.key === l.key)
        if (!s || !x) continue
        const same = !l.found || !x.uniqueId || x.uniqueId.toUpperCase() === (l.uniqueId ?? "").toUpperCase()
        const mismatch = same ? null : `BC's lot for this sale and number is a different item (${l.uniqueId ?? "none"}) from the one saved (${x.uniqueId}) — check the sale and lot number.`
        found[l.key] = { sig: s, state: "done", note: [mismatch, l.note].filter(Boolean).join(" ") || null, bc: l.found && same ? figuresOf(l) : null }
      }
      setChecks(found)
    }, () => { /* the check is a help — a failure just leaves the rows unchecked */ })
    // The saved rows are what `sig` says, the request's sale, date and buyer `ctxSig`; `checkRun` asks
    // again after signing in to BC; `dirty` going back to false (an undo) lets a check held back run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, ctxSig, checkRun, dirty])

  const read = rows.map(readRow)
  const postagePence = moneyIn(postage)
  // What Save would save — the same rule as the server — with what the lots that CAN be worked out
  // come to (`worked`) for the "at least".
  const total = refundTotalToSave(read.map(x => x.money), postagePence ?? null, { source: r.source, totalPence: r.totalPence })
  const nothing = !rows.length && postagePence == null && !total.kept
  // Whose total stands while the lots can't work one out: the old log's, unless it has been changed since.
  const logTotal = poundsToPence(rawCell(r.importedRaw, "total to refund"))
  const keptWhose = logTotal != null && logTotal === r.totalPence ? "the old log's total" : "the saved total"
  // Totals that don't agree — said, never changed (Jack, 2026-10-28: "only flag — I'll check each one"):
  // the old log's against what its lots work out at, or the saved one (the list's and the CSV's) against it.
  const logDiffers = r.source === "import" && logTotal != null && rows.length > 0 && !total.missing && total.worked !== logTotal
  // (no saved total at all counts — the list says "Not worked out" for lots that do work one out — bar a
  // declined or closed request, which owes nothing)
  const savedDiffers = !dirty && !refreshing && !total.kept && total.totalPence != null && total.totalPence !== r.totalPence
    && (r.totalPence != null || (r.status !== "declined" && r.status !== "closed"))

  // "Fill from BC" (the button): a buyer's lots, by C-number and the sale (or the auction date). The
  // row lookup works for every request.
  const bcWhyNot = r.party === "vendor"
    ? "“Fill from BC” is for a buyer's lots — type each lot's sale and number and BC fills in the rest."
    : !r.customerNo
      ? "“Fill from BC” needs the buyer's C-number under Details — or type each lot's sale and number and BC fills in the rest."
      : !r.saleCode && !r.auctionDate
        ? "“Fill from BC” needs the sale (or the auction date) under Details — or type each lot's sale and number."
        : null

  function change(key: string, patch: Partial<Row>) {
    setRows(rs => rs.map(x => {
      if (x.key !== key) return x
      const next = { ...x, ...patch }
      const s = lotSig(next)
      if (s === lotSig(x)) return next
      const b = x.bc
      if (b && b.sig === s) {
        // Back to the sale + lot BC filled it for: its BC details come back (boxes typed meanwhile stay).
        return {
          ...next, uniqueId: b.uniqueId, barcode: b.barcode, receiptNo: b.receiptNo,
          hammer: next.hammer.trim() ? next.hammer : (b.hammer ?? ""),
          description: next.description.trim() ? next.description : (b.description ?? ""),
          commission: next.commission.trim() ? next.commission : (b.commission ?? ""),
        }
      }
      const was = opened.rows.find(o => o.key === key)
      if (was && lotSig(was) === s) {
        // Back to the sale + lot it was saved with: it's as it was saved again — its details, and any
        // box left blank or still holding BC's value for the lot it said in between.
        return {
          ...next, uniqueId: was.uniqueId, barcode: was.barcode, receiptNo: was.receiptNo, bc: was.bc,
          hammer: !next.hammer.trim() || bcHammerIn(x) ? was.hammer : next.hammer,
          description: !next.description.trim() || bcDescriptionIn(x) ? was.description : next.description,
          commission: !next.commission.trim() || bcCommissionIn(x) ? was.commission : next.commission,
        }
      }
      // Another sale or lot: what BC gave for the old one goes — the IDs, and any box still holding
      // BC's value for it — so no other lot's hammer or commission is ever saved against this one. A
      // paid or closed request's commission as it was saved stays (never changed without a click).
      const keepCommission = closed && !!was && x.commission === was.commission
      return {
        ...next, uniqueId: null, barcode: null, receiptNo: null,
        hammer: bcHammerIn(x) ? "" : next.hammer,
        description: bcDescriptionIn(x) ? "" : next.description,
        commission: bcCommissionIn(x) && !keepCommission ? "" : next.commission,
      }
    }))
    // A new sale or lot is asked about afresh (retyping one that failed tries again).
    if ("saleCode" in patch || "lotNo" in patch) setLooks(ls => { if (!ls[key]) return ls; const n = { ...ls }; delete n[key]; return n })
  }
  /** "Use BC's" hammer or commission: the box takes BC's, and it counts as BC's from then on (a row BC
   *  hadn't filled before — one checked as the card opened — starts its BC record here). */
  function takeFromBc(key: string, box: "hammer" | "commission", pence: number) {
    const v = poundsOf(pence)
    setRows(rs => rs.map(x => {
      if (x.key !== key) return x
      const b: BcFill = x.bc && x.bc.sig === lotSig(x)
        ? x.bc
        : { sig: lotSig(x), refsDone: false, uniqueId: x.uniqueId, barcode: x.barcode, receiptNo: x.receiptNo, hammer: null, description: null, commission: null }
      return { ...x, [box]: v, bc: { ...b, [box]: v } }
    }))
  }
  function addRow() {
    if (rows.length >= REFUND_LIMITS.lots) { setMsg({ tone: "error", text: `A request can hold ${REFUND_LIMITS.lots} lots at most.` }); return }
    setRows(rs => [...rs, { key: newKey(), saleCode: r.saleCode ?? "", lotNo: "", uniqueId: null, barcode: null, receiptNo: null, description: "", hammer: "", commission: "", basis: "percent", pct: defaultPct, amount: "", bc: null }])
  }
  function removeRow(key: string) {
    setRows(rs => rs.filter(x => x.key !== key))
  }
  function undo() {
    setRows(opened.rows); setPostage(opened.postage); setRefCode(opened.refCode); setMsg(null)
    setLooks({}); setForced(new Set())
  }
  /** "Get barcodes from BC": the saved rows with a sale + lot but no barcode or receipt are looked up. */
  function lookUpSaved() {
    if (!unlooked.length) return
    setForced(f => new Set([...f, ...unlooked.map(x => x.key)]))
    setLooks(ls => { const n = { ...ls }; for (const x of unlooked) delete n[x.key]; return n })
  }
  /** After signing in to BC (in another tab): the lookups that failed are asked again, and the check. */
  function retryLookups() {
    setLookNeedsBc(false)
    setLooks(ls => Object.fromEntries(Object.entries(ls).filter(([, l]) => l.state !== "error")))
    if (checkNeedsBc) { setCheckNeedsBc(false); setCheckRun(n => n + 1) }
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
    const filledKeys: string[] = []
    // BC's figures beside each row filled (a commission typed in is kept, and BC's said by it) — for the
    // rows not looked up again for their barcode, which get them from that lookup.
    const figures = new Map<string, Look>()
    for (const p of chosen) {
      const i = next.findIndex(x => x.lotNo.trim().toUpperCase() === p.lotNo && (!x.saleCode.trim() || !p.saleCode || x.saleCode.trim().toUpperCase() === p.saleCode))
      const hammer = poundsOf(p.hammerPence)
      const description = p.description ?? ""
      // BC's receipt lines couldn't be read for this proposal: a barcode the row already has for the
      // same item stays (never swapped for nothing).
      const had = i >= 0 ? next[i] : null
      const keepRefs = !p.refsRead && !!had?.barcode && !!had.uniqueId && had.uniqueId.toUpperCase() === (p.uniqueId ?? "").toUpperCase()
      const barcode = keepRefs ? had!.barcode : p.barcode
      const receiptNo = keepRefs ? had!.receiptNo : p.receiptNo
      // What BC charged, into a commission box that's blank or still BC's — one typed in is kept.
      const bcCommission = poundsOf(p.commissionPence)
      const commission = had && had.commission.trim() && !bcCommissionIn(had) ? had.commission : bcCommission
      const fromBc = { saleCode: p.saleCode ?? "", lotNo: p.lotNo, uniqueId: p.uniqueId, barcode, receiptNo, description, hammer, commission }
      // Filled from BC — so not looked up again for the same sale + lot, unless the barcode is missing.
      const fill = (x: Omit<Row, "bc">): Row => ({
        ...x,
        bc: {
          sig: lotSig(x), refsDone: p.refsRead || keepRefs, uniqueId: p.uniqueId, barcode, receiptNo,
          hammer: hammer || null, description: description || null, commission: bcCommission && commission === bcCommission ? bcCommission : null,
        },
      })
      if (i >= 0) { next[i] = fill({ ...next[i], ...fromBc }); filledKeys.push(next[i].key); filled++ }
      else { const key = newKey(); next.push(fill({ key, ...fromBc, basis: "percent", pct: defaultPct, amount: "" })); filledKeys.push(key); added++ }
      const row = next[i >= 0 ? i : next.length - 1]
      if (row.bc?.refsDone) {
        figures.set(row.key, {
          sig: lotSig(row), state: "done", note: null,
          bc: { hammerPence: p.hammerPence, commissionPence: p.commissionPence, commissionWords: p.commissionWords, returned: false },
        })
      }
    }
    const over = next.length - REFUND_LIMITS.lots
    setRows(over > 0 ? next.slice(0, REFUND_LIMITS.lots) : next)
    // An earlier lookup's answer is for what the row said before — a row still missing its barcode is
    // asked again on its own.
    setLooks(ls => { const n = { ...ls }; for (const k of filledKeys) { const f = figures.get(k); if (f) n[k] = f; else delete n[k] } return n })
    setBc({ kind: "idle" })
    setMsg({
      tone: "info",
      text: `${[added ? `${plural(added, "lot")} added` : null, filled ? `${plural(filled, "lot")} filled in` : null].filter(Boolean).join(", ")} from BC`
        + `${over > 0 ? ` (${plural(over, "lot")} left out — a request holds ${REFUND_LIMITS.lots} at most)` : ""}. `
        + `Check the % or amounts, then press Save — nothing is saved until you do.`,
    })
  }

  function save() {
    if (saving || lookingUp) return
    const blank = rows.findIndex(x => !x.lotNo.trim())
    if (blank >= 0) { setMsg({ tone: "error", text: `Row ${blank + 1} has no lot number — fill it in or take the row out. Nothing was saved.` }); return }
    const badRow = read.findIndex(x => x.bad.length)
    if (badRow >= 0) { setMsg({ tone: "error", text: `Lot ${rows[badRow].lotNo.trim()}: ${read[badRow].bad[0]}. Nothing was saved.` }); return }
    if (postagePence === undefined) { setMsg({ tone: "error", text: "Postage refunded isn't a sum of money (for example 4.50). Nothing was saved." }); return }

    // A saved total the saved lots don't come to is worked out again by saving them as they are.
    const lotsChanged = !sameRows(rows, opened.rows) || savedDiffers
    const patch: RefundPatch = {}
    if (postage.trim() !== opened.postage.trim()) patch.postagePence = postagePence
    if (refCode.trim() !== opened.refCode.trim()) patch.refCode = refCode
    const lots: RefundLotInput[] = rows.map((x, i) => ({
      saleCode: x.saleCode, lotNo: x.lotNo, uniqueId: x.uniqueId, barcode: x.barcode, receiptNo: x.receiptNo, description: x.description,
      hammerPence: read[i].money.hammerPence, commissionPence: read[i].money.commissionPence, basis: x.basis,
      percent: x.basis === "set" ? null : read[i].money.percent, setAmountPence: x.basis === "set" ? read[i].money.setAmountPence : null,
      fromBc: isFromBc(x), hammerFromBc: bcHammerIn(x), descriptionFromBc: bcDescriptionIn(x), commissionFromBc: bcCommissionIn(x),
      refsRead: !!x.bc && x.bc.sig === lotSig(x) && x.bc.refsDone,
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
        // Something was written — the page coming back with it (`sig`) ends this.
        if (saved || detailsSaved?.length) setRefreshing(true)
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
          {unlooked.length > 0 && (
            <button type="button" onClick={lookUpSaved} disabled={saving || lookingUp} title="Look the saved lots up in BC for their barcode and receipt number (read only)" className={btn}>
              🏷️ Get barcodes from BC ({unlooked.length})
            </button>
          )}
          <button type="button" onClick={addRow} disabled={saving} className={btn}>＋ Add a lot</button>
        </div>
      </div>
      {lookNeedsBc ? (
        // ⚠ Signing in opens in a NEW tab — leaving this page would lose the unsaved lots.
        <p role="alert" className="mb-3 text-xs text-amber-700 dark:text-amber-300">
          Sign in to BC to pull each lot&apos;s hammer, barcode and receipt number in — it opens in a new tab, so nothing here is lost.{" "}
          <a href={bcConnectHref(`${REFUNDS_PATH}/${r.id}`)} target="_blank" rel="noopener noreferrer" className={inlineLink}>Sign in to BC ↗</a>{" "}
          <button type="button" onClick={retryLookups} className={inlineLink}>Signed in — try again</button>
        </p>
      ) : (
        <p className={`text-xs ${muted} -mt-1 mb-3`}>
          {bcWhyNot ?? <>Fill in a lot&apos;s sale{isSaleCode(r.saleCode) ? ` (or leave it blank for the request's, ${r.saleCode.trim().toUpperCase()})` : r.auctionDate ? " (or leave it blank for the auction date)" : ""} and number and its hammer, {buyer ? "commission, " : ""}barcode and receipt number come in from BC.</>}
        </p>
      )}
      {checkNeedsBc && !lookNeedsBc && (
        <p className={`text-xs ${muted} -mt-2 mb-3`}>
          These lots haven&apos;t been checked against BC —{" "}
          <a href={bcConnectHref(`${REFUNDS_PATH}/${r.id}`)} target="_blank" rel="noopener noreferrer" className={inlineLink}>sign in to BC ↗</a>{" "}
          (a new tab), then <button type="button" onClick={retryLookups} className={inlineLink}>check again</button>.
        </p>
      )}

      {/* What BC offers — nothing is used until "Use these". */}
      {bc.kind === "error" && (
        <p role="alert" className="mb-3 rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200">
          {bc.text}
          {bc.connect && <> <a href={bcConnectHref(`${REFUNDS_PATH}/${r.id}`)} target="_blank" rel="noopener noreferrer" className={inlineLink}>Sign in to BC ↗</a> (a new tab — then press Fill from BC again)</>}
        </p>
      )}
      {bc.kind === "done" && <BcProposals found={bc.found} pick={bc.pick} onPick={pick => setBc({ ...bc, pick })} onUse={applyBc} onCancel={() => setBc({ kind: "idle" })} />}

      {rows.length === 0 ? (
        <p className={`text-sm ${muted}`}>No lots yet — add a lot and type its sale and number{bcWhyNot ? "" : ", or fill them from BC"}.</p>
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
                      {/* The row's own lookup for what it says now — else what the check of the saved lots found. */}
                      <BcLine x={x} name={n} look={looks[x.key]?.sig === lotSig(x) ? looks[x.key] : checks[x.key]} buyer={buyer} closed={closed} onUse={(box, p) => takeFromBc(x.key, box, p)} />

                    </div>
                    <Cell name="Hammer £">
                      <input value={x.hammer} onChange={e => change(x.key, { hammer: e.target.value })} inputMode="decimal" placeholder="0.00" aria-label={`Hammer in pounds, ${n}`} aria-invalid={moneyIn(x.hammer) === undefined} className={`${field} w-full tabular-nums ${moneyIn(x.hammer) === undefined ? "border-red-500 dark:border-red-500" : ""}`} />
                    </Cell>
                    <Cell name="Commission £">
                      <input value={x.commission} onChange={e => change(x.key, { commission: e.target.value })} inputMode="decimal" placeholder={`auto ${autoCommission}`} aria-label={`Commission in pounds (blank is 27% of the hammer; BC's lookup fills in what it charged), ${n}`} aria-invalid={moneyIn(x.commission) === undefined} className={`${field} w-full tabular-nums ${moneyIn(x.commission) === undefined ? "border-red-500 dark:border-red-500" : ""}`} />
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
              {logDiffers && (
                <p role="note" className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                  ⚠ The old log&apos;s total was {formatPence(logTotal)} — its lots work out at {formatPence(total.worked)} here. Check which is right
                  {savedDiffers ? <> (the list {r.totalPence == null ? "says Not worked out" : `still shows ${formatPence(r.totalPence)}`} — pressing Save makes it {formatPence(total.totalPence)})</> : null}.
                </p>
              )}
              {!logDiffers && savedDiffers && (
                <p role="note" className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                  ⚠ {r.totalPence == null ? <>No total is saved (the list says Not worked out)</> : <>The saved total is {formatPence(r.totalPence)} (what the list shows)</>} — the
                  lots work out at {formatPence(total.totalPence)}. Pressing Save makes it that.
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
        <button type="button" onClick={save} disabled={saving || (!dirty && !savedDiffers) || lookingUp} className={btnGo}>
          {saving ? "Saving…" : lookingUp ? <><Spinner /> Looking lots up in BC…</> : "Save lots & money"}
        </button>
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

/** Under a lot's description: what came from BC (its barcode for the sale, receipt and unique ID), the
 *  lookup while it runs, anything BC said about the lot, and BC's hammer and commission when the row
 *  has other ones (or none) — with "Use BC's" (a commission only on an open request). */
function BcLine({ x, name, look, buyer, closed, onUse }: {
  x: Row; name: string; look: Look | undefined; buyer: boolean; closed: boolean; onUse: (box: "hammer" | "commission", pence: number) => void
}) {
  const mine = look && look.sig === lotSig(x) ? look : undefined
  const f = mine?.bc ?? null
  const hammer = moneyIn(x.hammer), commission = moneyIn(x.commission)
  const otherHammer = f?.hammerPence != null && hammer !== f.hammerPence ? f.hammerPence : null
  // The commission as the money is worked out (blank → 27% of the hammer) against what BC charged — only
  // beside BC's own hammer (with another hammer, BC's commission is for a different sum).
  const ours = hammer === undefined || commission === undefined ? null : commissionUsed({ hammerPence: hammer, commissionPence: commission })
  const otherCommission = buyer && otherHammer == null && f?.commissionPence != null && commissionDiffers(ours, f.commissionPence) ? f.commissionPence : null
  const bits: ReactNode[] = []
  if (isFromBc(x)) bits.push("From BC")
  if (bcCommissionIn(x) && f?.commissionWords) bits.push(<>commission: {f.commissionWords}</>)
  if (x.barcode) bits.push(<>Barcode <span className="font-mono text-gray-700 dark:text-gray-200">{x.barcode}</span></>)
  if (x.receiptNo) bits.push(<>Receipt <span className="font-mono text-gray-700 dark:text-gray-200">{x.receiptNo}</span></>)
  if (x.uniqueId) bits.push(<span className="font-mono">{x.uniqueId}</span>)
  if (f?.returned) bits.push("BC has it on the returns account (refunded or returned)")
  return (
    // Said as it changes — BC filling boxes in, or saying something about the lot.
    <div aria-live="polite">
      {mine?.state === "loading" && <p className={`text-xs ${muted} mt-1 inline-flex items-center gap-1.5`}><Spinner /> Looking it up in BC…</p>}
      {bits.length > 0 && (
        <p className={`text-xs ${muted} mt-1 break-words`}>
          {bits.map((b, i) => <span key={i}>{i > 0 && " · "}{b}</span>)}
        </p>
      )}
      {mine?.note && (
        <p className={`text-xs mt-1 ${mine.state === "error" ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300"}`}>{mine.note}</p>
      )}
      {otherHammer != null && (
        <p className="text-xs mt-1 text-amber-700 dark:text-amber-300">
          ⚠ BC&apos;s hammer is {formatPence(otherHammer)} — this row {hammer == null ? "has none" : hammer === undefined ? "has one that isn't a sum of money" : `says ${formatPence(hammer)}`}.{" "}
          <button type="button" onClick={() => onUse("hammer", otherHammer)} aria-label={`Use BC's hammer, ${formatPence(otherHammer)}, for ${name}`} className={inlineLink}>Use BC&apos;s</button>
        </p>
      )}
      {otherCommission != null && (
        <p className="text-xs mt-1 text-amber-700 dark:text-amber-300">
          ⚠ BC charged {formatPence(otherCommission)} commission{f?.commissionWords ? ` (${f.commissionWords})` : ""} — this row
          {commission == null ? ` works it out at 27%, ${formatPence(ours)}` : ` says ${formatPence(commission)}`}.{" "}
          {closed
            ? <>The request is closed, so it&apos;s left as it was.</>
            : <button type="button" onClick={() => onUse("commission", otherCommission)} aria-label={`Use BC's commission, ${formatPence(otherCommission)}, for ${name}`} className={inlineLink}>Use BC&apos;s</button>}
        </p>
      )}
    </div>
  )
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
                    {l.commissionWords && <span className={`sm:col-span-3 text-xs ${muted}`}>Commission: {l.commissionWords}</span>}
                    {(l.barcode || l.receiptNo) && (
                      <span className={`sm:col-span-3 text-xs ${muted}`}>
                        {l.barcode && <>Barcode <span className="font-mono">{l.barcode}</span></>}
                        {l.barcode && l.receiptNo && " · "}
                        {l.receiptNo && <>Receipt <span className="font-mono">{l.receiptNo}</span></>}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className={`text-xs ${muted} mt-2`}>Using them fills in each lot&apos;s sale, hammer, BC&apos;s commission, description, barcode, receipt and unique ID — a lot already on the list keeps its % or amount (and a commission typed in). Nothing is saved until you press Save.</p>
        </>
      )}
      <div className="flex flex-wrap gap-2 mt-3">
        {found.lots.length > 0 && <button type="button" onClick={onUse} disabled={!ticked} className={btnGo}>Use {ticked === found.lots.length ? "these" : `these ${ticked}`}</button>}
        <button type="button" onClick={onCancel} className={btn}>{found.lots.length ? "Cancel" : "Close"}</button>
      </div>
    </div>
  )
}
