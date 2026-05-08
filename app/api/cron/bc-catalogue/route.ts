import { NextRequest } from "next/server"
import { getBCTokenAny, bcFetchAll } from "@/lib/bc"
import { prisma } from "@/lib/prisma"

export const maxDuration = 300

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0]
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date); d.setUTCDate(d.getUTCDate() + n); return d
}

export async function GET(req: NextRequest) {
  // Verify cron secret
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorised" }, { status: 401 })
  }

  const token = await getBCTokenAny()
  if (!token) return Response.json({ error: "No BC token available" }, { status: 503 })

  // Only fetch the last 3 days — catches yesterday + any recent misses
  const today = toDateStr(new Date())
  const allPastDates = [
    toDateStr(addDays(new Date(), -3)),
    toDateStr(addDays(new Date(), -2)),
    toDateStr(addDays(new Date(), -1)),
  ].filter(dt => dt < today)

  // Run both modes — cache namespaced separately
  const modes: ("barcode" | "uniqueid")[] = ["barcode", "uniqueid"]
  const summary: Record<string, { datesCached: number; entriesStored: number }> = {}

  for (const mode of modes) {
    const cached = await prisma.bCCatalogueDay.findMany({
      where:  { date: { in: allPastDates }, mode },
      select: { date: true },
    })
    const cachedSet = new Set(cached.map(r => r.date))
    const toFetch = allPastDates.filter(dt => !cachedSet.has(dt))
    if (toFetch.length === 0) {
      summary[mode] = { datesCached: 0, entriesStored: 0 }
      continue
    }

    const chunks: { start: string; end: string }[] = []
    for (let i = 0; i < toFetch.length; i += 7) {
      const slice = toFetch.slice(i, i + 7)
      chunks.push({ start: slice[0], end: slice[slice.length - 1] })
    }

    const PARALLEL = 4
    const freshRows: { User_ID: string; Date_and_Time: string }[] = []

    for (let i = 0; i < chunks.length; i += PARALLEL) {
      const batch = chunks.slice(i, i + PARALLEL)
      const results = await Promise.all(
        batch.map(async ({ start, end }) => {
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
    }

    const agg: Record<string, Record<string, number>> = {}
    for (const r of freshRows) {
      const day = r.Date_and_Time?.slice(0, 10) ?? ""
      if (!day || day >= today) continue
      if (!agg[day]) agg[day] = {}
      agg[day][r.User_ID] = (agg[day][r.User_ID] ?? 0) + 1
    }

    const entryUpserts = toFetch.flatMap(day =>
      Object.entries(agg[day] ?? {}).map(([userId, count]) =>
        prisma.bCCatalogueEntry.upsert({
          where:  { date_userId_mode: { date: day, userId, mode } },
          create: { date: day, userId, mode, count },
          update: { count },
        })
      )
    )
    const dayUpserts = toFetch.map(date =>
      prisma.bCCatalogueDay.upsert({
        where:  { date_mode: { date, mode } },
        create: { date, mode },
        update: { fetchedAt: new Date() },
      })
    )
    await Promise.all([...entryUpserts, ...dayUpserts])

    summary[mode] = { datesCached: toFetch.length, entriesStored: freshRows.length }
    console.log(`[cron/bc-catalogue] mode=${mode} cached ${toFetch.length} dates, ${freshRows.length} entries`)
  }

  return Response.json({ ok: true, summary })
}
