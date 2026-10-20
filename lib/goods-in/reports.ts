import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { addDaysYmd, isYmd, londonDayStart, londonYmd } from "@/app/(app)/tools/warehouse/history/london-days"

// Goods In → Reports: what each warehouse person has done, per day. SERVER ONLY, a plain module
// (not "use server"), and it checks NOBODY — the page decides who may see what (getGoodsInUser +
// atLeast: a manager or admin sees everyone, a warehouse-tier person passes their own id as
// `onlyUserId` and sees only themselves).
//
// Read-only, from what Goods In already records — no new tables or columns, and nothing here
// touches Business Central:
//   • Scans     — GoodsInScanEvent (the handheld scanner, /scan), by userId, on the day of scannedAt.
//   • Moves     — GoodsInMovement (every screen: Scan to move, Benches, Locations, the scanner), by
//                 movedById, on the day of movedAt; the location's kind from GoodsInLocation.
//   • Check-ins — GoodsInReceipt booked in (not a draft, not void), by createdById, on the day of
//                 createdAt (Book in sets it to the booking time), with its totes and pallets.
//
// ⚠ Days and hours are LONDON days and hours, worked out IN SQL from the UTC `timestamp(3)` columns
// with ("col" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London' — BST-safe, whatever the database
// session's own time zone is. Range bounds are London midnights (londonDayStart) sent as plain UTC
// timestamps, so the WHERE compares the bare columns, like with like.
//
// Indexes: the ranges are read through GoodsInReceipt(createdAt), GoodsInMovement(movedAt) and
// GoodsInScanEvent(scannedAt) (the last two from migration 20261020120000_goods_in_report_indexes —
// before Run Migrations those two tables are simply read whole). The scan reads also add an
// always-true receivedAt bound so that, for one person, the (userId, receivedAt) index can narrow them.
//
// ⚠ One grouped query per report (GROUPING SETS over a UNION ALL of the three sources): per person
// per day, per person per hour, and per person — never a loop per person or per day.
//
// ⚠ A scan that MOVED something is also a move (the scanner writes its GoodsInMovement under the
// same person, stamped with the time it was scanned). Scans and Moves are separate measures, so it
// is in both; but the busiest hour, the hour-of-day counts and the activity list count it ONCE, as
// its move, so a scanner worker's hours aren't doubled.
//
// ⚠ Tolerant of missing tables: GoodsInScanEvent only exists after Run Migrations, and the rest
// only once Goods In is set up. A table that isn't there yet simply contributes nothing (its counts
// are 0) and is named in `missing`. Any OTHER database failure throws — the page says so.

// ─── Ranges ────────────────────────────────────────────────────────────────────────────────

export type ReportRangeKey = "today" | "yesterday" | "7d" | "30d" | "90d" | "6m" | "1y" | "custom"
/** London days, YYYY-MM-DD, both inclusive. */
export type ReportRange = { key: ReportRangeKey; from: string; to: string; label: string }

type PresetKey = Exclude<ReportRangeKey, "custom">

/** The range buttons, in order — `label` is the button's words. */
export const REPORT_RANGES: { key: PresetKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "6m", label: "6 months" },
  { key: "1y", label: "1 year" },
]

export const DEFAULT_RANGE: PresetKey = "7d"
/** The longest custom range taken (about three years); a longer one is shortened from the start. */
export const MAX_RANGE_DAYS = 1096
/** The earliest day a custom range can start on (nothing in Goods In is older). */
const EARLIEST_DAY = "2020-01-01"

const PRESET_LABEL: Record<PresetKey, string> = {
  today: "Today", yesterday: "Yesterday", "7d": "Last 7 days", "30d": "Last 30 days",
  "90d": "Last 90 days", "6m": "Last 6 months", "1y": "Last 12 months",
}

const pad = (n: number) => String(n).padStart(2, "0")
const ymdOf = (t: Date) => `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`

/** A YYYY-MM-DD day moved by whole calendar months, the day clamped to the month's length (31 Aug − 6 months = 28/29 Feb). */
function addMonthsYmd(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number)
  const first = new Date(Date.UTC(y, m - 1 + months, 1))
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return ymdOf(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, days))))
}

/** Whole days from one YYYY-MM-DD to another (to − from). */
function daysBetween(from: string, to: string): number {
  const t = (s: string) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d) }
  return Math.round((t(to) - t(from)) / 86_400_000)
}

function presetDays(key: PresetKey, today: string): { from: string; to: string } {
  switch (key) {
    case "today": return { from: today, to: today }
    case "yesterday": { const y = addDaysYmd(today, -1); return { from: y, to: y } }
    case "7d": return { from: addDaysYmd(today, -6), to: today }
    case "30d": return { from: addDaysYmd(today, -29), to: today }
    case "90d": return { from: addDaysYmd(today, -89), to: today }
    case "6m": return { from: addDaysYmd(addMonthsYmd(today, -6), 1), to: today }
    case "1y": return { from: addDaysYmd(addMonthsYmd(today, -12), 1), to: today }
  }
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
/** "5 Oct 2026" for a YYYY-MM-DD day (a calendar day, so no time zone comes into it). */
const dateWords = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}` }
/** "Mon 5 Oct 2026". */
const dayWords = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${dateWords(ymd)}` }

function preset(key: PresetKey, today: string): ReportRange {
  return { key, ...presetDays(key, today), label: PRESET_LABEL[key] }
}

/**
 * The range the page asked for, from its URL: `?range=today|yesterday|7d|30d|90d|6m|1y`, or
 * `?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD` (a from/to with no range is custom too). Days are
 * London days, both ends included. Anything that can't be read — an unknown range, a day that isn't
 * a real YYYY-MM-DD date — gives the default (last 7 days). Otherwise a custom range is tidied rather
 * than refused: From after To is swapped, a day after today becomes today, a From with no To runs to
 * today, a To with no From is that one day, nothing starts before 2020, and one longer than
 * MAX_RANGE_DAYS is shortened from the start — `from` / `to` / `label` always say what is shown.
 * A custom range that is exactly a preset comes back as that preset, so its button lights up.
 */
export function parseRange(sp: { range?: string; from?: string; to?: string }): ReportRange {
  const today = londonYmd()
  const key = (sp.range ?? "").trim()
  const asPreset = REPORT_RANGES.find(r => r.key === key)
  if (asPreset) return preset(asPreset.key, today)
  if (key && key !== "custom") return preset(DEFAULT_RANGE, today)

  const rawFrom = (sp.from ?? "").trim(), rawTo = (sp.to ?? "").trim()
  // A day that was given but can't be read is bad input — the default, not a guess at what was meant.
  if ((rawFrom && !isYmd(rawFrom)) || (rawTo && !isYmd(rawTo))) return preset(DEFAULT_RANGE, today)
  let from = rawFrom, to = rawTo
  if (!from && !to) return preset(DEFAULT_RANGE, today)
  if (!from) from = to
  if (!to) to = from > today ? from : today
  if (from > to) [from, to] = [to, from]
  if (to > today) to = today
  if (from > to) from = to
  if (from < EARLIEST_DAY) from = EARLIEST_DAY
  if (to < from) to = from
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) from = addDaysYmd(to, -(MAX_RANGE_DAYS - 1))

  for (const r of REPORT_RANGES) {
    const p = presetDays(r.key, today)
    if (p.from === from && p.to === to) return preset(r.key, today)
  }
  const label = from === to ? dayWords(from) : `${dateWords(from)} to ${dateWords(to)}`
  return { key: "custom", from, to, label }
}

/** Every London day in the range, oldest first — for a chart that shows the quiet days too. */
export function rangeDays(range: Pick<ReportRange, "from" | "to">): string[] {
  const out: string[] = []
  const n = Math.min(daysBetween(range.from, range.to), MAX_RANGE_DAYS - 1)
  for (let i = 0; i <= n; i++) out.push(addDaysYmd(range.from, i))
  return out
}

// ─── What the numbers mean (for the page's fold-out) ──────────────────────────────────────

/** The definitions in plain words — the page's "What the numbers mean" fold-out can list these as they are. */
export const REPORT_DEFINITIONS: { term: string; meaning: string }[] = [
  { term: "Scans", meaning: "Scans sent in from the handheld scanner (/scan or the Vectis Scanner app), counted on the day they were scanned." },
  { term: "Refused", meaning: "Scans the Hub couldn't act on — an unknown code, a location that's switched off, the item already there, or a scan too old to send." },
  { term: "Overtaken", meaning: "Scans not used because someone else had moved the item after it was scanned." },
  { term: "Sent late", meaning: "Scans made with no Wi-Fi that reached the Hub more than 5 minutes after they were scanned." },
  { term: "Moves", meaning: "Every move recorded under the person — on Scan to move, Benches, Locations or the handheld scanner. A scan that moved something counts here as well as under Scans." },
  { term: "Put away", meaning: "A tote or pallet moved to a storage or \"other\" location (or one with no kind set, or one that has since been removed)." },
  { term: "To bench", meaning: "A tote or pallet moved to a cataloguing bench." },
  { term: "Lots shelved", meaning: "A single lot moved — onto its shelf, or anywhere else." },
  { term: "Moved in bulk", meaning: "Moves made by \"Move everything\" on a location: each tote, pallet and lot it moved counts once. They are included in Moves too." },
  { term: "Check-ins", meaning: "Receipts booked in, counted for whoever pressed Book in, on the day they did. Check-ins not booked in yet, and voided receipts, aren't counted." },
  { term: "Totes booked / Pallets booked", meaning: "The totes and pallets on those receipts." },
  { term: "First / last", meaning: "The time of the person's earliest and latest move, scan or check-in that day." },
  { term: "Busiest hour", meaning: "The hour of the day with the most moves, scans and check-ins over the period. A scan that moved something counts once, as its move." },
  { term: "Days active", meaning: "Days with at least one move, scan or check-in." },
  { term: "Moves a day / Scans a day", meaning: "Moves or scans divided by Days active — an average over the days the person did anything, not over every day in the range." },
  { term: "Scanners used", meaning: "How many different handheld scanners the person sent scans from." },
  { term: "Days and times", meaning: "UK days and times (GMT or BST, whichever applied on the day)." },
]

// ─── The report ───────────────────────────────────────────────────────────────────────────

export type Counts = {
  scans: number; refused: number; stale: number; late: number
  moves: number; putAway: number; toBench: number; lotsShelved: number; bulk: number
  checkIns: number; totesBooked: number; palletsBooked: number
}
export type PersonTotals = Counts & {
  userId: string; name: string; activeDays: number
  /** ISO instants. */
  firstAt: string | null; lastAt: string | null
  /** 0–23, London. The hour with the most moves, scans and check-ins (the earliest on a tie). */
  busiestHour: number | null
  scanners: number
}
export type PersonDay = Counts & { userId: string; day: string; firstAt: string | null; lastAt: string | null }
/** Which sources contributed nothing because their table isn't there yet (before Run Migrations). */
export type ReportSource = "scans" | "moves" | "check-ins"
export type WarehouseReport = {
  range: ReportRange
  totals: Counts & { people: number }
  /** Most active first. */
  people: PersonTotals[]
  /** Only days with something on them, oldest first, then by name. */
  days: PersonDay[]
  /** London hour of day (0–23), moves + scans + check-ins with a scan that moved something counted once. Only hours with a count. */
  hours: { userId: string; hour: number; count: number }[]
  /** Sources whose table doesn't exist yet — their counts are 0. Absent or empty = all there. */
  missing?: ReportSource[]
}

export const ZERO_COUNTS: Counts = {
  scans: 0, refused: 0, stale: 0, late: 0,
  moves: 0, putAway: 0, toBench: 0, lotsShelved: 0, bulk: 0,
  checkIns: 0, totesBooked: 0, palletsBooked: 0,
}
const COUNT_KEYS = Object.keys(ZERO_COUNTS) as (keyof Counts)[]

type Present = { moves: boolean; scans: boolean; receipts: boolean; containers: boolean; locations: boolean }

async function tablesPresent(): Promise<Present> {
  const [r] = await prisma.$queryRaw<Present[]>`
    SELECT to_regclass('"GoodsInMovement"')  IS NOT NULL AS "moves",
           to_regclass('"GoodsInScanEvent"') IS NOT NULL AS "scans",
           to_regclass('"GoodsInReceipt"')   IS NOT NULL AS "receipts",
           to_regclass('"GoodsInContainer"') IS NOT NULL AS "containers",
           to_regclass('"GoodsInLocation"')  IS NOT NULL AS "locations"`
  return r ?? { moves: false, scans: false, receipts: false, containers: false, locations: false }
}

function missingOf(p: Present): ReportSource[] {
  const out: ReportSource[] = []
  if (!p.scans) out.push("scans")
  if (!p.moves) out.push("moves")
  if (!p.receipts) out.push("check-ins")
  return out
}

/** A UTC instant as the plain "YYYY-MM-DD HH:MM:SS.mmm" a timestamp(3) column holds — cast with ::timestamp. */
const utcStamp = (d: Date) => d.toISOString().slice(0, 23).replace("T", " ")

/** The range's bounds as UTC timestamps: London midnight at the start of `from`, and after `to`. */
function bounds(range: ReportRange) {
  return { lo: utcStamp(londonDayStart(range.from)), hi: utcStamp(londonDayStart(addDaysYmd(range.to, 1))) }
}

/**
 * An always-true extra bound on a scan's receivedAt, there only so the (userId, receivedAt) index
 * can narrow a one-person read. It holds because the sync clamps scannedAt to its own "now" before
 * the row is written, so receivedAt is never earlier than scannedAt. The day's margin covers any
 * clock difference between the Hub's server and the database — never tighten it to exactly `lo`.
 */
const RECEIVED_AFTER_LO = (lo: string) => Prisma.sql`AND s."receivedAt" >= (${lo}::timestamp - interval '1 day')`

/**
 * A TABLE that isn't there (42P01 / P2021) — never any other fault, which must still be seen.
 * ⚠ Deliberately NOT a missing column (42703 / P2022): every column read here was in its table's
 * first CREATE TABLE, so a missing column can only be a bug (a typo, a later rename) — it must show
 * as an error, never as a calm "needs Run Migrations" with every count at 0.
 */
const isMissingRelation = (e: unknown) =>
  /42P01|P2021|relation "[^"]*" does not exist/i.test(`${(e as { message?: string })?.message ?? ""} ${(e as { code?: string })?.code ?? ""}`)

/**
 * The SELECTs over the three sources, one row per thing done, all with the same columns:
 * who ("uid", "name"), when ("tAt", UTC), the scanner ("device", scans only), a 0/1 for each count,
 * the totes and pallets on a check-in, and "acts" — 1 for each thing done once (an applied scan is
 * 0 here because its move is already 1).
 */
function sources(p: Present, lo: string, hi: string, onlyUserId?: string): Prisma.Sql[] {
  const parts: Prisma.Sql[] = []
  const kind = p.locations ? Prisma.sql`lower(COALESCE(NULLIF(btrim(l."kind"), ''), 'storage'))` : Prisma.sql`'storage'`
  const joinLoc = p.locations ? Prisma.sql`LEFT JOIN "GoodsInLocation" l ON l."code" = m."locationCode"` : Prisma.empty

  if (p.moves) {
    parts.push(Prisma.sql`
      SELECT m."movedById" AS "uid", NULLIF(btrim(m."movedByName"), '') AS "name", m."movedAt" AS "tAt", NULL::text AS "device",
             0 AS "scans", 0 AS "refused", 0 AS "stale", 0 AS "late",
             1 AS "moves",
             CASE WHEN m."containerId" IS NOT NULL AND ${kind} IN ('storage', 'other') THEN 1 ELSE 0 END AS "putAway",
             CASE WHEN m."containerId" IS NOT NULL AND ${kind} = 'bench' THEN 1 ELSE 0 END AS "toBench",
             CASE WHEN m."lotId" IS NOT NULL THEN 1 ELSE 0 END AS "lotsShelved",
             CASE WHEN m."note" LIKE 'Moved everything from%' THEN 1 ELSE 0 END AS "bulk",
             0 AS "checkIns", 0 AS "totesBooked", 0 AS "palletsBooked",
             1 AS "acts"
      FROM "GoodsInMovement" m
      ${joinLoc}
      WHERE m."movedById" IS NOT NULL
        AND m."movedAt" >= ${lo}::timestamp AND m."movedAt" < ${hi}::timestamp
        ${onlyUserId ? Prisma.sql`AND m."movedById" = ${onlyUserId}` : Prisma.empty}`)
  }

  if (p.scans) {
    parts.push(Prisma.sql`
      SELECT s."userId" AS "uid", NULLIF(btrim(s."userName"), '') AS "name", s."scannedAt" AS "tAt", NULLIF(btrim(s."deviceId"), '') AS "device",
             1 AS "scans",
             CASE WHEN s."outcome" = 'refused' THEN 1 ELSE 0 END AS "refused",
             CASE WHEN s."outcome" = 'stale' THEN 1 ELSE 0 END AS "stale",
             CASE WHEN s."receivedAt" - s."scannedAt" > interval '5 minutes' THEN 1 ELSE 0 END AS "late",
             0 AS "moves", 0 AS "putAway", 0 AS "toBench", 0 AS "lotsShelved", 0 AS "bulk",
             0 AS "checkIns", 0 AS "totesBooked", 0 AS "palletsBooked",
             CASE WHEN s."outcome" = 'applied' THEN 0 ELSE 1 END AS "acts"
      FROM "GoodsInScanEvent" s
      WHERE s."scannedAt" >= ${lo}::timestamp AND s."scannedAt" < ${hi}::timestamp
        ${RECEIVED_AFTER_LO(lo)}
        ${onlyUserId ? Prisma.sql`AND s."userId" = ${onlyUserId}` : Prisma.empty}`)
  }

  if (p.receipts) {
    const boxes = p.containers
      ? Prisma.sql`LEFT JOIN LATERAL (
          SELECT COUNT(*) FILTER (WHERE lower(k."kind") = 'tote')::int   AS "totes",
                 COUNT(*) FILTER (WHERE lower(k."kind") = 'pallet')::int AS "pallets"
          FROM "GoodsInContainer" k WHERE k."receiptId" = r."id") c ON true`
      : Prisma.sql`LEFT JOIN LATERAL (SELECT 0 AS "totes", 0 AS "pallets") c ON true`
    parts.push(Prisma.sql`
      SELECT r."createdById" AS "uid", NULLIF(btrim(r."createdByName"), '') AS "name", r."createdAt" AS "tAt", NULL::text AS "device",
             0 AS "scans", 0 AS "refused", 0 AS "stale", 0 AS "late",
             0 AS "moves", 0 AS "putAway", 0 AS "toBench", 0 AS "lotsShelved", 0 AS "bulk",
             1 AS "checkIns", COALESCE(c."totes", 0) AS "totesBooked", COALESCE(c."pallets", 0) AS "palletsBooked",
             1 AS "acts"
      FROM "GoodsInReceipt" r
      ${boxes}
      WHERE r."createdById" IS NOT NULL
        AND COALESCE(r."status", 'open') NOT IN ('draft', 'void')
        AND r."createdAt" >= ${lo}::timestamp AND r."createdAt" < ${hi}::timestamp
        ${onlyUserId ? Prisma.sql`AND r."createdById" = ${onlyUserId}` : Prisma.empty}`)
  }

  return parts
}

type GroupedRow = Counts & {
  userId: string
  /** 1 = a person's day, 2 = a person's hour of day, 3 = a person's whole range. */
  g: number
  day: string | null
  hour: number | null
  acts: number
  activeDays: number
  scanners: number
  firstAt: Date | null
  lastAt: Date | null
  name: string | null
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null)
const countsOf = (r: Partial<Counts>): Counts => {
  const out = { ...ZERO_COUNTS }
  for (const k of COUNT_KEYS) out[k] = Number(r[k] ?? 0)
  return out
}

function emptyReport(range: ReportRange, missing: ReportSource[]): WarehouseReport {
  return { range, totals: { ...ZERO_COUNTS, people: 0 }, people: [], days: [], hours: [], missing }
}

/**
 * Everyone's (or, with `onlyUserId`, one person's) Goods In output over the range: per person, per
 * person per day, and per person per hour of day. Never throws on missing tables — those counts are
 * 0 and the source is named in `missing`. Throws on any other database failure.
 */
export async function warehouseReport(range: ReportRange, onlyUserId?: string): Promise<WarehouseReport> {
  const present = await tablesPresent()
  const missing = missingOf(present)
  const { lo, hi } = bounds(range)
  const parts = sources(present, lo, hi, onlyUserId)
  if (parts.length === 0) return emptyReport(range, missing)

  let rows: GroupedRow[]
  try {
    rows = await prisma.$queryRaw<GroupedRow[]>`
      WITH "a" AS (
        ${Prisma.join(parts, " UNION ALL ")}
      ), "b" AS (
        SELECT "a".*, to_char("x"."lt", 'YYYY-MM-DD') AS "day", EXTRACT(HOUR FROM "x"."lt")::int AS "hour"
        FROM "a"
        CROSS JOIN LATERAL (SELECT (("a"."tAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London') AS "lt") "x"
      )
      SELECT "b"."uid"                                   AS "userId",
             GROUPING("b"."day", "b"."hour")::int        AS "g",
             "b"."day"                                   AS "day",
             "b"."hour"                                  AS "hour",
             SUM("b"."scans")::int         AS "scans",
             SUM("b"."refused")::int       AS "refused",
             SUM("b"."stale")::int         AS "stale",
             SUM("b"."late")::int          AS "late",
             SUM("b"."moves")::int         AS "moves",
             SUM("b"."putAway")::int       AS "putAway",
             SUM("b"."toBench")::int       AS "toBench",
             SUM("b"."lotsShelved")::int   AS "lotsShelved",
             SUM("b"."bulk")::int          AS "bulk",
             SUM("b"."checkIns")::int      AS "checkIns",
             SUM("b"."totesBooked")::int   AS "totesBooked",
             SUM("b"."palletsBooked")::int AS "palletsBooked",
             SUM("b"."acts")::int          AS "acts",
             COUNT(DISTINCT "b"."day")::int    AS "activeDays",
             COUNT(DISTINCT "b"."device")::int AS "scanners",
             MIN("b"."tAt")                    AS "firstAt",
             MAX("b"."tAt")                    AS "lastAt",
             (array_agg("b"."name" ORDER BY "b"."tAt" DESC) FILTER (WHERE "b"."name" IS NOT NULL))[1] AS "name"
      FROM "b"
      GROUP BY GROUPING SETS (("b"."uid", "b"."day"), ("b"."uid", "b"."hour"), ("b"."uid"))`
  } catch (e) {
    // A table dropped or not yet whole between the check above and this query — say nothing rather than fail.
    if (isMissingRelation(e)) {
      console.error("goods-in reports: a table went missing mid-report:", e)
      return emptyReport(range, missing.length ? missing : ["scans", "moves", "check-ins"])
    }
    throw e
  }

  // ── Names: the stored one from their latest activity, else the User table's, by id ──
  const personRows = rows.filter(r => Number(r.g) === 3)
  const needName = personRows.filter(r => !r.name).map(r => r.userId)
  const userNames = new Map<string, string>()
  if (needName.length) {
    const users = await prisma.user.findMany({ where: { id: { in: needName } }, select: { id: true, name: true } })
    for (const u of users) if (u.name?.trim()) userNames.set(u.id, u.name.trim())
  }
  const nameOf = new Map<string, string>()
  for (const r of personRows) nameOf.set(r.userId, r.name?.trim() || userNames.get(r.userId) || "Unknown person")

  // ── Hours, and each person's busiest ──
  const hours: WarehouseReport["hours"] = []
  const busiest = new Map<string, { hour: number; count: number }>()
  for (const r of rows) {
    if (Number(r.g) !== 2 || r.hour == null) continue
    const count = Number(r.acts)
    if (count <= 0) continue
    const hour = Number(r.hour)
    hours.push({ userId: r.userId, hour, count })
    const best = busiest.get(r.userId)
    if (!best || count > best.count || (count === best.count && hour < best.hour)) busiest.set(r.userId, { hour, count })
  }
  hours.sort((a, b) => (a.userId === b.userId ? a.hour - b.hour : a.userId < b.userId ? -1 : 1))

  // ── People, most active first ──
  const acts = new Map<string, number>()
  const people: PersonTotals[] = personRows.map(r => {
    acts.set(r.userId, Number(r.acts))
    return {
      ...countsOf(r),
      userId: r.userId,
      name: nameOf.get(r.userId) ?? "Unknown person",
      activeDays: Number(r.activeDays),
      firstAt: iso(r.firstAt),
      lastAt: iso(r.lastAt),
      busiestHour: busiest.get(r.userId)?.hour ?? null,
      scanners: Number(r.scanners),
    }
  })
  people.sort((a, b) =>
    (acts.get(b.userId) ?? 0) - (acts.get(a.userId) ?? 0) ||
    (b.moves + b.scans + b.checkIns) - (a.moves + a.scans + a.checkIns) ||
    a.name.localeCompare(b.name, "en-GB"))

  // ── Days ──
  const days: PersonDay[] = rows
    .filter(r => Number(r.g) === 1 && r.day)
    .map(r => ({ ...countsOf(r), userId: r.userId, day: r.day as string, firstAt: iso(r.firstAt), lastAt: iso(r.lastAt) }))
  days.sort((a, b) =>
    a.day < b.day ? -1 : a.day > b.day ? 1 :
      (nameOf.get(a.userId) ?? "").localeCompare(nameOf.get(b.userId) ?? "", "en-GB"))

  // ── Totals ──
  const totals = { ...ZERO_COUNTS, people: people.length }
  for (const p of people) for (const k of COUNT_KEYS) totals[k] += p[k]

  return { range, totals, people, days, hours, missing }
}

// ─── Is this person on record at all? ─────────────────────────────────────────────────────

/**
 * Whether this id has ANY counted Goods In activity on record, on any day, and the name stored on
 * the latest of it. For the per-person page when the range picked has nothing and there's no Hub
 * account with the id (a former member of staff whose account was deleted): someone with history
 * on other days gets their page with "nothing recorded", not a 404. null = nothing on record at all.
 * Missing tables add nothing; any other database fault throws.
 */
export async function personOnRecord(userId: string): Promise<{ name: string | null } | null> {
  const present = await tablesPresent()
  const parts: Prisma.Sql[] = []
  if (present.moves) parts.push(Prisma.sql`(
    SELECT NULLIF(btrim(m."movedByName"), '') AS "name", m."movedAt" AS "at" FROM "GoodsInMovement" m
    WHERE m."movedById" = ${userId} ORDER BY m."movedAt" DESC LIMIT 1)`)
  if (present.scans) parts.push(Prisma.sql`(
    SELECT NULLIF(btrim(s."userName"), '') AS "name", s."scannedAt" AS "at" FROM "GoodsInScanEvent" s
    WHERE s."userId" = ${userId} ORDER BY s."receivedAt" DESC LIMIT 1)`)
  if (present.receipts) parts.push(Prisma.sql`(
    SELECT NULLIF(btrim(r."createdByName"), '') AS "name", r."createdAt" AS "at" FROM "GoodsInReceipt" r
    WHERE r."createdById" = ${userId} AND COALESCE(r."status", 'open') NOT IN ('draft', 'void')
    ORDER BY r."createdAt" DESC LIMIT 1)`)
  if (parts.length === 0) return null

  let rows: { name: string | null; at: Date }[]
  try {
    rows = await prisma.$queryRaw<{ name: string | null; at: Date }[]>`
      SELECT * FROM (${Prisma.join(parts, " UNION ALL ")}) "x" ORDER BY "x"."at" DESC`
  } catch (e) {
    if (isMissingRelation(e)) {
      console.error("goods-in reports: a table went missing mid-lookup:", e)
      return null
    }
    throw e
  }
  if (rows.length === 0) return null
  return { name: rows.find(r => r.name)?.name ?? null }
}

// ─── One person's latest activity ─────────────────────────────────────────────────────────

export type ActivityItem = {
  /** ISO instant. */
  at: string
  kind: "move" | "scan" | "check-in"
  title: string
  detail: string | null
  href: string | null
  /** Scans only: "refused" or "stale" (overtaken). */
  outcome?: string
}

const findHref = (code: string) => `/tools/warehouse/find?q=${encodeURIComponent(code)}`
const receiptHref = (id: string) => `/tools/warehouse/receipts/${encodeURIComponent(id)}`
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`

type ActivityRow = {
  kind: "move" | "scan" | "check-in"
  at: Date
  containerId: string | null
  containerKind: string | null
  lotId: string | null
  code: string | null
  location: string | null
  fromCode: string | null
  note: string | null
  locKind: string | null
  outcome: string | null
  message: string | null
  late: boolean | null
  viaScanner: boolean | null
  totes: number | null
  pallets: number | null
}

/**
 * The person's latest activity in the range, newest first (at most `limit`, default 50, up to 500):
 * their moves, their scans that DIDN'T move anything (refused or overtaken — a scan that moved
 * something is shown once, as its move, marked "handheld scanner"), and the receipts they booked in.
 * Codes link to Code lookup, receipts to the receipt. Never throws on missing tables (they add
 * nothing); throws on any other database failure.
 *
 * `hideOtherNames` (the page sets it for a warehouse-tier viewer): an overtaken scan's stored
 * message names whoever moved the item since ("… was moved to X by <Name> at …"); with this set,
 * that name is taken out, so nobody else's name reaches a warehouse-tier screen.
 */
export async function personActivity(
  userId: string, range: ReportRange, limit = 50, opts: { hideOtherNames?: boolean } = {},
): Promise<ActivityItem[]> {
  const n = Math.max(1, Math.min(500, Math.floor(Number(limit)) || 50))
  const present = await tablesPresent()
  const { lo, hi } = bounds(range)
  const parts: Prisma.Sql[] = []

  if (present.moves) {
    // An applied scan's move is stamped with the scan's (clamped) scannedAt, and the sync refuses a
    // scan more than 7 days old, so its receivedAt lies within [movedAt − clock margin, movedAt + 8
    // days) — bounds that let the (userId, receivedAt) index find it instead of reading every scan
    // the person ever made.
    const viaScanner = present.scans
      ? Prisma.sql`EXISTS (SELECT 1 FROM "GoodsInScanEvent" s
          WHERE s."userId" = m."movedById"
            AND s."receivedAt" >= m."movedAt" - interval '1 day' AND s."receivedAt" < m."movedAt" + interval '8 days'
            AND s."scannedAt" = m."movedAt" AND s."outcome" = 'applied'
            AND upper(s."item") IN (upper(m."containerId"), upper(m."barcode")))`
      : Prisma.sql`false`
    parts.push(Prisma.sql`(
      SELECT 'move' AS "kind", m."movedAt" AS "at", m."containerId" AS "containerId",
             ${present.containers ? Prisma.sql`k."kind"` : Prisma.sql`NULL::text`} AS "containerKind",
             m."lotId" AS "lotId", COALESCE(m."containerId", m."barcode") AS "code",
             m."locationCode" AS "location", m."fromCode" AS "fromCode", m."note" AS "note",
             ${present.locations ? Prisma.sql`lower(NULLIF(btrim(l."kind"), ''))` : Prisma.sql`NULL::text`} AS "locKind",
             NULL::text AS "outcome", NULL::text AS "message", NULL::boolean AS "late",
             ${viaScanner} AS "viaScanner", NULL::int AS "totes", NULL::int AS "pallets"
      FROM "GoodsInMovement" m
      ${present.containers ? Prisma.sql`LEFT JOIN "GoodsInContainer" k ON k."id" = m."containerId"` : Prisma.empty}
      ${present.locations ? Prisma.sql`LEFT JOIN "GoodsInLocation" l ON l."code" = m."locationCode"` : Prisma.empty}
      WHERE m."movedById" = ${userId} AND m."movedAt" >= ${lo}::timestamp AND m."movedAt" < ${hi}::timestamp
      ORDER BY m."movedAt" DESC, m."id" DESC
      LIMIT ${n})`)
  }

  if (present.scans) {
    parts.push(Prisma.sql`(
      SELECT 'scan' AS "kind", s."scannedAt" AS "at", NULL::text AS "containerId", NULL::text AS "containerKind",
             NULL::text AS "lotId", s."item" AS "code", s."location" AS "location", NULL::text AS "fromCode", NULL::text AS "note",
             NULL::text AS "locKind", s."outcome" AS "outcome", s."message" AS "message",
             (s."receivedAt" - s."scannedAt" > interval '5 minutes') AS "late",
             NULL::boolean AS "viaScanner", NULL::int AS "totes", NULL::int AS "pallets"
      FROM "GoodsInScanEvent" s
      WHERE s."userId" = ${userId} AND s."outcome" <> 'applied'
        AND s."scannedAt" >= ${lo}::timestamp AND s."scannedAt" < ${hi}::timestamp
        ${RECEIVED_AFTER_LO(lo)}
      ORDER BY s."scannedAt" DESC, s."id" DESC
      LIMIT ${n})`)
  }

  if (present.receipts) {
    const boxes = present.containers
      ? Prisma.sql`(SELECT COUNT(*) FROM "GoodsInContainer" k WHERE k."receiptId" = r."id" AND lower(k."kind") = 'tote')::int AS "totes",
                   (SELECT COUNT(*) FROM "GoodsInContainer" k WHERE k."receiptId" = r."id" AND lower(k."kind") = 'pallet')::int AS "pallets"`
      : Prisma.sql`0 AS "totes", 0 AS "pallets"`
    parts.push(Prisma.sql`(
      SELECT 'check-in' AS "kind", r."createdAt" AS "at", NULL::text AS "containerId", NULL::text AS "containerKind",
             NULL::text AS "lotId", r."id" AS "code", NULL::text AS "location", NULL::text AS "fromCode", NULL::text AS "note",
             NULL::text AS "locKind", NULL::text AS "outcome", NULL::text AS "message", NULL::boolean AS "late",
             NULL::boolean AS "viaScanner", ${boxes}
      FROM "GoodsInReceipt" r
      WHERE r."createdById" = ${userId}
        AND COALESCE(r."status", 'open') NOT IN ('draft', 'void')
        AND r."createdAt" >= ${lo}::timestamp AND r."createdAt" < ${hi}::timestamp
      ORDER BY r."createdAt" DESC, r."id" DESC
      LIMIT ${n})`)
  }

  if (parts.length === 0) return []

  let rows: ActivityRow[]
  try {
    rows = await prisma.$queryRaw<ActivityRow[]>`
      SELECT * FROM (${Prisma.join(parts, " UNION ALL ")}) "x"
      ORDER BY "x"."at" DESC
      LIMIT ${n}`
  } catch (e) {
    if (isMissingRelation(e)) {
      console.error("goods-in reports: a table went missing mid-activity:", e)
      return []
    }
    throw e
  }

  return rows.map(r => activityItem(r, !!opts.hideOtherNames))
}

/**
 * An overtaken scan's stored message (lib/goods-in/move-core.ts staleMessage) without the name of
 * whoever moved the item since: "Tote T1 was moved to A1 by Jane at 20 Oct, 14:05, after this
 * scan …" → "Tote T1 was moved to A1 at 20 Oct, 14:05, after this scan …". A message in any other
 * shape that still names someone becomes the plain words; one with no name is left as it is.
 */
function withoutOtherNames(message: string): string {
  if (!/ was moved(?: to \S+)? by /.test(message)) return message
  const cut = message.replace(/^(.+? was moved(?: to \S+)?) by .+? (at \d{1,2} \S+?(?:,| at)? \d{1,2}:\d{2}, after this scan)/, "$1 $2")
  return cut !== message ? cut : "Someone had moved it again since it was scanned, so this scan wasn't used."
}

function activityItem(r: ActivityRow, hideOtherNames: boolean): ActivityItem {
  const at = new Date(r.at).toISOString()

  if (r.kind === "check-in") {
    const bits: string[] = []
    if (Number(r.totes)) bits.push(plural(Number(r.totes), "tote", "totes"))
    if (Number(r.pallets)) bits.push(plural(Number(r.pallets), "pallet", "pallets"))
    const id = r.code ?? ""
    return { at, kind: "check-in", title: `Booked in ${id}`, detail: bits.length ? bits.join(" · ") : null, href: id ? receiptHref(id) : null }
  }

  if (r.kind === "scan") {
    const item = r.code || "nothing"
    const title = r.location ? `Scanned ${item} to ${r.location}` : `Scanned ${item}`
    const stored = r.message?.trim() || null
    const message = stored && hideOtherNames && r.outcome === "stale" ? withoutOtherNames(stored) : stored
    const bits = [message || (r.outcome === "stale" ? "Someone had moved it again since it was scanned." : "The Hub couldn't use this scan.")]
    if (r.late) bits.push("Sent late — scanned with no Wi-Fi")
    return { at, kind: "scan", title, detail: bits.join(" · "), href: r.code ? findHref(r.code) : null, outcome: r.outcome ?? "refused" }
  }

  // A move.
  const where = r.location ?? "?"
  let title: string
  if (r.containerId) {
    const what = `${r.containerKind?.toLowerCase() === "pallet" ? "pallet" : "tote"} ${r.containerId}`
    const kind = r.locKind ?? "storage"
    title = kind === "bench" ? `Took ${what} to bench ${where}`
      : kind === "shelf" ? `Moved ${what} to shelf ${where}`
        : `Put away ${what} at ${where}`
  } else {
    title = r.code ? `Shelved lot ${r.code} at ${where}` : `Shelved a lot at ${where}`
  }
  const bits: string[] = []
  const note = r.note?.trim() || null
  const bulk = !!note && note.startsWith("Moved everything from")
  if (r.fromCode && !bulk) bits.push(`from ${r.fromCode}`)
  if (note) bits.push(note)
  if (r.viaScanner) bits.push("handheld scanner")
  return { at, kind: "move", title, detail: bits.length ? bits.join(" · ") : null, href: r.code ? findHref(r.code) : null }
}
