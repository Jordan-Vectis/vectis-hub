// Shared aggregation for the Cataloguer Activity Report — one source of truth so
// the on-screen page (app/(app)/tools/reports/idle/page.tsx) and the exportable
// PDF (app/api/reports/idle/pdf/route.ts) always show identical numbers.
//
// ⚠ Naming: user-facing wording is "Cataloguer Activity" / "away"; the CODE
// still uses "idle" throughout (tables IdleLog/IdleGateDecision, route paths).
// Don't "fix" the mismatch — see the idle-report memory note.

import { prisma } from "@/lib/prisma"
import { subDays, subMonths, startOfDay } from "date-fns"
import { buildLotMap, ukDayKey } from "@/lib/cataloguing-reports"
import { findUserGaps, type GapSave, type GapIdle } from "@/lib/idle-gaps"
import { clockLooksTampered } from "@/lib/idle-gate"
import { DEFAULT_REASONS, UNALLOCATED_REASON, groupIdleOccasions, type IdleReason } from "@/lib/idle-timer-config"

export const WORK_DAY_MS = 8 * 60 * 60 * 1000 // a standard 9–5 day

export const RANGES = [
  { key: "7d",  label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "6m",  label: "6 months" },
  { key: "1y",  label: "1 year" },
  { key: "all", label: "All time" },
] as const
export type RangeKey = typeof RANGES[number]["key"]

export function resolveRange(range: string | undefined): RangeKey {
  return (RANGES.find(r => r.key === range)?.key) ?? "30d"
}

export function rangeStart(key: RangeKey): Date | null {
  const now = new Date()
  switch (key) {
    case "7d":  return startOfDay(subDays(now, 7))
    case "30d": return startOfDay(subDays(now, 30))
    case "90d": return startOfDay(subDays(now, 90))
    case "6m":  return startOfDay(subMonths(now, 6))
    case "1y":  return startOfDay(subMonths(now, 12))
    case "all": return null
  }
}

export function fmtDuration(ms: number): string {
  if (!ms || ms <= 0) return "—"
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${totalSec}s`
}

function londonHour(d: Date): number {
  return parseInt(d.toLocaleString("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }), 10)
}
function londonWeekday(d: Date): string {
  return d.toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short" })
}

export type ReasonRow = { key: string; label: string; colour: string; icon: string; ms: number; count: number; avg: number; share: number }
export type UserRow = {
  userId: string; userName: string
  totalMs: number; sessions: number
  unexplainedCount: number; unexplainedMs: number
  tamperCount: number
  days: number; perDayMs: number; pctDay: number | null
  topReasonKey: string | null
  busiestDay: string | null; busiestMs: number
  timerOff: boolean
}
export type LongestBreak = { userName: string; idleDurationMs: number; reason: string; idleStartedAt: Date }
export type TamperRow = { id: string; createdAt: Date; userName: string; clientNow: Date | null; clientTz: string | null }

export type IdleReportData = {
  reasons: IdleReason[]
  reasonMeta: Map<string, IdleReason>
  totalIdleMs: number; totalSessions: number; totalUnexplained: number
  unallocatedMs: number                        // time left unassigned when splitting a break
  personDays: number; idlePerPersonDay: number; idlePctOfDay: number | null; avgSessionMs: number
  reasonRows: ReasonRow[]; topReason: ReasonRow | null
  byHour: { hour: number; ms: number }[]     // 9..16
  byWeekday: { day: string; ms: number }[]    // Mon..Fri
  trend: { day: string; ms: number }[]        // sorted YYYY-MM-DD
  userRows: UserRow[]
  longest: LongestBreak[]
  tamperIncidents: TamperRow[]                 // only populated when includeTamper
  hasData: boolean
}

// Computes every figure the report shows. `includeTamper` gates the admin-only
// clock-tamper list (non-admins never receive those rows).
export async function computeIdleReport(activeRange: RangeKey, includeTamper: boolean): Promise<IdleReportData> {
  const since = rangeStart(activeRange)

  const [idleLogs, rawSaves, users, cfg, decisionRows] = await Promise.all([
    prisma.idleLog.findMany({
      where: since ? { idleStartedAt: { gte: since } } : {},
      select: { userId: true, userName: true, idleStartedAt: true, idleDurationMs: true, reason: true },
      orderBy: { idleStartedAt: "desc" },
    }),
    prisma.catalogueTimingLog.findMany({
      where: since ? { savedAt: { gte: since } } : {},
      select: { userId: true, userName: true, savedAt: true, lotId: true },
      orderBy: { savedAt: "asc" },
    }),
    prisma.user.findMany({ select: { id: true, timerRedMins: true, showScanTimer: true } }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).idleTimerConfig.findUnique({ where: { id: "global" } }).catch(() => null),
    prisma.idleGateDecision
      .findMany({
        where: since ? { createdAt: { gte: since } } : {},
        select: { id: true, createdAt: true, userId: true, userName: true, clientNow: true, clientTz: true },
        orderBy: { createdAt: "desc" },
      })
      .catch((): { id: string; createdAt: Date; userId: string; userName: string; clientNow: Date | null; clientTz: string | null }[] => []),
  ])

  const lotMap = await buildLotMap(rawSaves)
  const saves = rawSaves.filter(s => !s.lotId || lotMap.has(s.lotId))

  const reasons: IdleReason[] = Array.isArray(cfg?.reasons) && cfg.reasons.length ? cfg.reasons : DEFAULT_REASONS
  // UNALLOCATED = display-only pseudo-reason (popup leftover time) — merged so
  // its logs label/colour nicely without ever being a configurable reason.
  const reasonMeta = new Map([...reasons, UNALLOCATED_REASON].map(r => [r.key, r]))
  const labelOf  = (key: string) => reasonMeta.get(key)?.label ?? key
  const colourOf = (key: string) => reasonMeta.get(key)?.idleColour ?? "#9ca3af"
  const iconOf   = (key: string) => reasonMeta.get(key)?.icon ?? "•"

  const thresholdOf = new Map(users.map(u => [u.id, (u.timerRedMins ?? 30) * 60_000]))
  const timerOff = new Set(users.filter(u => u.showScanTimer === false).map(u => u.id))

  // Days actually worked (distinct person + London day with a save) — the honest
  // denominator for "per day" and "share of the working day".
  const personDaySet = new Set<string>()
  const userDays = new Map<string, Set<string>>()
  for (const s of saves) {
    const day = ukDayKey(s.savedAt)
    personDaySet.add(`${s.userId}|${day}`)
    if (!userDays.has(s.userId)) userDays.set(s.userId, new Set())
    userDays.get(s.userId)!.add(day)
  }
  const personDays = personDaySet.size

  type Agg = {
    userId: string; userName: string
    totalMs: number; sessions: number
    byReason: Map<string, number>
    unexplainedCount: number; unexplainedMs: number
    tamperCount: number
    dailyIdle: Map<string, number>
  }
  const rows = new Map<string, Agg>()
  const ensure = (userId: string, userName: string): Agg => {
    let r = rows.get(userId)
    if (!r) { r = { userId, userName, totalMs: 0, sessions: 0, byReason: new Map(), unexplainedCount: 0, unexplainedMs: 0, tamperCount: 0, dailyIdle: new Map() }; rows.set(userId, r) }
    return r
  }

  const teamByReason = new Map<string, { ms: number; count: number }>()
  const trendMap = new Map<string, number>()
  const byHourMap = new Map<number, number>()
  const byWeekdayMap = new Map<string, number>()
  const idlesByUser = new Map<string, GapIdle[]>()

  // Raw rows per user, kept so breaks can be counted as OCCASIONS rather than
  // rows (one break split between reasons writes several rows — see
  // groupIdleOccasions).
  const logsByUser = new Map<string, typeof idleLogs>()

  for (const l of idleLogs) {
    const r = ensure(l.userId, l.userName)
    r.totalMs += l.idleDurationMs
    const bucket = logsByUser.get(l.userId)
    if (bucket) bucket.push(l); else logsByUser.set(l.userId, [l])
    r.byReason.set(l.reason, (r.byReason.get(l.reason) ?? 0) + l.idleDurationMs)
    const day = ukDayKey(l.idleStartedAt)
    r.dailyIdle.set(day, (r.dailyIdle.get(day) ?? 0) + l.idleDurationMs)

    const tr = teamByReason.get(l.reason) ?? { ms: 0, count: 0 }
    tr.ms += l.idleDurationMs; tr.count++; teamByReason.set(l.reason, tr)
    trendMap.set(day, (trendMap.get(day) ?? 0) + l.idleDurationMs)
    const h = londonHour(l.idleStartedAt)
    if (h >= 9 && h <= 16) byHourMap.set(h, (byHourMap.get(h) ?? 0) + l.idleDurationMs)
    byWeekdayMap.set(londonWeekday(l.idleStartedAt), (byWeekdayMap.get(londonWeekday(l.idleStartedAt)) ?? 0) + l.idleDurationMs)

    if (!idlesByUser.has(l.userId)) idlesByUser.set(l.userId, [])
    idlesByUser.get(l.userId)!.push({ idleStartedAt: l.idleStartedAt, idleDurationMs: l.idleDurationMs, reason: l.reason })
  }

  // Unlogged idle (working-hours gaps between saves with no reason given).
  const savesByUser = new Map<string, GapSave[]>()
  const nameByUser = new Map<string, string>()
  for (const s of saves) {
    if (!savesByUser.has(s.userId)) savesByUser.set(s.userId, [])
    savesByUser.get(s.userId)!.push({ savedAt: s.savedAt, lotBarcode: null })
    nameByUser.set(s.userId, s.userName)
  }
  for (const [uid, us] of savesByUser) {
    const gaps = findUserGaps(uid, nameByUser.get(uid) ?? "Unknown", us, idlesByUser.get(uid) ?? [], thresholdOf.get(uid) ?? 30 * 60_000)
    const unexplained = gaps.filter(g => !g.explained)
    if (unexplained.length) {
      const r = ensure(uid, nameByUser.get(uid) ?? "Unknown")
      r.unexplainedCount += unexplained.length
      r.unexplainedMs += unexplained.reduce((s, g) => s + g.workingMs, 0)
    }
  }

  const tamperIncidentsAll = decisionRows.filter(d => clockLooksTampered(d.clientNow?.getTime() ?? null, d.clientTz, d.createdAt.getTime()))
  for (const d of tamperIncidentsAll) ensure(d.userId, d.userName).tamperCount++

  // Breaks are counted per OCCASION, not per row: one break split across several
  // reasons (plus any unallocated leftover) is ONE break, not three or four.
  const occasionsByUser = new Map<string, ReturnType<typeof groupIdleOccasions<(typeof idleLogs)[number]>>>()
  for (const [uid, logs] of logsByUser) occasionsByUser.set(uid, groupIdleOccasions(logs))
  for (const [uid, occ] of occasionsByUser) { const r = rows.get(uid); if (r) r.sessions = occ.length }

  const totalIdleMs = idleLogs.reduce((s, l) => s + l.idleDurationMs, 0)
  const totalSessions = [...occasionsByUser.values()].reduce((s, o) => s + o.length, 0)
  // Time the cataloguer left unassigned when splitting a break — reported on its
  // own (it is deliberately NOT eligible to be the "most common reason", and it
  // never excuses a gap — see coveringIdle in lib/idle-gaps.ts).
  const unallocatedMs = teamByReason.get(UNALLOCATED_REASON.key)?.ms ?? 0
  const totalUnexplained = [...rows.values()].reduce((s, r) => s + r.unexplainedCount, 0)
  const idlePerPersonDay = personDays > 0 ? Math.round(totalIdleMs / personDays) : 0
  const idlePctOfDay = personDays > 0 ? Math.round((totalIdleMs / (personDays * WORK_DAY_MS)) * 100) : null
  const avgSessionMs = totalSessions > 0 ? Math.round(totalIdleMs / totalSessions) : 0

  const reasonRows: ReasonRow[] = [...teamByReason.entries()]
    .map(([key, v]) => ({ key, label: labelOf(key), colour: colourOf(key), icon: iconOf(key), ms: v.ms, count: v.count, avg: v.count ? Math.round(v.ms / v.count) : 0, share: totalIdleMs ? (v.ms / totalIdleMs) * 100 : 0 }))
    .sort((a, b) => b.ms - a.ms)
  // "Most common reason" means a real activity — unallocated time is reported
  // separately rather than being allowed to top the list.
  const topReason = reasonRows.find(r => r.key !== UNALLOCATED_REASON.key) ?? null

  const userRows: UserRow[] = [...rows.values()]
    .sort((a, b) => b.totalMs - a.totalMs)
    .map(r => {
      const days = userDays.get(r.userId)?.size ?? 0
      const perDayMs = days > 0 ? Math.round(r.totalMs / days) : 0
      const pctDay = days > 0 ? Math.round((r.totalMs / (days * WORK_DAY_MS)) * 100) : null
      // "Usual reason" = biggest REAL activity; unallocated never takes the chip.
      const top = [...r.byReason.entries()].filter(([k]) => k !== UNALLOCATED_REASON.key).sort((a, b) => b[1] - a[1])[0]
      const busiest = [...r.dailyIdle.entries()].sort((a, b) => b[1] - a[1])[0]
      return {
        userId: r.userId, userName: r.userName,
        totalMs: r.totalMs, sessions: r.sessions,
        unexplainedCount: r.unexplainedCount, unexplainedMs: r.unexplainedMs,
        tamperCount: r.tamperCount,
        days, perDayMs, pctDay,
        topReasonKey: top ? top[0] : null,
        busiestDay: busiest ? busiest[0] : null, busiestMs: busiest ? busiest[1] : 0,
        timerOff: timerOff.has(r.userId),
      }
    })

  const byHour = Array.from({ length: 8 }, (_, i) => 9 + i).map(h => ({ hour: h, ms: byHourMap.get(h) ?? 0 }))
  const byWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].map(d => ({ day: d, ms: byWeekdayMap.get(d) ?? 0 }))
  const trend = [...trendMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, ms]) => ({ day, ms }))

  // Longest breaks are measured per OCCASION, so a long break split between
  // reasons still shows at its true length instead of as separate fragments.
  // The label shown is the biggest slice of that break.
  const longest: LongestBreak[] = [...occasionsByUser.values()]
    .flat()
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, 10)
    .map(o => {
      const byReason = new Map<string, number>()
      for (const row of o.rows) byReason.set(row.reason, (byReason.get(row.reason) ?? 0) + row.idleDurationMs)
      const dominant = [...byReason.entries()].sort((a, b) => b[1] - a[1])[0]
      return {
        userName: o.rows[0].userName,
        idleDurationMs: o.totalMs,
        reason: dominant ? dominant[0] : o.rows[0].reason,
        idleStartedAt: o.startedAt,
      }
    })

  const tamperIncidents: TamperRow[] = includeTamper
    ? tamperIncidentsAll.map(d => ({ id: d.id, createdAt: d.createdAt, userName: d.userName, clientNow: d.clientNow, clientTz: d.clientTz }))
    : []

  return {
    reasons, reasonMeta,
    totalIdleMs, totalSessions, totalUnexplained, unallocatedMs,
    personDays, idlePerPersonDay, idlePctOfDay, avgSessionMs,
    reasonRows, topReason,
    byHour, byWeekday, trend,
    userRows, longest, tamperIncidents,
    hasData: totalIdleMs > 0 || totalUnexplained > 0,
  }
}
