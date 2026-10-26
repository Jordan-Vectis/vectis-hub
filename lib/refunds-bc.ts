// Accounts → Refunds: a request's lots looked up in Business Central — READ ONLY. Server only (it
// reads BC with a token the caller got from getBCToken — the admin's OWN BC sign-in). Not a "use
// server" file: lib/actions/refunds.ts (lotsFromBc) checks the admin and the request, then asks here.
//
// One read of Auction_Lines_Excel: the buyer's lots in the request's sale (EVA_AuctionNo) or, with no
// sale code, at the request's auction date (EVA_AuctionDate). Sold lots only (hammer over £0, not
// withdrawn). Lots whose number is on the request ("808 & 809") are kept; with none given, all of
// them. Each becomes a PROPOSAL — hammer, 27% commission, description, unique ID, sale — that the
// admin can use on the Lots & money card; nothing is saved until they press Save there.
// ⚠ Nothing is ever written to BC. ⚠ Only fields verified on Auction_Lines_Excel go in the $select
// (one unverified field and BC answers 400 to the whole request — RULES.md, BC field names).

import { bcFetchAll } from "@/lib/bc"
import { commissionFor, type RefundLotRow } from "@/lib/refunds"
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

/** A lot BC shows sold to the buyer — what the Lots & money card offers to use. */
export type RefundBcProposal = Omit<RefundLotRow, "id"> & { saleName: string | null; auctionDate: string | null }

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
      description: str(r.EVA_ShortDescription).slice(0, 300) || null,
      hammerPence,
      commissionPence: commissionFor(hammerPence),
      basis: "percent",
      percent: null,
      setAmountPence: null,
      amountPence: null,
      fromBc: true,
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
    return {
      lots: sold,
      note: say(
        `The request doesn't give lot numbers BC can match, so every lot BC shows sold to ${who} in ${inWords} is offered (${plural(sold.length, "lot")}) — untick the ones it isn't about.`,
        unsoldLine,
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
  return {
    lots: picked,
    note: say(
      `BC shows ${plural(picked.length, "lot")} sold to ${who} in ${inWords} matching the request (${picked.map((l) => l.lotNo).join(", ")}).`,
      missing.length > 0 && `Not found in BC: ${missing.join(", ")} — check the lot numbers.`,
      unsoldLine,
    ),
  }
}
