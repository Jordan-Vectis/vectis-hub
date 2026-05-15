import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { format, subDays, subMonths, startOfDay } from "date-fns"
import Link from "next/link"
import CataloguingReportsCharts, { type UserChartData, type MonthBucket } from "./charts"

export const dynamic = "force-dynamic"

export const metadata = { title: "Cataloguing Reports" }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(ms: number): string {
  if (ms <= 0) return "—"
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length)
}

// ─── Range helpers ────────────────────────────────────────────────────────────

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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function CataloguingReportsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")

  const { range } = await searchParams
  const activeRange: RangeKey = (RANGES.find(r => r.key === range)?.key) ?? "30d"
  const since = rangeStart(activeRange)

  const [logs, researchLogs] = await Promise.all([
    prisma.catalogueTimingLog.findMany({
      where: since ? { savedAt: { gte: since } } : {},
      orderBy: { savedAt: "desc" },
      include: { auction: { select: { name: true, code: true } } },
    }),
    prisma.researchLog.findMany({
      where: since ? { savedAt: { gte: since } } : {},
      orderBy: { savedAt: "desc" },
    }),
  ])

  // Monthly buckets — last 12 calendar months (unfiltered by range)
  const allTimeLogs = since
    ? await prisma.catalogueTimingLog.findMany({
        where: { savedAt: { gte: startOfDay(subMonths(new Date(), 12)) } },
        select: { savedAt: true },
      })
    : logs.map(l => ({ savedAt: l.savedAt }))

  const bucketMap = new Map<string, number>()
  for (const l of allTimeLogs) {
    const key = format(l.savedAt, "MMM yy")
    bucketMap.set(key, (bucketMap.get(key) ?? 0) + 1)
  }

  // Build last-12-months ordered list
  const monthlyBuckets: MonthBucket[] = []
  for (let i = 11; i >= 0; i--) {
    const d = subMonths(new Date(), i)
    const key = format(d, "MMM yy")
    monthlyBuckets.push({ month: key, total: bucketMap.get(key) ?? 0 })
  }

  // ── Research stats ──
  const researchByUser = new Map<string, { name: string; totalMs: number; sessions: number }>()
  for (const r of researchLogs) {
    if (!researchByUser.has(r.userId)) {
      researchByUser.set(r.userId, { name: r.userName, totalMs: 0, sessions: 0 })
    }
    const e = researchByUser.get(r.userId)!
    e.totalMs  += r.durationMs
    e.sessions += 1
  }

  // ── Overall summary stats ──
  const allDurations = logs.map(l => l.durationMs)
  const overallAvg   = avg(allDurations)
  const overallMin   = allDurations.length ? Math.min(...allDurations) : 0

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const lotsToday  = logs.filter(l => l.savedAt >= todayStart).length

  // ── Per-user stats ──
  const userMap = new Map<string, {
    name: string
    wizardLogs:    typeof logs
    photoOnlyLogs: typeof logs
  }>()

  for (const log of logs) {
    if (!userMap.has(log.userId)) {
      userMap.set(log.userId, { name: log.userName, wizardLogs: [], photoOnlyLogs: [] })
    }
    const entry = userMap.get(log.userId)!
    if (log.method === "WIZARD") entry.wizardLogs.push(log)
    else entry.photoOnlyLogs.push(log)
  }

  const todayStr = format(new Date(), "yyyy-MM-dd")
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 7); weekStart.setHours(0, 0, 0, 0)

  const userStats = [...userMap.entries()].map(([userId, data]) => {
    const allUserLogs    = [...data.wizardLogs, ...data.photoOnlyLogs]
    const durations      = allUserLogs.map(l => l.durationMs)
    const research       = researchByUser.get(userId)
    const completedLogs  = allUserLogs.filter(l => format(l.savedAt, "yyyy-MM-dd") !== todayStr)
    const completedDays  = new Set(completedLogs.map(l => format(l.savedAt, "yyyy-MM-dd")))
    const dailyAvg       = completedDays.size > 0
      ? Math.round(completedLogs.length / completedDays.size)
      : allUserLogs.filter(l => l.savedAt >= todayStart).length

    return {
      userId,
      name:             data.name,
      totalLots:        allUserLogs.length,
      wizardLots:       data.wizardLogs.length,
      photoOnlyLots:    data.photoOnlyLogs.length,
      avgMs:            avg(durations),
      fastestMs:        durations.length ? Math.min(...durations) : 0,
      slowestMs:        durations.length ? Math.max(...durations) : 0,
      dailyAvg,
      completedDays:    completedDays.size,
      lotsThisWeek:     allUserLogs.filter(l => l.savedAt >= weekStart).length,
      lotsToday:        allUserLogs.filter(l => l.savedAt >= todayStart).length,
      researchMs:       research?.totalMs  ?? 0,
      researchSessions: research?.sessions ?? 0,
    }
  }).sort((a, b) => b.totalLots - a.totalLots)

  // Chart data shape
  const chartUsers: UserChartData[] = userStats.map(u => ({
    userId:        u.userId,
    name:          u.name,
    totalLots:     u.totalLots,
    dailyAvg:      u.dailyAvg,
    avgMs:         u.avgMs,
    completedDays: u.completedDays,
    wizardLots:    u.wizardLots,
    photoOnlyLots: u.photoOnlyLots,
    lotsThisWeek:  u.lotsThisWeek,
    lotsToday:     u.lotsToday,
  }))

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Cataloguing Reports</h1>
          <p className="text-sm text-gray-400 mt-1">
            Performance reports — lots per day, speed comparisons and team leaderboards.
          </p>
        </div>

        {/* Range filter */}
        <div className="flex flex-wrap gap-1.5">
          {RANGES.map(r => (
            <Link
              key={r.key}
              href={`/tools/cataloguing/reports?range=${r.key}`}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                activeRange === r.key
                  ? "bg-[#2AB4A6] text-white border-[#2AB4A6]"
                  : "bg-[#1C1C1E] text-gray-400 border-gray-700 hover:border-gray-500 hover:text-white"
              }`}
            >
              {r.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      {logs.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Total Lots",      value: logs.length.toLocaleString(),  sub: RANGES.find(r => r.key === activeRange)?.label ?? "All time" },
            { label: "Avg Time / Lot",  value: fmtDuration(overallAvg),       sub: "all cataloguers" },
            { label: "Fastest Lot",     value: fmtDuration(overallMin),       sub: "record in range" },
            { label: "Lots Today",      value: lotsToday.toLocaleString(),    sub: format(new Date(), "d MMM yyyy") },
          ].map(card => (
            <div key={card.label} className="bg-[#1C1C1E] border border-gray-800 rounded-xl p-5">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{card.label}</p>
              <p className="text-3xl font-bold text-white">{card.value}</p>
              <p className="text-xs text-gray-500 mt-1">{card.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* No data */}
      {logs.length === 0 && (
        <div className="bg-[#1C1C1E] border border-gray-800 rounded-xl p-12 text-center">
          <p className="text-lg font-semibold text-gray-300 mb-1">No data in this period</p>
          <p className="text-sm text-gray-500">Try selecting a wider time range.</p>
        </div>
      )}

      {/* Charts */}
      {logs.length > 0 && (
        <CataloguingReportsCharts users={chartUsers} monthlyBuckets={monthlyBuckets} />
      )}

      {/* Per-cataloguer table */}
      {userStats.length > 0 && (
        <div>
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Per Cataloguer</h2>
          <div className="bg-[#1C1C1E] border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
                  <th className="text-left px-5 py-3">Cataloguer</th>
                  <th className="text-right px-5 py-3">Total</th>
                  <th className="text-right px-5 py-3">Daily Avg</th>
                  <th className="text-right px-5 py-3">Today</th>
                  <th className="text-right px-5 py-3">This Week</th>
                  <th className="text-right px-5 py-3">Avg Time</th>
                  <th className="text-right px-5 py-3">Fastest</th>
                  <th className="text-right px-5 py-3">Slowest</th>
                  <th className="text-right px-5 py-3">Research</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {userStats.map(u => (
                  <tr key={u.userId} className="hover:bg-gray-900 transition-colors">
                    <td className="px-5 py-3">
                      <Link
                        href={`/tools/cataloguing/reports/${encodeURIComponent(u.userId)}`}
                        className="font-semibold text-white hover:text-[#2AB4A6] transition-colors"
                      >
                        {u.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-right font-bold text-white">{u.totalLots}</td>
                    <td className="px-5 py-3 text-right text-gray-300">{u.dailyAvg}</td>
                    <td className="px-5 py-3 text-right text-gray-300">{u.lotsToday}</td>
                    <td className="px-5 py-3 text-right text-gray-300">{u.lotsThisWeek}</td>
                    <td className="px-5 py-3 text-right font-mono text-gray-300">{fmtDuration(u.avgMs)}</td>
                    <td className="px-5 py-3 text-right font-mono text-green-400">{fmtDuration(u.fastestMs)}</td>
                    <td className="px-5 py-3 text-right font-mono text-red-400">{fmtDuration(u.slowestMs)}</td>
                    <td className="px-5 py-3 text-right font-mono text-amber-400">
                      {u.researchMs ? fmtDuration(u.researchMs) : "—"}
                      {u.researchSessions > 0 && (
                        <span className="text-gray-600 text-xs ml-1">({u.researchSessions})</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  )
}
