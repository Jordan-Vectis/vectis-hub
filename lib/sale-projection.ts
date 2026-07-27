// Shared cataloguing-pace projection for the Manager Portal.
//
// Both the Sales tab (manager-portal-table.tsx) and the Departments tab
// (departments-table.tsx) import from here, so a sale's projected dates read the
// same on both. ⚠ Do not copy this maths into a third place — two versions will
// drift and the two tabs will start disagreeing about the same sale.

export const DAY = 86_400_000

export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

export const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime() }

export const fmtPace = (p: number) => (p >= 10 ? Math.round(p).toString() : p.toFixed(1))

export function daysToSale(auctionDate: string | null, nowMs: number): number | null {
  if (!auctionDate) return null
  return Math.ceil((Date.parse(auctionDate) - nowMs) / DAY)
}

/** Lots per day, from the count of days that actually had lots saved. Needs at
 *  least two active days before it means anything. */
export function paceFor(lots: number, activeDays: number): number {
  return activeDays >= 2 ? lots / activeDays : 0
}

// ─── Fixed sale targets (Manager Portal → Departments) ───────────────────────
// Jordan wants the department view answering one question: when does this sale
// reach 400, 500 and 600 lots? These are FIXED targets, not the rolling
// next-hundred marks the Sales tab shows — a 250-lot sale still projects to
// 400/500/600, not 300/400/500.

export const SALE_TARGETS = [400, 500, 600] as const

export type TargetProjection = {
  target: number
  reached: boolean       // already at or past this target
  days: number | null    // null when there is no usable pace
  date: number | null
  late: boolean          // projected to land after the sale date
}

export function targetsFor(
  current: number,
  pace: number,
  nowMs: number,
  saleTs: number,
  targets: readonly number[] = SALE_TARGETS,
): TargetProjection[] {
  return targets.map(target => {
    if (current >= target) return { target, reached: true, days: 0, date: null, late: false }
    if (pace <= 0)         return { target, reached: false, days: null, date: null, late: false }
    const days = Math.ceil((target - current) / pace)
    const date = nowMs + days * DAY
    return { target, reached: false, days, date, late: startOfDay(date) > startOfDay(saleTs) }
  })
}

export type Milestone = { target: number; days: number; date: number; fill: number; late: boolean }

// `current` is the sale's combined (deduped) total — milestones project off the
// number the manager actually watches, so a 627-lot sale reads 700/800/900, not
// 500/600. Projected at the (Hub) cataloguing pace.
export function milestonesFor(current: number, pace: number, nowMs: number, saleTs: number, count = 3): Milestone[] {
  if (pace <= 0) return []
  const out: Milestone[] = []
  let m = Math.floor(current / 100) * 100 + 100
  for (let i = 0; i < count; i++) {
    const days = Math.ceil((m - current) / pace)
    const date = nowMs + days * DAY
    out.push({ target: m, days, date, fill: clamp((current - (m - 100)) / 100, 0, 1) * 100, late: startOfDay(date) > startOfDay(saleTs) })
    m += 100
  }
  return out
}
