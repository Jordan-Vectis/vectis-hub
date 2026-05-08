import { NextRequest } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAll } from "@/lib/bc"
import { prisma } from "@/lib/prisma"

export const maxDuration = 300

const EXCLUDED_USERS = new Set([
  "JORDAN.ORANGE", "JACK.COLLINGS", "MICHELLE.TROTTER", "ANDREW.WILSON",
])

function addDays(date: Date, n: number): Date {
  const d = new Date(date); d.setUTCDate(d.getUTCDate() + n); return d
}
function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0]
}

/** Group a sorted list of date strings into contiguous runs */
function groupIntoRuns(dates: string[]): string[][] {
  if (!dates.length) return []
  const sorted = [...dates].sort()
  const runs: string[][] = [[sorted[0]]]
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1] + "T00:00:00Z")
    const curr = new Date(sorted[i]     + "T00:00:00Z")
    if ((curr.getTime() - prev.getTime()) / 86_400_000 === 1) {
      runs[runs.length - 1].push(sorted[i])
    } else {
      runs.push([sorted[i]])
    }
  }
  return runs
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return new Response(JSON.stringify({ error: "Unauthorised" }), { status: 401 })

  const token = await getBCToken()
  if (!token) return new Response(JSON.stringify({ error: "BC_NOT_CONNECTED" }), { status: 401 })

  const { searchParams } = req.nextUrl
  const from = searchParams.get("from") ?? ""
  const to   = searchParams.get("to")   ?? ""
  // mode: "barcode" — count Internal Barcode field changes (default, original behaviour)
  //       "uniqueid" — count Auction Line UniqueID Insertions (matches BC's
  //                    Field=UniqueID + Table=Auction Line + Type=Insertion view)
  const mode = (searchParams.get("mode") ?? "barcode") as "barcode" | "uniqueid"
  if (!from || !to) return new Response(JSON.stringify({ error: "Missing from/to" }), { status: 400 })
  if (mode !== "barcode" && mode !== "uniqueid") {
    return new Response(JSON.stringify({ error: "Invalid mode" }), { status: 400 })
  }

  const dateFrom = new Date(from + "T00:00:00Z")
  const dateTo   = new Date(to   + "T00:00:00Z")

  // All dates in the requested range
  const allDates: string[] = []
  let cur = new Date(dateFrom)
  while (cur <= dateTo) {
    allDates.push(toDateStr(cur))
    cur = addDays(cur, 1)
  }

  const todayStr = toDateStr(new Date())

  // Check which past dates are already cached (today is always live).
  // Cache is namespaced by mode so the two reports don't trample each other.
  const pastDates = allDates.filter(dt => dt < todayStr)
  const cachedDays = pastDates.length > 0
    ? await prisma.bCCatalogueDay.findMany({
        where: { date: { in: pastDates }, mode },
        select: { date: true },
      })
    : []
  const cachedSet = new Set(cachedDays.map(r => r.date))

  // Dates we must fetch from BC: uncached past dates + today (if in range)
  const toFetch = allDates.filter(dt => dt >= todayStr || !cachedSet.has(dt))

  // Build 7-day chunks from contiguous runs of toFetch dates
  const chunks: { start: string; end: string }[] = []
  for (const run of groupIntoRuns(toFetch)) {
    for (let i = 0; i < run.length; i += 7) {
      const slice = run.slice(i, i + 7)
      chunks.push({ start: slice[0], end: slice[slice.length - 1] })
    }
  }

  const encoder = new TextEncoder()
  const PARALLEL = 4

  const stream = new ReadableStream({
    async start(controller) {
      function send(obj: object) {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"))
      }
      // Wrap the whole pipeline in try/catch so a Prisma/BC failure surfaces
      // as a readable {type:'error'} line instead of an interrupted stream.
      try {

      // ── 1. Fetch uncached / today dates from BC ──────────────────────────────
      const freshRows: { User_ID: string; Date_and_Time: string }[] = []
      const total = chunks.length

      for (let i = 0; i < chunks.length; i += PARALLEL) {
        const batch = chunks.slice(i, i + PARALLEL)
        const results = await Promise.all(
          batch.map(async ({ start, end }) => {
            // Two filter shapes:
            //   barcode  — every change to the Internal Barcode field (legacy report)
            //   uniqueid — Auction Line UniqueID Insertions (matches BC's Insertion-filtered view)
            const modeFilter = mode === "uniqueid"
              ? `Table_Caption eq 'Auction Line' and Field_Caption eq 'UniqueID' and Type_of_Change eq 'Insertion'`
              : `Field_Caption eq 'Internal Barcode'`
            const filter =
              `Date_and_Time ge ${start}T00:00:00Z ` +
              `and Date_and_Time le ${end}T23:59:59Z ` +
              `and ${modeFilter}`
            try {
              return await bcFetchAll(token, "ChangeLogEntries", filter, "User_ID,Date_and_Time")
            } catch {
              return []
            }
          })
        )
        results.forEach(rows => freshRows.push(...rows))
        send({ type: "progress", done: Math.min(i + PARALLEL, total), total })
      }

      // ── 2. Persist newly fetched past dates to cache ─────────────────────────
      const daysToCache = toFetch.filter(dt => dt < todayStr)
      if (daysToCache.length > 0) {
        // Aggregate fresh rows: { day → { userId → count } }
        const agg: Record<string, Record<string, number>> = {}
        for (const r of freshRows) {
          const day = r.Date_and_Time?.slice(0, 10) ?? ""
          if (!day || day >= todayStr) continue
          if (!agg[day]) agg[day] = {}
          agg[day][r.User_ID] = (agg[day][r.User_ID] ?? 0) + 1
        }

        const entryUpserts = daysToCache.flatMap(day =>
          Object.entries(agg[day] ?? {}).map(([userId, count]) =>
            prisma.bCCatalogueEntry.upsert({
              where:  { date_userId_mode: { date: day, userId, mode } },
              create: { date: day, userId, mode, count },
              update: { count },
            })
          )
        )
        const dayUpserts = daysToCache.map(date =>
          prisma.bCCatalogueDay.upsert({
            where:  { date_mode: { date, mode } },
            create: { date, mode },
            update: { fetchedAt: new Date() },
          })
        )
        await Promise.all([...entryUpserts, ...dayUpserts])
      }

      // ── 3. Load already-cached dates from DB ─────────────────────────────────
      const alreadyCached = pastDates.filter(dt => cachedSet.has(dt))
      const dbEntries = alreadyCached.length > 0
        ? await prisma.bCCatalogueEntry.findMany({ where: { date: { in: alreadyCached }, mode } })
        : []

      // ── 4. Merge and compute stats ────────────────────────────────────────────
      // userDayCounts[userId][date] = count
      const userDayCounts: Record<string, Record<string, number>> = {}

      for (const e of dbEntries) {
        if (EXCLUDED_USERS.has(e.userId)) continue
        if (!userDayCounts[e.userId]) userDayCounts[e.userId] = {}
        userDayCounts[e.userId][e.date] = (userDayCounts[e.userId][e.date] ?? 0) + e.count
      }
      for (const r of freshRows) {
        if (EXCLUDED_USERS.has(r.User_ID)) continue
        const day = r.Date_and_Time?.slice(0, 10) ?? ""
        if (!day) continue
        if (!userDayCounts[r.User_ID]) userDayCounts[r.User_ID] = {}
        userDayCounts[r.User_ID][day] = (userDayCounts[r.User_ID][day] ?? 0) + 1
      }

      // Daily average
      const dailyAvg = Object.entries(userDayCounts)
        .map(([user, days]) => {
          const vals = Object.values(days)
          return { user, avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 }
        })
        .sort((a, b) => b.avg - a.avg)

      // Total lots
      const totalLots = Object.entries(userDayCounts)
        .map(([user, days]) => ({ user, total: Object.values(days).reduce((a, b) => a + b, 0) }))
        .sort((a, b) => b.total - a.total)

      // Monthly — from fresh rows (with real timestamps) + DB entries (date string only)
      const monthMap: Record<string, { label: string; sort: string; total: number }> = {}

      for (const r of freshRows) {
        if (EXCLUDED_USERS.has(r.User_ID)) continue
        const dt   = new Date(r.Date_and_Time)
        const sort  = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`
        const label = dt.toLocaleString("en-GB", { month: "long", year: "numeric" })
        if (!monthMap[sort]) monthMap[sort] = { label, sort, total: 0 }
        monthMap[sort].total++
      }
      for (const e of dbEntries) {
        if (EXCLUDED_USERS.has(e.userId)) continue
        const dt   = new Date(e.date + "T00:00:00Z")
        const sort  = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`
        const label = dt.toLocaleString("en-GB", { month: "long", year: "numeric" })
        if (!monthMap[sort]) monthMap[sort] = { label, sort, total: 0 }
        monthMap[sort].total += e.count
      }
      const monthly = Object.values(monthMap).sort((a, b) => a.sort.localeCompare(b.sort))

      const totalCount = Object.values(userDayCounts)
        .reduce((sum, days) => sum + Object.values(days).reduce((a, b) => a + b, 0), 0)
      const userCount = Object.keys(userDayCounts).length

      send({ type: "result", data: { dailyAvg, totalLots, monthly, meta: { total: totalCount, userCount } } })
      controller.close()
      } catch (e: any) {
        const msg = e?.message ?? "Unknown server error"
        // Prisma "column does not exist" → user needs to run migrations
        const hint = /column .* does not exist|mode/i.test(msg)
          ? " (tip: run /admin → Run Migrations to add the new 'mode' column)"
          : ""
        console.error("[bc/cataloguing] stream error:", e)
        try {
          send({ type: "error", error: `${msg}${hint}` })
        } catch {}
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "X-Content-Type-Options": "nosniff" },
  })
}
