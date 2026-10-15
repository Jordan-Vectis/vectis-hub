// Goods In — London calendar days. Pure and server-safe.
//
// "Today", "this week" and a history filter's From/To are days on the warehouse's own calendar, not
// the server's: Railway runs in UTC, so between midnight and 1am through British Summer Time a
// UTC "today" would still be yesterday. Every day boundary here is the instant midnight happens in
// London, worked out from the real offset on that date (GMT or BST), never a fixed +0/+1.

const LONDON = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
})

function londonParts(at: Date) {
  const p = LONDON.formatToParts(at)
  const n = (t: Intl.DateTimeFormatPartTypes) => Number(p.find(x => x.type === t)?.value ?? 0)
  return { y: n("year"), m: n("month"), d: n("day"), h: n("hour"), mi: n("minute"), s: n("second") }
}

const pad = (n: number) => String(n).padStart(2, "0")

/** How far London's clock is ahead of UTC at this instant, in ms (0 in winter, 1 hour in summer). */
function offsetMs(at: number): number {
  const p = londonParts(new Date(at))
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(at / 1000) * 1000
}

/** The London calendar day an instant falls on, as YYYY-MM-DD (now, by default). */
export function londonYmd(at: Date = new Date()): string {
  const p = londonParts(at)
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`
}

/** True for a real calendar date written YYYY-MM-DD (what a date box sends). */
export function isYmd(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split("-").map(Number)
  if (y < 2000 || y > 2100) return false
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

/** A YYYY-MM-DD day moved by whole days. */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** The Monday of the week a YYYY-MM-DD day is in. */
export function mondayOfYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sunday
  return addDaysYmd(ymd, -((dow + 6) % 7))
}

/** The instant a London day starts (its midnight in London), for `>=` / `<` filters on timestamps. */
export function londonDayStart(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number)
  const wall = Date.UTC(y, m - 1, d)
  // First guess with the offset at UTC midnight, then correct with the offset at the guessed instant
  // (they differ only on the two clock-change days, and London never skips or repeats midnight).
  const guess = wall - offsetMs(wall)
  return new Date(wall - offsetMs(guess))
}
