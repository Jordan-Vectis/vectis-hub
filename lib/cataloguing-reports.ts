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
