// Accounts → Paid, not collected — the shared words, colours, date helpers and shapes.
//
// Jack, 2026-10-22: "a new panel inside the Accounts section to track people who pay and are not
// collecting — make the framework for now". A case is one buyer who has paid (for one invoice, or
// one sale) and hasn't collected their lots. Added by hand (source "manual"), or by the BC check
// (source "bc", keyed on bcKey = the invoice number) — lib/uncollected-feed.ts, nightly at 08:30
// and on "Check BC now". Jack, same day: "only paid things that haven't been collected for over
// 4 weeks". See RULES.md → "Accounts → Paid, not collected". Jack, 2026-10-23: storage is charged
// per lot once the free days after payment are over — the maths is "Storage charges" below
// (storageCharge), the settings are UncollectedSettings (lib/uncollected-settings.ts, server only).
//
// ⚠ A PLAIN module: no Prisma, no server-only imports — the panel's client components import the
// labels, colours and date helpers from here. The server actions are lib/actions/uncollected.ts.
// ⚠ Customer personal data: never bank or card details (looksLikeBankDetails refuses the obvious).
// Every day here is a London calendar day (Europe/London), never the server's.

// ─── The BC check (lib/uncollected-feed.ts) ─────────────────────────────────────────────────

/** A paid invoice's uncollected lots become a case once this many London days have passed since
 *  the day BC settled the invoice ("4 weeks after they paid"). */
export const UNCOLLECTED_AFTER_DAYS = 28
/** How far back the BC check looks at sales, in months. */
export const UNCOLLECTED_LOOKBACK_MONTHS = 12
/** When the nightly check runs, London time (server.js schedules it — after BC's overnight payment run).
 *  ⚠ Only the words the panel shows: server.js (CommonJS, can't import this) holds the real time as
 *  UNCOLLECTED_LONDON_TIME — change the two together. */
export const UNCOLLECTED_NIGHTLY_AT = "08:30"
/** A run that started this long ago and never finished is taken as dead (a restart, a crash). */
export const UNCOLLECTED_RUN_STALE_MINUTES = 30

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
    help: "Their free days are over and they're being charged storage. The charges start by themselves the day after the free days end — change the start on the case only if it should be different.",
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

/** Whole pence as "£1,234.50". "—" for none. Storage figures are kept in pence so they add up exactly. */
export function formatPence(p: number | null | undefined): string {
  return p == null || !Number.isFinite(p) ? "—" : GBP.format(Math.round(p) / 100)
}

/** A YYYY-MM-DD day as "15 Nov" — with the year when it isn't `ref`'s year ("15 Nov 2025"). */
export function shortDay(day: string, ref: string = londonDay()): string {
  const d = new Date(`${day}T12:00:00Z`)
  const sameYear = day.slice(0, 4) === ref.slice(0, 4)
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: LONDON_TZ })
}

// ─── Storage charges ────────────────────────────────────────────────────────────────────────
// Jack, 2026-10-23: "Remember it's 4 weeks after the item has been paid for — we need to start
// charging them for keeping the lots here. They will be charged per lot."
//
// The standard terms are Jack's (2026-10-23: "it's £2 per lot per week"): 28 free days after
// payment, then £2.00 per lot per WEEK + VAT (20%), any part of a week counting as a whole week.
// (BC's own buyer invoice, Reports/55004 AuctionInvoiceT0V, carries an old commented-out footer —
// "£5 per lot per day + VAT" — that is NOT what Vectis charges; the defaults were that until
// 2026-10-23.) BC has no storage logic of its own, and ⚠ the Hub never charges anything in BC: these
// figures are for staff to raise the charge. Money is NEVER stored — it changes every day, so it is
// worked out live from the case's storage start, its lots still uncollected and the settings
// (UncollectedSettings, read by lib/uncollected-settings.ts; these defaults until an admin changes
// them, or until Run Migrations — settings already saved in the table always win).
//
//  • Free days: storage starts the day AFTER paid day + graceDays (London days). Paid 1 Oct with 28
//    free days → free to 29 Oct, charged from 30 Oct. storageStartDay().
//  • The start is kept in the case's own storageFrom. The BC check writes it for cases from BC
//    ("by the storage rule" on the timeline — STORAGE_RULE_MARK) and moves it when the paid date or
//    the free days change, but NEVER moves a start a person set (storageStartOwner). A case with no
//    storageFrom yet (one added by hand, or before the check has been round) uses the rule live.
//  • Chargeable days = storage start → today (or → the day it closed), INCLUSIVE, never negative.
//    Per week: every week started counts as a week (12 days = 2 weeks).
//  • Lots charged = the case's lots still not collected (its `lots`). Not known → no total.
//  • Owed = lots × rate × days (or weeks), ex VAT; VAT on top (rounded to the penny); total.
//  • Waived: the case's latest "storage_waived" / "storage_resumed" event is the switch
//    (storageWaiverOf). Waived → nothing owed (what it would have been is still shown).

export const STORAGE_PERIODS = ["day", "week"] as const
export type StoragePeriod = (typeof STORAGE_PERIODS)[number]
export const isStoragePeriod = (v: unknown): v is StoragePeriod =>
  typeof v === "string" && (STORAGE_PERIODS as readonly string[]).includes(v)

export type StorageSettings = {
  /** Free London days after the paid day before storage starts. */
  graceDays: number
  /** Per lot, per day or per week, ex VAT — whole pence. */
  ratePence: number
  period: StoragePeriod
  /** VAT on the storage charge, as a percentage (20 = 20%). */
  vatPercent: number
}

/** The standard charges (Jack, 2026-10-23: "it's £2 per lot per week"): 28 free days after payment,
 *  then £2.00 (200p) per lot per WEEK + VAT at 20% — any part of a week counts as a whole week. Used
 *  until an admin saves others (a saved row always wins; a blank column in it falls back to these). */
export const STORAGE_DEFAULTS: StorageSettings = { graceDays: 28, ratePence: 200, period: "week", vatPercent: 20 }

export const STORAGE_LIMITS = {
  graceDaysMax: 365,
  /** £1,000 per lot per day or week. */
  ratePenceMax: 100_000,
  vatPercentMax: 100,
  /** A waive or resume reason. */
  reason: 2000,
} as const

/** The settings as the panel and the BC check read them (readStorageSettings in lib/uncollected-settings.ts). */
export type StorageSettingsInfo = StorageSettings & {
  /** false = the settings table isn't there yet (Run Migrations): these are the defaults and can't be saved. */
  ready: boolean
  /** true = an admin has saved them; false = the standard charges (STORAGE_DEFAULTS). */
  saved: boolean
  updatedByName: string | null
  /** ISO. */
  updatedAt: string | null
  /** true = they couldn't be read just now (not a missing table). The defaults are filled in, but the
   *  figures may be wrong — the panel says so, and the BC check sets no storage start that run. */
  readFailed: boolean
}

/** What a settings box sends. Pounds as typed ("2", "2.00", "£2.00"). */
export type StorageSettingsInput = {
  graceDays: number | string
  ratePounds: number | string
  period: string
  vatPercent: number | string
}

export const STORAGE_SETTINGS_NOT_READY =
  "Storage charge settings need Run Migrations — until an admin presses Run Migrations the standard charges are used (28 free days, then £2.00 per lot per week + VAT) and can't be changed."
export const STORAGE_SETTINGS_READ_FAILED =
  "The storage charge settings couldn't be read just now, so the figures use the standard charges and may be wrong — refresh to try again."
/** Where the standard charges come from, for the settings box. */
export const STORAGE_SOURCE_WORDS =
  "The standard charges are £2.00 per lot per week + VAT after 28 free days from when they paid — any part of a week counts as a whole week. The Hub works the figures out for you to raise the charge — it never charges anything in BC."

const plural = (n: number, one: string, more = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : more}`

/** One stored column read back: a valid value, or the default (a row from before a rule changed,
 *  or a column left blank, never breaks the figures). */
export function normaliseStorageSettings(row: {
  graceDays?: number | null; ratePence?: number | null; period?: string | null; vatPercent?: number | null
} | null | undefined): StorageSettings {
  const d = STORAGE_DEFAULTS
  const g = row?.graceDays
  const r = row?.ratePence
  const v = row?.vatPercent
  return {
    graceDays: Number.isInteger(g) && g! >= 0 && g! <= STORAGE_LIMITS.graceDaysMax ? g! : d.graceDays,
    ratePence: Number.isInteger(r) && r! >= 0 && r! <= STORAGE_LIMITS.ratePenceMax ? r! : d.ratePence,
    period: isStoragePeriod(row?.period) ? row!.period as StoragePeriod : d.period,
    vatPercent: typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= STORAGE_LIMITS.vatPercentMax ? v : d.vatPercent,
  }
}

/** Reads a settings box; plain-English refusals. */
export function parseStorageSettingsInput(input: StorageSettingsInput | null | undefined):
  { ok: true; value: StorageSettings } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Fill in the storage charges first." }
  const text = (v: unknown) => (v == null ? "" : String(v)).replace(/[£,%\s]/g, "")

  const g = text(input.graceDays)
  if (!/^\d+$/.test(g) || Number(g) > STORAGE_LIMITS.graceDaysMax) {
    return { ok: false, error: `Free days: a whole number of days from 0 to ${STORAGE_LIMITS.graceDaysMax}, for example 28.` }
  }
  const r = text(input.ratePounds)
  if (!/^\d+(\.\d{1,2})?$/.test(r)) return { ok: false, error: "Charge per lot: pounds and pence, for example 2.00." }
  const ratePence = Math.round(Number(r) * 100)
  if (ratePence > STORAGE_LIMITS.ratePenceMax) {
    return { ok: false, error: `Charge per lot: ${formatPence(STORAGE_LIMITS.ratePenceMax)} at most.` }
  }
  if (!isStoragePeriod(input.period)) return { ok: false, error: "Pick per day or per week." }
  const v = text(input.vatPercent)
  if (!/^\d+(\.\d{1,2})?$/.test(v) || Number(v) > STORAGE_LIMITS.vatPercentMax) {
    return { ok: false, error: "VAT: a percentage from 0 to 100, for example 20." }
  }
  return { ok: true, value: { graceDays: Number(g), ratePence, period: input.period, vatPercent: Number(v) } }
}

/** "£2.00 per lot per week + VAT" (or "… (no VAT)" at 0%). */
export function rateWords(s: Pick<StorageSettings, "ratePence" | "period" | "vatPercent">): string {
  const vat = s.vatPercent > 0 ? ` + VAT${s.vatPercent === 20 ? "" : ` at ${s.vatPercent}%`}` : " (no VAT)"
  return `${formatPence(s.ratePence)} per lot per ${s.period}${vat}`
}

/** Said beside the free days when there are fewer than the BC check waits before it adds a case
 *  (UNCOLLECTED_AFTER_DAYS): storage then runs before the case is on the panel. Nothing is lost — a
 *  case counts from its start once it's added — but the tile and the list can't show it until then.
 *  null when the free days are at least that long. */
export function storageGraceWarning(graceDays: number): string | null {
  if (!(graceDays < UNCOLLECTED_AFTER_DAYS)) return null
  return `The BC check only adds a case ${UNCOLLECTED_AFTER_DAYS} days after they paid, so with ${plural(graceDays, "free day")} storage is already running when a case from BC appears. It's counted from its start, so nothing is lost — but the Storage owed tile and the list can't show it until the case is added.`
}

/** "28 free days after they pay, then £2.00 per lot per week + VAT" — the settings in one line. */
export function storageSettingsWords(s: StorageSettings): string {
  return `${plural(s.graceDays, "free day")} after they pay, then ${rateWords(s)}`
}

/** Text colour for a storage figure that is being charged (orange, like the Storage status), light and dark. */
export const STORAGE_TEXT = "text-orange-700 dark:text-orange-300"

/** The London day a paid date (a stored date, an instant, or YYYY-MM-DD) falls on. */
const dayOfPaid = (paidAt: Date | string): string => (typeof paidAt === "string" && isDay(paidAt) ? paidAt : londonDay(paidAt))

/** The day storage charges start for a paid date: the day AFTER paid day + graceDays. null with no paid date. */
export function storageStartDay(paidAt: Date | string | null | undefined, graceDays: number): string | null {
  if (!paidAt) return null
  return addDays(dayOfPaid(paidAt), Math.max(0, Math.floor(graceDays)) + 1)
}

/** What storageCharge needs from a case (UncollectedCase and a database row both fit). */
export type StorageCase = {
  paidAt: Date | string | null | undefined
  storageFrom: Date | string | null | undefined
  /** Set = the case is closed (collected or closed another way): the clock stopped on that day. */
  closedAt?: Date | string | null
  /** Lots still not collected; null = not known. */
  lots: number | null | undefined
  /** The case's storage switch (storageWaiverOf) — waived when `waiver.waived`, then nothing is owed. */
  waiver?: StorageWaiver | null
  /** The same as a plain flag, where only that is known (a total over many cases). */
  waived?: boolean
}

export type StorageState =
  /** No storage start: no paid date and no start set. */
  | "unknown"
  /** Starts after the end day (still in the free days, or closed before it began). */
  | "notYet"
  /** Open and being charged. */
  | "running"
  /** Closed — the clock stopped on the day it closed. */
  | "stopped"

export type StorageCharge = {
  state: StorageState
  /** state isn't "unknown": there is a start to count from. */
  known: boolean
  /** At least one day is chargeable (state "running" or "stopped"). */
  started: boolean
  /** YYYY-MM-DD the charges start, or null (state "unknown"). */
  startDay: string | null
  /** "set" = the case's own storage start (the BC check's, or a person's); "rule" = worked out from the
   *  paid date now (no start stored yet); null = not known. */
  startBasis: "set" | "rule" | null
  /** The day the RULE gives from the paid date (the day after paid day + the free days), whatever the
   *  case holds — "the standard start". null with no paid date. */
  standardFrom: string | null
  /** The last free day (startDay − 1), or null. */
  freeUntil: string | null
  /** Where the clock stops: today, or the day the case closed. */
  endDay: string
  /** The day the case closed, when it is closed (the clock stopped there); null while open. */
  stoppedOn: string | null
  /** Chargeable days, inclusive; 0 before it starts. */
  days: number
  /** What each lot is charged for: days, or weeks started. */
  units: number
  period: StoragePeriod
  ratePence: number
  vatPercent: number
  lots: number | null
  /** Owed, in pence: ex VAT, the VAT, and the total. null = it can't be worked out (the number of lots
   *  isn't known, or there's no start). 0 when waived, and before the charges start. */
  exVatPence: number | null
  vatPence: number | null
  totalPence: number | null
  /** What it comes to before any waiver (the same as above when not waived). */
  fullExVatPence: number | null
  fullVatPence: number | null
  fullTotalPence: number | null
  waived: boolean
  /** Who waived it, why and when (when waived and known); null otherwise. */
  waiver: StorageWaiver | null
  /** The whole line in words (storageWords) — "£2.00 per lot per week + VAT since 15 Nov — 3 lots ×
   *  2 weeks (12 days — a week started counts as a week) = £12.00 + VAT £2.40 = £14.40",
   *  "Free until 29 Oct — …", "Storage waived — …". */
  words: string
  /** The column's figure (storageShortWords): "£14.40", "Waived", "Free until 29 Oct", "—". */
  shortWords: string
}

/** VAT on an ex-VAT figure in pence, to the nearest penny (a half penny rounds up). */
export const vatOnPence = (exVatPence: number, vatPercent: number): number =>
  Math.round((exVatPence * vatPercent) / 100 + 1e-9)

/**
 * A case's storage charge as it stands on `today` (London). Pure: no database, no clock but `today`.
 * Start = the case's storageFrom, else the rule from its paid date. End = today, or the day it closed.
 * Days are counted inclusively; per week, every week started counts. Never negative.
 */
export function storageCharge(c: StorageCase, s: StorageSettings, today: string = londonDay()): StorageCharge {
  const stoppedOn = c.closedAt ? londonDay(c.closedAt) : null
  const endDay = stoppedOn ?? today
  const set = c.storageFrom ? londonDay(c.storageFrom) : null
  const standardFrom = storageStartDay(c.paidAt, s.graceDays)
  const startDay = set ?? standardFrom
  const lots = c.lots == null || !Number.isFinite(c.lots) ? null : Math.max(0, Math.floor(c.lots))
  const days = startDay ? Math.max(0, daysBetween(startDay, endDay) + 1) : 0
  const units = s.period === "week" ? Math.ceil(days / 7) : days
  // No start to count from, or no lot count → no figure at all (never a calm £0 — design rule 7).
  const ex = lots == null || !startDay ? null : lots * s.ratePence * units
  const vat = ex == null ? null : vatOnPence(ex, s.vatPercent)
  const waived = !!c.waiver?.waived || !!c.waived
  const state: StorageState = !startDay ? "unknown" : days === 0 ? "notYet" : stoppedOn ? "stopped" : "running"
  const charge: StorageCharge = {
    state, known: state !== "unknown", started: days > 0,
    startDay,
    startBasis: set ? "set" : startDay ? "rule" : null,
    standardFrom,
    freeUntil: startDay ? addDays(startDay, -1) : null,
    endDay, stoppedOn, days, units,
    period: s.period, ratePence: s.ratePence, vatPercent: s.vatPercent, lots,
    exVatPence: ex == null ? null : waived ? 0 : ex,
    vatPence: vat == null ? null : waived ? 0 : vat,
    totalPence: ex == null || vat == null ? null : waived ? 0 : ex + vat,
    fullExVatPence: ex, fullVatPence: vat, fullTotalPence: ex == null || vat == null ? null : ex + vat,
    waived,
    waiver: waived && c.waiver?.waived ? c.waiver : null,
    words: "", shortWords: "",
  }
  charge.words = storageWords(charge, today)
  charge.shortWords = storageShortWords(charge, today)
  return charge
}

/** Storage owed over many cases (the panel's tile). */
export type StorageTotals = {
  exVatPence: number
  vatPence: number
  totalPence: number
  /** Cases being charged (days > 0, not waived) whose figures are in the totals. */
  charging: number
  /** Cases being charged whose number of lots isn't known — not in the totals, so they are a minimum. */
  lotsUnknown: number
  /** Cases whose storage is waived. */
  waived: number
  /** Cases with no storage start (no paid date). */
  noStart: number
}

export function addStorage(charges: StorageCharge[]): StorageTotals {
  const t: StorageTotals = { exVatPence: 0, vatPence: 0, totalPence: 0, charging: 0, lotsUnknown: 0, waived: 0, noStart: 0 }
  for (const c of charges) {
    if (c.state === "unknown") { t.noStart++; continue }
    if (c.days === 0) continue
    if (c.waived) { t.waived++; continue }
    if (c.totalPence == null) { t.lotsUnknown++; continue }
    t.charging++
    t.exVatPence += c.exVatPence ?? 0
    t.vatPence += c.vatPence ?? 0
    t.totalPence += c.totalPence
  }
  return t
}

/** "3 lots × 12 days" / "3 lots × 2 weeks (12 days — a week started counts as a week)". */
function sumWords(c: StorageCharge): string {
  const lots = plural(c.lots ?? 0, "lot")
  if (c.period === "day") return `${lots} × ${plural(c.days, "day")}`
  return `${lots} × ${plural(c.units, "week")} (${plural(c.days, "day")} — a week started counts as a week)`
}

/** "= £180.00 + VAT £36.00 = £216.00", from the FULL figures (before any waiver). */
function moneyWords(c: StorageCharge): string {
  if (c.fullExVatPence == null || c.fullTotalPence == null) return ""
  return c.vatPercent > 0
    ? ` = ${formatPence(c.fullExVatPence)} + VAT ${formatPence(c.fullVatPence)} = ${formatPence(c.fullTotalPence)}`
    : ` = ${formatPence(c.fullTotalPence)}`
}

/**
 * The storage line on a case, in words:
 *  "£2.00 per lot per week + VAT since 15 Nov — 3 lots × 2 weeks (12 days — a week started counts as
 *   a week) = £12.00 + VAT £2.40 = £14.40"   (per day: "… — 3 lots × 12 days = …")
 *  "Free until 29 Oct — £2.00 per lot per week + VAT from 30 Oct"
 *  "Storage waived — it would be £14.40 (£2.00 per lot per week + VAT since 15 Nov — 3 lots × 2 weeks (…))"
 */
export function storageWords(c: StorageCharge, today: string = londonDay()): string {
  const rate = rateWords(c)
  if (c.state === "unknown") return "Storage start not known — the case has no paid date. Set the storage start on the case."
  const start = shortDay(c.startDay!, today)
  if (c.state === "notYet") {
    return c.endDay === today
      ? `Free until ${shortDay(c.freeUntil!, today)} — ${rate} from ${start}`
      : `Closed on ${shortDay(c.endDay, today)}, before storage charges began (they'd have started ${start})`
  }
  const span = c.state === "stopped" ? `from ${start} until it closed on ${shortDay(c.endDay, today)}` : `since ${start}`
  if (c.lots == null) {
    return `${rate} ${span} — ${plural(c.days, "day")} so far, but the number of lots isn't known, so the total can't be worked out`
  }
  const line = `${rate} ${span} — ${sumWords(c)}${moneyWords(c)}`
  return c.waived ? `Storage waived — it would be ${formatPence(c.fullTotalPence)} (${rate} ${span} — ${sumWords(c)})` : line
}

/** The storage column's figure: "£14.40", "Waived", "Free until 29 Oct", "Lots not known", "—". */
export function storageShortWords(c: StorageCharge, today: string = londonDay()): string {
  if (c.state === "unknown") return "—"
  if (c.state === "notYet") return c.endDay === today ? `Free until ${shortDay(c.freeUntil!, today)}` : "None"
  if (c.waived) return "Waived"
  if (c.totalPence == null) return "Lots not known"
  return formatPence(c.totalPence)
}

// ─── Who set a case's storage start ─────────────────────────────────────────────────────────

/** Every storage start the RULE sets (the BC check, or a change to the free days) says this on the
 *  timeline, so a start a person set can be told apart and is never moved.
 *  ⚠ storageStartOwner reads it — never write it in a person's words. */
export const STORAGE_RULE_MARK = "by the storage rule"

/** "storage charges from 30 Oct 2026 by the storage rule (28 free days after they paid)" —
 *  ⚠ no "paid by" / "paid on" in it (paidExactFromText reads those). */
export function storageRuleWords(startDay: string, graceDays: number, was?: string | null): string {
  const day = formatDay(`${startDay}T12:00:00Z`)
  const from = was && was !== startDay ? `${formatDay(`${was}T12:00:00Z`)} → ${day}` : day
  return `storage charges from ${from} ${STORAGE_RULE_MARK} (${plural(graceDays, "free day")} after they paid)`
}

/** The event kinds a storage start is changed in: the check's "created" / "edit", a person's "edit"
 *  (Changed storage charges from to …) and "status" (Storage charges apply — storage charges from …). */
export const STORAGE_START_KINDS = ["created", "edit", "status"] as const

/** Who set the case's storage start, from its timeline (newest first; only the newest event that
 *  mentions "storage charges from" counts): "rule" (the BC check / the settings), "person", or null —
 *  nobody has, or a person CLEARED it, which hands it back to the rule. */
export function storageStartOwner(events: { kind: string; text: string | null }[]): "rule" | "person" | null {
  for (const e of events) {
    if (!(STORAGE_START_KINDS as readonly string[]).includes(e.kind)) continue
    const t = e.text ?? ""
    if (!/storage charges from/i.test(t)) continue
    if (t.includes(STORAGE_RULE_MARK)) return "rule"
    return /storage charges from cleared/i.test(t) ? null : "person"
  }
  return null
}

/** The rule may set (or move) the start: the rule set it last, or nobody set one and there is none.
 *  A start with no record of who set it (typed in when the case was added) is a person's. */
export const ruleMaySetStart = (owner: "rule" | "person" | null, storageFrom: Date | string | null | undefined) =>
  owner === "rule" || (owner === null && !storageFrom)

// ─── Waiving storage ────────────────────────────────────────────────────────────────────────

/** The timeline's storage switch: the LATEST of these events decides whether storage is waived.
 *  Its text is the reason (needed to waive). */
export const STORAGE_WAIVED = "storage_waived"
export const STORAGE_RESUMED = "storage_resumed"
export const STORAGE_SWITCH_KINDS = [STORAGE_WAIVED, STORAGE_RESUMED] as const

export type StorageWaiver = {
  waived: boolean
  /** The reason given (waive) or the note (resume), if any. */
  reason: string | null
  byName: string | null
  /** ISO. */
  at: string
}

/** The case's storage switch from its timeline (any order) — null when storage was never waived. */
export function storageWaiverOf(events: { kind: string; text: string | null; byName: string | null; at: Date | string }[]): StorageWaiver | null {
  let latest: (typeof events)[number] | null = null
  for (const e of events) {
    if (!(STORAGE_SWITCH_KINDS as readonly string[]).includes(e.kind)) continue
    if (!latest || new Date(e.at).getTime() > new Date(latest.at).getTime()) latest = e
  }
  if (!latest) return null
  return { waived: latest.kind === STORAGE_WAIVED, reason: latest.text, byName: latest.byName, at: new Date(latest.at).toISOString() }
}

// ─── Contact and the timeline ───────────────────────────────────────────────────────────────

export const CONTACT_KINDS = ["call", "email", "letter", "note"] as const
export type ContactKind = (typeof CONTACT_KINDS)[number]
export const isContactKind = (v: unknown): v is ContactKind =>
  typeof v === "string" && (CONTACT_KINDS as readonly string[]).includes(v)

/** Kinds that count as having been in touch with the buyer ("Last contact"). A note doesn't. */
export const REACHED_OUT_KINDS: ContactKind[] = ["call", "email", "letter"]

/** The BC check writes the same kinds as a person (lib/uncollected-feed.ts): "created" for a case it
 *  adds, "edit" when BC's figures change or it takes over a case added by hand, "status" when BC
 *  shows the lots collected, "note" when BC stops showing the invoice as paid — with byId null and
 *  byName "BC check (nightly)" / "BC check (Check BC now — <name>)", so the timeline says who. */
/** "storage_waived" / "storage_resumed" are the storage switch (storageWaiverOf, below): an admin
 *  waives a case's storage charges with a reason, and can put them back on. */
export type EventKind = "created" | ContactKind | "status" | "edit" | "storage_waived" | "storage_resumed"

/** Every symbol has its words beside it (design rule 3). */
export const EVENT_META: Record<EventKind, { icon: string; label: string }> = {
  created: { icon: "➕", label: "Added" },
  call: { icon: "📞", label: "Phone call" },
  email: { icon: "✉️", label: "Email" },
  letter: { icon: "📮", label: "Letter" },
  note: { icon: "📝", label: "Note" },
  status: { icon: "🔁", label: "Status changed" },
  edit: { icon: "✏️", label: "Details changed" },
  storage_waived: { icon: "🚫", label: "Storage charges waived" },
  storage_resumed: { icon: "💷", label: "Storage charges back on" },
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
 * On a case that came from BC (source "bc") these are BC's, and the BC check writes them again —
 * so they can't be changed in the Hub (the server refuses; the page shows them read-only).
 * Contact details, chase dates, storage start and notes stay the Hub's own (the check fills an
 * email or phone only while the case has none, and sets the storage start by the storage rule
 * only while no person has set it — storageStartOwner).
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
export const UNCOLLECTED_SYNC_NOT_READY =
  "Checking BC needs Run Migrations — an admin needs to press Run Migrations before the BC check can run or be shown."
export const UNCOLLECTED_BC_NOT_CONNECTED =
  "Your Business Central sign-in isn't connected, or has run out — sign in to BC, then try again."
/** Where to connect BC, coming back to `back` (a plain Hub path) afterwards. */
export const bcConnectHref = (back: string) => `/api/bc/auth?return=${encodeURIComponent(back.split("?")[0])}`
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

// ─── Where a case came from, and its paid date ──────────────────────────────────────────────

export type UncollectedSource = "manual" | "bc"

export const SOURCE_META: Record<UncollectedSource, { label: string; help: string; chip: string }> = {
  bc: {
    label: "From BC",
    help: `Added or kept up to date by the BC check: a paid invoice whose lots still weren't collected ${UNCOLLECTED_AFTER_DAYS} days after it was paid. A case added by hand that the check matched to its invoice shows this too; its name, sale, invoice, lots, amount and paid date now come from BC`,
    chip: "border-sky-300 dark:border-sky-700 text-sky-700 dark:text-sky-300",
  },
  manual: {
    label: "Added by hand",
    help: "Typed in by a member of staff",
    chip: "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300",
  },
}

/**
 * BC's published feeds carry no payment date, so a case from BC carries the London day BC last
 * changed the paid invoice — the day it was settled. They paid ON OR BEFORE it, hence "Paid by". A
 * paid date typed by hand is the day they paid ("Paid").
 *
 * BC does hold the exact day: EVA_AuctionLine field 153 EVA_DatePaidByBuyer (set by codeunit 75075
 * ReleaseForPayment from the customer ledger entry's Closed at Date). It isn't on the published
 * Auction_Lines_Excel page yet; the BC check looks for it on every run and, once it's there, uses each
 * lot's own paid date instead ("Paid on (BC)") — the case's timeline says which (PAID_EXACT_MARK).
 */
export const PAID_BY_HELP = "BC's date the invoice was settled — they paid on or before this day."
export const PAID_EXACT_HELP = "The day BC recorded the payment for these lots (BC's own paid date)."

/** On the check's timeline line, marks a paid date that is BC's own (EVA_DatePaidByBuyer), not the
 *  settled-date stand-in. ⚠ paidExactFromText reads it — the check's words must keep it. */
export const PAID_EXACT_MARK = "BC's own paid date"

/** Whether the check's line (its first line only — lot lists follow it) gave BC's own paid date
 *  (true), the settled date (false: "paid by …"), or said nothing about it (null). */
export function paidExactFromText(text: string | null | undefined): boolean | null {
  const head = (text ?? "").split("\n", 1)[0]
  if (head.includes(PAID_EXACT_MARK)) return true
  return /\bpaid by\b/i.test(head) ? false : null
}

/** "Paid by 3 Jun 2026" (from BC, settled date), "Paid on 3 Jun 2026" (BC's own paid date),
 *  "Paid 3 Jun 2026" (by hand), or "Paid date not known". */
export function paidWords(source: UncollectedSource, paidAt: Date | string | null | undefined, exact = false): string {
  if (!paidAt) return "Paid date not known"
  return `${source === "bc" ? (exact ? "Paid on" : "Paid by") : "Paid"} ${formatDay(paidAt)}`
}

/** What a paid date is called on a case: "Paid on (BC)" when BC gave its own paid date, "Paid by
 *  (BC settled date)" when it is the settled-date stand-in, "Paid on" by hand. */
export const paidTerm = (source: UncollectedSource, exact = false) =>
  source === "bc" ? (exact ? "Paid on (BC)" : "Paid by (BC settled date)") : "Paid on"

/** The help beside a paid date. */
export const paidHelp = (source: UncollectedSource, exact = false) =>
  source === "bc" ? (exact ? PAID_EXACT_HELP : PAID_BY_HELP) : "The day they paid, as typed in."

// ─── The BC check's runs (UncollectedSyncRun) ───────────────────────────────────────────────

export type UncollectedSyncTrigger = "nightly" | "manual"

/** One UncollectedSyncRun row as the panel shows it (ISO strings). */
export type UncollectedSyncRunInfo = {
  id: string
  startedAt: string
  finishedAt: string | null
  /** "nightly" or "manual" (anything else is shown as written). */
  trigger: string
  byName: string | null
  /** null = still running, or it never finished (a restart). */
  ok: boolean | null
  lotsSeen: number | null
  buyers: number | null
  /** Invoices paid at least UNCOLLECTED_AFTER_DAYS ago with lots still not collected. */
  found: number | null
  added: number | null
  updated: number | null
  closed: number | null
  note: string | null
  error: string | null
}

/** Where the BC check stands — the panel's "Last checked from BC" line and Check BC now. */
export type UncollectedCheckState = {
  /** A check is running now in this Hub (the nightly one, Check BC now — both run in the one server
   *  process, which holds the run's lock). */
  running: boolean
  /** When the running check started, who or what started it. */
  startedAt: string | null
  trigger: string | null
  byName: string | null
  /** What the running check is doing, in words with its counts so far — null when not known. */
  progress: string | null
  /** Someone pressed Stop on the running check (it stops within seconds). */
  stopBy: string | null
  /** ISO — a run row that started under UNCOLLECTED_RUN_STALE_MINUTES ago, since this server started,
   *  and never recorded an end, while nothing is running: it most likely stopped without saying so.
   *  The check won't start another until UNCOLLECTED_RUN_STALE_MINUTES after this. null = none. */
  stuckSince: string | null
  /** Open cases from BC now (what "Last checked" counts); null if it couldn't be counted. */
  openFromBc: number | null
  /** The newest run (running or finished). */
  latest: UncollectedSyncRunInfo | null
  /** The newest run that finished and worked. */
  lastOk: UncollectedSyncRunInfo | null
  /** The server's clock, so "how long ago" never trusts the device's. */
  now: string
}

const n0 = (n: number | null | undefined) => (n ?? 0).toLocaleString("en-GB")
const many = (n: number | null | undefined, one: string, more = `${one}s`) => `${n0(n)} ${(n ?? 0) === 1 ? one : more}`

/** The sentence a finished run is summed up in:
 *  "Checked 1,240 uncollected lots for 312 buyers — 46 paid over 4 weeks ago: 9 new, 2 closed as collected." */
export function syncResultWords(r: Pick<UncollectedSyncRunInfo, "lotsSeen" | "buyers" | "found" | "added" | "updated" | "closed">): string {
  const head = `Checked ${many(r.lotsSeen, "uncollected lot")} for ${many(r.buyers, "buyer")}`
  const weeks = UNCOLLECTED_AFTER_DAYS % 7 === 0 ? `${UNCOLLECTED_AFTER_DAYS / 7} weeks` : `${UNCOLLECTED_AFTER_DAYS} days`
  const changes = [
    r.added ? `${n0(r.added)} new` : null,
    r.updated ? `${n0(r.updated)} updated` : null,
    r.closed ? `${n0(r.closed)} closed as collected` : null,
  ].filter(Boolean)
  return `${head} — ${n0(r.found)} paid over ${weeks} ago: ${changes.length ? changes.join(", ") : "nothing new or changed"}.`
}

export const triggerWords = (t: string | null | undefined) => (t === "nightly" ? "nightly" : t === "manual" ? "Check BC now" : (t || "unknown"))

/** How the error of a run someone STOPPED begins ("Stopped by Sam — …"); the feed writes it. */
export const UNCOLLECTED_STOPPED_PREFIX = "Stopped by"
/** A run that ended because someone pressed Stop (not a fault). */
export const isStoppedRun = (r: Pick<UncollectedSyncRunInfo, "ok" | "error"> | null | undefined) =>
  !!r && r.ok === false && (r.error ?? "").startsWith(`${UNCOLLECTED_STOPPED_PREFIX} `)

/** A sentence for the screen with ONE full stop at the end — the feed's messages already have one. */
export const sentence = (s: string | null | undefined, fallback = "no reason was given") =>
  `${(s || fallback).trim().replace(/[.\s]+$/, "")}.`

// ─── Where a lot is in BC: its location as well as the Collected tick ───────────────────────
// Jack, 2026-10-23 (on sandbox): "This first one is wrong — lot 513 has been collected and so has
// 551." BC's Collected tick (Auction_Lines_Excel.EVA_Collected) is a FlowField: it is set only once
// the lot's collection docket is POSTED. Staff often hand lots over and scan them to location
// COLLECTED without posting the docket — the docket stays open in CollectionList ("Awaiting
// Release") while the lot's receipt line says EVA_ArticleLocationCode = "COLLECTED". So the tick
// alone said lots were still here that had gone. The BC check and the case page also read each
// lot's CURRENT location (Receipt_Lines_Excel.EVA_ArticleLocationCode, live, ≤ 20 ids a call):
//  • GONE_LOCATIONS — the lot has left us: treated EXACTLY like the Collected tick (not charged, not
//    counted in a case's lots, and a case whose lots have all gone closes as Collected).
//  • QUERY_LOCATIONS — something needs looking at: not charged, not counted in a case's lots or its
//    storage, and flagged on the case ("Lot 513 is at MISSING in BC — check it before chasing").
//  • anything else (a shelf, a bench, a cage, SANDOWN, blank) — still here.
// A lot whose receipt line can't be read (no unique ID, not found, lines that disagree, or BC refusing
// locations outright) is judged on the tick alone, as before, and the run's notes say how many; a
// buyer whose locations BC didn't ANSWER for isn't judged by the check that run at all (the case page
// still shows its lots on the tick, saying so). A tick always wins over a location.
// Codes are compared upper case with spaces taken out (normaliseLocation; "-" and "_" are ignored
// too, so "RE LOTTED" and "RELOTTED" read as RE-LOTTED). ⚠ The panel's "How cases are added" note
// and the case page's key show these two lists from here — change them here only.

/** Locations that mean the lot has LEFT us — exactly like BC's Collected tick. ⚠ QUERY is one of them
 *  (Jack, 2026-10-23: "anything in query, shipped and collected should be gone and shouldn't be on
 *  here") — it was a "check this lot" location until then. */
export const GONE_LOCATIONS = ["COLLECTED", "SHIPPED", "QUERY", "RETURNED", "DISPOSAL", "CHARITY"] as const
/** Locations that mean the lot needs checking — not charged, not counted, flagged on the case. */
export const QUERY_LOCATIONS = ["MISSING", "RE-LOTTED", "RE-AUCTION"] as const

/** A BC location code as compared and shown: upper case, no spaces ("" for none). */
export const normaliseLocation = (v: unknown): string => (v == null ? "" : String(v)).toUpperCase().replace(/\s+/g, "")
const locationKey = (v: unknown) => normaliseLocation(v).replace(/[-_]/g, "")
const GONE_KEYS = new Set<string>(GONE_LOCATIONS.map(locationKey))
const QUERY_KEYS = new Set<string>(QUERY_LOCATIONS.map(locationKey))

export type LocationKind = "gone" | "query" | "here"

/** What a location says about a lot: "gone", "query", or "here" (any other code, or none). */
export function locationKind(location: string | null | undefined): LocationKind {
  const k = locationKey(location)
  return !k ? "here" : GONE_KEYS.has(k) ? "gone" : QUERY_KEYS.has(k) ? "query" : "here"
}

/**
 * Where a lot stands, from BC's Collected tick and its location (null = the location wasn't read —
 * the tick alone decides): "collected" (the tick), "gone" (a GONE location, no tick — treated exactly
 * as collected), "query" (a QUERY location — check it), "here" (still with us).
 */
export type LotState = "collected" | "gone" | "query" | "here"
export function lotState(ticked: boolean, location: string | null | undefined): LotState {
  if (ticked) return "collected"
  if (location == null) return "here"
  const kind = locationKind(location)
  return kind === "gone" ? "gone" : kind === "query" ? "query" : "here"
}
/** Collected by the tick or by a GONE location. */
export const isGoneState = (s: LotState) => s === "collected" || s === "gone"

/** "COLLECTED, SHIPPED, RETURNED, DISPOSAL or CHARITY" ("and" with joiner "and"). */
export function locationListWords(codes: readonly string[], joiner: "or" | "and" = "or"): string {
  if (codes.length <= 1) return codes.join("")
  return `${codes.slice(0, -1).join(", ")} ${joiner} ${codes[codes.length - 1]}`
}

/** The flag for a lot at a QUERY location: "Lot 513 is at MISSING in BC — check it before chasing"
 *  ("Lot 513 (F084) …" when the case covers more than one sale). No full stop. */
export function queryLotWords(lot: { lotNo: string; saleCode?: string | null; location: string }, withSale = false): string {
  return `Lot ${lot.lotNo}${withSale && lot.saleCode ? ` (${lot.saleCode})` : ""} is at ${normaliseLocation(lot.location)} in BC — check it before chasing`
}

// ─── A buyer's lots, read live from BC on the case page ─────────────────────────────────────

/** One lot from BC's Auction_Lines_Excel, as the case page lists it. */
export type UncollectedBcLot = {
  uniqueId: string | null
  /** "366" or "366A". */
  lotNo: string
  description: string | null
  hammer: number | null
  /** BC's Collected tick (EVA_Collected — the lot's collection docket was posted). */
  collected: boolean
  /** Where BC has the lot now (Receipt_Lines_Excel EVA_ArticleLocationCode, normalised — "" when BC
   *  has none); null when it wasn't read (locationRead false). */
  location: string | null
  /** Its bin there (EVA_ArticleBinCode), or null. */
  bin: string | null
  /** false = the lot's receipt line couldn't be read (no unique ID, not found, or BC didn't answer),
   *  so its location isn't known and BC's Collected tick alone decides. */
  locationRead: boolean
  /** The tick and the location together (lotState): collected · gone (by location) · query · here. */
  state: LotState
  saleCode: string | null
  saleName: string | null
  /** YYYY-MM-DD as BC gives it. */
  saleDate: string | null
}

export type UncollectedBcLots = {
  buyerNo: string
  /** The sales read, joined ("F067" or "F067, F068"). */
  saleCode: string
  /** The sales read, in the case's order. */
  sales: string[]
  /** Sales on the case that weren't read: past the few a case page reads, or left off the case's
   *  sale box ("+N more"). 0 = every sale of the case was read. */
  salesLeftOut: number
  /** Sales read that gave NO lot sold to them — a sale they didn't buy in, or a code that isn't a real
   *  sale (typed by hand). The case is never "all collected" while there is one. */
  emptySales: string[]
  /** Sold to them in those sales (hammer over £0, not withdrawn) — collected and not. */
  lots: UncollectedBcLot[]
  /** true = BC had more than the page asked for; only the first ones are listed. */
  more: boolean
  /** How many of the listed lots' locations couldn't be read (judged on the tick alone), and why —
   *  null when every location was read. */
  locationsUnread: number
  locationError: string | null
  /** ISO — when BC was read. */
  readAt: string
}

// ─── Shapes the actions send back (ISO strings, so they cross to the browser) ───────────────

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
  /** Storage as it stands today: storageCharge(case, settings, today) with the case's storage switch
   *  (readCaseStorageFlags → waiver). Never stored — worked out on every read. */
  storage: StorageCharge
  /** true = paidAt is BC's own paid date ("Paid on (BC)"); false = the settled-date stand-in
   *  ("Paid by (BC settled date)") or typed by hand. readCaseStorageFlags in lib/uncollected-settings.ts. */
  paidExact: boolean
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
  /** The storage settings `storage` was worked out with (readStorageSettings). */
  storageSettings: StorageSettingsInfo
  /** Who set the case's own storage start (storageFrom), from its timeline (readStorageStartOwner):
   *  "rule" = the storage rule (the BC check, or a change to the free days) — the check keeps it in
   *  step with the paid date; "person" = a person (typed, or "Storage charges apply" with no paid
   *  date) — the check never moves it; null = no start on the case, so the rule works it out live. */
  storageStartBy: "rule" | "person" | null
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
  /** Storage owed over every OPEN case today (storageOwedOnOpenCases in lib/uncollected-settings.ts). */
  storage: StorageTotals
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
  /** The storage settings the figures used (readStorageSettings). */
  storageSettings: StorageSettingsInfo
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
      /** checkBcNow, bcLotsForCase: the person's own BC sign-in isn't connected (or has run out) —
       *  the page links to bcConnectHref(). */
      needsBc?: boolean
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
