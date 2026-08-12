import { prisma } from "@/lib/prisma"
import { getEffectiveSession } from "@/lib/impersonation"
import { hasAppAccess } from "@/lib/apps"
import { redirect } from "next/navigation"
import Link from "next/link"
import { format } from "date-fns"
import { computeIdleReport, resolveRange, fmtDuration, RANGES } from "@/lib/idle-report"
import { ReasonBreakdownChart, IdleTrendChart, IdleByHourChart, IdleByWeekdayChart } from "./idle-report-charts"

export const dynamic = "force-dynamic"
export const metadata = { title: "Cataloguer Activity" }

function hourLabel(h: number): string { return h === 12 ? "12pm" : h < 12 ? `${h}am` : `${h - 12}pm` }

export default async function IdleReportPage({ searchParams }: { searchParams: Promise<{ range?: string; lunch?: string }> }) {
  const session = await getEffectiveSession()
  if (!session) redirect("/login")
  const dbUser = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, allowedApps: true } })
  if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "REPORTS")) redirect("/hub")
  const isAdmin = dbUser?.role === "ADMIN"

  const { range, lunch } = await searchParams
  const activeRange = resolveRange(range)
  // Opt-IN: the report shows everything unless asked otherwise, so a link someone shares
  // cannot quietly hide a chunk of the day from whoever opens it.
  const excludeLunch = lunch === "off"

  const data = await computeIdleReport(activeRange, isAdmin, excludeLunch)

  const labelOf  = (key: string) => data.reasonMeta.get(key)?.label ?? key
  const colourOf = (key: string) => data.reasonMeta.get(key)?.idleColour ?? "#9ca3af"
  const iconOf   = (key: string) => data.reasonMeta.get(key)?.icon ?? "•"

  const { reasonRows, topReason, userRows, longest, tamperIncidents } = data
  const { totalIdleMs, idlePerPersonDay, idlePctOfDay, avgSessionMs, personDays, hasData } = data

  const reasonChart  = reasonRows.map(r => ({ name: r.label, ms: r.ms, colour: r.colour }))
  const trendChart   = data.trend.map(({ day, ms }) => ({ day: format(new Date(day + "T12:00:00"), "d MMM"), ms }))
  const hourChart    = data.byHour.map(({ hour, ms }) => ({ label: hourLabel(hour), ms }))
  const weekdayChart = data.byWeekday.map(({ day, ms }) => ({ label: day, ms }))

  const activeLabel = RANGES.find(r => r.key === activeRange)?.label ?? "All time"

  const cards = [
    { label: "Total Time Away", value: fmtDuration(totalIdleMs), sub: activeLabel, accent: "border-l-orange-500" },
    { label: "Away Share of Day", value: idlePctOfDay != null ? `${idlePctOfDay}%` : "—", sub: "of the 9–5 working day", accent: "border-l-amber-500" },
    { label: "Away per Person / Day", value: fmtDuration(idlePerPersonDay), sub: `over ${personDays} day${personDays === 1 ? "" : "s"} worked`, accent: "border-l-blue-500" },
    { label: "Most Common Reason", value: topReason ? `${topReason.icon} ${topReason.label}` : "—", sub: topReason ? `${fmtDuration(topReason.ms)} · ${Math.round(topReason.share)}% of time away` : "no reasons logged", accent: "border-l-purple-500" },
  ]
  // Time left unassigned when a break was split between activities. Only shown
  // when there is some — it can't be the "most common reason", so it gets its
  // own figure, and it never counts as accounting for a gap.
  if (data.unallocatedMs > 0) {
    cards.push({
      label: "Unallocated",
      value: fmtDuration(data.unallocatedMs),
      sub: `${Math.round((data.unallocatedMs / totalIdleMs) * 100)}% of time away — not assigned to an activity`,
      accent: "border-l-gray-400",
    })
  }

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
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                How much time the team spends away from cataloguing, and what they&apos;re doing. Only counts Monday–Friday, 9am–5pm.
                {excludeLunch && <span className="text-[#1a8a80] font-semibold"> Lunch breaks are excluded from every figure below.</span>}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-gray-100 dark:bg-[#141416] border border-gray-200 dark:border-gray-800 rounded-lg p-1">
                {RANGES.map(r => (
                  <Link key={r.key} href={`/tools/reports/activity?range=${r.key}${excludeLunch ? "&lunch=off" : ""}`}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${activeRange === r.key ? "bg-[#2AB4A6] text-white" : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"}`}>
                    {r.label}
                  </Link>
                ))}
              </div>
              {/* A link, not a real checkbox — this page is server-rendered from the URL, so the
                  state lives there and the view can be shared or bookmarked as seen. */}
              <Link href={`/tools/reports/activity?range=${activeRange}${excludeLunch ? "" : "&lunch=off"}`}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap ${
                  excludeLunch
                    ? "bg-[#2AB4A6]/10 border-[#2AB4A6] text-[#1a8a80]"
                    : "bg-gray-100 dark:bg-[#141416] border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                }`}
                title="Lunch is normally the biggest slice of time away — hide it to see where the rest of the time goes">
                <span aria-hidden className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                  excludeLunch ? "bg-[#2AB4A6] border-[#2AB4A6] text-white" : "border-gray-400 dark:border-gray-600"
                }`}>{excludeLunch ? "✓" : ""}</span>
                Exclude lunch breaks
              </Link>
              {hasData && (
                <a href={`/api/reports/idle/pdf?range=${activeRange}${excludeLunch ? "&lunch=off" : ""}`}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 text-white transition-colors whitespace-nowrap"
                  title="Download this report as a PDF">
                  <span aria-hidden>⬇</span> Export PDF
                </a>
              )}
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
              <div className={`grid grid-cols-2 gap-4 ${cards.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
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
                      {userRows.map((r, i) => (
                        <tr key={r.userId} className="hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors group">
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2.5">
                              <span className="text-xs text-gray-400 dark:text-gray-600 w-4 text-right tabular-nums">{i + 1}</span>
                              <Link href={`/tools/reports/${encodeURIComponent(r.userId)}`} className="font-semibold text-gray-900 dark:text-white group-hover:text-[#2AB4A6] transition-colors">{r.userName}</Link>
                              {r.timerOff && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400">timer off</span>}
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-right font-bold text-orange-500 tabular-nums">{fmtDuration(r.totalMs)}</td>
                          <td className="px-5 py-3.5 text-right text-gray-600 dark:text-gray-300 tabular-nums">{fmtDuration(r.perDayMs)}</td>
                          <td className="px-5 py-3.5 text-right tabular-nums">
                            {r.pctDay != null ? <span className={r.pctDay >= 25 ? "text-red-500 font-semibold" : r.pctDay >= 15 ? "text-amber-500" : "text-gray-600 dark:text-gray-300"}>{r.pctDay}%</span> : <span className="text-gray-400">—</span>}
                          </td>
                          <td className="px-5 py-3.5 text-right text-gray-500 dark:text-gray-400 tabular-nums">{r.sessions || "—"}</td>
                          <td className="px-5 py-3.5">
                            {r.topReasonKey ? <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ background: colourOf(r.topReasonKey) + "22", color: colourOf(r.topReasonKey) }}><span>{iconOf(r.topReasonKey)}</span>{labelOf(r.topReasonKey)}</span> : <span className="text-gray-400 dark:text-gray-600">—</span>}
                          </td>
                          <td className="px-5 py-3.5 text-right tabular-nums">
                            {r.unexplainedMs > 0 ? <span className="text-red-600 dark:text-red-400 font-medium">{fmtDuration(r.unexplainedMs)} <span className="text-gray-400 font-normal">({r.unexplainedCount})</span></span> : <span className="text-gray-400 dark:text-gray-600">—</span>}
                          </td>
                          <td className="px-5 py-3.5 text-gray-500 dark:text-gray-400 text-xs">
                            {r.busiestDay ? <>{format(new Date(r.busiestDay + "T12:00:00"), "EEE d MMM")} <span className="text-gray-400">· {fmtDuration(r.busiestMs)}</span></> : "—"}
                          </td>
                        </tr>
                      ))}
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
