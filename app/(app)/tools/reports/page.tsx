import { prisma } from "@/lib/prisma"
import { getEffectiveSession } from "@/lib/impersonation"
import { hasAppAccess } from "@/lib/apps"
import { redirect } from "next/navigation"
import { format, subDays, subMonths, startOfDay } from "date-fns"
import Link from "next/link"
import CataloguingReportsCharts, { type UserChartData, type MonthBucket } from "./charts"
import CleanupOrphanLogsButton from "./cleanup-orphan-logs-button"
import { minOf, ukDayKey, ukDayStartUtc } from "@/lib/cataloguing-reports"

export const dynamic = "force-dynamic"

export const metadata = { title: "Reports" }

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

export default async function ReportsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}) {
  const session = await getEffectiveSession()
  if (!session) redirect("/login")
  const dbUser = await prisma.user.findUnique({
    where:  { id: session.user.id },
    select: { role: true, allowedApps: true },
  })
  if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "REPORTS")) redirect("/hub")
  const isAdmin = dbUser?.role === "ADMIN"

  const { range } = await searchParams
  const activeRange: RangeKey = (RANGES.find(r => r.key === range)?.key) ?? "30d"
  const since = rangeStart(activeRange)                 // null = all time

  // UK day bounds (server runs UTC; the business is UK-based)
  const now        = new Date()
  const todayStart = ukDayStartUtc(now, 0)
  const weekStart  = ukDayStartUtc(now, 7)
  const twelveMonthsAgo = startOfDay(subMonths(now, 12))

  // All aggregation happens in SQL — never load the whole log table into memory,
  // and never spread a data-sized array into Math.min/Math.max. Orphaned logs
  // (a lotId matching no lot — the phantom "deleted lot" rows) are excluded in
  // the WHERE clause; logs with a null lotId are kept. Day/month buckets use the
  // London calendar so work around midnight lands on the right day.
  type UserRow = {
    userId: string; userName: string
    total: number; wizard: number; photo: number
    sumMs: number; minMs: number; maxMs: number
    activeDays: number; completedLots: number; completedDays: number
    thisWeek: number; today: number
  }
  const [timingRows, researchRows, monthRows] = await Promise.all([
    prisma.$queryRaw<UserRow[]>`
      SELECT t."userId"                                                                AS "userId",
             MAX(t."userName")                                                         AS "userName",
             COUNT(*)::int                                                             AS "total",
             COUNT(*) FILTER (WHERE t.method = 'WIZARD')::int                          AS "wizard",
             COUNT(*) FILTER (WHERE t.method <> 'WIZARD')::int                         AS "photo",
             COALESCE(SUM(t."durationMs"), 0)::float8                                  AS "sumMs",
             COALESCE(MIN(t."durationMs"), 0)::int                                     AS "minMs",
             COALESCE(MAX(t."durationMs"), 0)::int                                     AS "maxMs",
             COUNT(DISTINCT (t."savedAt" AT TIME ZONE 'Europe/London')::date)::int     AS "activeDays",
             COUNT(*) FILTER (WHERE (t."savedAt" AT TIME ZONE 'Europe/London')::date
                                  <> (now() AT TIME ZONE 'Europe/London')::date)::int  AS "completedLots",
             COUNT(DISTINCT (t."savedAt" AT TIME ZONE 'Europe/London')::date)
               FILTER (WHERE (t."savedAt" AT TIME ZONE 'Europe/London')::date
                          <> (now() AT TIME ZONE 'Europe/London')::date)::int          AS "completedDays",
             COUNT(*) FILTER (WHERE t."savedAt" >= ${weekStart})::int                  AS "thisWeek",
             COUNT(*) FILTER (WHERE t."savedAt" >= ${todayStart})::int                 AS "today"
      FROM "CatalogueTimingLog" t
      WHERE (t."lotId" IS NULL OR EXISTS (SELECT 1 FROM "CatalogueLot" l WHERE l."id" = t."lotId"))
        AND (${since}::timestamptz IS NULL OR t."savedAt" >= ${since})
      GROUP BY t."userId"`,
    prisma.$queryRaw<{ userId: string; userName: string; totalMs: number; sessions: number }[]>`
      SELECT r."userId"                          AS "userId",
             MAX(r."userName")                   AS "userName",
             COALESCE(SUM(r."durationMs"), 0)::float8 AS "totalMs",
             COUNT(*)::int                       AS "sessions"
      FROM "ResearchLog" r
      WHERE (${since}::timestamptz IS NULL OR r."savedAt" >= ${since})
      GROUP BY r."userId"`,
    prisma.$queryRaw<{ y: number; m: number; n: number }[]>`
      SELECT EXTRACT(YEAR  FROM (t."savedAt" AT TIME ZONE 'Europe/London'))::int AS "y",
             EXTRACT(MONTH FROM (t."savedAt" AT TIME ZONE 'Europe/London'))::int AS "m",
             COUNT(*)::int AS "n"
      FROM "CatalogueTimingLog" t
      WHERE t."savedAt" >= ${twelveMonthsAgo}
        AND (t."lotId" IS NULL OR EXISTS (SELECT 1 FROM "CatalogueLot" l WHERE l."id" = t."lotId"))
      GROUP BY 1, 2`,
  ])

  // ── Monthly buckets — last 12 calendar months (London), orphans excluded ──
  const bucketMap = new Map<string, number>()
  for (const r of monthRows) bucketMap.set(`${r.y}-${r.m}`, Number(r.n))
  const monthlyBuckets: MonthBucket[] = []
  for (let i = 11; i >= 0; i--) {
    const d   = subMonths(now, i)
    const ymd = ukDayKey(d)                       // "yyyy-MM-dd" in London
    const y   = Number(ymd.slice(0, 4))
    const m   = Number(ymd.slice(5, 7))
    monthlyBuckets.push({ month: format(d, "MMM yy"), total: bucketMap.get(`${y}-${m}`) ?? 0 })
  }

  // ── Research per user ──
  const researchByUser = new Map(researchRows.map(r => [r.userId, { name: r.userName, totalMs: Number(r.totalMs), sessions: Number(r.sessions) }]))

  // ── Per-user stats (research-only users still appear) ──
  const userStats = [...(() => {
    const ids = new Set<string>([...timingRows.map(r => r.userId), ...researchRows.map(r => r.userId)])
    const timById = new Map(timingRows.map(r => [r.userId, r]))
    return [...ids].map(userId => {
      const t = timById.get(userId)
      const research = researchByUser.get(userId)
      const dailyAvg = t
        ? (t.completedDays > 0 ? Math.round(t.completedLots / t.completedDays) : t.today)
        : 0
      return {
        userId,
        name:             t?.userName ?? research?.name ?? "Unknown",
        totalLots:        t?.total ?? 0,
        wizardLots:       t?.wizard ?? 0,
        photoOnlyLots:    t?.photo ?? 0,
        avgMs:            t && t.total > 0 ? Math.round(t.sumMs / t.total) : 0,
        fastestMs:        t?.minMs ?? 0,
        slowestMs:        t?.maxMs ?? 0,
        dailyAvg,
        completedDays:    t?.completedDays ?? 0,
        lotsThisWeek:     t?.thisWeek ?? 0,
        lotsToday:        t?.today ?? 0,
        researchMs:       research?.totalMs  ?? 0,
        researchSessions: research?.sessions ?? 0,
      }
    })
  })()].sort((a, b) => b.totalLots - a.totalLots)

  // ── Overall stats ──
  const totalLots  = userStats.reduce((s, u) => s + u.totalLots, 0)
  const sumAllMs   = timingRows.reduce((s, r) => s + r.sumMs, 0)
  const overallAvg = totalLots > 0 ? Math.round(sumAllMs / totalLots) : 0
  const overallMin = minOf(timingRows.filter(r => r.total > 0).map(r => r.minMs))
  const lotsToday  = userStats.reduce((s, u) => s + u.lotsToday, 0)
  const hasData    = userStats.length > 0

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

  const activeLabel = RANGES.find(r => r.key === activeRange)?.label ?? "All time"

  return (
    <div className="min-h-full flex flex-col">

      {/* ── Page header ── */}
      <div className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1C1C1E] px-6 py-5">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-3">
            <Link href="/hub" className="hover:text-gray-700 dark:hover:text-gray-300 transition-colors">Hub</Link>
            <span>/</span>
            <span className="text-gray-700 dark:text-gray-300">Reports</span>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">Reports</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Cataloguing performance — speed, output and team comparisons.</p>
              {isAdmin && <div className="mt-3"><CleanupOrphanLogsButton /></div>}
            </div>
            {/* Range pills */}
            <div className="flex items-center gap-1 bg-gray-100 dark:bg-[#141416] border border-gray-200 dark:border-gray-800 rounded-lg p-1">
              {RANGES.map(r => (
                <Link
                  key={r.key}
                  href={`/tools/reports?range=${r.key}`}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                    activeRange === r.key
                      ? "bg-[#2AB4A6] text-white"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                  }`}
                >
                  {r.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 bg-gray-50 dark:bg-[#141416] px-6 py-8">
        <div className="max-w-7xl mx-auto space-y-8">

          {/* No data */}
          {!hasData && (
            <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-16 text-center">
              <p className="text-lg font-semibold text-gray-600 dark:text-gray-300 mb-1">No data for this period</p>
              <p className="text-sm text-gray-500">Try selecting a wider time range above.</p>
            </div>
          )}

          {hasData && (
            <>
              {/* ── Stat cards ── */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  {
                    label: "Total Lots",
                    value: totalLots.toLocaleString(),
                    sub:   activeLabel,
                    accent: "border-l-[#2AB4A6]",
                  },
                  {
                    label: "Avg Time / Lot",
                    value: fmtDuration(overallAvg),
                    sub:   "across all cataloguers",
                    accent: "border-l-blue-500",
                  },
                  {
                    label: "Fastest Lot",
                    value: fmtDuration(overallMin),
                    sub:   "record in range",
                    accent: "border-l-green-500",
                  },
                  {
                    label: "Lots Today",
                    value: lotsToday.toLocaleString(),
                    sub:   format(new Date(), "d MMM yyyy"),
                    accent: "border-l-amber-500",
                  },
                ].map(card => (
                  <div
                    key={card.label}
                    className={`bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 border-l-2 ${card.accent} rounded-xl px-5 py-4`}
                  >
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{card.label}</p>
                    <p className="text-3xl font-bold text-gray-900 dark:text-white tabular-nums">{card.value}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">{card.sub}</p>
                  </div>
                ))}
              </div>

              {/* ── Charts ── */}
              <CataloguingReportsCharts users={chartUsers} monthlyBuckets={monthlyBuckets} />

              {/* ── Per-cataloguer table ── */}
              {userStats.length > 0 && (
                <div>
                  <h2 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Per Cataloguer</h2>
                  <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl overflow-x-auto">
                    <table className="w-full text-sm whitespace-nowrap">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
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
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-800/60">
                        {userStats.map((u, i) => (
                          <tr key={u.userId} className="hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors group">
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-2.5">
                                <span className="text-xs text-gray-400 dark:text-gray-600 w-4 text-right tabular-nums">{i + 1}</span>
                                <Link
                                  href={`/tools/reports/${encodeURIComponent(u.userId)}`}
                                  className="font-semibold text-gray-900 dark:text-white group-hover:text-[#2AB4A6] transition-colors"
                                >
                                  {u.name}
                                </Link>
                              </div>
                            </td>
                            <td className="px-5 py-3.5 text-right font-bold text-gray-900 dark:text-white tabular-nums">{u.totalLots}</td>
                            <td className="px-5 py-3.5 text-right text-gray-600 dark:text-gray-300 tabular-nums">{u.dailyAvg}</td>
                            <td className="px-5 py-3.5 text-right text-gray-600 dark:text-gray-300 tabular-nums">{u.lotsToday}</td>
                            <td className="px-5 py-3.5 text-right text-gray-600 dark:text-gray-300 tabular-nums">{u.lotsThisWeek}</td>
                            <td className="px-5 py-3.5 text-right font-mono text-gray-600 dark:text-gray-300">{fmtDuration(u.avgMs)}</td>
                            <td className="px-5 py-3.5 text-right font-mono text-green-400">{fmtDuration(u.fastestMs)}</td>
                            <td className="px-5 py-3.5 text-right font-mono text-red-400">{fmtDuration(u.slowestMs)}</td>
                            <td className="px-5 py-3.5 text-right font-mono text-amber-400">
                              {u.researchMs ? fmtDuration(u.researchMs) : <span className="text-gray-400 dark:text-gray-700">—</span>}
                              {u.researchSessions > 0 && (
                                <span className="text-gray-500 dark:text-gray-600 text-xs ml-1">({u.researchSessions})</span>
                              )}
                            </td>
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
