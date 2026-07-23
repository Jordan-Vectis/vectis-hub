import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getEffectiveSession } from "@/lib/impersonation"
import { hasAppAccess } from "@/lib/apps"
import { buildLotMap, minOf, maxOf, ukDayKey, ukDayStartUtc, computeLotBreakdowns } from "@/lib/cataloguing-reports"
import { DEFAULT_REASONS, UNALLOCATED_REASON } from "@/lib/idle-timer-config"
import {
  buildSummaryPdf, buildIndividualsPdf,
  type PersonPdfReport, type PdfReasonMeta, type SummaryRow, type SummaryTeam, type PdfDayRow, type PdfAwayReason, type PdfAuctionStat,
} from "@/lib/reports-pdf"
import { subDays, subMonths, startOfDay, format } from "date-fns"

export const dynamic = "force-dynamic"
export const maxDuration = 60
export const runtime = "nodejs"

// GET /api/reports/pdf?summary=1&range=<key>     → team summary (one page, league table)
// GET /api/reports/pdf?range=<key>               → every cataloguer, one clean page each
// GET /api/reports/pdf?userId=<id>&range=<key>   → single cataloguer, one clean page
// GET /api/reports/pdf?userId=<id>&from=&to=     → custom range
//
// Clean, manager-friendly PDFs. The per-figure maths mirrors the on-screen
// reports (orphan-log exclusion, day exclusions, timed-only averages, rolling
// 7-day "this week") so the numbers can't drift. Server-side pdf-lib.

const RANGE_LABELS: Record<string, string> = {
  "today": "Today",
  "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days",
  "6m": "Last 6 months", "1y": "Last year", "all": "All time",
}

function rangeStart(key: string): Date | null {
  const now = new Date()
  switch (key) {
    case "today": return ukDayStartUtc(now, 0)
    case "7d":  return startOfDay(subDays(now, 7))
    case "30d": return startOfDay(subDays(now, 30))
    case "90d": return startOfDay(subDays(now, 90))
    case "6m":  return startOfDay(subMonths(now, 6))
    case "1y":  return startOfDay(subMonths(now, 12))
    case "all": return null
    default:    return startOfDay(subDays(now, 30))
  }
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length)
}

const MAX_IDLE_MS = 10 * 60 * 60 * 1000 // 10 hours — longer is a device left open, not real time away
const UK_TZ = "Europe/London"
const fDayLbl = new Intl.DateTimeFormat("en-GB", { timeZone: UK_TZ, weekday: "short", day: "numeric", month: "short", year: "numeric" }) // Mon 6 Jul 2026

export async function GET(req: NextRequest) {
  try {
    const session = await getEffectiveSession()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const dbUser = await prisma.user.findUnique({
      where:  { id: session.user.id },
      select: { role: true, allowedApps: true },
    })
    if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "REPORTS")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const sp          = req.nextUrl.searchParams
    const summaryMode = sp.get("summary") === "1"
    const userIdParam = sp.get("userId") || null
    const rangeKey    = sp.get("range") || "30d"
    const fromParam   = sp.get("from")
    const toParam     = sp.get("to")

    // Resolve date bounds (same rules as the reports pages).
    const parseDay = (s: string | null): Date | null => {
      if (!s) return null
      const d = new Date(s)
      return isNaN(d.getTime()) ? null : d
    }
    const fromDate = parseDay(fromParam)
    const toDate   = parseDay(toParam)
    const isCustom = !!(fromDate || toDate)

    let since: Date | null
    let until: Date | null = null
    if (isCustom) {
      since = fromDate ? startOfDay(fromDate) : null
      until = toDate   ? new Date(toDate.getTime() + 86_399_999) : null
    } else {
      since = rangeStart(rangeKey)
    }

    const savedAtFilter = since || until ? { savedAt:       { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } } : {}
    const idleAtFilter  = since || until ? { idleStartedAt: { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } } : {}

    // Which cataloguers? One if userId given, otherwise everyone with any data
    // in range (timing, time-away, OR research — research-only people still count).
    let userIds: string[]
    if (userIdParam) {
      userIds = [userIdParam]
    } else {
      const [t, i, r] = await Promise.all([
        prisma.catalogueTimingLog.findMany({ where: savedAtFilter, select: { userId: true }, distinct: ["userId"] }),
        prisma.idleLog.findMany({ where: idleAtFilter, select: { userId: true }, distinct: ["userId"] }),
        prisma.researchLog.findMany({ where: savedAtFilter, select: { userId: true }, distinct: ["userId"] }),
      ])
      userIds = [...new Set([...t.map(x => x.userId), ...i.map(x => x.userId), ...r.map(x => x.userId)])]
    }

    const [rawLogs, idleLogs, researchLogs, users, config, excludedRows] = await Promise.all([
      prisma.catalogueTimingLog.findMany({
        where:   { userId: { in: userIds }, ...savedAtFilter },
        include: { auction: { select: { name: true, code: true } } },
        orderBy: { savedAt: "asc" },
      }),
      prisma.idleLog.findMany({
        where:   { userId: { in: userIds }, ...idleAtFilter },
        include: { auction: { select: { name: true, code: true } } },
        orderBy: { idleStartedAt: "asc" },
      }),
      prisma.researchLog.findMany({
        where:  { userId: { in: userIds }, ...savedAtFilter },
        select: { userId: true, durationMs: true },
      }),
      prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma as any).idleTimerConfig.findUnique({ where: { id: "global" } }).catch(() => null),
      // Report-only day exclusions (admin-hidden days). `.catch` keeps the export
      // alive in the window between deploy and Run Migrations, before the table
      // exists — it simply behaves as "nothing excluded" until then.
      prisma.reportExcludedDay
        .findMany({ where: { userId: { in: userIds } }, select: { userId: true, day: true } })
        .catch((): { userId: string; day: string }[] => []),
    ])

    // Reason code → friendly label + colour (live config, then defaults).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reasons: { key: string; label: string; idleColour: string }[] = (config?.reasons as any[]) ?? DEFAULT_REASONS
    const reasonMeta = new Map<string, PdfReasonMeta>()
    for (const r of DEFAULT_REASONS) reasonMeta.set(r.key, { label: r.label, idleColour: r.idleColour })
    for (const r of reasons) reasonMeta.set(r.key, { label: r.label, idleColour: r.idleColour })
    // Display-only pseudo-reason: popup time left unallocated by the split.
    reasonMeta.set(UNALLOCATED_REASON.key, { label: UNALLOCATED_REASON.label, idleColour: UNALLOCATED_REASON.idleColour })

    // Exclude orphaned timing logs (lotId that matches no lot) — same as the pages.
    const lotMap = await buildLotMap(rawLogs)
    const logs   = rawLogs.filter(l => !l.lotId || lotMap.has(l.lotId))

    // Group per user.
    const logsByUser = new Map<string, typeof logs>()
    const idleByUser = new Map<string, typeof idleLogs>()
    for (const l of logs)     { const a = logsByUser.get(l.userId); if (a) a.push(l); else logsByUser.set(l.userId, [l]) }
    for (const l of idleLogs) { const a = idleByUser.get(l.userId); if (a) a.push(l); else idleByUser.set(l.userId, [l]) }

    const researchByUser = new Map<string, { ms: number; sessions: number }>()
    for (const r of researchLogs) {
      const e = researchByUser.get(r.userId) ?? { ms: 0, sessions: 0 }
      e.ms += r.durationMs; e.sessions++
      researchByUser.set(r.userId, e)
    }

    const nameById = new Map(users.map(u => [u.id, u.name]))
    const excludedByUser = new Map<string, Set<string>>()
    for (const r of excludedRows) {
      const s = excludedByUser.get(r.userId) ?? new Set<string>()
      s.add(r.day); excludedByUser.set(r.userId, s)
    }

    const now       = new Date()
    const todayStr  = ukDayKey(now)

    const orderedIds = [...userIds].sort((a, b) =>
      (nameById.get(a) ?? "").localeCompare(nameById.get(b) ?? ""))

    const persons: PersonPdfReport[] = []
    const summaryRows: SummaryRow[]  = []
    // Team accumulators + maps for the summary header, totals row and breakdowns
    // (only populated in summary mode).
    let teamLots = 0, teamAway = 0, teamCat = 0, teamResearch = 0, teamTimedSum = 0, teamTimedCount = 0
    const teamFast: number[] = [], teamSlow: number[] = []
    const teamDaysSet = new Set<string>()
    const teamAuction = new Map<string, { code: string; name: string; count: number; sum: number; timed: number; min: number; max: number }>()
    const teamReason  = new Map<string, { count: number; totalMs: number }>()
    const teamDayMap  = new Map<string, { key: string; label: string; lots: number; catMs: number; awayMs: number }>()

    for (const uid of orderedIds) {
      const uLogs = logsByUser.get(uid) ?? []
      const uIdle = idleByUser.get(uid) ?? []
      const uName = nameById.get(uid) ?? uLogs[0]?.userName ?? uIdle[0]?.userName ?? "Cataloguer"
      const excludedDays = excludedByUser.get(uid) ?? new Set<string>()

      const incLogs = uLogs.filter(l => !excludedDays.has(ukDayKey(l.savedAt)))
      const incIdle = uIdle.filter(l => !excludedDays.has(ukDayKey(l.idleStartedAt)))

      // Breakdowns: idle inside a lot is apportioned out of "cataloguing", so the
      // split can't double-count. Built from the FULL sets (like the page), then
      // summed over the included set.
      const countedIdleFull = uIdle.filter(l => l.idleDurationMs <= MAX_IDLE_MS)
      const breakdowns = computeLotBreakdowns(uLogs, countedIdleFull)

      const lotsInRange = incLogs.length
      const timed = incLogs.filter(l => l.durationMs > 0).map(l => l.durationMs)
      const avgMs = avg(timed), fastestMs = minOf(timed), slowestMs = maxOf(timed)

      const completedDayLogs = incLogs.filter(l => ukDayKey(l.savedAt) !== todayStr)
      const completedDaysSet = new Set(completedDayLogs.map(l => ukDayKey(l.savedAt)))
      const lotsToday = incLogs.length - completedDayLogs.length
      const dailyAvg  = completedDaysSet.size > 0 ? Math.round(completedDayLogs.length / completedDaysSet.size) : lotsToday
      const activeDaysSet = new Set(incLogs.map(l => ukDayKey(l.savedAt)))   // distinct days worked in period

      const wizardLogs = incLogs.filter(l => l.method === "WIZARD")
      const photoLogs  = incLogs.filter(l => l.method === "PHOTO_ONLY")
      const wizardAvgMs = avg(wizardLogs.filter(l => l.durationMs > 0).map(l => l.durationMs))
      const photoAvgMs  = avg(photoLogs.filter(l => l.durationMs > 0).map(l => l.durationMs))

      const kpLogs   = wizardLogs.filter(l => l.keyPointsMs && l.keyPointsMs > 0)
      const kpAvgMs  = kpLogs.length ? avg(kpLogs.map(l => l.keyPointsMs!)) : 0
      const kpFastMs = minOf(kpLogs.map(l => l.keyPointsMs!))
      const kpSlowMs = maxOf(kpLogs.map(l => l.keyPointsMs!))
      const kpDurAvg = kpLogs.length ? avg(kpLogs.map(l => l.durationMs)) : 0
      const kpPct    = kpDurAvg > 0 ? Math.round((kpAvgMs / kpDurAvg) * 100) : 0

      const auctionMap = new Map<string, { code: string; name: string; count: number; durations: number[] }>()
      for (const log of incLogs) {
        let e = auctionMap.get(log.auctionId)
        if (!e) { e = { code: log.auction.code, name: log.auction.name, count: 0, durations: [] }; auctionMap.set(log.auctionId, e) }
        e.count++; e.durations.push(log.durationMs)
      }
      const auctionStats = [...auctionMap.values()]
        .map(a => { const t = a.durations.filter(d => d > 0); return { code: a.code, name: a.name, count: a.count, avgMs: avg(t), fastestMs: minOf(t), slowestMs: maxOf(t) } })
        .sort((a, b) => b.count - a.count)

      const countedIncIdle = incIdle.filter(l => l.idleDurationMs <= MAX_IDLE_MS)
      const totalCatMs  = incLogs.reduce((s, l) => s + (breakdowns.get(l.id)?.activeMs ?? l.durationMs), 0)
      const totalAwayMs = countedIncIdle.reduce((s, l) => s + l.idleDurationMs, 0)
      const totalTracked = totalCatMs + totalAwayMs
      const activePct = totalTracked > 0 ? Math.round((totalCatMs / totalTracked) * 100) : null
      const idlePct   = activePct !== null ? 100 - activePct : null

      // Time away grouped by reason.
      const reasonMap = new Map<string, { count: number; totalMs: number }>()
      for (const l of countedIncIdle) {
        const e = reasonMap.get(l.reason) ?? { count: 0, totalMs: 0 }
        e.count++; e.totalMs += l.idleDurationMs
        reasonMap.set(l.reason, e)
      }
      const awayByReason: PdfAwayReason[] = [...reasonMap.entries()].map(([reasonKey, v]) => ({ reasonKey, count: v.count, totalMs: v.totalMs }))

      // Per-day breakdown (one row per working day, earliest first).
      const dayMap = new Map<string, { key: string; label: string; lots: number; catMs: number; awayMs: number }>()
      const getDay = (ts: Date) => {
        const key = ukDayKey(ts)
        let d = dayMap.get(key)
        if (!d) { d = { key, label: fDayLbl.format(ts).replace(",", ""), lots: 0, catMs: 0, awayMs: 0 }; dayMap.set(key, d) }
        return d
      }
      for (const l of incLogs)        { const d = getDay(l.savedAt);       d.lots++; d.catMs += (breakdowns.get(l.id)?.activeMs ?? l.durationMs) }
      for (const l of countedIncIdle) { const d = getDay(l.idleStartedAt); d.awayMs += l.idleDurationMs }
      const days: PdfDayRow[] = [...dayMap.values()]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map(d => ({ label: d.label, lots: d.lots, catMs: d.catMs, awayMs: d.awayMs }))

      const research = researchByUser.get(uid) ?? { ms: 0, sessions: 0 }
      const hasData  = lotsInRange > 0 || countedIncIdle.length > 0 || research.ms > 0

      persons.push({
        userName: uName, hasData,
        lotsInRange, avgMs, fastestMs, slowestMs,
        dailyAvg, completedDays: completedDaysSet.size,
        totalCatMs, totalAwayMs, activePct, idlePct,
        wizardCount: wizardLogs.length, wizardAvgMs,
        photoCount: photoLogs.length, photoAvgMs,
        kpCount: kpLogs.length, wizardTracked: wizardLogs.length,
        kpAvgMs, kpFastMs, kpSlowMs, kpPct,
        researchMs: research.ms, researchSessions: research.sessions,
        awaySessions: countedIncIdle.length,
        auctionStats, awayByReason, days,
      })

      summaryRows.push({
        name: uName,
        lots: lotsInRange, activeDays: activeDaysSet.size, dailyAvg,
        avgMs, fastestMs, slowestMs,
        catMs: totalCatMs, awayMs: totalAwayMs, awayPct: idlePct,
        researchMs: research.ms,
      })

      // Team-wide accumulation (summary only) — header figures + breakdowns.
      if (summaryMode) {
        teamLots += lotsInRange
        teamCat  += totalCatMs
        teamAway += totalAwayMs
        teamResearch += research.ms
        teamTimedSum += timed.reduce((s, v) => s + v, 0)
        teamTimedCount += timed.length
        if (fastestMs > 0) teamFast.push(fastestMs)
        if (slowestMs > 0) teamSlow.push(slowestMs)
        for (const k of activeDaysSet) teamDaysSet.add(k)
        for (const log of incLogs) {
          let te = teamAuction.get(log.auctionId)
          if (!te) { te = { code: log.auction.code, name: log.auction.name, count: 0, sum: 0, timed: 0, min: Infinity, max: 0 }; teamAuction.set(log.auctionId, te) }
          te.count++
          if (log.durationMs > 0) { te.sum += log.durationMs; te.timed++; if (log.durationMs < te.min) te.min = log.durationMs; if (log.durationMs > te.max) te.max = log.durationMs }
          const key = ukDayKey(log.savedAt)
          let td = teamDayMap.get(key)
          if (!td) { td = { key, label: fDayLbl.format(log.savedAt).replace(",", ""), lots: 0, catMs: 0, awayMs: 0 }; teamDayMap.set(key, td) }
          td.lots++; td.catMs += (breakdowns.get(log.id)?.activeMs ?? log.durationMs)
        }
        for (const l of countedIncIdle) {
          const e = teamReason.get(l.reason) ?? { count: 0, totalMs: 0 }
          e.count++; e.totalMs += l.idleDurationMs; teamReason.set(l.reason, e)
          const key = ukDayKey(l.idleStartedAt)
          let td = teamDayMap.get(key)
          if (!td) { td = { key, label: fDayLbl.format(l.idleStartedAt).replace(",", ""), lots: 0, catMs: 0, awayMs: 0 }; teamDayMap.set(key, td) }
          td.awayMs += l.idleDurationMs
        }
      }
    }

    const rangeLabel = isCustom
      ? `${fromDate ? format(fromDate, "d MMM yyyy") : "All history"} - ${toDate ? format(toDate, "d MMM yyyy") : "today"}`
      : RANGE_LABELS[rangeKey] ?? "Last 30 days"

    let pdfBytes: Uint8Array
    let niceName: string

    if (summaryMode) {
      const rows = [...summaryRows].sort((a, b) => b.lots - a.lots || a.name.localeCompare(b.name))
      const byAuction: PdfAuctionStat[] = [...teamAuction.values()]
        .map(a => ({ code: a.code, name: a.name, count: a.count, avgMs: a.timed ? Math.round(a.sum / a.timed) : 0, fastestMs: a.timed ? a.min : 0, slowestMs: a.max }))
        .sort((a, b) => b.count - a.count)
      const byReason: PdfAwayReason[] = [...teamReason.entries()].map(([reasonKey, v]) => ({ reasonKey, count: v.count, totalMs: v.totalMs }))
      const byDay: PdfDayRow[] = [...teamDayMap.values()]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map(d => ({ label: d.label, lots: d.lots, catMs: d.catMs, awayMs: d.awayMs }))
      const team: SummaryTeam = {
        rangeLabel,
        totalLots:   teamLots,
        avgMs:       teamTimedCount > 0 ? Math.round(teamTimedSum / teamTimedCount) : 0,
        fastestMs:   minOf(teamFast),
        slowestMs:   maxOf(teamSlow),
        cataloguers: rows.length,
        activeDays:  teamDaysSet.size,
        totalCatMs:  teamCat,
        totalAwayMs: teamAway,
        researchMs:  teamResearch,
        byAuction, byReason, byDay,
      }
      pdfBytes = await buildSummaryPdf(rows, team, reasonMeta)
      niceName = `Cataloguing performance summary - ${rangeLabel}.pdf`
    } else {
      // Always render at least one section so the PDF is never a blank page.
      if (persons.length === 0) {
        persons.push({
          userName: userIdParam ? (nameById.get(userIdParam) ?? "Cataloguer") : "All cataloguers",
          hasData: false,
          lotsInRange: 0, avgMs: 0, fastestMs: 0, slowestMs: 0,
          dailyAvg: 0, completedDays: 0,
          totalCatMs: 0, totalAwayMs: 0, activePct: null, idlePct: null,
          wizardCount: 0, wizardAvgMs: 0, photoCount: 0, photoAvgMs: 0,
          kpCount: 0, wizardTracked: 0, kpAvgMs: 0, kpFastMs: 0, kpSlowMs: 0, kpPct: 0,
          researchMs: 0, researchSessions: 0, awaySessions: 0,
          auctionStats: [], awayByReason: [], days: [],
        })
      }
      pdfBytes = await buildIndividualsPdf(persons, rangeLabel, reasonMeta)
      const who = userIdParam ? (persons[0]?.userName ?? "cataloguer") : "All cataloguers"
      niceName = `Cataloguer report - ${who} - ${rangeLabel}.pdf`
    }

    // Content-Disposition header values must be Latin-1 — strip to ASCII for the
    // plain `filename`, and add a UTF-8 `filename*` for modern browsers.
    const asciiName = niceName
      .replace(/[^\x20-\x7E]/g, "-")
      .replace(/[\/\\?%*:|"<>]/g, "-")
      .replace(/-+/g, "-")
      .replace(/\s+/g, " ")
      .trim()

    return new NextResponse(new Uint8Array(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(niceName)}`,
        "Content-Length":      String(pdfBytes.length),
        "Cache-Control":       "no-store",
      },
    })
  } catch (e: any) {
    console.error("reports pdf error:", e)
    return NextResponse.json({ error: e?.message ?? "PDF generation failed" }, { status: 500 })
  }
}
