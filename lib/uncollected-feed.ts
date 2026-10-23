// Accounts → Paid, not collected — the BC check that fills the panel. SERVER ONLY.
//
// Jack, 2026-10-22: "Now I need this data to be automatically populated so it triggers 4 weeks after
// they paid for us to chase … only paid things that haven't been collected for over 4 weeks."
//
// A case is due when a lot was SOLD (hammer > 0, not withdrawn), its buyer's invoice covering it is
// PAID with nothing remaining, the lot is NOT COLLECTED (EVA_Collected), and at least
// UNCOLLECTED_AFTER_DAYS London days have passed since the paid day. One case per invoice
// (bcKey = the invoice number). The matching rules are lib/uncollected-feed-match.ts (pure, and
// re-exported from here); this file reads BC and writes the cases.
//
//  • ⚠⚠ BC IS READ ONLY. Every call here is a GET through lib/bc.ts (bcPageWithNext, bcApiUrl,
//    bcODataUrl). Nothing is ever written to Business Central.
//  • What BC is asked (all verified live 2026-10-22):
//      1. Auction_Lines_Excel (ODataV4): the uncollected sold lots of sales in the last
//         UNCOLLECTED_LOOKBACK_MONTHS, up to UNCOLLECTED_AFTER_DAYS ago — paged by @odata.nextLink.
//      2. salesInvoices (api/v2.0): those buyers' invoices, ≤ 20 buyers a call.
//      3. salesInvoiceLines (api/v2.0): the lines of the invoices that matter, ≤ 20 invoices a call
//         (one at a time if BC refuses the batch) — "Buyer Premium for Lot No 366" names a lot.
//    At most 3 calls at once, backing off on 429/503, inside a whole-run time budget (25 minutes for
//    the nightly run, 12 for Check BC now). Each run starts at a different buyer (the run's sequence
//    number moves the start), so runs that keep running out of time still reach every buyer in turn.
//  • The PAID DATE is a proxy: BC publishes no payment date (Customer Ledger Entries isn't published),
//    so a paid invoice's lastModifiedDateTime — BC's settling run, ~07:54 the morning after — gives
//    the London day it was settled. They paid ON OR BEFORE it: "Paid by".
//  • The feed writes only BC_OWNED_FIELDS, plus email / phone when the case has none. A case's status,
//    notes, chase date (except a new case's first one), storage date and timeline are the staff's.
//    It takes the SAME invoice lock as lib/actions/uncollected.ts before it adds or takes over a case.
//  • Idempotent: a second run straight after changes nothing. One run at a time (a lock on globalThis,
//    and a run the database shows started under UNCOLLECTED_RUN_STALE_MINUTES ago and unfinished).
//  • Every run is an UncollectedSyncRun row: start, finish, ok, counts, notes, error. A run that ran
//    out of time, was stopped (stopUncollectedSync — the panel's Stop), or couldn't read part of BC
//    says so (ok false) and keeps what it saved; the next run reads BC afresh. It only ever CLOSES a
//    case on positive evidence from BC.

import { Prisma } from "@/app/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { bcApiUrl, bcODataUrl, bcPageWithNext } from "@/lib/bc"
import {
  CLOSED_STATUSES, STATUS_META, UNCOLLECTED_AFTER_DAYS, UNCOLLECTED_LOOKBACK_MONTHS, UNCOLLECTED_RUN_STALE_MINUTES,
  UNCOLLECTED_STOPPED_PREFIX, dayToStored, isOpenRaw, londonDay, statusOf, syncResultWords,
  type UncollectedBcLots, type UncollectedSyncTrigger,
} from "@/lib/uncollected"
import {
  addedText, bcDay, bcTrue, chunk, cleanEmail, cleanPhone, droppedVerdict, feedChanges, invoicesNeedingLines,
  isNoLongerPaidText, isPaidInFull, lotNoOf, lotRefsFromLines, matchBuyer, matchedText, noLongerPaidText, odataString,
  ownedValues, pickDropped, rotate, saleWindow, salesLeftOff, salesOf, toFeedInvoice, toFeedLot, updatedText,
  type Candidate, type FeedChange, type FeedInvoice, type FeedLot, type InvoiceLines, type LotRef,
} from "@/lib/uncollected-feed-match"

export * from "@/lib/uncollected-feed-match"

// ─── Limits ─────────────────────────────────────────────────────────────────────────────────

/** At most this many BC calls at once (BC's own limit is 5 per user). */
const BC_CONCURRENCY = 3
/** Buyers per salesInvoices call, invoices per salesInvoiceLines call (the URL stays short). */
const BUYERS_PER_CALL = 20
const INVOICES_PER_CALL = 20
/** A walk that goes on longer than this is BC misbehaving, not a big list. */
const MAX_PAGES = 400
/** bcPageWithNext asks BC for pages of this size. */
const PAGE_SIZE = 500
/** A run's time budget for reading BC: 12 minutes for Check BC now, the most allowed for the nightly
 *  run (nobody is waiting on it, and a slow BC night shouldn't leave the same buyers unread). Capped
 *  under UNCOLLECTED_RUN_STALE_MINUTES so a live run is never taken as dead. */
const DEFAULT_BUDGET_MS = 12 * 60_000
const MAX_BUDGET_MS = Math.max(60_000, (UNCOLLECTED_RUN_STALE_MINUTES - 5) * 60_000)
/** Saving stops this long after the run began, whatever is left, so the run always finishes (and
 *  lets go of its lock) before UNCOLLECTED_RUN_STALE_MINUTES would let a second one start. */
const SAVE_STOP_MS = Math.max(MAX_BUDGET_MS, (UNCOLLECTED_RUN_STALE_MINUTES - 2) * 60_000)
/** Cases that dropped out, checked against BC per run (each takes a few calls). Which ones turns
 *  round from run to run (pickDropped), so every one is reached in turn. */
const DROPPED_CHECK_LIMIT = 60
const NOTE_MAX = 4000

/** ⚠ Only fields verified on Auction_Lines_Excel (2026-10-22). */
const LOT_SELECT = [
  "EVA_AuctionNo", "EVA_AuctionName", "EVA_AuctionDate", "EVA_UniqueID", "EVA_LotNo", "EVA_LotSuffix",
  "EVA_ShortDescription", "EVA_HammerPrice", "EVA_BuyerNo", "EVA_BuyerSearchName", "EVA_Collected", "EVA_WithdrawLot",
].join(",")
const INVOICE_SELECT = [
  "id", "number", "invoiceDate", "postingDate", "customerNumber", "customerName", "email", "phoneNumber",
  "totalAmountIncludingTax", "remainingAmount", "status", "lastModifiedDateTime",
].join(",")
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ─── Reading BC: retries, the time budget, paging ───────────────────────────────────────────

export type FeedStage = "lots" | "invoices" | "lines" | "saving" | "checking"

/** Where a run is, for the panel ("Reading invoices — 120 of 312 buyers"). Counts only — no names. */
export type FeedProgress = { stage: FeedStage; done: number; total: number | null; words: string }

type Ctx = {
  token: string
  deadline: number
  calls: number
  outOfTime: boolean
  /** BC refused a batched documentId filter once — read lines one invoice at a time from then on. */
  linesOneByOne: boolean
  refreshToken?: () => Promise<string | null>
  lastRefresh: number
  onProgress?: (p: FeedProgress) => void
  /** Someone pressed Stop (stopUncollectedSync) — asked before every BC call. */
  isStopped?: () => boolean
  /** true once a call was refused because of a Stop (ctx.outOfTime is set too, so every stage ends). */
  stopped: boolean
}

class OutOfTime extends Error {
  constructor(message = "The time allowed for the check ran out.") { super(message) }
}
/** A Stop. An OutOfTime, so every place that winds down on the time running out winds down on it. */
class Stopped extends OutOfTime {
  constructor() { super("The check was stopped.") }
}
class BcError extends Error {
  constructor(message: string, readonly status: number | null) { super(message) }
}

/** Why a step didn't finish, in words: stopped, out of time, or BC's reason. */
const whyNot = (e: unknown): string =>
  e instanceof Stopped ? "the check was stopped" : e instanceof OutOfTime ? "the time allowed ran out" : (e as Error)?.message || "an unexpected error"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** BC's HTTP status from lib/bc.ts's messages: "BC API 429: …", and the company lookup's
 *  "BC API companies 401: …" (bcApiUrl) — a refused sign-in there is still a 401. */
const BC_STATUS_RE = /^BC API (?:companies )?(\d{3})\b/

function statusOfError(e: unknown): number | null {
  const m = BC_STATUS_RE.exec((e as { message?: string })?.message ?? "")
  return m ? Number(m[1]) : null
}

/** A short, plain reason — BC's own message cut to a line, never a whole response body. */
function describe(e: unknown, status: number | null): string {
  const msg = String((e as { message?: string })?.message ?? "")
  if (status != null) {
    const detail = msg.replace(/^BC API (?:companies )?\d{3}:\s*/, "")
    let text = detail
    try { text = (JSON.parse(detail) as { error?: { message?: string } })?.error?.message ?? detail } catch { /* not JSON */ }
    return `BC answered ${status}${text ? ` — ${text.replace(/\s+/g, " ").slice(0, 160)}` : ""}`
  }
  const name = (e as { name?: string })?.name
  return name === "TimeoutError" || name === "AbortError" ? "BC didn't answer in time" : `BC couldn't be reached (${msg.slice(0, 80) || "no answer"})`
}

/** Waits `ms`, waking early (within a second) if someone presses Stop. */
async function pause(ctx: Ctx, ms: number): Promise<void> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (ctx.isStopped?.()) return
    await sleep(Math.min(1_000, until - Date.now()))
  }
}

/** One BC call, retried on 429 / 502 / 503 / 504 / no answer (and a 500 once) with backoff, never
 *  past the run's deadline or a Stop. A 401 renews the sign-in once a minute at most, then tries again. */
async function withRetry<T>(ctx: Ctx, call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (ctx.isStopped?.()) { ctx.stopped = true; ctx.outOfTime = true; throw new Stopped() }
    if (Date.now() > ctx.deadline) { ctx.outOfTime = true; throw new OutOfTime() }
    try {
      ctx.calls++
      return await call()
    } catch (e) {
      if (e instanceof OutOfTime) throw e
      const status = statusOfError(e)
      if (status === 401 && ctx.refreshToken && Date.now() - ctx.lastRefresh > 60_000 && attempt < 4) {
        ctx.lastRefresh = Date.now()
        const t = await ctx.refreshToken().catch(() => null)
        if (t) { ctx.token = t; continue }
      }
      // BC's company list answered but has no company of that name: a setting, not a blip.
      const config = status == null && /not found in API companies list/i.test(String((e as Error)?.message ?? ""))
      const retryable = !config && (status == null || status === 429 || status === 502 || status === 503 || status === 504 || (status === 500 && attempt < 1))
      if (!retryable || attempt >= 4) throw new BcError(config ? String((e as Error).message).slice(0, 160) : describe(e, status), status)
      const wait = Math.min(30_000, 2_000 * 2 ** attempt) + Math.floor(Math.random() * 500)
      if (Date.now() + wait > ctx.deadline) { ctx.outOfTime = true; throw new OutOfTime() }
      await pause(ctx, wait)
    }
  }
}

/** base?k=v&… — OData keys unencoded, values encoded (bcPage's way: BC ignores %24filter). */
const withQuery = (base: string, params: Record<string, string>) =>
  `${base}?${Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`

/** Every row of a query, following @odata.nextLink (or $skip when BC sends a full page and no link). */
async function readAll(
  ctx: Ctx,
  base: string,
  params: Record<string, string>,
  onRows?: (n: number) => void,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  let url: string | null = withQuery(base, params)
  let pages = 0
  while (url) {
    if (++pages > MAX_PAGES) throw new BcError(`BC kept sending pages (over ${MAX_PAGES}) — stopped`, null)
    const target: string = url
    const page = await withRetry(ctx, () => bcPageWithNext(ctx.token, target))
    const rows = (page.rows ?? []) as Record<string, unknown>[]
    out.push(...rows)
    onRows?.(out.length)
    url = page.nextLink
      ? page.nextLink
      : rows.length >= PAGE_SIZE ? withQuery(base, { ...params, $skip: String(out.length), $top: String(PAGE_SIZE) }) : null
  }
  return out
}

/** Runs `fn` over the items, `limit` at a time. `fn` handles its own errors. */
async function eachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++])
  }))
}

function makeCtx(token: string, opts: {
  budgetMs?: number
  refreshToken?: () => Promise<string | null>
  onProgress?: (p: FeedProgress) => void
  isStopped?: () => boolean
}): Ctx {
  const budget = Math.min(MAX_BUDGET_MS, Math.max(30_000, opts.budgetMs ?? DEFAULT_BUDGET_MS))
  return {
    token, deadline: Date.now() + budget, calls: 0, outOfTime: false, linesOneByOne: false,
    refreshToken: opts.refreshToken, lastRefresh: 0, onProgress: opts.onProgress,
    isStopped: opts.isStopped, stopped: false,
  }
}

const n0 = (n: number) => n.toLocaleString("en-GB")
const many = (n: number, one: string, more = `${one}s`) => `${n0(n)} ${n === 1 ? one : more}`

// ─── Reading BC: the three feeds ────────────────────────────────────────────────────────────

/** Invoices for up to 20 buyers, dated in [from, to]. */
async function readInvoicesFor(ctx: Ctx, url: string, buyers: string[], from: string, to: string): Promise<FeedInvoice[]> {
  const who = buyers.map((b) => `customerNumber eq ${odataString(b)}`).join(" or ")
  const rows = await readAll(ctx, url, {
    $filter: `(${who}) and invoiceDate ge ${from} and invoiceDate le ${to}`,
    $select: INVOICE_SELECT,
  })
  return rows.map(toFeedInvoice).filter((i): i is FeedInvoice => !!i)
}

/** Invoices by number (≤ 20). */
async function readInvoicesByNumber(ctx: Ctx, url: string, numbers: string[]): Promise<FeedInvoice[]> {
  const rows = await readAll(ctx, url, {
    $filter: numbers.map((n) => `number eq ${odataString(n)}`).join(" or "),
    $select: INVOICE_SELECT,
  })
  return rows.map(toFeedInvoice).filter((i): i is FeedInvoice => !!i)
}

/**
 * The lot numbers on each invoice (≤ 20 ids a call; one at a time once BC refuses a batch). An
 * invoice a batch answered with NO lines is asked again on its own, so a batch BC only half
 * answered can never make a lot invoice look empty. Answers the invoices read; throws on failure.
 */
async function readLines(ctx: Ctx, url: string, ids: string[]): Promise<Map<string, InvoiceLines>> {
  const out = new Map<string, InvoiceLines>()
  const one = async (id: string) => {
    const rows = await readAll(ctx, url, { $filter: `documentId eq ${id}` })
    out.set(id, lotRefsFromLines(rows))
  }
  if (ctx.linesOneByOne || ids.length === 1) {
    for (const id of ids) await one(id)
    return out
  }
  let rows: Record<string, unknown>[]
  try {
    rows = await readAll(ctx, url, { $filter: ids.map((id) => `documentId eq ${id}`).join(" or ") })
  } catch (e) {
    if (!(e instanceof BcError) || e.status !== 400) throw e
    ctx.linesOneByOne = true   // BC won't take a batched filter here — one at a time from now on
    for (const id of ids) await one(id)
    return out
  }
  const byDoc = new Map<string, Record<string, unknown>[]>()
  for (const r of rows) {
    const d = String(r.documentId ?? "").toLowerCase()
    if (!byDoc.has(d)) byDoc.set(d, [])
    byDoc.get(d)!.push(r)
  }
  for (const id of ids) {
    const mine = byDoc.get(id.toLowerCase())
    if (mine?.length) out.set(id, lotRefsFromLines(mine))
    else await one(id)
  }
  return out
}

/** A buyer's lots in one sale as BC has them now (collected or not). Filtered by sale AND buyer;
 *  if BC refuses the buyer filter, by sale alone and the buyer picked out here. */
async function readBuyerSaleRows(ctx: Ctx, saleCode: string, buyerNo: string): Promise<Record<string, unknown>[]> {
  const base = bcODataUrl("Auction_Lines_Excel")
  try {
    return await readAll(ctx, base, {
      $filter: `EVA_AuctionNo eq ${odataString(saleCode)} and EVA_BuyerNo eq ${odataString(buyerNo)}`,
      $select: LOT_SELECT,
    })
  } catch (e) {
    if (!(e instanceof BcError) || e.status !== 400) throw e
    const rows = await readAll(ctx, base, { $filter: `EVA_AuctionNo eq ${odataString(saleCode)}`, $select: LOT_SELECT })
    return rows.filter((r) => String(r.EVA_BuyerNo ?? "").trim().toUpperCase() === buyerNo.toUpperCase())
  }
}

// ─── Find: which paid invoices have lots still not collected ────────────────────────────────

export type FindOptions = {
  /** The moment to judge "today" from (London day). Default now. */
  now?: Date
  /** London days after the paid day before a case is due. Default UNCOLLECTED_AFTER_DAYS (28). */
  afterDays?: number
  /** Sales this many months back are read. Default UNCOLLECTED_LOOKBACK_MONTHS (12). */
  lookbackMonths?: number
  /** Called as the work moves along — counts only. */
  onProgress?: (p: FeedProgress) => void
  /** The whole run's time budget (default 12 minutes, at most 25). */
  budgetMs?: number
  /** Renews the BC sign-in if BC answers 401 part-way (getBCTokenAny / getBCToken). */
  refreshToken?: () => Promise<string | null>
  /** Moves the buyer the reading starts at (syncUncollected passes the run's sequence number), so
   *  runs that run out of time don't always leave the same buyers unread. 0 / none = A to Z. */
  rotation?: number
}

export type FindResult = {
  candidates: Candidate[]
  /** Sold, uncollected, not-withdrawn lots in the window (with or without a buyer number). */
  lotsSeen: number
  /** Buyers those lots belong to. */
  buyers: number
  /** Their buyer numbers (upper case) — a buyer NOT here has no uncollected lot left in the window. */
  buyerNos: string[]
  /** true = something wasn't read (an error, the time ran out, a Stop) — see notes and uncheckedBuyers. */
  partial: boolean
  /** Plain sentences for the run's record. Counts and invoice numbers only — never a name. */
  notes: string[]
  /** false = BC's lot list itself wasn't read in full, so NOTHING may be decided from this result. */
  lotsComplete: boolean
  /** Buyers whose invoices or lines couldn't be read in full: no candidates for them, and their
   *  cases are not judged. */
  uncheckedBuyers: string[]
  /** The London day judged from, and the sale window read (YYYY-MM-DD). */
  today: string
  window: { from: string; to: string }
  invoicesRead: number
  /** BC calls made (retries included). */
  calls: number
  /** The first reason something couldn't be read, if any. */
  firstError: string | null
}

/**
 * Reads BC and answers one candidate per paid invoice (nothing remaining, settled at least
 * `afterDays` London days ago) that still has at least one sold lot not collected. Read only —
 * writes nothing anywhere. Never throws: a failure is in `partial`, `notes` and `firstError`.
 */
export async function findPaidUncollected(token: string, opts: FindOptions = {}): Promise<FindResult> {
  return find(makeCtx(token, opts), opts)
}

async function find(ctx: Ctx, opts: FindOptions): Promise<FindResult> {
  const afterDays = Math.max(0, Math.floor(opts.afterDays ?? UNCOLLECTED_AFTER_DAYS))
  const lookback = Math.max(1, Math.floor(opts.lookbackMonths ?? UNCOLLECTED_LOOKBACK_MONTHS))
  const today = londonDay(opts.now ?? new Date())
  const win = saleWindow(today, afterDays, lookback)
  const notes: string[] = []
  const progress = (p: FeedProgress) => { try { ctx.onProgress?.(p) } catch { /* the screen's problem, not the run's */ } }
  const result = (over: Partial<FindResult>): FindResult => ({
    candidates: [], lotsSeen: 0, buyers: 0, buyerNos: [], partial: true, notes, lotsComplete: false, uncheckedBuyers: [],
    today, window: win, invoicesRead: 0, calls: ctx.calls, firstError: null, ...over,
  })

  // 1. The uncollected sold lots of the window.
  let rows: Record<string, unknown>[]
  try {
    rows = await readAll(ctx, bcODataUrl("Auction_Lines_Excel"), {
      $filter: `EVA_Collected eq false and EVA_HammerPrice gt 0 and EVA_AuctionDate le ${win.to} and EVA_AuctionDate ge ${win.from}`,
      $select: LOT_SELECT,
    }, (n) => progress({ stage: "lots", done: n, total: null, words: `Reading uncollected lots from BC — ${n0(n)} so far` }))
  } catch (e) {
    const why = whyNot(e)
    notes.push(`BC's list of uncollected lots couldn't be read in full (${why}) — nothing was decided.`)
    return result({ firstError: why })
  }

  const lots: FeedLot[] = []
  const seen = new Set<string>()
  let noBuyer = 0
  for (const r of rows) {
    const lot = toFeedLot(r)
    if (!lot) {
      // Counted only when it IS a sold, uncollected, not-withdrawn lot that simply has no buyer.
      const sold = Number(r.EVA_HammerPrice ?? 0) > 0 && !bcTrue(r.EVA_Collected) && !bcTrue(r.EVA_WithdrawLot)
      if (sold && !String(r.EVA_BuyerNo ?? "").trim()) noBuyer++
      continue
    }
    const key = lot.uniqueId ? `u:${lot.uniqueId.toUpperCase()}` : `l:${lot.saleCode}:${lot.lotNo}:${lot.buyerNo}`
    if (seen.has(key)) continue   // a page boundary that moved under us
    seen.add(key)
    lots.push(lot)
  }
  if (noBuyer) notes.push(`${many(noBuyer, "uncollected sold lot")} in BC ${noBuyer === 1 ? "has" : "have"} no buyer number and couldn't be checked.`)

  // 2. By buyer.
  const byBuyer = new Map<string, FeedLot[]>()
  for (const l of lots) {
    if (!byBuyer.has(l.buyerNo)) byBuyer.set(l.buyerNo, [])
    byBuyer.get(l.buyerNo)!.push(l)
  }
  const earliest = new Map<string, string>()
  for (const [b, ls] of byBuyer) earliest.set(b, ls.reduce((d, l) => (l.saleDate < d ? l.saleDate : d), ls[0].saleDate))
  // Buyer A to Z, turned round to start somewhere new each run (rotate): a run that runs out of
  // time leaves a different stretch unread, so repeated short runs still reach every buyer.
  const buyerNos = [...byBuyer.keys()].sort()
  const buyers = rotate(buyerNos, opts.rotation)
  const lotsSeen = lots.length + noBuyer
  const unchecked = new Map<string, string>()   // buyer → why
  let firstError: string | null = null
  const miss = (bs: string[], e: unknown) => {
    const why = whyNot(e)
    if (!firstError && !(e instanceof OutOfTime)) firstError = why
    for (const b of bs) if (!unchecked.has(b)) unchecked.set(b, why)
  }

  if (!buyers.length) {
    return result({ lotsSeen, partial: false, lotsComplete: true })
  }

  // 3. Their invoices, dated from their earliest lot's sale to the end of the window.
  let invoicesUrl: string
  let linesUrl: string
  try {
    invoicesUrl = await withRetry(ctx, () => bcApiUrl(ctx.token, "api/v2.0", "salesInvoices"))
    linesUrl = await withRetry(ctx, () => bcApiUrl(ctx.token, "api/v2.0", "salesInvoiceLines"))
  } catch (e) {
    const why = whyNot(e)
    notes.push(`BC's invoices couldn't be reached (${why}) — no buyer was checked.`)
    return result({ lotsSeen, buyers: buyers.length, buyerNos, lotsComplete: true, uncheckedBuyers: buyers, firstError: e instanceof OutOfTime ? null : why })
  }

  const invoicesOf = new Map<string, FeedInvoice[]>()
  let doneBuyers = 0
  let invoicesRead = 0
  await eachLimit(chunk(buyers, BUYERS_PER_CALL), BC_CONCURRENCY, async (batch) => {
    try {
      if (ctx.outOfTime) throw ctx.stopped ? new Stopped() : new OutOfTime()
      const from = batch.reduce((d, b) => (earliest.get(b)! < d ? earliest.get(b)! : d), earliest.get(batch[0])!)
      const invs = await readInvoicesFor(ctx, invoicesUrl, batch, from, win.to)
      const ids = new Set<string>()
      for (const inv of invs) {
        if (ids.has(inv.id) || !batch.includes(inv.customerNumber)) continue
        ids.add(inv.id)
        if (inv.invoiceDate < earliest.get(inv.customerNumber)!) continue
        if (!invoicesOf.has(inv.customerNumber)) invoicesOf.set(inv.customerNumber, [])
        invoicesOf.get(inv.customerNumber)!.push(inv)
      }
      invoicesRead += ids.size
    } catch (e) {
      miss(batch, e)
    }
    doneBuyers += batch.length
    progress({ stage: "invoices", done: doneBuyers, total: buyers.length, words: `Reading invoices — ${n0(doneBuyers)} of ${n0(buyers.length)} buyers` })
  })

  // 4. The lines of every invoice that could matter (see invoicesNeedingLines).
  const owner = new Map<string, string>()   // invoice id → buyer
  for (const b of buyers) {
    if (unchecked.has(b)) continue
    for (const inv of invoicesNeedingLines(invoicesOf.get(b) ?? [], today, afterDays)) {
      if (!GUID.test(inv.id)) { miss([b], new Error(`invoice ${inv.number} has an id BC's lines can't be asked for`)); break }
      owner.set(inv.id, b)
    }
  }
  const needIds = [...owner.keys()].filter((id) => !unchecked.has(owner.get(id)!))
  const lines = new Map<string, InvoiceLines>()
  let doneLines = 0
  await eachLimit(chunk(needIds, INVOICES_PER_CALL), BC_CONCURRENCY, async (batch) => {
    try {
      if (ctx.outOfTime) throw ctx.stopped ? new Stopped() : new OutOfTime()
      for (const [id, l] of await readLines(ctx, linesUrl, batch)) lines.set(id, l)
    } catch (e) {
      miss([...new Set(batch.map((id) => owner.get(id)!))], e)
    }
    doneLines += batch.length
    progress({ stage: "lines", done: doneLines, total: needIds.length, words: `Reading invoice lines — ${n0(doneLines)} of ${n0(needIds.length)} invoices` })
  })

  // 5–6. Match, buyer by buyer.
  const candidates: Candidate[] = []
  const fallback: string[] = []
  let notLotInvoices = 0
  for (const b of buyers) {
    if (unchecked.has(b)) continue
    const invs = invoicesOf.get(b) ?? []
    if (invoicesNeedingLines(invs, today, afterDays).some((i) => !lines.has(i.id))) {
      miss([b], new Error("some of their invoice lines weren't read"))
      continue
    }
    const m = matchBuyer(byBuyer.get(b)!, invs, lines, { today, afterDays })
    candidates.push(...m.candidates)
    fallback.push(...m.fallback.map((f) => `${f.invoiceNo} (${f.saleCode})`))
    notLotInvoices += m.notLotInvoices
  }
  candidates.sort((a, b) => (a.paidOn < b.paidOn ? -1 : a.paidOn > b.paidOn ? 1 : a.invoiceNo.localeCompare(b.invoiceNo)))

  if (fallback.length) {
    notes.push(`${many(fallback.length, "paid invoice")} ${fallback.length === 1 ? "lists" : "list"} no lot numbers, so the buyer's uncollected lots from their latest sale before it were used: ${fallback.slice(0, 8).join(", ")}${fallback.length > 8 ? ` and ${fallback.length - 8} more` : ""}.`)
  }
  if (notLotInvoices) notes.push(`${many(notLotInvoices, "paid invoice")} with no lots on ${notLotInvoices === 1 ? "it" : "them"} (postage, storage and the like) ${notLotInvoices === 1 ? "was" : "were"} left out.`)
  if (unchecked.size) {
    const reasons = [...new Set(unchecked.values())]
    notes.push(`${many(unchecked.size, "buyer")} of ${n0(buyers.length)} couldn't be checked (${reasons.slice(0, 2).join("; ")}) — the next check tries them again.`)
  }

  return {
    candidates, lotsSeen, buyers: buyers.length, buyerNos, partial: unchecked.size > 0, notes, lotsComplete: true,
    uncheckedBuyers: [...unchecked.keys()], today, window: win, invoicesRead, calls: ctx.calls, firstError,
  }
}

// ─── Sync: write the cases ──────────────────────────────────────────────────────────────────

export type SyncOptions = {
  trigger: UncollectedSyncTrigger
  /** Who pressed Check BC now (null for the nightly run). */
  byName?: string | null
  /** The BC sign-in to read with: getBCTokenAny() nightly, the admin's own getBCToken() for Check BC now. */
  token: string | null
  /** Renews the sign-in if BC answers 401 part-way (pass the same getter). */
  refreshToken?: () => Promise<string | null>
  now?: Date
  afterDays?: number
  lookbackMonths?: number
  /** Time for reading BC. Default 25 minutes nightly (the most allowed — UNCOLLECTED_RUN_STALE_MINUTES
   *  − 5), 12 for Check BC now; never more than 25. */
  budgetMs?: number
  onProgress?: (p: FeedProgress) => void
  /** Called once the run has its UncollectedSyncRun row and is under way (startUncollectedSync uses it). */
  onStarted?: (runId: string) => void
}

export type UncollectedSyncResult = {
  /** true = the whole check ran and every case was saved. */
  ok: boolean
  /** Why not, in plain words (also on the run's row). */
  error?: string
  /** The tables aren't there yet — nothing was written. */
  notReady?: boolean
  /** Another check is already running — nothing was started. */
  busy?: boolean
  /** The UncollectedSyncRun row (null when none was written). */
  runId: string | null
  /** Part of BC wasn't read (an error, the time ran out, a Stop) — what was found was still saved. */
  partial: boolean
  /** Someone pressed Stop: it stopped part-way, keeping what it had saved (error says who). */
  stopped?: boolean
  lotsSeen: number
  buyers: number
  /** Paid invoices over UNCOLLECTED_AFTER_DAYS old with lots not collected. */
  found: number
  /** New cases. */
  added: number
  /** Cases added by hand that the check took over. */
  adopted: number
  /** Cases from BC whose BC fields changed (adopted ones are counted here too, as on the run's row). */
  updated: number
  /** Cases closed because BC shows the lots collected. */
  closed: number
  /** Cases whose invoice BC no longer shows as paid (said on the case, left open). */
  flaggedUnpaid: number
  notes: string[]
  /** "Checked 1,240 uncollected lots for 312 buyers — 46 paid over 4 weeks ago: 9 new, 2 closed as collected." */
  summary: string
  startedAt: string
  finishedAt: string
}

/** The run in progress in THIS process, if any — for the panel's progress line. Counts only. */
export type UncollectedSyncNow = {
  runId: string | null
  startedAt: string
  trigger: UncollectedSyncTrigger
  byName: string | null
  /** "Reading invoices — 120 of 312 buyers", or null before the first step reports. */
  progress: string | null
  stage: FeedStage | null
  /** Who pressed Stop, once someone has (it stops at its next BC call or save, within seconds). */
  stopBy: string | null
}

type Running = UncollectedSyncNow & { key: string; startedMs: number }
const lockBox = globalThis as unknown as { __uncollectedSync?: Running }

/** The check running in this process now, or null. */
export function uncollectedSyncNow(): UncollectedSyncNow | null {
  const r = lockBox.__uncollectedSync
  if (!r || Date.now() - r.startedMs > UNCOLLECTED_RUN_STALE_MINUTES * 60_000) return null
  return { runId: r.runId, startedAt: r.startedAt, trigger: r.trigger, byName: r.byName, progress: r.progress, stage: r.stage, stopBy: r.stopBy }
}

/**
 * Stop: asks the check running in this process to stop. It stops before its next BC call or its next
 * case saved (within seconds — a wait between retries is cut short too), keeps every case it has
 * already saved, skips re-checking the cases BC no longer lists, and records the run as stopped by
 * `byName`. Answers false when no check is running here. Reads and writes nothing in BC.
 */
export function stopUncollectedSync(byName: string): boolean {
  const r = lockBox.__uncollectedSync
  if (!r || Date.now() - r.startedMs > UNCOLLECTED_RUN_STALE_MINUTES * 60_000) return false
  if (!r.stopBy) r.stopBy = byName.trim() || "someone"
  return true
}

/** One of OUR tables isn't there yet (Run Migrations) — never any other fault. */
function isMissingTable(e: unknown): boolean {
  const err = e as { code?: string; message?: string; meta?: { code?: string; message?: string } } | null
  if (err?.code === "P2021" || err?.code === "42P01" || err?.meta?.code === "42P01") return true
  return /Uncollected(Paid|PaidEvent|SyncRun)\W{0,3}\s*does not exist/i.test(`${err?.message ?? ""} ${err?.meta?.message ?? ""}`)
}

const NOT_READY = "Paid, not collected needs Run Migrations — an admin needs to press Run Migrations before BC can be checked."
const FEED_CREATOR = "BC check"
const feedName = (trigger: UncollectedSyncTrigger, byName: string | null | undefined) =>
  trigger === "nightly" ? "BC check (nightly)" : `BC check (Check BC now${byName ? ` — ${byName}` : ""})`

/** The Hub's Customers record for a buyer number. Tolerant: a missing table or a blip leaves the
 *  case unlinked. Reads the Hub's own copy only (the same rule as lib/actions/uncollected.ts). */
async function matchCustomer(buyerNo: string | null | undefined): Promise<string | null> {
  if (!buyerNo) return null
  try {
    const exact = await prisma.customer.findUnique({ where: { buyerNo }, select: { id: true } })
    if (exact) return exact.id
    const upper = buyerNo.toUpperCase()
    if (upper === buyerNo) return null
    return (await prisma.customer.findUnique({ where: { buyerNo: upper }, select: { id: true } }))?.id ?? null
  } catch (e) {
    if (!/does not exist|P2021|P2022/i.test(`${(e as { message?: string })?.message ?? ""} ${(e as { code?: string })?.code ?? ""}`)) {
      console.error("uncollected feed customer match error:", e)
    }
    return null
  }
}

/** ⚠ The SAME lock as lockInvoice() in lib/actions/uncollected.ts — change both together. Taken
 *  first in every transaction that adds or takes over a case, before any row lock. */
async function lockInvoice(tx: Prisma.TransactionClient, invoiceNo: string): Promise<void> {
  // $executeRaw: the lock returns void, which $queryRaw can't read.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('uncollected-invoice:' || lower(${invoiceNo}::text)))`
}

function toData(set: FeedChange["set"]): Prisma.UncollectedPaidUpdateInput {
  const d: Prisma.UncollectedPaidUpdateInput = {}
  const has = (k: string) => Object.prototype.hasOwnProperty.call(set, k)
  if (has("buyerName")) d.buyerName = String(set.buyerName)
  if (has("buyerNo")) d.buyerNo = (set.buyerNo as string | null) ?? null
  if (has("saleCode")) d.saleCode = (set.saleCode as string | null) ?? null
  if (has("invoiceNo")) d.invoiceNo = (set.invoiceNo as string | null) ?? null
  if (has("lots")) d.lots = (set.lots as number | null) ?? null
  if (has("amountPaid")) d.amountPaid = (set.amountPaid as number | null) ?? null
  if (has("paidAt")) d.paidAt = set.paidAt ? dayToStored(String(set.paidAt)) : null
  if (has("email")) d.email = (set.email as string | null) ?? null
  if (has("phone")) d.phone = (set.phone as string | null) ?? null
  return d
}

/** The case's link to a Hub Customers record: follows a changed buyer number (even to none), and
 *  fills a missing link; never removes one staff could see otherwise. Not a timeline change. */
function customerLink(current: string | null, matched: string | null, ch: FeedChange): { customerId?: string | null } {
  if (ch.set.buyerNo !== undefined) return matched !== current ? { customerId: matched } : {}
  return !current && matched ? { customerId: matched } : {}
}

type SaveCtx = {
  today: string
  byName: string
  /** The latest event the check wrote on each case (to say "paid again" / not repeat itself). */
  lastFeedText: Map<string, string | null>
  /** Manual cases taken over in this run (a buyer + sale case is taken over once). */
  adoptedIds: Set<string>
}

type SaveOutcome = "added" | "adopted" | "updated" | "same" | "leftClosed"

/** One candidate, in one transaction, under the invoice's lock:
 *  1. the case BC already holds for the invoice → its BC fields brought up to date (closed: left);
 *  2. else an OPEN case added by hand for the same invoice → taken over;
 *  3. else a case for the invoice that was CLOSED by hand → left alone (the staff's decision stands);
 *  4. else an OPEN case added by hand for the same buyer + sale with no invoice number → taken over;
 *     else a CLOSED one like that → left alone, the same rule as 3 (a hand case with no invoice
 *     number stands for the buyer's whole sale);
 *  5. else a new case, waiting, first chase today.
 *  ⚠ 3 and 4's "closed by hand → left alone" waits on Jack's confirmation (RULES.md); change both together. */
async function saveCandidate(c: Candidate, s: SaveCtx): Promise<SaveOutcome> {
  const v = ownedValues(c)
  const customerId = await matchCustomer(v.buyerNo)
  const closed = Prisma.join(CLOSED_STATUSES)
  const sales = salesOf(v.saleCode)

  return prisma.$transaction(async (tx) => {
    await lockInvoice(tx, v.invoiceNo)

    // 1. Ours already.
    const [own] = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "UncollectedPaid" WHERE lower("bcKey") = lower(${v.invoiceNo}::text)
      ORDER BY "createdAt" ASC LIMIT 1 FOR UPDATE`
    if (own) {
      const row = await tx.uncollectedPaid.findUnique({ where: { id: own.id } })
      if (!row) return "same"
      if (!isOpenRaw(row.status)) return "leftClosed"
      const ch = feedChanges(row, c)
      const paidAgain = isNoLongerPaidText(s.lastFeedText.get(row.id))
      const data: Prisma.UncollectedPaidUpdateInput = { ...toData(ch.set), ...customerLink(row.customerId, customerId, ch) }
      if (Object.keys(data).length) await tx.uncollectedPaid.update({ where: { id: row.id }, data })
      if (!ch.phrases.length && !paidAgain) return "same"
      await tx.uncollectedPaidEvent.create({ data: { caseId: row.id, kind: "edit", text: updatedText(c, ch, paidAgain), byId: null, byName: s.byName } })
      return "updated"
    }

    // 2 / 4. A case added by hand to take over.
    const adopt = async (id: string): Promise<SaveOutcome> => {
      const row = await tx.uncollectedPaid.findUnique({ where: { id } })
      if (!row) return "same"
      const ch = feedChanges(row, c)
      const data: Prisma.UncollectedPaidUpdateInput = {
        ...toData(ch.set), ...customerLink(row.customerId, customerId, ch), source: "bc", bcKey: v.invoiceNo,
      }
      await tx.uncollectedPaid.update({ where: { id }, data })
      await tx.uncollectedPaidEvent.create({ data: { caseId: id, kind: "edit", text: matchedText(c, ch.phrases), byId: null, byName: s.byName } })
      s.adoptedIds.add(id)
      return "adopted"
    }

    const [byInvoice] = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "UncollectedPaid"
      WHERE "source" = 'manual' AND lower("invoiceNo") = lower(${v.invoiceNo}::text) AND "status" NOT IN (${closed})
      ORDER BY "createdAt" ASC LIMIT 1 FOR UPDATE`
    if (byInvoice) return adopt(byInvoice.id)

    // 3. Closed by hand — never re-added behind the staff's back.
    const [closedByHand] = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "UncollectedPaid"
      WHERE lower("invoiceNo") = lower(${v.invoiceNo}::text) AND "status" IN (${closed}) LIMIT 1`
    if (closedByHand) return "leftClosed"

    if (sales.length) {
      const skip = [...s.adoptedIds]
      const [byBuyerSale] = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "UncollectedPaid"
        WHERE "source" = 'manual' AND "invoiceNo" IS NULL AND "status" NOT IN (${closed})
          AND lower("buyerNo") = lower(${v.buyerNo}::text)
          AND upper(btrim("saleCode")) IN (${Prisma.join(sales)})
          ${skip.length ? Prisma.sql`AND "id" NOT IN (${Prisma.join(skip)})` : Prisma.empty}
        ORDER BY "createdAt" ASC LIMIT 1 FOR UPDATE`
      if (byBuyerSale) return adopt(byBuyerSale.id)

      const [closedBuyerSale] = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "UncollectedPaid"
        WHERE "source" = 'manual' AND "invoiceNo" IS NULL AND "status" IN (${closed})
          AND lower("buyerNo") = lower(${v.buyerNo}::text)
          AND upper(btrim("saleCode")) IN (${Prisma.join(sales)})
        LIMIT 1`
      if (closedBuyerSale) return "leftClosed"
    }

    // 5. New.
    const created = await tx.uncollectedPaid.create({
      data: {
        source: "bc",
        bcKey: v.invoiceNo,
        buyerNo: v.buyerNo,
        customerId,
        buyerName: v.buyerName,
        email: cleanEmail(c.email),
        phone: cleanPhone(c.phone),
        saleCode: v.saleCode,
        invoiceNo: v.invoiceNo,
        lots: v.lots,
        amountPaid: v.amountPaid,
        paidAt: dayToStored(v.paidOn),
        status: "waiting",
        nextChaseAt: dayToStored(s.today),
        createdById: null,
        createdByName: FEED_CREATOR,
      },
      select: { id: true },
    })
    await tx.uncollectedPaidEvent.create({ data: { caseId: created.id, kind: "created", text: addedText(c), byId: null, byName: s.byName } })
    return "added"
  }, { maxWait: 10_000, timeout: 20_000 })
}

type OpenBcCase = { id: string; bcKey: string | null; invoiceNo: string | null; buyerNo: string | null; saleCode: string | null; status: string }

/**
 * Open cases from BC the check no longer found. Each is judged against BC only on positive evidence:
 *  • its invoice isn't paid in full any more → said once on the case ("check it"), left open;
 *  • still paid, and every lot of theirs on it that BC still shows is collected → closed as collected;
 *  • anything else (lots still waiting, nothing to be found, couldn't be read) → left as it is.
 */
async function checkDropped(ctx: Ctx, cases: OpenBcCase[], s: SaveCtx, notes: string[]) {
  const out = { closed: 0, flagged: 0, waiting: 0, unknown: 0, notInBc: 0, unread: 0, failed: 0, tooManySales: 0 }
  if (!cases.length) return out
  const progress = (done: number) => {
    try { ctx.onProgress?.({ stage: "checking", done, total: cases.length, words: `Checking cases BC no longer lists — ${n0(done)} of ${n0(cases.length)}` }) } catch { /* ignore */ }
  }
  progress(0)
  const keyOf = (c: OpenBcCase) => (c.bcKey ?? c.invoiceNo ?? "").trim()

  // Their invoices now.
  const invoices = new Map<string, FeedInvoice>()
  const unread = new Set<string>()
  let invoicesUrl: string, linesUrl: string
  try {
    invoicesUrl = await withRetry(ctx, () => bcApiUrl(ctx.token, "api/v2.0", "salesInvoices"))
    linesUrl = await withRetry(ctx, () => bcApiUrl(ctx.token, "api/v2.0", "salesInvoiceLines"))
  } catch {
    out.unread = cases.length
    return out
  }
  await eachLimit(chunk(cases.map(keyOf).filter(Boolean), INVOICES_PER_CALL), BC_CONCURRENCY, async (batch) => {
    try {
      for (const inv of await readInvoicesByNumber(ctx, invoicesUrl, batch)) invoices.set(inv.number.toUpperCase(), inv)
    } catch {
      batch.forEach((n) => unread.add(n.toUpperCase()))
    }
  })

  // The lines of those still paid.
  const paid = cases.filter((c) => { const inv = invoices.get(keyOf(c).toUpperCase()); return inv && isPaidInFull(inv) })
  const refsOf = new Map<string, LotRef[]>()
  await eachLimit(chunk(paid.map((c) => invoices.get(keyOf(c).toUpperCase())!.id).filter((id) => GUID.test(id)), INVOICES_PER_CALL), BC_CONCURRENCY, async (batch) => {
    try {
      for (const [id, l] of await readLines(ctx, linesUrl, batch)) refsOf.set(id, l.refs)
    } catch { /* those cases are counted as unread below */ }
  })

  let done = 0
  await eachLimit(cases, BC_CONCURRENCY, async (c) => {
    try {
      const key = keyOf(c).toUpperCase()
      const inv = invoices.get(key)
      if (!inv) { if (unread.has(key) || !key) out.unread++; else out.notInBc++; return }

      if (!isPaidInFull(inv)) {
        if (isNoLongerPaidText(s.lastFeedText.get(c.id))) return   // already said
        await prisma.uncollectedPaidEvent.create({ data: { caseId: c.id, kind: "note", text: noLongerPaidText(inv.number), byId: null, byName: s.byName } })
        s.lastFeedText.set(c.id, noLongerPaidText(inv.number))
        out.flagged++
        return
      }

      const refs = refsOf.get(inv.id)
      // ⚠ A sale box that had to leave sales off ("+2 more") can't show every lot of theirs on the
      // invoice, so "all collected" could never be proved from it — never closed by the check.
      if (salesLeftOff(c.saleCode) > 0) { out.tooManySales++; return }
      const sales = salesOf(c.saleCode)
      if (!refs || !sales.length || !c.buyerNo) { out.unread++; return }
      const rows: Record<string, unknown>[] = []
      for (const sale of sales) rows.push(...await readBuyerSaleRows(ctx, sale, c.buyerNo.trim().toUpperCase()))
      const verdict = droppedVerdict(refs, rows, c.buyerNo)
      if (verdict === "waiting") { out.waiting++; return }
      if (verdict === "unknown") { out.unknown++; return }

      const closedNow = await prisma.$transaction(async (tx) => {
        const n = await tx.uncollectedPaid.updateMany({
          where: { id: c.id, source: "bc", status: c.status },
          data: { status: "collected", closedAt: new Date() },
        })
        if (n.count !== 1) return false   // someone changed it meanwhile — theirs wins
        await tx.uncollectedPaidEvent.create({
          data: {
            caseId: c.id, kind: "status", byId: null, byName: s.byName,
            text: `${STATUS_META[statusOf(c.status)].label} → ${STATUS_META.collected.label} — BC shows the lots collected`,
          },
        })
        return true
      })
      if (closedNow) out.closed++
    } catch (e) {
      if (e instanceof OutOfTime || e instanceof BcError) out.unread++
      else { out.failed++; console.error("uncollected feed: a case couldn't be checked:", e) }
    } finally {
      progress(++done)
    }
  })

  if (out.flagged) notes.push(`${many(out.flagged, "case")} from BC: the invoice no longer shows as paid in BC — said on the case, left open.`)
  if (out.waiting) notes.push(`${many(out.waiting, "case")} from BC still ${out.waiting === 1 ? "has" : "have"} lots waiting but no longer ${out.waiting === 1 ? "meets" : "meet"} the rule today (BC changed the invoice recently, or the sale is over ${UNCOLLECTED_LOOKBACK_MONTHS} months old) — left as ${out.waiting === 1 ? "it is" : "they are"}.`)
  if (out.unknown) notes.push(`${many(out.unknown, "case")} from BC: none of ${out.unknown === 1 ? "its" : "their"} lots could be found under the buyer in BC any more (re-sold or renumbered?) — left open to check by hand.`)
  if (out.notInBc) notes.push(`${many(out.notInBc, "case")} from BC: the invoice couldn't be found in BC — left as ${out.notInBc === 1 ? "it is" : "they are"}.`)
  if (out.tooManySales) notes.push(`${many(out.tooManySales, "case")} from BC ${out.tooManySales === 1 ? "covers" : "cover"} more sales than the case's sale box can hold, so the check can't tell every lot is collected — left open to close by hand.`)
  if (out.unread) notes.push(`${many(out.unread, "case")} from BC couldn't be re-checked this time (BC didn't answer, or the check ran out of time or was stopped) — the next check tries again.`)
  if (out.failed) notes.push(`${many(out.failed, "case")} couldn't be updated — see the server's log.`)
  return out
}

/**
 * Runs the BC check and writes the cases (see the top of this file). Never throws. One at a time:
 * answers { busy: true } while another runs. Missing tables → { notReady: true }, nothing written.
 */
export async function syncUncollected(opts: SyncOptions): Promise<UncollectedSyncResult> {
  const started = new Date()
  const base: UncollectedSyncResult = {
    ok: false, runId: null, partial: false, lotsSeen: 0, buyers: 0, found: 0, added: 0, adopted: 0, updated: 0,
    closed: 0, flaggedUnpaid: 0, notes: [], summary: "", startedAt: started.toISOString(), finishedAt: started.toISOString(),
  }
  const done = (over: Partial<UncollectedSyncResult>): UncollectedSyncResult =>
    ({ ...base, ...over, summary: over.summary ?? over.error ?? "", finishedAt: new Date().toISOString() })
  const trigger: UncollectedSyncTrigger = opts.trigger === "manual" ? "manual" : "nightly"
  const byName = opts.byName?.trim() || null

  // ── One at a time: this process's lock, taken before anything is awaited.
  const cur = lockBox.__uncollectedSync
  if (cur && Date.now() - cur.startedMs < UNCOLLECTED_RUN_STALE_MINUTES * 60_000) {
    return done({ busy: true, error: `A BC check started ${cur.trigger === "nightly" ? "by the nightly run" : `by ${cur.byName ?? "someone"}`} at ${new Date(cur.startedMs).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })} is still running.` })
  }
  const key = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  lockBox.__uncollectedSync = { key, runId: null, startedAt: started.toISOString(), startedMs: started.getTime(), trigger, byName, progress: null, stage: null, stopBy: null }
  const mine = () => lockBox.__uncollectedSync?.key === key
  /** Who pressed Stop on THIS run, or null. */
  const stopBy = () => (mine() ? lockBox.__uncollectedSync!.stopBy : null)
  const setProgress = (p: FeedProgress) => {
    if (mine()) { lockBox.__uncollectedSync!.progress = p.words; lockBox.__uncollectedSync!.stage = p.stage }
    try { opts.onProgress?.(p) } catch { /* ignore */ }
  }

  // What the run has done so far — outside the try, so even an unexpected error records it.
  const counts = { lotsSeen: 0, buyers: 0, found: 0 }
  const tally = { added: 0, adopted: 0, updated: 0, same: 0, leftClosed: 0, failed: 0 }
  const checked = { closed: 0, flagged: 0 }
  const tallies = () => ({
    ...counts, added: tally.added, adopted: tally.adopted, updated: tally.updated + tally.adopted, closed: checked.closed, flaggedUnpaid: checked.flagged,
  })
  const notes: string[] = []

  let runId: string | null = null
  try {
    // ── The tables, and a run the database shows still going (another process, say). A run that
    // started before THIS process booted can't still be running — a restart kills it.
    const bootedAt = Date.now() - process.uptime() * 1000
    const since = new Date(Math.max(Date.now() - UNCOLLECTED_RUN_STALE_MINUTES * 60_000, bootedAt))
    let other: { startedAt: Date; trigger: string; byName: string | null } | null
    try {
      await prisma.uncollectedPaid.findFirst({ select: { id: true } })
      await prisma.uncollectedPaidEvent.findFirst({ select: { id: true } })
      other = await prisma.uncollectedSyncRun.findFirst({
        where: { finishedAt: null, startedAt: { gte: since } },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true, trigger: true, byName: true },
      })
    } catch (e) {
      if (isMissingTable(e)) return done({ notReady: true, error: NOT_READY })
      throw e
    }
    if (other) {
      return done({ busy: true, error: `A BC check started ${other.trigger === "nightly" ? "by the nightly run" : `by ${other.byName ?? "someone"}`} at ${other.startedAt.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })} hasn't finished.` })
    }

    runId = (await prisma.uncollectedSyncRun.create({ data: { trigger, byName, startedAt: started }, select: { id: true } })).id
    if (mine()) lockBox.__uncollectedSync!.runId = runId
    // The run's sequence number (this run's row included) — kept in the database, so it carries on
    // across restarts. It turns round where the buyers start and which dropped cases are re-checked.
    const seq = await prisma.uncollectedSyncRun.count().catch(() => 0)

    const finish = async (r: UncollectedSyncResult): Promise<UncollectedSyncResult> => {
      try {
        await prisma.uncollectedSyncRun.update({
          where: { id: runId! },
          data: {
            finishedAt: new Date(r.finishedAt), ok: r.ok, lotsSeen: r.lotsSeen, buyers: r.buyers, found: r.found,
            added: r.added, updated: r.updated, closed: r.closed,
            note: r.notes.length ? r.notes.join("\n").slice(0, NOTE_MAX) : null,
            error: r.ok ? null : (r.error ?? "It didn't finish.").slice(0, 1000),
          },
        })
      } catch (e) {
        console.error("uncollected feed: the run's record couldn't be saved:", e)
      }
      return r
    }

    if (!opts.token) {
      return finish(done({
        runId,
        error: trigger === "nightly"
          ? "BC isn't connected for background work — the Status Centre's Business Central light says who must sign in to BC."
          : "Your BC sign-in isn't connected — connect BC and press Check BC now again.",
      }))
    }
    try { opts.onStarted?.(runId) } catch { /* ignore */ }

    // ── Read BC.
    const ctx = makeCtx(opts.token, {
      budgetMs: opts.budgetMs ?? (trigger === "nightly" ? MAX_BUDGET_MS : DEFAULT_BUDGET_MS),
      refreshToken: opts.refreshToken,
      onProgress: setProgress,
      isStopped: () => !!stopBy(),
    })
    const f = await find(ctx, { now: opts.now, afterDays: opts.afterDays, lookbackMonths: opts.lookbackMonths, rotation: seq })
    notes.push(...f.notes)
    Object.assign(counts, { lotsSeen: f.lotsSeen, buyers: f.buyers, found: f.candidates.length })

    /** "Stopped by Sam — 3 cases were saved before it stopped (1 new, 2 updated); 9 cases it had found
     *  weren't saved. The next check reads BC again." (UNCOLLECTED_STOPPED_PREFIX starts it.) */
    const stoppedWords = (unsaved: number) => {
      const saved = tally.added + tally.adopted + tally.updated
      const what = [tally.added && `${n0(tally.added)} new`, tally.adopted && `${n0(tally.adopted)} taken over`, tally.updated && `${n0(tally.updated)} updated`].filter(Boolean).join(", ")
      return `${UNCOLLECTED_STOPPED_PREFIX} ${stopBy() ?? "someone"} — ${saved ? `${many(saved, "case")} ${saved === 1 ? "was" : "were"} saved before it stopped (${what})` : "nothing was changed"}${unsaved ? `; ${many(unsaved, "case")} it had found ${unsaved === 1 ? "wasn't" : "weren't"} saved` : ""}. The next check reads BC again.`
    }

    if (!f.lotsComplete) {
      return finish(done({
        runId, partial: true, notes, ...tallies(), stopped: ctx.stopped || undefined,
        error: ctx.stopped
          ? stoppedWords(0)
          : `BC's list of uncollected lots couldn't be read in full${f.firstError ? ` (${f.firstError})` : ""} — nothing was changed.`,
      }))
    }

    // ── The cases BC already holds that are open, and what the check last said on each.
    const openBc: OpenBcCase[] = await prisma.uncollectedPaid.findMany({
      where: { source: "bc", status: { notIn: CLOSED_STATUSES } },
      select: { id: true, bcKey: true, invoiceNo: true, buyerNo: true, saleCode: true, status: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    })
    const lastFeedText = new Map<string, string | null>()
    for (const ids of chunk(openBc.map((c) => c.id), 500)) {
      const evs = await prisma.uncollectedPaidEvent.findMany({
        where: { caseId: { in: ids }, byId: null },
        orderBy: [{ caseId: "asc" }, { at: "desc" }],
        distinct: ["caseId"],
        select: { caseId: true, text: true },
      })
      for (const e of evs) lastFeedText.set(e.caseId, e.text)
    }
    const s: SaveCtx = { today: f.today, byName: feedName(trigger, byName), lastFeedText, adoptedIds: new Set() }

    // ── Save every candidate — until a Stop, or the run has gone on so long that a second one
    // could be let in (SAVE_STOP_MS); either way what's saved stays saved.
    const saveStopAt = started.getTime() + SAVE_STOP_MS
    let unsaved = 0
    let outOfSaveTime = false
    for (let i = 0; i < f.candidates.length; i++) {
      if (stopBy() || Date.now() > saveStopAt) {
        unsaved = f.candidates.length - i
        outOfSaveTime = !stopBy()
        break
      }
      try {
        tally[await saveCandidate(f.candidates[i], s)]++
      } catch (e) {
        tally.failed++
        console.error(`uncollected feed: invoice ${f.candidates[i].invoiceNo} couldn't be saved:`, e)
      }
      setProgress({ stage: "saving", done: i + 1, total: f.candidates.length, words: `Saving cases — ${n0(i + 1)} of ${n0(f.candidates.length)}` })
    }
    if (tally.adopted) notes.push(`${many(tally.adopted, "case")} added by hand ${tally.adopted === 1 ? "was" : "were"} matched to ${tally.adopted === 1 ? "its" : "their"} BC invoice and taken over (staff notes, status and chase dates kept).`)
    if (tally.leftClosed) notes.push(`${many(tally.leftClosed, "invoice")} still ${tally.leftClosed === 1 ? "shows" : "show"} lots not collected in BC, but ${tally.leftClosed === 1 ? "its case was" : "their cases were"} closed in the Hub — left closed.`)
    if (tally.failed) notes.push(`${many(tally.failed, "case")} couldn't be saved — see the server's log. The next check tries again.`)
    if (outOfSaveTime) notes.push(`The check ran so long that ${many(unsaved, "case")} it found ${unsaved === 1 ? "wasn't" : "weren't"} saved — the next check saves ${unsaved === 1 ? "it" : "them"}.`)

    // ── Open cases from BC it didn't find this time — judged only for buyers it fully checked, and
    // not after a Stop or when the time is up. At most DROPPED_CHECK_LIMIT a run, turning round from
    // run to run (pickDropped) so every one is reached in turn.
    let unreadDropped = 0
    if (!stopBy() && !ctx.stopped && !outOfSaveTime) {
      const foundKeys = new Set(f.candidates.map((c) => c.invoiceNo.toUpperCase()))
      const unchecked = new Set(f.uncheckedBuyers.map((b) => b.toUpperCase()))
      const dropped = openBc.filter((c) => {
        const k = (c.bcKey ?? c.invoiceNo ?? "").toUpperCase()
        return k && !foundKeys.has(k) && !unchecked.has((c.buyerNo ?? "").trim().toUpperCase())
      })
      const { pick, later } = pickDropped(dropped, new Set(f.buyerNos), seq, DROPPED_CHECK_LIMIT)
      if (later) notes.push(`${many(later, "more case")} from BC ${later === 1 ? "waits" : "wait"} to be re-checked — the check re-checks ${DROPPED_CHECK_LIMIT} a run, taking them in turn.`)
      const d = await checkDropped(ctx, pick, s, notes)
      checked.closed = d.closed
      checked.flagged = d.flagged
      tally.failed += d.failed
      unreadDropped = d.unread
    }

    if (stopBy() || ctx.stopped) {
      return finish(done({ runId, partial: true, stopped: true, notes, ...tallies(), summary: syncResultWords(tallies()), error: stoppedWords(unsaved) }))
    }

    const partial = f.partial || unreadDropped > 0 || ctx.outOfTime || outOfSaveTime
    if (ctx.outOfTime && !notes.some((n) => n.includes("time"))) notes.push("The time allowed for the check ran out before everything was read.")
    const ok = !partial && tally.failed === 0
    return finish(done({
      runId, partial, notes, ok, ...tallies(),
      // The sentence the panel shows — the same words as its "last checked" line.
      summary: syncResultWords(tallies()),
      error: ok ? undefined : partial
        ? `Didn't check everything${f.firstError ? ` (${f.firstError})` : ctx.outOfTime || outOfSaveTime ? " (the time allowed ran out)" : ""}. What it found was saved; the next check reads BC again.`
        : `${many(tally.failed, "case")} couldn't be saved — the next check tries again.`,
    }))
  } catch (e) {
    console.error("uncollected feed error:", e)
    const r = done({ runId, notes, ...tallies(), error: "The BC check stopped with an unexpected error — see the server's log." })
    if (runId) {
      // What it had done before the error is recorded too (cases added or updated stay added).
      await prisma.uncollectedSyncRun.update({
        where: { id: runId },
        data: {
          finishedAt: new Date(), ok: false, error: r.error,
          lotsSeen: counts.lotsSeen, buyers: counts.buyers, found: counts.found,
          added: tally.added, updated: tally.updated + tally.adopted, closed: checked.closed,
          note: notes.length ? notes.join("\n").slice(0, NOTE_MAX) : null,
        },
      }).catch((err) => console.error("uncollected feed: the run's record couldn't be saved:", err))
    }
    return r
  } finally {
    if (mine()) lockBox.__uncollectedSync = undefined
  }
}

/**
 * Starts a check and answers as soon as it is under way (its run row written), leaving it running —
 * or, if it couldn't start (busy, not ready, no BC sign-in), with why. `done` settles when it
 * finishes and never rejects. For the cron route and Check BC now: neither should hold a request
 * open for the whole check.
 */
export async function startUncollectedSync(opts: SyncOptions): Promise<
  | { started: true; runId: string; done: Promise<UncollectedSyncResult> }
  | { started: false; result: UncollectedSyncResult }
> {
  let resolveStart: (runId: string) => void = () => {}
  const startedP = new Promise<string>((r) => { resolveStart = r })
  const done = syncUncollected({ ...opts, onStarted: (id) => { try { opts.onStarted?.(id) } finally { resolveStart(id) } } })
  const first = await Promise.race([
    startedP.then((runId) => ({ runId }) as const),
    done.then((result) => ({ result }) as const),
  ])
  return "runId" in first ? { started: true, runId: first.runId, done } : { started: false, result: first.result }
}

// ─── For the case page: a buyer's lots in a sale, live from BC ──────────────────────────────

/** At most this many sales are read for one case page (one BC call each, one after another). */
const CASE_PAGE_MAX_SALES = 4

/**
 * Every lot BC shows as sold to `buyerNo` in the case's sale(s) (hammer over £0, not withdrawn) —
 * collected and not — read live, for a case page. `saleCode` is the case's sale box as it stands:
 * one sale ("F067"), or several when one invoice covered more than one ("F067, F068" — split with
 * salesOf; a "+N more" the box had to leave off is counted in salesLeftOut). At most
 * CASE_PAGE_MAX_SALES sales are read, one after another inside one 45-second budget, and at most
 * `limit` lots (default 300) are answered. Read only. Throws a plain message if BC can't be read
 * (BC's own status — 401, 403, 429, 503 — stays in it, for the page to put into words).
 */
export async function bcLotsForBuyer(token: string, saleCode: string, buyerNo: string, limit = 300): Promise<UncollectedBcLots> {
  const all = salesOf(saleCode)
  const sales = all.slice(0, CASE_PAGE_MAX_SALES)
  const salesLeftOut = all.length - sales.length + salesLeftOff(saleCode)
  const buyer = buyerNo.trim().toUpperCase()
  const ctx = makeCtx(token, { budgetMs: 45_000 })
  const rows: Record<string, unknown>[] = []
  try {
    for (const sale of sales) rows.push(...await readBuyerSaleRows(ctx, sale, buyer))
  } catch (e) {
    throw new Error(e instanceof OutOfTime ? "BC took too long to answer — try again." : (e as Error).message)
  }
  const order = (code: string | null) => { const i = sales.indexOf((code ?? "").toUpperCase()); return i < 0 ? sales.length : i }
  const seen = new Set<string>()
  const sold = rows
    .filter((r) => Number(r.EVA_HammerPrice ?? 0) > 0 && !bcTrue(r.EVA_WithdrawLot))
    .map((r) => ({
      uniqueId: String(r.EVA_UniqueID ?? "").trim() || null,
      lotNo: lotNoOf(r.EVA_LotNo, r.EVA_LotSuffix) || "?",
      description: String(r.EVA_ShortDescription ?? "").replace(/\s+/g, " ").trim() || null,
      hammer: Number.isFinite(Number(r.EVA_HammerPrice)) ? Number(r.EVA_HammerPrice) : null,
      collected: bcTrue(r.EVA_Collected),
      saleCode: String(r.EVA_AuctionNo ?? "").trim().toUpperCase() || null,
      saleName: String(r.EVA_AuctionName ?? "").trim() || null,
      saleDate: bcDay(r.EVA_AuctionDate) || null,
    }))
    // The same lot twice (a page boundary that moved under us) is listed once.
    .filter((l) => { const k = l.uniqueId ? `u:${l.uniqueId.toUpperCase()}` : `l:${l.saleCode}:${l.lotNo}`; if (seen.has(k)) return false; seen.add(k); return true })
    .sort((a, b) => order(a.saleCode) - order(b.saleCode) || a.lotNo.localeCompare(b.lotNo, "en", { numeric: true }))
  return {
    buyerNo: buyer, saleCode: sales.join(", "), sales, salesLeftOut,
    lots: sold.slice(0, limit), more: sold.length > limit, readAt: new Date().toISOString(),
  }
}
