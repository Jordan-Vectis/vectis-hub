// Accounts → Paid, not collected — the BC check's PURE matching rules (no BC, no database).
//
// lib/uncollected-feed.ts reads Business Central and writes the cases; everything that decides
// WHICH lots belong to WHICH paid invoice, and what a case's timeline says, lives here so it can be
// checked with made-up data (npx tsx) without BC or a database. Re-exported from the feed.
//
// ⚠ A PLAIN module: imports only lib/uncollected.ts (itself plain). Never Prisma, auth or lib/bc.
//
// The rule (Jack, 2026-10-22: "only paid things that haven't been collected for over 4 weeks"):
// a lot was SOLD (hammer > 0, not withdrawn), its buyer's invoice covering it is PAID with nothing
// remaining, the lot is NOT COLLECTED, and at least UNCOLLECTED_AFTER_DAYS London days have passed
// since the paid day. One case per invoice.
//
// How a lot is tied to an invoice. BC's buyer invoice has a line per lot (the lot's description)
// followed by "Buyer Premium for Lot No 366", so an invoice's lots are the lot numbers in those
// premium lines. Lot numbers repeat from sale to sale, so a dealer with lot 366 uncollected in
// F066 and lot 366 collected in F067 would otherwise see F066's lot hung on F067's invoice as well.
// So each uncollected lot has ONE home: the buyer's EARLIEST invoice dated on or after the lot's
// sale that lists its number (assignHomes). A paid invoice's lots are the lots whose home it is.

import {
  BC_OWNED_FIELDS, addDays, daysBetween, formatDay, formatMoney, isDay, londonDay, looksLikeBankDetails,
  UNCOLLECTED_LIMITS, type UncollectedField,
} from "@/lib/uncollected"

// ─── Shapes ─────────────────────────────────────────────────────────────────────────────────

/** One sold, uncollected lot from BC's Auction_Lines_Excel, tidied. */
export type FeedLot = {
  uniqueId: string | null
  /** As shown: "366" or "366A". */
  lotNo: string
  /** The number part, leading zeros dropped ("366"); "" when BC has none. */
  lotNum: string
  /** The suffix, upper case ("A"), or "". */
  lotSuffix: string
  description: string | null
  hammer: number
  saleCode: string
  saleName: string | null
  /** YYYY-MM-DD. */
  saleDate: string
  /** Upper case, trimmed. */
  buyerNo: string
  buyerName: string | null
}

/** One BC sales invoice (standard API v2.0 salesInvoices), tidied. */
export type FeedInvoice = {
  id: string
  number: string
  /** YYYY-MM-DD. */
  invoiceDate: string
  /** Upper case, trimmed (= the lot's EVA_BuyerNo). */
  customerNumber: string
  customerName: string | null
  email: string | null
  phone: string | null
  total: number | null
  remaining: number | null
  /** As BC gives it: "Open", "Paid", "Draft", "Canceled"… */
  status: string
  /** ISO — when BC last changed the invoice (the paid-date proxy). */
  lastModified: string | null
}

/** A lot number read off an invoice line. */
export type LotRef = { num: string; suffix: string }

/** What an invoice's lines say about its lots. */
export type InvoiceLines = {
  /** Every "Buyer Premium for Lot No N" on it (a lot may appear more than once). */
  refs: LotRef[]
  /** true = it has at least one lot line (account 01011) — a lot invoice, not postage or storage. */
  hasLotLines: boolean
}

/** One case-to-be: a paid invoice with at least one lot still not collected. */
export type Candidate = {
  invoiceNo: string
  invoiceId: string
  buyerNo: string
  buyerName: string
  email: string | null
  phone: string | null
  /** The sale code, or several joined with ", " when one invoice covers more than one sale. */
  saleCode: string
  saleName: string | null
  /** The latest sale day of its lots, YYYY-MM-DD. */
  saleDate: string
  lots: { uniqueId: string | null; lotNo: string; description: string | null; hammer: number; saleCode: string; saleDate: string }[]
  /** The invoice's total including VAT. */
  amountPaid: number | null
  /** The London day BC settled the invoice (YYYY-MM-DD) — they paid on or before it. */
  paidOn: string
  /** London days from paidOn to the day of the check. */
  daysSincePaid: number
  /** Set when the invoice's lines carried no lot numbers and its lots were taken from the buyer's
   *  latest sale on or before the invoice date instead (the run's notes say so). */
  fallbackSale: string | null
}

// ─── Reading BC's values ────────────────────────────────────────────────────────────────────

const str = (v: unknown): string => (v == null ? "" : String(v)).trim()
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,£\s]/g, ""))
  return Number.isFinite(n) ? n : null
}
/** BC booleans arrive as true/false, and occasionally as "Yes"/"true"/1. */
export const bcTrue = (v: unknown): boolean => v === true || v === 1 || /^(true|yes|1)$/i.test(str(v))

/** YYYY-MM-DD from a BC date or date-time ("2026-06-07", "2026-06-07T00:00:00Z"); "" if unreadable
 *  or BC's blank date (0001-01-01). */
export function bcDay(v: unknown): string {
  const s = str(v).slice(0, 10)
  return isDay(s) ? s : ""
}

/** "0366" → "366"; "" for none or "0". */
function lotNumber(v: unknown): string {
  const s = str(v)
  if (!s) return ""
  if (/^\d+$/.test(s)) { const n = String(Number(s)); return n === "0" ? "" : n }
  return s.toUpperCase()
}

/** "366" + "a" → "366A". */
export function lotNoOf(lotNo: unknown, suffix: unknown): string {
  return `${lotNumber(lotNo)}${str(suffix).toUpperCase()}`
}

/** A row of Auction_Lines_Excel as a FeedLot — or null when it isn't a sold, uncollected,
 *  not-withdrawn lot with a buyer (the caller counts those). */
export function toFeedLot(r: Record<string, unknown>): FeedLot | null {
  const hammer = num(r.EVA_HammerPrice) ?? 0
  if (!(hammer > 0) || bcTrue(r.EVA_Collected) || bcTrue(r.EVA_WithdrawLot)) return null
  const saleDate = bcDay(r.EVA_AuctionDate)
  const saleCode = str(r.EVA_AuctionNo).toUpperCase()
  const buyerNo = str(r.EVA_BuyerNo).toUpperCase()
  if (!saleDate || !saleCode || !buyerNo) return null
  const lotNum = lotNumber(r.EVA_LotNo)
  const lotSuffix = str(r.EVA_LotSuffix).toUpperCase()
  const desc = str(r.EVA_ShortDescription).replace(/\s+/g, " ")
  return {
    uniqueId: str(r.EVA_UniqueID) || null,
    lotNo: `${lotNum}${lotSuffix}` || "?",
    lotNum,
    lotSuffix,
    description: desc || null,
    hammer: Math.round(hammer * 100) / 100,
    saleCode,
    saleName: str(r.EVA_AuctionName) || null,
    saleDate,
    buyerNo,
    buyerName: str(r.EVA_BuyerSearchName) || null,
  }
}

/** A salesInvoices row as a FeedInvoice — or null without an id, number, date or customer. */
export function toFeedInvoice(r: Record<string, unknown>): FeedInvoice | null {
  const id = str(r.id)
  const number = str(r.number)
  const invoiceDate = bcDay(r.invoiceDate) || bcDay(r.postingDate)
  const customerNumber = str(r.customerNumber).toUpperCase()
  if (!id || !number || !invoiceDate || !customerNumber) return null
  const lm = str(r.lastModifiedDateTime)
  return {
    id, number, invoiceDate, customerNumber,
    customerName: str(r.customerName) || null,
    email: str(r.email) || null,
    phone: str(r.phoneNumber) || null,
    total: num(r.totalAmountIncludingTax),
    remaining: num(r.remainingAmount),
    status: str(r.status),
    lastModified: lm && !Number.isNaN(Date.parse(lm)) ? lm : null,
  }
}

// ─── Invoice lines → lot numbers ────────────────────────────────────────────────────────────

/** "Buyer Premium for Lot No 366" → { num: "366", suffix: "" }; "… Lot No. 366A" → suffix "A".
 *  Only a PREMIUM line counts — a lot's own description can contain "lot no" ("Job lot no 3 …").
 *  A suffix is one letter written against the number; "366 at 25%" is lot 366, never "366AT".
 *  ⚠ A number may come grouped in thousands ("Lot No 1,234" — AL's Format() of an integer does
 *  that), so a grouped number is read whole: lot 1234, never lot 1. */
export function lotRefFromText(text: unknown): LotRef | null {
  const s = str(text)
  if (!/premium/i.test(s)) return null
  const m = s.match(/\blot\s*no\.?\s*:?\s*(\d{1,3}(?:[,.]\d{3})+|\d+)([a-z])?\b/i)
  if (!m) return null
  const n = String(Number(m[1].replace(/[,.]/g, "")))
  return n === "0" ? null : { num: n, suffix: (m[2] ?? "").toUpperCase() }
}

/** The lot numbers on one invoice's lines (salesInvoiceLines rows, any order). */
export function lotRefsFromLines(lines: Record<string, unknown>[]): InvoiceLines {
  const sorted = [...lines].sort((a, b) => (num(a.sequence) ?? 0) - (num(b.sequence) ?? 0))
  const refs: LotRef[] = []
  let hasLotLines = false
  for (const l of sorted) {
    const ref = lotRefFromText(l.description) ?? lotRefFromText(`${str(l.description)} ${str(l.description2)}`)
    if (ref) { refs.push(ref); continue }
    if (str(l.lineObjectNumber) === "01011") hasLotLines = true
  }
  return { refs, hasLotLines: hasLotLines || refs.length > 0 }
}

/** Suffix tolerant: the numbers must agree; the suffixes too, unless one side has none. */
export function refMatchesLot(ref: LotRef, lot: Pick<FeedLot, "lotNum" | "lotSuffix">): boolean {
  if (!lot.lotNum || ref.num !== lot.lotNum) return false
  return !ref.suffix || !lot.lotSuffix || ref.suffix === lot.lotSuffix
}

/** Exactly the same lot: number AND suffix (both may be none). */
export function refIsExactly(ref: LotRef, lot: Pick<FeedLot, "lotNum" | "lotSuffix">): boolean {
  return !!lot.lotNum && ref.num === lot.lotNum && ref.suffix === lot.lotSuffix
}

// ─── Paid, and how long ago ─────────────────────────────────────────────────────────────────

/** Paid with nothing remaining (to the penny). */
export function isPaidInFull(inv: Pick<FeedInvoice, "status" | "remaining">): boolean {
  return /^paid$/i.test(inv.status) && inv.remaining != null && Math.abs(inv.remaining) < 0.005
}

/** The London day BC last changed the invoice — on a paid one, the day it was settled. BC publishes
 *  no payment date (Customer Ledger Entries isn't published), so this is the proxy: they paid ON
 *  OR BEFORE it ("Paid by"). null when BC gave no time. */
export function paidDayOf(inv: Pick<FeedInvoice, "lastModified">): string | null {
  return inv.lastModified ? londonDay(inv.lastModified) : null
}

/** An invoice that can be a lot's home: a posted one. Drafts and invoices still in review aren't
 *  posted, and a cancelled one has been replaced — a lot must not be tied to either. */
export function countsAsHome(inv: Pick<FeedInvoice, "status">): boolean {
  return !/^(draft|in review|canceled|cancelled)$/i.test(inv.status.trim())
}

/** Paid in full, at least `afterDays` London days ago (counted to `today`). */
export function qualifies(inv: FeedInvoice, today: string, afterDays: number): boolean {
  if (!countsAsHome(inv) || !isPaidInFull(inv)) return false
  const paid = paidDayOf(inv)
  return !!paid && daysBetween(paid, today) >= afterDays
}

const byDateThenNumber = (a: FeedInvoice, b: FeedInvoice) =>
  a.invoiceDate < b.invoiceDate ? -1 : a.invoiceDate > b.invoiceDate ? 1 : a.number.localeCompare(b.number, "en", { numeric: true })

/**
 * Each lot's home invoice: the EARLIEST of the buyer's posted invoices dated on or after the lot's
 * sale whose lines list exactly its number and suffix — and only when none does, the earliest that
 * lists it suffix tolerantly (a premium line that leaves the suffix off). Exact first, so lot 366A
 * is never hung on an earlier paid invoice listing plain 366, a different (collected) lot, when its
 * own invoice lists 366A. Invoices whose lines weren't read are passed over — the caller reads the
 * lines of every invoice up to the latest one that could qualify, so none of those is ever skipped.
 * Answers lot index → invoice id; a lot with no home is left out.
 */
export function assignHomes(lots: FeedLot[], invoices: FeedInvoice[], lines: Map<string, InvoiceLines>): Map<number, string> {
  const ordered = invoices.filter(countsAsHome).sort(byDateThenNumber)
  const homes = new Map<number, string>()
  const earliest = (lot: FeedLot, matches: (r: LotRef) => boolean): string | null => {
    for (const inv of ordered) {
      if (inv.invoiceDate < lot.saleDate) continue
      const l = lines.get(inv.id)
      if (l && l.refs.some(matches)) return inv.id
    }
    return null
  }
  lots.forEach((lot, i) => {
    if (!lot.lotNum) return
    const home = earliest(lot, (r) => refIsExactly(r, lot)) ?? earliest(lot, (r) => refMatchesLot(r, lot))
    if (home) homes.set(i, home)
  })
  return homes
}

/** The invoices whose lines must be read for one buyer: every posted one dated on or before the
 *  latest invoice that could qualify (a lot's home is the earliest that lists it, so any earlier
 *  invoice might be it). None when nothing could qualify. */
export function invoicesNeedingLines(invoices: FeedInvoice[], today: string, afterDays: number): FeedInvoice[] {
  const q = invoices.filter((i) => qualifies(i, today, afterDays))
  if (!q.length) return []
  const last = q.reduce((d, i) => (i.invoiceDate > d ? i.invoiceDate : d), "")
  return invoices.filter((i) => countsAsHome(i) && i.invoiceDate <= last)
}

export type BuyerMatch = {
  candidates: Candidate[]
  /** Invoices whose lots came from the fallback (no lot numbers on their lines). */
  fallback: { invoiceNo: string; saleCode: string }[]
  /** Paid, old enough, but no lots on them at all (postage, storage…) — skipped. */
  notLotInvoices: number
  /** Paid, old enough, a lot invoice, but none of its lots is still uncollected here. */
  allCollected: number
}

/**
 * One buyer: their uncollected lots, their invoices (dated on or after their earliest lot's sale),
 * and the lines of every invoice invoicesNeedingLines() named. Answers one candidate per paid
 * invoice old enough with at least one uncollected lot.
 *
 * A paid invoice with no readable lot numbers but with lot lines falls back to the buyer's
 * uncollected lots from the latest sale on or before its date — only lots with no other home,
 * each used once.
 */
export function matchBuyer(
  lots: FeedLot[],
  invoices: FeedInvoice[],
  lines: Map<string, InvoiceLines>,
  opts: { today: string; afterDays: number },
): BuyerMatch {
  const out: BuyerMatch = { candidates: [], fallback: [], notLotInvoices: 0, allCollected: 0 }
  const homes = assignHomes(lots, invoices, lines)
  const homed = new Set(homes.keys())
  const usedByFallback = new Set<number>()

  for (const inv of invoices.filter((i) => qualifies(i, opts.today, opts.afterDays)).sort(byDateThenNumber)) {
    const l = lines.get(inv.id)
    if (!l) continue   // the caller marks the buyer unchecked rather than guessing
    let mine: number[] = []
    let fallbackSale: string | null = null
    if (l.refs.length) {
      mine = lots.map((_, i) => i).filter((i) => homes.get(i) === inv.id)
    } else if (l.hasLotLines) {
      const free = lots.map((_, i) => i).filter((i) => !homed.has(i) && !usedByFallback.has(i) && lots[i].saleDate <= inv.invoiceDate)
      const latest = free.reduce((d, i) => (lots[i].saleDate > d ? lots[i].saleDate : d), "")
      if (latest) {
        const sale = free.find((i) => lots[i].saleDate === latest)!
        mine = free.filter((i) => lots[i].saleDate === latest && lots[i].saleCode === lots[sale].saleCode)
        fallbackSale = lots[sale].saleCode
        mine.forEach((i) => usedByFallback.add(i))
      }
    } else {
      out.notLotInvoices++
      continue
    }
    if (!mine.length) { out.allCollected++; continue }
    if (fallbackSale) out.fallback.push({ invoiceNo: inv.number, saleCode: fallbackSale })
    out.candidates.push(toCandidate(inv, mine.map((i) => lots[i]), opts.today, fallbackSale))
  }
  return out
}

function toCandidate(inv: FeedInvoice, lots: FeedLot[], today: string, fallbackSale: string | null): Candidate {
  const sorted = [...lots].sort((a, b) =>
    a.saleDate < b.saleDate ? -1 : a.saleDate > b.saleDate ? 1
      : a.saleCode.localeCompare(b.saleCode) || a.lotNo.localeCompare(b.lotNo, "en", { numeric: true }))
  const sales: string[] = []
  for (const l of sorted) if (!sales.includes(l.saleCode)) sales.push(l.saleCode)
  const last = sorted[sorted.length - 1]
  const paidOn = paidDayOf(inv)!
  return {
    invoiceNo: inv.number,
    invoiceId: inv.id,
    buyerNo: inv.customerNumber,
    buyerName: inv.customerName || last.buyerName || inv.customerNumber,
    email: inv.email,
    phone: inv.phone,
    saleCode: joinSales(sales),
    saleName: last.saleName,
    saleDate: last.saleDate,
    lots: sorted.map((l) => ({ uniqueId: l.uniqueId, lotNo: l.lotNo, description: l.description, hammer: l.hammer, saleCode: l.saleCode, saleDate: l.saleDate })),
    amountPaid: inv.total == null ? null : Math.round(inv.total * 100) / 100,
    paidOn,
    daysSincePaid: daysBetween(paidOn, today),
    fallbackSale,
  }
}

/**
 * Sale codes joined for the case's one "sale" box (40 characters at most): "F067" or "F067, F068".
 * ⚠ When they don't all fit, as many as fit are kept and the box SAYS how many were left off —
 * "F061, F062, F063, F064, F065, +3 more" — so nothing reads a short list as the whole of it
 * (salesLeftOff; the check never closes such a case by itself, and the case page says so).
 */
export function joinSales(codes: string[]): string {
  const max = UNCOLLECTED_LIMITS.saleCode
  const all = codes.join(", ")
  if (all.length <= max) return all
  for (let k = codes.length - 1; k >= 1; k--) {
    const s = `${codes.slice(0, k).join(", ")}, +${codes.length - k} more`
    if (s.length <= max) return s
  }
  return (codes[0] ?? "").slice(0, max)
}

/** A sale code as BC writes them (F067, B007, D062-2) — what salesOf keeps. */
const SALE_CODE_RE = /^[A-Z0-9][A-Z0-9\-_/.]{0,39}$/

/** The sale codes a case's "sale" box holds ("F067" or "F067, F068"), upper case. Split on commas
 *  (or semicolons) only; anything that isn't a single sale code — "+3 more", or words typed by hand
 *  ("F067 day 2") — is left out. */
export function salesOf(saleCode: string | null | undefined): string[] {
  return (saleCode ?? "").split(/[,;]/).map((s) => s.trim().toUpperCase()).filter((s) => SALE_CODE_RE.test(s))
}

/** How many sales joinSales had to leave off a case's "sale" box (its "+N more"); 0 when none. */
export function salesLeftOff(saleCode: string | null | undefined): number {
  const m = /\+\s*(\d+)\s*more\s*$/i.exec(saleCode ?? "")
  return m ? Number(m[1]) : 0
}

// ─── A case that dropped out: are its lots collected? ───────────────────────────────────────

/**
 * For an open case from BC whose invoice is still paid but which the check no longer found: the
 * buyer's lots in its sale(s) as BC has them NOW (collected or not). Only a POSITIVE answer closes
 * a case — "collected" when every lot on the invoice that BC still shows as sold to them is
 * collected; "waiting" when one isn't; "unknown" when none of them can be found (re-sold, renumbered…).
 * refs empty = the invoice had no readable lot numbers: every sold lot of theirs in the sale counts.
 */
export function droppedVerdict(refs: LotRef[], rows: Record<string, unknown>[], buyerNo: string): "collected" | "waiting" | "unknown" {
  const buyer = buyerNo.trim().toUpperCase()
  const mine = rows.filter((r) => {
    if (str(r.EVA_BuyerNo).toUpperCase() !== buyer) return false
    if (!((num(r.EVA_HammerPrice) ?? 0) > 0) || bcTrue(r.EVA_WithdrawLot)) return false
    if (!refs.length) return true
    const lot = { lotNum: lotNumber(r.EVA_LotNo), lotSuffix: str(r.EVA_LotSuffix).toUpperCase() }
    return refs.some((ref) => refMatchesLot(ref, lot))
  })
  if (!mine.length) return "unknown"
  return mine.every((r) => bcTrue(r.EVA_Collected)) ? "collected" : "waiting"
}

// ─── What the case says ─────────────────────────────────────────────────────────────────────

/** The fields of a case the feed compares (a Prisma row has all of these). */
export type CaseLike = {
  buyerName: string
  buyerNo: string | null
  email: string | null
  phone: string | null
  saleCode: string | null
  invoiceNo: string | null
  lots: number | null
  amountPaid: number | null
  paidAt: Date | null
}

/** BC's contact details, tidied the way the Hub's own boxes would take them — or null. Never bank
 *  or card details (the Hub's guard), never more than the box holds. */
export function cleanEmail(v: string | null | undefined): string | null {
  const s = str(v)
  if (!s || s.length > UNCOLLECTED_LIMITS.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) || looksLikeBankDetails(s)) return null
  return s
}
export function cleanPhone(v: string | null | undefined): string | null {
  const s = str(v).replace(/\s+/g, " ")
  if (!s || s.length > UNCOLLECTED_LIMITS.phone || !/^[0-9+()\-./ ]+$/.test(s)) return null
  const digits = (s.match(/\d/g) ?? []).length
  return digits >= 5 && digits <= 15 ? s : null
}
/** BC's name for the buyer, kept to the box's length; their buyer number when BC gives none. */
export function cleanName(v: string | null | undefined, buyerNo: string): string {
  const s = str(v).replace(/\s+/g, " ").slice(0, UNCOLLECTED_LIMITS.buyerName)
  return s && !looksLikeBankDetails(s) ? s : buyerNo
}

/** The values the feed owns, for a candidate (dates as YYYY-MM-DD; lots = how many are still waiting). */
export function ownedValues(c: Candidate) {
  return {
    buyerName: cleanName(c.buyerName, c.buyerNo),
    buyerNo: c.buyerNo.slice(0, UNCOLLECTED_LIMITS.buyerNo),
    saleCode: c.saleCode.slice(0, UNCOLLECTED_LIMITS.saleCode) || null,
    invoiceNo: c.invoiceNo.slice(0, UNCOLLECTED_LIMITS.invoiceNo),
    lots: c.lots.length,
    amountPaid: c.amountPaid != null && c.amountPaid >= 0 && c.amountPaid <= UNCOLLECTED_LIMITS.amountPaid ? c.amountPaid : null,
    paidOn: c.paidOn,
  }
}

export type FeedChange = {
  /** Field → new value, ready for the database (paidAt as the YYYY-MM-DD day — the caller stores it). */
  set: Partial<Record<UncollectedField, string | number | null>>
  /** How each change reads on the timeline. Amounts, counts and dates say old → new; names and
   *  contact details only say what changed (the timeline never keeps an old contact detail). */
  phrases: string[]
  /** The number of lots still waiting changed (the event lists them again). */
  lotsChanged: boolean
}

const sameDay = (a: Date | null, b: string | null) => (a ? londonDay(a) : null) === b

/**
 * What the feed would change on a case: the fields BC owns (BC_OWNED_FIELDS) where BC now says
 * something different, plus the email and phone ONLY where the case has none. Nothing else — a
 * case's status, notes, chase date, storage date and timeline are the staff's.
 * Empty `set` = nothing to write (the check is idempotent: a second run changes nothing).
 */
export function feedChanges(current: CaseLike, c: Candidate): FeedChange {
  const v = ownedValues(c)
  const set: FeedChange["set"] = {}
  const phrases: string[] = []
  const owned = new Set<UncollectedField>(BC_OWNED_FIELDS)

  if (owned.has("buyerName") && current.buyerName !== v.buyerName) { set.buyerName = v.buyerName; phrases.push("buyer's name") }
  if (owned.has("buyerNo") && (current.buyerNo ?? "").toUpperCase() !== v.buyerNo.toUpperCase()) { set.buyerNo = v.buyerNo; phrases.push(`buyer number to ${v.buyerNo}`) }
  if (owned.has("saleCode") && (current.saleCode ?? null) !== v.saleCode) { set.saleCode = v.saleCode; phrases.push(v.saleCode ? `sale to ${v.saleCode}` : "sale cleared") }
  if (owned.has("invoiceNo") && (current.invoiceNo ?? null) !== v.invoiceNo) { set.invoiceNo = v.invoiceNo; phrases.push(`invoice to ${v.invoiceNo}`) }
  const lotsChanged = owned.has("lots") && current.lots !== v.lots
  if (lotsChanged) {
    set.lots = v.lots
    phrases.push(current.lots == null ? `lots not collected: ${v.lots}` : `lots not collected ${current.lots} → ${v.lots}`)
  }
  if (owned.has("amountPaid") && (current.amountPaid == null ? null : Math.round(current.amountPaid * 100) / 100) !== v.amountPaid) {
    set.amountPaid = v.amountPaid
    phrases.push(`amount paid ${formatMoney(current.amountPaid)} → ${formatMoney(v.amountPaid)}`)
  }
  if (owned.has("paidAt") && !sameDay(current.paidAt, v.paidOn)) {
    set.paidAt = v.paidOn
    phrases.push(`paid by ${current.paidAt ? formatDay(current.paidAt) : "—"} → ${formatDay(`${v.paidOn}T12:00:00Z`)}`)
  }
  const email = cleanEmail(c.email)
  if (!current.email && email) { set.email = email; phrases.push("email added from BC") }
  const phone = cleanPhone(c.phone)
  if (!current.phone && phone) { set.phone = phone; phrases.push("phone added from BC") }
  return { set, phrases, lotsChanged }
}

const plural = (n: number, one: string, more = `${one}s`) => `${n} ${n === 1 ? one : more}`
const dayWords = (day: string) => formatDay(`${day}T12:00:00Z`)

/** The lot list a case's timeline carries (staff notes stay the staff's): one line per lot — sale,
 *  lot number, description, hammer. At most 40 lines, then "…and N more". */
export function lotListText(lots: Candidate["lots"]): string {
  const shown = lots.slice(0, 40).map((l) => {
    let d = (l.description ?? "").replace(/\s+/g, " ").trim()
    if (d && looksLikeBankDetails(d)) d = "(description left out)"
    if (d.length > 90) d = `${d.slice(0, 89)}…`
    return `• ${l.saleCode} lot ${l.lotNo}${d ? ` — ${d}` : ""} — hammer ${formatMoney(l.hammer)}`
  })
  if (lots.length > 40) shown.push(`…and ${lots.length - 40} more`)
  return shown.join("\n")
}

/** "paid by 3 Jun 2026, 2 lots not collected after 49 days" */
export function dueWords(c: Candidate): string {
  return `paid by ${dayWords(c.paidOn)}, ${plural(c.lots.length, "lot")} not collected after ${c.daysSincePaid} days`
}

/** The "created" event of a case the check adds. */
export function addedText(c: Candidate): string {
  const fb = c.fallbackSale ? `\n(Invoice ${c.invoiceNo} lists no lot numbers, so these are their uncollected lots from ${c.fallbackSale}.)` : ""
  return `Added from BC: ${dueWords(c)}. Invoice ${c.invoiceNo}.\n${lotListText(c.lots)}${fb}`
}

/** The event when the check takes over a case added by hand. */
export function matchedText(c: Candidate, changes: string[]): string {
  const ch = changes.length ? ` Taken from BC: ${changes.join(", ")}.` : ""
  return `Matched to BC invoice ${c.invoiceNo}: ${dueWords(c)}. From now on BC keeps its name, buyer number, sale, invoice, lots, amount paid and paid date.${ch}\n${lotListText(c.lots)}`
}

/** The event when BC changed something on a case it already holds. */
export function updatedText(c: Candidate, ch: FeedChange, paidAgain: boolean): string {
  const parts = [...(paidAgain ? [`BC shows invoice ${c.invoiceNo} as paid again`] : []), ...ch.phrases]
  const head = `BC update: ${parts.join("; ")}.`
  return ch.lotsChanged ? `${head}\nStill not collected:\n${lotListText(c.lots)}` : head
}

/** Said once when a case's invoice stops reading as paid (the case stays open). */
export const noLongerPaidText = (invoiceNo: string) => `BC no longer shows invoice ${invoiceNo} as paid — check it.`
export const isNoLongerPaidText = (t: string | null | undefined) => !!t && t.startsWith("BC no longer shows invoice")

/** The window of sales the check reads: [today − lookbackMonths, today − afterDays]. A lot paid at
 *  least afterDays ago was sold at least afterDays ago, so later sales can't have a due case yet. */
export function saleWindow(today: string, afterDays: number, lookbackMonths: number): { from: string; to: string } {
  const [y, m, d] = today.split("-").map(Number)
  const back = new Date(Date.UTC(y, m - 1 - lookbackMonths, 1))
  const lastDay = new Date(Date.UTC(back.getUTCFullYear(), back.getUTCMonth() + 1, 0)).getUTCDate()
  const from = `${back.getUTCFullYear()}-${String(back.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`
  return { from, to: addDays(today, -afterDays) }
}

// ─── Turning round from run to run ──────────────────────────────────────────────────────────
// A run can stop short (time, a Stop, BC's limits), and the next one must not stop at the same
// place. Both turn on the run's sequence number (how many UncollectedSyncRun rows there are), which
// lives in the database, so a restart or a deploy doesn't send them back to the start.

/** The list turned round to start at a point that moves from run to run: `seq` times the golden
 *  ratio, so successive runs start well apart and runs that keep running out of time still reach
 *  every item in turn. No seq (0) = as given. */
export function rotate<T>(items: T[], seq: number | undefined): T[] {
  if (!seq || items.length < 2) return items
  const at = Math.floor(((seq * 0.6180339887498949) % 1) * items.length) % items.length
  return [...items.slice(at), ...items.slice(0, at)]
}

/** `take` items starting at window `seq` (wrapping round): with the same list and take, runs
 *  1, 2, 3 … tile the whole list, so every item is reached within ceil(length / take) runs. */
export function windowAt<T>(items: T[], seq: number, take: number): T[] {
  if (take <= 0) return []
  if (take >= items.length) return [...items]
  const start = (Math.max(0, Math.floor(seq)) * take) % items.length
  return Array.from({ length: take }, (_, i) => items[(start + i) % items.length])
}

/**
 * Which open cases from BC that this run didn't find are re-checked against BC — at most `limit`
 * (each takes a few BC calls). Cases whose buyer has NO uncollected lot left in the window come first
 * (the likely collected ones) and get at least half the places; the others share the rest; each group
 * turns round by `seq`, so every case is reached in turn even when more wait than one run can do —
 * a case left open on purpose (lots still waiting, not paid any more) never holds a place for ever.
 * `cases` in a stable order (oldest first). Answers the picked cases and how many wait for a later run.
 */
export function pickDropped<T extends { buyerNo: string | null }>(
  cases: T[], buyersWithLots: Set<string>, seq: number, limit: number,
): { pick: T[]; later: number } {
  const likely = cases.filter((c) => !buyersWithLots.has((c.buyerNo ?? "").trim().toUpperCase()))
  const others = cases.filter((c) => buyersWithLots.has((c.buyerNo ?? "").trim().toUpperCase()))
  let a = Math.min(likely.length, Math.ceil(limit / 2))
  const b = Math.min(others.length, limit - a)
  a = Math.min(likely.length, limit - b)
  const pick = [...windowAt(likely, seq, a), ...windowAt(others, seq, b)]
  return { pick, later: cases.length - pick.length }
}

/** An OData string literal ('O''Brien'). */
export const odataString = (s: string) => `'${s.replace(/'/g, "''")}'`

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
