import { NextRequest } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAll, bcPage } from "@/lib/bc"
import { prisma } from "@/lib/prisma"
import { buildPackerMatcher, type MatchResult } from "@/lib/packer-match"

export const maxDuration = 300

function toDateStr(d: Date) { return d.toISOString().split("T")[0] }
function addDays(date: Date, n: number) { const d = new Date(date); d.setUTCDate(d.getUTCDate() + n); return d }

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return new Response(JSON.stringify({ error: "Unauthorised" }), { status: 401 })

  const token = await getBCToken()
  if (!token) return new Response(JSON.stringify({ error: "BC_NOT_CONNECTED" }), { status: 401 })

  const { searchParams } = req.nextUrl
  const from = searchParams.get("from") ?? ""
  const to   = searchParams.get("to")   ?? ""
  if (!from || !to) return new Response(JSON.stringify({ error: "Missing from/to" }), { status: 400 })

  const todayStr = toDateStr(new Date())

  // All dates in range
  const allDates: string[] = []
  let cur = new Date(from + "T00:00:00Z")
  const endDate = new Date(to + "T00:00:00Z")
  while (cur <= endDate) { allDates.push(toDateStr(cur)); cur = addDays(cur, 1) }

  // Check which past dates are cached
  const pastDates = allDates.filter(dt => dt < todayStr)
  const cachedDays = pastDates.length > 0
    ? await prisma.bCPackingDay.findMany({ where: { date: { in: pastDates } }, select: { date: true } })
    : []
  const cachedSet = new Set(cachedDays.map(r => r.date))

  // Dates to fetch live from BC: uncached past + today (if in range)
  const uncachedDates = allDates.filter(dt => dt >= todayStr || !cachedSet.has(dt))

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(obj: object) {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"))
      }

      // ── 1. Fetch uncached dates live from BC ────────────────────────────────
      let freshEntries: { date: string; staff: string; docNo: string; lotCount: number }[] = []

      if (uncachedDates.length > 0) {
        const uncachedFrom   = uncachedDates[0]
        const uncachedTo     = uncachedDates[uncachedDates.length - 1]
        const uncachedDateSet = new Set(uncachedDates)

        const shipments = await bcFetchAll(
          token,
          "ShipmentRequestAPI",
          `EVA_ShipmentDate ge ${uncachedFrom} and EVA_ShipmentDate le ${uncachedTo}`,
          "EVA_No,EVA_DocumentNo,EVA_ShipmentDate,EVA_Status,PTE_InternalReference"
        )
        const active = shipments.filter(
          (s: any) => s.EVA_Status !== "Cancelled" && uncachedDateSet.has(s.EVA_ShipmentDate)
        )
        const docNos = [...new Set(active.map((s: any) => s.EVA_DocumentNo).filter(Boolean))]

        const totalBatches = 1 + Math.ceil(docNos.length / 50)
        send({ type: "progress", done: 1, total: totalBatches })

        const lotByDoc: Record<string, number> = {}
        for (let i = 0; i < docNos.length; i += 50) {
          const batch  = docNos.slice(i, i + 50)
          const quoted = batch.map((v: string) => `EVA_DocumentNo eq '${v}'`).join(" or ")
          const filter = `(${quoted})`
          try {
            const chunk = await bcPage(token, "CollectionList", { $top: 500, $skip: 0, $filter: filter, $select: "EVA_DocumentNo,EVA_NoOfLines" })
            for (const r of chunk) lotByDoc[r.EVA_DocumentNo] = (lotByDoc[r.EVA_DocumentNo] ?? 0) + (Number(r.EVA_NoOfLines) || 0)
          } catch (_) {}
          try {
            const chunk = await bcPage(token, "PostedCollectionList", { $top: 500, $skip: 0, $filter: filter, $select: "EVA_DocumentNo,EVA_NoOfLines" })
            for (const r of chunk) lotByDoc[r.EVA_DocumentNo] = (lotByDoc[r.EVA_DocumentNo] ?? 0) + (Number(r.EVA_NoOfLines) || 0)
          } catch (_) {}
          send({ type: "progress", done: 2 + Math.floor(i / 50), total: totalBatches })
        }

        freshEntries = active.map((s: any) => ({
          date:     s.EVA_ShipmentDate,
          staff:    (s.PTE_InternalReference ?? "Unknown").trim() || "Unknown",
          docNo:    s.EVA_DocumentNo,
          lotCount: lotByDoc[s.EVA_DocumentNo] ?? 0,
        }))

        // ── 2. Cache newly fetched past dates ─────────────────────────────────
        const daysToCache    = uncachedDates.filter(dt => dt < todayStr)
        const daysCacheSet   = new Set(daysToCache)
        const entriesToCache = freshEntries.filter(e => daysCacheSet.has(e.date))

        if (daysToCache.length > 0) {
          await Promise.all([
            ...entriesToCache.map(e =>
              prisma.bCPackingEntry.upsert({
                where:  { date_staff_docNo: { date: e.date, staff: e.staff, docNo: e.docNo } },
                create: e,
                update: { lotCount: e.lotCount },
              })
            ),
            ...daysToCache.map(date =>
              prisma.bCPackingDay.upsert({
                where:  { date },
                create: { date },
                update: { fetchedAt: new Date() },
              })
            ),
          ])
        }
      } else {
        send({ type: "progress", done: 1, total: 1 })
      }

      // ── 3. Load cached dates from DB ────────────────────────────────────────
      const alreadyCached = pastDates.filter(dt => cachedSet.has(dt))
      const dbEntries = alreadyCached.length > 0
        ? await prisma.bCPackingEntry.findMany({ where: { date: { in: alreadyCached } } })
        : []

      // ── 4. Merge and compute stats ──────────────────────────────────────────
      const mergedRaw = [...dbEntries, ...freshEntries].sort((a, b) => b.date.localeCompare(a.date))

      // ── 4a. Fuzzy-match raw staff names to canonical packers ──────────────
      // BC's PTE_InternalReference is free-text — packers type it in and get
      // it wrong constantly. Map each variant to the closest Packer record
      // so the stats roll up correctly. Unmatched variants pass through as-is
      // and we surface them separately so the admin can either add them as
      // a new packer or correct the spelling at source.
      const packers  = await prisma.packer.findMany({
        where:  { active: true },
        select: { id: true, name: true, staffGroup: true },
      })
      const matcher  = buildPackerMatcher(packers)
      // Cache the result per raw string — each raw appears many times
      const matchCache = new Map<string, MatchResult>()
      function resolveStaff(raw: string): { canonical: string; matched: boolean } {
        let m = matchCache.get(raw)
        if (!m) { m = matcher(raw); matchCache.set(raw, m) }
        return { canonical: m.canonical ?? raw, matched: m.canonical !== null }
      }
      const merged = mergedRaw.map(r => {
        const { canonical } = resolveStaff(r.staff)
        return { ...r, staff: canonical, rawStaff: r.staff }
      })

      const staffDay: Record<string, Record<string, number>> = {}
      for (const r of merged) {
        if (!staffDay[r.staff]) staffDay[r.staff] = {}
        staffDay[r.staff][r.date] = (staffDay[r.staff][r.date] ?? 0) + 1
      }
      const dailyAvgCollections = Object.entries(staffDay)
        .map(([staff, days]) => {
          const vals = Object.values(days)
          return { staff, avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 }
        })
        .sort((a, b) => b.avg - a.avg)

      const totalCollections = Object.entries(staffDay)
        .map(([staff, days]) => ({ staff, total: Object.values(days).reduce((a, b) => a + b, 0) }))
        .sort((a, b) => b.total - a.total)

      const staffDayLots: Record<string, Record<string, number>> = {}
      for (const r of merged) {
        if (!staffDayLots[r.staff]) staffDayLots[r.staff] = {}
        staffDayLots[r.staff][r.date] = (staffDayLots[r.staff][r.date] ?? 0) + r.lotCount
      }
      const dailyAvgLots = Object.entries(staffDayLots)
        .map(([staff, days]) => {
          const vals = Object.values(days)
          return { staff, avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 }
        })
        .sort((a, b) => b.avg - a.avg)

      const lotsByStaff: Record<string, number> = {}
      for (const r of merged) lotsByStaff[r.staff] = (lotsByStaff[r.staff] ?? 0) + r.lotCount
      const totalLots = Object.entries(lotsByStaff)
        .map(([staff, total]) => ({ staff, total }))
        .sort((a, b) => b.total - a.total)

      const staffCount = new Set(merged.map(r => r.staff)).size

      // Tally unmatched raw names so admins can spot people who haven't been
      // added to the Packer table — or variants we should add as aliases.
      const unmatchedCounts: Record<string, number> = {}
      for (const [raw, m] of matchCache.entries()) {
        if (m.canonical) continue
        unmatchedCounts[raw] = (unmatchedCounts[raw] ?? 0) + 0  // ensures key exists
      }
      // Count occurrences in actual entries (not just unique strings)
      for (const r of mergedRaw) {
        if (matchCache.get(r.staff)?.canonical) continue
        unmatchedCounts[r.staff] = (unmatchedCounts[r.staff] ?? 0) + 1
      }
      const unmatched = Object.entries(unmatchedCounts)
        .map(([raw, count]) => ({ raw, count }))
        .sort((a, b) => b.count - a.count)

      // Also surface a summary of which canonical packers had variants merged
      // into them — useful for confidence-checking the matcher.
      const variantsByCanonical: Record<string, Set<string>> = {}
      for (const [raw, m] of matchCache.entries()) {
        if (!m.canonical || m.reason === "exact") continue
        if (!variantsByCanonical[m.canonical]) variantsByCanonical[m.canonical] = new Set()
        variantsByCanonical[m.canonical].add(raw)
      }
      const merges = Object.entries(variantsByCanonical)
        .map(([canonical, set]) => ({ canonical, variants: [...set].sort() }))
        .sort((a, b) => b.variants.length - a.variants.length)

      send({
        type: "result",
        data: {
          dailyAvgCollections,
          totalCollections,
          dailyAvgLots,
          totalLots,
          raw: merged,
          meta: { total: merged.length, staffCount, unmatched, merges },
        },
      })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "X-Content-Type-Options": "nosniff" },
  })
}
