import { prisma } from "@/lib/prisma"
import { widgetRoute } from "@/lib/dashboard-guard"
import { ukDayStartUtc } from "@/lib/cataloguing-reports"

export const dynamic = "force-dynamic"

// Average time on a lot over the last 30 London days, team then per person.
//
// The MEDIAN is shown alongside the mean deliberately: one lot left open over
// lunch drags a mean minutes upward, and a manager reading "18 minutes a lot"
// off a dashboard would draw the wrong conclusion. Same orphaned-log exclusion
// as everywhere else.

const fmt = (ms: number) => {
  if (!ms || ms <= 0) return "—"
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

export async function GET() {
  return widgetRoute("time-per-lot", async () => {
    const since = ukDayStartUtc(new Date(), 30)

    const [overall, perUser] = await Promise.all([
      prisma.$queryRaw<{ avg: number | null; median: number | null; n: number }[]>`
        SELECT AVG(t."durationMs")::float8 AS "avg",
               PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY t."durationMs")::float8 AS "median",
               COUNT(*)::int AS "n"
        FROM "CatalogueTimingLog" t
        WHERE t."savedAt" >= ${since}
          AND (t."lotId" IS NULL OR EXISTS (SELECT 1 FROM "CatalogueLot" l WHERE l."id" = t."lotId"))`,
      prisma.$queryRaw<{ userName: string; avg: number; n: number }[]>`
        SELECT t."userName" AS "userName", AVG(t."durationMs")::float8 AS "avg", COUNT(*)::int AS "n"
        FROM "CatalogueTimingLog" t
        WHERE t."savedAt" >= ${since}
          AND (t."lotId" IS NULL OR EXISTS (SELECT 1 FROM "CatalogueLot" l WHERE l."id" = t."lotId"))
        GROUP BY t."userName"
        HAVING COUNT(*) >= 5
        ORDER BY AVG(t."durationMs") ASC
        LIMIT 10`,
    ])

    const o = overall[0]
    if (!o || !o.n) {
      return { kind: "table", columns: [], rows: [], empty: "No timed lots in the last 30 days." }
    }

    return {
      kind: "table",
      columns: ["Cataloguer", "Average", "Lots"],
      align:   ["left", "right", "right"],
      rows: [
        ["Whole team", fmt(o.avg ?? 0), o.n],
        ["— median", fmt(o.median ?? 0), ""],
        ...perUser.map(u => [u.userName || "Unknown", fmt(u.avg), u.n] as (string | number)[]),
      ],
      note: "Last 30 days · people with at least 5 timed lots · median shown because one lot left open skews the mean.",
    }
  })
}
