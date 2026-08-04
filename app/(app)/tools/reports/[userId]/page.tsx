import { prisma } from "@/lib/prisma"
import { getEffectiveSession } from "@/lib/impersonation"
import { hasAppAccess } from "@/lib/apps"
import { redirect, notFound } from "next/navigation"
import { format, subDays, subMonths, startOfDay } from "date-fns"
import Link from "next/link"
import {
  CollapsibleLotsTable,
  CollapsibleIdleTable,
  CollapsibleActiveVsIdleTable,
  TodayProductivityCard,
  TodayTimeline,
  DailyComparisonTable,
  DailyLotsBarChart,
  CustomRangePicker,
  type DayStats,
} from "../../../admin/cataloguing-reports/[userId]/collapsible-sections"
import { buildLotMap, lotRef, minOf, maxOf, ukDayKey, ukDayStartUtc, computeLotBreakdowns } from "@/lib/cataloguing-reports"
import { splitIdleByWorkingDay } from "@/lib/idle-gaps"
import { groupIdleOccasions } from "@/lib/idle-timer-config"

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
  { key: "today", label: "Today" },
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
    case "today": return ukDayStartUtc(now, 0)   // London start of today
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
  const session = await getEffectiveSession()
  if (!session) redirect("/login")
  const dbUser = await prisma.user.findUnique({
    where:  { id: session.user.id },
    select: { role: true, allowedApps: true },
  })
  if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "REPORTS")) redirect("/hub")
  const isAdmin = dbUser?.role === "ADMIN"   // only admins can exclude/restore days

  const { userId }                       = await params
  const { range, from: fromParam, to: toParam } = await searchParams
  const activeRange: RangeKey            = (RANGES.find(r => r.key === range)?.key) ?? "30d"

  // Parse the custom range defensively — a malformed ?from / ?to (typo, stale
  // bookmark, bot) must not reach new Date()/format() and crash the page.
  const parseDay = (s?: string): Date | null => {
    if (!s) return null
    const d = new Date(s)
    return isNaN(d.getTime()) ? null : d
  }
  const fromDate = parseDay(fromParam)
  const toDate   = parseDay(toParam)
  const isCustomRange = !!(fromDate || toDate)

  // Resolve date bounds
  let since: Date | null
  let until: Date | null = null

  if (isCustomRange) {
    since = fromDate ? startOfDay(fromDate) : null
    until = toDate   ? new Date(toDate.getTime() + 86_399_999) : null   // end of that day
  } else {
    since = rangeStart(activeRange)
  }

  // Shared date filter builders
  const savedAtFilter  = since || until ? { savedAt:        { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } } : {}
  const idleAtFilter   = since || until ? { idleStartedAt:  { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } } : {}

  // Today bounds in UK time (server runs UTC; the business is UK-based) — for the
  // always-visible productivity card and the timeline.
  const now        = new Date()
  const todayStart = ukDayStartUtc(now, 0)

  const [rawLogs, researchLogs, idleLogs, excludedDayRows] = await Promise.all([
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
    // Days an admin has hidden from THIS cataloguer's report (report-only — the
    // logs above are untouched). Fetched unfiltered by range: a "YYYY-MM-DD" key
    // is cheap and lets any range honour the exclusion. The `.catch` keeps the
    // page alive in the window between deploy and Run Migrations, before the
    // table exists — it simply behaves as "nothing excluded" until then.
    prisma.reportExcludedDay
      .findMany({ where: { userId }, select: { day: true } })
      .catch((): { day: string }[] => []),
  ])
  const excludedDays = new Set(excludedDayRows.map(r => r.day))

  // Resolve the display name even when this person has no timing logs. The
  // overview list unions timing-log AND research-log users, so a research-only
  // cataloguer appears there but has zero CatalogueTimingLog rows — keying the
  // name (and the 404) off a timing log wrongly 404'd them when clicked. Take the
  // name from the User record, falling back to any log's denormalised copy. Only
  // 404 on a genuinely unknown user id (a stale/bad URL), never on "no lots in
  // this range" — the page already has empty-state cards for that.
  const userRow  = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
  const userName = userRow?.name ?? rawLogs[0]?.userName ?? researchLogs[0]?.userName ?? idleLogs[0]?.userName
  if (!userName) notFound()

  // Resolve each log's lotId to the real lot, then EXCLUDE orphaned logs (a lotId
  // that matches no lot — phantom "deleted lot" rows) so they never count or
  // show. Logs with no lotId, or whose lot still exists (even in another
  // auction), are kept.
  const lotMap = await buildLotMap(rawLogs)
  const logs = rawLogs.filter(l => !l.lotId || lotMap.has(l.lotId))

  // ── Report-only day exclusions ──
  // `logs` / `idleLogs` remain the FULL set (used to build the Daily Breakdown
  // table so an excluded day still shows there, greyed, with a Restore button).
  // Every headline stat, chart and detail table below is built from the INCLUDED
  // set instead, so an excluded day drops out of the average, totals and splits
  // everywhere without deleting anything.
  const incLogs = logs.filter(l => !excludedDays.has(ukDayKey(l.savedAt)))
  const incIdle = idleLogs.filter(l => !excludedDays.has(ukDayKey(l.idleStartedAt)))

  // An idle session is stored as a wall-clock start + a WORKING-hours duration, so
  // a gap that ran past 17:00 and resumed the next morning would otherwise dump its
  // whole duration on the start day with an impossible "17:34" end. Split each one
  // into its per-working-day pieces (8m on the day it ended, 34m the next morning)
  // so every day gets its real slice and the from–to times make sense. Same-day
  // gaps yield a single, unchanged segment; segment ms always sum to the original.
  type IdleSeg = {
    key: string; startedAt: Date; durationMs: number; dayKey: string
    reason: string; toteNumbers: string | null; notes: string | null
    auction: { code: string; name: string }
  }
  const splitIdle = (l: {
    id: string; idleStartedAt: Date; idleDurationMs: number; reason: string
    toteNumbers: string | null; notes: string | null; auction: { code: string; name: string }
  }): IdleSeg[] =>
    splitIdleByWorkingDay(l.idleStartedAt.getTime(), l.idleDurationMs).map((seg, i) => ({
      key: `${l.id}-${i}`, startedAt: new Date(seg.startMs), durationMs: seg.ms,
      dayKey: ukDayKey(new Date(seg.startMs)),
      reason: l.reason, toteNumbers: l.toteNumbers, notes: l.notes, auction: l.auction,
    }))
  const incIdleSegs = idleLogs.flatMap(splitIdle).filter(s => !excludedDays.has(s.dayKey))

  // ── Research summary ──
  const totalResearchMs = researchLogs.reduce((s, r) => s + r.durationMs, 0)

  // ── Range label for display ──
  const rangeLabel = isCustomRange
    ? `${fromDate ? format(fromDate, "d MMM yyyy") : "All history"} – ${toDate ? format(toDate, "d MMM yyyy") : "today"}`
    : RANGES.find(r => r.key === activeRange)?.label ?? "All time"

  // ── Split by method ──
  const wizardLogs    = incLogs.filter(l => l.method === "WIZARD")
  const photoOnlyLogs = incLogs.filter(l => l.method === "PHOTO_ONLY")

  // ── Overall speed ──
  // Speed stats ignore untimed saves (durationMs 0 — e.g. a phone save where the
  // scan timer never started). Those rows still COUNT as lots elsewhere; they
  // simply carry no time, so including them would report a fastest lot of 0s.
  const timedDurations = incLogs.filter(l => l.durationMs > 0).map(l => l.durationMs)
  const overallAvg   = avg(timedDurations)
  const fastest      = minOf(timedDurations)
  const slowest      = maxOf(timedDurations)

  // Idle that happened INSIDE a lot is already part of that lot's durationMs, so
  // counting the full duration as "cataloguing" AND the idle row separately
  // double-counts it. Every figure on this page uses the ACTIVE part of a lot —
  // see the daily breakdown and the range split below, which share this map.
  const MAX_IDLE_MS = 10 * 60 * 60 * 1000
  const countedIdle = idleLogs.filter(l => l.idleDurationMs <= MAX_IDLE_MS)
  const breakdowns  = computeLotBreakdowns(logs, countedIdle)

  // ── Today stats (derived from range-filtered logs; shows correctly when range includes today) ──
  const todayLogs       = incLogs.filter(l => l.savedAt >= todayStart)
  const lotsToday       = todayLogs.length
  // ⚠ ACTIVE time, not raw durationMs. Today's Productivity adds this to the
  // time-away total, so a raw sum counted every mid-lot break twice — that is
  // how the card managed to report 11h 37m of an 8-hour day and still call it
  // "100% of expected time accounted for" (the % is capped at 100, so the
  // overrun showed up as a confident green tick instead of an impossible
  // figure). Same rule as everywhere else on this page.
  const activeTimeToday = todayLogs.reduce((s, l) => s + (breakdowns.get(l.id)?.activeMs ?? l.durationMs), 0)
  const todayIdleSegs   = incIdleSegs.filter(s => s.startedAt >= todayStart)

  // ── Today's breaks, grouped the way they actually happened ──────────────────
  // One answer to the activity popup writes one IdleLog row PER REASON, tiled
  // back-to-back from the start of the gap. That tiling is a storage convenience:
  // the cataloguer says WHAT they were doing and FOR HOW LONG, never in which
  // order — so a per-reason start time is invented, and listing the rows
  // separately reads as several breaks when it was one.
  //
  // Regroup them into the real break (groupIdleOccasions — the same helper the
  // team Activity report uses), then split THAT by working day so a break which
  // began before 9am still shows its morning slice. Only the break carries a
  // time; the reasons inside it carry durations only.
  const todayBreaks = groupIdleOccasions(incIdle).flatMap(occ => {
    const slices = splitIdleByWorkingDay(occ.startedAt.getTime(), occ.totalMs)
    return slices.map(seg => ({
      startedAt:  new Date(seg.startMs).toISOString(),
      endedAt:    new Date(seg.endMs).toISOString(),
      durationMs: seg.ms,
      dayKey:     ukDayKey(new Date(seg.startMs)),
      // True when this is only part of the break — the rest fell on another
      // working day. The reason durations then describe the WHOLE break, so the
      // card shows them without times and says so rather than inventing a share.
      partial:    slices.length > 1,
      wholeMs:    occ.totalMs,
      realStart:  occ.startedAt.toISOString(),
      reasons:    occ.rows.map(r => ({
        reason:      r.reason,
        durationMs:  r.idleDurationMs,
        toteNumbers: r.toteNumbers,
        notes:       r.notes,
      })),
    }))
  }).filter(b => !excludedDays.has(b.dayKey) && new Date(b.startedAt) >= todayStart)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))

  const weekStart = ukDayStartUtc(now, 7)
  const lotsThisWeek = incLogs.filter(l => l.savedAt >= weekStart).length

  // ── Daily average (completed days only — today excluded as it's partial) ──
  const todayStr         = ukDayKey(now)
  const completedDayLogs = incLogs.filter(l => ukDayKey(l.savedAt) !== todayStr)
  const completedDays    = new Set(completedDayLogs.map(l => ukDayKey(l.savedAt)))
  const dailyAvg         = completedDays.size > 0
    ? Math.round(completedDayLogs.length / completedDays.size)
    : lotsToday

  // ── Key Points ──
  const kpLogs = wizardLogs.filter(l => l.keyPointsMs && l.keyPointsMs > 0)
  const kpAvg  = kpLogs.length ? avg(kpLogs.map(l => l.keyPointsMs!)) : 0
  const kpFast = minOf(kpLogs.map(l => l.keyPointsMs!))
  const kpSlow = maxOf(kpLogs.map(l => l.keyPointsMs!))
  // Compare key-points time against the total time OF THE SAME lots (kpLogs), not
  // the average over all wizard lots — otherwise this isn't a real percentage.
  const kpDurAvg = kpLogs.length ? avg(kpLogs.map(l => l.durationMs)) : 0
  const kpPct  = kpDurAvg > 0 ? Math.round((kpAvg / kpDurAvg) * 100) : 0

  // ── Per-auction ──
  const auctionMap = new Map<string, { name: string; code: string; count: number; durations: number[] }>()
  for (const log of incLogs) {
    if (!auctionMap.has(log.auctionId)) {
      auctionMap.set(log.auctionId, { name: log.auction.name, code: log.auction.code, count: 0, durations: [] })
    }
    const e = auctionMap.get(log.auctionId)!
    e.count++; e.durations.push(log.durationMs)
  }
  const auctionStats = [...auctionMap.values()]
    .map(a => {
      const timed = a.durations.filter(d => d > 0)   // untimed saves don't skew avg/fastest
      return { ...a, avgMs: avg(timed), fastestMs: minOf(timed), slowestMs: maxOf(timed) }
    })
    .sort((a, b) => b.count - a.count)

  // ── Daily breakdown: cataloguing vs idle per day ──
  // Cataloguing is the ACTIVE part of each lot (see `breakdowns` above); the idle
  // is still counted once, in the idle column.
  const dayMap = new Map<string, { date: string; lots: number; cataloguingMs: number; idleMs: number }>()

  for (const log of logs) {
    const day = ukDayKey(log.savedAt)
    if (!dayMap.has(day)) dayMap.set(day, { date: day, lots: 0, cataloguingMs: 0, idleMs: 0 })
    const e = dayMap.get(day)!
    e.lots++
    e.cataloguingMs += breakdowns.get(log.id)?.activeMs ?? log.durationMs
  }
  for (const log of idleLogs) {
    if (log.idleDurationMs > MAX_IDLE_MS) continue
    // Bucket each working-day slice on the day it actually fell (see splitIdle).
    for (const seg of splitIdle(log)) {
      if (!dayMap.has(seg.dayKey)) dayMap.set(seg.dayKey, { date: seg.dayKey, lots: 0, cataloguingMs: 0, idleMs: 0 })
      dayMap.get(seg.dayKey)!.idleMs += seg.durationMs
    }
  }
  const dayStats: DayStats[] = [...dayMap.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, v]) => ({ ...v, excluded: excludedDays.has(date) }))
  // Chart shows only the days that count toward the report.
  const includedDayStats = dayStats.filter(d => !d.excluded)

  // ── Total active vs idle for range ──
  // Same rule as the daily breakdown above — cataloguing is the ACTIVE part of
  // each lot, so this split and that bar can't disagree with each other. Built
  // from the INCLUDED set so excluded days drop out of the split too.
  const countedIncIdle = incIdle.filter(l => l.idleDurationMs <= MAX_IDLE_MS)
  const totalCatMs  = incLogs.reduce((s, l) => s + (breakdowns.get(l.id)?.activeMs ?? l.durationMs), 0)
  const totalIdleMs = countedIncIdle.reduce((s, l) => s + l.idleDurationMs, 0)
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
            {/* Export this cataloguer's clean one-page report (stats, speed, by-auction, away, per-day) */}
            <a
              href={`/api/reports/pdf?userId=${encodeURIComponent(userId)}&${
                isCustomRange
                  ? `from=${encodeURIComponent(fromParam ?? "")}&to=${encodeURIComponent(toParam ?? "")}`
                  : `range=${activeRange}`
              }`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#2AB4A6] text-[#2AB4A6] hover:bg-[#2AB4A6] hover:text-white transition-colors"
            >
              ⬇ Export PDF
            </a>
          </div>
        </div>
      </div>

      {/* Today's productivity — always shown regardless of range filter */}
      <TodayProductivityCard
        activeMs={activeTimeToday}
        lotsCount={lotsToday}
        idleSessions={todayIdleSegs.map(s => ({
          reason:      s.reason,
          durationMs:  s.durationMs,
          toteNumbers: s.toteNumbers,
          notes:       s.notes,
          startedAt:   s.startedAt.toISOString(),
        }))}
        breaks={todayBreaks}
      />

      {/* Today's timeline — visual 9am–5pm activity map */}
      <TodayTimeline
        lots={todayLogs.map(l => ({
          savedAt:    l.savedAt.toISOString(),
          durationMs: l.durationMs,
          method:     l.method,
          lotId:      l.lotId ?? null,
        }))}
        idleSessions={todayIdleSegs.map(s => ({
          startedAt:   s.startedAt.toISOString(),
          durationMs:  s.durationMs,
          reason:      s.reason,
          toteNumbers: s.toteNumbers,
          notes:       s.notes,
        }))}
        breaks={todayBreaks}
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
                Cataloguing vs Away — {rangeLabel}
                <span className="block normal-case font-normal text-gray-400 dark:text-gray-500 mt-0.5">Share of tracked cataloguing + time-away (excludes unaccounted time — see the Daily Breakdown below for the full workday split)</span>
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
                    <span className="text-gray-400 text-xs">away ({overallIdlePct}%)</span>
                  </span>
                  <span className="ml-auto text-xs font-semibold">
                    {overallActivePct >= overallIdlePct
                      ? <span className="text-emerald-500">{overallActivePct - overallIdlePct}% more time cataloguing than away</span>
                      : <span className="text-orange-400">{overallIdlePct - overallActivePct}% more time away than cataloguing</span>
                    }
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Daily lots bar chart */}
          <DailyLotsBarChart days={includedDayStats} />

          {/* Daily breakdown: cataloguing vs idle per day */}
          <DailyComparisonTable days={dayStats} userId={userId} canExclude={isAdmin} />

          {incLogs.length > 0 && (
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
                      <PctBar pct={incLogs.length ? (wizardLogs.length / incLogs.length) * 100 : 0} colour="#3b82f6" />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Avg {fmtDuration(avg(wizardLogs.filter(l => l.durationMs > 0).map(l => l.durationMs)))}</p>
                    </div>
                    <div>
                      <div className="flex justify-between mb-1">
                        <span className="text-sm font-semibold text-purple-400">Photo Only</span>
                        <span className="text-sm font-bold text-white">{photoOnlyLogs.length} lots</span>
                      </div>
                      <PctBar pct={incLogs.length ? (photoOnlyLogs.length / incLogs.length) * 100 : 0} colour="#a855f7" />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Avg {fmtDuration(avg(photoOnlyLogs.filter(l => l.durationMs > 0).map(l => l.durationMs)))}</p>
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
                            <td className="px-5 py-3 text-right font-mono text-green-400">{fmtDuration(a.fastestMs)}</td>
                            <td className="px-5 py-3 text-right font-mono text-red-400">{fmtDuration(a.slowestMs)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* All lots log — collapsible + date-filterable */}
              <CollapsibleLotsTable
                logs={incLogs.map(l => ({
                  id:          l.id,
                  savedAt:     l.savedAt.toISOString(),
                  auctionCode: l.auction.code,
                  ...lotRef(lotMap, l),
                  method:      l.method,
                  keyPointsMs: l.keyPointsMs,
                  durationMs:  l.durationMs,
                }))}
              />
            </>
          )}

          {/* Idle time log — collapsible + date-filterable */}
          <CollapsibleIdleTable
            logs={incIdleSegs.map(s => ({
              id:             s.key,
              idleStartedAt:  s.startedAt.toISOString(),
              idleDurationMs: s.durationMs,
              reason:         s.reason,
              toteNumbers:    s.toteNumbers,
              notes:          s.notes,
              auctionCode:    s.auction.code,
              auctionName:    s.auction.name,
            }))}
          />

          {/* Per-lot split of "how long it took" into cataloguing vs idle */}
          <CollapsibleActiveVsIdleTable
            logs={incLogs.map(l => ({
              id:          l.id,
              savedAt:     l.savedAt.toISOString(),
              auctionCode: l.auction.code,
              ...lotRef(lotMap, l),
              method:      l.method,
              keyPointsMs: l.keyPointsMs,
              durationMs:  l.durationMs,
              idleMs:      breakdowns.get(l.id)?.idleMs   ?? 0,
              activeMs:    breakdowns.get(l.id)?.activeMs ?? l.durationMs,
            }))}
          />
        </>
      )}
    </div>
  )
}
