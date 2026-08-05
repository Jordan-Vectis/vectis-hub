import { prisma } from "@/lib/prisma"
import { widgetRoute } from "@/lib/dashboard-guard"

export const dynamic = "force-dynamic"

// Lots catalogued per month for the last 12 months.
//
// ⚠ Months are bucketed in Europe/London, not UTC. On the server clock a lot
// catalogued at 00:30 BST on the 1st falls in the previous month, which quietly
// moves work across a month boundary — exactly the sort of wrongness nobody
// spots on a chart.

export async function GET() {
  return widgetRoute("monthly-trend", async () => {
    const rows = await prisma.$queryRaw<{ month: string; n: number }[]>`
      SELECT to_char(date_trunc('month', l."createdAt" AT TIME ZONE 'Europe/London'), 'YYYY-MM') AS month,
             COUNT(*)::int AS n
      FROM "CatalogueLot" l
      WHERE l."createdAt" >= (now() - interval '12 months')
      GROUP BY 1
      ORDER BY 1 ASC`

    if (rows.length === 0) {
      return { kind: "bars", rows: [], empty: "Nothing catalogued in the last 12 months." }
    }

    return {
      kind: "bars",
      rows: rows.map(r => ({
        label: new Date(`${r.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "2-digit" }),
        value: Number(r.n),
        display: Number(r.n).toLocaleString("en-GB"),
      })),
      note: "Last 12 months · the current month is still filling up.",
    }
  })
}
