import { prisma } from "@/lib/prisma"

// Cataloguing timing logs only store a loose `lotId` (not a FK). To show the real
// barcode in the reports — and to flag logs whose lot was deleted or transferred
// to another auction (the phantom-count cause) — we resolve each log's lotId to
// its current lot here.

export type LotRef = {
  barcode: string | null      // the lot's barcode (or receipt unique id) to display
  movedToCode: string | null  // set when the lot now lives in a DIFFERENT auction than the log
  lotDeleted: boolean         // true when the lot no longer exists at all
}

type LotInfo = { barcode: string | null; receiptUniqueId: string | null; auctionId: string; code: string }

// ── Safe min/max ────────────────────────────────────────────────────────────
// NEVER use Math.min(...arr) / Math.max(...arr) on report data: spreading a large
// array as function arguments throws "Maximum call stack size exceeded" once it
// crosses the engine's argument limit (~100k). Fold in a single pass instead.
export function minOf(nums: number[]): number {
  return nums.length ? nums.reduce((m, v) => (v < m ? v : m), Infinity) : 0
}
export function maxOf(nums: number[]): number {
  return nums.length ? nums.reduce((m, v) => (v > m ? v : m), -Infinity) : 0
}

// ── UK (Europe/London) day handling ─────────────────────────────────────────
// The server runs in UTC; the business is UK-based. Bucketing by the server day
// mis-assigns work done around midnight (all of BST). These helpers key days by
// the London calendar instead. (date-fns-tz isn't a dependency — use Intl.)
const UK_TZ = "Europe/London"
const ukYmdFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: UK_TZ, year: "numeric", month: "2-digit", day: "2-digit",
})
const ukHourFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: UK_TZ, hour: "2-digit", hour12: false,
})

/** London calendar date of an instant, as "yyyy-MM-dd". */
export function ukDayKey(d: Date): string {
  return ukYmdFmt.format(d)
}

/**
 * UTC instant of London-local midnight for the London day containing `ref`,
 * shifted back `minusDays`. At UTC-midnight the London wall clock reads the
 * UTC→London offset (0 during GMT, 1 during BST), so subtracting that many
 * hours lands exactly on London midnight.
 */
export function ukDayStartUtc(ref: Date, minusDays = 0): Date {
  const ymd = ukDayKey(ref)
  const guess = new Date(`${ymd}T00:00:00Z`)
  guess.setUTCDate(guess.getUTCDate() - minusDays)
  const offsetH = Number(ukHourFmt.format(guess)) % 24
  return new Date(guess.getTime() - offsetH * 3_600_000)
}

// ── Idle that happened INSIDE a lot ─────────────────────────────────────────
//
// A lot's durationMs is the full wall-clock time it was open — a lot held up for
// two hours of research took two hours, and the lot row must keep saying so. But
// an idle gap logged during that lot is therefore counted twice if you add
// "cataloguing time" and "idle time" together: once inside the lot's duration,
// once as its own IdleLog row.
//
// That never showed up as a bar over 100% — the daily breakdown derives
// "unaccounted" as the remainder, so the double count quietly stole from
// unaccounted instead, which is worse (nothing looks wrong).
//
// Rather than a schema flag (which would only fix data from the day it shipped),
// this works it out from the timestamps we already store: a lot occupies
// [savedAt − durationMs, savedAt], an idle occupies [idleStartedAt, +duration].
// Whatever overlaps happened during the lot. This fixes historical data too.

export type TimedLog = { id: string; savedAt: Date; durationMs: number }
export type IdleSpan = { idleStartedAt: Date; idleDurationMs: number }

/** Milliseconds two spans share. 0 when they don't touch. */
export function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
}

export type LotBreakdown = {
  /** Full wall-clock time the lot was open — unchanged, still "how long it took". */
  durationMs: number
  /** Of that, time logged as idle. */
  idleMs: number
  /** Of that, time actually spent cataloguing. */
  activeMs: number
}

/**
 * Per-lot split of "how long it took" into active vs idle, keyed by timing-log id.
 *
 * Idle is apportioned to the lot it overlaps. An idle span touching two lots
 * (rare — it would mean a lot was saved mid-gap) is split between them by
 * overlap, so no millisecond is assigned twice.
 */
export function computeLotBreakdowns(logs: TimedLog[], idles: IdleSpan[]): Map<string, LotBreakdown> {
  const spans = idles.map(i => {
    const start = i.idleStartedAt.getTime()
    return { start, end: start + i.idleDurationMs }
  })
  const out = new Map<string, LotBreakdown>()
  for (const log of logs) {
    const end   = log.savedAt.getTime()
    const start = end - log.durationMs
    let idleMs = 0
    for (const s of spans) idleMs += overlapMs(start, end, s.start, s.end)
    // Can't idle for longer than the lot was open — clamp against rounding and
    // any clock skew between the device that logged the idle and the save.
    idleMs = Math.min(idleMs, log.durationMs)
    out.set(log.id, { durationMs: log.durationMs, idleMs, activeMs: Math.max(0, log.durationMs - idleMs) })
  }
  return out
}

/** Total idle that fell inside a lot — the amount double-counted by a naive sum. */
export function totalWithinLotIdleMs(logs: TimedLog[], idles: IdleSpan[]): number {
  let total = 0
  for (const b of computeLotBreakdowns(logs, idles).values()) total += b.idleMs
  return total
}

// ── Lot resolution ──────────────────────────────────────────────────────────

export async function buildLotMap(logs: { lotId: string | null }[]): Promise<Map<string, LotInfo>> {
  const ids = [...new Set(logs.map(l => l.lotId).filter((x): x is string => !!x))]
  if (ids.length === 0) return new Map()
  // Chunk the id list: a single `id IN (...)` with tens of thousands of ids hits
  // Postgres's 65535 bind-parameter cap. Batch and merge instead.
  const CHUNK = 5000
  const map = new Map<string, LotInfo>()
  for (let i = 0; i < ids.length; i += CHUNK) {
    const lots = await prisma.catalogueLot.findMany({
      where:  { id: { in: ids.slice(i, i + CHUNK) } },
      select: { id: true, barcode: true, receiptUniqueId: true, auctionId: true, auction: { select: { code: true } } },
    })
    for (const l of lots) {
      map.set(l.id, { barcode: l.barcode, receiptUniqueId: l.receiptUniqueId, auctionId: l.auctionId, code: l.auction.code })
    }
  }
  return map
}

export function lotRef(map: Map<string, LotInfo>, log: { lotId: string | null; auctionId: string }): LotRef {
  if (!log.lotId) return { barcode: null, movedToCode: null, lotDeleted: false }
  const lot = map.get(log.lotId)
  if (!lot) return { barcode: null, movedToCode: null, lotDeleted: true }
  return {
    barcode:     lot.barcode || lot.receiptUniqueId || null,
    movedToCode: lot.auctionId !== log.auctionId ? lot.code : null,
    lotDeleted:  false,
  }
}
