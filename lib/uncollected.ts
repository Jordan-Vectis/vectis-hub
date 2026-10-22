// Accounts → Paid, not collected — the shared words, colours, date helpers and shapes.
//
// Jack, 2026-10-22: "a new panel inside the Accounts section to track people who pay and are not
// collecting — make the framework for now". A case is one buyer who has paid (for one invoice, or
// one sale) and hasn't collected their lots. Entered by hand for now (source "manual"); a BC feed
// of paid invoices can fill the same table later (source "bc", keyed on bcKey) without the screens
// changing. See RULES.md → "Accounts → Paid, not collected".
//
// ⚠ A PLAIN module: no Prisma, no server-only imports — the panel's client components import the
// labels, colours and date helpers from here. The server actions are lib/actions/uncollected.ts.
// ⚠ Customer personal data: never bank or card details (looksLikeBankDetails refuses the obvious).
// Every day here is a London calendar day (Europe/London), never the server's.

// ─── Statuses ───────────────────────────────────────────────────────────────────────────────

export const UNCOLLECTED_STATUSES = ["waiting", "contacted", "arranged", "storage", "collected", "closed"] as const
export type UncollectedStatus = (typeof UNCOLLECTED_STATUSES)[number]

/** Still here — the case is open. */
export const OPEN_STATUSES: UncollectedStatus[] = ["waiting", "contacted", "arranged", "storage"]
/** Finished — closedAt is set. */
export const CLOSED_STATUSES: UncollectedStatus[] = ["collected", "closed"]

export type StatusMeta = {
  /** What it's called on screen. */
  label: string
  /** For a narrow chip or a filter button. */
  short: string
  /** One plain-English line saying when to use it. */
  help: string
  /** Chip: background, text and border, light and dark. */
  chip: string
  /** A small solid dot (a key, a chart). */
  dot: string
  /** true = choosing it closes the case (sets closedAt). */
  closes: boolean
  /** true = choosing it needs a reason (the case's timeline keeps it). */
  needsReason: boolean
}

export const STATUS_META: Record<UncollectedStatus, StatusMeta> = {
  waiting: {
    label: "Paid — waiting to collect", short: "Waiting",
    help: "They've paid for their lots and haven't collected them. Nobody has been in touch about it yet.",
    chip: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
    dot: "bg-amber-500", closes: false, needsReason: false,
  },
  contacted: {
    label: "We've been in touch", short: "Contacted",
    help: "We've phoned, emailed or written to them and are waiting to hear back, or for them to come in.",
    chip: "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30",
    dot: "bg-sky-500", closes: false, needsReason: false,
  },
  arranged: {
    label: "Collection or delivery arranged", short: "Arranged",
    help: "A collection day, a courier or a delivery has been agreed with them.",
    chip: "bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30",
    dot: "bg-indigo-500", closes: false, needsReason: false,
  },
  storage: {
    label: "Storage charges apply", short: "Storage",
    help: "They've had long enough to collect and storage charges now apply. Set the date the charges start from.",
    chip: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30",
    dot: "bg-orange-500", closes: false, needsReason: false,
  },
  collected: {
    label: "Collected", short: "Collected",
    help: "The lots have gone — collected, delivered or posted. This closes the case.",
    chip: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30",
    dot: "bg-emerald-500", closes: true, needsReason: false,
  },
  closed: {
    label: "Closed another way", short: "Closed",
    help: "Closed without being collected — for example refunded or re-offered. Say why when you close it.",
    chip: "bg-gray-100 text-gray-700 border-gray-200 dark:bg-white/10 dark:text-gray-300 dark:border-white/15",
    dot: "bg-gray-400", closes: true, needsReason: true,
  },
}

export function isUncollectedStatus(v: unknown): v is UncollectedStatus {
  return typeof v === "string" && (UNCOLLECTED_STATUSES as readonly string[]).includes(v)
}
export const isOpenStatus = (s: UncollectedStatus) => OPEN_STATUSES.includes(s)
/** A status the database holds that isn't one of ours (a future feed's typo) reads as "waiting" —
 *  everywhere: the list (the server's SQL does the same), the counts, the tiles and the chase dates.
 *  The panel also says how many there are (totals.unknownStatus), so they get put right. */
export const statusOf = (v: unknown): UncollectedStatus => (isUncollectedStatus(v) ? v : "waiting")
/** True for a status as the DATABASE holds it that counts as open: anything but collected / closed. */
export const isOpenRaw = (v: string): boolean => !(CLOSED_STATUSES as string[]).includes(v)

// ─── Age bands: how long since they paid ────────────────────────────────────────────────────

export type AgeBandKey = "0-7" | "8-14" | "15-30" | "31-60" | "60+"

export type AgeBand = {
  key: AgeBandKey
  label: string
  /** Inclusive day range; max null = no upper limit. */
  min: number
  max: number | null
  /** Text colour for a "days waiting" figure, light and dark. */
  text: string
  /** Chip: background, text and border, light and dark. */
  chip: string
}

/** Green → red the longer it has waited. ⚠ The server's band filter is built from this list. */
export const AGE_BANDS: AgeBand[] = [
  { key: "0-7", label: "0–7 days", min: 0, max: 7,
    text: "text-emerald-700 dark:text-emerald-300",
    chip: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30" },
  { key: "8-14", label: "8–14 days", min: 8, max: 14,
    text: "text-lime-700 dark:text-lime-300",
    chip: "bg-lime-100 text-lime-800 border-lime-200 dark:bg-lime-500/15 dark:text-lime-300 dark:border-lime-500/30" },
  { key: "15-30", label: "15–30 days", min: 15, max: 30,
    text: "text-amber-700 dark:text-amber-300",
    chip: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30" },
  { key: "31-60", label: "31–60 days", min: 31, max: 60,
    text: "text-orange-700 dark:text-orange-300",
    chip: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30" },
  // Labelled "Over 60 days", not "60+": day 60 is in the band before. The key stays "60+".
  { key: "60+", label: "Over 60 days", min: 61, max: null,
    text: "text-red-700 dark:text-red-300",
    chip: "bg-red-100 text-red-800 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30" },
]

export function isAgeBandKey(v: unknown): v is AgeBandKey {
  return typeof v === "string" && AGE_BANDS.some((b) => b.key === v)
}

export function ageBandFor(days: number | null | undefined): AgeBand | null {
  if (days == null || !Number.isFinite(days)) return null
  const d = Math.max(0, Math.floor(days))
  return AGE_BANDS.find((b) => d >= b.min && (b.max == null || d <= b.max)) ?? null
}

// ─── London days ────────────────────────────────────────────────────────────────────────────

const LONDON_TZ = "Europe/London"
const LONDON_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON_TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
})
const pad = (n: number) => String(n).padStart(2, "0")

/** The London calendar day an instant falls on, as YYYY-MM-DD (today, by default). */
export function londonDay(at: Date | string | number = new Date()): string {
  const p = LONDON_PARTS.formatToParts(new Date(at))
  const n = (t: Intl.DateTimeFormatPartTypes) => Number(p.find((x) => x.type === t)?.value ?? 0)
  return `${n("year")}-${pad(n("month"))}-${pad(n("day"))}`
}

/** True for a real calendar date written YYYY-MM-DD (what a date box sends), 2000–2100. */
export function isDay(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split("-").map(Number)
  if (y < 2000 || y > 2100) return false
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

/** A YYYY-MM-DD day moved by whole days. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** Whole days from one YYYY-MM-DD to another (b − a). */
export function daysBetween(a: string, b: string): number {
  const ms = (s: string) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d) }
  return Math.round((ms(b) - ms(a)) / 86_400_000)
}

/** How a date-only value is STORED: 12:00 UTC on that day, so it reads as the same London day
 *  in winter and summer (the Goods In agreement's signed-day convention). */
export function dayToStored(day: string): Date {
  const [y, m, d] = day.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12))
}

/** A stored date (ISO or Date) as the YYYY-MM-DD a date box shows — or "" for none. */
export function dateInputValue(v: Date | string | null | undefined): string {
  return v ? londonDay(v) : ""
}

/**
 * Days waiting = today − the day they paid, in London days. A closed case stops counting on the
 * day it closed. null when the paid date isn't known. Never negative.
 * ⚠ The server's SQL band filter uses exactly this rule — change both together.
 */
export function daysWaiting(
  paidAt: Date | string | null | undefined,
  closedAt?: Date | string | null,
  today: string = londonDay(),
): number | null {
  if (!paidAt) return null
  const end = closedAt ? londonDay(closedAt) : today
  return Math.max(0, daysBetween(londonDay(paidAt), end))
}

export type ChaseState = "overdue" | "today" | "later"

/** Where a case's next chase date stands, for an OPEN case (null for none, or a closed case). */
export function chaseState(
  nextChaseAt: Date | string | null | undefined,
  status: UncollectedStatus,
  today: string = londonDay(),
): ChaseState | null {
  if (!nextChaseAt || !isOpenStatus(status)) return null
  const d = londonDay(nextChaseAt)
  return d < today ? "overdue" : d === today ? "today" : "later"
}

/** "22 Oct 2026" (London). "—" for none. */
export function formatDay(v: Date | string | null | undefined): string {
  if (!v) return "—"
  return new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: LONDON_TZ })
}

/** "22 Oct 2026, 14:05" (London). "—" for none. */
export function formatDateTime(v: Date | string | null | undefined): string {
  if (!v) return "—"
  return new Date(v).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: LONDON_TZ,
  })
}

const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" })
/** "£1,234.50". "—" for none. */
export function formatMoney(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? "—" : GBP.format(n)
}

// ─── Contact and the timeline ───────────────────────────────────────────────────────────────

export const CONTACT_KINDS = ["call", "email", "letter", "note"] as const
export type ContactKind = (typeof CONTACT_KINDS)[number]
export const isContactKind = (v: unknown): v is ContactKind =>
  typeof v === "string" && (CONTACT_KINDS as readonly string[]).includes(v)

/** Kinds that count as having been in touch with the buyer ("Last contact"). A note doesn't. */
export const REACHED_OUT_KINDS: ContactKind[] = ["call", "email", "letter"]

export type EventKind = "created" | ContactKind | "status" | "edit"

/** Every symbol has its words beside it (design rule 3). */
export const EVENT_META: Record<EventKind, { icon: string; label: string }> = {
  created: { icon: "➕", label: "Added" },
  call: { icon: "📞", label: "Phone call" },
  email: { icon: "✉️", label: "Email" },
  letter: { icon: "📮", label: "Letter" },
  note: { icon: "📝", label: "Note" },
  status: { icon: "🔁", label: "Status changed" },
  edit: { icon: "✏️", label: "Details changed" },
}
export const eventKindOf = (v: unknown): EventKind =>
  typeof v === "string" && v in EVENT_META ? (v as EventKind) : "note"

// ─── Fields ─────────────────────────────────────────────────────────────────────────────────

export const UNCOLLECTED_FIELDS = [
  "buyerName", "buyerNo", "email", "phone", "saleCode", "invoiceNo", "lots", "amountPaid",
  "paidAt", "nextChaseAt", "storageFrom", "notes",
] as const
export type UncollectedField = (typeof UNCOLLECTED_FIELDS)[number]

export const FIELD_LABELS: Record<UncollectedField, string> = {
  buyerName: "buyer's name", buyerNo: "buyer number", email: "email", phone: "phone",
  saleCode: "sale", invoiceNo: "invoice number", lots: "number of lots", amountPaid: "amount paid",
  paidAt: "paid on", nextChaseAt: "next chase date", storageFrom: "storage charges from", notes: "notes",
}

/**
 * On a case that came from BC (source "bc") these are BC's, and the feed will write them again —
 * so they can't be changed in the Hub (the server refuses; the page should show them read-only).
 * Contact details, chase dates, storage start and notes stay the Hub's own.
 */
export const BC_OWNED_FIELDS: UncollectedField[] = ["buyerName", "buyerNo", "saleCode", "invoiceNo", "lots", "amountPaid", "paidAt"]

export const UNCOLLECTED_LIMITS = {
  buyerName: 200, buyerNo: 40, email: 254, phone: 40, saleCode: 40, invoiceNo: 60,
  notes: 4000, eventText: 2000, search: 100,
  lots: 100_000, amountPaid: 10_000_000,
  /** At most this many cases come back in one list. */
  list: 500,
} as const

// ─── Messages ───────────────────────────────────────────────────────────────────────────────

export const UNCOLLECTED_NOT_READY =
  "Paid, not collected needs Run Migrations — an admin needs to press Run Migrations before it can be used."
export const UNCOLLECTED_ADMINS_ONLY = "Paid, not collected is for admins only."
export const BANK_DETAILS_REFUSED =
  "That looks like bank or card details — they must never be kept in the Hub. Take them out and try again."

/** A word that says a number is a bank account's. Not "bank" ("paid by bank transfer, ref …" is an
 *  ordinary payment note) and not "Accounts" (the department). */
const ACCOUNT_WORD = /\b(?:a\/c|acc|acct|account)\b/i

/**
 * The obvious shapes of bank or card details: the words "sort code" or "IBAN", a sort code beside
 * an 8-digit account number, or a card number. A guard, not a guarantee — the boxes also say not to.
 *
 * Careful not to refuse an ordinary note (it used to):
 *  • A 2-2-2 group that reads as a date (22-10-26) only counts as a sort code with an account word
 *    nearby — "Paid 22-10-26 ref 12345678" is a payment note. One that can't be a date (40-47-84,
 *    20-00-00) counts on its own.
 *  • A card number is a run of WHOLE digit groups (spaces or dashes between), 13–19 digits, written
 *    unbroken or in a card's own grouping (4 4 4 4…, or 4 6 5 / 4 6 4), that passes the card check
 *    (Luhn). Never a slice out of the middle of a group, so two phone numbers side by side
 *    ("07700 900123 07700 900456") are never read as one card; a card followed by its expiry
 *    ("4111 1111 1111 1111 12/27") still is.
 */
export function looksLikeBankDetails(text: string | null | undefined): boolean {
  if (!text) return false
  if (/\bsort\s*code\b/i.test(text) || /\biban\b/i.test(text)) return true

  // A sort code (12-34-56) within a few words of an 8-digit account number, either way round.
  const pair = /\b(\d{2})-(\d{2})-\d{2}\b\D{0,30}\b\d{8}\b|\b\d{8}\b\D{0,30}\b(\d{2})-(\d{2})-\d{2}\b/g
  for (const m of text.matchAll(pair)) {
    const a = Number(m[1] ?? m[3])
    const b = Number(m[2] ?? m[4])
    const readsAsDate = a >= 1 && a <= 31 && b >= 1 && b <= 12
    if (!readsAsDate || ACCOUNT_WORD.test(text)) return true
  }

  for (const run of text.match(/\d(?:[ -]?\d)+/g) ?? []) {
    const groups = run.split(/[ -]/)
    for (let i = 0; i < groups.length; i++) {
      let digits = ""
      for (let j = i; j < groups.length; j++) {
        digits += groups[j]
        if (digits.length > 19) break
        if (digits.length < 13) continue
        const sizes = groups.slice(i, j + 1).map((g) => g.length)
        if ((sizes.length === 1 || isCardGrouping(sizes)) && luhn(digits)) return true
      }
    }
  }
  return false
}

/** 4 4 4 4 (the last group 1–4 long), or American Express's 4 6 5 / Diners' 4 6 4. */
function isCardGrouping(sizes: number[]): boolean {
  const last = sizes[sizes.length - 1]
  if (sizes.length >= 3 && sizes.slice(0, -1).every((n) => n === 4) && last >= 1 && last <= 4) return true
  return sizes.length === 3 && sizes[0] === 4 && sizes[1] === 6 && (sizes[2] === 5 || sizes[2] === 4)
}

function luhn(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9 }
    sum += d
  }
  return sum % 10 === 0
}

// ─── Shapes the actions send back (ISO strings, so they cross to the browser) ───────────────

export type UncollectedSource = "manual" | "bc"

export type UncollectedLastContact = { kind: ContactKind; at: string; text: string | null; byName: string | null }

export type UncollectedCase = {
  id: string
  source: UncollectedSource
  /** The BC invoice it came from (source "bc" only). */
  bcKey: string | null
  buyerNo: string | null
  /** The Hub's Customers record, when the buyer number matched one (link: /tools/customers/<id>). */
  customerId: string | null
  buyerName: string
  email: string | null
  phone: string | null
  saleCode: string | null
  invoiceNo: string | null
  lots: number | null
  amountPaid: number | null
  /** ISO. Date-only values are stored at 12:00 UTC on their London day — show with formatDay. */
  paidAt: string | null
  status: UncollectedStatus
  nextChaseAt: string | null
  storageFrom: string | null
  notes: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
  closedAt: string | null
  /** London days since they paid (frozen on the day a case closed); null = paid date not known. */
  daysWaiting: number | null
  ageBand: AgeBandKey | null
  /** Open cases only: the next chase is overdue, due today, or later. */
  chase: ChaseState | null
  /** The latest call, email or letter (notes don't count). */
  lastContact: UncollectedLastContact | null
}

export type UncollectedEvent = {
  id: string
  kind: EventKind
  text: string | null
  byName: string | null
  at: string
}

export type UncollectedCaseDetail = UncollectedCase & {
  /** Newest first. */
  events: UncollectedEvent[]
}

export const UNCOLLECTED_SORTS = ["waiting", "recent", "chase", "amount", "name", "added"] as const
export type UncollectedSort = (typeof UNCOLLECTED_SORTS)[number]
export const SORT_LABELS: Record<UncollectedSort, string> = {
  waiting: "Longest waiting first",
  recent: "Most recently paid",
  chase: "Next chase soonest",
  amount: "Largest amount paid",
  name: "Buyer's name A–Z",
  added: "Most recently added",
}
export const isUncollectedSort = (v: unknown): v is UncollectedSort =>
  typeof v === "string" && (UNCOLLECTED_SORTS as readonly string[]).includes(v)

export type UncollectedFilter = {
  /** Which statuses to show. Missing or empty = the open ones (OPEN_STATUSES). */
  statuses?: UncollectedStatus[]
  /** One age band, or none for every age. A case with no paid date is in no band. */
  age?: AgeBandKey | null
  /** Words to find in the buyer's name, buyer number, email, sale or invoice number (every word must match).
   *  ⚠ Never put in the address bar — a search is usually a customer's name or email. The panel
   *  sends it to listCases itself and keeps it in the tab's sessionStorage. */
  q?: string
  sort?: UncollectedSort
}

export type UncollectedTotals = {
  /** Open cases (waiting, contacted, arranged, storage) — over EVERYTHING, whatever the filters. */
  open: number
  /** Lots on open cases, and how many open cases have no lot count (so the total is a minimum). */
  lots: number
  lotsUnknown: number
  /** £ paid on open cases, and how many have no amount. */
  money: number
  moneyUnknown: number
  /** The longest an open case has waited, in London days; null if none has a paid date. */
  oldestDays: number | null
  /** Open cases whose next chase is today / before today. */
  chasesToday: number
  chasesOverdue: number
  /** chasesToday + chasesOverdue. */
  chasesDue: number
  /** Cases whose status isn't one of the six (a future feed's typo). They are listed, counted and
   *  chased as "waiting" (statusOf), and the panel says how many there are so they get put right. */
  unknownStatus: number
}

export type UncollectedList = {
  cases: UncollectedCase[]
  /** How many match every filter (may be more than cases.length — see truncated). */
  matched: number
  /** true = more than UNCOLLECTED_LIMITS.list matched; only the first ones are in `cases`. */
  truncated: boolean
  /** Per status, with the search and age band applied but not the status choice (so a chip's
   *  number is what picking it shows). */
  statusCounts: Record<UncollectedStatus, number>
  /** Per age band, with the search and statuses applied but not the band choice. `none` = no paid date. */
  ageCounts: Record<AgeBandKey | "none", number>
  totals: UncollectedTotals
  /** The London day the figures were worked out for (YYYY-MM-DD). */
  today: string
  /** The filter as the server read it (defaults filled in). */
  filter: Required<Omit<UncollectedFilter, "age">> & { age: AgeBandKey | null }
}

/** What createCase takes. Text boxes may send strings for every field; blanks mean "not known". */
export type UncollectedInput = {
  buyerName: string
  buyerNo?: string | null
  email?: string | null
  phone?: string | null
  saleCode?: string | null
  invoiceNo?: string | null
  /** A whole number, or what was typed. */
  lots?: number | string | null
  /** Pounds, or what was typed ("£1,250.00" is fine). */
  amountPaid?: number | string | null
  /** YYYY-MM-DD, London days. */
  paidAt?: string | null
  nextChaseAt?: string | null
  storageFrom?: string | null
  notes?: string | null
}

/** What updateCase takes: only the fields being changed. null or "" clears one (never the name). */
export type UncollectedPatch = Partial<Omit<UncollectedInput, "buyerName">> & { buyerName?: string }

export type LogContactInput = {
  kind: ContactKind
  /** What happened. Needed for a note; optional for a call, email or letter. */
  text?: string | null
  /** undefined = leave the next chase date alone; null or "" = clear it; YYYY-MM-DD = set it. */
  nextChaseAt?: string | null
}

/** Every action answers this (a thrown server-action error is redacted in production). */
export type UncollectedResult<T = undefined> =
  | { ok: true; error?: undefined; data: T }
  | {
      ok: false
      error: string
      /** true = the tables aren't there yet (Run Migrations). */
      notReady?: boolean
      /** createCase, updateCase (a new invoice number) and setStatus (reopening): the OTHER open
       *  case already holding that invoice, to link to. */
      existingId?: string
      data?: undefined
    }

// ─── The filter in the address bar ──────────────────────────────────────────────────────────
// ?status=open (the default, left out) | closed | all | waiting,contacted…  ?age=15-30  ?sort=chase
// ⚠ Never the search words: they are usually a customer's name or email, and an address ends up in
// the browser's history and the server's request logs. Only the case id and these filters go in a URL.

type Params = URLSearchParams | Record<string, string | string[] | undefined>

function param(sp: Params, key: string): string | undefined {
  if (sp instanceof URLSearchParams) return sp.get(key) ?? undefined
  const v = sp[key]
  return Array.isArray(v) ? v[0] : v
}

const sameSet = (a: UncollectedStatus[], b: UncollectedStatus[]) =>
  a.length === b.length && a.every((s) => b.includes(s))

/** Reads the panel's filter from the address bar; anything unreadable falls back to the default.
 *  The search is always "" here — a `?q=` in an address is ignored (see above). */
export function parseUncollectedFilter(sp: Params): Required<Omit<UncollectedFilter, "age">> & { age: AgeBandKey | null } {
  const rawStatus = (param(sp, "status") ?? "").trim().toLowerCase()
  let statuses: UncollectedStatus[]
  if (rawStatus === "all") statuses = [...UNCOLLECTED_STATUSES]
  else if (rawStatus === "closed") statuses = [...CLOSED_STATUSES]
  else {
    const picked = rawStatus.split(",").map((s) => s.trim()).filter(isUncollectedStatus)
    statuses = picked.length ? UNCOLLECTED_STATUSES.filter((s) => picked.includes(s)) : [...OPEN_STATUSES]
  }
  const age = param(sp, "age")
  const sort = param(sp, "sort")
  return {
    statuses,
    age: isAgeBandKey(age) ? age : null,
    q: "",
    sort: isUncollectedSort(sort) ? sort : "waiting",
  }
}

/** The filter as a query string ("" or "?…"), leaving the defaults out — and NEVER the search. */
export function uncollectedFilterQuery(f: UncollectedFilter): string {
  const p = new URLSearchParams()
  const st = f.statuses?.length ? UNCOLLECTED_STATUSES.filter((s) => f.statuses!.includes(s)) : [...OPEN_STATUSES]
  if (sameSet(st, [...UNCOLLECTED_STATUSES])) p.set("status", "all")
  else if (sameSet(st, CLOSED_STATUSES)) p.set("status", "closed")
  else if (!sameSet(st, OPEN_STATUSES)) p.set("status", st.join(","))
  if (f.age) p.set("age", f.age)
  if (f.sort && f.sort !== "waiting") p.set("sort", f.sort)
  const s = p.toString()
  return s ? `?${s}` : ""
}
