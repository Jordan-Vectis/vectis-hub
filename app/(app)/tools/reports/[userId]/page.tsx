import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import { format, subDays, subMonths, startOfDay } from "date-fns"
import Link from "next/link"
import {
  CollapsibleLotsTable,
  CollapsibleIdleTable,
  TodayProductivityCard,
  TodayTimeline,
  DailyComparisonTable,
  CustomRangePicker,
  type DayStats,
} from "../../../admin/cataloguing-reports/[userId]/collapsible-sections"

export const dynamic = "force-dynamic"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "—"
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

function PctBar({ pct, colour }: { pct: number; colour: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-200 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
        <div className="h-2 rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, background: colour }} />
      </div>
      <span className="text-xs text-gray-500 w-8 text-right">{Math.round(pct)}%</span>
    </div>
  )
}

// ─── Time frame options ───────────────────────────────────────────────────────

const RANGES = [
  { key: "7d",  label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "6m",  label: "Last 6 months" },
  { key: "1y",  label: "Last year" },
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

export default async function ReportsUserPage({
  params,
  searchParams,
}: {
  params:       Promise<{ userId: string }>
  searchParams: Promise<{ range?: string; from?: string; to?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")

  const { userId }                       = await params
  const { range, from: fromParam, to: toParam } = await searchParams
  const activeRange: RangeKey            = (RANGES.find(r => r.key === range)?.key) ?? "30d"
  const isCustomRange                    = !!(fromParam || toParam)

  // Resolve date bounds
  let since: Date | null
  let until: Date | null = null

  if (isCustomRange) {
    since = fromParam ? startOfDay(new Date(fromParam)) : null
    until = toParam   ? new Date(toParam + "T23:59:59.999") : null
  } else {
    since = rangeStart(activeRange)
  }

  // Shared date filter builders
  const savedAtFilter  = since || until ? { savedAt:        { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } } : {}
  const idleAtFilter   = since || until ? { idleStartedAt:  { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } } : {}

  // Today bounds — for the always-visible productivity card
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)

  const [logs, researchLogs, idleLogs] = await Promise.all([
    prisma.catalogueTimingLog.findMany({
      where:   { userId, ...savedAtFilter },
      orderBy: { savedAt: "desc" },
      include: { auction: { select: { name: true, code: true } } },
    }),
    prisma.researchLog.findMany({
      where:   { userId, ...savedAtFilter },
      orderBy: { savedAt: "desc" },
    }),
    prisma.idleLog.findMany({
      where:   { userId, ...idleAtFilter },
      orderBy: { idleStartedAt: "desc" },
      include: { auction: { select: { name: true, code: true } } },
    }),
  ])

  // Need the user name even if no logs in range — fetch one unfiltered log
  const anyLog = await prisma.catalogueTimingLog.findFirst({ where: { userId } })
  if (!anyLog) notFound()
  const userName = anyLog.userName

  // ── Research summary ──
  const totalResearchMs = researchLogs.reduce((s, r) => s + r.durationMs, 0)

  // ── Range label for display ──
  const rangeLabel = isCustomRange
    ? `${fromParam ? format(new Date(fromParam), "d MMM yyyy") : "All history"} – ${toParam ? format(new Date(toParam), "d MMM yyyy") : "today"}`
    : RANGES.find(r => r.key === activeRange)?.label ?? "All time"

  // ── Split by method ──
  const wizardLogs    = logs.filter(l => l.method === "WIZARD")
  const photoOnlyLogs = logs.filter(l => l.method === "PHOTO_ONLY")

  // ── Overall speed ──
  const allDurations = logs.map(l => l.durationMs)
  const overallAvg   = avg(allDurations)
  const fastest      = allDurations.length ? Math.min(...allDurations) : 0
  const slowest      = allDurations.length ? Math.max(...allDurations) : 0

  // ── Today stats (derived from range-filtered logs; shows correctly when range includes today) ──
  const todayLogs       = logs.filter(l => l.savedAt >= todayStart)
  const lotsToday       = todayLogs.length
  const activeTimeToday = todayLogs.reduce((s, l) => s + l.durationMs, 0)
  const todayIdleLogs   = idleLogs.filter(l => l.idleStartedAt >= todayStart)

  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 7); weekStart.setHours(0, 0, 0, 0)
  const lotsThisWeek = logs.filter(l => l.savedAt >= weekStart).length

  // ── Daily average (completed days only — today excluded as it's partial) ──
  const todayStr         = format(new Date(), "yyyy-MM-dd")
  const completedDayLogs = logs.filter(l => format(l.savedAt, "yyyy-MM-dd") !== todayStr)
  const completedDays    = new Set(completedDayLogs.map(l => format(l.savedAt, "yyyy-MM-dd")))
  const dailyAvg         = completedDays.size > 0
    ? Math.round(completedDayLogs.length / completedDays.size)
    : lotsToday

  // ── Key Points ──
  const kpLogs = wizardLogs.filter(l => l.keyPointsMs && l.keyPointsMs > 0)
  const kpAvg  = kpLogs.length ? avg(kpLogs.map(l => l.keyPointsMs!)) : 0
  const kpFast = kpLogs.length ? Math.min(...kpLogs.map(l => l.keyPointsMs!)) : 0
  const kpSlow = kpLogs.length ? Math.max(...kpLogs.map(l => l.keyPointsMs!)) : 0
  const kpPct  = wizardLogs.length && kpAvg > 0 ? Math.round((kpAvg / avg(wizardLogs.map(l => l.durationMs))) * 100) : 0

  // ── Per-auction ──
  const auctionMap = new Map<string, { name: string; code: string; count: number; durations: number[] }>()
  for (const log of logs) {
    if (!auctionMap.has(log.auctionId)) {
      auctionMap.set(log.auctionId, { name: log.auction.name, code: log.auction.code, count: 0, durations: [] })
    }
    const e = auctionMap.get(log.auctionId)!
    e.count++; e.durations.push(log.durationMs)
  }
  const auctionStats = [...auctionMap.values()]
    .map(a => ({ ...a, avgMs: avg(a.durations) }))
    .sort((a, b) => b.count - a.count)

  // ── Daily breakdown: cataloguing vs idle per day ──
  const MAX_IDLE_MS = 10 * 60 * 60 * 1000
  const dayMap = new Map<string, { date: string; lots: number; cataloguingMs: number; idleMs: number }>()

  for (const log of logs) {
    const day = format(log.savedAt, "yyyy-MM-dd")
    if (!dayMap.has(day)) dayMap.set(day, { date: day, lots: 0, cataloguingMs: 0, idleMs: 0 })
    const e = dayMap.get(day)!
    e.lots++
    e.cataloguingMs += log.durationMs
  }
  for (const log of idleLogs) {
    if (log.idleDurationMs > MAX_IDLE_MS) continue
    const day = format(log.idleStartedAt, "yyyy-MM-dd")
    if (!dayMap.has(day)) dayMap.set(day, { date: day, lots: 0, cataloguingMs: 0, idleMs: 0 })
    dayMap.get(day)!.idleMs += log.idleDurationMs
  }
  const dayStats: DayStats[] = [...dayMap.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([, v]) => v)

  // ── Total active vs idle for range ──
  const totalCatMs  = logs.reduce((s, l) => s + l.durationMs, 0)
  const totalIdleMs = idleLogs.filter(l => l.idleDurationMs <= MAX_IDLE_MS).reduce((s, l) => s + l.idleDurationMs, 0)
  const totalTrackedMs  = totalCatMs + totalIdleMs
  const overallActivePct = totalTrackedMs > 0 ? Math.round((totalCatMs / totalTrackedMs) * 100) : null
  const overallIdlePct   = overallActivePct !== null ? 100 - overallActivePct : null

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">

      {/* Back + header */}
      <div>
        <Link
          href="/tools/reports"
          className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 flex items-center gap-1 mb-4 transition-colors"
        >
          ← Back to All Cataloguers
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-white">{userName}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Individual cataloguing performance report
              {" · "}
              <span className="font-medium text-gray-600 dark:text-gray-300">
                {isCustomRange ? rangeLabel : (
                  <>
                    {rangeLabel}
                    {since && ` (${format(since, "d MMM yyyy")} – ${until ? format(until, "d MMM yyyy") : "today"})`}
                  </>
                )}
              </span>
            </p>
          </div>

          {/* Time frame filter */}
          <div className="flex flex-col gap-2 items-end">
            <div className="flex flex-wrap gap-1.5">
              {RANGES.map(r => (
                <Link
                  key={r.key}
                  href={`/tools/reports/${encodeURIComponent(userId)}?range=${r.key}`}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                    !isCustomRange && activeRange === r.key
                      ? "bg-[#2AB4A6] text-white border-[#2AB4A6]"
                      : "bg-white dark:bg-[#1C1C1E] text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500 hover:text-gray-900 dark:hover:text-white"
                  }`}
                >
                  {r.label}
                </Link>
              ))}
            </div>
            {/* Custom date range picker */}
            <CustomRangePicker userId={userId} currentFrom={fromParam ?? ""} currentTo={toParam ?? ""} />
          </div>
        </div>
      </div>

      {/* Today's productivity — always shown regardless of range filter */}
      <TodayProductivityCard
        activeMs={activeTimeToday}
        lotsCount={lotsToday}
        idleSessions={todayIdleLogs.map(l => ({
          reason:      l.reason,
          durationMs:  l.idleDurationMs,
          toteNumbers: l.toteNumbers,
          notes:       l.notes,
          startedAt:   l.idleStartedAt.toISOString(),
        }))}
      />

      {/* Today's timeline — visual 9am–5pm activity map */}
      <TodayTimeline
        lots={todayLogs.map(l => ({
          savedAt:    l.savedAt.toISOString(),
          durationMs: l.durationMs,
          method:     l.method,
          lotId:      l.lotId ?? null,
        }))}
        idleSessions={todayIdleLogs.map(l => ({
          startedAt:   l.idleStartedAt.toISOString(),
          durationMs:  l.idleDurationMs,
          reason:      l.reason,
          toteNumbers: l.toteNumbers,
          notes:       l.notes,
        }))}
      />

      {/* No data in range */}
      {logs.length === 0 && idleLogs.length === 0 && (
        <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-12 text-center">
          <p className="text-lg font-semibold text-gray-600 dark:text-gray-300 mb-1">No lots in this period</p>
          <p className="text-sm text-gray-500">Try selecting a wider time range.</p>
        </div>
      )}

      {(logs.length > 0 || idleLogs.length > 0) && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: "Lots in Range",  value: logs.length.toLocaleString(),                   sub: rangeLabel,                       colour: "text-gray-900 dark:text-white" },
              { label: "Avg Time / Lot", value: fmtDuration(overallAvg),                        sub: "all methods",                    colour: "text-gray-900 dark:text-white" },
              { label: "Daily Average",  value: dailyAvg.toLocaleString(),                       sub: completedDays.size > 0 ? `${completedDays.size} full day${completedDays.size === 1 ? "" : "s"}` : "today only", colour: "text-gray-900 dark:text-white" },
              { label: "Lots Today",     value: lotsToday.toLocaleString(),                      sub: format(new Date(), "d MMM yyyy"), colour: "text-gray-900 dark:text-white" },
              { label: "This Week",      value: lotsThisWeek.toLocaleString(),                   sub: "last 7 days",                    colour: "text-gray-900 dark:text-white" },
              { label: "Research Time",  value: totalResearchMs ? fmtDuration(totalResearchMs) : "—",
                                         sub: `${researchLogs.length} session${researchLogs.length !== 1 ? "s" : ""}`, colour: "text-amber-500" },
            ].map(card => (
              <div key={card.label} className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-5">
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">{card.label}</p>
                <p className={`text-3xl font-bold ${card.colour}`}>{card.value}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{card.sub}</p>
              </div>
            ))}
          </div>

          {/* Active vs Idle overview for the range */}
          {totalTrackedMs > 0 && overallActivePct !== null && overallIdlePct !== null && (
            <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-5">
              <h2 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
                Cataloguing vs Idle — {rangeLabel}
              </h2>
              <div className="space-y-3">
                <div className="flex rounded-full overflow-hidden h-6 bg-gray-100 dark:bg-gray-800">
                  {overallActivePct > 0 && (
                    <div className="h-full bg-emerald-500 flex items-center justify-center transition-all" style={{ width: `${overallActivePct}%` }}>
                      {overallActivePct > 8 && <span className="text-white text-xs font-bold">{overallActivePct}%</span>}
                    </div>
                  )}
                  {overallIdlePct > 0 && (
                    <div className="h-full bg-orange-400 flex items-center justify-center transition-all" style={{ width: `${overallIdlePct}%` }}>
                      {overallIdlePct > 8 && <span className="text-white text-xs font-bold">{overallIdlePct}%</span>}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-6 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded-full bg-emerald-500 shrink-0" />
                    <span className="font-mono font-bold text-emerald-600">{fmtDuration(totalCatMs)}</span>
                    <span className="text-gray-400 text-xs">cataloguing ({overallActivePct}%)</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded-full bg-orange-400 shrink-0" />
                    <span className="font-mono font-bold text-orange-500">{fmtDuration(totalIdleMs)}</span>
                    <span className="text-gray-400 text-xs">idle ({overallIdlePct}%)</span>
                  </span>
                  <span className="ml-auto text-xs font-semibold">
                    {overallActivePct >= overallIdlePct
                      ? <span className="text-emerald-500">{overallActivePct - overallIdlePct}% more time cataloguing than idle</span>
                      : <span className="text-orange-400">{overallIdlePct - overallActivePct}% more time idle than cataloguing</span>
                    }
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Daily breakdown: cataloguing vs idle per day */}
          <DailyComparisonTable days={dayStats} />

          {logs.length > 0 && (
            <>
              {/* Method breakdown + speed stats */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-5">
                  <h2 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Method Breakdown</h2>
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between mb-1">
                        <span className="text-sm font-semibold text-blue-400">Wizard</span>
                        <span className="text-sm font-bold text-white">{wizardLogs.length} lots</span>
                      </div>
                      <PctBar pct={logs.length ? (wizardLogs.length / logs.length) * 100 : 0} colour="#3b82f6" />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Avg {fmtDuration(wizardLogs.length ? avg(wizardLogs.map(l => l.durationMs)) : 0)}</p>
                    </div>
                    <div>
                      <div className="flex justify-between mb-1">
                        <span className="text-sm font-semibold text-purple-400">Photo Only</span>
                        <span className="text-sm font-bold text-white">{photoOnlyLogs.length} lots</span>
                      </div>
                      <PctBar pct={logs.length ? (photoOnlyLogs.length / logs.length) * 100 : 0} colour="#a855f7" />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Avg {fmtDuration(photoOnlyLogs.length ? avg(photoOnlyLogs.map(l => l.durationMs)) : 0)}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-5">
                  <h2 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Speed Stats</h2>
                  <div className="space-y-3">
                    {[
                      { label: "Average", value: fmtDuration(overallAvg), colour: "text-white" },
                      { label: "Fastest", value: fmtDuration(fastest),    colour: "text-green-400" },
                      { label: "Slowest", value: fmtDuration(slowest),    colour: "text-red-400"   },
                    ].map(row => (
                      <div key={row.label} className="flex justify-between items-center py-1 border-b border-gray-200 dark:border-gray-800 last:border-0">
                        <span className="text-sm text-gray-600 dark:text-gray-500">{row.label}</span>
                        <span className={`font-mono font-bold text-sm ${row.colour}`}>{row.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Key Points */}
              <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-5">
                <h2 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
                  Step 3 — Key Points &nbsp;
                  <span className="font-normal normal-case text-gray-500">
                    (wizard only · {kpLogs.length} of {wizardLogs.length} lots tracked)
                  </span>
                </h2>
                {kpLogs.length === 0 ? (
                  <p className="text-sm text-gray-500">No key points data in this period.</p>
                ) : (
                  <div className="grid sm:grid-cols-3 gap-6">
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Average time on Key Points</p>
                      <p className="text-2xl font-bold text-white font-mono">{fmtDuration(kpAvg)}</p>
                      {kpPct > 0 && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{kpPct}% of total wizard time</p>}
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Fastest</p>
                      <p className="text-2xl font-bold text-green-400 font-mono">{fmtDuration(kpFast)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Slowest</p>
                      <p className="text-2xl font-bold text-red-400 font-mono">{fmtDuration(kpSlow)}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Per-auction */}
              {auctionStats.length > 0 && (
                <div>
                  <h2 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">By Auction</h2>
                  <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          <th className="text-left px-5 py-3">Auction</th>
                          <th className="text-right px-5 py-3">Lots</th>
                          <th className="text-right px-5 py-3">Avg Time</th>
                          <th className="text-right px-5 py-3">Fastest</th>
                          <th className="text-right px-5 py-3">Slowest</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800">
                        {auctionStats.map(a => (
                          <tr key={a.code} className="hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors">
                            <td className="px-5 py-3">
                              <span className="font-mono font-semibold text-white mr-2">{a.code}</span>
                              <span className="text-gray-500 dark:text-gray-400">{a.name}</span>
                            </td>
                            <td className="px-5 py-3 text-right font-bold text-white">{a.count}</td>
                            <td className="px-5 py-3 text-right font-mono text-gray-600 dark:text-gray-300">{fmtDuration(a.avgMs)}</td>
                            <td className="px-5 py-3 text-right font-mono text-green-400">{fmtDuration(Math.min(...a.durations))}</td>
                            <td className="px-5 py-3 text-right font-mono text-red-400">{fmtDuration(Math.max(...a.durations))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* All lots log — collapsible + date-filterable */}
              <CollapsibleLotsTable
                logs={logs.map(l => ({
                  id:          l.id,
                  savedAt:     l.savedAt.toISOString(),
                  auctionCode: l.auction.code,
                  lotId:       l.lotId ?? null,
                  method:      l.method,
                  keyPointsMs: l.keyPointsMs,
                  durationMs:  l.durationMs,
                }))}
              />
            </>
          )}

          {/* Idle time log — collapsible + date-filterable */}
          <CollapsibleIdleTable
            logs={idleLogs.map(l => ({
              id:             l.id,
              idleStartedAt:  l.idleStartedAt.toISOString(),
              idleDurationMs: l.idleDurationMs,
              reason:         l.reason,
              toteNumbers:    l.toteNumbers,
              notes:          l.notes,
              auctionCode:    l.auction.code,
              auctionName:    l.auction.name,
            }))}
          />
        </>
      )}
    </div>
  )
}
