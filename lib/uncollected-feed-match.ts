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
//
// The paid date. BC's published feeds carry no payment date, so a paid invoice's lastModifiedDateTime
// (BC's settling run) stands in for it — "paid by". BC does hold the exact day per lot
// (EVA_AuctionLine field 153 EVA_DatePaidByBuyer); the feed checks every run whether
// Auction_Lines_Excel publishes it, and when it does each lot carries it (FeedLot.paidOn) and a
// case's paid date is the LATEST of its lots' (paidDayFor) — "paid on … (BC's own paid date)".
//
// Storage. A case's storage start is set by the rule — the day after paid day + the free days
// (storageStartDay) — unless a person set it (storageStamp / storageStartOwner, lib/uncollected.ts).
//
// Gone or not: BC's Collected tick OR the lot's location (2026-10-23). BC only ticks a lot Collected
// once its collection docket is posted, and staff often scan lots to location COLLECTED without
// posting it. So the feed reads each lot's current location (Receipt_Lines_Excel) and a lot at a
// GONE_LOCATIONS code is treated exactly like a ticked one — left out of the uncollected lots before
// matching (splitByPlace). A lot at a QUERY_LOCATIONS code still finds its invoice, but isn't
// charged or counted: it goes in the candidate's `queryLots`, and the case is flagged
// (queryFlagText / nextQueryFlag). The constants and lotState are in lib/uncollected.ts.

import {
  BC_OWNED_FIELDS, PAID_EXACT_MARK, QUERY_LOCATIONS, addDays, dayToStored, daysBetween, formatDay, formatMoney, isDay,
  locationKind, locationListWords, londonDay, looksLikeBankDetails, lotState, normaliseLocation, queryLotWords,
  ruleMaySetStart, storageRuleWords, storageStartDay,
  UNCOLLECTED_LIMITS, type LotState, type UncollectedField,
} from "@/lib/uncollected"

/** BC's own paid date on an auction line (table 75004 EVA_AuctionLine, field 153; set by codeunit
 *  75075 ReleaseForPayment). Not on the published Auction_Lines_Excel page as of 2026-10-23 — the
 *  feed asks for it only once a row shows the key (hasPaidDateField). ⚠ Never put it in a $select
 *  unseen: BC refuses the WHOLE request (400) over one unknown field. */
export const BC_PAID_DATE_FIELD = "EVA_DatePaidByBuyer"

/** True when a row of Auction_Lines_Excel (read with no $select) carries BC's own paid date field. */
export function hasPaidDateField(row: unknown): boolean {
  return !!row && typeof row === "object" && Object.prototype.hasOwnProperty.call(row, BC_PAID_DATE_FIELD)
}

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
  /** BC's own paid date for the lot (EVA_DatePaidByBuyer), YYYY-MM-DD — null when BC doesn't publish
   *  it, or hasn't one for this lot (not paid, or paid before BC kept it). */
  paidOn: string | null
  /** Where BC has the lot now (Receipt_Lines_Excel EVA_ArticleLocationCode, normalised; "" = none) —
   *  set by the feed once its receipt line is read (withPlaces). Missing / null = not read: the
   *  Collected tick alone decides, as before. */
  location?: string | null
  /** Its bin there (EVA_ArticleBinCode), when read. */
  bin?: string | null
}

/** One lot on a candidate, as its case's timeline lists it. */
export type CandidateLot = { uniqueId: string | null; lotNo: string; description: string | null; hammer: number; saleCode: string; saleDate: string }

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
  /** The lots still here and charged for — what the case's `lots` counts. */
  lots: CandidateLot[]
  /** Its lots at a QUERY location in BC (MISSING, QUERY, RE-LOTTED, RE-AUCTION): not charged, not
   *  counted in `lots`, and flagged on the case (queryFlagText). A candidate may have only these. */
  queryLots: (CandidateLot & { location: string })[]
  /** The invoice's total including VAT. */
  amountPaid: number | null
  /** The paid day (YYYY-MM-DD): BC's own paid date for its lots when BC publishes it (paidExact),
   *  else the London day BC settled the invoice — they paid on or before it. */
  paidOn: string
  /** true = paidOn is BC's own paid date (the latest of its lots'); false = the settled-date stand-in. */
  paidExact: boolean
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
    // BC's blank date (0001-01-01) reads as none (bcDay).
    paidOn: bcDay(r[BC_PAID_DATE_FIELD]) || null,
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

// ─── Where each lot is now: Receipt_Lines_Excel ─────────────────────────────────────────────

/** Fields read off Receipt_Lines_Excel for a lot's location (verified live 2026-10-23). */
export const RECEIPT_LINE_SELECT = "EVA_UniqueID,EVA_ArticleLocationCode,EVA_ArticleBinCode"
/** Unique ids per Receipt_Lines_Excel call (`EVA_UniqueID eq '…' or …`). */
export const PLACES_PER_CALL = 20

/** A lot's location (normalised — "" when BC has none) and bin. */
export type LotPlace = { location: string; bin: string | null }

/** The key a lot's place is kept under: its unique id, upper case. */
export const placeKey = (uniqueId: unknown): string => str(uniqueId).toUpperCase()

/**
 * Receipt_Lines_Excel rows → each unique id's place. A unique id whose rows disagree about the
 * location is left out (in `ambiguous`) — then the Collected tick alone decides for it, never a guess.
 */
export function placesFromRows(rows: Record<string, unknown>[]): { places: Map<string, LotPlace>; ambiguous: Set<string> } {
  const places = new Map<string, LotPlace>()
  const ambiguous = new Set<string>()
  for (const r of rows) {
    const key = placeKey(r.EVA_UniqueID)
    if (!key || ambiguous.has(key)) continue
    const p: LotPlace = { location: normaliseLocation(r.EVA_ArticleLocationCode), bin: str(r.EVA_ArticleBinCode).toUpperCase() || null }
    const had = places.get(key)
    if (!had) { places.set(key, p); continue }
    if (had.location !== p.location) { places.delete(key); ambiguous.add(key); continue }
    if (!had.bin && p.bin) places.set(key, p)
  }
  return { places, ambiguous }
}

/** The lots with their place filled in where it was read (a copy; lots not in `places` are left
 *  with no location — the tick alone decides for them). */
export function withPlaces(lots: FeedLot[], places: Map<string, LotPlace>): FeedLot[] {
  return lots.map((l) => {
    const p = l.uniqueId ? places.get(placeKey(l.uniqueId)) : undefined
    return p ? { ...l, location: p.location, bin: p.bin } : l
  })
}

/**
 * Uncollected lots (BC's tick not set) split by their location: `gone` (a GONE location — treated
 * exactly as collected: dropped before matching), `query` (a QUERY location — kept for matching, not
 * charged), `here` (any other location, or not read). `kept` = here + query, in the order given.
 */
export function splitByPlace(lots: FeedLot[]): { kept: FeedLot[]; gone: FeedLot[]; query: FeedLot[]; here: FeedLot[] } {
  const out = { kept: [] as FeedLot[], gone: [] as FeedLot[], query: [] as FeedLot[], here: [] as FeedLot[] }
  for (const l of lots) {
    const kind = l.location == null ? "here" : locationKind(l.location)
    if (kind === "gone") { out.gone.push(l); continue }
    out.kept.push(l)
    out[kind].push(l)
  }
  return out
}

/** A lot of the buyer's that isn't charged: at a QUERY location (its location read). */
export const isQueryLot = (l: Pick<FeedLot, "location">): boolean => l.location != null && locationKind(l.location) === "query"

/** "COLLECTED 12, SHIPPED 2" — location codes with how many, most first. */
export function locationCounts(lots: Pick<FeedLot, "location">[]): string {
  const n = new Map<string, number>()
  for (const l of lots) { const k = l.location || "(none)"; n.set(k, (n.get(k) ?? 0) + 1) }
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, c]) => `${k} ${c.toLocaleString("en-GB")}`).join(", ")
}

/**
 * Where lots are, as read (keys = placeKey): the places read; ids whose receipt lines disagree
 * (`ambiguous` — the tick alone decides for them); and the ids NOT read, by why:
 *  • `failed` — BC didn't answer (no answer, 5xx / 429 after the retries): a passing fault, so the
 *    feed doesn't judge that buyer this run rather than judge it on the tick alone and flip its cases
 *    (lots 1 → 2 on the bad night, 2 → 1 the next; a case added that the next run closes);
 *  • `refused` — BC refuses to give locations at all this run (400 to a single id, 401 / 403 / 404):
 *    the tick alone decides for those lots, as before the locations were read (the run's notes say so);
 *  • `timedOut` — the time ran out or a Stop came first: that buyer isn't judged this run.
 * `error` = the first reason a read failed or was refused.
 */
export type PlacesRead = {
  places: Map<string, LotPlace>
  ambiguous: Set<string>
  failed: Set<string>
  refused: Set<string>
  timedOut: Set<string>
  error: string | null
}

export const noPlacesRead = (): PlacesRead =>
  ({ places: new Map(), ambiguous: new Set(), failed: new Set(), refused: new Set(), timedOut: new Set(), error: null })

/** Adds what `r` read into `into`. */
export function addPlacesRead(into: PlacesRead, r: PlacesRead): void {
  for (const [k, p] of r.places) into.places.set(k, p)
  for (const k of r.ambiguous) into.ambiguous.add(k)
  for (const k of r.failed) into.failed.add(k)
  for (const k of r.refused) into.refused.add(k)
  for (const k of r.timedOut) into.timedOut.add(k)
  if (!into.error && r.error) into.error = r.error
}

// ─── Reading invoice lines and locations, buyer by buyer ────────────────────────────────────

/** Runs `fn` over the items, `limit` at a time, taking them in order. `fn` handles its own errors. */
export async function eachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) await fn(items[next++])
  }))
}

/** One buyer's share of the reading: the invoices whose lines must be read, and their lots' unique ids. */
export type BuyerToRead = { buyer: string; invoiceIds: string[]; uniqueIds: string[] }

/**
 * Reads the invoice lines of each buyer (`perCall` invoices a call, `concurrency` calls at once, in
 * the order the buyers are given — the run's turn order) and, STRAIGHT AFTER the last of a buyer's
 * invoices has been read, where that buyer's lots are (`readPlaces`, inside the same worker, so never
 * more than `concurrency` calls at once).
 * ⚠ Interleaved on purpose. Locations read only after EVERY invoice's lines meant a run whose time ran
 * out during the lines had no time left for any location, so it judged no buyer at all — and runs that
 * kept running out of time never added, updated or closed a case. Now every buyer whose lines and
 * locations were both read before the time ran out is judged, and the rotation moves the start on.
 * `readLines` throws when a batch can't be read: its buyers go to `linesFailed` and are never placed.
 * `readPlaces` should never throw (it answers its failures); if it does, those ids count as `failed`.
 * Answers the lines read, the places read, and the buyers whose places were asked for (`placed`).
 */
export async function readLinesThenPlaces(
  buyers: BuyerToRead[],
  io: {
    readLines: (invoiceIds: string[]) => Promise<Map<string, InvoiceLines>>
    readPlaces: (uniqueIds: string[]) => Promise<PlacesRead>
    linesFailed: (buyers: string[], e: unknown) => void
    /** After each batch: invoices whose lines were asked for so far, and buyers placed so far. */
    progress?: (p: { invoicesDone: number; invoices: number; buyersPlaced: number; buyers: number }) => void
  },
  opts: { perCall: number; concurrency: number },
): Promise<{ lines: Map<string, InvoiceLines>; places: PlacesRead; placed: Set<string> }> {
  const lines = new Map<string, InvoiceLines>()
  const places = noPlacesRead()
  const placed = new Set<string>()
  const linesFailedFor = new Set<string>()
  const byBuyer = new Map(buyers.map((b) => [b.buyer, b]))
  const ownerOf = new Map<string, string>()   // invoice id → buyer (the first buyer to name it)
  for (const b of buyers) for (const id of b.invoiceIds) if (!ownerOf.has(id)) ownerOf.set(id, b.buyer)
  const ids = [...ownerOf.keys()]
  let invoicesDone = 0

  const place = async (ready: string[]) => {
    ready.forEach((b) => placed.add(b))   // claimed before the await, so no other worker asks again
    const want = ready.flatMap((b) => byBuyer.get(b)!.uniqueIds)
    if (!want.length) return
    try {
      addPlacesRead(places, await io.readPlaces(want))
    } catch (e) {
      for (const id of want) places.failed.add(placeKey(id))
      if (!places.error) places.error = String((e as Error)?.message ?? e).slice(0, 160) || "an unexpected error"
    }
  }
  const readyOf = (bs: string[]) =>
    bs.filter((b) => !linesFailedFor.has(b) && !placed.has(b) && byBuyer.get(b)!.invoiceIds.every((id) => lines.has(id)))

  // A buyer with no invoice to read has nothing to wait for.
  await place(readyOf(buyers.filter((b) => !b.invoiceIds.length).map((b) => b.buyer)))

  await eachLimit(chunk(ids, Math.max(1, opts.perCall)), opts.concurrency, async (batch) => {
    const owners = [...new Set(batch.map((id) => ownerOf.get(id)!))]
    try {
      for (const [id, l] of await io.readLines(batch)) lines.set(id, l)
    } catch (e) {
      const fresh = owners.filter((b) => !linesFailedFor.has(b))
      fresh.forEach((b) => linesFailedFor.add(b))
      if (fresh.length) io.linesFailed(fresh, e)
    }
    invoicesDone += batch.length
    await place(readyOf(owners))
    try { io.progress?.({ invoicesDone, invoices: ids.length, buyersPlaced: placed.size, buyers: buyers.length }) } catch { /* the screen's problem */ }
  })
  return { lines, places, placed }
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

/** Paid in full, at least `afterDays` London days ago (counted to `today`) by BC's settled date. */
export function qualifies(inv: FeedInvoice, today: string, afterDays: number): boolean {
  if (!countsAsHome(inv) || !isPaidInFull(inv)) return false
  const paid = paidDayOf(inv)
  return !!paid && daysBetween(paid, today) >= afterDays
}

/**
 * Could this invoice give a case today? Paid in full and old enough by BC's settled date — or, when
 * BC publishes each lot's own paid date, one of the buyer's uncollected lots sold on or before the
 * invoice was paid at least `afterDays` ago (BC's own paid date can be earlier than its settled
 * date). Which lots are really on it is only known once its lines are read: matchBuyer then takes
 * the paid day from those lots (paidDayFor) and checks again.
 */
export function couldQualify(inv: FeedInvoice, today: string, afterDays: number, lots?: FeedLot[]): boolean {
  if (qualifies(inv, today, afterDays)) return true
  if (!countsAsHome(inv) || !isPaidInFull(inv)) return false
  return !!lots?.some((l) => l.paidOn && l.saleDate <= inv.invoiceDate && daysBetween(l.paidOn, today) >= afterDays)
}

/**
 * The paid day of a paid invoice whose lots are `lots`: BC's own paid date — the LATEST of the lots'
 * (the day it was paid in full) — when any of them has one, else the day BC settled the invoice.
 * null when neither is known.
 */
export function paidDayFor(inv: Pick<FeedInvoice, "lastModified">, lots: Pick<FeedLot, "paidOn">[]): { day: string; exact: boolean } | null {
  const exact = lots.reduce<string | null>((d, l) => (l.paidOn && (!d || l.paidOn > d) ? l.paidOn : d), null)
  if (exact) return { day: exact, exact: true }
  const settled = paidDayOf(inv)
  return settled ? { day: settled, exact: false } : null
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
 *  latest invoice that could qualify (couldQualify — a lot's home is the earliest that lists it, so
 *  any earlier invoice might be it). None when nothing could qualify. `lots` = the buyer's
 *  uncollected lots (their own paid dates, when BC publishes them). */
export function invoicesNeedingLines(invoices: FeedInvoice[], today: string, afterDays: number, lots?: FeedLot[]): FeedInvoice[] {
  const q = invoices.filter((i) => couldQualify(i, today, afterDays, lots))
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
  /** Paid, with lots still here, but by its lots' own paid date not yet `afterDays` old. */
  notYet: number
  /** Candidates whose lots carried no paid date of BC's own though others of the buyer's did, so the
   *  settled date stood in (only counted when BC publishes the field). */
  settledFallback: number
}

/**
 * One buyer: their uncollected lots, their invoices (dated on or after their earliest lot's sale),
 * and the lines of every invoice invoicesNeedingLines() named. Answers one candidate per paid
 * invoice old enough with at least one uncollected lot.
 *
 * ⚠ `lots` must already have the GONE ones taken out (splitByPlace → kept): a lot at a GONE location
 * is collected, exactly as if BC had ticked it. Lots at a QUERY location are passed in — they still
 * find their invoice, but the candidate carries them in `queryLots`, not `lots` (not charged).
 * The GONE ones go in `opts.gone` — used ONLY to choose the fallback's sale (next point), never matched.
 *
 * A paid invoice with no readable lot numbers but with lot lines falls back to the buyer's
 * uncollected lots from the latest sale on or before its date — only lots with no other home,
 * each used once. ⚠ That sale is chosen over the buyer's gone lots with no other home as well
 * (`opts.gone`): when the latest sale on or before the invoice has only gone lots (all scanned to
 * COLLECTED, say), the invoice gives no case — never a walk back to an older sale's lots, which
 * belong to some other invoice (an unpaid earlier one, say).
 */
export function matchBuyer(
  lots: FeedLot[],
  invoices: FeedInvoice[],
  lines: Map<string, InvoiceLines>,
  opts: { today: string; afterDays: number; gone?: FeedLot[] },
): BuyerMatch {
  const out: BuyerMatch = { candidates: [], fallback: [], notLotInvoices: 0, allCollected: 0, notYet: 0, settledFallback: 0 }
  const homes = assignHomes(lots, invoices, lines)
  const homed = new Set(homes.keys())
  const usedByFallback = new Set<number>()
  const exactKnown = lots.some((l) => l.paidOn)
  // The buyer's gone lots no invoice lists (a gone lot listed on another invoice is that one's).
  const gone = opts.gone ?? []
  const goneHomes = gone.length ? assignHomes(gone, invoices, lines) : new Map<number, string>()
  const goneUnhomed = gone.filter((_, i) => !goneHomes.has(i))

  for (const inv of invoices.filter((i) => couldQualify(i, opts.today, opts.afterDays, lots)).sort(byDateThenNumber)) {
    const l = lines.get(inv.id)
    if (!l) continue   // the caller marks the buyer unchecked rather than guessing
    let mine: number[] = []
    let fallbackSale: string | null = null
    if (l.refs.length) {
      mine = lots.map((_, i) => i).filter((i) => homes.get(i) === inv.id)
    } else if (l.hasLotLines) {
      const free = lots.map((_, i) => i).filter((i) => !homed.has(i) && !usedByFallback.has(i) && lots[i].saleDate <= inv.invoiceDate)
      // The sale is the latest on or before the invoice among the free lots AND the gone ones.
      const pickFrom = [...free.map((i) => lots[i]), ...goneUnhomed.filter((g) => g.saleDate <= inv.invoiceDate)]
      const latest = pickFrom.reduce((d, x) => (x.saleDate > d ? x.saleDate : d), "")
      if (latest) {
        const sale = pickFrom.find((x) => x.saleDate === latest)!
        // Only its lots still here — none when that sale's lots have all gone (then no case).
        mine = free.filter((i) => lots[i].saleDate === latest && lots[i].saleCode === sale.saleCode)
        fallbackSale = sale.saleCode
        mine.forEach((i) => usedByFallback.add(i))
      }
    } else {
      out.notLotInvoices++
      continue
    }
    if (!mine.length) { out.allCollected++; continue }
    // The paid day from ITS lots (BC's own, when published), and old enough by it.
    const paid = paidDayFor(inv, mine.map((i) => lots[i]))
    if (!paid || daysBetween(paid.day, opts.today) < opts.afterDays) { out.notYet++; continue }
    if (exactKnown && !paid.exact) out.settledFallback++
    if (fallbackSale) out.fallback.push({ invoiceNo: inv.number, saleCode: fallbackSale })
    out.candidates.push(toCandidate(inv, mine.map((i) => lots[i]), opts.today, fallbackSale, paid))
  }
  return out
}

function toCandidate(
  inv: FeedInvoice, lots: FeedLot[], today: string, fallbackSale: string | null, paid: { day: string; exact: boolean },
): Candidate {
  const sorted = [...lots].sort((a, b) =>
    a.saleDate < b.saleDate ? -1 : a.saleDate > b.saleDate ? 1
      : a.saleCode.localeCompare(b.saleCode) || a.lotNo.localeCompare(b.lotNo, "en", { numeric: true }))
  const sales: string[] = []
  for (const l of sorted) if (!sales.includes(l.saleCode)) sales.push(l.saleCode)
  const last = sorted[sorted.length - 1]
  const paidOn = paid.day
  const one = (l: FeedLot): CandidateLot => ({ uniqueId: l.uniqueId, lotNo: l.lotNo, description: l.description, hammer: l.hammer, saleCode: l.saleCode, saleDate: l.saleDate })
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
    // A lot at a QUERY location stays on its invoice (so the case knows of it) but isn't charged
    // or counted — it is flagged on the case instead (queryFlagText).
    lots: sorted.filter((l) => !isQueryLot(l)).map(one),
    queryLots: sorted.filter(isQueryLot).map((l) => ({ ...one(l), location: l.location as string })),
    amountPaid: inv.total == null ? null : Math.round(inv.total * 100) / 100,
    paidOn,
    paidExact: paid.exact,
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

/** How many parts of a case's "sale" box (split on commas or semicolons) AREN'T a sale code — words
 *  typed by hand on a case added by hand ("F068 day 2", "and F069"), not counting joinSales's own
 *  "+N more" (salesLeftOff). salesOf leaves them out, so a box with any can't be read in full:
 *  ⚠ never judge such a case "all collected" from the sales salesOf did find. */
export function salesUnparsed(saleCode: string | null | undefined): number {
  const parts = (saleCode ?? "").split(/[,;]/).map((s) => s.trim()).filter(Boolean)
  return Math.max(0, parts.length - salesOf(saleCode).length - (salesLeftOff(saleCode) > 0 ? 1 : 0))
}

// ─── A case that dropped out: are its lots collected? ───────────────────────────────────────

/**
 * The buyer's lots on a dropped case's invoice among `rows` (Auction_Lines_Excel, their lots in its
 * sale(s) as BC has them now): sold to them (hammer over £0, not withdrawn) and listed on the invoice
 * (refs — suffix tolerant; refs empty = the invoice had no readable lot numbers: every sold lot of
 * theirs in the sale counts).
 */
export function droppedLots(refs: LotRef[], rows: Record<string, unknown>[], buyerNo: string): Record<string, unknown>[] {
  const buyer = buyerNo.trim().toUpperCase()
  return rows.filter((r) => {
    if (str(r.EVA_BuyerNo).toUpperCase() !== buyer) return false
    if (!((num(r.EVA_HammerPrice) ?? 0) > 0) || bcTrue(r.EVA_WithdrawLot)) return false
    if (!refs.length) return true
    const lot = { lotNum: lotNumber(r.EVA_LotNo), lotSuffix: str(r.EVA_LotSuffix).toUpperCase() }
    return refs.some((ref) => refMatchesLot(ref, lot))
  })
}

export type DroppedVerdict = "collected" | "waiting" | "query" | "unknown"

export type DroppedEvidence = {
  /** "collected" = every lot of theirs on the invoice is gone (ticked, or at a GONE location);
   *  "waiting" = one is still here; "query" = none is here, but one is at a QUERY location (not
   *  proof it went — left open); "unknown" = none of them can be found (re-sold, renumbered…). */
  verdict: DroppedVerdict
  /** Lots BC ticked as collected. */
  ticked: number
  /** Lots not ticked but at a GONE location — location → how many. */
  gone: Record<string, number>
  /** Lots at a QUERY location. */
  query: { lotNo: string; location: string }[]
  /** Lots not ticked whose location wasn't read (judged on the tick alone — so still here). */
  unread: number
}

/**
 * For an open case from BC whose invoice is still paid but which the check no longer found. Only
 * a POSITIVE answer closes a case: "collected" when every lot of theirs on the invoice is ticked
 * collected or at a GONE location (`places`, from Receipt_Lines_Excel — a lot not in it is judged on
 * the tick alone, as before). See DroppedEvidence for the other answers.
 */
export function droppedEvidence(
  refs: LotRef[], rows: Record<string, unknown>[], buyerNo: string, places?: Map<string, LotPlace>,
): DroppedEvidence {
  const out: DroppedEvidence = { verdict: "unknown", ticked: 0, gone: {}, query: [], unread: 0 }
  const mine = droppedLots(refs, rows, buyerNo)
  if (!mine.length) return out
  let here = 0
  for (const r of mine) {
    const ticked = bcTrue(r.EVA_Collected)
    const p = places?.get(placeKey(r.EVA_UniqueID))
    if (!ticked && !p) out.unread++
    const state: LotState = lotState(ticked, p ? p.location : null)
    if (state === "collected") out.ticked++
    else if (state === "gone") out.gone[p!.location] = (out.gone[p!.location] ?? 0) + 1
    else if (state === "query") out.query.push({ lotNo: lotNoOf(r.EVA_LotNo, r.EVA_LotSuffix) || "?", location: p!.location })
    else here++
  }
  out.verdict = here ? "waiting" : out.query.length ? "query" : "collected"
  return out
}

/** droppedEvidence's verdict alone (`places` left out = the Collected tick alone, as before). */
export function droppedVerdict(refs: LotRef[], rows: Record<string, unknown>[], buyerNo: string, places?: Map<string, LotPlace>): DroppedVerdict {
  return droppedEvidence(refs, rows, buyerNo, places).verdict
}

/** What a run read for one buyer it judged in full: their lots BC hasn't ticked (with where each is,
 *  once read), and their invoices by number (upper case) with the lot numbers on each — `refs` null
 *  when that invoice's lines weren't read. */
export type JudgedBuyer = { lots: FeedLot[]; invoices: Map<string, { invoice: FeedInvoice; refs: LotRef[] | null }> }

/** A lot BC has TICKED collected (its collection docket was posted), as the quick re-check's batched
 *  read of a case's sales gives it (Auction_Lines_Excel, EVA_Collected true). */
export type TickedLot = Pick<FeedLot, "saleCode" | "lotNum" | "lotSuffix">

/**
 * The QUICK re-check of an open case from BC that the run didn't find — from what the run already
 * read for its buyer (and, optionally, `ticked`: their lots BC ticked collected in the case's sales,
 * read for many buyers a call), so no limit a run (2026-10-23 — Jack: "things are scanned as collected
 * and still showing"). The cases added before the check read locations, whose lots were scanned to
 * COLLECTED without the docket being posted, close on the first check that reads their buyer, instead
 * of 60 a run — and on a run that ran out of time too.
 * Positive evidence only:
 *  • the invoice is paid in full and its lines were read, with lot numbers on them;
 *  • the case's sale box holds all its sales and nothing else;
 *  • every lot of theirs BC HASN'T ticked in those sales that any of the invoice's lot numbers fits
 *    (suffix-tolerant) was sold safely inside the run's window (`windowFrom` +
 *    QUICK_WINDOW_MARGIN_DAYS) and had its location read, and it is a GONE one;
 *  • EVERY "Buyer Premium for Lot No N" line on the invoice is matched to a DIFFERENT lot of theirs in
 *    those sales — one of those gone ones, or one BC ticked (`ticked`) — exact number + suffix first;
 *  • every sale in the box has one of the matched lots.
 * Anything else → null, and the case goes to the slow re-check (checkDropped) as before.
 * ⚠⚠ A lot missing from the run is NOT proof it went (two reviews, 2026-10-23): the run only holds
 * lots BC hasn't ticked, of sales inside the 12-month window, as BC's paging gave them. An invoice lot
 * matched to nothing the run (or the ticked read) saw — its sale aged out of the window, dropped from
 * the box by an earlier save, or its row skipped by paging — always sends the case to the slow
 * re-check, which reads each sale whole. Never relax this to "the lots the run saw are gone".
 */
export function droppedFromRun(
  c: { saleCode: string | null; invoiceKey: string }, buyer: JudgedBuyer | undefined, windowFrom: string,
  ticked?: TickedLot[],
): DroppedEvidence | null {
  if (!buyer) return null
  const got = buyer.invoices.get(c.invoiceKey.trim().toUpperCase())
  // No readable lot numbers on the invoice → nothing to account for every lot by: the slow re-check.
  if (!got || !got.refs || !got.refs.length || !isPaidInFull(got.invoice)) return null
  if (salesLeftOff(c.saleCode) > 0 || salesUnparsed(c.saleCode) > 0) return null
  const sales = new Set(salesOf(c.saleCode))
  if (!sales.size) return null
  const refs = got.refs
  const inSales = (l: { saleCode: string }) => sales.has(l.saleCode.trim().toUpperCase())
  const fits = (l: Pick<FeedLot, "lotNum" | "lotSuffix">) => refs.some((r) => refMatchesLot(r, l))
  // Every unticked lot of theirs any invoice lot number fits must have gone — even one the matching
  // below doesn't pick (a premium line may leave the suffix off, so 366 could be 366A).
  const mine = buyer.lots.filter((l) => inSales(l) && fits(l))
  const safeFrom = addDays(windowFrom, QUICK_WINDOW_MARGIN_DAYS)
  const gone: Record<string, number> = {}
  for (const l of mine) {
    if (!l.saleDate || l.saleDate < safeFrom) return null
    if (l.location == null || locationKind(l.location) !== "gone") return null
    gone[l.location] = (gone[l.location] ?? 0) + 1
  }
  // One entry per lot (sale + number + suffix): a lot ticked between the run's read and the ticked
  // read would otherwise be in both, and could stand in for two of the invoice's lines.
  const pool: { saleCode: string; lotNum: string; lotSuffix: string; ticked: boolean }[] = []
  const inPool = new Set<string>()
  for (const [l, isTicked] of [...mine.map((m) => [m, false] as const), ...(ticked ?? []).filter((t) => inSales(t) && fits(t)).map((t) => [t, true] as const)]) {
    const k = `${l.saleCode.trim().toUpperCase()}:${l.lotNum}:${l.lotSuffix}`
    if (inPool.has(k)) continue
    inPool.add(k)
    pool.push({ saleCode: l.saleCode, lotNum: l.lotNum, lotSuffix: l.lotSuffix, ticked: isTicked })
  }
  // ⚠⚠ EVERY lot on the invoice must be one that was seen: each premium line matched to a DIFFERENT
  // lot. Exact matches first (suffixed refs before plain ones), then the suffix-tolerant match, so a
  // lot isn't taken by a looser ref that another lot would have fitted. A miss only ever means "slow path".
  const used = new Set<(typeof pool)[number]>()
  for (const r of [...refs].sort((a, b) => Number(!a.suffix) - Number(!b.suffix))) {
    const free = pool.filter((m) => !used.has(m))
    const l = free.find((m) => refIsExactly(r, m)) ?? free.find((m) => refMatchesLot(r, m))
    if (!l) return null
    used.add(l)
  }
  const matchedSales = new Set([...used].map((m) => m.saleCode.trim().toUpperCase()))
  for (const sale of sales) if (!matchedSales.has(sale)) return null
  return { verdict: "collected", ticked: [...used].filter((m) => m.ticked).length, gone, query: [], unread: 0 }
}

/** An Auction_Lines_Excel row as a lot BC TICKED collected and sold to someone (hammer over £0, not
 *  withdrawn) — or null. With its buyer (upper case), for sorting a batched read back to each buyer. */
export function toTickedLot(r: Record<string, unknown>): (TickedLot & { buyerNo: string }) | null {
  if (!bcTrue(r.EVA_Collected) || !((num(r.EVA_HammerPrice) ?? 0) > 0) || bcTrue(r.EVA_WithdrawLot)) return null
  const saleCode = str(r.EVA_AuctionNo).toUpperCase()
  const buyerNo = str(r.EVA_BuyerNo).toUpperCase()
  const lotNum = lotNumber(r.EVA_LotNo)
  if (!saleCode || !buyerNo || !lotNum) return null
  return { saleCode, lotNum, lotSuffix: str(r.EVA_LotSuffix).toUpperCase(), buyerNo }
}

/** Could `ticked` (the batched read of lots BC ticked) let droppedFromRun close this case? — the
 *  invoice is paid with lot numbers, the box is clean, and every unticked lot of theirs the invoice's
 *  numbers fit has gone. Only for these is the ticked read worth its BC calls. */
export function droppedNeedsTicked(c: { saleCode: string | null; invoiceKey: string }, buyer: JudgedBuyer | undefined, windowFrom: string): boolean {
  if (!buyer) return false
  const got = buyer.invoices.get(c.invoiceKey.trim().toUpperCase())
  if (!got || !got.refs || !got.refs.length || !isPaidInFull(got.invoice)) return false
  if (salesLeftOff(c.saleCode) > 0 || salesUnparsed(c.saleCode) > 0 || !salesOf(c.saleCode).length) return false
  const sales = new Set(salesOf(c.saleCode))
  const refs = got.refs
  const safeFrom = addDays(windowFrom, QUICK_WINDOW_MARGIN_DAYS)
  return buyer.lots
    .filter((l) => sales.has(l.saleCode.trim().toUpperCase()) && refs.some((r) => refMatchesLot(r, l)))
    .every((l) => !!l.saleDate && l.saleDate >= safeFrom && l.location != null && locationKind(l.location) === "gone")
}

/** droppedFromRun leaves a case to the slow re-check when any of its lots was sold within this many
 *  days of the window's start — a sale held over more than one day could have lots either side of it. */
export const QUICK_WINDOW_MARGIN_DAYS = 7

/**
 * The case page's "Close as collected", from the lots read live there (bcLotsForBuyer): every lot BC
 * shows as sold to the buyer in the case's sale(s) must be gone — ticked, or at a GONE location — with
 * every sale read and the list complete. The evidence, or why not in plain words.
 */
export function collectedFromLiveLots(d: {
  lots: { state: LotState; location: string | null; locationRead?: boolean }[]
  salesLeftOut: number
  more: boolean
  locationError?: string | null
  /** Sales read that gave no lot sold to them (bcLotsForBuyer). */
  emptySales?: string[]
}): { ok: true; evidence: DroppedEvidence } | { ok: false; why: string } {
  if (d.salesLeftOut > 0) return { ok: false, why: "This case covers more sales than the case page reads (or its sale box holds something that isn't a sale code), so the Hub can't tell every lot has gone — check them in BC, then change its status to Collected." }
  // Every sale on the case must show lots of theirs (second review, 2026-10-23): a code that reads
  // nothing ("F068-2", a typo) is a sale whose lots were never looked at.
  if (d.emptySales?.length) return { ok: false, why: `BC shows no lots sold to them in ${locationListWords(d.emptySales, "or")} — check the sale box on this case, so every sale's lots can be looked at.` }
  if (d.more) return { ok: false, why: "BC has more lots for them than the case page reads, so the Hub can't tell every lot has gone — check them in BC, then change its status to Collected." }
  if (!d.lots.length) return { ok: false, why: "BC shows no lots sold to them in this sale — check the buyer number and sale on this case." }
  // A lot BC hasn't ticked whose location wasn't read is "here" on the tick alone — but BC didn't say
  // it's here, it didn't answer: say that, so the admin tries again rather than chases the buyer.
  const here = d.lots.filter((l) => l.state === "here" && l.locationRead !== false).length
  if (here) return { ok: false, why: `BC shows ${here === 1 ? "1 lot" : `${here} lots`} still here, so the case stays open.` }
  const unread = d.lots.filter((l) => l.state === "here").length
  if (unread) return { ok: false, why: `Where ${unread === 1 ? "1 lot is" : `${unread} lots are`} couldn't be read from BC just now${d.locationError ? ` (${d.locationError})` : ""}, so nothing was closed — try again in a minute.` }
  const query = d.lots.filter((l) => l.state === "query")
  if (query.length) return { ok: false, why: `${query.length === 1 ? "1 lot is" : `${query.length} lots are`} at a query location in BC (${locationListWords([...new Set(query.map((l) => l.location ?? ""))].sort(), "and")}) — check ${query.length === 1 ? "it" : "them"} before closing the case.` }
  const ev: DroppedEvidence = { verdict: "collected", ticked: 0, gone: {}, query: [], unread: 0 }
  for (const l of d.lots) {
    if (l.state === "gone" && l.location) ev.gone[l.location] = (ev.gone[l.location] ?? 0) + 1
    else ev.ticked++
  }
  return { ok: true, evidence: ev }
}

/**
 * Why the check closes a case as collected, naming the locations it saw:
 *  "BC shows the lots collected" (every one ticked) ·
 *  "BC shows the lots collected (location COLLECTED)" (none ticked; all at COLLECTED) ·
 *  "BC shows the lots collected (locations COLLECTED and SHIPPED)" ·
 *  "BC shows the lots collected (1 ticked as collected; 2 at location COLLECTED)".
 */
export function collectedWhyWords(e: Pick<DroppedEvidence, "ticked" | "gone">): string {
  const locs = Object.entries(e.gone).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  if (!locs.length) return "BC shows the lots collected"
  if (!e.ticked) return `BC shows the lots collected (location${locs.length === 1 ? "" : "s"} ${locationListWords(locs.map(([k]) => k), "and")})`
  return `BC shows the lots collected (${e.ticked} ticked as collected; ${locs.map(([k, n]) => `${n} at location ${k}`).join(", ")})`
}

/** true when a close was decided (at least partly) by a GONE location rather than BC's tick alone. */
export const closedByLocation = (e: Pick<DroppedEvidence, "gone">): boolean => Object.keys(e.gone).length > 0

/**
 * The status line when the check closes a case because BC shows its lots collected (`stopDay` =
 * collectedStopFrom's day). ⚠ When a GONE location decided it, BC keeps no date for the scan to that
 * location either, and the lots may well have been scanned out (the docket never posted) before the
 * case was even added — the cases opened before the check read locations were — so the line says the
 * storage figure may be too high and to check it, and waive it if so (a decision for Jack: RULES.md).
 * ⚠ Never "storage charges from", "paid by" / "paid on" or "BC no longer shows invoice" in it (other
 * readers of the timeline look for those).
 */
export function collectedCloseText(
  fromLabel: string, toLabel: string, e: Pick<DroppedEvidence, "ticked" | "gone">, stopDay: string, by: "check" | "page" = "check",
): string {
  const day = dayWords(stopDay)
  // "page" = Close as collected on the case page, from the lots read live there (collectedFromLiveLots).
  const head = `${fromLabel} → ${toLabel} — ${collectedWhyWords(e)}${by === "page" ? ", read live from BC on the case page" : ""}.`
  const stop = by === "page"
    ? `the day of the last BC check, the last day they could have been seen still here — and storage stops then.`
    : `the day of the check before this one, the last day they could have been seen still here — and storage stops then.`
  if (!closedByLocation(e)) return `${head} BC doesn't say which day they went, so the case is closed on ${day} — ${stop}`
  const locs = locationListWords(Object.keys(e.gone).sort(), "or")
  return `${head} BC doesn't say which day they went, or when they were scanned to ${locs}, so the case is closed on ${day} — ${stop}` +
    ` ⚠ Check the storage figure: if they were scanned out without the collection docket being posted before this case was added, the figure is too high — waive the storage if so.`
}

/**
 * The day the clock stops on a case the check closes because BC shows its lots collected: the London
 * day of the check's previous full read of BC (`prevReadAt` — the last day the lots could have been
 * seen still here), never later than `today`; the day before `today` when there was none. `closedAt`
 * is that day stored the date-only way (12:00 UTC), or `now` when it is today. BC keeps no collected
 * date; storage counts the day a case closes, so the moment of the check would charge a day too many.
 */
export function collectedStopFrom(
  prevReadAt: Date | string | null,
  today: string,
  now: Date = new Date(),
): { day: string; closedAt: Date } {
  const prevDay = prevReadAt ? londonDay(prevReadAt) : addDays(today, -1)
  const day = prevDay > today ? today : prevDay
  return { day, closedAt: day >= today ? now : dayToStored(day) }
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
  /** The case's storage start (only compared when the rule may set it — FeedChangeOptions.storage). */
  storageFrom?: Date | null
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

export type FeedChangeOptions = {
  /** Whether the case's paid date is BC's own now (readPaidExact): true / false, or null when the
   *  case's timeline doesn't say. A case BC already holds is told when it switches between BC's own
   *  paid date and the settled date even when the day is the same, so the panel's "Paid on (BC)" /
   *  "Paid by (BC settled date)" (from the timeline) stays true. Leave out for a case being taken
   *  over (its "Matched" line says which). */
  currentExact?: boolean | null
  /** Set the storage start by the rule: who set it last (storageStartOwner) and the free days. Left
   *  out (or null — the settings couldn't be read) = the storage start isn't touched. */
  storage?: { owner: "rule" | "person" | null; graceDays: number } | null
  /** Leave the case's paid date — and the "paid on / paid by" it carries — exactly as it is, and work
   *  the storage start out from THAT date. Set when this run couldn't tell whether BC publishes its own
   *  paid date (FindResult.paidDates "unknown") and the case is, or may be, on it: a passing fault must
   *  never flip it to the settled date and back, moving its storage start each time. */
  holdPaid?: boolean
}

/**
 * What the feed would change on a case: the fields BC owns (BC_OWNED_FIELDS) where BC now says
 * something different, plus the email and phone ONLY where the case has none, plus — when
 * `opts.storage` is given and no person set it (ruleMaySetStart) — the storage start by the rule
 * (the day after paid day + the free days). Nothing else — a case's status, notes, chase date,
 * a storage start a person set, and timeline are the staff's.
 * Empty `set` = nothing to write (the check is idempotent: a second run changes nothing).
 */
export function feedChanges(current: CaseLike, c: Candidate, opts: FeedChangeOptions = {}): FeedChange {
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
  if (owned.has("paidAt") && !opts.holdPaid) {
    const was = current.paidAt ? formatDay(current.paidAt) : "—"
    const now = dayWords(v.paidOn)
    if (!sameDay(current.paidAt, v.paidOn)) {
      set.paidAt = v.paidOn
      // ⚠ The words carry which date it is (paidExactFromText reads the line): PAID_EXACT_MARK for
      // BC's own paid date, "paid by" for the settled date — never both.
      phrases.push(c.paidExact ? `paid on ${now} (${PAID_EXACT_MARK}) — was ${was}` : `paid by ${was} → ${now}`)
    } else if (opts.currentExact !== undefined && c.paidExact !== (opts.currentExact === true)) {
      phrases.push(c.paidExact
        ? `paid on ${now} — now ${PAID_EXACT_MARK}`
        : `paid by ${now} — the day BC settled the invoice, as BC no longer gives a paid date for these lots`)
    }
  }
  const email = cleanEmail(c.email)
  if (!current.email && email) { set.email = email; phrases.push("email added from BC") }
  const phone = cleanPhone(c.phone)
  if (!current.phone && phone) { set.phone = phone; phrases.push("phone added from BC") }
  const paidForStorage = opts.holdPaid && current.paidAt ? londonDay(current.paidAt) : v.paidOn
  const st = storageStamp(current.storageFrom ?? null, paidForStorage, opts.storage)
  if (st) { set.storageFrom = st.day; phrases.push(st.words) }
  return { set, phrases, lotsChanged }
}

/**
 * The storage start the rule gives a case (the day after paid day + the free days), when the rule
 * may set it (no person set it — ruleMaySetStart) and it differs from what the case holds. null =
 * leave it as it is. `words` is the timeline's phrase (with STORAGE_RULE_MARK, so the rule still
 * owns the start afterwards).
 */
export function storageStamp(
  storageFrom: Date | null,
  paidOn: string,
  storage: FeedChangeOptions["storage"],
): { day: string; words: string } | null {
  if (!storage || !ruleMaySetStart(storage.owner, storageFrom)) return null
  const day = storageStartDay(paidOn, storage.graceDays)
  const cur = storageFrom ? londonDay(storageFrom) : null
  if (!day || day === cur) return null
  return { day, words: storageRuleWords(day, storage.graceDays, cur) }
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

/** "paid by 3 Jun 2026, 2 lots not collected after 49 days" (the settled date), or
 *  "paid on 2 Jun 2026 (BC's own paid date), 2 lots …" (⚠ paidExactFromText reads these words).
 *  With lots at a QUERY location: "…, 2 lots not collected after 49 days (and 1 to check in BC)", or
 *  "…, no lot to charge for after 49 days — 1 to check in BC" when those are all it has. */
export function dueWords(c: Candidate): string {
  const paid = c.paidExact ? `paid on ${dayWords(c.paidOn)} (${PAID_EXACT_MARK})` : `paid by ${dayWords(c.paidOn)}`
  const q = c.queryLots?.length ?? 0
  if (!c.lots.length && q) return `${paid}, no lot to charge for after ${c.daysSincePaid} days — ${q} to check in BC`
  return `${paid}, ${plural(c.lots.length, "lot")} not collected after ${c.daysSincePaid} days${q ? ` (and ${q} to check in BC)` : ""}`
}

/** The lot list, or nothing when there are no lots still here (a case whose lots are all to check). */
const listBlock = (lots: Candidate["lots"]) => (lots.length ? `\n${lotListText(lots)}` : "")

/** The "created" event of a case the check adds — with its storage start by the rule, when it set one. */
export function addedText(c: Candidate, storage?: { day: string; graceDays: number } | null): string {
  const fb = c.fallbackSale ? `\n(Invoice ${c.invoiceNo} lists no lot numbers, so these are their uncollected lots from ${c.fallbackSale}.)` : ""
  const st = storage ? ` ${capitalise(storageRuleWords(storage.day, storage.graceDays))}.` : ""
  return `Added from BC: ${dueWords(c)}. Invoice ${c.invoiceNo}.${st}${listBlock(c.lots)}${fb}`
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The event when the check takes over a case added by hand. */
export function matchedText(c: Candidate, changes: string[]): string {
  const ch = changes.length ? ` Taken from BC: ${changes.join(", ")}.` : ""
  return `Matched to BC invoice ${c.invoiceNo}: ${dueWords(c)}. From now on BC keeps its name, buyer number, sale, invoice, lots, amount paid and paid date.${ch}${listBlock(c.lots)}`
}

/** The event when BC changed something on a case it already holds. */
export function updatedText(c: Candidate, ch: FeedChange, paidAgain: boolean): string {
  const parts = [...(paidAgain ? [`BC shows invoice ${c.invoiceNo} as paid again`] : []), ...ch.phrases]
  const head = `BC update: ${parts.join("; ")}.`
  if (!ch.lotsChanged) return head
  return c.lots.length
    ? `${head}\nStill not collected:\n${lotListText(c.lots)}`
    : `${head}\nNone of its lots is still waiting here — the rest are at a query location in BC (see the note to check ${(c.queryLots?.length ?? 0) === 1 ? "it" : "them"}).`
}

// ─── Lots at a QUERY location: the flag on the case ─────────────────────────────────────────
// Said on the case's timeline as a note from the check, ONLY when the lots to check change (so a
// second run writes nothing): nextQueryFlag compares what it would say with the check's last flag
// (or "nothing to check") line on the case. ⚠ The flag starts "⚠ " and the all-clear starts "✓ No
// lot" — isQueryFlagText / isQueryClearText read them back; never "storage charges from", "paid by"
// or "BC no longer shows invoice" in them (other readers of the timeline look for those).

/** How the check's flag line starts (queryFlagText), and its all-clear (queryClearText). */
export const QUERY_FLAG_START = "⚠ "
export const QUERY_CLEAR_START = "✓ No lot on this case is at a query location in BC now"

/**
 * The flag for a case's lots at a QUERY location, or null for none:
 *  "⚠ Lot 513 is at MISSING in BC — check it before chasing. It isn't charged, or counted in this
 *   case's lots, while it's there."
 *  "⚠ 2 lots are at a query location in BC — check them before chasing. They aren't charged, or
 *   counted in this case's lots, while they're there:\n• Lot 513 is at MISSING\n• Lot 551 is at QUERY"
 * The sale is named on each lot when the case covers more than one sale.
 */
export function queryFlagText(c: Pick<Candidate, "lots" | "queryLots">): string | null {
  const q = c.queryLots ?? []
  if (!q.length) return null
  const sorted = [...q].sort((a, b) => a.saleCode.localeCompare(b.saleCode) || a.lotNo.localeCompare(b.lotNo, "en", { numeric: true }))
  const withSale = new Set([...c.lots, ...q].map((l) => l.saleCode)).size > 1
  if (sorted.length === 1) {
    return `${QUERY_FLAG_START}${queryLotWords(sorted[0], withSale)}. It isn't charged, or counted in this case's lots, while it's there.`
  }
  const lines = sorted.map((l) => `• Lot ${l.lotNo}${withSale ? ` (${l.saleCode})` : ""} is at ${normaliseLocation(l.location)}`)
  return `${QUERY_FLAG_START}${sorted.length} lots are at a query location in BC — check them before chasing. They aren't charged, or counted in this case's lots, while they're there:\n${lines.join("\n")}`
}

/** The all-clear, said once when a case that had lots to check has none any more. */
export const queryClearText = () =>
  `${QUERY_CLEAR_START} (${locationListWords(QUERY_LOCATIONS)}) — nothing to check before chasing.`

/** A flag line the check wrote (queryFlagText). */
export const isQueryFlagText = (t: string | null | undefined): boolean =>
  !!t && t.startsWith(QUERY_FLAG_START) && /\bin BC — check (it|them) before chasing\b/.test(t.split("\n", 1)[0])
/** The all-clear line the check wrote (queryClearText). */
export const isQueryClearText = (t: string | null | undefined): boolean => !!t && t.startsWith(QUERY_CLEAR_START)

/**
 * What the check should say about a case's lots to check, given the last flag or all-clear line it
 * wrote on the case (`prev` — null for none): the new flag when it differs, the all-clear when there
 * were lots to check and now there are none, else null (nothing to write — idempotent).
 */
export function nextQueryFlag(prev: string | null | undefined, c: Pick<Candidate, "lots" | "queryLots">): string | null {
  const want = queryFlagText(c)
  if (want) return want === prev ? null : want
  return isQueryFlagText(prev) ? queryClearText() : null
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
