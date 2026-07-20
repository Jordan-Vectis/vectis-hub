// Server-side "unexplained idle gap" detector — the tamper-proof backstop to the
// client idle popup. The database has every lot-save time per cataloguer, so a
// working-hours gap between consecutive saves that has NO matching idle-reason
// log is detectable here regardless of how the in-app popup was avoided.
//
// Pure functions (no DB) so they can be unit-tested; the admin page feeds them
// rows it has loaded.

import { workingMsBetween } from "@/lib/idle-timer-config"

// 8 working hours — a gap this long is a day off / holiday, not idle-during-work,
// so it's excluded (mirrors the client's own EIGHT_WORK_HOURS skip).
export const FULL_DAY_WORK_MS = 8 * 60 * 60 * 1000

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

// A gap is EXPLAINED if the user logged an idle reason that STARTED around when
// the gap started (idleStartedAt within the gap window, with a small margin) —
// i.e. they accounted for that break. Anything else is unexplained.
const MATCH_MARGIN_MS = 5 * 60 * 1000

function matchIdle(startMs: number, endMs: number, idles: GapIdle[]): GapIdle | null {
  for (const idle of idles) {
    const s = idle.idleStartedAt.getTime()
    if (s >= startMs - MATCH_MARGIN_MS && s <= endMs + MATCH_MARGIN_MS) return idle
  }
  return null
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
    const workingMs = workingMsBetween(prev.savedAt.getTime(), next.savedAt.getTime())
    if (workingMs < thresholdMs || workingMs >= FULL_DAY_WORK_MS) continue
    const idle = matchIdle(prev.savedAt.getTime(), next.savedAt.getTime(), idles)
    gaps.push({
      userId, userName,
      start: prev.savedAt, end: next.savedAt, workingMs,
      beforeBarcode: prev.lotBarcode ?? null,
      afterBarcode: next.lotBarcode ?? null,
      explained: !!idle,
      reason: idle?.reason ?? null,
    })
  }
  return gaps
}

export function fmtWorkingGap(ms: number): string {
  const mins = Math.round(ms / 60000)
  const h = Math.floor(mins / 60), m = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
