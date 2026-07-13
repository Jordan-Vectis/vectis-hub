import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getEffectiveSession } from "@/lib/impersonation"
import { hasAppAccess } from "@/lib/apps"
import { buildLotMap, lotRef } from "@/lib/cataloguing-reports"
import { buildReportsWorkbook, type PersonReport } from "@/lib/reports-export"
import { DEFAULT_REASONS } from "@/lib/idle-timer-config"
import { subDays, subMonths, startOfDay, format } from "date-fns"

export const dynamic = "force-dynamic"

// GET /api/reports/export?userId=<id>&range=<key>   (single cataloguer)
// GET /api/reports/export?range=<key>               (all cataloguers)
// GET /api/reports/export?userId=<id>&from=&to=     (custom range)
//
// Mirrors the date filtering + orphan-log exclusion of the reports pages, then
// builds a "grouped per day" .xlsx (idle timers + lots, exact timings) — one
// sheet per cataloguer.

const RANGE_LABELS: Record<string, string> = {
  "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days",
  "6m": "Last 6 months", "1y": "Last year", "all": "All time",
}

function rangeStart(key: string): Date | null {
  const now = new Date()
  switch (key) {
    case "7d":  return startOfDay(subDays(now, 7))
    case "30d": return startOfDay(subDays(now, 30))
    case "90d": return startOfDay(subDays(now, 90))
    case "6m":  return startOfDay(subMonths(now, 6))
    case "1y":  return startOfDay(subMonths(now, 12))
    case "all": return null
    default:    return startOfDay(subDays(now, 30))
  }
}

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

    const [rawLogs, idleLogs, config] = await Promise.all([
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
      (prisma as any).idleTimerConfig.findUnique({ where: { id: "global" } }).catch(() => null),
    ])

    // Reason code → friendly label (live config, then defaults, then the raw code).
    const reasons: { key: string; label: string }[] = (config?.reasons as any[]) ?? DEFAULT_REASONS
    const reasonLabel = (code: string) =>
      reasons.find(r => r.key === code)?.label ?? DEFAULT_REASONS.find(r => r.key === code)?.label ?? code

    // Exclude orphaned timing logs (lotId that matches no lot) — same as the pages.
    const lotMap = await buildLotMap(rawLogs)
    const logs   = rawLogs.filter(l => !l.lotId || lotMap.has(l.lotId))

    // Group into per-person reports.
    const persons = new Map<string, PersonReport>()
    const ensure = (userId: string, userName: string): PersonReport => {
      let p = persons.get(userId)
      if (!p) { p = { userName, entries: [] }; persons.set(userId, p) }
      return p
    }
    for (const l of logs) {
      const ref = lotRef(lotMap, l)
      ensure(l.userId, l.userName).entries.push({
        kind: "LOT",
        ts:          l.savedAt.toISOString(),
        durationMs:  l.durationMs,
        method:      l.method,
        barcode:     ref.barcode,
        keyPointsMs: l.keyPointsMs ?? null,
        auctionCode: l.auction.code,
        auctionName: l.auction.name,
      })
    }
    for (const il of idleLogs) {
      ensure(il.userId, il.userName).entries.push({
        kind: "IDLE",
        ts:          il.idleStartedAt.toISOString(),
        durationMs:  il.idleDurationMs,
        reasonLabel: reasonLabel(il.reason),
        toteNumbers: il.toteNumbers,
        notes:       il.notes,
        auctionCode: il.auction.code,
        auctionName: il.auction.name,
      })
    }

    const personList = [...persons.values()].sort((a, b) => a.userName.localeCompare(b.userName))

    const rangeLabel = isCustom
      ? `${fromDate ? format(fromDate, "d MMM yyyy") : "All history"} – ${toDate ? format(toDate, "d MMM yyyy") : "today"}`
      : RANGE_LABELS[rangeKey] ?? "Last 30 days"

    const buf = buildReportsWorkbook(personList, rangeLabel)

    const who   = userIdParam ? (personList[0]?.userName ?? "cataloguer") : "All cataloguers"
    const fname = `Idle & lots — ${who} — ${rangeLabel}.xlsx`.replace(/[\/\\?%*:|"<>]/g, "-")

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fname}"`,
        "Cache-Control":       "no-store",
      },
    })
  } catch (e: any) {
    console.error("reports export error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
