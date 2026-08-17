import { prisma } from "@/lib/prisma"
import { assessGap } from "@/lib/idle-gaps"
import { UNALLOCATED_REASON } from "@/lib/idle-timer-config"

// Server-authoritative idle evaluation. Everything here is computed from the
// SERVER's clock (Date.now() on Railway) and the DATABASE's own save timestamps,
// in Europe/London working hours — so a device whose clock or timezone was
// changed cannot shrink the measured gap. Used by BOTH the create-lot gate
// (enforcement) and the last-activity endpoint (the on-screen popup), so the
// popup can no longer be silenced by fiddling the phone's time.

export type IdleGateReason =
  | "TIMER_OFF"          // scan timer switched off for this user
  | "NO_HISTORY"         // no prior save to measure from
  | "UNDER_THRESHOLD"    // same-day gap below the user's threshold
  | "NEW_DAY_GRACE"      // first lot of a new day within the 30-min start grace
  | "DAY_OFF"            // gap of a full working day+ across a day boundary
  | "CLEARED_BY_REASON"  // an over-threshold gap already covered by a logged idle
  | "BLOCKED"            // over-threshold, unaccounted — save is blocked

export type IdleGateEval = {
  reason:      IdleGateReason
  blocked:     boolean       // true only for BLOCKED
  idleMs:      number        // server-computed working-hours gap since last save
  since:       Date | null   // the last save the gap is measured from
  thresholdMs: number
  nowMs:       number        // the server clock at evaluation
  /** The instant the gap was measured TO — the same as nowMs unless measureTo was "lot-start". */
  measuredToMs: number
}

/**
 * ⚠⚠ WHERE THE GAP ENDS (2026-08-17). Jordan: *"someone goes for their lunch comes back makes
 * a lot then the idle timer triggers after making the first lot even though they might of
 * spent 10 mins doing the lot"*.
 *
 * "now"       — the gap ends at this instant. Right for the popup at LOT START, because
 *               "now" IS the start of the lot.
 * "lot-start" — the gap ends when this cataloguer last started a lot (CataloguerLotStart,
 *               stamped by the server). Right for the SAVE-time gate, which would otherwise
 *               fold the lot's own working minutes into the break: back from lunch at 13:25,
 *               ten minutes on a lot, saved 13:35, measured as a 70-minute absence.
 *
 * ⚠ Falls back to "now" when there is no marker, which is exactly the old behaviour — so a
 * deploy before the migration, or a save from a path that never reported a start, is no worse
 * than before. A marker OLDER than the last save is ignored: a save has happened since, so it
 * cannot be describing the lot being saved now.
 */
export type MeasureTo = "now" | "lot-start"

export async function evaluateIdleGate(
  userId: string,
  measureTo: MeasureTo = "now",
  /** The client's reported duration for the lot being saved. Advisory only — see the note
   *  where it is used: it can push the measured end LATER, never earlier. */
  lotDurationMs?: number | null,
): Promise<IdleGateEval> {
  const nowMs = Date.now()
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { showScanTimer: true, timerRedMins: true } })
  const thresholdMs = (u?.timerRedMins ?? 30) * 60_000
  if (u?.showScanTimer === false) return { reason: "TIMER_OFF", blocked: false, idleMs: 0, since: null, thresholdMs, nowMs, measuredToMs: nowMs }

  const lastSave = await prisma.catalogueTimingLog.findFirst({ where: { userId }, orderBy: { savedAt: "desc" }, select: { savedAt: true } })
  if (!lastSave) return { reason: "NO_HISTORY", blocked: false, idleMs: 0, since: null, thresholdMs, nowMs, measuredToMs: nowMs }

  const sinceMs = lastSave.savedAt.getTime()

  // Where does the gap end?
  let endMs = nowMs
  if (measureTo === "lot-start") {
    try {
      const marker = await prisma.cataloguerLotStart.findUnique({ where: { userId }, select: { startedAt: true } })
      const startedMs = marker?.startedAt.getTime() ?? 0
      // Only usable if it sits between the last save and now. Outside that it is stale.
      if (startedMs > sinceMs && startedMs <= nowMs) {
        endMs = startedMs
        // ⚠ A marker can be STALE-EARLY: a lot started, abandoned without saving, a long
        // absence, and the next lot's start not re-stamping (checkIdleOnLotStart bails when a
        // popup is already open). Measuring to that old start would hide the absence.
        //
        // The client's own reported lot duration corrects it — but is used ONLY as a LATER
        // bound, and only when a marker already exists. A device can therefore only ever push
        // the end LATER, which makes the gap BIGGER; it can never shrink one. Claim a
        // three-hour lot and this picks the marker and ignores you. Without a marker there is
        // no client input at all: it falls back to now.
        if (lotDurationMs != null && lotDurationMs >= 0) endMs = Math.max(endMs, nowMs - lotDurationMs)
        endMs = Math.min(endMs, nowMs)
      }
    } catch { /* table not migrated yet — measure to now, i.e. the old behaviour */ }
  }

  const { gate, idleMs, reason } = assessGap(sinceMs, endMs, thresholdMs)
  if (!gate) return { reason: reason === "OVER_THRESHOLD" ? "UNDER_THRESHOLD" : reason, blocked: false, idleMs, since: lastSave.savedAt, thresholdMs, nowMs, measuredToMs: endMs }

  // Over-threshold — already accounted for? A logged idle only clears the gate if
  // it actually COVERS at least half the gap (same rule as the idle-gaps report),
  // so a 1-second throwaway reason can't excuse hours.
  // ⚠ UNALLOCATED rows are excluded: the popup lets a cataloguer leave part of a
  // break unassigned, and unallocated time must never clear the gate (otherwise
  // ticking two reasons for a minute each and leaving hours unallocated would
  // pass). Same rule as coveringIdle in lib/idle-gaps.ts — keep them in step.
  const windowIdle = await prisma.idleLog.findMany({
    where: {
      userId,
      reason: { not: UNALLOCATED_REASON.key },
      // ⚠ nowMs, not endMs — a reason logged DURING the lot (the wizard's within-lot check)
      // still accounts for the break, and must not fall outside the window just because the
      // gap itself is now measured to the lot's start.
      idleStartedAt: { gte: new Date(sinceMs - 5 * 60_000), lte: new Date(nowMs + 5 * 60_000) },
    },
    select: { idleDurationMs: true },
  })
  const coveredMs = windowIdle.reduce((s, l) => s + l.idleDurationMs, 0)
  if (coveredMs >= idleMs / 2) return { reason: "CLEARED_BY_REASON", blocked: false, idleMs, since: lastSave.savedAt, thresholdMs, nowMs, measuredToMs: endMs }

  return { reason: "BLOCKED", blocked: true, idleMs, since: lastSave.savedAt, thresholdMs, nowMs, measuredToMs: endMs }
}

// Record the gate's decision for a save, alongside what the DEVICE claimed
// (clientNow / clientTz). Best-effort telemetry — a failure (e.g. the table not
// existing yet before Run Migrations) must NEVER break a lot save.
export async function logIdleDecision(input: {
  gate:      IdleGateEval
  userId:    string
  userName:  string
  auctionId?: string | null
  clientNow?: number | null
  clientTz?:  string | null
  userAgent?: string | null
}): Promise<void> {
  try {
    await prisma.idleGateDecision.create({
      data: {
        userId:      input.userId,
        userName:    input.userName,
        auctionId:   input.auctionId ?? null,
        reason:      input.gate.reason,
        blocked:     input.gate.blocked,
        // Clamp to Int range — a DAY_OFF row after a months-long absence could
        // otherwise exceed INT_MAX and be rejected (harmless, but avoid it).
        idleMs:      Math.min(input.gate.idleMs, 2_000_000_000),
        since:       input.gate.since,
        thresholdMs: input.gate.thresholdMs,
        clientNow:   input.clientNow ? new Date(input.clientNow) : null,
        clientTz:    input.clientTz ?? null,
        userAgent:   input.userAgent ?? null,
      },
    })
  } catch { /* table may not exist yet (pre-migration) — telemetry must never block a save */ }
}

// Was this save made with the phone's clock/timezone changed away from UK time?
// A foreign timezone, or a clock more than an hour off the server, is the
// fingerprint of the 9–5 dodge. Kept here so the gate and the admin viewer agree.
// The 1h skew tolerance (not minutes) stops ordinary photo-upload latency —
// clientNow is captured before the upload — from false-flagging an honest save; a
// "2am"/US clock is many hours off and still trips it.
export function clockLooksTampered(clientNow: number | null | undefined, clientTz: string | null | undefined, serverNowMs: number): boolean {
  if (clientTz && clientTz !== "Europe/London" && clientTz !== "Europe/Belfast") return true
  if (clientNow && Math.abs(clientNow - serverNowMs) > 60 * 60_000) return true
  return false
}
