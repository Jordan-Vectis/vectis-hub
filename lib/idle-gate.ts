import { prisma } from "@/lib/prisma"
import { assessGap } from "@/lib/idle-gaps"

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
}

export async function evaluateIdleGate(userId: string): Promise<IdleGateEval> {
  const nowMs = Date.now()
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { showScanTimer: true, timerRedMins: true } })
  const thresholdMs = (u?.timerRedMins ?? 30) * 60_000
  if (u?.showScanTimer === false) return { reason: "TIMER_OFF", blocked: false, idleMs: 0, since: null, thresholdMs, nowMs }

  const lastSave = await prisma.catalogueTimingLog.findFirst({ where: { userId }, orderBy: { savedAt: "desc" }, select: { savedAt: true } })
  if (!lastSave) return { reason: "NO_HISTORY", blocked: false, idleMs: 0, since: null, thresholdMs, nowMs }

  const sinceMs = lastSave.savedAt.getTime()
  const { gate, idleMs, reason } = assessGap(sinceMs, nowMs, thresholdMs)
  if (!gate) return { reason: reason === "OVER_THRESHOLD" ? "UNDER_THRESHOLD" : reason, blocked: false, idleMs, since: lastSave.savedAt, thresholdMs, nowMs }

  // Over-threshold — already accounted for? A logged idle only clears the gate if
  // it actually COVERS at least half the gap (same rule as the idle-gaps report),
  // so a 1-second throwaway reason can't excuse hours.
  const windowIdle = await prisma.idleLog.findMany({
    where: { userId, idleStartedAt: { gte: new Date(sinceMs - 5 * 60_000), lte: new Date(nowMs + 5 * 60_000) } },
    select: { idleDurationMs: true },
  })
  const coveredMs = windowIdle.reduce((s, l) => s + l.idleDurationMs, 0)
  if (coveredMs >= idleMs / 2) return { reason: "CLEARED_BY_REASON", blocked: false, idleMs, since: lastSave.savedAt, thresholdMs, nowMs }

  return { reason: "BLOCKED", blocked: true, idleMs, since: lastSave.savedAt, thresholdMs, nowMs }
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
