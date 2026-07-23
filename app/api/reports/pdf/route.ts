import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getEffectiveSession } from "@/lib/impersonation"
import { hasAppAccess } from "@/lib/apps"
import { buildLotMap, lotRef, minOf, maxOf, ukDayKey, ukDayStartUtc, computeLotBreakdowns } from "@/lib/cataloguing-reports"
import { DEFAULT_REASONS } from "@/lib/idle-timer-config"
import { buildReportsPdf, type PersonPdfReport, type PdfLotEntry, type PdfIdleEntry, type PdfReasonMeta } from "@/lib/reports-pdf"
import { subDays, subMonths, startOfDay, format } from "date-fns"

export const dynamic = "force-dynamic"
export const maxDuration = 60
export const runtime = "nodejs"

// GET /api/reports/pdf?userId=<id>&range=<key>   (single cataloguer)
// GET /api/reports/pdf?range=<key>               (all cataloguers, one section each)
// GET /api/reports/pdf?userId=<id>&from=&to=     (custom range)
//
// The nicely-styled PDF replacement for the old .xlsx export. Mirrors the date
// filtering, orphan-log exclusion and per-figure maths of the on-screen
// individual report so the numbers can't drift. Server-side pdf-lib.

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

    // Which cataloguers? One if userId given, otherwise everyone with data in range.
    let userIds: string[]
    if (userIdParam) {
      userIds = [userIdParam]
    } else {
      const [t, i] = await Promise.all([
        prisma.catalogueTimingLog.findMany({ where: savedAtFilter, select: { userId: true }, distinct: ["userId"] }),
        prisma.idleLog.findMany({ where: idleAtFilter, select: { userId: true }, distinct: ["userId"] }),
      ])
      userIds = [...new Set([...t.map(x => x.userId), ...i.map(x => x.userId)])]
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
    const reasons: { key: string; label: string; idleColour: string }[] = (config?.reasons as any[]) ?? DEFAULT_REASONS
    const reasonMeta = new Map<string, PdfReasonMeta>()
    for (const r of DEFAULT_REASONS) reasonMeta.set(r.key, { label: r.label, idleColour: r.idleColour })
    for (const r of reasons) reasonMeta.set(r.key, { label: r.label, idleColour: r.idleColour })

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

    const now = new Date()
    const todayStr = ukDayKey(now)

    const orderedIds = [...userIds].sort((a, b) =>
      (nameById.get(a) ?? "").localeCompare(nameById.get(b) ?? ""))

    const persons: PersonPdfReport[] = []
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
      const totalIdleMs = countedIncIdle.reduce((s, l) => s + l.idleDurationMs, 0)
      const totalTracked = totalCatMs + totalIdleMs
      const activePct = totalTracked > 0 ? Math.round((totalCatMs / totalTracked) * 100) : null
      const idlePct   = activePct !== null ? 100 - activePct : null

      const lots: PdfLotEntry[] = incLogs.map(l => ({
        ts:          l.savedAt.toISOString(),
        durationMs:  l.durationMs,
        method:      l.method,
        barcode:     lotRef(lotMap, l).barcode,
        keyPointsMs: l.keyPointsMs ?? null,
        auctionCode: l.auction.code,
        auctionName: l.auction.name,
      }))
      const idle: PdfIdleEntry[] = incIdle.map(l => ({
        ts:          l.idleStartedAt.toISOString(),
        durationMs:  l.idleDurationMs,
        reasonKey:   l.reason,
        toteNumbers: l.toteNumbers,
        notes:       l.notes,
        auctionCode: l.auction.code,
        auctionName: l.auction.name,
        excluded:    l.idleDurationMs > MAX_IDLE_MS,
      }))

      const research = researchByUser.get(uid) ?? { ms: 0, sessions: 0 }

      persons.push({
        userName: uName,
        lotsInRange, avgMs, fastestMs, slowestMs,
        dailyAvg, completedDays: completedDaysSet.size,
        totalCatMs, totalIdleMs, activePct, idlePct,
        wizardCount: wizardLogs.length, wizardAvgMs,
        photoCount: photoLogs.length, photoAvgMs,
        kpCount: kpLogs.length, wizardTracked: wizardLogs.length,
        kpAvgMs, kpFastMs, kpSlowMs, kpPct,
        researchMs: research.ms, researchSessions: research.sessions,
        auctionStats, lots, idle,
      })
    }

    const rangeLabel = isCustom
      ? `${fromDate ? format(fromDate, "d MMM yyyy") : "All history"} - ${toDate ? format(toDate, "d MMM yyyy") : "today"}`
      : RANGE_LABELS[rangeKey] ?? "Last 30 days"

    // Always render at least one section so the PDF is never a blank page.
    if (persons.length === 0) {
      persons.push({
        userName: userIdParam ? (nameById.get(userIdParam) ?? "Cataloguer") : "All cataloguers",
        lotsInRange: 0, avgMs: 0, fastestMs: 0, slowestMs: 0,
        dailyAvg: 0, completedDays: 0,
        totalCatMs: 0, totalIdleMs: 0, activePct: null, idlePct: null,
        wizardCount: 0, wizardAvgMs: 0, photoCount: 0, photoAvgMs: 0,
        kpCount: 0, wizardTracked: 0, kpAvgMs: 0, kpFastMs: 0, kpSlowMs: 0, kpPct: 0,
        researchMs: 0, researchSessions: 0,
        auctionStats: [], lots: [], idle: [],
      })
    }

    const pdfBytes = await buildReportsPdf(persons, rangeLabel, reasonMeta)

    const who      = userIdParam ? (persons[0]?.userName ?? "cataloguer") : "All cataloguers"
    const niceName = `Cataloguer report - ${who} - ${rangeLabel}.pdf`
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
