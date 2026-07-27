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
