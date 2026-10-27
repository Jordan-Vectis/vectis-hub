// Accounts → Refunds: a request's lots looked up in Business Central — READ ONLY. Server only (it
// reads BC with a token the caller got from getBCToken — the admin's OWN BC sign-in). Not a "use
// server" file: lib/actions/refunds.ts (lotsFromBc, lookUpRefundLots) checks the admin and the
// request, then asks here.
//
// "Fill from BC" (findRefundLotsInBc) — one read of Auction_Lines_Excel: the buyer's lots in the
// request's sale (EVA_AuctionNo) or, with no sale code, at the request's auction date
// (EVA_AuctionDate). Sold lots only (hammer over £0, not withdrawn). Lots whose number is on the
// request ("808 & 809") are kept; with none given, all of them. Each becomes a PROPOSAL — hammer, 27%
// commission, description, unique ID, sale, barcode, receipt — that the admin can use on the Lots &
// money card; nothing is saved until they press Save there.
//
// One lot by its sale and number (lookUpLotsInBc — Jack, 2026-10-26: "when the lot number and the
// sale has been filled in, the barcode number and receipt number pull in with it along with hammer
// price"): Auction_Lines_Excel for the sale's lot (hammer, unique ID, description, buyer), then
// Receipt_Lines_Excel for that unique ID (receiptRefsFor: the Internal Barcode — the one for THAT
// sale, a lot gets a new barcode each sale it goes into — and the receipt number).
// ⚠ Nothing is ever written to BC. ⚠ Only fields verified on each endpoint go in its $select (one
// unverified field and BC answers 400 to the whole request — RULES.md, BC field names).

import { bcFetchAll } from "@/lib/bc"
import { commissionFor, formatPence, isSaleCode, type RefundLotRow } from "@/lib/refunds"
import { formatDay } from "@/lib/uncollected"
import { bcDay, bcTrue, lotNoOf, odataString } from "@/lib/uncollected-feed-match"

/** Verified on Auction_Lines_Excel (2026-10-22, the BC API viewer). */
const LOT_SELECT = [
  "EVA_AuctionNo", "EVA_AuctionName", "EVA_AuctionDate", "EVA_UniqueID", "EVA_LotNo", "EVA_LotSuffix",
  "EVA_ShortDescription", "EVA_HammerPrice", "EVA_BuyerNo", "EVA_WithdrawLot",
].join(",")

/** A buyer or sale number fit to ask BC about (BC's numbers are letters, digits, - _ / .). */
export const BC_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9\-_/.]{0,39}$/

/** The most lots read for one buyer on one day when BC refuses the buyer filter and the whole sale or
 *  day has to be read instead (a big sale is a few thousand lines). */
const FALLBACK_MAX_ROWS = 12_000

/** A lot BC shows sold to the buyer — what the Lots & money card offers to use. `refsRead` false when
 *  its receipt line couldn't be read (so the barcode is worth asking for again). */
export type RefundBcProposal = Omit<RefundLotRow, "id"> & { saleName: string | null; auctionDate: string | null; refsRead: boolean }

export type RefundBcAsk = {
  /** The C-number — BC's EVA_BuyerNo. */
  customerNo: string
  saleCode: string | null
  /** YYYY-MM-DD, used only when there's no sale code. */
  auctionDate: string | null
  lotsText: string | null
}

export type RefundBcFound = { lots: RefundBcProposal[]; note: string }

const str = (v: unknown): string => (v == null ? "" : String(v)).trim()
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`

/**
 * The lot numbers in a request's lots box: "808" → [808]; "808 & 809" → [808, 809]; "123, 124 & 125";
 * "Lots 366A and 367"; a short range "120-125" (at most 50 lots) → each of them. Leading zeros dropped,
 * suffixes upper case. Ignores money (£45), percentages, dates (14/01/26) and barcodes (F012345 —
 * glued to a letter). [] when there are none ("N/A", a sentence with no numbers).
 */
export function lotNumbersFrom(text: string | null | undefined): string[] {
  const s = str(text).toUpperCase()
  if (!s) return []
  const out: string[] = []
  const add = (n: string) => {
    const t = n.replace(/^0+(?=\d)/, "")
    if (t && !/^0+[A-Z]?$/.test(t) && !out.includes(t)) out.push(t)
  }
  const rest = s.replace(/(?<![\w£$.\/-])(\d{1,5})\s*(?:-|–|TO)\s*(\d{1,5})(?![\w.\/%-])/g, (m, a: string, b: string) => {
    const x = Number(a), y = Number(b)
    if (y <= x || y - x > 50) return m
    for (let i = x; i <= y; i++) add(String(i))
    return " "
  })
  for (const m of rest.matchAll(/(?<![\w£$.\/-])(\d{1,5})([A-Z])?(?![\w.\/%-])/g)) add(`${m[1]}${m[2] ?? ""}`)
  return out
}

/** A number from the request matches BC's lot: exactly, or — when the request gave no suffix — the
 *  same number with one ("366" finds 366A; they're proposals, the admin takes out any that aren't it). */
function sameLot(wanted: string, bc: string): boolean {
  if (wanted === bc) return true
  return /\d$/.test(wanted) && bc.replace(/[A-Z]+$/, "") === wanted
}

const byLot = (a: RefundBcProposal, b: RefundBcProposal) =>
  (a.saleCode ?? "").localeCompare(b.saleCode ?? "") || a.lotNo.localeCompare(b.lotNo, "en", { numeric: true })

/** Reads the rows: buyer AND sale (or day); if BC refuses the buyer filter (400), the sale (or day)
 *  alone, with the buyer picked out here. */
async function readRows(token: string, ask: RefundBcAsk, where: string): Promise<Record<string, unknown>[]> {
  const buyer = ask.customerNo.toUpperCase()
  try {
    return await bcFetchAll(token, "Auction_Lines_Excel", `EVA_BuyerNo eq ${odataString(buyer)} and ${where}`, LOT_SELECT)
  } catch (e) {
    if (!/\bBC API 400\b/.test(String((e as { message?: string })?.message ?? ""))) throw e
    const rows: Record<string, unknown>[] = await bcFetchAll(token, "Auction_Lines_Excel", where, LOT_SELECT)
    if (rows.length > FALLBACK_MAX_ROWS) throw new Error("BC wouldn't look up one buyer's lots, and the whole sale is too big to read here.")
    return rows.filter((r) => str(r.EVA_BuyerNo).toUpperCase() === buyer)
  }
}

/**
 * The lots BC shows as sold to this buyer in this sale (or at this auction date), as proposals, with
 * a sentence saying what was found and what wasn't. Throws on a BC failure (the caller words it).
 * The caller has already checked the C-number and sale look like BC's.
 */
export async function findRefundLotsInBc(token: string, ask: RefundBcAsk): Promise<RefundBcFound> {
  const sale = ask.saleCode ? ask.saleCode.toUpperCase() : null
  if (!sale && !ask.auctionDate) throw new Error("A sale code or an auction date is needed.")
  // ⚠ A date is unquoted in BC's OData filters (EVA_AuctionDate eq 2026-01-14), a code is quoted.
  const where = sale ? `EVA_AuctionNo eq ${odataString(sale)}` : `EVA_AuctionDate eq ${ask.auctionDate}`
  const inWords = sale ?? `the sale on ${formatDay(`${ask.auctionDate}T12:00:00Z`)}`
  const rows = await readRows(token, ask, where)

  let unsold = 0
  const sold: RefundBcProposal[] = []
  for (const r of rows) {
    const hammer = Number(r.EVA_HammerPrice ?? 0)
    if (!Number.isFinite(hammer) || hammer <= 0 || bcTrue(r.EVA_WithdrawLot)) { unsold++; continue }
    const lotNo = lotNoOf(r.EVA_LotNo, r.EVA_LotSuffix)
    if (!lotNo) { unsold++; continue }
    const hammerPence = Math.round(hammer * 100)
    sold.push({
      saleCode: str(r.EVA_AuctionNo).toUpperCase() || sale,
      saleName: str(r.EVA_AuctionName) || null,
      auctionDate: bcDay(r.EVA_AuctionDate) || null,
      lotNo,
      uniqueId: str(r.EVA_UniqueID) || null,
      barcode: null,
      receiptNo: null,
      description: str(r.EVA_ShortDescription).slice(0, 300) || null,
      hammerPence,
      commissionPence: commissionFor(hammerPence),
      basis: "percent",
      percent: null,
      setAmountPence: null,
      amountPence: null,
      fromBc: true,
      hammerFromBc: true,
      descriptionFromBc: true,
      refsRead: true,
    })
  }
  sold.sort(byLot)

  const who = ask.customerNo.toUpperCase()
  const unsoldLine = unsold
    ? `${plural(unsold, "other lot")} of theirs there ${unsold === 1 ? "wasn't" : "weren't"} sold (withdrawn or no hammer), so ${unsold === 1 ? "isn't" : "aren't"} offered.`
    : null
  const say = (...parts: (string | null | false)[]) => parts.filter(Boolean).join(" ")
  if (!sold.length) {
    return {
      lots: [],
      note: say(
        `BC shows no lots sold to ${who} in ${inWords}.`,
        unsoldLine,
        `Check the C-number and the ${sale ? "sale code" : "auction date"} on the request — nothing was changed.`,
      ),
    }
  }

  const wanted = lotNumbersFrom(ask.lotsText)
  if (!wanted.length) {
    const refsLine = await withReceiptRefs(token, sold)
    return {
      lots: sold,
      note: say(
        `The request doesn't give lot numbers BC can match, so every lot BC shows sold to ${who} in ${inWords} is offered (${plural(sold.length, "lot")}) — untick the ones it isn't about.`,
        unsoldLine,
        refsLine,
      ),
    }
  }
  const picked = sold.filter((l) => wanted.some((w) => sameLot(w, l.lotNo)))
  const missing = wanted.filter((w) => !sold.some((l) => sameLot(w, l.lotNo)))
  if (!picked.length) {
    return {
      lots: [],
      note: say(
        `None of the lots on the request (${wanted.join(", ")}) are among the ${plural(sold.length, "lot")} BC shows sold to ${who} in ${inWords}.`,
        "Check the lot numbers, the C-number and the sale — nothing was changed.",
      ),
    }
  }
  const refsLine = await withReceiptRefs(token, picked)
  return {
    lots: picked,
    note: say(
      `BC shows ${plural(picked.length, "lot")} sold to ${who} in ${inWords} matching the request (${picked.map((l) => l.lotNo).join(", ")}).`,
      missing.length > 0 && `Not found in BC: ${missing.join(", ")} — check the lot numbers.`,
      unsoldLine,
      refsLine,
    ),
  }
}

/** Fills each proposal's barcode and receipt from its receipt line, in place (`lots` are the
 *  caller's own copies). Best effort: a failed read leaves them blank and says so (the hammer and the
 *  rest still stand) — never fails the lookup. */
async function withReceiptRefs(token: string, lots: RefundBcProposal[]): Promise<string | null> {
  const ids = lots.map((l) => l.uniqueId).filter((id): id is string => !!id)
  let refs = new Map<string, ReceiptRefs>()
  let failed = false
  if (ids.length) {
    try {
      refs = await receiptRefsFor(token, ids)
    } catch (e) {
      failed = true
      console.error("refunds BC receipt lines error:", e)
    }
  }
  for (const l of lots) {
    const r = l.uniqueId ? refs.get(l.uniqueId.toUpperCase()) : undefined
    l.barcode = r ? barcodeForSale(r.barcodes, l.saleCode) : null
    l.receiptNo = receiptFor(r, l.barcode) ?? receiptOfUniqueId(l.uniqueId)
    l.refsRead = !failed
  }
  return failed ? "BC's receipt lines couldn't be read just now, so the barcodes aren't filled in — the rest is." : null
}

// ─── Barcodes and receipts (Receipt_Lines_Excel) ────────────────────────────────────────────

/** Verified on Receipt_Lines_Excel: EVA_UniqueID and PTE_InternalBarcode (live 2026-10-23 —
 *  R008018-138 → F078196, RECEIPT_LINE_SELECT in lib/uncollected-feed-match.ts); EVA_ReceiptNo is read
 *  off the same endpoint by the warehouse pages (unsold items, collections due, the receipt-lines sync). */
const RECEIPT_SELECT = "EVA_UniqueID,EVA_ReceiptNo,PTE_InternalBarcode"
/** Unique ids per Receipt_Lines_Excel call (`EVA_UniqueID eq '…' or …`). */
const IDS_PER_CALL = 20

/** A unique id's Internal Barcodes (one per sale the item has been in — distinct, upper case), the
 *  receipt each of its lines gives (by barcode), and the first receipt number any line gives. */
export type ReceiptRefs = { barcodes: string[]; receiptByBarcode: Record<string, string | null>; receiptNo: string | null }

/** The receipt number for the chosen barcode's line — else the first any of the lines gives. */
export function receiptFor(refs: ReceiptRefs | undefined, barcode: string | null): string | null {
  if (!refs) return null
  return (barcode ? refs.receiptByBarcode[barcode] : null) ?? refs.receiptNo
}

const isBc400 = (e: unknown) => /\bBC API 400\b/.test(String((e as { message?: string })?.message ?? ""))

/**
 * Each unique id's barcodes and receipt number off Receipt_Lines_Excel — keyed by the id upper case.
 * IDS_PER_CALL ids a call; if BC refuses the batched filter (400), one id at a time. An id with no
 * receipt line isn't in the answer. Throws on any other BC failure (the caller decides what it means).
 */
export async function receiptRefsFor(token: string, uniqueIds: string[]): Promise<Map<string, ReceiptRefs>> {
  const ids = [...new Map(uniqueIds.map((s) => str(s)).filter(Boolean).map((s) => [s.toUpperCase(), s])).values()]
  const out = new Map<string, ReceiptRefs>()
  const take = (rows: Record<string, unknown>[]) => {
    for (const r of rows) {
      const key = str(r.EVA_UniqueID).toUpperCase()
      if (!key) continue
      const had: ReceiptRefs = out.get(key) ?? { barcodes: [], receiptByBarcode: {}, receiptNo: null }
      const barcode = str(r.PTE_InternalBarcode).toUpperCase()
      const receipt = str(r.EVA_ReceiptNo).toUpperCase() || null
      if (barcode && !had.barcodes.includes(barcode)) had.barcodes.push(barcode)
      if (barcode && !had.receiptByBarcode[barcode]) had.receiptByBarcode[barcode] = receipt
      if (!had.receiptNo) had.receiptNo = receipt
      out.set(key, had)
    }
  }
  const ask = (part: string[]) =>
    bcFetchAll(token, "Receipt_Lines_Excel", part.map((id) => `EVA_UniqueID eq ${odataString(id)}`).join(" or "), RECEIPT_SELECT)
  let oneByOne = false
  for (let i = 0; i < ids.length; i += IDS_PER_CALL) {
    const part = ids.slice(i, i + IDS_PER_CALL)
    if (!oneByOne && part.length > 1) {
      try { take(await ask(part)); continue } catch (e) { if (!isBc400(e)) throw e; oneByOne = true }
    }
    for (const id of part) take(await ask([id]))
  }
  return out
}

/** A sale code shaped like the ones barcodes carry (F078), and a barcode that carries one (F078196). */
const SALE_SHAPED = /^[A-Z]\d{3}$/
const BARCODE_SALE = /^([A-Z]\d{3})\d/

/**
 * Of a lot's Internal Barcodes, the one for this sale. A barcode follows the sale the item went into
 * (F078380 in F078, F083155 in F083 — memory: barcodes are sale-scoped), so: the only one that starts
 * with the sale's code; else, when the item has only ever had one, that one — unless it plainly carries
 * ANOTHER sale's code (the item was re-entered and only its later line is left); else null — never a
 * guess between two.
 */
export function barcodeForSale(barcodes: string[], saleCode: string | null): string | null {
  const sale = str(saleCode).toUpperCase()
  const mine = sale ? barcodes.filter((b) => b.startsWith(sale)) : []
  if (mine.length === 1) return mine[0]
  if (mine.length || barcodes.length !== 1) return null
  const carries = BARCODE_SALE.exec(barcodes[0])?.[1]
  return sale && SALE_SHAPED.test(sale) && carries && carries !== sale ? null : barcodes[0]
}

/** "R008018-138" → "R008018": the receipt a BC unique id is numbered from — the fallback when its
 *  receipt line has no EVA_ReceiptNo. null for any other shape. */
export function receiptOfUniqueId(uniqueId: string | null | undefined): string | null {
  const m = /^([A-Z]{1,3}\d{3,9})-\d{1,6}$/i.exec(str(uniqueId))
  return m ? m[1].toUpperCase() : null
}

// ─── One lot by its sale and number ─────────────────────────────────────────────────────────

/** A lot to look up: the card row's key (to send the answer back to it), the sale (or null — then the
 *  request's auction date) and the lot number ("808", "366A"). */
export type RefundLotAsk = { key: string; saleCode: string | null; lotNo: string }

/** What BC has for one asked lot. `found` false → only `note` says why. `note` on a found lot is a
 *  caution (not sold, withdrawn, sold to someone else, BC has it with a suffix). */
export type RefundLotLookup = {
  key: string
  found: boolean
  saleCode: string | null
  saleName: string | null
  auctionDate: string | null
  lotNo: string | null
  uniqueId: string | null
  description: string | null
  /** null when BC shows no hammer (not sold). */
  hammerPence: number | null
  barcode: string | null
  receiptNo: string | null
  /** Who BC shows bought it (EVA_BuyerNo), upper case. */
  buyerNo: string | null
  /** false when BC's receipt lines couldn't be read — the barcode is worth asking for again. */
  refsRead: boolean
  note: string | null
}

export type RefundLotContext = {
  /** The request's own sale (upper case) — used for a lot row with no sale code of its own. */
  saleCode: string | null
  /** YYYY-MM-DD — used for a lot with no sale code (and no sale on the request). */
  auctionDate: string | null
  /** The request's C-number — told apart when BC shows the lot bought by someone else (buyers only). */
  customerNo: string | null
  party: "buyer" | "vendor"
}

/** "808" → { num: "808", suffix: "" }; "366a" → { num: "366", suffix: "A" }; null when it isn't a lot
 *  number BC could hold (digits, then at most two letters). Leading zeros dropped. */
export function lotParts(lotNo: string): { num: string; suffix: string } | null {
  const m = /^0*(\d{1,6})([A-Z]{0,2})$/.exec(str(lotNo).toUpperCase().replace(/\s+/g, ""))
  if (!m || m[1] === "0") return null
  return { num: String(Number(m[1])), suffix: m[2] }
}

/** Lot numbers per Auction_Lines_Excel call (`… and (EVA_LotNo eq 1 or EVA_LotNo eq 2 …)`). */
const LOTS_PER_CALL = 20

/**
 * The Auction_Lines_Excel rows for these lot numbers in a sale (or on a day). EVA_LotNo's type isn't
 * pinned down in the Hub's notes, so: as a number first (EVA_LotNo eq 808); if BC refuses that (400), as
 * text ('808'); if it refuses that too, the whole sale or day, with the lots picked out here (at most
 * FALLBACK_MAX_ROWS — a big sale is a few thousand lines).
 */
async function rowsForLots(token: string, where: string, nums: string[]): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  const wanted = new Set(nums)
  let form: "number" | "text" | "all" = "number"
  for (let i = 0; i < nums.length && form !== "all"; i += LOTS_PER_CALL) {
    const part = nums.slice(i, i + LOTS_PER_CALL)
    for (;;) {
      const lots = part.map((n) => `EVA_LotNo eq ${form === "number" ? n : odataString(n)}`).join(" or ")
      try {
        out.push(...await bcFetchAll(token, "Auction_Lines_Excel", `${where} and (${lots})`, LOT_SELECT))
        break
      } catch (e) {
        if (!isBc400(e)) throw e
        if (form === "number") { form = "text"; continue }
        form = "all"
        break
      }
    }
  }
  if (form !== "all") return out
  const rows: Record<string, unknown>[] = await bcFetchAll(token, "Auction_Lines_Excel", where, LOT_SELECT)
  if (rows.length > FALLBACK_MAX_ROWS) throw new Error("BC wouldn't look the lot numbers up on their own, and the whole sale is too big to read here.")
  return rows.filter((r) => wanted.has(lotNoOf(r.EVA_LotNo, "")))
}

const notFound = (key: string, note: string): RefundLotLookup => ({
  key, found: false, saleCode: null, saleName: null, auctionDate: null, lotNo: null, uniqueId: null, description: null,
  hammerPence: null, barcode: null, receiptNo: null, buyerNo: null, refsRead: true, note,
})

/**
 * Each asked lot as BC has it — its hammer, unique ID, description and buyer from Auction_Lines_Excel,
 * then its barcode (for that sale) and receipt from Receipt_Lines_Excel. Asks are grouped: one sale (or
 * one day, for lots with no sale) a call, LOTS_PER_CALL lots at a time. A lot with no sale and no
 * auction date on the request, or a number that isn't one, comes back not found with why. On a day with
 * the same lot number in more than one sale, the request's buyer picks it (if they bought one of them);
 * otherwise it asks for the sale rather than guess. Throws on a BC failure reading the lots (the caller
 * words it); the barcode read is best effort (blank, and said, if it fails).
 */
export async function lookUpLotsInBc(token: string, asks: RefundLotAsk[], ctx: RefundLotContext): Promise<RefundLotLookup[]> {
  const buyer = ctx.party === "buyer" ? str(ctx.customerNo).toUpperCase() || null : null
  const answers = new Map<string, RefundLotLookup>()
  type Want = { ask: RefundLotAsk; num: string; suffix: string; sale: string | null }
  const groups = new Map<string, { where: string; inWords: string; wants: Want[] }>()
  for (const ask of asks) {
    const parts = lotParts(ask.lotNo)
    if (!parts) { answers.set(ask.key, notFound(ask.key, `"${ask.lotNo}" isn't a lot number BC could have — digits, then a letter if it has one (366A).`)); continue }
    // The row's own sale; else the request's, when it's a real sale code ("N/A" never is) — else its date.
    const sale = str(ask.saleCode).toUpperCase() || (isSaleCode(ctx.saleCode) ? ctx.saleCode.trim().toUpperCase() : null)
    if (sale && !BC_CODE_RE.test(sale)) { answers.set(ask.key, notFound(ask.key, `"${sale}" doesn't look like a BC sale code (for example F118).`)); continue }
    if (!sale && !ctx.auctionDate) { answers.set(ask.key, notFound(ask.key, "Fill in the sale (for example F118) to look this lot up in BC.")); continue }
    // ⚠ A date is unquoted in BC's OData filters (EVA_AuctionDate eq 2026-01-14), a code is quoted.
    const gk = sale ? `sale:${sale}` : `day:${ctx.auctionDate}`
    const g = groups.get(gk) ?? {
      where: sale ? `EVA_AuctionNo eq ${odataString(sale)}` : `EVA_AuctionDate eq ${ctx.auctionDate}`,
      inWords: sale ?? `the sale on ${formatDay(`${ctx.auctionDate}T12:00:00Z`)}`,
      wants: [],
    }
    g.wants.push({ ask, num: parts.num, suffix: parts.suffix, sale })
    groups.set(gk, g)
  }

  const found: RefundLotLookup[] = []
  for (const g of groups.values()) {
    const rows = await rowsForLots(token, g.where, [...new Set(g.wants.map((w) => w.num))])
    for (const w of g.wants) {
      const same = rows.filter((r) => lotNoOf(r.EVA_LotNo, "") === w.num)
      let hits = same.filter((r) => str(r.EVA_LotSuffix).toUpperCase() === w.suffix)
      let suffixNote: string | null = null
      if (!hits.length && !w.suffix) {
        // "366" when BC only has 366A (or only 366A and 366B — then which is said, not guessed).
        const suffixed = [...new Set(same.map((r) => lotNoOf(r.EVA_LotNo, r.EVA_LotSuffix)))]
        if (suffixed.length === 1) { hits = same; suffixNote = `BC has it as lot ${suffixed[0]}.` }
        else if (suffixed.length > 1) { answers.set(w.ask.key, notFound(w.ask.key, `BC has more than one lot ${w.num} in ${g.inWords} (${suffixed.join(", ")}) — put the letter on the lot number.`)); continue }
      }
      if (hits.length > 1) {
        const sales = [...new Set(hits.map((r) => str(r.EVA_AuctionNo).toUpperCase()).filter(Boolean))]
        const theirs = buyer ? hits.filter((r) => str(r.EVA_BuyerNo).toUpperCase() === buyer) : []
        if (theirs.length === 1) hits = theirs
        else if (sales.length > 1) { answers.set(w.ask.key, notFound(w.ask.key, `Lot ${w.ask.lotNo.toUpperCase()} was in more than one sale on that day (${sales.join(", ")}) — fill in the sale.`)); continue }
        else {
          // One sale with the lot on more than one line (re-offered): the sold line, if there's just one.
          const soldLines = hits.filter((x) => Number(x.EVA_HammerPrice ?? 0) > 0 && !bcTrue(x.EVA_WithdrawLot))
          if (soldLines.length > 1) { answers.set(w.ask.key, notFound(w.ask.key, `BC has lot ${w.ask.lotNo.toUpperCase()} in ${g.inWords} sold more than once — look it up in BC.`)); continue }
          hits = soldLines.length ? soldLines : [hits[0]]
        }
      }
      const r = hits[0]
      if (!r) { answers.set(w.ask.key, notFound(w.ask.key, `BC has no lot ${w.ask.lotNo.toUpperCase()} in ${g.inWords} — check the sale and the lot number.`)); continue }

      const saleCode = str(r.EVA_AuctionNo).toUpperCase() || w.sale
      const lotNo = lotNoOf(r.EVA_LotNo, r.EVA_LotSuffix)
      const hammer = Number(r.EVA_HammerPrice ?? 0)
      const sold = Number.isFinite(hammer) && hammer > 0 && !bcTrue(r.EVA_WithdrawLot)
      const buyerNo = str(r.EVA_BuyerNo).toUpperCase() || null
      const notes = [suffixNote]
      if (bcTrue(r.EVA_WithdrawLot)) notes.push("BC shows it withdrawn — no hammer to refund from.")
      else if (!sold) notes.push("BC shows it unsold — no hammer.")
      else if (buyer && buyerNo && buyerNo !== buyer) notes.push(`BC shows it bought by ${buyerNo}, not ${buyer} — check the sale and the lot.`)
      const lookup: RefundLotLookup = {
        key: w.ask.key,
        found: true,
        saleCode,
        saleName: str(r.EVA_AuctionName) || null,
        auctionDate: bcDay(r.EVA_AuctionDate) || null,
        lotNo,
        uniqueId: str(r.EVA_UniqueID) || null,
        description: str(r.EVA_ShortDescription).slice(0, 300) || null,
        hammerPence: sold ? Math.round(hammer * 100) : null,
        barcode: null,
        receiptNo: receiptOfUniqueId(str(r.EVA_UniqueID)),
        buyerNo,
        refsRead: true,
        note: notes.filter(Boolean).join(" ") || null,
      }
      answers.set(w.ask.key, lookup)
      found.push(lookup)
    }
  }

  // The barcodes and receipts, in one go — best effort.
  const ids = found.map((l) => l.uniqueId).filter((id): id is string => !!id)
  if (ids.length) {
    let refs: Map<string, ReceiptRefs> | null = null
    try {
      refs = await receiptRefsFor(token, ids)
    } catch (e) {
      console.error("refunds BC receipt lines error:", e)
    }
    for (const l of found) {
      const r = refs && l.uniqueId ? refs.get(l.uniqueId.toUpperCase()) : undefined
      l.barcode = r ? barcodeForSale(r.barcodes, l.saleCode) : null
      l.receiptNo = receiptFor(r, l.barcode) ?? receiptOfUniqueId(l.uniqueId)
      l.refsRead = !!refs
      const add = (s: string) => { l.note = [l.note, s].filter(Boolean).join(" ") }
      if (!refs) add("BC's receipt lines couldn't be read just now, so the barcode isn't filled in — retype the lot number to try again.")
      else if (r && !l.barcode && r.barcodes.length) {
        add(r.barcodes.length > 1
          ? `It has had ${r.barcodes.length} barcodes (${r.barcodes.join(", ")}) and none is plainly this sale's, so none is filled in.`
          : `BC's only barcode for it (${r.barcodes[0]}) is another sale's, so it isn't filled in.`)
      }
    }
  }
  return asks.map((a) => answers.get(a.key) ?? notFound(a.key, "BC couldn't be asked about this lot."))
}

// ─── A request's sale, matched from its buyer, date and lots ────────────────────────────────

/** A request with no sale code, as the matcher is asked about it. */
export type RefundSaleAsk = {
  /** The C-number (tidied) — BC's EVA_BuyerNo for a buyer. */
  customerNo: string | null
  party: "buyer" | "vendor"
  /** YYYY-MM-DD — the auction date the request gives, or null. */
  auctionDate: string | null
  /** YYYY-MM-DD — the day it came in (with no auction date, the sale is looked for in the months before). */
  receivedAt: string
  /** The lot numbers the request is about — its lot rows' (or, with none, its lots box's). */
  lotNos: string[]
  /** The request's hammer in pence (for the old log's, the log's own figure — all its lots together),
   *  or null. What confirms a lot BC has since moved to the returns account (matchViaReturns). */
  hammerPence: number | null
  /** The auction date read the other way round, when the log's was an ambiguous slash date (5/8/2026:
   *  8 May as well as 5 August) — YYYY-MM-DD, or null. */
  otherDate: string | null
}

/** One of the request's lots as BC has it in the matched sale (`lotNo` normalised: 808, 366A). */
export type RefundSaleLot = { lotNo: string; uniqueId: string | null; description: string | null }

export type RefundSaleMatch =
  | { ok: true; saleCode: string; saleName: string | null; saleDate: string | null; how: string; lots: RefundSaleLot[] }
  | { ok: false; kind: "cant" | "none" | "ambiguous"; why: string }

/** How far back, with no auction date, a buyer's lots are looked for before the day the request came in. */
const NO_DATE_WINDOW_DAYS = 183

const dayShift = (day: string, days: number) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
const inDays = (day: string) => formatDay(`${day}T12:00:00Z`)
const soldRow = (r: Record<string, unknown>) => Number(r.EVA_HammerPrice ?? 0) > 0 && !bcTrue(r.EVA_WithdrawLot)
const saleOfRow = (r: Record<string, unknown>) => str(r.EVA_AuctionNo).toUpperCase()
const rowLot = (r: Record<string, unknown>) => lotNoOf(r.EVA_LotNo, r.EVA_LotSuffix)
const salesIn = (rows: Record<string, unknown>[]) => [...new Set(rows.map(saleOfRow).filter(Boolean))].sort()

/** "0808" → "808", "366a" → "366A" — or null when it isn't a lot number. */
export function normLotNo(lotNo: string): string | null {
  const p = lotParts(lotNo)
  return p ? `${p.num}${p.suffix}` : null
}

/** The buyer's lines in BC for a filter — or null when BC refuses the buyer filter (400). */
async function buyerRows(token: string, where: string): Promise<Record<string, unknown>[] | null> {
  try {
    return await bcFetchAll(token, "Auction_Lines_Excel", where, LOT_SELECT)
  } catch (e) {
    if (isBc400(e)) return null
    throw e
  }
}

/** The sale a barcode carries (F078196 → F078), or null when it isn't shaped like one. */
export const barcodeSaleOf = (barcode: string | null | undefined): string | null => BARCODE_SALE.exec(str(barcode).toUpperCase())?.[1] ?? null

/**
 * The one sale a request is about, from BC (READ ONLY) — or why there isn't one. Only ever ONE sale
 * that fits is taken; anything else is said, never guessed (it's run over the whole old log at once,
 * so a wrong match would quietly put the wrong sale on accounts records). It needs the buyer's
 * C-number — a date and a lot number alone fit nearly any sale that day, so those are listed instead:
 *  • with a date: their sold lots that day. With lot numbers, the one sale holding ALL of them — or,
 *    only when they bought NOTHING dated that day, the day before (a two-day sale keeps its FIRST day
 *    in BC), again all of them in one sale. With no lot numbers, the only sale they bought in that day
 *    — and none in another sale dated the day before (a two-day sale could still have been running).
 *    (If BC refuses the buyer filter, the lots on that day are read and the buyer picked out here.)
 *  • with no date: their sold lots with the request's numbers in the NO_DATE_WINDOW_DAYS before it
 *    came in — the one sale holding all of them.
 * Vendors' requests aren't matched (BC's auction lines are by buyer). matchSaleInBc (below) adds the
 * other reading of an ambiguous date, and lots BC has moved to the returns account.
 */
async function matchByBuyer(token: string, ask: RefundSaleAsk): Promise<RefundSaleMatch> {
  if (ask.party === "vendor") return { ok: false, kind: "cant", why: "a vendor's request — BC's auction lines are found by buyer" }
  const buyer = ask.customerNo && BC_CODE_RE.test(ask.customerNo) ? ask.customerNo.toUpperCase() : null
  if (!buyer) return { ok: false, kind: "cant", why: "no C-number — a date and lot number alone fit nearly any sale that day; add the C-number, then match again" }
  const wanted = [...new Set(ask.lotNos.map(normLotNo).filter((l): l is string => !!l))]
  const nums = [...new Set(wanted.map((l) => lotParts(l)!.num))]
  const lotWords = wanted.length === 1 ? `lot ${wanted[0]}` : `lots ${wanted.join(", ")}`

  /** The sales (among sold rows) holding every wanted lot. */
  const holdingAll = (sold: Record<string, unknown>[]) =>
    salesIn(sold).filter((s) => wanted.every((w) => sold.some((r) => saleOfRow(r) === s && sameLot(w, rowLot(r)))))
  /** The request's lots in a sale — only a lot number that's exactly one lot there. */
  const lotsIn = (sold: Record<string, unknown>[], sale: string): RefundSaleLot[] => {
    const out: RefundSaleLot[] = []
    for (const w of wanted) {
      const hits = sold.filter((r) => saleOfRow(r) === sale && sameLot(w, rowLot(r)))
      if (hits.length !== 1) continue
      out.push({ lotNo: w, uniqueId: str(hits[0].EVA_UniqueID) || null, description: str(hits[0].EVA_ShortDescription).slice(0, 300) || null })
    }
    return out
  }
  const found = (sold: Record<string, unknown>[], sale: string, how: string): RefundSaleMatch => {
    const first = sold.find((r) => saleOfRow(r) === sale)
    return { ok: true, saleCode: sale, saleName: str(first?.EVA_AuctionName) || null, saleDate: bcDay(first?.EVA_AuctionDate) || null, how, lots: lotsIn(sold, sale) }
  }
  /** With lot numbers: the one sale holding all of them, else why not. */
  const byLots = (sold: Record<string, unknown>[], where: string): RefundSaleMatch => {
    const fit = holdingAll(sold)
    if (fit.length === 1) return found(sold, fit[0], `the one sale ${where} holding ${lotWords}`)
    if (fit.length > 1) return { ok: false, kind: "ambiguous", why: `${lotWords} ${wanted.length === 1 ? "is" : "are"} in ${fit.length} sales ${where} (${fit.join(", ")})` }
    const some = salesIn(sold.filter((r) => wanted.some((w) => sameLot(w, rowLot(r)))))
    return some.length
      ? { ok: false, kind: "none", why: `no one sale ${where} holds all of ${lotWords} (some are in ${some.join(", ")}) — check the lot numbers` }
      : { ok: false, kind: "none", why: `BC shows none of ${lotWords} ${where}` }
  }

  if (ask.auctionDate) {
    const where = `bought by ${buyer} on ${inDays(ask.auctionDate)}`
    let rows = await buyerRows(token, `EVA_BuyerNo eq ${odataString(buyer)} and EVA_AuctionDate eq ${ask.auctionDate}`)
    let buyerFilterRefused = false
    if (!rows) {
      // BC refused the buyer filter: the request's lots on that day, the buyer picked out here.
      if (!nums.length) return { ok: false, kind: "cant", why: "BC wouldn't look the buyer's lots up, and the request gives no lot numbers" }
      buyerFilterRefused = true
      rows = (await rowsForLots(token, `EVA_AuctionDate eq ${ask.auctionDate}`, nums)).filter((r) => str(r.EVA_BuyerNo).toUpperCase() === buyer)
    }
    const sold = rows.filter(soldRow)
    const before = dayShift(ask.auctionDate, -1)
    if (!wanted.length) {
      const all = salesIn(sold)
      if (all.length > 1) return { ok: false, kind: "ambiguous", why: `${all.length} sales ${where} (${all.join(", ")}) and the request gives no lot numbers` }
      if (!all.length) return { ok: false, kind: "none", why: `BC shows no lots ${where}` }
      // A two-day sale dated the day before could still have been running that day — any other sale
      // of theirs dated then makes it more than one.
      const prev = await buyerRows(token, `EVA_BuyerNo eq ${odataString(buyer)} and EVA_AuctionDate eq ${before}`)
      if (!prev) return { ok: false, kind: "cant", why: "BC wouldn't look the buyer's lots up for the day before, to be sure it's the only sale" }
      const others = salesIn(prev.filter(soldRow)).filter((s) => s !== all[0])
      if (others.length) return { ok: false, kind: "ambiguous", why: `${buyer} bought in ${all[0]} that day and in ${others.join(", ")} dated the day before (a two-day sale) — the request gives no lot numbers to tell them apart` }
      return found(sold, all[0], `the only sale ${where}`)
    }
    const got = byLots(sold, where)
    if (got.ok) {
      // A two-day sale dated the day before could still have been running that day — if one of theirs
      // then holds all the same lots too, it's more than one sale, not this one.
      const prevDay = buyerFilterRefused
        ? (await rowsForLots(token, `EVA_AuctionDate eq ${before}`, nums)).filter((r) => str(r.EVA_BuyerNo).toUpperCase() === buyer)
        : await buyerRows(token, `EVA_BuyerNo eq ${odataString(buyer)} and EVA_AuctionDate eq ${before}`)
      if (!prevDay) return { ok: false, kind: "cant", why: "BC wouldn't look the buyer's lots up for the day before, to be sure it's the only sale" }
      const others = holdingAll(prevDay.filter(soldRow)).filter((s) => s !== got.saleCode)
      if (others.length) {
        return { ok: false, kind: "ambiguous", why: `${lotWords} ${wanted.length === 1 ? "is" : "are"} in ${got.saleCode} that day and in ${others.join(", ")} dated the day before (a two-day sale) — check which` }
      }
      return got
    }
    // The day before only when they bought NOTHING dated that day — any lot of theirs that day means it
    // was a real sale day for them, and the lot numbers just don't fit.
    if (got.kind === "ambiguous" || buyerFilterRefused || sold.length > 0) return got
    // Nothing of theirs that day: a two-day sale keeps its FIRST day in BC — the day before, all lots required.
    const prev = await buyerRows(token, `EVA_BuyerNo eq ${odataString(buyer)} and EVA_AuctionDate eq ${before}`)
    if (prev) {
      const prevSold = prev.filter(soldRow)
      const fit = holdingAll(prevSold)
      if (fit.length === 1) {
        return found(prevSold, fit[0], `the one sale bought by ${buyer} on ${inDays(before)} holding ${lotWords} — the day before the request's auction date (a two-day sale is dated by its first day)`)
      }
    }
    return got
  }

  // No date: their lots with the request's numbers in the months before it came in.
  if (!nums.length) return { ok: false, kind: "cant", why: "no auction date and no lot numbers to find the sale by" }
  const from = dayShift(ask.receivedAt, -NO_DATE_WINDOW_DAYS)
  const rows = await buyerRows(token, `EVA_BuyerNo eq ${odataString(buyer)} and (${nums.map((n) => `EVA_LotNo eq ${n}`).join(" or ")})`)
    ?? await buyerRows(token, `EVA_BuyerNo eq ${odataString(buyer)} and (${nums.map((n) => `EVA_LotNo eq ${odataString(n)}`).join(" or ")})`)
  if (!rows) return { ok: false, kind: "cant", why: "BC wouldn't look the buyer's lots up by number" }
  const recent = rows.filter((r) => { const d = bcDay(r.EVA_AuctionDate); return soldRow(r) && !!d && d >= from && d <= ask.receivedAt })
  return byLots(recent, `bought by ${buyer} in the six months before it came in`)
}

/**
 * The account BC moves a lot's buyer to once it has been refunded or returned — the customer's own
 * C-number is gone from the line after that, so the buyer's lines no longer show it. Seen on 25 of 30
 * refunded lots checked on 27 Oct 2026 (same sale, lot and hammer as the old log; buyer C000079).
 */
export const RETURNS_ACCOUNT = "C000079"

/**
 * When the buyer's own lines don't show the request's lots: the lots on the day (and on the other
 * reading of an ambiguous date), bought by the buyer OR by the returns account — and only taken when
 * the request's OWN hammer confirms them: every lot exactly once in one sale, their hammers adding up
 * to exactly the request's. One sale across all the days tried → it; more → listed. null when nothing
 * fits that way (no hammer on the request, no lot numbers, or no sale whose hammer agrees).
 */
async function matchViaReturns(token: string, ask: RefundSaleAsk, buyer: string, days: string[]): Promise<RefundSaleMatch | null> {
  if (ask.hammerPence == null || ask.hammerPence <= 0) return null
  const wanted = [...new Set(ask.lotNos.map(normLotNo).filter((l): l is string => !!l))]
  if (!wanted.length) return null
  const nums = [...new Set(wanted.map((l) => lotParts(l)!.num))]
  const lotWords = wanted.length === 1 ? `lot ${wanted[0]}` : `lots ${wanted.join(", ")}`
  const hits: { day: string; sale: string; lines: Record<string, unknown>[] }[] = []
  for (const day of days) {
    const rows = (await rowsForLots(token, `EVA_AuctionDate eq ${day}`, nums))
      .filter((r) => soldRow(r) && [buyer, RETURNS_ACCOUNT].includes(str(r.EVA_BuyerNo).toUpperCase()))
    for (const sale of salesIn(rows)) {
      const per = wanted.map((w) => rows.filter((r) => saleOfRow(r) === sale && sameLot(w, rowLot(r))))
      if (per.some((l) => l.length !== 1)) continue   // every lot, exactly once, in that one sale
      const total = per.reduce((s, l) => s + Math.round(Number(l[0].EVA_HammerPrice ?? 0) * 100), 0)
      if (total === ask.hammerPence) hits.push({ day, sale, lines: per.map((l) => l[0]) })
    }
  }
  if (!hits.length) return null
  const sales = [...new Set(hits.map((h) => h.sale))]
  if (sales.length > 1) {
    return { ok: false, kind: "ambiguous", why: `${lotWords} with the request's hammer (${formatPence(ask.hammerPence)}) are in ${sales.join(", ")} on those days — check which` }
  }
  const h = hits[0]
  const moved = h.lines.some((r) => str(r.EVA_BuyerNo).toUpperCase() === RETURNS_ACCOUNT)
  return {
    ok: true,
    saleCode: h.sale,
    saleName: str(h.lines[0].EVA_AuctionName) || null,
    saleDate: bcDay(h.lines[0].EVA_AuctionDate) || null,
    how: `${lotWords} on ${inDays(h.day)} in ${h.sale}${moved ? ` — BC now has ${wanted.length === 1 ? "it" : "them"} on the returns account (${RETURNS_ACCOUNT}) after the refund` : ""}, and the hammer (${formatPence(ask.hammerPence)}) matches the request`
      + (ask.auctionDate && h.day !== ask.auctionDate ? ` — the log's date read month-first (${inDays(h.day)}, not ${inDays(ask.auctionDate)})` : ""),
    lots: wanted.map((w, i) => ({
      lotNo: w,
      uniqueId: str(h.lines[i].EVA_UniqueID) || null,
      description: str(h.lines[i].EVA_ShortDescription).slice(0, 300) || null,
    })),
  }
}

/**
 * The one sale a request is about (see matchByBuyer for the rules) — and, when the buyer's own lines
 * that day don't show its lots, the lots on the day bought by the buyer or moved to the returns
 * account, CONFIRMED BY THE REQUEST'S OWN HAMMER (matchViaReturns). The other reading of an ambiguous
 * log date (5/8/2026 — 8 May as well as 5 August) is only ever tried that hammer-confirmed way, both
 * days together — a guessed date on its own is never enough (an empty day can just mean the lot was
 * moved to the returns account). Never more than one sale fitting is taken.
 */
export async function matchSaleInBc(token: string, ask: RefundSaleAsk): Promise<RefundSaleMatch> {
  const first = await matchByBuyer(token, ask)
  if (first.ok || first.kind !== "none" || !ask.auctionDate || !ask.customerNo) return first
  const buyer = ask.customerNo.toUpperCase()
  const other = ask.otherDate && ask.otherDate !== ask.auctionDate ? ask.otherDate : null
  const via = await matchViaReturns(token, ask, buyer, other ? [ask.auctionDate, other] : [ask.auctionDate])
  return via ?? first
}
