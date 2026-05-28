import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { format } from "date-fns"
import Link from "next/link"

export const dynamic = "force-dynamic"

export const metadata = { title: "Cataloguing Reports" }

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function CataloguingReportsPage() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/hub")

  const [logs, researchLogs] = await Promise.all([
    prisma.catalogueTimingLog.findMany({
      orderBy: { savedAt: "desc" },
      include: { auction: { select: { name: true, code: true } } },
    }),
    prisma.researchLog.findMany({ orderBy: { savedAt: "desc" } }),
  ])

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

  if (logs.length === 0 && researchLogs.length === 0) {
    return (
      <div className="p-8 max-w-3xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Cataloguing Reports</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Time-per-lot reports across all cataloguers.</p>
        </div>
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-10 text-center text-gray-400 dark:text-gray-500">
          <p className="text-lg font-semibold mb-1">No data yet</p>
          <p className="text-sm">Timing is captured automatically once lots are added via the wizard or photo-only flow.</p>
        </div>
      </div>
    )
  }

  // ── Overall stats ──
  const allDurations = logs.map(l => l.durationMs)
  const overallAvg   = avg(allDurations)
  const overallMin   = Math.min(...allDurations)
  const overallMax   = Math.max(...allDurations)

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

  const userStats = [...userMap.entries()].map(([userId, data]) => {
    const allUserLogs = [...data.wizardLogs, ...data.photoOnlyLogs]
    const durations   = allUserLogs.map(l => l.durationMs)
    const research    = researchByUser.get(userId)
    return {
      userId,
      name:            data.name,
      totalLots:       allUserLogs.length,
      wizardLots:      data.wizardLogs.length,
      photoOnlyLots:   data.photoOnlyLogs.length,
      avgMs:           avg(durations),
      fastestMs:       Math.min(...durations),
      slowestMs:       Math.max(...durations),
      wizardAvgMs:     data.wizardLogs.length   ? avg(data.wizardLogs.map(l => l.durationMs))    : 0,
      photoAvgMs:      data.photoOnlyLogs.length ? avg(data.photoOnlyLogs.map(l => l.durationMs)) : 0,
      researchMs:      research?.totalMs  ?? 0,
      researchSessions: research?.sessions ?? 0,
    }
  }).sort((a, b) => b.totalLots - a.totalLots)

  // ── Per-auction stats (top 10) ──
  const auctionMap = new Map<string, { name: string; code: string; logs: typeof logs }>()
  for (const log of logs) {
    if (!auctionMap.has(log.auctionId)) {
      auctionMap.set(log.auctionId, { name: log.auction.name, code: log.auction.code, logs: [] })
    }
    auctionMap.get(log.auctionId)!.logs.push(log)
  }
  const auctionStats = [...auctionMap.entries()]
    .map(([id, data]) => ({
      id, name: data.name, code: data.code,
      total: data.logs.length,
      avgMs: avg(data.logs.map(l => l.durationMs)),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)

  const recentLogs = logs.slice(0, 50)

  return (
    <div className="p-8 max-w-6xl space-y-10">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Cataloguing Reports</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Time tracked per lot — from barcode entry to save. Admin only.</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Lots Logged",  value: logs.length.toLocaleString(), sub: "all time" },
          { label: "Average Time / Lot", value: fmtDuration(overallAvg),      sub: "all cataloguers" },
          { label: "Fastest Lot",        value: fmtDuration(overallMin),       sub: "record" },
          { label: "Lots Today",         value: lotsToday.toLocaleString(),    sub: format(new Date(), "d MMM yyyy") },
        ].map(card => (
          <div key={card.label} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
            <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">{card.label}</p>
            <p className="text-3xl font-bold text-slate-800 dark:text-gray-100">{card.value}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Per-cataloguer table */}
      <div>
        <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-3">Per Cataloguer</h2>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 bg-gray-50 dark:bg-gray-800 text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                <th className="text-left px-5 py-3">Cataloguer</th>
                <th className="text-right px-5 py-3">Total Lots</th>
                <th className="text-right px-5 py-3">Wizard</th>
                <th className="text-right px-5 py-3">Photo Only</th>
                <th className="text-right px-5 py-3">Avg Time</th>
                <th className="text-right px-5 py-3">Wizard Avg</th>
                <th className="text-right px-5 py-3">Photo Avg</th>
                <th className="text-right px-5 py-3">Fastest</th>
                <th className="text-right px-5 py-3">Slowest</th>
                <th className="text-right px-5 py-3">Research Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {userStats.map(u => (
                <tr key={u.userId} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <td className="px-5 py-3">
                    <Link href={`/admin/cataloguing-reports/${encodeURIComponent(u.userId)}`}
                      className="font-semibold text-slate-700 dark:text-gray-200 hover:text-blue-600 hover:underline transition-colors">
                      {u.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-right font-bold text-slate-700 dark:text-gray-200">{u.totalLots}</td>
                  <td className="px-5 py-3 text-right text-gray-500 dark:text-gray-400">{u.wizardLots}</td>
                  <td className="px-5 py-3 text-right text-gray-500 dark:text-gray-400">{u.photoOnlyLots}</td>
                  <td className="px-5 py-3 text-right font-mono text-gray-700 dark:text-gray-300">{fmtDuration(u.avgMs)}</td>
                  <td className="px-5 py-3 text-right font-mono text-gray-500 dark:text-gray-400">{u.wizardLots    ? fmtDuration(u.wizardAvgMs) : "—"}</td>
                  <td className="px-5 py-3 text-right font-mono text-gray-500 dark:text-gray-400">{u.photoOnlyLots ? fmtDuration(u.photoAvgMs)  : "—"}</td>
                  <td className="px-5 py-3 text-right font-mono text-green-600 font-semibold">{fmtDuration(u.fastestMs)}</td>
                  <td className="px-5 py-3 text-right font-mono text-red-500">{fmtDuration(u.slowestMs)}</td>
                  <td className="px-5 py-3 text-right font-mono text-amber-600">
                    {u.researchMs ? fmtDuration(u.researchMs) : "—"}
                    {u.researchSessions > 0 && (
                      <span className="text-gray-400 text-xs ml-1">({u.researchSessions})</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-auction breakdown */}
      {auctionStats.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-3">By Auction (Top 10)</h2>
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 bg-gray-50 dark:bg-gray-800 text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                  <th className="text-left px-5 py-3">Auction</th>
                  <th className="text-right px-5 py-3">Lots Logged</th>
                  <th className="text-right px-5 py-3">Avg Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {auctionStats.map(a => (
                  <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="px-5 py-3">
                      <span className="font-mono font-semibold text-slate-700 dark:text-gray-200 mr-2">{a.code}</span>
                      <span className="text-gray-500 dark:text-gray-400">{a.name}</span>
                    </td>
                    <td className="px-5 py-3 text-right font-bold text-gray-700 dark:text-gray-200">{a.total}</td>
                    <td className="px-5 py-3 text-right font-mono text-gray-600 dark:text-gray-300">{fmtDuration(a.avgMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Research time summary */}
      {researchLogs.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-3">Research Time (last 30 sessions)</h2>
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 bg-gray-50 dark:bg-gray-800 text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                  <th className="text-left px-5 py-3">Date / Time</th>
                  <th className="text-left px-5 py-3">Cataloguer</th>
                  <th className="text-right px-5 py-3">Active Research Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {researchLogs.slice(0, 30).map(r => (
                  <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="px-5 py-3 text-gray-400 dark:text-gray-500 text-xs whitespace-nowrap font-mono">
                      {format(r.savedAt, "dd/MM/yyyy HH:mm")}
                    </td>
                    <td className="px-5 py-3 font-medium text-gray-700 dark:text-gray-300">{r.userName}</td>
                    <td className="px-5 py-3 text-right font-mono font-bold text-amber-600">
                      {fmtDuration(r.durationMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent activity */}
      <div>
        <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-3">Recent Activity (last 50 lots)</h2>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 bg-gray-50 dark:bg-gray-800 text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                <th className="text-left px-5 py-3">Date / Time</th>
                <th className="text-left px-5 py-3">Cataloguer</th>
                <th className="text-left px-5 py-3">Auction</th>
                <th className="text-left px-5 py-3">Lot Barcode</th>
                <th className="text-left px-5 py-3">Method</th>
                <th className="text-right px-5 py-3">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {recentLogs.map(log => (
                <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <td className="px-5 py-3 text-gray-400 dark:text-gray-500 text-xs whitespace-nowrap font-mono">
                    {format(log.savedAt, "dd/MM/yyyy HH:mm:ss")}
                  </td>
                  <td className="px-5 py-3 font-medium text-gray-700 dark:text-gray-300">{log.userName}</td>
                  <td className="px-5 py-3 font-mono text-slate-600 dark:text-gray-300">{log.auction.code}</td>
                  <td className="px-5 py-3 font-mono text-gray-500 dark:text-gray-400 text-xs">{log.lotId ? log.lotId.slice(-6) : "—"}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                      log.method === "WIZARD"
                        ? "bg-blue-50 text-blue-600 border border-blue-100"
                        : "bg-purple-50 text-purple-600 border border-purple-100"
                    }`}>
                      {log.method === "WIZARD" ? "Wizard" : "Photo Only"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right font-mono font-bold text-gray-700 dark:text-gray-200">
                    {fmtDuration(log.durationMs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  )
}
