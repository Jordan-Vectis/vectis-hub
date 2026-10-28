// Accounts → Refunds (Jack, 2026-10-26: "here is our current refund log … customers requesting issues,
// partial refunds or returns" — "i want it all to be in the hub, nice and clean … the form link will
// need to come out of the hub instead of using the Microsoft form").
//
// One refund = one request: a buyer asking for a refund, a part refund or a return (the Hub's own
// public form at /refund, replacing the Microsoft Form), or a vendor owed a payout (lost in the
// warehouse, sold in error…) added by staff — and the old SharePoint "Refund Log" imported once.
//
// A PLAIN, client-safe module: the words, the shapes the actions send, the money rules and the
// filter in the address bar. No Prisma, no auth, no BC. The server's rules are lib/actions/refunds.ts
// (staff), app/api/public/refund-request (the form) and lib/refunds-import.ts (the old log).
//
// The money (checked against every row of the old log, 2026-10-26): commission is the buyer's premium,
// 27% of the hammer inc VAT (22.5% + VAT — £90 → £24.30); a refund of N% is N% of hammer + commission
// (£90 + £24.30 at 20% = £22.86); "hammer only" is N% of the hammer alone; a set amount is that amount;
// postage refunded is added on top. All money in PENCE.
// ⚠ 27% is only the STANDARD premium: an online bidder also paid BC's web premium (32.94% in all), so
// a lot looked up in BC takes the commission BC actually charged (lib/refunds-bc.ts bcCommissionOf —
// Jack, 2026-10-28); a blank commission box is still worked out at 27% (commissionFor).

import { formatPence, looksLikeBankDetails } from "@/lib/uncollected"

export { formatPence, looksLikeBankDetails }

// ─── Statuses ───────────────────────────────────────────────────────────────────────────────

/** Where a request stands. "Complete for accounts" is a separate tick (accountsDoneAt), not a status. */
export const REFUND_STATUSES = ["new", "looking", "awaiting_return", "agreed", "paid", "declined", "closed"] as const
export type RefundStatus = (typeof REFUND_STATUSES)[number]
export const OPEN_REFUND_STATUSES: RefundStatus[] = ["new", "looking", "awaiting_return", "agreed"]
export const CLOSED_REFUND_STATUSES: RefundStatus[] = ["paid", "declined", "closed"]
export const isRefundStatus = (v: unknown): v is RefundStatus => typeof v === "string" && (REFUND_STATUSES as readonly string[]).includes(v)
/** A status in the table that isn't one of these reads as "new" everywhere (never vanishes). */
export const refundStatusOf = (v: unknown): RefundStatus => (isRefundStatus(v) ? v : "new")

export const REFUND_STATUS_META: Record<RefundStatus, { label: string; short: string; help: string; chip: string; dot: string }> = {
  new: {
    label: "New — not looked at yet", short: "New", help: "Just came in — nobody has picked it up",
    chip: "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30", dot: "bg-sky-500",
  },
  looking: {
    label: "Being looked at", short: "Looking", help: "Someone is checking the lot, photos and what happened",
    chip: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30", dot: "bg-amber-500",
  },
  awaiting_return: {
    label: "Waiting for the item to come back", short: "Awaiting return", help: "A return is agreed — waiting for the item back before paying",
    chip: "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30", dot: "bg-violet-500",
  },
  agreed: {
    label: "Agreed — to pay", short: "To pay", help: "The amount is agreed — it needs paying",
    chip: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30", dot: "bg-orange-500",
  },
  paid: {
    label: "Paid", short: "Paid", help: "Refunded or paid out (the date processed is set)",
    chip: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30", dot: "bg-emerald-500",
  },
  declined: {
    label: "Declined", short: "Declined", help: "No refund — say why when you decline it",
    chip: "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-500/15 dark:text-gray-300 dark:border-gray-500/30", dot: "bg-gray-500",
  },
  closed: {
    label: "Closed another way", short: "Closed", help: "Withdrawn, a duplicate, sorted without a refund — say why",
    chip: "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-500/15 dark:text-gray-300 dark:border-gray-500/30", dot: "bg-gray-400",
  },
}

// ─── Reasons, solutions, who it is ──────────────────────────────────────────────────────────

/** Why. The first four are the public form's choices (the Microsoft Form's, word for word). */
export const REFUND_REASONS = [
  "damaged_in_transit", "missing_parts", "described_incorrectly", "lost_in_transit",
  "lost_in_warehouse", "not_available", "other",
] as const
export type RefundReason = (typeof REFUND_REASONS)[number]
export const FORM_REASONS: RefundReason[] = ["damaged_in_transit", "missing_parts", "described_incorrectly", "lost_in_transit", "other"]
export const isRefundReason = (v: unknown): v is RefundReason => typeof v === "string" && (REFUND_REASONS as readonly string[]).includes(v)
export const REFUND_REASON_LABELS: Record<RefundReason, string> = {
  damaged_in_transit: "Damaged in transit",
  missing_parts: "Missing parts",
  described_incorrectly: "Described incorrectly",
  lost_in_transit: "Lost in transit",
  lost_in_warehouse: "Lost in the warehouse",
  not_available: "No longer available (sold before)",
  other: "Something else",
}

/** What was agreed: money back to a buyer, the item sent back first, or money to a vendor. */
export const REFUND_SOLUTIONS = ["refund", "return", "payout"] as const
export type RefundSolution = (typeof REFUND_SOLUTIONS)[number]
export const isRefundSolution = (v: unknown): v is RefundSolution => typeof v === "string" && (REFUND_SOLUTIONS as readonly string[]).includes(v)
export const REFUND_SOLUTION_LABELS: Record<RefundSolution, string> = { refund: "Refund", return: "Return", payout: "Payout" }

export const REFUND_PARTIES = ["buyer", "vendor"] as const
export type RefundParty = (typeof REFUND_PARTIES)[number]
export const isRefundParty = (v: unknown): v is RefundParty => typeof v === "string" && (REFUND_PARTIES as readonly string[]).includes(v)
export const REFUND_PARTY_LABELS: Record<RefundParty, string> = { buyer: "Buyer", vendor: "Vendor" }

export const REFUND_SOURCES = ["form", "staff", "import"] as const
export type RefundSource = (typeof REFUND_SOURCES)[number]
export const REFUND_SOURCE_LABELS: Record<RefundSource, string> = { form: "Refund form", staff: "Added by staff", import: "Old refund log" }

// ─── Limits ─────────────────────────────────────────────────────────────────────────────────

export const REFUND_LIMITS = {
  name: 120,
  email: 200,
  customerNo: 20,
  saleCode: 20,
  lotsText: 200,
  details: 4000,
  notes: 4000,
  refCode: 40,
  percentText: 120,
  reason: 300,
  eventText: 4000,
  /** Photos a request can carry, and the most each may be once the browser has shrunk it. */
  photos: 6,
  photoBytes: 5 * 1024 * 1024,
  /** Lots on one request. */
  lots: 50,
  list: 500,
  search: 100,
} as const

/** The photo types the public form accepts (after the browser turns each into a JPEG). */
export const REFUND_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const
/** Where a request's photos live in R2: refund-photos/<refund id>/<n>.<ext>. Never a public prefix. */
export const REFUND_PHOTO_PREFIX = "refund-photos/"

// ─── The reference ──────────────────────────────────────────────────────────────────────────

/** A BC sale code — F078, E050: a letter or two, then three or four digits. A request's sale that
 *  isn't one ("N/A", "TBC") is never used to look lots up by. */
export const SALE_CODE_RE = /^[A-Z]{1,2}\d{3,4}$/
export const isSaleCode = (v: unknown): v is string => typeof v === "string" && SALE_CODE_RE.test(v.trim().toUpperCase())

/** "RF0042" — the request's own number (Refund.ref), what the customer is shown and quotes. */
export const refundRefWords = (ref: number | null | undefined): string => (ref == null ? "—" : `RF${String(ref).padStart(4, "0")}`)

// ─── Money ──────────────────────────────────────────────────────────────────────────────────

/** The buyer's premium inc VAT, as a fraction of the hammer: 22.5% + 20% VAT = 27%. */
export const BUYERS_PREMIUM_INC_VAT = 0.27

/** The commission on a hammer, to the penny (half up). */
export const commissionFor = (hammerPence: number): number => Math.round(hammerPence * BUYERS_PREMIUM_INC_VAT)

/** How a lot's refund is worked out. */
export const REFUND_BASES = ["percent", "hammer_only", "set"] as const
export type RefundBasis = (typeof REFUND_BASES)[number]
export const isRefundBasis = (v: unknown): v is RefundBasis => typeof v === "string" && (REFUND_BASES as readonly string[]).includes(v)
export const REFUND_BASIS_LABELS: Record<RefundBasis, string> = {
  percent: "% of hammer + commission",
  hammer_only: "% of hammer only",
  set: "Set amount",
}

/** One lot's refund inputs. */
export type RefundLotMoney = {
  hammerPence: number | null
  /** null = 27% of the hammer (commissionFor). */
  commissionPence: number | null
  basis: RefundBasis
  /** 0–100, for percent / hammer_only. */
  percent: number | null
  /** For "set". */
  setAmountPence: number | null
}

/** What one lot refunds, in pence — null when it can't be worked out (no hammer for a percentage, no
 *  set amount, no percentage). Never negative. */
export function lotRefundPence(l: RefundLotMoney): number | null {
  if (l.basis === "set") return l.setAmountPence == null ? null : Math.max(0, Math.round(l.setAmountPence))
  if (l.hammerPence == null || l.percent == null) return null
  const pct = Math.min(100, Math.max(0, l.percent)) / 100
  const commission = l.commissionPence ?? commissionFor(l.hammerPence)
  const base = l.basis === "hammer_only" ? l.hammerPence : l.hammerPence + commission
  return Math.max(0, Math.round(base * pct))
}

/** The whole refund: every lot that can be worked out, plus postage refunded. `missing` = lots that
 *  couldn't be (so the total is a minimum — never shown as if it were complete). */
export function refundTotalPence(lots: RefundLotMoney[], postagePence: number | null): { totalPence: number; missing: number } {
  let total = 0
  let missing = 0
  for (const l of lots) {
    const p = lotRefundPence(l)
    if (p == null) missing++
    else total += p
  }
  return { totalPence: total + Math.max(0, Math.round(postagePence ?? 0)), missing }
}

/**
 * What a request's SAVED total becomes when its lots or postage are saved — one rule for the Lots &
 * money card (shown as you type) and the server (what's saved). Only a WHOLE total is ever saved:
 *  • a lot that can't be worked out → null ("Not worked out" in the list, the CSV and the tiles) —
 *    never a part-sum that reads as the whole; the card still shows "at least £…" (`worked`);
 *  • no lots and no postage → null (nothing to work it out from);
 *  • ⚠ an old-log request keeps the total it has (`saved`) until its lots can work out a whole one:
 *    the log often gave one total for several lots, or lots it couldn't name ("N/A", a sentence), so
 *    the lots alone can't say it — a partial sum (or the postage alone) must never replace it (`kept`).
 */
export function refundTotalToSave(
  lots: RefundLotMoney[],
  postagePence: number | null,
  saved: { source: RefundSource; totalPence: number | null },
): { totalPence: number | null; worked: number; missing: number; kept: boolean } {
  const { totalPence: worked, missing } = refundTotalPence(lots, postagePence)
  if (saved.source === "import" && saved.totalPence != null && (!lots.length || missing > 0)) {
    return { totalPence: saved.totalPence, worked, missing, kept: true }
  }
  if (missing > 0 || (!lots.length && postagePence == null)) return { totalPence: null, worked, missing, kept: false }
  return { totalPence: worked, worked, missing: 0, kept: false }
}

/** "£1,234.56" / "1234.56" / "£-" / "NA" → pence, or null. Commas and £ ignored; anything else null. */
export function poundsToPence(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : null
  const s = String(v ?? "").replace(/[£,\s]/g, "").replace(/^£/, "")
  if (!s || /^(na|n\/a|-)$/i.test(s)) return null
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null
  return Math.round(Number(s) * 100)
}

/** The old log's cell under one of its column names, lower case (they have spaces round them:
 *  " Hammer price "); "" when there's none. */
export function oldLogCell(raw: Record<string, string> | null | undefined, name: string): string {
  if (!raw) return ""
  const k = Object.keys(raw).find((key) => key.trim().toLowerCase() === name)
  return k ? String(raw[k] ?? "").trim() : ""
}

/**
 * The account BC moves a lot's buyer to once it has been refunded or returned — the customer's own
 * C-number is gone from the line after that, so the buyer's lines no longer show it. Seen on 25 of 30
 * refunded lots checked on 27 Oct 2026 (same sale, lot and hammer as the old log; buyer C000079).
 */
export const RETURNS_ACCOUNT = "C000079"

/** A lot's commission as the money rules use it: the box, or 27% of the hammer when it's blank. */
export const commissionUsed = (l: Pick<RefundLotMoney, "hammerPence" | "commissionPence">): number | null =>
  l.commissionPence ?? (l.hammerPence != null ? commissionFor(l.hammerPence) : null)

/** A lot's commission isn't what BC charged — by more than a penny (the old log rounded some by one). */
export const commissionDiffers = (ours: number | null | undefined, bc: number | null | undefined): boolean =>
  ours != null && bc != null && Math.abs(ours - bc) > 1

// ─── Shapes the actions send back (ISO strings, so they cross to the browser) ────────────────

/** Every action answers this (a thrown server-action error is redacted in production). */
export type RefundResult<T = undefined> =
  | { ok: true; error?: undefined; data: T }
  | { ok: false; error: string; notReady?: boolean; needsBc?: boolean; data?: undefined }

export const REFUNDS_NOT_READY = "Refunds needs Run Migrations — an admin presses Run it now on the banner, then it's ready."
export const REFUNDS_ADMINS_ONLY = "Refunds is for admins only."

export type RefundLotRow = {
  id: string
  saleCode: string | null
  /** "366" or "366A". */
  lotNo: string
  uniqueId: string | null
  /** BC's Internal Barcode for the lot in that sale (F078196), and its receipt (R008018). */
  barcode: string | null
  receiptNo: string | null
  description: string | null
  hammerPence: number | null
  commissionPence: number | null
  basis: RefundBasis
  percent: number | null
  setAmountPence: number | null
  /** lotRefundPence of the above. */
  amountPence: number | null
  /** true = hammer / description / commission were filled from BC. */
  fromBc: boolean
  /** Which of them (2026-10-26 on — older lots only have fromBc, and count as typed in). */
  hammerFromBc: boolean
  descriptionFromBc: boolean
  /** The commission is what BC charged (2026-10-28 on). */
  commissionFromBc: boolean
  /** BC's receipt lines were read for the sale + lot it was saved with (barcode found or not). */
  refsRead: boolean
}

export type RefundEventRow = { id: string; kind: string; text: string | null; byName: string | null; at: string }

export type RefundListItem = {
  id: string
  ref: number
  source: RefundSource
  receivedAt: string
  name: string
  email: string | null
  customerNo: string | null
  customerId: string | null
  party: RefundParty
  saleCode: string | null
  /** YYYY-MM-DD (London day), or null. */
  auctionDate: string | null
  lotsText: string | null
  reason: RefundReason
  status: RefundStatus
  solution: RefundSolution | null
  totalPence: number | null
  dealtWithName: string | null
  processedAt: string | null
  accountsDoneAt: string | null
  photoCount: number
  suspect: boolean
  /** London days since it came in (frozen when closed). */
  daysOpen: number
}

export type RefundDetail = RefundListItem & {
  details: string | null
  percentText: string | null
  hammerPence: number | null
  commissionPence: number | null
  postagePence: number | null
  refCode: string | null
  dealtWithId: string | null
  accountsDoneBy: string | null
  notes: string | null
  /** The photo keys (R2) — shown through the admin-only photo route. */
  photoKeys: string[]
  lots: RefundLotRow[]
  events: RefundEventRow[]
  /** For an imported row: the old log's cells as they were (shown under "From the old log"). */
  importedRaw: Record<string, string> | null
  createdAt: string
  updatedAt: string
}

export type RefundTotals = {
  open: number
  new: number
  awaitingReturn: number
  toPay: number
  /** Paid (or agreed?) but not ticked "complete for accounts". */
  accountsToDo: number
  /** £ refunded / paid out with a processed date in this London month. */
  paidThisMonthPence: number
  /** Median London days from coming in to paid, over the last 90 days; null when none. */
  medianDaysToPay: number | null
}

export type RefundList = {
  items: RefundListItem[]
  matched: number
  truncated: boolean
  statusCounts: Record<RefundStatus, number>
  reasonCounts: Record<RefundReason, number>
  totals: RefundTotals
  /** Distinct "dealt with" names, for the filter. */
  dealers: string[]
  filter: RefundFilterRead
  today: string
}

// ─── The filter in the address bar ──────────────────────────────────────────────────────────
// ?status=open (default, left out) | closed | all | new,looking…  ?reason=…  ?party=buyer|vendor
// ?solution=refund|return|payout  ?accounts=todo|done  ?dealt=<name>  ?sort=newest|oldest|amount|ref
// ⚠ Never the search: it is usually a customer's name or email (an address ends up in the browser's
// history and the server's logs). The panel sends it to listRefunds itself.

export const REFUND_SORTS = ["newest", "oldest", "amount", "ref"] as const
export type RefundSort = (typeof REFUND_SORTS)[number]
export const REFUND_SORT_LABELS: Record<RefundSort, string> = {
  newest: "Newest first", oldest: "Oldest first", amount: "Largest amount", ref: "Reference number",
}
export const isRefundSort = (v: unknown): v is RefundSort => typeof v === "string" && (REFUND_SORTS as readonly string[]).includes(v)

export type RefundFilter = {
  statuses?: RefundStatus[]
  reason?: RefundReason | null
  party?: RefundParty | null
  solution?: RefundSolution | null
  accounts?: "todo" | "done" | null
  dealt?: string | null
  sort?: RefundSort
  /** ⚠ Never in the address bar. */
  q?: string
}
export type RefundFilterRead = {
  statuses: RefundStatus[]; reason: RefundReason | null; party: RefundParty | null; solution: RefundSolution | null
  accounts: "todo" | "done" | null; dealt: string | null; sort: RefundSort; q: string
}

type Params = URLSearchParams | Record<string, string | string[] | undefined>
function param(sp: Params, key: string): string | undefined {
  if (sp instanceof URLSearchParams) return sp.get(key) ?? undefined
  const v = sp[key]
  return Array.isArray(v) ? v[0] : v
}
const sameSet = (a: readonly RefundStatus[], b: readonly RefundStatus[]) => a.length === b.length && a.every((s) => b.includes(s))

export function parseRefundFilter(sp: Params): RefundFilterRead {
  const raw = (param(sp, "status") ?? "").trim().toLowerCase()
  let statuses: RefundStatus[]
  if (raw === "all") statuses = [...REFUND_STATUSES]
  else if (raw === "closed") statuses = [...CLOSED_REFUND_STATUSES]
  else {
    const picked = raw.split(",").map((s) => s.trim()).filter(isRefundStatus)
    statuses = picked.length ? REFUND_STATUSES.filter((s) => picked.includes(s)) : [...OPEN_REFUND_STATUSES]
  }
  const reason = param(sp, "reason"), party = param(sp, "party"), solution = param(sp, "solution")
  const accounts = param(sp, "accounts"), dealt = (param(sp, "dealt") ?? "").trim().slice(0, 60), sort = param(sp, "sort")
  return {
    statuses,
    reason: isRefundReason(reason) ? reason : null,
    party: isRefundParty(party) ? party : null,
    solution: isRefundSolution(solution) ? solution : null,
    accounts: accounts === "todo" || accounts === "done" ? accounts : null,
    dealt: dealt || null,
    sort: isRefundSort(sort) ? sort : "newest",
    q: "",
  }
}

/** The filter as a query string ("" or "?…"), leaving the defaults out — and NEVER the search. */
export function refundFilterQuery(f: RefundFilter): string {
  const p = new URLSearchParams()
  const st = f.statuses?.length ? REFUND_STATUSES.filter((s) => f.statuses!.includes(s)) : [...OPEN_REFUND_STATUSES]
  if (sameSet(st, REFUND_STATUSES)) p.set("status", "all")
  else if (sameSet(st, CLOSED_REFUND_STATUSES)) p.set("status", "closed")
  else if (!sameSet(st, OPEN_REFUND_STATUSES)) p.set("status", st.join(","))
  if (f.reason) p.set("reason", f.reason)
  if (f.party) p.set("party", f.party)
  if (f.solution) p.set("solution", f.solution)
  if (f.accounts) p.set("accounts", f.accounts)
  if (f.dealt) p.set("dealt", f.dealt)
  if (f.sort && f.sort !== "newest") p.set("sort", f.sort)
  const s = p.toString()
  return s ? `?${s}` : ""
}

export const REFUNDS_PATH = "/tools/refunds"
/** The public form's address (no login). */
export const REFUND_FORM_PATH = "/refund"
