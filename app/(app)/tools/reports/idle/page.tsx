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
import { ReasonBreakdownChart, IdleTrendChart, IdleByHourChart, IdleByWeekdayChart } from "./idle-report-charts"

export const dynamic = "force-dynamic"
export const metadata = { title: "Cataloguer Activity" }

const WORK_DAY_MS = 8 * 60 * 60 * 1000   // a standard 9–5 day

function fmtDuration(ms: number): string {
  if (!ms || ms <= 0) return "—"
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${totalSec}s`
}
function londonHour(d: Date): number { return parseInt(d.toLocaleString("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }), 10) }
function londonWeekday(d: Date): string { return d.toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short" }) }
function hourLabel(h: number): string { return h === 12 ? "12pm" : h < 12 ? `${h}am` : `${h - 12}pm` }

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

  // ── Data ──
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
  const reasonMeta = new Map(reasons.map(r => [r.key, r]))
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

  // ── Per-user + team aggregation ──
  type Row = {
    userId: string; userName: string
    totalMs: number; sessions: number
    byReason: Map<string, number>
    unexplainedCount: number; unexplainedMs: number
    tamperCount: number
    dailyIdle: Map<string, number>
  }
  const rows = new Map<string, Row>()
  const ensure = (userId: string, userName: string): Row => {
    let r = rows.get(userId)
    if (!r) { r = { userId, userName, totalMs: 0, sessions: 0, byReason: new Map(), unexplainedCount: 0, unexplainedMs: 0, tamperCount: 0, dailyIdle: new Map() }; rows.set(userId, r) }
    return r
  }

  const teamByReason = new Map<string, { ms: number; count: number }>()
  const trend = new Map<string, number>()
  const byHour = new Map<number, number>()
  const byWeekday = new Map<string, number>()
  const idlesByUser = new Map<string, GapIdle[]>()

  for (const l of idleLogs) {
    const r = ensure(l.userId, l.userName)
    r.totalMs += l.idleDurationMs
    r.sessions++
    r.byReason.set(l.reason, (r.byReason.get(l.reason) ?? 0) + l.idleDurationMs)
    const day = ukDayKey(l.idleStartedAt)
    r.dailyIdle.set(day, (r.dailyIdle.get(day) ?? 0) + l.idleDurationMs)

    const tr = teamByReason.get(l.reason) ?? { ms: 0, count: 0 }
    tr.ms += l.idleDurationMs; tr.count++; teamByReason.set(l.reason, tr)
    trend.set(day, (trend.get(day) ?? 0) + l.idleDurationMs)
    const h = londonHour(l.idleStartedAt)
    if (h >= 9 && h <= 16) byHour.set(h, (byHour.get(h) ?? 0) + l.idleDurationMs)
    byWeekday.set(londonWeekday(l.idleStartedAt), (byWeekday.get(londonWeekday(l.idleStartedAt)) ?? 0) + l.idleDurationMs)

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

  const tamperIncidents = decisionRows.filter(d => clockLooksTampered(d.clientNow?.getTime() ?? null, d.clientTz, d.createdAt.getTime()))
  for (const d of tamperIncidents) ensure(d.userId, d.userName).tamperCount++

  const userRows = [...rows.values()].sort((a, b) => b.totalMs - a.totalMs)

  // ── Team headline numbers ──
  const totalIdleMs = idleLogs.reduce((s, l) => s + l.idleDurationMs, 0)
  const totalSessions = idleLogs.length
  const totalUnexplained = userRows.reduce((s, r) => s + r.unexplainedCount, 0)
  const idlePerPersonDay = personDays > 0 ? Math.round(totalIdleMs / personDays) : 0
  const idlePctOfDay = personDays > 0 ? Math.round((totalIdleMs / (personDays * WORK_DAY_MS)) * 100) : null
  const avgSessionMs = totalSessions > 0 ? Math.round(totalIdleMs / totalSessions) : 0

  const reasonRows = [...teamByReason.entries()]
    .map(([key, v]) => ({ key, label: labelOf(key), colour: colourOf(key), icon: iconOf(key), ms: v.ms, count: v.count, avg: v.count ? Math.round(v.ms / v.count) : 0, share: totalIdleMs ? (v.ms / totalIdleMs) * 100 : 0 }))
    .sort((a, b) => b.ms - a.ms)
  const topReason = reasonRows[0] ?? null

  const reasonChart = reasonRows.map(r => ({ name: r.label, ms: r.ms, colour: r.colour }))
  const trendChart = [...trend.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, ms]) => ({ day: format(new Date(day + "T12:00:00"), "d MMM"), ms }))
  const hourChart = Array.from({ length: 8 }, (_, i) => 9 + i).map(h => ({ label: hourLabel(h), ms: byHour.get(h) ?? 0 }))
  const weekdayChart = ["Mon", "Tue", "Wed", "Thu", "Fri"].map(d => ({ label: d, ms: byWeekday.get(d) ?? 0 }))

  const longest = [...idleLogs].sort((a, b) => b.idleDurationMs - a.idleDurationMs).slice(0, 10)

  const activeLabel = RANGES.find(r => r.key === activeRange)?.label ?? "All time"
  const hasData = totalIdleMs > 0 || totalUnexplained > 0

  const cards = [
    { label: "Total Time Away", value: fmtDuration(totalIdleMs), sub: activeLabel, accent: "border-l-orange-500" },
    { label: "Away Share of Day", value: idlePctOfDay != null ? `${idlePctOfDay}%` : "—", sub: "of the 9–5 working day", accent: "border-l-amber-500" },
    { label: "Away per Person / Day", value: fmtDuration(idlePerPersonDay), sub: `over ${personDays} day${personDays === 1 ? "" : "s"} worked`, accent: "border-l-blue-500" },
    { label: "Most Common Reason", value: topReason ? `${topReason.icon} ${topReason.label}` : "—", sub: topReason ? `${fmtDuration(topReason.ms)} · ${Math.round(topReason.share)}% of time away` : "no reasons logged", accent: "border-l-purple-500" },
  ]

  const card = "bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl"
  const h2 = "text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider"

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
            <span className="text-gray-700 dark:text-gray-300">Cataloguer Activity</span>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">Cataloguer Activity Report</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">How much time the team spends away from cataloguing, and what they&apos;re doing. Only counts Monday–Friday, 9am–5pm.</p>
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
            <div className={`${card} p-16 text-center`}>
              <p className="text-lg font-semibold text-gray-600 dark:text-gray-300 mb-1">No activity data for this period</p>
              <p className="text-sm text-gray-500">Try a wider time range.</p>
            </div>
          ) : (
            <>
              {/* Headline cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {cards.map(c => (
                  <div key={c.label} className={`${card} border-l-2 ${c.accent} px-5 py-4`}>
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{c.label}</p>
                    <p className="text-3xl font-bold text-gray-900 dark:text-white tabular-nums">{c.value}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">{c.sub}</p>
                  </div>
                ))}
              </div>

              {/* Idle by reason: chart + table */}
              <div className="grid lg:grid-cols-2 gap-6">
                <div className={`${card} p-5`}>
                  <h2 className={`${h2} mb-4`}>What they&apos;re doing when away from cataloguing</h2>
                  <ReasonBreakdownChart data={reasonChart} />
                </div>
                <div className={`${card} p-5`}>
                  <h2 className={`${h2} mb-4`}>Activity reasons — the numbers</h2>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-400 uppercase tracking-wider text-left">
                        <th className="pb-2 font-medium">Reason</th>
                        <th className="pb-2 font-medium text-right">Total</th>
                        <th className="pb-2 font-medium text-right">Times</th>
                        <th className="pb-2 font-medium text-right">Avg</th>
                        <th className="pb-2 font-medium text-right">Share</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800/70">
                      {reasonRows.map(r => (
                        <tr key={r.key}>
                          <td className="py-2"><span className="inline-flex items-center gap-1.5"><span>{r.icon}</span><span className="text-gray-800 dark:text-gray-200">{r.label}</span></span></td>
                          <td className="py-2 text-right font-semibold text-gray-900 dark:text-white tabular-nums">{fmtDuration(r.ms)}</td>
                          <td className="py-2 text-right text-gray-500 dark:text-gray-400 tabular-nums">{r.count}</td>
                          <td className="py-2 text-right text-gray-500 dark:text-gray-400 tabular-nums">{fmtDuration(r.avg)}</td>
                          <td className="py-2 text-right tabular-nums">
                            <span className="inline-flex items-center gap-2 justify-end">
                              <span className="hidden sm:inline-block w-16 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden"><span className="block h-full rounded-full" style={{ width: `${Math.round(r.share)}%`, background: r.colour }} /></span>
                              <span className="text-gray-600 dark:text-gray-300 w-9 text-right">{Math.round(r.share)}%</span>
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* When idle happens */}
              <div className="grid lg:grid-cols-3 gap-6">
                <div className={`${card} p-5 lg:col-span-1`}>
                  <h2 className={`${h2} mb-1`}>Time away by day of week</h2>
                  <p className="text-xs text-gray-400 mb-3">Which days lose the most time.</p>
                  <IdleByWeekdayChart data={weekdayChart} />
                </div>
                <div className={`${card} p-5 lg:col-span-2`}>
                  <h2 className={`${h2} mb-1`}>Time away by time of day</h2>
                  <p className="text-xs text-gray-400 mb-3">When in the working day people step away (start time of each break).</p>
                  <IdleByHourChart data={hourChart} />
                </div>
              </div>

              {/* Idle over time */}
              <div className={`${card} p-5`}>
                <h2 className={`${h2} mb-4`}>Time away over time</h2>
                <IdleTrendChart data={trendChart} />
              </div>

              {/* Per-cataloguer */}
              <div>
                <div className="flex items-baseline justify-between mb-3">
                  <h2 className={h2}>Per cataloguer</h2>
                  <span className="text-xs text-gray-400">most time away first · avg break = {fmtDuration(avgSessionMs)}</span>
                </div>
                <div className={`${card} overflow-x-auto`}>
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        <th className="text-left px-5 py-3">Cataloguer</th>
                        <th className="text-right px-5 py-3">Away</th>
                        <th className="text-right px-5 py-3">Per Day</th>
                        <th className="text-right px-5 py-3">Share of Day</th>
                        <th className="text-right px-5 py-3">Breaks</th>
                        <th className="text-left px-5 py-3">Usual Reason</th>
                        <th className="text-right px-5 py-3">No Reason Given</th>
                        <th className="text-left px-5 py-3">Most Time Away</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-800/60">
                      {userRows.map((r, i) => {
                        const days = userDays.get(r.userId)?.size ?? 0
                        const perDay = days > 0 ? Math.round(r.totalMs / days) : 0
                        const pctDay = days > 0 ? Math.round((r.totalMs / (days * WORK_DAY_MS)) * 100) : null
                        const top = [...r.byReason.entries()].sort((a, b) => b[1] - a[1])[0]
                        const busiest = [...r.dailyIdle.entries()].sort((a, b) => b[1] - a[1])[0]
                        return (
                          <tr key={r.userId} className="hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors group">
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-2.5">
                                <span className="text-xs text-gray-400 dark:text-gray-600 w-4 text-right tabular-nums">{i + 1}</span>
                                <Link href={`/tools/reports/${encodeURIComponent(r.userId)}`} className="font-semibold text-gray-900 dark:text-white group-hover:text-[#2AB4A6] transition-colors">{r.userName}</Link>
                                {timerOff.has(r.userId) && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400">timer off</span>}
                              </div>
                            </td>
                            <td className="px-5 py-3.5 text-right font-bold text-orange-500 tabular-nums">{fmtDuration(r.totalMs)}</td>
                            <td className="px-5 py-3.5 text-right text-gray-600 dark:text-gray-300 tabular-nums">{fmtDuration(perDay)}</td>
                            <td className="px-5 py-3.5 text-right tabular-nums">
                              {pctDay != null ? <span className={pctDay >= 25 ? "text-red-500 font-semibold" : pctDay >= 15 ? "text-amber-500" : "text-gray-600 dark:text-gray-300"}>{pctDay}%</span> : <span className="text-gray-400">—</span>}
                            </td>
                            <td className="px-5 py-3.5 text-right text-gray-500 dark:text-gray-400 tabular-nums">{r.sessions || "—"}</td>
                            <td className="px-5 py-3.5">
                              {top ? <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ background: colourOf(top[0]) + "22", color: colourOf(top[0]) }}><span>{iconOf(top[0])}</span>{labelOf(top[0])}</span> : <span className="text-gray-400 dark:text-gray-600">—</span>}
                            </td>
                            <td className="px-5 py-3.5 text-right tabular-nums">
                              {r.unexplainedMs > 0 ? <span className="text-red-600 dark:text-red-400 font-medium">{fmtDuration(r.unexplainedMs)} <span className="text-gray-400 font-normal">({r.unexplainedCount})</span></span> : <span className="text-gray-400 dark:text-gray-600">—</span>}
                            </td>
                            <td className="px-5 py-3.5 text-gray-500 dark:text-gray-400 text-xs">
                              {busiest ? <>{format(new Date(busiest[0] + "T12:00:00"), "EEE d MMM")} <span className="text-gray-400">· {fmtDuration(busiest[1])}</span></> : "—"}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">&quot;No Reason Given&quot; = time a cataloguer was clearly away during working hours (a long gap between saved lots) but never logged a reason for it.</p>
              </div>

              {/* Longest single breaks */}
              {longest.length > 0 && (
                <div>
                  <h2 className={`${h2} mb-3`}>Longest single breaks</h2>
                  <div className={`${card} overflow-x-auto`}>
                    <table className="w-full text-sm whitespace-nowrap">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          <th className="text-left px-5 py-3">Cataloguer</th>
                          <th className="text-right px-5 py-3">Length</th>
                          <th className="text-left px-5 py-3">Reason</th>
                          <th className="text-left px-5 py-3">When</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-800/60">
                        {longest.map((l, i) => (
                          <tr key={i} className="hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors">
                            <td className="px-5 py-2.5 font-medium text-gray-900 dark:text-white">{l.userName}</td>
                            <td className="px-5 py-2.5 text-right font-bold text-orange-500 tabular-nums">{fmtDuration(l.idleDurationMs)}</td>
                            <td className="px-5 py-2.5">
                              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ background: colourOf(l.reason) + "22", color: colourOf(l.reason) }}><span>{iconOf(l.reason)}</span>{labelOf(l.reason)}</span>
                            </td>
                            <td className="px-5 py-2.5 text-gray-500 dark:text-gray-400 text-xs tabular-nums">{l.idleStartedAt.toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Admin-only: clock-tamper incidents */}
              {isAdmin && tamperIncidents.length > 0 && (
                <div>
                  <h2 className={`${h2} mb-3`}>⚠ Flagged for review <span className="font-normal normal-case text-gray-400">— saves made with the device clock or timezone changed away from UK time (admin only)</span></h2>
                  <div className={`${card} border-red-200 dark:border-red-900/40 overflow-x-auto`}>
                    <table className="w-full text-sm whitespace-nowrap">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          <th className="text-left px-5 py-3">Real (server) time</th>
                          <th className="text-left px-5 py-3">Cataloguer</th>
                          <th className="text-left px-5 py-3">Device showed</th>
                          <th className="text-left px-5 py-3">Device timezone</th>
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
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
