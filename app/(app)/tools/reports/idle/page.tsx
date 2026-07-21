import { prisma } from "@/lib/prisma"
import { getEffectiveSession } from "@/lib/impersonation"
import { hasAppAccess } from "@/lib/apps"
import { redirect } from "next/navigation"
import Link from "next/link"
import { format, subDays, subMonths, startOfDay } from "date-fns"
import { buildLotMap, ukDayKey } from "@/lib/cataloguing-reports"
import { findUserGaps, type GapSave, type GapIdle } from "@/lib/idle-gaps"
import { clockLooksTampered } from "@/lib/idle-gate"
import { DEFAULT_REASONS, type IdleReason } from "@/lib/idle-timer-config"
import { ReasonBreakdownChart, IdleTrendChart } from "./idle-report-charts"

export const dynamic = "force-dynamic"
export const metadata = { title: "Idle Report" }

function fmtDuration(ms: number): string {
  if (!ms || ms <= 0) return "—"
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${totalSec}s`
}

const RANGES = [
  { key: "7d",  label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "6m",  label: "6 months" },
  { key: "1y",  label: "1 year" },
  { key: "all", label: "All time" },
] as const
type RangeKey = typeof RANGES[number]["key"]

function rangeStart(key: RangeKey): Date | null {
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

export default async function IdleReportPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const session = await getEffectiveSession()
  if (!session) redirect("/login")
  const dbUser = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, allowedApps: true } })
  if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "REPORTS")) redirect("/hub")
  const isAdmin = dbUser?.role === "ADMIN"

  const { range } = await searchParams
  const activeRange: RangeKey = (RANGES.find(r => r.key === range)?.key) ?? "30d"
  const since = rangeStart(activeRange)
  const savedFilter = since ? { gte: since } : undefined

  // ── Data ──
  const [idleLogs, rawSaves, users, cfg, decisionRows] = await Promise.all([
    prisma.idleLog.findMany({
      where: since ? { idleStartedAt: { gte: since } } : {},
      select: { userId: true, userName: true, idleStartedAt: true, idleDurationMs: true, reason: true },
      orderBy: { idleStartedAt: "desc" },
    }),
    prisma.catalogueTimingLog.findMany({
      where: savedFilter ? { savedAt: savedFilter } : {},
      select: { userId: true, userName: true, savedAt: true, lotId: true },
      orderBy: { savedAt: "asc" },
    }),
    prisma.user.findMany({ select: { id: true, timerRedMins: true, showScanTimer: true } }),
    // Configured idle reasons (labels + colours); falls back to defaults.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).idleTimerConfig.findUnique({ where: { id: "global" } }).catch(() => null),
    // Gate-decision log (tamper flags). May not exist before Run Migrations.
    prisma.idleGateDecision
      .findMany({
        where: since ? { createdAt: { gte: since } } : {},
        select: { id: true, createdAt: true, userId: true, userName: true, clientNow: true, clientTz: true },
        orderBy: { createdAt: "desc" },
      })
      .catch((): { id: string; createdAt: Date; userId: string; userName: string; clientNow: Date | null; clientTz: string | null }[] => []),
  ])

  // Exclude orphaned saves (a lotId matching no lot — phantom deleted-lot rows).
  const lotMap = await buildLotMap(rawSaves)
  const saves = rawSaves.filter(s => !s.lotId || lotMap.has(s.lotId))

  // Reason lookup (key → label/colour), configured or default.
  const reasons: IdleReason[] = Array.isArray(cfg?.reasons) && cfg.reasons.length ? cfg.reasons : DEFAULT_REASONS
  const reasonMeta = new Map(reasons.map(r => [r.key, r]))
  const labelOf  = (key: string) => reasonMeta.get(key)?.label ?? key
  const colourOf = (key: string) => reasonMeta.get(key)?.idleColour ?? "#9ca3af"
  const iconOf   = (key: string) => reasonMeta.get(key)?.icon ?? "•"

  const thresholdOf = new Map(users.map(u => [u.id, (u.timerRedMins ?? 30) * 60_000]))
  const timerOff = new Set(users.filter(u => u.showScanTimer === false).map(u => u.id))

  // ── Per-user aggregation ──
  type Row = {
    userId: string; userName: string
    totalMs: number; sessions: number
    byReason: Map<string, number>
    unexplainedCount: number; unexplainedMs: number
    tamperCount: number
  }
  const rows = new Map<string, Row>()
  const ensure = (userId: string, userName: string): Row => {
    let r = rows.get(userId)
    if (!r) { r = { userId, userName, totalMs: 0, sessions: 0, byReason: new Map(), unexplainedCount: 0, unexplainedMs: 0, tamperCount: 0 }; rows.set(userId, r) }
    return r
  }

  const teamByReason = new Map<string, number>()
  const trend = new Map<string, number>()   // london day → idle ms
  const idlesByUser = new Map<string, GapIdle[]>()

  for (const l of idleLogs) {
    const r = ensure(l.userId, l.userName)
    r.totalMs += l.idleDurationMs
    r.sessions++
    r.byReason.set(l.reason, (r.byReason.get(l.reason) ?? 0) + l.idleDurationMs)
    teamByReason.set(l.reason, (teamByReason.get(l.reason) ?? 0) + l.idleDurationMs)
    const day = ukDayKey(l.idleStartedAt)
    trend.set(day, (trend.get(day) ?? 0) + l.idleDurationMs)
    if (!idlesByUser.has(l.userId)) idlesByUser.set(l.userId, [])
    idlesByUser.get(l.userId)!.push({ idleStartedAt: l.idleStartedAt, idleDurationMs: l.idleDurationMs, reason: l.reason })
  }

  // Unexplained gaps per user (from the save history + idle logs).
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

  // Clock-tamper flags per user (from the gate log).
  const tamperIncidents = decisionRows.filter(d => clockLooksTampered(d.clientNow?.getTime() ?? null, d.clientTz, d.createdAt.getTime()))
  for (const d of tamperIncidents) ensure(d.userId, d.userName).tamperCount++

  const userRows = [...rows.values()].sort((a, b) => (b.totalMs + b.unexplainedMs) - (a.totalMs + a.unexplainedMs))

  // ── Team totals ──
  const totalIdleMs = idleLogs.reduce((s, l) => s + l.idleDurationMs, 0)
  const totalSessions = idleLogs.length
  const totalUnexplainedMs = userRows.reduce((s, r) => s + r.unexplainedMs, 0)
  const totalUnexplained = userRows.reduce((s, r) => s + r.unexplainedCount, 0)
  const tamperCount = tamperIncidents.length

  const reasonChart = [...teamByReason.entries()]
    .map(([key, ms]) => ({ name: labelOf(key), ms, colour: colourOf(key) }))
    .sort((a, b) => b.ms - a.ms)
  const trendChart = [...trend.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, ms]) => ({ day: format(new Date(day + "T12:00:00"), "d MMM"), ms }))

  const activeLabel = RANGES.find(r => r.key === activeRange)?.label ?? "All time"
  const hasData = idleLogs.length > 0 || totalUnexplained > 0 || tamperCount > 0

  const cards = [
    { label: "Total Idle Logged", value: fmtDuration(totalIdleMs), sub: `${totalSessions} session${totalSessions === 1 ? "" : "s"}`, accent: "border-l-orange-500" },
    { label: "Unexplained Gaps",  value: fmtDuration(totalUnexplainedMs), sub: `${totalUnexplained} gap${totalUnexplained === 1 ? "" : "s"} · never accounted for`, accent: "border-l-red-500" },
    { label: "Idle Sessions",     value: totalSessions.toLocaleString(), sub: "reasons logged", accent: "border-l-blue-500" },
    { label: "Clock-Tamper Flags", value: tamperCount.toLocaleString(), sub: "saves on a non-UK time", accent: tamperCount > 0 ? "border-l-red-500" : "border-l-gray-400" },
  ]

  return (
    <div className="min-h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1C1C1E] px-6 py-5">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-3">
            <Link href="/hub" className="hover:text-gray-700 dark:hover:text-gray-300 transition-colors">Hub</Link>
            <span>/</span>
            <Link href="/tools/reports" className="hover:text-gray-700 dark:hover:text-gray-300 transition-colors">Reports</Link>
            <span>/</span>
            <span className="text-gray-700 dark:text-gray-300">Idle</span>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">Idle Report</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Idle time across the team — logged reasons, unexplained working-hours gaps, and clock-tamper flags. Only Mon–Fri 9–5 counts.</p>
            </div>
            <div className="flex items-center gap-1 bg-gray-100 dark:bg-[#141416] border border-gray-200 dark:border-gray-800 rounded-lg p-1">
              {RANGES.map(r => (
                <Link key={r.key} href={`/tools/reports/idle?range=${r.key}`}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${activeRange === r.key ? "bg-[#2AB4A6] text-white" : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"}`}>
                  {r.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 bg-gray-50 dark:bg-[#141416] px-6 py-8">
        <div className="max-w-7xl mx-auto space-y-8">
          {!hasData ? (
            <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-16 text-center">
              <p className="text-lg font-semibold text-gray-600 dark:text-gray-300 mb-1">No idle data for this period</p>
              <p className="text-sm text-gray-500">Try a wider time range.</p>
            </div>
          ) : (
            <>
              {/* Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {cards.map(c => (
                  <div key={c.label} className={`bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 border-l-2 ${c.accent} rounded-xl px-5 py-4`}>
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{c.label}</p>
                    <p className="text-3xl font-bold text-gray-900 dark:text-white tabular-nums">{c.value}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">{c.sub}</p>
                  </div>
                ))}
              </div>

              {/* Charts */}
              <div className="grid lg:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-5">
                  <h2 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Idle by Reason — {activeLabel}</h2>
                  <ReasonBreakdownChart data={reasonChart} />
                </div>
                <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-5">
                  <h2 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Idle per Day</h2>
                  <IdleTrendChart data={trendChart} />
                </div>
              </div>

              {/* Per-cataloguer table */}
              <div>
                <h2 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Per Cataloguer</h2>
                <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl overflow-x-auto">
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        <th className="text-left px-5 py-3">Cataloguer</th>
                        <th className="text-right px-5 py-3">Idle Logged</th>
                        <th className="text-right px-5 py-3">Sessions</th>
                        <th className="text-left px-5 py-3">Top Reasons</th>
                        <th className="text-right px-5 py-3">Unexplained</th>
                        <th className="text-right px-5 py-3">Tamper</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-800/60">
                      {userRows.map((r) => {
                        const top = [...r.byReason.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
                        return (
                          <tr key={r.userId} className="hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors group">
                            <td className="px-5 py-3.5">
                              <Link href={`/tools/reports/${encodeURIComponent(r.userId)}`} className="font-semibold text-gray-900 dark:text-white group-hover:text-[#2AB4A6] transition-colors">{r.userName}</Link>
                              {timerOff.has(r.userId) && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 align-middle">timer OFF</span>}
                            </td>
                            <td className="px-5 py-3.5 text-right font-bold text-orange-500 tabular-nums">{fmtDuration(r.totalMs)}</td>
                            <td className="px-5 py-3.5 text-right text-gray-600 dark:text-gray-300 tabular-nums">{r.sessions}</td>
                            <td className="px-5 py-3.5">
                              <div className="flex flex-wrap gap-1.5">
                                {top.length === 0 ? <span className="text-gray-400 dark:text-gray-600">—</span> : top.map(([key, ms]) => (
                                  <span key={key} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ background: colourOf(key) + "22", color: colourOf(key) }}>
                                    <span>{iconOf(key)}</span>{labelOf(key)} <span className="opacity-70">{fmtDuration(ms)}</span>
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="px-5 py-3.5 text-right tabular-nums">
                              {r.unexplainedCount > 0
                                ? <span className="text-red-600 dark:text-red-400 font-medium">{fmtDuration(r.unexplainedMs)} <span className="text-gray-400 font-normal">({r.unexplainedCount})</span></span>
                                : <span className="text-gray-400 dark:text-gray-600">—</span>}
                            </td>
                            <td className="px-5 py-3.5 text-right tabular-nums">
                              {r.tamperCount > 0 ? <span className="text-red-600 dark:text-red-400 font-bold">⚠ {r.tamperCount}</span> : <span className="text-gray-400 dark:text-gray-600">—</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Clock-tamper incidents (admin only — accusatory detail) */}
              {isAdmin && tamperIncidents.length > 0 && (
                <div>
                  <h2 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Clock-Tamper Incidents <span className="font-normal normal-case text-gray-400">— saves made on a non-UK timezone or a clock well off the server</span></h2>
                  <div className="bg-white dark:bg-[#1C1C1E] border border-red-200 dark:border-red-900/40 rounded-xl overflow-x-auto">
                    <table className="w-full text-sm whitespace-nowrap">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          <th className="text-left px-5 py-3">Server Time</th>
                          <th className="text-left px-5 py-3">Cataloguer</th>
                          <th className="text-left px-5 py-3">Phone Said</th>
                          <th className="text-left px-5 py-3">Phone Timezone</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-800/60">
                        {tamperIncidents.slice(0, 200).map((d) => (
                          <tr key={d.id} className="bg-red-50/60 dark:bg-red-950/20">
                            <td className="px-5 py-2.5 text-gray-700 dark:text-gray-300 tabular-nums">{d.createdAt.toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                            <td className="px-5 py-2.5 text-gray-700 dark:text-gray-300">{d.userName}</td>
                            <td className="px-5 py-2.5 text-red-600 dark:text-red-400 font-semibold tabular-nums">
                              {d.clientNow ? (() => { try { return d.clientNow.toLocaleString("en-GB", { timeZone: d.clientTz || "Europe/London", weekday: "short", hour: "2-digit", minute: "2-digit" }) } catch { return d.clientNow.toLocaleString("en-GB") } })() : "—"}
                            </td>
                            <td className="px-5 py-2.5 text-red-600 dark:text-red-400 font-semibold">{d.clientTz ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">The gate itself always uses server time, so this doesn&apos;t let anyone through — it&apos;s the evidence trail. Full decisions: <Link href="/admin/idle-gaps" className="text-[#2AB4A6] hover:underline">Unexplained Idle Gaps</Link>.</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
