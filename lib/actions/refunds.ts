"use server"

import { revalidatePath } from "next/cache"
import type { Prisma } from "@/app/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { getAccountsAccess } from "@/lib/accounts-auth"
import { getBCToken } from "@/lib/bc"
import { deleteObjectsFromR2 } from "@/lib/r2"
import { BC_CODE_RE, findRefundLotsInBc, lookUpLotsInBc, type RefundBcFound, type RefundLotAsk, type RefundLotLookup } from "@/lib/refunds-bc"
import { isMissingRefunds, matchCustomerId, nextRefundRef, tidyCustomerNo, writeRefundEvent } from "@/lib/refunds-server"
import { BANK_DETAILS_REFUSED, UNCOLLECTED_BC_NOT_CONNECTED, dayToStored, daysBetween, formatDay, isDay, londonDay } from "@/lib/uncollected"
import {
  CLOSED_REFUND_STATUSES, OPEN_REFUND_STATUSES, REFUND_LIMITS, REFUND_PARTY_LABELS, REFUND_PHOTO_PREFIX, REFUND_REASONS,
  REFUND_REASON_LABELS, REFUND_SOLUTION_LABELS, REFUND_SOURCES, REFUND_STATUSES, REFUND_STATUS_META, REFUNDS_ADMINS_ONLY,
  REFUNDS_NOT_READY, REFUNDS_PATH,
  commissionFor, formatPence, isRefundBasis, isRefundParty, isRefundReason, isRefundSolution, isRefundSort, isRefundStatus,
  looksLikeBankDetails, lotRefundPence, refundRefWords, refundStatusOf, refundTotalToSave,
  type RefundBasis, type RefundDetail, type RefundFilter, type RefundFilterRead, type RefundList, type RefundListItem,
  type RefundLotMoney, type RefundParty, type RefundReason, type RefundResult, type RefundSolution, type RefundSort,
  type RefundSource, type RefundStatus, type RefundTotals,
} from "@/lib/refunds"
import { isEmailShape } from "@/lib/refunds-public"

// Accounts → Refunds — every read and write the staff panel makes. SERVER ONLY.
//
//  • ADMINS ONLY (Jack, 2026-10-26): every action re-checks with getAccountsAccess() and refuses
//    anyone who isn't an admin, whatever the page showed them.
//  • Each action RETURNS { ok, error } (RefundResult) — a thrown server-action error is redacted in
//    production (RULES.md). Missing tables → { ok: false, notReady: true, error: REFUNDS_NOT_READY }
//    until Run Migrations.
//  • Every write puts a line on the request's timeline (RefundEvent, writeRefundEvent) with who did
//    it, and revalidates /tools/refunds (bar deleteRefund — see there).
//  • ⚠ Customer personal data — never bank or card details: every box is trimmed, cut to its limit
//    (REFUND_LIMITS) and refused if it looks like bank or card details (looksLikeBankDetails). The
//    timeline never keeps an old email or old notes when they're changed.
//  • ⚠ Business Central is READ ONLY. Two things here go near it — lotsFromBc ("Fill from BC") and
//    lookUpRefundLots (a row's sale + lot number → its hammer, barcode and receipt), with the admin's
//    OWN BC sign-in (getBCToken), through lib/refunds-bc.ts. They only PROPOSE; nothing is saved until
//    the admin presses Save on the Lots & money card (saveRefundLots). Nothing is ever written to BC.
//  • The money rules are lib/refunds.ts (lotRefundPence / refundTotalPence — 27% commission inc VAT);
//    the request's totalPence is worked out from its lots and postage whenever either is saved, by
//    refundTotalToSave — only ever a WHOLE total (null while a lot can't be worked out), and an
//    old-log request keeps the log's total until its lots can work out a whole one.

type Who = { id: string; name: string }

/** A message meant for the person, passed through as it is. */
class Refusal extends Error {}

const NOT_FOUND = "That request couldn't be found — it may have been deleted. Go back to the list."
const CHANGED_MEANWHILE = "Someone changed this request a moment ago — open it again to see where it stands."
const SAVE_FAILED = "Something went wrong and nothing was saved — please try again."

async function requireAdmin(): Promise<Who> {
  const { session, isAdmin } = await getAccountsAccess()
  if (!session || !isAdmin) throw new Refusal(REFUNDS_ADMINS_ONLY)
  return { id: session.user.id, name: session.user.name || session.user.email || "Unknown" }
}

type Failure = Extract<RefundResult, { ok: false }>

function fail(e: unknown, what: string, fallback: string): Failure {
  if (e instanceof Refusal) return { ok: false, error: e.message }
  if (isMissingRefunds(e)) return { ok: false, error: REFUNDS_NOT_READY, notReady: true }
  if ((e as { code?: string } | null)?.code === "P2025") return { ok: false, error: NOT_FOUND }
  console.error(`refunds ${what} error:`, e)
  return { ok: false, error: fallback }
}

const revalidate = () => revalidatePath(REFUNDS_PATH, "layout")
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)
const idOf = (id: unknown): string => {
  if (typeof id !== "string" || !id || id.length > 64) throw new Refusal(NOT_FOUND)
  return id
}

// ─── Reading what was sent ──────────────────────────────────────────────────────────────────

/** One line of text: trimmed, control characters and line breaks turned to spaces; "" → null.
 *  Refuses anything too long, or that looks like bank or card details. */
function line(v: unknown, what: string, max: number): string | null {
  if (v == null) return null
  const s = String(v).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim()
  if (!s) return null
  if (s.length > max) throw new Refusal(`${capital(what)} is too long — ${max.toLocaleString("en-GB")} characters at most.`)
  if (looksLikeBankDetails(s)) throw new Refusal(BANK_DETAILS_REFUSED)
  return s
}

/** Several lines (what happened, notes, a reason): trimmed, Windows line ends tidied, tabs to spaces;
 *  "" → null. Refuses anything too long, or that looks like bank or card details. */
function prose(v: unknown, what: string, max: number): string | null {
  if (v == null) return null
  const s = String(v).replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim()
  if (!s) return null
  if (s.length > max) throw new Refusal(`${capital(what)} is too long — ${max.toLocaleString("en-GB")} characters at most.`)
  if (looksLikeBankDetails(s)) throw new Refusal(BANK_DETAILS_REFUSED)
  return s
}

function emailOf(v: unknown): string | null {
  const s = line(v, "the email address", REFUND_LIMITS.email)
  // The public form's check (lib/refunds-public.ts) — nothing that could add a Bcc to a mailto: link.
  if (s && !isEmailShape(s)) throw new Refusal("That email address doesn't look right — check it and try again.")
  return s
}

function customerNoOf(v: unknown): string | null {
  const s = line(v, "the C-number", REFUND_LIMITS.customerNo)
  if (!s) return null
  const c = tidyCustomerNo(s)
  if (!c) throw new Refusal("That C-number doesn't look right — a letter then digits, for example C201384.")
  return c
}

function saleOf(v: unknown): string | null {
  const s = line(v, "the sale code", REFUND_LIMITS.saleCode)
  return s ? s.toUpperCase() : null
}

/** Buyer or vendor — buyer when not given. */
function partyIn(v: unknown): RefundParty {
  if (v == null || v === "") return "buyer"
  if (!isRefundParty(v)) throw new Refusal("Pick buyer or vendor.")
  return v
}

/** One of the reasons — "Something else" when not given. */
function reasonIn(v: unknown): RefundReason {
  if (v == null || v === "") return "other"
  if (!isRefundReason(v)) throw new Refusal("Pick a reason from the list.")
  return v
}

/** A date box's YYYY-MM-DD → the stored value (12:00 UTC that London day); "" → null. */
function dayOf(v: unknown, what: string, today: string, notFuture = false): Date | null {
  if (v == null || (typeof v === "string" && !v.trim())) return null
  const s = String(v).trim()
  if (!isDay(s)) throw new Refusal(`${capital(what)}: pick a date from the calendar.`)
  if (notFuture && s > today) throw new Refusal(`${capital(what)} can't be in the future.`)
  return dayToStored(s)
}

/** Whole pence, from 0 to £1,000,000; null/"" → null. */
function penceOf(v: unknown, what: string): number | null {
  if (v == null || (typeof v === "string" && !v.trim())) return null
  const n = typeof v === "number" ? v : Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 100_000_000) throw new Refusal(`${capital(what)}: pounds and pence, for example 24.30.`)
  return Math.round(n)
}

// ─── Shapes ─────────────────────────────────────────────────────────────────────────────────

/** A list row with the money and accounts columns too — for the CSV of what's shown. */
export type RefundPanelItem = RefundListItem & {
  hammerPence: number | null
  commissionPence: number | null
  postagePence: number | null
  refCode: string | null
  percentText: string | null
  accountsDoneBy: string | null
}

/** The panel's list — RefundList, with the CSV's columns on each row and the tiles' small print. */
export type RefundPanelList = Omit<RefundList, "items"> & {
  items: RefundPanelItem[]
  more: {
    /** Paid requests with a date processed in this London month, and how many of them have no total
     *  yet (so the tile's £ is a minimum — said, never hidden). */
    paidThisMonth: number
    paidThisMonthNoTotal: number
    /** How many paid requests the median days to pay is over. */
    medianOver: number
    /** Open requests from the public form flagged as suspect (the honeypot, or over the hourly limit). */
    suspectOpen: number
  }
}

/** Staff adding a request by hand (an email, a phone call, a vendor owed a payout). */
export type RefundInput = {
  name: string
  email?: string | null
  customerNo?: string | null
  party?: string | null
  saleCode?: string | null
  /** YYYY-MM-DD. */
  auctionDate?: string | null
  lotsText?: string | null
  reason?: string | null
  details?: string | null
  /** true = the admin adding it is dealing with it. */
  takeIt?: boolean
  /** Someone else dealing with it ("Liv"). */
  dealtWithName?: string | null
}

export type RefundField =
  | "name" | "email" | "customerNo" | "party" | "saleCode" | "auctionDate" | "lotsText" | "reason" | "details"
  | "solution" | "percentText" | "postagePence" | "refCode" | "notes"

/** The editable details — only the fields sent are changed; null or "" clears one (never the name). */
export type RefundPatch = Partial<{
  name: string
  email: string | null
  customerNo: string | null
  party: string
  saleCode: string | null
  /** YYYY-MM-DD. */
  auctionDate: string | null
  lotsText: string | null
  reason: string
  details: string | null
  solution: string | null
  percentText: string | null
  postagePence: number | null
  refCode: string | null
  notes: string | null
}>

/** One lot as the Lots & money card saves it. */
export type RefundLotInput = {
  saleCode?: string | null
  lotNo: string
  uniqueId?: string | null
  /** BC's Internal Barcode and receipt number — as BC gave them (lookUpRefundLots / Fill from BC). */
  barcode?: string | null
  receiptNo?: string | null
  description?: string | null
  hammerPence?: number | null
  /** null = 27% of the hammer (commissionFor). */
  commissionPence?: number | null
  basis: RefundBasis
  percent?: number | null
  setAmountPence?: number | null
  fromBc?: boolean
  /** Which box holds BC's value — a box typed in by hand is never replaced by a BC lookup. */
  hammerFromBc?: boolean
  descriptionFromBc?: boolean
  /** BC's receipt lines were read for this sale + lot (barcode found or not). */
  refsRead?: boolean
}

const FIELD_LABELS: Record<RefundField, string> = {
  name: "name", email: "email", customerNo: "C-number", party: "buyer or vendor", saleCode: "sale", auctionDate: "auction date",
  lotsText: "lots", reason: "reason", details: "what happened", solution: "solution", percentText: "% agreed",
  postagePence: "postage refunded", refCode: "ref code", notes: "notes",
}

// ─── Shaping rows for the screens ───────────────────────────────────────────────────────────

const ROW_SELECT = {
  id: true, ref: true, source: true, receivedAt: true, name: true, email: true, customerNo: true, customerId: true, party: true,
  saleCode: true, auctionDate: true, lotsText: true, reason: true, status: true, solution: true, totalPence: true,
  dealtWithName: true, processedAt: true, accountsDoneAt: true, accountsDoneBy: true, photoKeys: true, suspect: true, closedAt: true,
  hammerPence: true, commissionPence: true, postagePence: true, refCode: true, percentText: true,
} satisfies Prisma.RefundSelect

type Row = Prisma.RefundGetPayload<{ select: typeof ROW_SELECT }>

const sourceOf = (v: string): RefundSource => ((REFUND_SOURCES as readonly string[]).includes(v) ? (v as RefundSource) : "form")
const reasonOf = (v: string): RefundReason => (isRefundReason(v) ? v : "other")
const partyOf = (v: string): RefundParty => (isRefundParty(v) ? v : "buyer")
const solutionOf = (v: string | null): RefundSolution | null => (isRefundSolution(v) ? v : null)

/** London days from coming in to today — or to the day it closed (frozen). A closed request with no
 *  closed day (an old-log row) stops on its date processed, else it is counted to today. */
function daysOpenOf(r: Pick<Row, "receivedAt" | "closedAt" | "processedAt">, status: RefundStatus, today: string): number {
  const closed = CLOSED_REFUND_STATUSES.includes(status)
  const end = r.closedAt ?? (closed ? r.processedAt : null)
  return Math.max(0, daysBetween(londonDay(r.receivedAt), end ? londonDay(end) : today))
}

function toItem(r: Row, today: string): RefundPanelItem {
  const status = refundStatusOf(r.status)
  return {
    id: r.id,
    ref: r.ref,
    source: sourceOf(r.source),
    receivedAt: r.receivedAt.toISOString(),
    name: r.name,
    email: r.email,
    customerNo: r.customerNo,
    customerId: r.customerId,
    party: partyOf(r.party),
    saleCode: r.saleCode,
    auctionDate: r.auctionDate ? londonDay(r.auctionDate) : null,
    lotsText: r.lotsText,
    reason: reasonOf(r.reason),
    status,
    solution: solutionOf(r.solution),
    totalPence: r.totalPence,
    dealtWithName: r.dealtWithName,
    processedAt: iso(r.processedAt),
    accountsDoneAt: iso(r.accountsDoneAt),
    photoCount: r.photoKeys.length,
    suspect: r.suspect,
    daysOpen: daysOpenOf(r, status, today),
    hammerPence: r.hammerPence,
    commissionPence: r.commissionPence,
    postagePence: r.postagePence,
    refCode: r.refCode,
    percentText: r.percentText,
    accountsDoneBy: r.accountsDoneBy,
  }
}

/** The old log's cells as they were — always strings. */
function rawCells(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  const out: Record<string, string> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = x == null ? "" : typeof x === "string" ? x : JSON.stringify(x)
  return out
}

function lotMoney(l: { hammerPence: number | null; commissionPence: number | null; basis: string; percent: number | null; setAmountPence: number | null }): RefundLotMoney {
  return {
    hammerPence: l.hammerPence,
    commissionPence: l.commissionPence,
    basis: isRefundBasis(l.basis) ? l.basis : "percent",
    percent: l.percent,
    setAmountPence: l.setAmountPence,
  }
}

// ─── The list ───────────────────────────────────────────────────────────────────────────────

const sorters: Record<RefundSort, (a: RefundPanelItem, b: RefundPanelItem) => number> = {
  newest: (a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.ref - a.ref,
  oldest: (a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.ref - b.ref,
  amount: (a, b) => (a.totalPence == null ? (b.totalPence == null ? 0 : 1) : b.totalPence == null ? -1 : b.totalPence - a.totalPence)
    || b.receivedAt.localeCompare(a.receivedAt) || b.ref - a.ref,
  ref: (a, b) => a.ref - b.ref,
}

/** "RF0042", "rf42" or "42" → 42 (a reference); anything else null. */
const refOfWord = (w: string): number | null => {
  const m = /^(?:rf)?0*(\d{1,7})$/i.exec(w)
  return m ? Number(m[1]) : null
}

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  const m = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
  return Math.round(m * 10) / 10
}

/**
 * The panel's list: up to REFUND_LIMITS.list requests matching the filter (and the search, which is
 * never in the address bar), the count beside each status chip (every filter but the status choice)
 * and each reason chip (every filter but the reason), and the tiles' totals — over EVERY request,
 * whatever the filters. A few thousand rows a year at most, so they are read once and worked here.
 */
export async function listRefunds(filter: RefundFilter = {}): Promise<RefundResult<RefundPanelList>> {
  try {
    await requireAdmin()
    const today = londonDay()

    const picked = (Array.isArray(filter.statuses) ? filter.statuses : []).filter(isRefundStatus)
    const statuses: RefundStatus[] = picked.length ? REFUND_STATUSES.filter((s) => picked.includes(s)) : [...OPEN_REFUND_STATUSES]
    const reason = isRefundReason(filter.reason) ? filter.reason : null
    const party = isRefundParty(filter.party) ? filter.party : null
    const solution = isRefundSolution(filter.solution) ? filter.solution : null
    const accounts = filter.accounts === "todo" || filter.accounts === "done" ? filter.accounts : null
    const dealt = typeof filter.dealt === "string" && filter.dealt.trim() ? filter.dealt.trim().slice(0, 60) : null
    const sort: RefundSort = isRefundSort(filter.sort) ? filter.sort : "newest"
    const q = typeof filter.q === "string" ? filter.q.trim().slice(0, REFUND_LIMITS.search) : ""
    const read: RefundFilterRead = { statuses, reason, party, solution, accounts, dealt, sort, q }

    const rows = await prisma.refund.findMany({ select: ROW_SELECT })
    const all = rows.map((r) => toItem(r, today))

    // The filters, one by one, so each chip's count can leave its own out.
    const words = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)
    const dealtLower = dealt?.toLowerCase() ?? null
    const searchOk = (i: RefundPanelItem) => words.every((w) => {
      const ref = refOfWord(w)
      if (ref != null && i.ref === ref) return true
      return [i.name, i.email, i.customerNo, i.lotsText, i.saleCode, i.refCode].some((f) => !!f && f.toLowerCase().includes(w))
    })
    const others = (i: RefundPanelItem) =>
      (!party || i.party === party)
      && (!solution || i.solution === solution)
      && (!accounts || (accounts === "todo" ? i.status === "paid" && !i.accountsDoneAt : !!i.accountsDoneAt))
      && (!dealtLower || (i.dealtWithName ?? "").trim().toLowerCase() === dealtLower)
      && searchOk(i)
    const statusOk = (i: RefundPanelItem) => statuses.includes(i.status)
    const reasonOk = (i: RefundPanelItem) => !reason || i.reason === reason

    const statusCounts = Object.fromEntries(REFUND_STATUSES.map((s) => [s, 0])) as Record<RefundStatus, number>
    const reasonCounts = Object.fromEntries(REFUND_REASONS.map((r) => [r, 0])) as Record<RefundReason, number>
    const matchedItems: RefundPanelItem[] = []
    for (const i of all) {
      if (!others(i)) continue
      const s = statusOk(i), r = reasonOk(i)
      if (r) statusCounts[i.status]++
      if (s) reasonCounts[i.reason]++
      if (s && r) matchedItems.push(i)
    }
    matchedItems.sort(sorters[sort])

    // The tiles — every request, whatever the filters.
    const month = today.slice(0, 7)
    const totals: RefundTotals = { open: 0, new: 0, awaitingReturn: 0, toPay: 0, accountsToDo: 0, paidThisMonthPence: 0, medianDaysToPay: null }
    const more = { paidThisMonth: 0, paidThisMonthNoTotal: 0, medianOver: 0, suspectOpen: 0 }
    const toPayDays: number[] = []
    const dealers = new Map<string, string>()
    for (const i of all) {
      if (OPEN_REFUND_STATUSES.includes(i.status)) {
        totals.open++
        if (i.suspect) more.suspectOpen++
      }
      if (i.status === "new") totals.new++
      if (i.status === "awaiting_return") totals.awaitingReturn++
      if (i.status === "agreed") totals.toPay++
      if (i.status === "paid") {
        if (!i.accountsDoneAt) totals.accountsToDo++
        if (i.processedAt) {
          const paidDay = londonDay(i.processedAt)
          if (paidDay.slice(0, 7) === month) {
            more.paidThisMonth++
            if (i.totalPence == null) more.paidThisMonthNoTotal++
            else totals.paidThisMonthPence += i.totalPence
          }
          const ago = daysBetween(paidDay, today)
          if (ago >= 0 && ago <= 90) toPayDays.push(Math.max(0, daysBetween(londonDay(i.receivedAt), paidDay)))
        }
      }
      const d = (i.dealtWithName ?? "").trim()
      if (d) {
        const k = d.toLowerCase()
        const had = dealers.get(k)
        // One spelling per person ("Packing" / "packing") — a capitalised one when there is one.
        if (!had || (/^[a-z]/.test(had) && /^[A-Z]/.test(d))) dealers.set(k, d)
      }
    }
    totals.medianDaysToPay = median(toPayDays)
    more.medianOver = toPayDays.length

    return {
      ok: true,
      data: {
        items: matchedItems.slice(0, REFUND_LIMITS.list),
        matched: matchedItems.length,
        truncated: matchedItems.length > REFUND_LIMITS.list,
        statusCounts,
        reasonCounts,
        totals,
        dealers: [...dealers.values()].sort((a, b) => a.localeCompare(b, "en-GB", { sensitivity: "base" })),
        filter: read,
        today,
        more,
      },
    }
  } catch (e) {
    return fail(e, "list", "The refunds couldn't be read just now — please try again.")
  }
}

// ─── One request ────────────────────────────────────────────────────────────────────────────

export async function getRefund(id: string): Promise<RefundResult<RefundDetail>> {
  try {
    await requireAdmin()
    const r = await prisma.refund.findUnique({
      where: { id: idOf(id) },
      include: {
        lots: { orderBy: [{ position: "asc" }, { id: "asc" }] },
        events: { orderBy: [{ at: "desc" }, { id: "desc" }], take: 1000 },
      },
    })
    if (!r) throw new Refusal(NOT_FOUND)
    const today = londonDay()
    const item = toItem(r, today)
    return {
      ok: true,
      data: {
        ...item,
        details: r.details,
        percentText: r.percentText,
        hammerPence: r.hammerPence,
        commissionPence: r.commissionPence,
        postagePence: r.postagePence,
        refCode: r.refCode,
        dealtWithId: r.dealtWithId,
        accountsDoneBy: r.accountsDoneBy,
        notes: r.notes,
        photoKeys: r.photoKeys,
        lots: r.lots.map((l) => {
          const money = lotMoney(l)
          return {
            id: l.id, saleCode: l.saleCode, lotNo: l.lotNo, uniqueId: l.uniqueId, barcode: l.barcode, receiptNo: l.receiptNo,
            description: l.description,
            ...money, amountPence: lotRefundPence(money), fromBc: l.fromBc,
            hammerFromBc: l.hammerFromBc, descriptionFromBc: l.descriptionFromBc, refsRead: l.refsRead,
          }
        }),
        events: r.events.map((e) => ({ id: e.id, kind: e.kind, text: e.text, byName: e.byName, at: e.at.toISOString() })),
        importedRaw: rawCells(r.importedRaw),
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      },
    }
  } catch (e) {
    return fail(e, "get", "That request couldn't be read just now — please try again.")
  }
}

// ─── Adding one by hand ─────────────────────────────────────────────────────────────────────

/** Staff adding a request by hand. Only the name is needed. It starts at "Being looked at" when
 *  someone is dealing with it, else "New". */
export async function createRefund(input: RefundInput): Promise<RefundResult<{ id: string; ref: number }>> {
  try {
    const who = await requireAdmin()
    if (!input || typeof input !== "object") throw new Refusal("Type the customer's name.")
    const today = londonDay()
    const name = line(input.name, "the name", REFUND_LIMITS.name)
    if (!name) throw new Refusal("Type the customer's name.")
    const email = emailOf(input.email)
    const customerNo = customerNoOf(input.customerNo)
    const party = partyIn(input.party)
    const saleCode = saleOf(input.saleCode)
    const auctionDate = dayOf(input.auctionDate, "the auction date", today)
    const lotsText = line(input.lotsText, "the lots", REFUND_LIMITS.lotsText)
    const reason = reasonIn(input.reason)
    const details = prose(input.details, "what happened", REFUND_LIMITS.details)
    const other = line(input.dealtWithName, "who's dealing with it", 60)
    const dealer = input.takeIt ? { id: who.id, name: who.name } : other ? { id: other.toLowerCase() === who.name.toLowerCase() ? who.id : null, name: other } : null

    const customerId = await matchCustomerId(customerNo)
    const created = await prisma.$transaction(async (tx) => {
      // The number under its advisory lock, in the same transaction as the insert.
      const ref = await nextRefundRef(tx)
      const r = await tx.refund.create({
        data: {
          ref, source: "staff", name, email, customerNo, customerId, party, saleCode, auctionDate, lotsText, reason, details,
          status: dealer ? "looking" : "new",
          dealtWithName: dealer?.name ?? null,
          dealtWithId: dealer?.id ?? null,
        },
        select: { id: true, ref: true },
      })
      await writeRefundEvent(tx, r.id, "created",
        `Added by staff${dealer ? ` — ${dealer.name} is dealing with it (${REFUND_STATUS_META.looking.label})` : ""}.`, who)
      return r
    })
    revalidate()
    return { ok: true, data: created }
  } catch (e) {
    return fail(e, "create", SAVE_FAILED)
  }
}

// ─── Changing the details ───────────────────────────────────────────────────────────────────

type Parsed = Partial<{
  name: string; email: string | null; customerNo: string | null; party: RefundParty; saleCode: string | null
  auctionDate: Date | null; lotsText: string | null; reason: RefundReason; details: string | null; solution: RefundSolution | null
  percentText: string | null; postagePence: number | null; refCode: string | null; notes: string | null
}>

/** Reads every field that was SENT (undefined = not sent, left alone). */
function parsePatch(p: RefundPatch, today: string): Parsed {
  const out: Parsed = {}
  const sent = (f: RefundField) => Object.prototype.hasOwnProperty.call(p, f) && p[f] !== undefined
  if (sent("name")) {
    const n = line(p.name, "the name", REFUND_LIMITS.name)
    if (!n) throw new Refusal("The name can't be blank.")
    out.name = n
  }
  if (sent("email")) out.email = emailOf(p.email)
  if (sent("customerNo")) out.customerNo = customerNoOf(p.customerNo)
  if (sent("party")) {
    if (!isRefundParty(p.party)) throw new Refusal("Pick buyer or vendor.")
    out.party = p.party
  }
  if (sent("saleCode")) out.saleCode = saleOf(p.saleCode)
  if (sent("auctionDate")) out.auctionDate = dayOf(p.auctionDate, "the auction date", today)
  if (sent("lotsText")) out.lotsText = line(p.lotsText, "the lots", REFUND_LIMITS.lotsText)
  if (sent("reason")) {
    if (!isRefundReason(p.reason)) throw new Refusal("Pick a reason from the list.")
    out.reason = p.reason
  }
  if (sent("details")) out.details = prose(p.details, "what happened", REFUND_LIMITS.details)
  if (sent("solution")) {
    if (p.solution != null && p.solution !== "" && !isRefundSolution(p.solution)) throw new Refusal("Pick refund, return or payout.")
    out.solution = isRefundSolution(p.solution) ? p.solution : null
  }
  if (sent("percentText")) out.percentText = line(p.percentText, "the % agreed", REFUND_LIMITS.percentText)
  if (sent("postagePence")) out.postagePence = penceOf(p.postagePence, "postage refunded")
  if (sent("refCode")) out.refCode = line(p.refCode, "the ref code", REFUND_LIMITS.refCode)
  if (sent("notes")) out.notes = prose(p.notes, "the notes", REFUND_LIMITS.notes)
  return out
}

/** Two stored days are the same London day (or both none). */
function sameDay(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null
  return londonDay(a) === londonDay(b)
}

/** Two values of one field are the same (the auction date by its London day). */
function same(f: RefundField, a: unknown, b: unknown): boolean {
  if (f === "auctionDate") return sameDay(a as Date | null, b as Date | null)
  if (a == null || b == null) return a == null && b == null
  return a === b
}

/** How a change reads on the timeline. The working fields say their new value; the customer's own
 *  words and contact details don't (the timeline mustn't keep an old email or old notes). */
function changePhrase(f: RefundField, v: unknown): string {
  const label = FIELD_LABELS[f]
  const to = (words: string | null) => (words == null ? `${label} cleared` : `${label} to ${words}`)
  switch (f) {
    case "customerNo": case "saleCode": case "refCode": return to((v as string | null) ?? null)
    case "party": return to(REFUND_PARTY_LABELS[v as RefundParty])
    case "auctionDate": return to(v ? formatDay(v as Date) : null)
    case "lotsText": case "percentText": return to(v == null ? null : `“${v}”`)
    case "reason": return to(REFUND_REASON_LABELS[v as RefundReason])
    case "solution": return to(v ? REFUND_SOLUTION_LABELS[v as RefundSolution] : null)
    case "postagePence": return to(v == null ? null : formatPence(v as number))
    default: return label
  }
}

/** What the lots and postage were worked out as when they were saved (refundTotalToSave). */
export type RefundTotalSaved = { totalPence: number | null; worked: number; missing: number; kept: boolean }

/** The total for the request's timeline line: what was saved, and why when it isn't a worked-out one. */
function totalWords(t: RefundTotalSaved, lots: number): string {
  if (t.kept) {
    return ` — the total stays ${formatPence(t.totalPence)} (${lots
      ? `${plural(t.missing, "lot")} can't be worked out yet, so the old log's total stands`
      : "no lots to work it out from, so the old log's total stands"})`
  }
  if (t.totalPence != null) return ` — total ${formatPence(t.totalPence)}`
  if (t.missing) return ` — total not worked out yet (${plural(t.missing, "lot")} can't be; the rest come to ${formatPence(t.worked)})`
  return " — nothing to work out"
}

/**
 * Changes a request's details — only the fields sent; null or "" clears one (never the name). Answers
 * which fields really changed (none = nothing was written). A new C-number is matched to Customers
 * again; new postage works the total out again with the request's lots (refundTotalToSave — postage
 * alone is a total; an old-log request keeps the log's total until its lots can work out a whole one).
 * `total` is that working out — null when the postage didn't change.
 */
export async function updateRefund(
  id: string,
  patch: RefundPatch,
): Promise<RefundResult<{ changed: string[]; totalPence: number | null; total: RefundTotalSaved | null }>> {
  try {
    const who = await requireAdmin()
    const rid = idOf(id)
    if (!patch || typeof patch !== "object") return { ok: true, data: { changed: [], totalPence: null, total: null } }
    const f = parsePatch(patch, londonDay())
    const current = await prisma.refund.findUnique({ where: { id: rid } })
    if (!current) throw new Refusal(NOT_FOUND)

    const changed = (Object.keys(f) as RefundField[]).filter((k) => !same(k, f[k], current[k]))
    if (!changed.length) return { ok: true, data: { changed: [], totalPence: current.totalPence, total: null } }

    const data: Prisma.RefundUpdateManyMutationInput = {}
    for (const k of changed) (data as Record<string, unknown>)[k] = f[k] ?? null
    if (changed.includes("customerNo")) data.customerId = await matchCustomerId(f.customerNo ?? null)

    const result = await prisma.$transaction(async (tx) => {
      let total: RefundTotalSaved | null = null
      let words = ""
      if (changed.includes("postagePence")) {
        const lots = await tx.refundLot.findMany({ where: { refundId: rid } })
        total = refundTotalToSave(lots.map(lotMoney), f.postagePence ?? null, { source: sourceOf(current.source), totalPence: current.totalPence })
        data.totalPence = total.totalPence
        words = totalWords(total, lots.length)
      }
      const n = await tx.refund.updateMany({ where: { id: rid }, data })
      if (n.count === 0) throw new Refusal(NOT_FOUND)
      await writeRefundEvent(tx, rid, "edit", `Changed ${changed.map((k) => changePhrase(k, f[k] ?? null)).join(", ")}${words}.`, who)
      return { totalPence: total ? total.totalPence : current.totalPence, total }
    })
    revalidate()
    return { ok: true, data: { changed: changed.map((k) => FIELD_LABELS[k]), ...result } }
  } catch (e) {
    return fail(e, "update", SAVE_FAILED)
  }
}

// ─── Status, who's dealing with it, paid, accounts ──────────────────────────────────────────

/**
 * Moves a request to another status, on its timeline. Declined or Closed need a reason (kept in the
 * event). Paid sets the date processed to today when it hasn't one. A closed status (paid, declined,
 * closed) sets closedAt — keeping the day it first closed when it moves between them — and an open
 * one clears it. Only if the status is still what was read, so two people at once can't both win.
 * A request ticked complete for accounts stays paid until the tick is taken off.
 *
 * `shown` is the status the person's page SHOWED: when the request has moved on since (someone declined
 * it while this page sat open), it's refused with CHANGED_MEANWHILE rather than moved from a status
 * they never saw — what the confirm told them ("This closes it") would have been wrong too.
 */
export async function setRefundStatus(
  id: string,
  status: RefundStatus,
  why?: string | null,
  shown?: RefundStatus | null,
): Promise<RefundResult<{ changed: boolean; status: RefundStatus }>> {
  try {
    const who = await requireAdmin()
    const rid = idOf(id)
    if (!isRefundStatus(status)) throw new Refusal("That isn't one of this panel's statuses.")
    if (shown != null && !isRefundStatus(shown)) throw new Refusal(CHANGED_MEANWHILE)
    const reason = prose(why, "the reason", REFUND_LIMITS.reason)
    if ((status === "declined" || status === "closed") && !reason) {
      throw new Refusal(status === "declined"
        ? "Say why it's being declined — for example \"Damage was there before it was posted (see photos)\"."
        : "Say why it's being closed — for example \"Withdrawn by the customer\" or \"A duplicate of RF0041\".")
    }
    const today = londonDay()

    const result = await prisma.$transaction(async (tx) => {
      const c = await tx.refund.findUnique({ where: { id: rid }, select: { status: true, processedAt: true, closedAt: true, accountsDoneAt: true } })
      if (!c) throw new Refusal(NOT_FOUND)
      if (c.status === status) return { changed: false }
      if (shown != null && refundStatusOf(c.status) !== shown) throw new Refusal(CHANGED_MEANWHILE)
      if (c.accountsDoneAt && status !== "paid") {
        throw new Refusal("This one is ticked complete for accounts — take that tick off first, then change its status.")
      }
      const from = refundStatusOf(c.status)
      const closing = CLOSED_REFUND_STATUSES.includes(status)
      const setsProcessed = status === "paid" && !c.processedAt
      const data: Prisma.RefundUpdateManyMutationInput = {
        status,
        closedAt: closing ? (c.closedAt ?? new Date()) : null,
        ...(setsProcessed ? { processedAt: dayToStored(today) } : {}),
      }
      const n = await tx.refund.updateMany({ where: { id: rid, status: c.status }, data })
      if (n.count === 0) throw new Refusal(CHANGED_MEANWHILE)
      const parts = [`${REFUND_STATUS_META[from].label} → ${REFUND_STATUS_META[status].label}`]
      if (reason) parts.push(reason)
      if (setsProcessed) parts.push(`date processed ${formatDay(dayToStored(today))}`)
      await writeRefundEvent(tx, rid, "status", parts.join(" — "), who)
      return { changed: true }
    })
    if (result.changed) revalidate()
    return { ok: true, data: { changed: result.changed, status } }
  } catch (e) {
    return fail(e, "status", SAVE_FAILED)
  }
}

/** "I'll deal with it": the admin becomes who's dealing with it, and a New request moves to Being
 *  looked at. Says when nothing changed (already theirs, and not New). */
export async function pickUp(id: string): Promise<RefundResult<{ changed: boolean; status: RefundStatus }>> {
  try {
    const who = await requireAdmin()
    const rid = idOf(id)
    const result = await prisma.$transaction(async (tx) => {
      const c = await tx.refund.findUnique({ where: { id: rid }, select: { status: true, dealtWithId: true, dealtWithName: true } })
      if (!c) throw new Refusal(NOT_FOUND)
      const from = refundStatusOf(c.status)
      const mine = c.dealtWithId === who.id && c.dealtWithName === who.name
      const moves = from === "new"   // a status this panel doesn't know reads as New, so it moves too
      if (mine && !moves) return { changed: false, status: from }
      const n = await tx.refund.updateMany({
        where: { id: rid, status: c.status },
        data: { dealtWithName: who.name, dealtWithId: who.id, ...(moves ? { status: "looking" } : {}) },
      })
      if (n.count === 0) throw new Refusal(CHANGED_MEANWHILE)
      const parts = [`Picked up by ${who.name}`]
      if (c.dealtWithName && !mine) parts.push(`was ${c.dealtWithName}`)
      if (moves) parts.push(`${REFUND_STATUS_META.new.label} → ${REFUND_STATUS_META.looking.label}`)
      await writeRefundEvent(tx, rid, "picked_up", parts.join(" — "), who)
      return { changed: true, status: moves ? ("looking" as const) : from }
    })
    if (result.changed) revalidate()
    return { ok: true, data: result }
  } catch (e) {
    return fail(e, "pick up", SAVE_FAILED)
  }
}

/** Who's dealing with it, by name ("Liv") — or nobody (null). A name on a New request moves it to
 *  Being looked at (someone is on it). */
export async function setDealtWith(id: string, name: string | null): Promise<RefundResult<{ changed: boolean; status: RefundStatus }>> {
  try {
    const who = await requireAdmin()
    const rid = idOf(id)
    const next = line(name, "who's dealing with it", 60)
    const result = await prisma.$transaction(async (tx) => {
      const c = await tx.refund.findUnique({ where: { id: rid }, select: { status: true, dealtWithName: true } })
      if (!c) throw new Refusal(NOT_FOUND)
      const from = refundStatusOf(c.status)
      if ((c.dealtWithName ?? null) === next) return { changed: false, status: from }
      const moves = !!next && from === "new"
      const n = await tx.refund.updateMany({
        where: { id: rid, status: c.status },
        data: {
          dealtWithName: next,
          dealtWithId: next && next.toLowerCase() === who.name.toLowerCase() ? who.id : null,
          ...(moves ? { status: "looking" } : {}),
        },
      })
      if (n.count === 0) throw new Refusal(CHANGED_MEANWHILE)
      const parts = [next ? `Dealt with by ${next}` : "Nobody is dealing with it now"]
      if (c.dealtWithName) parts.push(`was ${c.dealtWithName}`)
      if (moves) parts.push(`${REFUND_STATUS_META.new.label} → ${REFUND_STATUS_META.looking.label}`)
      await writeRefundEvent(tx, rid, "dealt_with", parts.join(" — "), who)
      return { changed: true, status: moves ? ("looking" as const) : from }
    })
    if (result.changed) revalidate()
    return { ok: true, data: result }
  } catch (e) {
    return fail(e, "dealt with", SAVE_FAILED)
  }
}

/** "Complete for accounts" — ticked (when, and who) or taken off. Only a PAID request can be ticked. */
export async function setAccountsDone(id: string, done: boolean): Promise<RefundResult<{ changed: boolean }>> {
  try {
    const who = await requireAdmin()
    const rid = idOf(id)
    const tick = done === true
    const result = await prisma.$transaction(async (tx) => {
      const c = await tx.refund.findUnique({ where: { id: rid }, select: { status: true, accountsDoneAt: true } })
      if (!c) throw new Refusal(NOT_FOUND)
      if (tick === !!c.accountsDoneAt) return { changed: false }
      if (tick && c.status !== "paid") throw new Refusal("Only a paid request can be ticked complete for accounts — mark it Paid first.")
      const n = await tx.refund.updateMany({
        where: { id: rid, accountsDoneAt: tick ? null : { not: null }, ...(tick ? { status: "paid" } : {}) },
        data: tick ? { accountsDoneAt: new Date(), accountsDoneBy: who.name } : { accountsDoneAt: null, accountsDoneBy: null },
      })
      if (n.count === 0) throw new Refusal(CHANGED_MEANWHILE)
      await writeRefundEvent(tx, rid, "accounts", tick ? "Ticked complete for accounts." : "Complete for accounts taken off.", who)
      return { changed: true }
    })
    if (result.changed) revalidate()
    return { ok: true, data: result }
  } catch (e) {
    return fail(e, "accounts", SAVE_FAILED)
  }
}

/** The day it was refunded or paid out ("Date processed") — a London day, never in the future; null
 *  clears it. */
export async function setProcessedDate(id: string, day: string | null): Promise<RefundResult<{ changed: boolean }>> {
  try {
    const who = await requireAdmin()
    const rid = idOf(id)
    const at = dayOf(day, "the date processed", londonDay(), true)
    const result = await prisma.$transaction(async (tx) => {
      const c = await tx.refund.findUnique({ where: { id: rid }, select: { processedAt: true } })
      if (!c) throw new Refusal(NOT_FOUND)
      if (sameDay(at, c.processedAt)) return { changed: false }
      await tx.refund.update({ where: { id: rid }, data: { processedAt: at } })
      await writeRefundEvent(tx, rid, "processed", at ? `Date processed ${formatDay(at)}.` : "Date processed cleared.", who)
      return { changed: true }
    })
    if (result.changed) revalidate()
    return { ok: true, data: result }
  } catch (e) {
    return fail(e, "processed date", SAVE_FAILED)
  }
}

// ─── Lots and money ─────────────────────────────────────────────────────────────────────────

/** One lot as sent, checked. */
function lotOf(v: RefundLotInput, n: number) {
  if (!v || typeof v !== "object") throw new Refusal(`Lot row ${n} is empty — take it out or fill it in.`)
  const lotNo = line(v.lotNo, `row ${n}'s lot number`, 12)?.toUpperCase().replace(/\s+/g, "")
  if (!lotNo) throw new Refusal(`Row ${n} needs a lot number.`)
  const what = `lot ${lotNo}`
  if (!isRefundBasis(v.basis)) throw new Refusal(`Pick how ${what} is worked out.`)
  let percent: number | null = null
  if (v.percent != null) {
    const p = Number(v.percent)
    if (!Number.isFinite(p) || p < 0 || p > 100) throw new Refusal(`The % for ${what} must be between 0 and 100.`)
    percent = Math.round(p * 100) / 100
  }
  return {
    saleCode: saleOf(v.saleCode),
    lotNo,
    uniqueId: line(v.uniqueId, `${what}'s unique ID`, 40),
    barcode: line(v.barcode, `${what}'s barcode`, 40)?.toUpperCase() ?? null,
    receiptNo: line(v.receiptNo, `${what}'s receipt number`, 40)?.toUpperCase() ?? null,
    description: line(v.description, `${what}'s description`, 300),
    hammerPence: penceOf(v.hammerPence, `${what}'s hammer`),
    commissionPence: penceOf(v.commissionPence, `${what}'s commission`),
    basis: v.basis,
    percent,
    setAmountPence: penceOf(v.setAmountPence, `${what}'s set amount`),
    fromBc: v.fromBc === true || v.hammerFromBc === true || v.descriptionFromBc === true,
    hammerFromBc: v.hammerFromBc === true,
    descriptionFromBc: v.descriptionFromBc === true,
    refsRead: v.refsRead === true,
  }
}

/**
 * Replaces the request's lots (at most REFUND_LIMITS.lots) and works the money out again on the
 * request, in one transaction: hammer and commission (sums — commission 27% of the hammer where it
 * isn't set) and the total (refundTotalToSave of the lots plus postage refunded — null while a lot
 * can't be worked out, never a short total that reads as the whole).
 *
 * ⚠ An old-log request keeps the log's money until its lots can say it: the log gave one hammer,
 * commission and total for "808 & 809" (its lots came in with no money of their own), so adding a
 * description to one lot must not turn £22.86 into £0.00. Its hammer and commission stay until every
 * lot has a hammer, and its total until every lot can be worked out (`kept`).
 */
export async function saveRefundLots(id: string, lots: RefundLotInput[]): Promise<RefundResult<RefundTotalSaved>> {
  try {
    const who = await requireAdmin()
    const rid = idOf(id)
    if (!Array.isArray(lots)) throw new Refusal("The lots couldn't be read — please try again.")
    if (lots.length > REFUND_LIMITS.lots) throw new Refusal(`That's more than ${REFUND_LIMITS.lots} lots — one request can hold ${REFUND_LIMITS.lots} at most.`)
    const clean = lots.map((l, i) => lotOf(l, i + 1))

    const result = await prisma.$transaction(async (tx) => {
      const c = await tx.refund.findUnique({
        where: { id: rid },
        select: { source: true, postagePence: true, totalPence: true, hammerPence: true, commissionPence: true },
      })
      if (!c) throw new Refusal(NOT_FOUND)
      const source = sourceOf(c.source)
      await tx.refundLot.deleteMany({ where: { refundId: rid } })
      if (clean.length) await tx.refundLot.createMany({ data: clean.map((l, i) => ({ ...l, refundId: rid, position: i })) })

      const t = refundTotalToSave(clean.map(lotMoney), c.postagePence, { source, totalPence: c.totalPence })
      const data: Prisma.RefundUpdateInput = { totalPence: t.totalPence }
      const everyHammer = clean.length > 0 && clean.every((l) => l.hammerPence != null)
      const keepLogMoney = source === "import" && !everyHammer && (c.hammerPence != null || c.commissionPence != null)
      if (!keepLogMoney) {
        const withHammer = clean.filter((l) => l.hammerPence != null)
        data.hammerPence = withHammer.length ? withHammer.reduce((s, l) => s + l.hammerPence!, 0) : null
        data.commissionPence = withHammer.length ? withHammer.reduce((s, l) => s + (l.commissionPence ?? commissionFor(l.hammerPence!)), 0) : null
      }
      await tx.refund.update({ where: { id: rid }, data })

      const lotWords = clean.length ? `${plural(clean.length, "lot")} (${clean.map((l) => l.lotNo).join(", ")})` : "no lots"
      const postage = c.postagePence ? `, postage ${formatPence(c.postagePence)}` : ""
      await writeRefundEvent(tx, rid, "amounts", `Amounts updated: ${lotWords}${postage}${totalWords(t, clean.length)}.`, who)
      return t
    })
    revalidate()
    return { ok: true, data: result }
  } catch (e) {
    return fail(e, "lots", SAVE_FAILED)
  }
}

/** What a failed BC read means, in words. */
function bcFailure(e: unknown): Failure {
  const m = String((e as { message?: string })?.message ?? "")
  if (/\b401\b/.test(m)) return { ok: false, error: UNCOLLECTED_BC_NOT_CONNECTED, needsBc: true }
  if (/\b403\b/.test(m)) return { ok: false, error: "Your BC sign-in isn't allowed to read the auction lines — ask whoever looks after BC permissions." }
  if (/\b(429|503)\b/.test(m)) return { ok: false, error: "BC is busy just now — try again in a minute." }
  if (/timeout|aborted/i.test(m)) return { ok: false, error: "BC took too long to answer — try again in a minute." }
  console.error("refunds BC lots error:", e)
  return { ok: false, error: "BC couldn't be read just now — try again in a minute. Nothing was changed." }
}

/**
 * "Fill from BC": the lots BC shows sold to this request's buyer (its C-number) in its sale — or at
 * its auction date when it has no sale code — that are on the request ("808 & 809"; all of them when
 * it gives none), with hammer, 27% commission, description and unique ID. READ ONLY, with the admin's
 * own BC sign-in. It only PROPOSES them: nothing is saved until Save on the Lots & money card.
 */
export async function lotsFromBc(id: string): Promise<RefundResult<RefundBcFound>> {
  let ask: { customerNo: string; saleCode: string | null; auctionDate: string | null; lotsText: string | null }
  try {
    await requireAdmin()
    const r = await prisma.refund.findUnique({
      where: { id: idOf(id) },
      select: { party: true, customerNo: true, saleCode: true, auctionDate: true, lotsText: true },
    })
    if (!r) throw new Refusal(NOT_FOUND)
    if (r.party === "vendor") {
      throw new Refusal("Looking up lots in BC is for a buyer's lots (the lots they bought) — for a vendor's payout, add the lots and amounts by hand.")
    }
    const customerNo = tidyCustomerNo(r.customerNo)
    if (!customerNo || !BC_CODE_RE.test(customerNo)) {
      throw new Refusal("This request needs the buyer's C-number before BC can be asked for their lots — add it under Details.")
    }
    const sale = r.saleCode?.trim().toUpperCase() || null
    if (!sale && !r.auctionDate) {
      throw new Refusal("This request needs a sale code (F118) or an auction date before BC can be asked for its lots — add one under Details.")
    }
    if (sale && !BC_CODE_RE.test(sale)) {
      throw new Refusal("The sale on this request doesn't look like a BC sale code (for example F118) — put just the code in it under Details, or clear it and use the auction date.")
    }
    ask = { customerNo, saleCode: sale, auctionDate: r.auctionDate ? londonDay(r.auctionDate) : null, lotsText: r.lotsText }
  } catch (e) {
    return fail(e, "bc lots", "That request couldn't be read just now — please try again.")
  }

  const token = await getBCToken().catch(() => null)
  if (!token) return { ok: false, error: UNCOLLECTED_BC_NOT_CONNECTED, needsBc: true }
  try {
    return { ok: true, data: await findRefundLotsInBc(token, ask) }
  } catch (e) {
    return bcFailure(e)
  }
}

/**
 * The Lots & money card's rows, looked up by their sale and lot number (Jack, 2026-10-26: "when the lot
 * number and the sale has been filled in, the barcode number and receipt number pull in with it along
 * with hammer price"): each lot's hammer, description and unique ID, its barcode for that sale and its
 * receipt. A row with no sale uses the request's auction date. For a buyer's request, a lot BC shows
 * bought by someone else is still answered, with that said. READ ONLY, the admin's own BC sign-in —
 * nothing is saved until Save on the card.
 */
export async function lookUpRefundLots(id: string, asks: RefundLotAsk[]): Promise<RefundResult<RefundLotLookup[]>> {
  let clean: RefundLotAsk[]
  let ctx: { auctionDate: string | null; customerNo: string | null; party: RefundParty }
  try {
    await requireAdmin()
    if (!Array.isArray(asks) || !asks.length) throw new Refusal("There's no lot to look up.")
    if (asks.length > REFUND_LIMITS.lots) throw new Refusal(`That's more than ${REFUND_LIMITS.lots} lots — one request can hold ${REFUND_LIMITS.lots} at most.`)
    clean = asks.map((a, i) => {
      if (!a || typeof a !== "object" || typeof a.key !== "string" || !a.key || a.key.length > 64) throw new Refusal("The lots couldn't be read — please try again.")
      return {
        key: a.key,
        saleCode: line(a.saleCode, `row ${i + 1}'s sale`, REFUND_LIMITS.saleCode)?.toUpperCase() ?? null,
        lotNo: line(a.lotNo, `row ${i + 1}'s lot number`, 12)?.toUpperCase().replace(/\s+/g, "") ?? "",
      }
    })
    const r = await prisma.refund.findUnique({ where: { id: idOf(id) }, select: { party: true, customerNo: true, auctionDate: true } })
    if (!r) throw new Refusal(NOT_FOUND)
    ctx = { auctionDate: r.auctionDate ? londonDay(r.auctionDate) : null, customerNo: tidyCustomerNo(r.customerNo), party: partyOf(r.party) }
  } catch (e) {
    return fail(e, "bc lookup", "That request couldn't be read just now — please try again.")
  }

  const token = await getBCToken().catch(() => null)
  if (!token) return { ok: false, error: UNCOLLECTED_BC_NOT_CONNECTED, needsBc: true }
  try {
    return { ok: true, data: await lookUpLotsInBc(token, clean, ctx) }
  } catch (e) {
    return bcFailure(e)
  }
}

// ─── Notes, and deleting ────────────────────────────────────────────────────────────────────

/** A note on the request's timeline. */
export async function addRefundNote(id: string, text: string): Promise<RefundResult> {
  try {
    const who = await requireAdmin()
    const rid = idOf(id)
    const note = prose(text, "the note", REFUND_LIMITS.eventText)
    if (!note) throw new Refusal("Write the note first.")
    await prisma.$transaction(async (tx) => {
      // Touches the request, so "last changed" notices the note; and refuses if it has gone.
      const n = await tx.refund.updateMany({ where: { id: rid }, data: { updatedAt: new Date() } })
      if (n.count === 0) throw new Refusal(NOT_FOUND)
      await writeRefundEvent(tx, rid, "note", note, who)
    })
    revalidate()
    return { ok: true, data: undefined }
  } catch (e) {
    return fail(e, "note", SAVE_FAILED)
  }
}

/**
 * Deletes a request with its lots and timeline (they cascade), and its photos in R2 (best effort —
 * a photo that can't be deleted is said in the server's log, never left as a failed delete). The page
 * confirms first. The timeline goes with it, so the deletion is written to the server's log: the id,
 * its reference and who — never the customer's details.
 *
 * ⚠ No revalidatePath here, unlike every other write: a server action that revalidates re-renders the
 * page it was called from, and this request's own page would turn into "couldn't be found" before it
 * could say anything (a photo left in storage, above all). The page goes back to the list itself
 * (router.push + refresh) and carries the message there; the list is rendered fresh on every visit.
 */
export async function deleteRefund(id: string): Promise<RefundResult<{ ref: number; photosLeft: number }>> {
  try {
    const who = await requireAdmin()
    const rid = idOf(id)
    const r = await prisma.refund.findUnique({ where: { id: rid }, select: { ref: true, photoKeys: true } })
    if (!r) throw new Refusal(NOT_FOUND)
    const n = await prisma.refund.deleteMany({ where: { id: rid } })
    if (n.count === 0) throw new Refusal(NOT_FOUND)
    console.info(`refund deleted: ${JSON.stringify({ id: rid, ref: refundRefWords(r.ref), byId: who.id, byName: who.name, at: new Date().toISOString() })}`)

    // Only its own photos — refund-photos/<id>/…
    const keys = r.photoKeys.filter((k) => typeof k === "string" && k.startsWith(`${REFUND_PHOTO_PREFIX}${rid}/`))
    let photosLeft = 0
    if (keys.length) {
      try {
        await deleteObjectsFromR2(keys)
      } catch (e) {
        photosLeft = keys.length
        console.error(`refund ${rid} deleted, but its ${keys.length} photo(s) couldn't be deleted from R2:`, e)
      }
    }
    return { ok: true, data: { ref: r.ref, photosLeft } }
  } catch (e) {
    return fail(e, "delete", "Something went wrong and the request wasn't deleted — please try again.")
  }
}
