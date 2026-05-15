import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import { format, subDays, subMonths, startOfDay } from "date-fns"
import Link from "next/link"
import { CollapsibleLotsTable, CollapsibleIdleTable } from "./collapsible-sections"

export const dynamic = "force-dynamic"

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
      <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
        <div className="h-2 rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, background: colour }} />
      </div>
      <span className="text-xs text-gray-500 w-8 text-right">{Math.round(pct)}%</span>
    </div>
  )
}

// ─── Time frame options ───────────────────────────────────────────────────────

const RANGES = [
  { key: "7d",   label: "Last 7 days" },
  { key: "30d",  label: "Last 30 days" },
  { key: "90d",  label: "Last 90 days" },
  { key: "6m",   label: "Last 6 months" },
  { key: "1y",   label: "Last year" },
  { key: "all",  label: "All time" },
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

export default async function CataloguingUserReportPage({
  params,
  searchParams,
}: {
  params:       Promise<{ userId: string }>
  searchParams: Promise<{ range?: string }>
}) {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/hub")

  const { userId }  = await params
  const { range }   = await searchParams
  const activeRange: RangeKey = (RANGES.find(r => r.key === range)?.key) ?? "30d"
  const since = rangeStart(activeRange)

  const [logs, researchLogs, idleLogs] = await Promise.all([
    prisma.catalogueTimingLog.findMany({
      where:   {
        userId,
        ...(since ? { savedAt: { gte: since } } : {}),
      },
      orderBy: { savedAt: "desc" },
      include: { auction: { select: { name: true, code: true } } },
    }),
    prisma.researchLog.findMany({
      where:   {
        userId,
        ...(since ? { savedAt: { gte: since } } : {}),
      },
      orderBy: { savedAt: "desc" },
    }),
    prisma.idleLog.findMany({
      where:   { userId },
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

  const rangeLabel = RANGES.find(r => r.key === activeRange)?.label ?? "All time"

  // ── Split by method ──
  const wizardLogs    = logs.filter(l => l.method === "WIZARD")
  const photoOnlyLogs = logs.filter(l => l.method === "PHOTO_ONLY")

  // ── Overall ──
  const allDurations = logs.map(l => l.durationMs)
  const overallAvg   = avg(allDurations)
  const fastest      = allDurations.length ? Math.min(...allDurations) : 0
  const slowest      = allDurations.length ? Math.max(...allDurations) : 0

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const lotsToday  = logs.filter(l => l.savedAt >= todayStart).length

  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 7); weekStart.setHours(0,0,0,0)
  const lotsThisWeek = logs.filter(l => l.savedAt >= weekStart).length

  // ── Daily average (completed days only — today excluded as it's partial) ──
  const todayStr         = format(new Date(), "yyyy-MM-dd")
  const completedDayLogs = logs.filter(l => format(l.savedAt, "yyyy-MM-dd") !== todayStr)
  const completedDays    = new Set(completedDayLogs.map(l => format(l.savedAt, "yyyy-MM-dd")))
  const dailyAvg         = completedDays.size > 0
    ? Math.round(completedDayLogs.length / completedDays.size)
    : lotsToday // fallback: only data is from today, show today's count

  // ── Key points ──
  const kpLogs  = wizardLogs.filter(l => l.keyPointsMs && l.keyPointsMs > 0)
  const kpAvg   = kpLogs.length ? avg(kpLogs.map(l => l.keyPointsMs!)) : 0
  const kpFast  = kpLogs.length ? Math.min(...kpLogs.map(l => l.keyPointsMs!)) : 0
  const kpSlow  = kpLogs.length ? Math.max(...kpLogs.map(l => l.keyPointsMs!)) : 0
  const kpPct   = wizardLogs.length && kpAvg > 0 ? Math.round((kpAvg / avg(wizardLogs.map(l => l.durationMs))) * 100) : 0

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

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="p-8 max-w-5xl space-y-8">

      {/* Back + header */}
      <div>
        <Link href="/admin/cataloguing-reports"
          className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 mb-4 transition-colors">
          ← Back to All Cataloguers
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{userName}</h1>
            <p className="text-sm text-gray-500 mt-1">
              Individual cataloguing performance report
              {since && (
                <> · <span className="font-medium text-gray-700">{rangeLabel}</span>
                  {" "}({format(since, "d MMM yyyy")} – today)
                </>
              )}
            </p>
          </div>

          {/* Time frame filter */}
          <div className="flex flex-wrap gap-1.5">
            {RANGES.map(r => (
              <Link
                key={r.key}
                href={`/admin/cataloguing-reports/${encodeURIComponent(userId)}?range=${r.key}`}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                  activeRange === r.key
                    ? "bg-slate-800 text-white border-slate-800"
                    : "bg-white text-gray-500 border-gray-200 hover:border-slate-400 hover:text-slate-700"
                }`}
              >
                {r.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* No data in range */}
      {logs.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-400">
          <p className="text-lg font-semibold mb-1">No lots in this period</p>
          <p className="text-sm">Try selecting a wider time range.</p>
        </div>
      )}

      {logs.length > 0 && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: "Lots in Range",    value: logs.length.toLocaleString(),            sub: rangeLabel,                       colour: "text-slate-800" },
              { label: "Avg Time / Lot",   value: fmtDuration(overallAvg),                 sub: "all methods",                    colour: "text-slate-800" },
              { label: "Daily Average",    value: dailyAvg.toLocaleString(),                sub: completedDays.size > 0 ? `${completedDays.size} full day${completedDays.size === 1 ? "" : "s"}` : "today only", colour: "text-slate-800" },
              { label: "Lots Today",       value: lotsToday.toLocaleString(),               sub: format(new Date(), "d MMM yyyy"), colour: "text-slate-800" },
              { label: "This Week",        value: lotsThisWeek.toLocaleString(),            sub: "last 7 days",                    colour: "text-slate-800" },
              { label: "Research Time",    value: totalResearchMs ? fmtDuration(totalResearchMs) : "—",
                                           sub: `${researchLogs.length} session${researchLogs.length !== 1 ? "s" : ""}`,         colour: "text-amber-600" },
            ].map(card => (
              <div key={card.label} className="bg-white border border-gray-200 rounded-xl p-5">
                <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">{card.label}</p>
                <p className={`text-3xl font-bold ${card.colour}`}>{card.value}</p>
                <p className="text-xs text-gray-400 mt-1">{card.sub}</p>
              </div>
            ))}
          </div>

          {/* Method breakdown + speed stats */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">Method Breakdown</h2>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-sm font-semibold text-blue-600">Wizard</span>
                    <span className="text-sm font-bold text-gray-700">{wizardLogs.length} lots</span>
                  </div>
                  <PctBar pct={logs.length ? (wizardLogs.length / logs.length) * 100 : 0} colour="#3b82f6" />
                  <p className="text-xs text-gray-400 mt-1">Avg {fmtDuration(wizardLogs.length ? avg(wizardLogs.map(l => l.durationMs)) : 0)}</p>
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-sm font-semibold text-purple-600">Photo Only</span>
                    <span className="text-sm font-bold text-gray-700">{photoOnlyLogs.length} lots</span>
                  </div>
                  <PctBar pct={logs.length ? (photoOnlyLogs.length / logs.length) * 100 : 0} colour="#a855f7" />
                  <p className="text-xs text-gray-400 mt-1">Avg {fmtDuration(photoOnlyLogs.length ? avg(photoOnlyLogs.map(l => l.durationMs)) : 0)}</p>
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">Speed Stats</h2>
              <div className="space-y-3">
                {[
                  { label: "Average", value: fmtDuration(overallAvg), colour: "text-slate-700" },
                  { label: "Fastest", value: fmtDuration(fastest),    colour: "text-green-600" },
                  { label: "Slowest", value: fmtDuration(slowest),    colour: "text-red-500"   },
                ].map(row => (
                  <div key={row.label} className="flex justify-between items-center py-1 border-b border-gray-50 last:border-0">
                    <span className="text-sm text-gray-500">{row.label}</span>
                    <span className={`font-mono font-bold text-sm ${row.colour}`}>{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Key Points */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">
              Step 3 — Key Points &nbsp;
              <span className="font-normal normal-case text-gray-400">
                (wizard only · {kpLogs.length} of {wizardLogs.length} lots tracked)
              </span>
            </h2>
            {kpLogs.length === 0 ? (
              <p className="text-sm text-gray-400">No key points data in this period.</p>
            ) : (
              <div className="grid sm:grid-cols-3 gap-6">
                <div>
                  <p className="text-xs text-gray-400 mb-1">Average time on Key Points</p>
                  <p className="text-2xl font-bold text-slate-700 font-mono">{fmtDuration(kpAvg)}</p>
                  {kpPct > 0 && <p className="text-xs text-gray-400 mt-1">{kpPct}% of total wizard time</p>}
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">Fastest</p>
                  <p className="text-2xl font-bold text-green-600 font-mono">{fmtDuration(kpFast)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">Slowest</p>
                  <p className="text-2xl font-bold text-red-500 font-mono">{fmtDuration(kpSlow)}</p>
                </div>
              </div>
            )}
          </div>

          {/* Per-auction */}
          {auctionStats.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-3">By Auction</h2>
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-400 uppercase tracking-wider">
                      <th className="text-left px-5 py-3">Auction</th>
                      <th className="text-right px-5 py-3">Lots</th>
                      <th className="text-right px-5 py-3">Avg Time</th>
                      <th className="text-right px-5 py-3">Fastest</th>
                      <th className="text-right px-5 py-3">Slowest</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {auctionStats.map(a => (
                      <tr key={a.code} className="hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3">
                          <span className="font-mono font-semibold text-slate-700 mr-2">{a.code}</span>
                          <span className="text-gray-500">{a.name}</span>
                        </td>
                        <td className="px-5 py-3 text-right font-bold text-gray-700">{a.count}</td>
                        <td className="px-5 py-3 text-right font-mono text-gray-600">{fmtDuration(a.avgMs)}</td>
                        <td className="px-5 py-3 text-right font-mono text-green-600">{fmtDuration(Math.min(...a.durations))}</td>
                        <td className="px-5 py-3 text-right font-mono text-red-500">{fmtDuration(Math.max(...a.durations))}</td>
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
              lotNumber:   l.lotNumber,
              method:      l.method,
              keyPointsMs: l.keyPointsMs,
              durationMs:  l.durationMs,
            }))}
          />

          {/* Idle time log — collapsible + date-filterable */}
          <CollapsibleIdleTable
            logs={idleLogs.map(l => ({
              id:            l.id,
              idleStartedAt: l.idleStartedAt.toISOString(),
              idleDurationMs: l.idleDurationMs,
              reason:        l.reason,
              toteNumbers:   l.toteNumbers,
              notes:         l.notes,
              auctionCode:   l.auction.code,
              auctionName:   l.auction.name,
            }))}
          />
        </>
      )}
    </div>
  )
}
