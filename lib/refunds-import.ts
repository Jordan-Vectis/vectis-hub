// Accounts → Refunds → the old SharePoint "Refund Log", imported once (Jack, 2026-10-26: "here is our
// current refund log … make it better with the data you have"). 424 rows, Feb–Oct 2026, saved from
// Excel as CSV.
//
// PURE — no Prisma, no Node APIs — so the scratch tests run it with tsx and the browser could too. The
// BROWSER decodes the file (Windows-1252, or UTF-8 when the file says so: import-box.tsx) and sends the
// text; lib/actions/refunds-import.ts runs parseRefundLog on the server, hashes each row's importKey
// (sha256) and writes the requests. Nothing here decides what is already in the Hub.
//
// What the file looks like (checked against the real log, 2026-10-26):
//  • Rows 1–2 are a title (",REFUND LOG 2026,,,…") and a blank row; the header is row 3 and its first
//    column is blank. Some names carry spaces ("Email ", " Hammer price "), so columns are found by
//    their TRIMMED name — never by position.
//  • "Date" is mostly 18-Feb-26, some dd/mm/yyyy (UK); "Date processed" is US M/D/YYYY (2/20/2026).
//  • Money: " £90.00 ", "£1,234.56", "NA", "N/A", "£-", "0.00", "22.86", blank (poundsToPence).
//  • Windows-1252 smart quotes, dashes and non-breaking spaces in the free text.
//
// Every request keeps its row's cells as they were (raw → "From the old log"), so nothing read wrongly
// here is lost: the staff can always see what the log said — bar one thing. ⚠ Bank or card details
// are NEVER kept (RULES: "a customer's bank details are never stored or shown"): the old Microsoft Form
// had a free comments box, so any cell that looks like it holds them has them taken out first
// (withoutBankDetails), before anything else is read from it.

import {
  REFUND_LIMITS, looksLikeBankDetails, poundsToPence,
  type RefundBasis, type RefundParty, type RefundReason, type RefundSolution, type RefundStatus,
} from "@/lib/refunds"
import { isEmailShape } from "@/lib/refunds-public"

/** The largest file the import takes, in characters (the real log is a few hundred thousand). */
export const REFUND_LOG_MAX_CHARS = 2_000_000

/** The old log's columns, by their trimmed names. "Item Type" and "Path" (SharePoint's own) are ignored. */
export const REFUND_LOG_COLUMNS = [
  "Date", "Title", "Customer ID", "Email", "Status", "Lot Number/s", "Auction Date", "Issue", "Solution", "%",
  "Hammer price", "Commission", "Postage", "Ref Code", "Total to refund", "Dealt with", "Complete for accounts",
  "Date processed",
] as const
export type RefundLogColumn = (typeof REFUND_LOG_COLUMNS)[number]

const IGNORED_COLUMNS = ["item type", "path"]

/** A row that wasn't imported, and why — `line` is the row number as Excel shows it (one row per
 *  record, even when a cell holds line breaks). */
export type RefundLogSkip = { line: number; why: string }

/** One row of the old log, read. Days are YYYY-MM-DD; money is pence. */
export type ParsedRefundRow = {
  /** The row number as Excel shows it. */
  line: number
  /** "Date" — or "Date processed" when the Date couldn't be read (receivedFromProcessed). */
  receivedAt: string
  receivedFromProcessed: boolean
  name: string
  email: string | null
  customerNo: string | null
  party: RefundParty
  /** "Lot Number/s" as written. */
  lotsText: string | null
  /** The lot numbers in it ("123, 124 & 125" → 123, 124, 125); [] for N/A, a sentence or a barcode. */
  lots: string[]
  auctionDate: string | null
  /** "Issue", smart quotes / dashes / non-breaking spaces made plain. */
  details: string | null
  reason: RefundReason
  solution: RefundSolution | null
  /** The "%" cell as written. */
  percentText: string | null
  /** One clear percentage (0–100), or null — "15% (Lot 25), 10% (Lots 28 & 416)" is null. */
  percent: number | null
  basis: RefundBasis
  /** basis "set" only: the total less postage (what the lots refunded), else the £ amount in the % cell. */
  setAmountPence: number | null
  hammerPence: number | null
  commissionPence: number | null
  postagePence: number | null
  totalPence: number | null
  refCode: string | null
  dealtWithName: string | null
  /** "Complete for accounts" has anything in it ("Complete", "Confirmed with Chris."). */
  accountsDone: boolean
  processedAt: string | null
  /** Paid when processed or complete for accounts; declined when the Solution says no refund; agreed
   *  when there's an amount; else being looked at. */
  status: Extract<RefundStatus, "paid" | "declined" | "agreed" | "looking">
  /** Agreed or being looked at, but the log says someone dealt with it ("Liv") — most of the log, which
   *  rarely filled in Date processed or Complete for accounts. The admin chooses at import whether
   *  these come in done or open (refundLogStatus). */
  dealtNotDone: boolean
  /** The row's non-empty cells by column name, as they were (only the obvious junk taken out — and any
   *  bank or card details, withoutBankDetails). */
  raw: Record<string, string>
  /** How many of its cells had bank or card details taken out (0 nearly always). */
  bankDetailsRemoved: number
  /** A fingerprint of the row — the server stores its sha256, so importing again never duplicates it. */
  importKey: string
  /** The same without the total: an imported row whose total was changed in SharePoint since still
   *  matches (refundLogMatchKey — the server refuses to import it twice). */
  matchKey: string
}

export type RefundLogParse = {
  rows: ParsedRefundRow[]
  skipped: RefundLogSkip[]
  /** false = no row looked like the old log's header (wrong file). */
  headerFound: boolean
  /** Rows exactly the same as an earlier row in the file — kept (each was its own SharePoint item). */
  repeats: number
}

/** What "Check file" answers. */
export type RefundLogPreview = {
  /** Rows read (not counting the skipped ones). */
  rows: number
  alreadyImported: number
  toImport: number
  skipped: RefundLogSkip[]
  /** The rows to import, by their own status — before the admin's choice for `dealt`. */
  byStatus: Record<string, number>
  repeats: number
  /** Rows to import whose Date couldn't be read, so they take the Date processed. */
  datesFromProcessed: number
  /** Rows to import that had bank or card details taken out (never kept in the Hub). */
  bankDetailsRemoved: number
  /** The rows to import that were dealt with but never processed (dealtNotDone): the day each came in
   *  and its own status, so the box can show what the admin's choice makes of them (refundLogStatus). */
  dealt: { receivedAt: string; status: "agreed" | "looking" }[]
}

/** The statuses an imported request can come in with. */
export type RefundLogStatus = Extract<RefundStatus, "paid" | "declined" | "agreed" | "looking" | "closed">

/**
 * The status a row comes in with: its own — unless it was dealt with but never processed
 * (dealtNotDone), the admin chose to count those as done, and it came in before `doneBefore`
 * (YYYY-MM-DD): then Paid when it has an amount (and ticked complete for accounts, so the accounts
 * tile isn't three hundred old rows), Closed when it hasn't. `countedDone` says it was the choice,
 * not the log — the request's timeline says so too.
 */
export function refundLogStatus(
  row: { status: ParsedRefundRow["status"]; dealtNotDone: boolean; receivedAt: string },
  doneBefore: string | null,
): { status: RefundLogStatus; countedDone: boolean } {
  if (row.dealtNotDone && doneBefore && row.receivedAt < doneBefore) {
    return { status: row.status === "agreed" ? "paid" : "closed", countedDone: true }
  }
  return { status: row.status, countedDone: false }
}

/** What one import call answers (the box calls it in slices for a moving count — design rule 7b). */
export type RefundLogImported = {
  imported: number
  /** In the Hub before this call. */
  alreadyImported: number
  skipped: number
  /** New rows still to import after this call (0 = finished). */
  remaining: number
}

/** What "bring back open" finds (when only looking) or did — reopenCountedDone. */
export type RefundLogReopen = {
  /** Imported requests counted as done by the import's choice and untouched since (brought back open). */
  reopen: number
  /** Counted as done at import, but someone has done anything to them since — left alone. */
  changedSince: number
  /** Brought back open already, by an earlier press. */
  alreadyReopened: number
}

// ─── Text ───────────────────────────────────────────────────────────────────────────────────

/** Smart quotes, dashes, non-breaking and zero-width spaces made plain; the decoder's replacement
 *  character and C0/C1 control characters (bar tab and line breaks) dropped; "Â£" (UTF-8 read as
 *  Windows-1252) back to "£". */
export function plainText(s: string): string {
  return s
    .replace(/Â(?=[ £])/g, "")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[  -   　]/g, " ")
    .replace(/[​-‍⁠﻿�]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
}

/** One line: plain, every run of spaces and line breaks to one space, trimmed. */
const oneLine = (s: string) => plainText(s).replace(/\s+/g, " ").trim()

/** Several lines: plain, Windows line ends tidied, trailing spaces off each line, no run of blank lines. */
function prose(s: string): string {
  return plainText(s.replace(/\r\n?/g, "\n"))
    .replace(/\t/g, " ")
    .split("\n").map((l) => l.replace(/ {2,}/g, " ").trimEnd()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** "N/A", "NA", "-", "none" — the log's ways of saying nothing. */
const NOTHING = /^(n\/?a|none|nil|-+|\.)$/i
const orNull = (s: string, max: number): string | null => (s && !NOTHING.test(s) ? s.slice(0, max) : null)

/** For the fingerprint: plain, one line, lower case. */
const norm = (s: string | undefined) => oneLine(s ?? "").toLowerCase()

// ─── Bank and card details ──────────────────────────────────────────────────────────────────

/** What bank or card details in the old log are replaced with. */
export const BANK_DETAILS_REMOVED = "[bank details removed]"
const REMOVED_RUN = /\[bank details removed\](?:[\s,.;:/-]*\[bank details removed\])+/g
/** The words that make a 2-2-2 group a sort code even when it could be a date (as lib/uncollected). */
const ACCOUNT_WORD = /\b(?:a\/c|acc|acct|account)\b/i

/**
 * One cell with any bank or card details taken out — the shapes looksLikeBankDetails refuses in a
 * typed box: "sort code" or "IBAN" and what follows, an account number after its word, a sort code
 * beside an 8-digit number, a card number. A cell that doesn't look like it has any is returned as it
 * was (smart quotes and all); one that does is made plain first (so "20–00–00" reads like 20-00-00).
 * Whatever still looks like bank details once the known shapes are out, the whole cell goes — nothing
 * that trips the check is ever kept. `removed` = the cell was changed.
 */
export function withoutBankDetails(cell: string): { text: string; removed: boolean } {
  const plain = plainText(cell)
  if (!looksLikeBankDetails(cell) && !looksLikeBankDetails(plain)) return { text: cell, removed: false }
  const R = BANK_DETAILS_REMOVED
  let s = plain
    .replace(/\biban\b[\s:.#-]*(?:[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){8,30})?/gi, R)
    .replace(/\bsort\s*code\b[\s:.#-]*(?:\d{2}[\s-]?\d{2}[\s-]?\d{2}\b)?/gi, R)
    .replace(/\b(?:a\/c|acc|acct|account)(?:\s*(?:no|number|num)\b\.?)?[\s:#.-]*\d{6,10}\b/gi, R)
  // A sort code beside an 8-digit number, either way round — a 2-2-2 that reads as a date only with an
  // account word in the cell (the same rule as the check).
  s = s.replace(/\b(\d{2})-(\d{2})-\d{2}\b\D{0,30}\b\d{8}\b|\b\d{8}\b\D{0,30}\b(\d{2})-(\d{2})-\d{2}\b/g, (m, a1, b1, a2, b2) => {
    const a = Number(a1 ?? a2), b = Number(b1 ?? b2)
    return a >= 1 && a <= 31 && b >= 1 && b <= 12 && !ACCOUNT_WORD.test(plain) ? m : R
  })
  // A card number: a run of digit groups the check reads as one.
  s = s.replace(/\d(?:[ -]?\d)+/g, (run) => (looksLikeBankDetails(run) ? R : run)).replace(REMOVED_RUN, R)
  if (looksLikeBankDetails(s)) s = `${R} (the whole cell looked like bank or card details)`
  return { text: s, removed: true }
}

// ─── CSV ────────────────────────────────────────────────────────────────────────────────────

/**
 * RFC 4180: cells split on commas, a cell in double quotes may hold commas, line breaks and doubled
 * quotes (""). Records end at \r\n, \n or a lone \r; a line break inside quotes is kept as \n. A
 * quote in the middle of an unquoted cell (12" figure) is just a character. Blank records are kept,
 * so record n is Excel's row n. `unclosed` = the record where a quote never closed (the file is cut
 * short), or null.
 */
export function csvRecords(text: string): { records: string[][]; unclosed: number | null } {
  const records: string[][] = []
  let row: string[] = []
  let cell = ""
  let inQuotes = false
  let quoted = false
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
  const n = text.length
  for (; i < n; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else inQuotes = false
      } else if (c === "\r") {
        cell += "\n"
        if (text[i + 1] === "\n") i++
      } else cell += c
      continue
    }
    if (c === '"' && !quoted && cell.trim() === "") { inQuotes = true; quoted = true; cell = ""; continue }
    if (c === ",") { row.push(cell); cell = ""; quoted = false; continue }
    if (c === "\r" || c === "\n") {
      row.push(cell)
      records.push(row)
      row = []; cell = ""; quoted = false
      if (c === "\r" && text[i + 1] === "\n") i++
      continue
    }
    cell += c
  }
  const unclosed = inQuotes ? records.length + 1 : null
  if (cell !== "" || quoted || row.length) { row.push(cell); records.push(row) }
  return { records, unclosed }
}

// ─── Dates ──────────────────────────────────────────────────────────────────────────────────

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
const pad = (n: number) => String(n).padStart(2, "0")

/** "Feb", "Sept", "February" → 2; anything else null (at least three letters of a month's name). */
function monthOf(word: string): number | null {
  const w = word.toLowerCase().replace(/\.$/, "")
  if (w.length < 3) return null
  const i = MONTHS.findIndex((m) => m.startsWith(w))
  return i < 0 ? null : i + 1
}

/** "26" → 2026, "2026" → 2026. */
const fullYear = (y: string) => (y.length <= 2 ? 2000 + Number(y) : Number(y))

/** A real calendar day, 2000–2100, as YYYY-MM-DD — or null. */
function dayOf(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || y < 2000 || y > 2100) return null
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null
}

/** A time Excel may have added after the day ("18/02/2026 00:00", "2/20/2026 3:15 PM"). */
const TIME = String.raw`(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?m\.?)?)?`
const WORD_DAY = new RegExp(String.raw`^(\d{1,2})(?:st|nd|rd|th)?[-\s./]+([A-Za-z]{3,9}\.?)[-\s./,]+(\d{4}|\d{2})${TIME}$`, "i")
const NUMBER_DAY = new RegExp(String.raw`^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})${TIME}$`, "i")
const ISO_DAY = new RegExp(String.raw`^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$`)

/**
 * One cell that should be a single day: 18-Feb-26, 5-Mar-2026, 18 February 2026, 18/02/2026, 2026-02-18.
 * A numbers-only day is read `order` first — "dmy" (UK, the Date column) or "mdy" (US, Date processed)
 * — and the other way round only when that can't be a real day (20/2/2026 in the US column). null for
 * anything else ("NA", a sentence).
 */
export function readDay(cell: string | undefined, order: "dmy" | "mdy"): string | null {
  const s = oneLine(cell ?? "")
  if (!s) return null
  let m = WORD_DAY.exec(s)
  if (m) {
    const month = monthOf(m[2])
    return month ? dayOf(fullYear(m[3]), month, Number(m[1])) : null
  }
  m = NUMBER_DAY.exec(s)
  if (m) {
    const a = Number(m[1]), b = Number(m[2]), y = fullYear(m[3])
    return order === "dmy" ? (dayOf(y, b, a) ?? dayOf(y, a, b)) : (dayOf(y, a, b) ?? dayOf(y, b, a))
  }
  m = ISO_DAY.exec(s)
  return m ? dayOf(Number(m[1]), Number(m[2]), Number(m[3])) : null
}

const ANY_WORD_DAY = /\b(\d{1,2})(?:st|nd|rd|th)?[-\s./]+([A-Za-z]{3,9})\.?[-\s./,]+(\d{4}|\d{2})\b/gi
const ANY_NUMBER_DAY = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g
const ANY_ISO_DAY = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g

/** The FIRST real day anywhere in a cell ("14-Jan-26 & 21-Jan-26", "sale of 14/01/2026"), numbers
 *  read UK day first; null when there is none ("N/A", blank). */
export function firstDayIn(cell: string | undefined): string | null {
  const s = oneLine(cell ?? "")
  if (!s) return null
  const found: { at: number; day: string }[] = []
  for (const m of s.matchAll(ANY_WORD_DAY)) {
    const month = monthOf(m[2])
    const day = month ? dayOf(fullYear(m[3]), month, Number(m[1])) : null
    if (day) found.push({ at: m.index ?? 0, day })
  }
  for (const m of s.matchAll(ANY_NUMBER_DAY)) {
    const a = Number(m[1]), b = Number(m[2]), y = fullYear(m[3])
    const day = dayOf(y, b, a) ?? dayOf(y, a, b)
    if (day) found.push({ at: m.index ?? 0, day })
  }
  for (const m of s.matchAll(ANY_ISO_DAY)) {
    const day = dayOf(Number(m[1]), Number(m[2]), Number(m[3]))
    if (day) found.push({ at: m.index ?? 0, day })
  }
  found.sort((x, y) => x.at - y.at)
  return found[0]?.day ?? null
}

// ─── The cells ──────────────────────────────────────────────────────────────────────────────

/**
 * The lot numbers in "Lot Number/s": split on &, commas, "and", "/", "+" and ";" — "808", "808 & 809",
 * "123, 124 & 125", "Lots 28 & 416", "366A", "12-14" (a short run). [] when any part isn't a lot
 * number — N/A, a sentence, a barcode (F012345), a date — the lots stay as written in lotsText.
 */
export function parseLotNumbers(text: string | undefined): string[] {
  const s = oneLine(text ?? "")
  if (!s || NOTHING.test(s) || /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(s)) return []
  const parts = s.split(/\s*(?:&|,|\+|;|\/|\band\b)\s*/i).map((p) => p.trim()).filter(Boolean)
  const out: string[] = []
  const add = (lot: string) => { if (!out.includes(lot)) out.push(lot) }
  for (const part of parts) {
    const p = part.replace(/^(?:lot\s*no\.?|lots?|no\.?|#)\s*:?\s*/i, "").trim()
    const one = /^(\d{1,5})\s?([A-Za-z])?$/.exec(p)
    if (one) { add(String(Number(one[1])) + (one[2] ?? "").toUpperCase()); continue }
    const run = /^(\d{1,5})\s*(?:-|to)\s*(\d{1,5})$/i.exec(p)
    if (run) {
      const from = Number(run[1]), to = Number(run[2])
      if (to <= from || to - from >= REFUND_LIMITS.lots) return []
      for (let n = from; n <= to; n++) add(String(n))
      continue
    }
    return []
  }
  return out.slice(0, REFUND_LIMITS.lots)
}

/** "C201384" (or "c 201384") from the Customer ID cell — the same rule as tidyCustomerNo on the server
 *  — or the first C-number written in it; null otherwise. */
function customerNoOf(cell: string): string | null {
  const s = oneLine(cell).toUpperCase().replace(/\s+/g, "")
  if (/^[A-Z]\d{3,9}$/.test(s)) return s
  const m = /\bC\s?(\d{3,9})\b/i.exec(oneLine(cell))
  return m ? `C${m[1]}` : null
}

/** The (first) email address in the Email cell, or null — "N/A", a name, nothing. Only an address that
 *  passes the public form's check (isEmailShape): nothing that could add a Bcc to a mailto: link. */
function emailOf(cell: string): string | null {
  const m = /[^\s@,;:/<>()[\]"']+@[^\s@,;:/<>()[\]"']+\.[^\s@,;:/<>()[\]"']+/.exec(oneLine(cell).replace(/mailto:/gi, ""))
  const s = m?.[0].replace(/\.+$/, "") ?? ""
  return s && isEmailShape(s) ? s : null
}

const partyOf = (cell: string): RefundParty => (/\b(vendor|seller|consignor)\b/i.test(cell) ? "vendor" : "buyer")

/** Why, from what happened and what was done — the first that fits, in this order. */
export function reasonFrom(issue: string, solution: string): RefundReason {
  const t = oneLine(`${issue} ${solution}`).toLowerCase()
  if (/\blost\b/.test(t) && /\bwarehouse\b/.test(t)) return "lost_in_warehouse"
  if (/\blost\b|never\s+(arrived|received|came|turned up)|not\s+(yet\s+)?(been\s+)?(arrived|received|delivered)|(hasn't|has not|haven't|have not|didn't|did not)\s+(yet\s+)?(arrive|receive|been received|been delivered)/.test(t)) return "lost_in_transit"
  if (/\bmissing\b/.test(t)) return "missing_parts"
  if (/damage|\bbroken\b|\bbroke\b|smashed|cracked|snapped|crushed|shattered/.test(t)) return "damaged_in_transit"
  if (/described|description|\bnot as\b|wrong\s+item|photo/.test(t)) return "described_incorrectly"
  if (/already\s+sold|no\s+longer|not\s+available|unavailable/.test(t)) return "not_available"
  return "other"
}

const NO_REFUND = /\b(?:no|not|without|never)\s+(?:a\s+|any\s+)?refund|\brefunds?\s+(?:was\s+|is\s+|has\s+been\s+)?(?:declined|refused|rejected|denied|not\b)|\b(?:declined|refused|rejected|denied)\b/

/** The Solution cell says there wasn't one: "No refund", "Refund declined", "Declined - no refund",
 *  "Not refunded". A payout is still a payout ("No refund - payout to the vendor"). */
export function saysNoRefund(cell: string): boolean {
  const t = oneLine(cell).toLowerCase()
  return !!t && !/pay\s*-?\s*out/.test(t) && NO_REFUND.test(t)
}

/** Refund, return or payout, from the Solution cell — "Payout/Refund" and "made unsold … payout" are
 *  payouts; a return is the item coming back first. null when it says none of them, or says there was
 *  no refund (saysNoRefund — that row comes in Declined). */
export function solutionFrom(cell: string): RefundSolution | null {
  const t = oneLine(cell).toLowerCase()
  if (!t) return null
  if (/pay\s*-?\s*out/.test(t)) return "payout"
  if (saysNoRefund(t)) return null
  if (/^return/.test(t)) return "return"
  if (/^refund/.test(t)) return "refund"
  if (/\breturn/.test(t) && !/\b(no|not|without)\s+(need\s+to\s+)?return/.test(t)) return "return"
  if (/\brefund/.test(t)) return "refund"
  return null
}

/**
 * The "%" cell: one clear percentage ("20%", "10% (Hammer Only)", "Full hammer" → 100, "1/3rd" →
 * 33.33), or null for none or a mix ("15% (Lot 25), 10% (Lots 28 & 416)"). The basis: "set" for a
 * set amount or a £ figure, "hammer_only" for hammer / price only, else "percent".
 */
export function percentFrom(cell: string): { percent: number | null; basis: RefundBasis } {
  const t = oneLine(cell).toLowerCase()
  const basis: RefundBasis = /set\s*amount/.test(t) || t.includes("£") ? "set" : /(hammer|price)\s*only/.test(t) ? "hammer_only" : "percent"
  if (!t) return { percent: null, basis }
  const values = [...new Set([...t.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => Number(m[1])))]
  let percent: number | null = null
  if (values.length === 1) percent = values[0]
  else if (values.length === 0) {
    if (/\bfull\b/.test(t)) percent = 100
    else if (/\b1\s*\/\s*3(rd)?\b|\bone[\s-]third\b|\ba\s+third\b/.test(t)) percent = 33.33
    else if (/\b1\s*\/\s*2\b|\bhalf\b/.test(t)) percent = 50
  }
  return { percent: percent != null && percent >= 0 && percent <= 100 ? percent : null, basis }
}

/** A money cell to pence: poundsToPence after the decoder's junk is taken out. */
const pence = (cell: string): number | null => poundsToPence(plainText(cell).replace(/\bGBP\b/gi, ""))

/** "packing" → "Packing", "liv" → "Liv" (a name typed all in lower case); anything else as written. */
function dealtWithOf(cell: string): string | null {
  const s = orNull(oneLine(cell), REFUND_LIMITS.name)
  if (!s) return null
  return s === s.toLowerCase() ? s.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s
}

// ─── The fingerprint ────────────────────────────────────────────────────────────────────────

const KEY_VERSION = "refund-log-v1"

/** The day a row came in, from its cells: Date (UK), or Date processed (US) when that can't be read. */
function receivedOf(raw: Record<string, string>): { day: string | null; fromProcessed: boolean } {
  const d = readDay(raw["Date"], "dmy")
  if (d) return { day: d, fromProcessed: false }
  const p = readDay(raw["Date processed"], "mdy")
  return { day: p, fromProcessed: !!p }
}

/**
 * Date|Title|Email|Lot Number/s|Issue, normalised (the day read, the text plain, one line, lower
 * case) — from a row's raw cells, so the server can work it out again from a stored request's
 * importedRaw. The importKey adds the total.
 */
export function refundLogMatchKey(cells: Record<string, unknown>): string {
  const raw: Record<string, string> = {}
  for (const [k, v] of Object.entries(cells ?? {})) if (typeof v === "string") raw[k] = v
  return [KEY_VERSION, receivedOf(raw).day ?? norm(raw["Date"]), norm(raw["Title"]), norm(raw["Email"]), norm(raw["Lot Number/s"]), norm(raw["Issue"])].join("|")
}

/**
 * Sorts a file's rows against the requests already imported: in already (the same importKey), a
 * request whose row has changed in SharePoint since (refused — `changed`), or new — oldest first, so
 * their RF numbers run in the log's order. `key` is the stored form of the row's importKey (the server
 * hashes it); `existing` is every imported request's importKey and importedRaw.
 *
 * A row in the file exactly accounts for one imported request with its match key. Any left over is a
 * request whose row is no longer in the file as it was (its total changed since), so a row matching it
 * is that request again, not a new one. Counted, not just looked up: the same row twice in the file,
 * or a file imported in slices, must still bring in the second.
 */
export function sortRefundLogRows<T extends { row: ParsedRefundRow; key: string }>(
  rows: T[],
  existing: { importKey: string | null; importedRaw: unknown }[],
): { alreadyImported: number; toImport: T[]; changed: RefundLogSkip[] } {
  const keys = new Set(existing.map((r) => r.importKey).filter(Boolean))
  const byMatch = new Map<string, number>()
  const bump = (k: string, by: number) => byMatch.set(k, (byMatch.get(k) ?? 0) + by)
  for (const r of existing) {
    const raw = r.importedRaw
    if (raw && typeof raw === "object" && !Array.isArray(raw)) bump(refundLogMatchKey(raw as Record<string, unknown>), 1)
  }
  for (const p of rows) if (keys.has(p.key)) bump(p.row.matchKey, -1)

  let alreadyImported = 0
  const toImport: T[] = []
  const changed: RefundLogSkip[] = []
  for (const p of rows) {
    if (keys.has(p.key)) alreadyImported++
    else if ((byMatch.get(p.row.matchKey) ?? 0) > 0) {
      bump(p.row.matchKey, -1)
      changed.push({ line: p.row.line, why: "already imported, but changed in the old log since (the total, most likely) — not imported again; make the change in the Hub" })
    } else toImport.push(p)
  }
  toImport.sort((a, b) => (a.row.receivedAt < b.row.receivedAt ? -1 : a.row.receivedAt > b.row.receivedAt ? 1 : a.row.line - b.row.line))
  return { alreadyImported, toImport, changed }
}

// ─── The file ───────────────────────────────────────────────────────────────────────────────

/** A cell's column name as the header row is compared: trimmed, spaces collapsed, lower case. */
const headerName = (s: string) => oneLine(s).toLowerCase()
const KNOWN = new Map<string, RefundLogColumn>(REFUND_LOG_COLUMNS.map((c) => [c.toLowerCase(), c]))

/** The header row: the first with Date and Title and most of the other columns. */
function findHeader(records: string[][]): { at: number; columns: (string | null)[] } | null {
  for (let at = 0; at < records.length; at++) {
    const names = records[at].map(headerName)
    if (!names.includes("date") || !names.includes("title")) continue
    if (names.filter((n) => KNOWN.has(n)).length < 8) continue
    const seen = new Set<string>()
    const columns = records[at].map((cell) => {
      const n = headerName(cell)
      if (!n || IGNORED_COLUMNS.includes(n)) return null
      const name = KNOWN.get(n) ?? oneLine(cell)
      if (seen.has(name)) return null
      seen.add(name)
      return name
    })
    return { at, columns }
  }
  return null
}

/** A raw cell as it was: Windows line ends tidied, the decoder's replacement character, zero-width
 *  and control characters out, trimmed — smart quotes and dashes kept. */
function rawCell(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/Â(?=[ £])/g, "")
    .replace(/[​-‍⁠﻿�]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .trim()
}

/** The most of one cell kept in raw (the details box takes 4,000; this keeps the whole of any real cell). */
const RAW_CELL_MAX = 8000

/**
 * Reads the old refund log. Rows without a name, or without any day that can be read (Date, else Date
 * processed), are skipped with the reason; blank rows are passed over without one. Never throws.
 */
export function parseRefundLog(text: string): RefundLogParse {
  const { records, unclosed } = csvRecords(typeof text === "string" ? text : "")
  const header = findHeader(records)
  if (!header) return { rows: [], skipped: [], headerFound: false, repeats: 0 }

  const rows: ParsedRefundRow[] = []
  const skipped: RefundLogSkip[] = []
  const seen = new Map<string, number>()
  let repeats = 0

  for (let r = header.at + 1; r < records.length; r++) {
    const line = r + 1
    const raw: Record<string, string> = {}
    // ⚠ Bank or card details out of every cell FIRST — everything below (what happened, the
    // fingerprint, "From the old log") is read from what's left.
    let bankDetailsRemoved = 0
    header.columns.forEach((name, c) => {
      if (!name) return
      const v = rawCell(records[r][c] ?? "")
      if (!v) return
      const kept = withoutBankDetails(v)
      if (kept.removed) bankDetailsRemoved++
      raw[name] = kept.text.slice(0, RAW_CELL_MAX)
    })
    const cell = (c: RefundLogColumn) => raw[c] ?? ""
    if (!Object.keys(raw).length) continue
    if (headerName(cell("Date")) === "date" && headerName(cell("Title")) === "title") {
      skipped.push({ line, why: "the header row again — passed over" })
      continue
    }

    const name = oneLine(cell("Title")).slice(0, REFUND_LIMITS.name)
    if (!name) { skipped.push({ line, why: "no name — the Title is empty" }); continue }
    const received = receivedOf(raw)
    if (!received.day) {
      const said = oneLine(cell("Date"))
      skipped.push({ line, why: said ? `the Date ("${said.slice(0, 40)}") can't be read as a day, and there's no Date processed` : "no Date, and no Date processed" })
      continue
    }

    const { percent, basis } = percentFrom(cell("%"))
    const hammerPence = pence(cell("Hammer price"))
    const commissionPence = pence(cell("Commission"))
    const postagePence = pence(cell("Postage"))
    const totalPence = pence(cell("Total to refund"))
    const processedAt = readDay(cell("Date processed"), "mdy")
    const accountsDone = oneLine(cell("Complete for accounts")) !== ""
    const lotsText = orNull(oneLine(cell("Lot Number/s")), REFUND_LIMITS.lotsText)
    let setAmountPence: number | null = null
    if (basis === "set") {
      setAmountPence = totalPence != null
        ? Math.max(0, totalPence - (postagePence ?? 0))
        : pence((/£\s*[\d,]+(?:\.\d{1,2})?/.exec(oneLine(cell("%"))) ?? [""])[0])
    }

    const matchKey = refundLogMatchKey(raw)
    const fingerprint = `${matchKey}|${totalPence ?? ""}`
    const n = (seen.get(fingerprint) ?? 0) + 1
    seen.set(fingerprint, n)
    if (n > 1) repeats++

    const dealtWithName = dealtWithOf(cell("Dealt with"))
    const status: ParsedRefundRow["status"] = accountsDone || processedAt
      ? "paid"
      : saysNoRefund(cell("Solution")) ? "declined" : totalPence != null && totalPence > 0 ? "agreed" : "looking"

    rows.push({
      line,
      receivedAt: received.day,
      receivedFromProcessed: received.fromProcessed,
      name,
      email: emailOf(cell("Email")),
      customerNo: customerNoOf(cell("Customer ID")),
      party: partyOf(cell("Status")),
      lotsText,
      lots: parseLotNumbers(cell("Lot Number/s")),
      auctionDate: firstDayIn(cell("Auction Date")),
      details: orNull(prose(cell("Issue")), REFUND_LIMITS.details),
      reason: reasonFrom(cell("Issue"), cell("Solution")),
      solution: solutionFrom(cell("Solution")),
      percentText: orNull(oneLine(cell("%")), REFUND_LIMITS.percentText),
      percent,
      basis,
      setAmountPence,
      hammerPence,
      commissionPence,
      postagePence,
      totalPence,
      refCode: orNull(oneLine(cell("Ref Code")), REFUND_LIMITS.refCode),
      dealtWithName,
      accountsDone,
      processedAt,
      status,
      dealtNotDone: (status === "agreed" || status === "looking") && !!dealtWithName,
      raw,
      bankDetailsRemoved,
      // The same row twice in the file keeps both (each was its own SharePoint item): the second is #2.
      importKey: n > 1 ? `${fingerprint}|#${n}` : fingerprint,
      matchKey,
    })
  }

  if (unclosed != null) skipped.push({ line: unclosed, why: "a quote mark in this row never closes — the file may be cut short, so the rest of it was read as one cell" })
  skipped.sort((a, b) => a.line - b.line)
  return { rows, skipped, headerFound: true, repeats }
}
