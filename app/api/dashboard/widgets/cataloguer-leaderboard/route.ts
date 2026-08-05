import { prisma } from "@/lib/prisma"
import { widgetRoute } from "@/lib/dashboard-guard"
import { ukDayStartUtc } from "@/lib/cataloguing-reports"

export const dynamic = "force-dynamic"

// Lots per cataloguer over the last 30 London days.
//
// ⚠ Orphaned timing logs are excluded — rows whose lotId matches no lot, the
// phantom "deleted lot" records. Every other figure in the portal and the
// Reports pages excludes them, and a leaderboard that didn't would quietly
// disagree with all of them.

export async function GET() {
  return widgetRoute("cataloguer-leaderboard", async () => {
    const since = ukDayStartUtc(new Date(), 30)

    const rows = await prisma.$queryRaw<{ userName: string; count: number }[]>`
      SELECT t."userName" AS "userName", COUNT(*)::int AS "count"
      FROM "CatalogueTimingLog" t
      WHERE t."savedAt" >= ${since}
        AND (t."lotId" IS NULL OR EXISTS (SELECT 1 FROM "CatalogueLot" l WHERE l."id" = t."lotId"))
      GROUP BY t."userName"
      ORDER BY "count" DESC
      LIMIT 12`

    return {
      kind: "bars",
      rows: rows.map(r => ({ label: r.userName || "Unknown", value: Number(r.count) })),
      note: "Last 30 days.",
      empty: "Nothing catalogued in the last 30 days.",
    }
  })
}
