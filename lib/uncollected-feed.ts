// Accounts → Paid, not collected — the BC check that fills the panel. SERVER ONLY.
//
// Jack, 2026-10-22: "Now I need this data to be automatically populated so it triggers 4 weeks after
// they paid for us to chase … only paid things that haven't been collected for over 4 weeks."
//
// A case is due when a lot was SOLD (hammer > 0, not withdrawn), its buyer's invoice covering it is
// PAID with nothing remaining, the lot is NOT GONE, and at least UNCOLLECTED_AFTER_DAYS London days
// have passed since the paid day. One case per invoice (bcKey = the invoice number). The matching
// rules are lib/uncollected-feed-match.ts (pure, and re-exported from here); this file reads BC and
// writes the cases.
//
// ⚠ GONE = BC's Collected tick (EVA_Collected) OR the lot's current location is one of
// GONE_LOCATIONS (lib/uncollected.ts). The tick is a FlowField set only when the lot's collection
// docket is POSTED, and staff often scan lots to COLLECTED without posting it (Jack, 2026-10-23:
// "lot 513 has been collected and so has 551"). So the check also reads each lot's location from
// Receipt_Lines_Excel (≤ 20 unique ids a call) and treats a GONE location exactly like the tick; a
// QUERY_LOCATIONS lot isn't charged or counted and is flagged on its case. A lot with no receipt line
// (or no unique id, or lines that disagree), and every lot once BC refuses locations outright, is
// judged on the tick alone (the run's notes say how many). A buyer whose locations BC didn't answer
// for, or weren't read before the time ran out, isn't judged that run at all (never on a half-read).
//
//  • ⚠⚠ BC IS READ ONLY. Every call here is a GET through lib/bc.ts (bcPageWithNext, bcApiUrl,
//    bcODataUrl). Nothing is ever written to Business Central.
//  • What BC is asked (all verified live 2026-10-22):
//      1. Auction_Lines_Excel (ODataV4): the uncollected sold lots of sales in the last
//         UNCOLLECTED_LOOKBACK_MONTHS, up to UNCOLLECTED_AFTER_DAYS ago — paged by @odata.nextLink.
//      2. salesInvoices (api/v2.0): those buyers' invoices, ≤ 20 buyers a call.
//      3. salesInvoiceLines (api/v2.0): the lines of the invoices that matter, ≤ 20 invoices a call
//         (one at a time if BC refuses the batch) — "Buyer Premium for Lot No 366" names a lot.
//      4. Receipt_Lines_Excel (ODataV4): where those buyers' lots are now (EVA_ArticleLocationCode,
//         EVA_ArticleBinCode), `EVA_UniqueID eq '…' or …`, ≤ 20 a call (one at a time if BC refuses
//         the batch) — read for each buyer straight after the last of its invoice lines
//         (readLinesThenPlaces), so a run that runs out of time still judges the buyers it got
//         through. Also read for the cases it re-checks, and for the case page's lot list.
//    At most 3 calls at once, backing off on 429/503, inside a whole-run time budget (25 minutes for
//    the nightly run, 12 for Check BC now). Each run starts at a different buyer (the run's sequence
//    number moves the start), so runs that keep running out of time still reach every buyer in turn.
//  • The PAID DATE: BC's published feeds carry no payment date (Customer Ledger Entries isn't
//    published), so a paid invoice's lastModifiedDateTime — BC's settling run, ~07:54 the morning
//    after — gives the London day it was settled. They paid ON OR BEFORE it: "Paid by". BC does hold
//    the exact day per lot (EVA_AuctionLine field 153 EVA_DatePaidByBuyer); once per run the check
//    reads ONE Auction_Lines_Excel row with no $select and, if the key is there, asks for it and uses
//    the lots' own paid date (the latest of the invoice's lots) instead: "Paid on (BC)". ⚠ Never put
//    a field in a $select before a row has shown it — BC refuses the whole request (400).
//  • The feed writes only BC_OWNED_FIELDS, plus email / phone when the case has none, plus the
//    STORAGE START by the rule (the day after paid day + the free days in UncollectedSettings) — only
//    while no person has set it (storageStartOwner; "by the storage rule" on the timeline). A case's
//    status, notes, chase date (except a new case's first one), a storage start a person set and
//    timeline are the staff's. Storage MONEY is never written anywhere — it is worked out live.
//    It takes the SAME invoice lock as lib/actions/uncollected.ts before it adds or takes over a case,
//    then the storage settings lock (shared) and reads the free days inside that same transaction
//    (lib/uncollected-settings.ts), so an admin changing them mid-run is followed, never undone.
//  • A case it closes as COLLECTED is closed on the day of the check's previous full read of BC — the
//    last day the lots could have been seen still here — not the moment it noticed (collectedStopOf):
//    BC keeps no collected date, and storage counts the day a case closes.
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
  CLOSED_STATUSES, STATUS_META, UNCOLLECTED_AFTER_DAYS, UNCOLLECTED_LOOKBACK_MONTHS,
  UNCOLLECTED_RUN_STALE_MINUTES, UNCOLLECTED_STOPPED_PREFIX, dayToStored, isOpenRaw, londonDay, lotState, statusOf,
  syncResultWords,
  type UncollectedBcLot, type UncollectedBcLots, type UncollectedSyncTrigger,
} from "@/lib/uncollected"
import {
  graceDaysInTx, lockStorageSettingsShared, readPaidExact, readStorageSettings, readStorageStartOwner,
} from "@/lib/uncollected-settings"
import {
  BC_PAID_DATE_FIELD, PLACES_PER_CALL, QUERY_CLEAR_START, QUERY_FLAG_START, RECEIPT_LINE_SELECT, addedText, bcDay, bcTrue, chunk,
  cleanEmail, closedByLocation, collectedCloseText, collectedStopFrom, cleanPhone, droppedEvidence, droppedFromRun, droppedLots, droppedNeedsTicked, eachLimit, feedChanges,
  hasPaidDateField, invoicesNeedingLines, isNoLongerPaidText, isPaidInFull, isQueryClearText, isQueryFlagText, locationCounts,
  lotNoOf, lotRefsFromLines, matchBuyer, matchedText, nextQueryFlag, noLongerPaidText, noPlacesRead, odataString, ownedValues, pickDropped,
  placeKey, placesFromRows, readLinesThenPlaces, rotate, saleWindow, salesLeftOff, salesOf, salesUnparsed, splitByPlace, storageStamp, toFeedInvoice, toFeedLot,
  toTickedLot, updatedText, withPlaces,
  type BuyerToRead, type Candidate, type DroppedEvidence, type FeedChange, type FeedChangeOptions, type FeedInvoice, type FeedLot, type InvoiceLines,
  type JudgedBuyer, type LotPlace, type LotRef, type PlacesRead, type TickedLot,
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

/** ⚠ Only fields verified on Auction_Lines_Excel (2026-10-22). BC_PAID_DATE_FIELD is added for a run
 *  only once that run's probe row has shown it (find → paidDatesPublished). */
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

export type FeedStage = "lots" | "invoices" | "lines" | "locations" | "saving" | "checking"

/** Where a run is, for the panel ("Reading invoices — 120 of 312 buyers"). Counts only — no names. */
export type FeedProgress = { stage: FeedStage; done: number; total: number | null; words: string }

type Ctx = {
  token: string
  deadline: number
  calls: number
  outOfTime: boolean
  /** BC refused a batched documentId filter once — read lines one invoice at a time from then on. */
  linesOneByOne: boolean
  /** BC refused a batched EVA_UniqueID filter on Receipt_Lines_Excel once — one id at a time from then on. */
  placesOneByOne: boolean
  /** BC refused even one id on its own (400) — locations can't be read this run; why. */
  placesBroken: string | null
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

function makeCtx(token: string, opts: {
  budgetMs?: number
  refreshToken?: () => Promise<string | null>
  onProgress?: (p: FeedProgress) => void
  isStopped?: () => boolean
}): Ctx {
  const budget = Math.min(MAX_BUDGET_MS, Math.max(30_000, opts.budgetMs ?? DEFAULT_BUDGET_MS))
  return {
    token, deadline: Date.now() + budget, calls: 0, outOfTime: false, linesOneByOne: false, placesOneByOne: false, placesBroken: null,
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

/**
 * Lots BC TICKED collected in one sale, sold to any of `buyers` (up to BUYERS_PER_CALL) — ONE call,
 * for the quick re-check (droppedFromRun): a case whose invoice has lots ticked as well as lots scanned
 * out can then close without its own re-check. BC refusing the batched filter (400) → one buyer at a
 * time (readBuyerSaleRows). Throws on failure (BcError, OutOfTime / Stopped).
 */
async function readTickedFor(ctx: Ctx, sale: string, buyers: string[]): Promise<Record<string, unknown>[]> {
  const base = bcODataUrl("Auction_Lines_Excel")
  const anyOf = buyers.map((b) => `EVA_BuyerNo eq ${odataString(b)}`).join(" or ")
  try {
    return await readAll(ctx, base, {
      $filter: `EVA_AuctionNo eq ${odataString(sale)} and EVA_Collected eq true and (${anyOf})`,
      $select: LOT_SELECT,
    })
  } catch (e) {
    if (!(e instanceof BcError) || e.status !== 400) throw e
    const out: Record<string, unknown>[] = []
    for (const b of buyers) out.push(...(await readBuyerSaleRows(ctx, sale, b)).filter((r) => bcTrue(r.EVA_Collected)))
    return out
  }
}

/**
 * Where each lot is now: Receipt_Lines_Excel's location and bin for up to PLACES_PER_CALL unique
 * ids (`EVA_UniqueID eq '…' or …`). An id with no row isn't in the answer (no receipt line — the
 * caller judges it on the Collected tick alone). Throws on failure (BcError, OutOfTime / Stopped).
 * BC refusing the batched filter (400) → one id at a time from then on; refusing ONE id on its own as
 * well → locations can't be read at all this run (ctx.placesBroken), so no more calls are spent on it.
 */
async function readPlaces(ctx: Ctx, ids: string[]): Promise<{ places: Map<string, LotPlace>; ambiguous: Set<string> }> {
  if (ctx.placesBroken) throw new BcError(ctx.placesBroken, 400)
  const base = bcODataUrl("Receipt_Lines_Excel")
  const ask = (part: string[]) => readAll(ctx, base, {
    $filter: part.map((id) => `EVA_UniqueID eq ${odataString(id)}`).join(" or "),
    $select: RECEIPT_LINE_SELECT,
  })
  const rows: Record<string, unknown>[] = []
  const one = async (id: string) => {
    try {
      rows.push(...await ask([id]))
    } catch (e) {
      if (e instanceof BcError && e.status === 400) ctx.placesBroken = e.message
      throw e
    }
  }
  try {
    if (ctx.placesOneByOne || ids.length === 1) {
      for (const id of ids) await one(id)
    } else {
      try {
        rows.push(...await ask(ids))
      } catch (e) {
        if (!(e instanceof BcError) || e.status !== 400) throw e
        ctx.placesOneByOne = true   // BC won't take a batched filter here — one at a time from now on
        for (const id of ids) await one(id)
      }
    }
  } catch (e) {
    // Refused outright (the sign-in can't read the page, or it isn't published): every other batch
    // would be refused the same way — stop asking this run.
    if (e instanceof BcError && (e.status === 401 || e.status === 403 || e.status === 404)) ctx.placesBroken = e.message
    throw e
  }
  return placesFromRows(rows)
}

/** readPlaces over any number of unique ids, PLACES_PER_CALL a call, `limit` calls at once (at most
 *  BC_CONCURRENCY — pass 1 from inside work that already runs BC_CONCURRENCY at once). Never throws:
 *  a batch that couldn't be read leaves its ids in `timedOut` (the time ran out, or a Stop), `refused`
 *  (BC refuses locations outright this run — ctx.placesBroken) or `failed` (BC didn't answer) —
 *  PlacesRead (lib/uncollected-feed-match.ts) says what each means for the lots. */
async function placesFor(
  ctx: Ctx, uniqueIds: string[], onDone?: (done: number, total: number) => void, limit = BC_CONCURRENCY,
): Promise<PlacesRead> {
  const ids = [...new Map(uniqueIds.map((id) => [placeKey(id), id.trim()] as const)).values()].filter(Boolean)
  const out = noPlacesRead()
  let done = 0
  await eachLimit(chunk(ids, PLACES_PER_CALL), Math.max(1, Math.min(BC_CONCURRENCY, limit)), async (batch) => {
    try {
      if (ctx.outOfTime) throw ctx.stopped ? new Stopped() : new OutOfTime()
      const r = await readPlaces(ctx, batch)
      for (const [k, p] of r.places) out.places.set(k, p)
      for (const k of r.ambiguous) out.ambiguous.add(k)
    } catch (e) {
      const into = e instanceof OutOfTime ? out.timedOut : ctx.placesBroken ? out.refused : out.failed
      for (const id of batch) into.add(placeKey(id))
      if (!(e instanceof OutOfTime) && !out.error) out.error = whyNot(e)
    }
    done += batch.length
    try { onDone?.(done, ids.length) } catch { /* the screen's problem */ }
  })
  return out
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
  /** Buyers with a lot still not gone (upper case) — a buyer NOT here has no lot left in the window
   *  that BC hasn't ticked collected or that isn't at a GONE location (the likely collected ones). */
  buyerNos: string[]
  /** Lots whose location was read (Receipt_Lines_Excel), how many of those are at a GONE location
   *  (treated as collected) or a QUERY one (not charged, flagged), and how many couldn't be read
   *  (judged on BC's Collected tick alone). */
  locations: { read: number; gone: number; query: number; unread: number }
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
  /** "exact" = BC publishes each lot's own paid date (EVA_DatePaidByBuyer) and the candidates use it;
   *  "settled" = a row showed it isn't published, and the day BC settled each invoice stands in;
   *  "unknown" = it couldn't be told this run (the one-row probe failed, or BC showed the field but
   *  refused to send it): the candidates carry the settled date, and ⚠ the save leaves the paid date
   *  (and the storage start) of a case already on BC's own paid date alone — a passing fault must
   *  never flip cases from "Paid on" to "Paid by" and back (SaveCtx.holdExact). */
  paidDates: "exact" | "settled" | "unknown"
  /** Every buyer judged in full this run (upper case) → what was read for them: their lots BC hasn't
   *  ticked, with where each is, and their invoices with the lot numbers on each — so the sync can
   *  close an open case whose lots have all gone without asking BC again (droppedFromRun). */
  judged: Map<string, JudgedBuyer>
}

/**
 * Does BC publish each lot's own paid date yet? ONE row of Auction_Lines_Excel with no $select (all
 * 59-odd fields), and whether BC_PAID_DATE_FIELD is among its keys. Answers false when it isn't, or
 * when BC sent no row; throws when BC couldn't be read (the caller says so and carries on without it).
 */
async function paidDatesPublished(ctx: Ctx): Promise<boolean> {
  const url = withQuery(bcODataUrl("Auction_Lines_Excel"), { $top: "1" })
  const page = await withRetry(ctx, () => bcPageWithNext(ctx.token, url))
  return hasPaidDateField(((page.rows ?? []) as unknown[])[0])
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
  let paidDates: FindResult["paidDates"] = "settled"
  const result = (over: Partial<FindResult>): FindResult => ({
    candidates: [], lotsSeen: 0, buyers: 0, buyerNos: [], locations: { read: 0, gone: 0, query: 0, unread: 0 }, partial: true, notes,
    lotsComplete: false, uncheckedBuyers: [], today, window: win, invoicesRead: 0, calls: ctx.calls, firstError: null, paidDates, judged: new Map(), ...over,
  })

  // 0. Does BC publish each lot's own paid date yet? (Asked once a run — Jordan can add it to the
  // Auction_Lines_Excel page at any time; until then the settled date stands in.) ⚠ "Couldn't tell" is
  // NOT "not published": it is "unknown", and the save then leaves cases already on BC's own paid date
  // as they are rather than flipping them to the settled date for a run.
  try {
    paidDates = (await paidDatesPublished(ctx)) ? "exact" : "settled"
  } catch (e) {
    if (e instanceof OutOfTime) {
      notes.push(`BC's list of uncollected lots couldn't be read (${whyNot(e)}) — nothing was decided.`)
      return result({})
    }
    paidDates = "unknown"
    notes.push(`Couldn't tell whether BC publishes each lot's own paid date (${whyNot(e)}) — new cases used the day BC settled the invoice, and cases already on BC's own paid date were left on it.`)
  }

  // 1. The uncollected sold lots of the window.
  let rows: Record<string, unknown>[]
  const readLots = () => readAll(ctx, bcODataUrl("Auction_Lines_Excel"), {
    $filter: `EVA_Collected eq false and EVA_HammerPrice gt 0 and EVA_AuctionDate le ${win.to} and EVA_AuctionDate ge ${win.from}`,
    $select: paidDates === "exact" ? `${LOT_SELECT},${BC_PAID_DATE_FIELD}` : LOT_SELECT,
  }, (n) => progress({ stage: "lots", done: n, total: null, words: `Reading uncollected lots from BC — ${n0(n)} so far` }))
  try {
    try {
      rows = await readLots()
    } catch (e) {
      // BC showed the paid date's key but won't take it in a $select: read as before, without it,
      // rather than fail every run until someone looks.
      if (paidDates !== "exact" || !(e instanceof BcError) || e.status !== 400) throw e
      paidDates = "unknown"
      notes.push(`BC shows each lot's own paid date (${BC_PAID_DATE_FIELD}) but refused to send it (${whyNot(e)}) — new cases used the day BC settled the invoice, and cases already on BC's own paid date were left on it.`)
      rows = await readLots()
    }
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
    // ⚠ The whole lot line, never the unique id alone: an item re-entered and sold again keeps its
    // unique id, so two real lines can share one — dropping one hid a lot that was still here and let
    // the quick re-check close its buyer's case (review of 2026-10-23).
    const key = `${lot.uniqueId ? `u:${lot.uniqueId.toUpperCase()}` : "l"}:${lot.saleCode.toUpperCase()}:${lot.lotNo}:${lot.buyerNo}`
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

  // 4. The lines of every invoice that could matter (see invoicesNeedingLines), and — straight after
  // the last of a buyer's invoices is read — where that buyer's lots are now (Receipt_Lines_Excel):
  // readLinesThenPlaces, buyer by buyer in the run's turn order. ⚠ Interleaved on purpose: with every
  // location read after every invoice's lines, a run whose time ran out during the lines judged no
  // buyer at all, and runs that kept running out never reached anyone. Now each buyer whose lines
  // and locations were both read is judged, and the rotation moves the start on.
  // Locations are read only for the buyers who could have a case. A lot at a GONE location counts
  // exactly like BC's Collected tick (the docket is often never posted); one at a QUERY location
  // isn't charged. A lot with no unique id, no receipt line, or receipt lines that disagree is judged
  // on the tick alone, as before; so is every lot once BC refuses locations outright this run
  // (`refused`). But a buyer whose locations BC didn't answer for (`failed`), or weren't read because
  // the time ran out or a Stop came (`timedOut`), isn't judged this run at all — on the tick alone its
  // cases would count lots that have gone, and the next good run would take them off again.
  const toRead: BuyerToRead[] = []
  for (const b of buyers) {
    if (unchecked.has(b)) continue
    const need = invoicesNeedingLines(invoicesOf.get(b) ?? [], today, afterDays, byBuyer.get(b))
    if (!need.length) continue
    const bad = need.find((inv) => !GUID.test(inv.id))
    if (bad) { miss([b], new Error(`invoice ${bad.number} has an id BC's lines can't be asked for`)); continue }
    const ids = new Map<string, string>()   // placeKey → the unique id as BC wrote it
    for (const l of byBuyer.get(b)!) if (l.uniqueId) ids.set(placeKey(l.uniqueId), l.uniqueId)
    toRead.push({ buyer: b, invoiceIds: need.map((i) => i.id), uniqueIds: [...ids.values()] })
  }
  // placeKey → every buyer with a lot carrying it (an item re-entered and sold again keeps its unique
  // id, so two buyers can share one — a failed read of it must hold back both).
  const idOwner = new Map<string, Set<string>>()
  for (const t of toRead) for (const id of t.uniqueIds) {
    const k = placeKey(id)
    if (!idOwner.has(k)) idOwner.set(k, new Set())
    idOwner.get(k)!.add(t.buyer)
  }
  const read = await readLinesThenPlaces(toRead, {
    readLines: async (ids) => {
      if (ctx.outOfTime) throw ctx.stopped ? new Stopped() : new OutOfTime()
      return readLines(ctx, linesUrl, ids)
    },
    // One call at a time: the line batches are already read BC_CONCURRENCY at once.
    readPlaces: (ids) => placesFor(ctx, ids, undefined, 1),
    linesFailed: (bs, e) => miss(bs, e),
    progress: (p) => progress({
      stage: "lines", done: p.invoicesDone, total: p.invoices,
      words: `Reading invoice lines and where the lots are — ${n0(p.invoicesDone)} of ${n0(p.invoices)} invoices, ${n0(p.buyersPlaced)} of ${n0(p.buyers)} buyers done`,
    }),
  }, { perCall: INVOICES_PER_CALL, concurrency: BC_CONCURRENCY })
  const lines: Map<string, InvoiceLines> = read.lines
  const pr: PlacesRead = read.places
  const ownersOf = (keys: Set<string>) => [...new Set([...keys].flatMap((k) => [...(idOwner.get(k) ?? [])]))]
  if (pr.timedOut.size) miss(ownersOf(pr.timedOut), ctx.stopped ? new Stopped() : new OutOfTime())
  if (pr.failed.size) miss(ownersOf(pr.failed), new Error(`where their lots are couldn't be read in BC${pr.error ? ` (${pr.error})` : ""}`))
  if (pr.refused.size && !firstError) firstError = `where the lots are couldn't be read (${ctx.placesBroken ?? pr.error ?? "BC refused"})`
  const placed = read.placed

  // 5–6. Match, buyer by buyer — with the GONE lots taken out first (splitByPlace).
  const candidates: Candidate[] = []
  const fallback: string[] = []
  let notLotInvoices = 0
  let settledFallback = 0
  const goneLots: FeedLot[] = []
  const queryLots: FeedLot[] = []
  const unread = { noId: 0, refused: 0, notFound: 0, ambiguous: 0 }
  let placesRead = 0
  const stillHere = new Set(buyers)
  const judged = new Map<string, JudgedBuyer>()
  for (const b of buyers) {
    if (unchecked.has(b)) continue
    const invs = invoicesOf.get(b) ?? []
    if (invoicesNeedingLines(invs, today, afterDays, byBuyer.get(b)).some((i) => !lines.has(i.id))) {
      miss([b], new Error("some of their invoice lines weren't read"))
      continue
    }
    let lotsNow = byBuyer.get(b)!
    if (placed.has(b)) {
      lotsNow = withPlaces(lotsNow, pr.places)
      for (const l of lotsNow) {
        if (l.location != null) { placesRead++; continue }
        const k = placeKey(l.uniqueId)
        if (!k) unread.noId++
        else if (pr.refused.has(k)) unread.refused++
        else if (pr.ambiguous.has(k)) unread.ambiguous++
        else unread.notFound++
      }
    }
    // What was read for them — the sync's quick re-check of their open cases (droppedFromRun).
    judged.set(b, {
      lots: lotsNow,
      invoices: new Map(invs.map((inv) => [inv.number.trim().toUpperCase(), { invoice: inv, refs: lines.get(inv.id)?.refs ?? null }])),
    })
    const split = splitByPlace(lotsNow)
    goneLots.push(...split.gone)
    queryLots.push(...split.query)
    if (!split.kept.length) stillHere.delete(b)
    // The gone lots only help choose the sale of an invoice with no lot numbers (matchBuyer).
    const m = matchBuyer(split.kept, invs, lines, { today, afterDays, gone: split.gone })
    candidates.push(...m.candidates)
    fallback.push(...m.fallback.map((f) => `${f.invoiceNo} (${f.saleCode})`))
    notLotInvoices += m.notLotInvoices
    settledFallback += m.settledFallback
  }
  const unreadLots = unread.noId + unread.refused + unread.notFound + unread.ambiguous
  if (goneLots.length) {
    notes.push(`${many(goneLots.length, "lot")} BC hasn't ticked as collected ${goneLots.length === 1 ? "is" : "are"} at a location that means ${goneLots.length === 1 ? "it has" : "they have"} gone (${locationCounts(goneLots)}) — counted as collected, the same as the tick.`)
  }
  if (queryLots.length) {
    notes.push(`${many(queryLots.length, "lot")} ${queryLots.length === 1 ? "is" : "are"} at a query location in BC (${locationCounts(queryLots)}) — not charged or counted, and ${queryLots.length === 1 ? "its case says" : "their cases say"} to check ${queryLots.length === 1 ? "it" : "them"} before chasing.`)
  }
  if (unreadLots) {
    const why = [
      unread.noId && `${n0(unread.noId)} with no unique ID`,
      unread.notFound && `${n0(unread.notFound)} with no receipt line in BC`,
      unread.ambiguous && `${n0(unread.ambiguous)} whose receipt lines disagree`,
      unread.refused && `${n0(unread.refused)} because BC refused to give locations this time — ${ctx.placesBroken ?? pr.error ?? "no reason given"}`,
    ].filter(Boolean).join("; ")
    notes.push(`Where ${many(unreadLots, "lot")} ${unreadLots === 1 ? "is" : "are"} couldn't be read in BC, so BC's Collected tick alone was used for ${unreadLots === 1 ? "it" : "them"} (${why}).`)
  }
  if (paidDates === "exact") {
    const exact = candidates.filter((c) => c.paidExact).length
    notes.push(`BC publishes each lot's own paid date (${BC_PAID_DATE_FIELD}), so ${many(exact, "case")} ${exact === 1 ? "uses" : "use"} it ("Paid on")${settledFallback ? `; ${many(settledFallback, "invoice")} whose lots had none in BC used the day BC settled the invoice ("Paid by")` : ""}.`)
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
    candidates, lotsSeen, buyers: buyers.length, buyerNos: buyerNos.filter((b) => stillHere.has(b)),
    locations: { read: placesRead, gone: goneLots.length, query: queryLots.length, unread: unreadLots },
    // Locations BC refused to give mean part of the check wasn't done properly — said, not hidden.
    // (A buyer whose locations BC didn't answer for isn't judged at all — it is in `unchecked`.)
    partial: unchecked.size > 0 || unread.refused > 0, notes, lotsComplete: true,
    uncheckedBuyers: [...unchecked.keys()], today, window: win, invoicesRead, calls: ctx.calls, firstError, paidDates, judged,
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
  // Only ever by the storage rule, and only while no person set it (storageStamp).
  if (has("storageFrom")) d.storageFrom = set.storageFrom ? dayToStored(String(set.storageFrom)) : null
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
  /** true = the settings table is there: each save reads the free days INSIDE its own transaction,
   *  under the settings lock (lockStorageSettingsShared + graceDaysInTx), so a change an admin saves
   *  part-way through a run is followed, never undone. false = `graceDays` below is used. */
  settingsInTx: boolean
  /** The free days when settingsInTx is false: the standard ones before Run Migrations, or null when
   *  the settings couldn't be read this run (then no storage start is set or moved). */
  graceDays: number | null
  /** Whether each open case from BC's paid date is BC's own now (readPaidExact; missing = not said).
   *  null = it couldn't be read this run — then a switch isn't said (rather than said on every case). */
  paidExactOf: Map<string, boolean> | null
  /** The paid-date probe couldn't tell this run (FindResult.paidDates "unknown"): a case already on BC's
   *  own paid date — or one whose kind couldn't be read — keeps its paid date and the storage start
   *  that hangs on it (FeedChangeOptions.holdPaid). */
  holdExact: boolean
  /** Where the clock stops on a case closed because BC shows its lots collected (collectedStopOf). */
  collectedStop: { day: string; closedAt: Date }
}

type SaveOutcome = "added" | "adopted" | "updated" | "same" | "leftClosed"

/** One candidate, in one transaction, under the invoice's lock:
 *  1. the case BC already holds for the invoice → its BC fields brought up to date (closed: left);
 *  2. else an OPEN case added by hand for the same invoice → taken over;
 *  3. else a case for the invoice that was CLOSED by hand → left alone (the staff's decision stands);
 *  4. else an OPEN case added by hand for the same buyer + sale with no invoice number → taken over;
 *     else a CLOSED one like that → left alone, the same rule as 3 (a hand case with no invoice
 *     number stands for the buyer's whole sale);
 *  5. else a new case, waiting, first chase today, storage from the rule's day.
 *  In 1, 2 and 4 the storage start is set (or moved) by the rule only while no person has set it.
 *  ⚠ 3 and 4's "closed by hand → left alone" waits on Jack's confirmation (RULES.md); change both together. */
async function saveCandidate(c: Candidate, s: SaveCtx): Promise<SaveOutcome> {
  const v = ownedValues(c)
  const customerId = await matchCustomer(v.buyerNo)
  const closed = Prisma.join(CLOSED_STATUSES)
  const sales = salesOf(v.saleCode)

  return prisma.$transaction(async (tx) => {
    await lockInvoice(tx, v.invoiceNo)
    // The settings lock, shared, and the free days as they stand NOW (lib/uncollected-settings.ts) —
    // a change saved part-way through the run is followed, never undone by this save.
    await lockStorageSettingsShared(tx)
    const graceDays = s.settingsInTx ? await graceDaysInTx(tx) : s.graceDays
    const storageFor = async (caseId: string): Promise<FeedChangeOptions["storage"]> =>
      graceDays == null ? null : { owner: await readStorageStartOwner(tx, caseId), graceDays }
    /** The case's lots at a QUERY location, flagged on its timeline — only when they changed since the
     *  check's last flag (or all-clear) line on it (nextQueryFlag), so a second run writes nothing.
     *  Answers whether a line was written. */
    const flagQuery = async (caseId: string): Promise<boolean> => {
      const prev = await tx.uncollectedPaidEvent.findFirst({
        where: {
          caseId, byId: null, kind: "note",
          OR: [{ text: { startsWith: QUERY_FLAG_START } }, { text: { startsWith: QUERY_CLEAR_START } }],
        },
        orderBy: [{ at: "desc" }, { id: "desc" }],
        select: { text: true },
      })
      const last = prev && (isQueryFlagText(prev.text) || isQueryClearText(prev.text)) ? prev.text : null
      const text = nextQueryFlag(last, c)
      if (!text) return false
      // Stamped now, so it sorts after the line this save just wrote.
      await tx.uncollectedPaidEvent.create({ data: { caseId, kind: "note", text, byId: null, byName: s.byName, at: new Date() } })
      s.lastFeedText.set(caseId, text)
      return true
    }

    // 1. Ours already.
    const [own] = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "UncollectedPaid" WHERE lower("bcKey") = lower(${v.invoiceNo}::text)
      ORDER BY "createdAt" ASC LIMIT 1 FOR UPDATE`
    if (own) {
      const row = await tx.uncollectedPaid.findUnique({ where: { id: own.id } })
      if (!row) return "same"
      if (!isOpenRaw(row.status)) return "leftClosed"
      const currentExact = s.paidExactOf ? (s.paidExactOf.get(row.id) ?? null) : undefined
      const ch = feedChanges(row, c, {
        currentExact,
        storage: await storageFor(row.id),
        // BC's own paid date couldn't be read this run: a case on it (or one we can't tell) keeps it.
        holdPaid: s.holdExact && currentExact !== false && currentExact !== null,
      })
      const paidAgain = isNoLongerPaidText(s.lastFeedText.get(row.id))
      const data: Prisma.UncollectedPaidUpdateInput = { ...toData(ch.set), ...customerLink(row.customerId, customerId, ch) }
      if (Object.keys(data).length) await tx.uncollectedPaid.update({ where: { id: row.id }, data })
      const changed = ch.phrases.length > 0 || paidAgain
      if (changed) {
        await tx.uncollectedPaidEvent.create({ data: { caseId: row.id, kind: "edit", text: updatedText(c, ch, paidAgain), byId: null, byName: s.byName } })
      }
      const flagged = await flagQuery(row.id)
      return changed || flagged ? "updated" : "same"
    }

    // 2 / 4. A case added by hand to take over.
    const adopt = async (id: string): Promise<SaveOutcome> => {
      const row = await tx.uncollectedPaid.findUnique({ where: { id } })
      if (!row) return "same"
      const ch = feedChanges(row, c, { storage: await storageFor(id) })
      const data: Prisma.UncollectedPaidUpdateInput = {
        ...toData(ch.set), ...customerLink(row.customerId, customerId, ch), source: "bc", bcKey: v.invoiceNo,
      }
      await tx.uncollectedPaid.update({ where: { id }, data })
      await tx.uncollectedPaidEvent.create({ data: { caseId: id, kind: "edit", text: matchedText(c, ch.phrases), byId: null, byName: s.byName } })
      await flagQuery(id)
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

    // 5. New — its storage start by the rule (nobody can have set one yet).
    const stamp = storageStamp(null, v.paidOn, graceDays == null ? null : { owner: null, graceDays })
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
        storageFrom: stamp ? dayToStored(stamp.day) : null,
        createdById: null,
        createdByName: FEED_CREATOR,
      },
      select: { id: true },
    })
    await tx.uncollectedPaidEvent.create({
      data: {
        caseId: created.id, kind: "created", byId: null, byName: s.byName,
        text: addedText(c, stamp && graceDays != null ? { day: stamp.day, graceDays } : null),
      },
    })
    await flagQuery(created.id)
    return "added"
  }, { maxWait: 10_000, timeout: 20_000 })
}

type OpenBcCase = { id: string; bcKey: string | null; invoiceNo: string | null; buyerNo: string | null; saleCode: string | null; status: string }

/**
 * Open cases from BC the check no longer found. Each is judged against BC only on positive evidence:
 *  • its invoice isn't paid in full any more → said once on the case ("check it"), left open;
 *  • still paid, and every lot of theirs on it that BC still shows is gone — ticked collected, or at a
 *    GONE location (Receipt_Lines_Excel, read for the lots BC hasn't ticked) → closed as collected,
 *    the event naming the locations seen ("BC shows the lots collected (location COLLECTED)");
 *  • anything else (lots still waiting, some at a QUERY location, nothing to be found, couldn't be
 *    read — a lot BC hasn't ticked whose location BC didn't give included) → left as it is.
 * A close a GONE location decided says the storage figure may be too high (collectedCloseText).
 */
async function checkDropped(ctx: Ctx, cases: OpenBcCase[], s: SaveCtx, notes: string[]) {
  const out = { closed: 0, byLocation: 0, flagged: 0, waiting: 0, query: 0, unknown: 0, notInBc: 0, unread: 0, failed: 0, tooManySales: 0, placesUnread: 0 }
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
      // So can a box holding words that aren't a sale code (typed by hand — salesUnparsed).
      if (salesLeftOff(c.saleCode) > 0 || salesUnparsed(c.saleCode) > 0) { out.tooManySales++; return }
      const sales = salesOf(c.saleCode)
      if (!refs || !sales.length || !c.buyerNo) { out.unread++; return }
      const rows: Record<string, unknown>[] = []
      for (const sale of sales) rows.push(...await readBuyerSaleRows(ctx, sale, c.buyerNo.trim().toUpperCase()))
      // Where the lots BC hasn't ticked are now — a GONE location counts as collected. Couldn't be
      // read → the tick alone decides (as before); the time running out → this case isn't judged.
      const notTicked = droppedLots(refs, rows, c.buyerNo).filter((r) => !bcTrue(r.EVA_Collected))
        .map((r) => String(r.EVA_UniqueID ?? "").trim()).filter(Boolean)
      let places: Map<string, LotPlace> | undefined
      if (notTicked.length) {
        // One call at a time: the cases themselves are already checked BC_CONCURRENCY at once.
        const pr = await placesFor(ctx, notTicked, undefined, 1)
        if (pr.timedOut.size) throw ctx.stopped ? new Stopped() : new OutOfTime()
        // A lot BC hasn't ticked whose location couldn't be read can only be "still here" on the tick
        // alone, so the case can't be closed — left as it is and counted as such (not as "waiting").
        if (pr.failed.size || pr.refused.size) { out.placesUnread++; return }
        places = pr.places
      }
      const ev = droppedEvidence(refs, rows, c.buyerNo, places)
      if (ev.verdict === "waiting") { out.waiting++; return }
      if (ev.verdict === "query") { out.query++; return }
      if (ev.verdict === "unknown") { out.unknown++; return }

      if (await closeAsCollected(c, ev, s)) { out.closed++; if (closedByLocation(ev)) out.byLocation++ }
    } catch (e) {
      if (e instanceof OutOfTime || e instanceof BcError) out.unread++
      else { out.failed++; console.error("uncollected feed: a case couldn't be checked:", e) }
    } finally {
      progress(++done)
    }
  })

  if (out.byLocation) notes.push(`${many(out.byLocation, "case")} closed as collected ${out.byLocation === 1 ? "was" : "were"} closed because BC has ${out.byLocation === 1 ? "its" : "their"} lots at a location that means they've gone (COLLECTED and the like), not only because BC ticked them collected. BC keeps no date for that scan, so if the lots had gone before a case was added its storage figure is too high — ${out.byLocation === 1 ? "the case says" : "each case says"} to check it.`)
  if (out.flagged) notes.push(`${many(out.flagged, "case")} from BC: the invoice no longer shows as paid in BC — said on the case, left open.`)
  if (out.query) notes.push(`${many(out.query, "case")} from BC: none of ${out.query === 1 ? "its" : "their"} lots is still here, but some are at a query location in BC (MISSING and the like) — left open to check.`)
  if (out.placesUnread) notes.push(`${many(out.placesUnread, "case")} from BC: where some of ${out.placesUnread === 1 ? "its" : "their"} lots are couldn't be read in BC, so ${out.placesUnread === 1 ? "it was" : "they were"} left as ${out.placesUnread === 1 ? "it is" : "they are"} — the next check tries again.`)
  if (out.waiting) notes.push(`${many(out.waiting, "case")} from BC still ${out.waiting === 1 ? "has" : "have"} lots waiting but no longer ${out.waiting === 1 ? "meets" : "meet"} the rule today (BC changed the invoice recently, or the sale is over ${UNCOLLECTED_LOOKBACK_MONTHS} months old) — left as ${out.waiting === 1 ? "it is" : "they are"}.`)
  if (out.unknown) notes.push(`${many(out.unknown, "case")} from BC: none of ${out.unknown === 1 ? "its" : "their"} lots could be found under the buyer in BC any more (re-sold or renumbered?) — left open to check by hand.`)
  if (out.notInBc) notes.push(`${many(out.notInBc, "case")} from BC: the invoice couldn't be found in BC — left as ${out.notInBc === 1 ? "it is" : "they are"}.`)
  if (out.tooManySales) notes.push(`${many(out.tooManySales, "case")} from BC ${out.tooManySales === 1 ? "covers" : "cover"} more sales than the case's sale box can hold, so the check can't tell every lot is collected — left open to close by hand.`)
  if (out.unread) notes.push(`${many(out.unread, "case")} from BC couldn't be re-checked this time (BC didn't answer, or the check ran out of time or was stopped) — the next check tries again.`)
  if (out.failed) notes.push(`${many(out.failed, "case")} couldn't be updated — see the server's log.`)
  return out
}

/**
 * Closes an open case from BC as collected because BC shows its lots gone (`ev`), on the run's stop
 * day, with the line saying why. Only if it is still where it was read — someone changing it meanwhile
 * wins (false). ⚠ closedAt is the STOP DAY (collectedStopOf), not the moment the check noticed: storage
 * counts the day a case closes, so "now" charged every case the check closes a day too many. A close a
 * GONE location decided says the storage figure may be too high (collectedCloseText).
 */
async function closeAsCollected(c: OpenBcCase, ev: Pick<DroppedEvidence, "ticked" | "gone">, s: SaveCtx): Promise<boolean> {
  const stop = s.collectedStop
  return prisma.$transaction(async (tx) => {
    const n = await tx.uncollectedPaid.updateMany({
      where: { id: c.id, source: "bc", status: c.status },
      data: { status: "collected", closedAt: stop.closedAt },
    })
    if (n.count !== 1) return false   // someone changed it meanwhile — theirs wins
    await tx.uncollectedPaidEvent.create({
      data: {
        caseId: c.id, kind: "status", byId: null, byName: s.byName,
        // ⚠ Never "storage charges from" here (storageStartOwner reads status lines).
        text: collectedCloseText(STATUS_META[statusOf(c.status)].label, STATUS_META.collected.label, ev, stop.day),
      },
    })
    return true
  })
}

/**
 * Where the clock stops on a case this run closes because BC shows its lots collected. BC keeps no
 * collected date, so the honest stop is the LAST DAY THE LOTS COULD HAVE BEEN SEEN STILL HERE: the
 * London day of the check's previous run that read BC's lot list in full (lotsSeen over 0) — normally
 * yesterday's nightly check, or today's when Check BC now runs after it. Never later than today; the
 * day before today when there's no earlier read (or it can't be found). closedAt is that day stored
 * the date-only way (12:00 UTC), or now when the stop day is today.
 * ⚠ Not "now": storage counts the day a case closes, so closing at the moment of the check charged
 * every case it closes at least a day too many. A case that waited more than a run to be re-checked
 * (DROPPED_CHECK_LIMIT) can still have gone before the stop day — RULES.md says so.
 */
export async function collectedStopOf(runStarted: Date, today: string): Promise<{ day: string; closedAt: Date }> {
  const prev = await prisma.uncollectedSyncRun.findFirst({
    where: { startedAt: { lt: runStarted }, lotsSeen: { gt: 0 } },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    select: { startedAt: true },
  }).catch((e) => { console.error("uncollected feed: the previous check couldn't be read:", e); return null })
  return collectedStopFrom(prev?.startedAt ?? null, today)
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
      const saved = tally.added + tally.adopted + tally.updated + checked.closed + checked.flagged
      const what = [
        tally.added && `${n0(tally.added)} new`, tally.adopted && `${n0(tally.adopted)} taken over`, tally.updated && `${n0(tally.updated)} updated`,
        checked.closed && `${n0(checked.closed)} closed as collected`, checked.flagged && `${n0(checked.flagged)} noted as no longer paid`,
      ].filter(Boolean).join(", ")
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
    // Whether each one's paid date is BC's own now (so a switch is said on the case), and the free
    // days for the storage rule. Settings that couldn't be read → no storage start set this run.
    let paidExactOf: Map<string, boolean> | null = null
    try {
      paidExactOf = await readPaidExact(openBc.map((c) => c.id))
    } catch (e) {
      console.error("uncollected feed: which paid dates are BC's own couldn't be read:", e)
      notes.push("Which cases already carry BC's own paid date couldn't be read, so a change between it and the settled date wasn't said on the cases this time.")
    }
    // The storage settings. With the table there, each save reads the free days inside its own
    // transaction under the settings lock (saveCandidate), so a change an admin saves mid-run is
    // followed and never undone. Before Run Migrations, the standard ones (and this run looks again
    // now and then, so pressing Run Migrations part-way through is picked up). Couldn't be read → no
    // storage start is set or moved this run.
    const storage = await readStorageSettings()
    if (storage.readFailed) notes.push("The storage charge settings couldn't be read, so no storage start dates were set or moved this time — the next check tries again.")
    const s: SaveCtx = {
      today: f.today, byName: feedName(trigger, byName), lastFeedText, adoptedIds: new Set(),
      settingsInTx: storage.ready && !storage.readFailed,
      graceDays: storage.readFailed ? null : storage.graceDays,
      paidExactOf,
      holdExact: f.paidDates === "unknown",
      collectedStop: await collectedStopOf(started, f.today),
    }
    let readyCheckedAt = Date.now()
    const checkReady = async () => {
      if (s.settingsInTx || storage.readFailed || Date.now() - readyCheckedAt < 10_000) return
      readyCheckedAt = Date.now()
      const now = await readStorageSettings()
      if (now.ready && !now.readFailed) s.settingsInTx = true
    }

    // ── Open cases from BC it didn't find this time — judged only for buyers it fully checked (see the
    // re-checks after saving). Worked out here, before saving, so the quick re-check's one BC read — the
    // lots BC TICKED in those cases' sales, many buyers a call (readTickedFor) — is made while the time
    // for reading BC is still there. Only for cases that read could close (droppedNeedsTicked).
    const foundKeys = new Set(f.candidates.map((c) => c.invoiceNo.toUpperCase()))
    const uncheckedNow = new Set(f.uncheckedBuyers.map((b) => b.toUpperCase()))
    const dropped = openBc.filter((c) => {
      const k = (c.bcKey ?? c.invoiceNo ?? "").toUpperCase()
      return k && !foundKeys.has(k) && !uncheckedNow.has((c.buyerNo ?? "").trim().toUpperCase())
    })
    const buyerOf = (c: OpenBcCase) => (c.buyerNo ?? "").trim().toUpperCase()
    const keyOfCase = (c: OpenBcCase) => c.bcKey ?? c.invoiceNo ?? ""
    /** "SALE|BUYER" → the lots BC ticked for that buyer in that sale — present only when read. */
    const tickedOf = new Map<string, TickedLot[]>()
    const needTicked = new Map<string, Set<string>>()   // sale → buyers
    for (const c of dropped) {
      const judged = f.judged.get(buyerOf(c))
      if (droppedFromRun({ saleCode: c.saleCode, invoiceKey: keyOfCase(c) }, judged, f.window.from)) continue
      if (!droppedNeedsTicked({ saleCode: c.saleCode, invoiceKey: keyOfCase(c) }, judged, f.window.from)) continue
      for (const sale of salesOf(c.saleCode)) {
        if (!needTicked.has(sale)) needTicked.set(sale, new Set())
        needTicked.get(sale)!.add(buyerOf(c))
      }
    }
    if (needTicked.size && !ctx.outOfTime && !stopBy()) {
      const batches = [...needTicked].flatMap(([sale, bs]) => chunk([...bs].sort(), BUYERS_PER_CALL).map((buyers) => ({ sale, buyers })))
      let doneBatches = 0
      let unreadBatches = 0
      await eachLimit(batches, BC_CONCURRENCY, async ({ sale, buyers }) => {
        try {
          if (ctx.outOfTime) throw ctx.stopped ? new Stopped() : new OutOfTime()
          const rows = await readTickedFor(ctx, sale, buyers)
          const got = new Map<string, TickedLot[]>(buyers.map((b) => [b, []]))
          for (const r of rows) {
            const t = toTickedLot(r)
            if (t && t.saleCode === sale) got.get(t.buyerNo)?.push(t)
          }
          for (const [b, ts] of got) tickedOf.set(`${sale}|${b}`, ts)
        } catch {
          unreadBatches++   // those cases go to the slow re-check, as before
        }
        doneBatches++
        setProgress({ stage: "checking", done: doneBatches, total: batches.length, words: `Reading which lots BC ticked collected, for the cases to re-check — ${n0(doneBatches)} of ${n0(batches.length)}` })
      })
      if (unreadBatches) notes.push(`Which lots BC ticked collected couldn't be read for ${many(unreadBatches, "group")} of buyers (BC didn't answer, or the time ran out) — their cases were left to the slow re-check, or the next check.`)
    }
    /** The lots BC ticked in every sale of a case — undefined unless every one of its sales was read. */
    const tickedForCase = (c: OpenBcCase): TickedLot[] | undefined => {
      const out: TickedLot[] = []
      for (const sale of salesOf(c.saleCode)) {
        const got = tickedOf.get(`${sale}|${buyerOf(c)}`)
        if (!got) return undefined
        out.push(...got)
      }
      return out
    }

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
        await checkReady()
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
    // not after a Stop or once saving has run out of time.
    //  1. The QUICK re-check (droppedFromRun), from what this run already read: every lot BC hasn't
    //     ticked on the case's invoice is at a GONE location → closed now, no BC call, no limit, even
    //     when the time for reading BC ran out. (2026-10-23 — Jack: "things are scanned as collected
    //     and still showing": the cases added before the check read locations waited 60 a run, and
    //     none at all on a run that ran out of time.)
    //  2. The rest — the SLOW re-check against BC (checkDropped): at most DROPPED_CHECK_LIMIT a run,
    //     turning round from run to run (pickDropped) so every one is reached in turn.
    let unreadDropped = 0
    if (!stopBy() && !ctx.stopped && !outOfSaveTime) {
      const quick: { c: OpenBcCase; ev: DroppedEvidence }[] = []
      const slow: OpenBcCase[] = []
      for (const c of dropped) {
        const ev = droppedFromRun({ saleCode: c.saleCode, invoiceKey: keyOfCase(c) }, f.judged.get(buyerOf(c)), f.window.from, tickedForCase(c))
        if (ev) quick.push({ c, ev })
        else slow.push(c)
      }
      const quickGone: Record<string, number> = {}
      let quickClosed = 0
      let quickLeft = 0
      let quickFailed = 0
      for (let i = 0; i < quick.length; i++) {
        if (stopBy() || Date.now() > saveStopAt) { quickLeft = quick.length - i; break }
        try {
          if (await closeAsCollected(quick[i].c, quick[i].ev, s)) {
            quickClosed++
            for (const [loc, n] of Object.entries(quick[i].ev.gone)) quickGone[loc] = (quickGone[loc] ?? 0) + n
          }
        } catch (e) {
          quickFailed++
          tally.failed++
          console.error("uncollected feed: a case couldn't be closed as collected:", e)
        }
        setProgress({ stage: "checking", done: i + 1, total: quick.length, words: `Closing cases whose lots BC has at COLLECTED and the like — ${n0(i + 1)} of ${n0(quick.length)}` })
      }
      checked.closed += quickClosed
      if (quickClosed) {
        const where = Object.entries(quickGone).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `${k} ${n0(n)}`).join(", ")
        notes.push(`${many(quickClosed, "case")} from BC closed as collected straight from this check's own read: every lot on the invoice is ticked collected in BC or at a location that means it has gone${where ? ` (lots at ${where})` : ""} — the collection docket often isn't posted. BC keeps no date for that scan, so if the lots had gone before a case was added its storage figure is too high — ${quickClosed === 1 ? "the case says" : "each case says"} to check it.`)
      }
      if (quickFailed) notes.push(`${many(quickFailed, "case")} whose lots have all gone couldn't be closed — see the server's log. The next check tries again.`)
      if (quickLeft) {
        notes.push(stopBy()
          ? `It was stopped before ${many(quickLeft, "case")} whose lots have all gone ${quickLeft === 1 ? "was" : "were"} closed — the next check closes ${quickLeft === 1 ? "it" : "them"}.`
          : `The check ran so long that ${many(quickLeft, "case")} whose lots have all gone ${quickLeft === 1 ? "wasn't" : "weren't"} closed — the next check closes ${quickLeft === 1 ? "it" : "them"}.`)
        unreadDropped += quickLeft
      } else if (!stopBy() && !ctx.stopped) {
        const { pick, later } = pickDropped(slow, new Set(f.buyerNos), seq, DROPPED_CHECK_LIMIT)
        if (later) notes.push(`${many(later, "more case")} from BC ${later === 1 ? "waits" : "wait"} to be re-checked — the check re-checks ${DROPPED_CHECK_LIMIT} a run, taking them in turn.`)
        const d = await checkDropped(ctx, pick, s, notes)
        checked.closed += d.closed
        checked.flagged = d.flagged
        tally.failed += d.failed
        // A case whose lots' locations BC didn't answer for was judged on the tick alone — not a full check.
        unreadDropped += d.unread + d.placesUnread
      }
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
 * `limit` lots (default 300) are answered. Each listed lot's location is read too (Receipt_Lines_Excel,
 * ≤ 20 a call, in the same budget): its `state` is lotState(tick, location) — a GONE location reads as
 * collected, a QUERY one as "check this lot". A location that can't be read leaves the lot judged on
 * the tick alone (locationRead false; locationsUnread / locationError say how many and why) — the
 * lots are still answered. Read only. Throws a plain message if the lots themselves can't be read
 * (BC's own status — 401, 403, 429, 503 — stays in it, for the page to put into words).
 */
export async function bcLotsForBuyer(token: string, saleCode: string, buyerNo: string, limit = 300): Promise<UncollectedBcLots> {
  const all = salesOf(saleCode)
  const sales = all.slice(0, CASE_PAGE_MAX_SALES)
  // A part of the box that isn't a sale code (typed by hand) is a sale not read, too — so the page
  // never says "all collected" from only the sales it could make out (review of 2026-10-23).
  const salesLeftOut = all.length - sales.length + salesLeftOff(saleCode) + salesUnparsed(saleCode)
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
    // The same lot twice (a page boundary that moved under us) is listed once — told apart by the
    // whole line, never the unique id alone (an item re-entered and sold again keeps it; as find()).
    .filter((l) => { const k = `${l.uniqueId ? `u:${l.uniqueId.toUpperCase()}` : "l"}:${l.saleCode}:${l.lotNo}`; if (seen.has(k)) return false; seen.add(k); return true })
    .sort((a, b) => order(a.saleCode) - order(b.saleCode) || a.lotNo.localeCompare(b.lotNo, "en", { numeric: true }))
  const listed = sold.slice(0, limit)
  // A sale read that gave no lot sold to them: a sale they didn't buy in, or a code that isn't a real
  // sale ("F068-2" typed on a hand case). Never "all collected" while there is one (collectedFromLiveLots).
  const emptySales = sales.filter((s) => !sold.some((l) => l.saleCode === s))

  // Where each listed lot is now — every one, collected or not, for the page's Location column.
  const pr = await placesFor(ctx, listed.map((l) => l.uniqueId ?? "").filter(Boolean))
  const miss = { noId: 0, noLine: 0, ambiguous: 0, failed: 0, refused: 0 }
  const lots: UncollectedBcLot[] = listed.map((l) => {
    const k = placeKey(l.uniqueId)
    const p = k ? pr.places.get(k) : undefined
    if (!p) {
      if (!k) miss.noId++
      else if (pr.failed.has(k) || pr.timedOut.has(k)) miss.failed++
      else if (pr.refused.has(k)) miss.refused++
      else if (pr.ambiguous.has(k)) miss.ambiguous++
      else miss.noLine++
    }
    // BC's Internal Barcode — the one for this sale when the item has had more than one (a barcode
    // starts with its sale's code: F078196 in F078); one that fits no sale is shown only when alone.
    const barcodes = p?.barcodes ?? []
    return {
      ...l,
      location: p ? p.location : null,
      bin: p ? p.bin : null,
      barcode: barcodes.find((b) => !!l.saleCode && b.startsWith(l.saleCode)) ?? (barcodes.length === 1 ? barcodes[0] : null),
      locationRead: !!p,
      state: lotState(l.collected, p ? p.location : null),
    }
  })
  const locationsUnread = miss.noId + miss.noLine + miss.ambiguous + miss.failed + miss.refused
  const why = [
    miss.failed > 0 && (pr.timedOut.size
      ? `BC took too long to answer for ${many(miss.failed, "lot")}`
      : `BC didn't answer for ${many(miss.failed, "lot")}${pr.error ? ` (${pr.error})` : ""}`),
    miss.refused > 0 && `BC refused to give where ${many(miss.refused, "lot")} ${miss.refused === 1 ? "is" : "are"}${(ctx.placesBroken ?? pr.error) ? ` (${ctx.placesBroken ?? pr.error})` : ""}`,
    miss.noLine > 0 && `${many(miss.noLine, "lot")} ${miss.noLine === 1 ? "has" : "have"} no receipt line in BC`,
    miss.ambiguous > 0 && `the receipt lines of ${many(miss.ambiguous, "lot")} disagree about where ${miss.ambiguous === 1 ? "it is" : "they are"}`,
    miss.noId > 0 && `${many(miss.noId, "lot")} ${miss.noId === 1 ? "has" : "have"} no unique ID`,
  ].filter(Boolean).join("; ")
  return {
    buyerNo: buyer, saleCode: sales.join(", "), sales, salesLeftOut, emptySales,
    lots, more: sold.length > limit, readAt: new Date().toISOString(),
    locationsUnread, locationError: locationsUnread ? why : null,
  }
}
