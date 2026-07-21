// Server-side "unexplained idle gap" detector — the tamper-proof backstop to the
// client idle popup. The database has every lot-save time per cataloguer, so a
// working-hours gap between consecutive saves that has NO matching idle-reason
// log is detectable here regardless of how the in-app popup was avoided.
//
// Pure functions (no DB) so they can be unit-tested; the admin page feeds them
// rows it has loaded.

// 8 working hours — a gap this long is a day off / holiday, not idle-during-work,
// so it's excluded (mirrors the client's own EIGHT_WORK_HOURS skip).
export const FULL_DAY_WORK_MS = 8 * 60 * 60 * 1000

// ── Europe/London working-hours (server-side) ────────────────────────────────
// The client's workingMsBetween reads the browser's local clock, which for staff
// IS London. On the server (Railway = UTC) that's wrong by the BST/GMT offset, so
// server code (the gap report + the create-lot gate) uses these London-explicit
// versions instead. Gaps are same-day (8h+ excluded), so a single offset sample
// is safe — the only imprecision would be a gap straddling a clock change.

function londonOffsetMs(utcMs: number): number {
  // London wall-clock for this instant, parsed back as if local, minus UTC.
  const s = new Date(utcMs).toLocaleString("en-CA", { timeZone: "Europe/London", hour12: false })
  return new Date(s.replace(", ", "T")).getTime() - utcMs
}

// YYYY-MM-DD of a UTC instant in London — for "is this the first lot of the day?".
export function londonDayKey(utcMs: number): string {
  return new Date(utcMs).toLocaleDateString("en-CA", { timeZone: "Europe/London" })
}

// The UTC instant of London 09:00 (work start) on the London day of `utcMs`.
export function londonWorkStartMs(utcMs: number): number {
  const dayKey = londonDayKey(utcMs)
  const off = londonOffsetMs(new Date(`${dayKey}T12:00:00Z`).getTime())   // sampled midday, clear of DST edges
  return new Date(`${dayKey}T09:00:00Z`).getTime() - off
}

// Grace at the START of a working day: a first lot within this long of 09:00 is
// a normal morning start and isn't gated. Past it, the gap is treated like any
// other (and shown spanning back to the last save, so an early finish the day
// before is visible too).
export const START_GRACE_MS = 30 * 60 * 1000

// Should a lot created at `nowMs`, following the cataloguer's last save at
// `sinceMs`, be prompted for an idle reason? Returns the working idle across the
// WHOLE window (including any prior-day tail, so leaving early yesterday shows)
// and whether it trips the gate.
//   - Day off / holiday (≥ 8 working hours) → never.
//   - First lot of a new day → only if more than the start-of-day grace into the
//     working day (a normal ~9:00–9:30 start is fine).
//   - Otherwise → gap ≥ the user's threshold.
export type AssessReason = "OVER_THRESHOLD" | "UNDER_THRESHOLD" | "NEW_DAY_GRACE" | "DAY_OFF"

export function assessGap(sinceMs: number, nowMs: number, thresholdMs: number): { gate: boolean; idleMs: number; reason: AssessReason } {
  const idleMs = workingMsLondon(sinceMs, nowMs)
  const differentDay = londonDayKey(sinceMs) !== londonDayKey(nowMs)
  // A gap of a full working day or more is time off (holiday / long absence) ONLY
  // when it actually spans into another day. A SAME-day gap that reaches ~8
  // working hours means they were idle the whole working day — present but
  // inactive — and must still be flagged. Requiring the day boundary also stops a
  // stale baseline (e.g. no save written all day) from reading as "day off".
  if (idleMs >= FULL_DAY_WORK_MS && differentDay) return { gate: false, idleMs, reason: "DAY_OFF" }
  if (differentDay) {
    const morningIdle = workingMsLondon(londonWorkStartMs(nowMs), nowMs)
    const gate = morningIdle > START_GRACE_MS
    return { gate, idleMs, reason: gate ? "OVER_THRESHOLD" : "NEW_DAY_GRACE" }
  }
  const gate = idleMs >= thresholdMs
  return { gate, idleMs, reason: gate ? "OVER_THRESHOLD" : "UNDER_THRESHOLD" }
}

// Working ms (Mon–Fri 09:00–17:00 Europe/London) between two UTC instants.
export function workingMsLondon(startMs: number, endMs: number): number {
  if (endMs <= startMs) return 0
  const off = londonOffsetMs(startMs)
  const s = startMs + off, e = endMs + off   // shift so UTC hours read as London wall clock
  let total = 0
  const cur = new Date(s); cur.setUTCHours(0, 0, 0, 0)
  for (let i = 0; i < 60; i++) {
    if (cur.getTime() > e) break
    const wd = cur.getUTCDay()
    if (wd >= 1 && wd <= 5) {
      const ws = new Date(cur); ws.setUTCHours(9, 0, 0, 0)
      const we = new Date(cur); we.setUTCHours(17, 0, 0, 0)
      const overlap = Math.min(e, we.getTime()) - Math.max(s, ws.getTime())
      if (overlap > 0) total += overlap
    }
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return total
}

export type GapSave = { savedAt: Date; lotBarcode?: string | null }
export type GapIdle = { idleStartedAt: Date; idleDurationMs: number; reason: string }

export type IdleGap = {
  userId: string
  userName: string
  start: Date          // the save the gap follows
  end: Date            // the save that ended the gap
  workingMs: number    // working-hours time in the gap
  beforeBarcode: string | null
  afterBarcode: string | null
  explained: boolean   // a matching idle log was found
  reason: string | null
}

// A gap is EXPLAINED when the idle logged in its window COVERS at least half its
// working length — the same coverage rule the create-lot gate uses, so the report
// and the gate agree. (The old check marked a gap explained if ANY idle merely
// STARTED in the window, so a 1-second throwaway reason wrongly excused hours.)
// Returns the covering reason (first log in the window) for display.
const MATCH_MARGIN_MS = 5 * 60 * 1000

function coveringIdle(startMs: number, endMs: number, workingMs: number, idles: GapIdle[]): { explained: boolean; reason: string | null } {
  const inWindow = idles.filter(i => {
    const s = i.idleStartedAt.getTime()
    return s >= startMs - MATCH_MARGIN_MS && s <= endMs + MATCH_MARGIN_MS
  })
  const coveredMs = inWindow.reduce((sum, i) => sum + i.idleDurationMs, 0)
  return { explained: coveredMs >= workingMs / 2, reason: inWindow[0]?.reason ?? null }
}

// Find every working-hours gap over `thresholdMs` in one user's save history.
// `saves` need not be sorted. Returns gaps newest-first when `explained` is kept;
// callers usually filter to `!explained`.
export function findUserGaps(
  userId: string,
  userName: string,
  saves: GapSave[],
  idles: GapIdle[],
  thresholdMs: number,
): IdleGap[] {
  const sorted = [...saves].sort((a, b) => a.savedAt.getTime() - b.savedAt.getTime())
  const gaps: IdleGap[] = []
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1], next = sorted[i]
    const { gate, idleMs: workingMs } = assessGap(prev.savedAt.getTime(), next.savedAt.getTime(), thresholdMs)
    if (!gate) continue
    const match = coveringIdle(prev.savedAt.getTime(), next.savedAt.getTime(), workingMs, idles)
    gaps.push({
      userId, userName,
      start: prev.savedAt, end: next.savedAt, workingMs,
      beforeBarcode: prev.lotBarcode ?? null,
      afterBarcode: next.lotBarcode ?? null,
      explained: match.explained,
      reason: match.reason,
    })
  }
  return gaps
}

export function fmtWorkingGap(ms: number): string {
  const mins = Math.round(ms / 60000)
  const h = Math.floor(mins / 60), m = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
