import type { PersonDay, ReportRange } from "@/lib/goods-in/reports"
import type { DayPoint } from "./charts"
import { addDaysYmd, mondayOfYmd } from "../history/london-days"
import { dayLong, dayShort } from "./parts"

// Goods In → Reports: the bars for the per-day chart — every London day in the range, a day with
// nothing done drawn as nothing (not left out, which would close the gap and hide a quiet day).
// Pure and server-safe.
//
// The chart draws Moves, Scans and Check-ins SIDE BY SIDE (three bars to a day), never stacked: a
// scan that moved something is in both Scans and Moves, so a stack would count it twice. Three bars
// a day get thin quickly, so a long range is grouped into weeks, and a longer one into months.

/** Up to this many days the chart has a bar group per day (covers the 7 and 30 day ranges). */
export const MAX_DAILY_BARS = 45
/** Up to this many days, a group per week (covers 90 days and 6 months); beyond it, per month. */
export const MAX_WEEKLY_DAYS = 200

export type PointUnit = "day" | "week" | "month"

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

export function dayPoints(days: PersonDay[], range: Pick<ReportRange, "from" | "to">): { points: DayPoint[]; caption: string; unit: PointUnit } {
  const byDay = new Map<string, { moves: number; scans: number; checkIns: number }>()
  for (const d of days) {
    const e = byDay.get(d.day) ?? { moves: 0, scans: 0, checkIns: 0 }
    e.moves += d.moves; e.scans += d.scans; e.checkIns += d.checkIns
    byDay.set(d.day, e)
  }
  const all: string[] = []
  // ~4 years at most — a guard against a range that somehow never ends, not a real limit.
  for (let d = range.from; d <= range.to && all.length < 1500; d = addDaysYmd(d, 1)) all.push(d)

  if (all.length <= MAX_DAILY_BARS) {
    return {
      unit: "day",
      caption: "Per day",
      points: all.map(day => ({ key: day, label: dayShort(day), title: dayLong(day), moves: 0, scans: 0, checkIns: 0, ...byDay.get(day) })),
    }
  }

  // Weeks start on Monday, months on the 1st; the first and last may be part-weeks or part-months
  // (only the range's own days count).
  const weekly = all.length <= MAX_WEEKLY_DAYS
  const groups = new Map<string, DayPoint>()
  let first = true
  for (const day of all) {
    const key = weekly ? mondayOfYmd(day) : `${day.slice(0, 7)}-01`
    let p = groups.get(key)
    if (!p) {
      const [y, m] = key.split("-").map(Number)
      p = weekly
        ? { key, label: dayShort(key).replace(/^\S+ /, ""), title: `Week of ${dayLong(key)}`, moves: 0, scans: 0, checkIns: 0 }
        : { key, label: first || m === 1 ? `${MONTHS_SHORT[m - 1]} ${y}` : MONTHS_SHORT[m - 1], title: `${MONTHS_LONG[m - 1]} ${y}`, moves: 0, scans: 0, checkIns: 0 }
      groups.set(key, p)
      first = false
    }
    const e = byDay.get(day)
    if (e) { p.moves += e.moves; p.scans += e.scans; p.checkIns += e.checkIns }
  }
  return weekly
    ? { unit: "week", caption: "Per week (weeks start on Monday)", points: [...groups.values()] }
    : { unit: "month", caption: "Per month (the first and last count only the days picked)", points: [...groups.values()] }
}
