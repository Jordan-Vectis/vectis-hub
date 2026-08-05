import { widgetRoute } from "@/lib/dashboard-guard"
import { isGaConfigured, getMarketingReport, realtimeActiveUsers } from "@/lib/ga"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// Website traffic over the last 28 days against the 28 before it, plus who is
// on the site right now. Straight from lib/ga.ts, the same source as the
// Marketing Reports page, so the figures match.
//
// Bots are NOT excluded here, matching that page's default — a dashboard figure
// that quietly used a different filter would disagree with the report it links to.

export async function GET() {
  return widgetRoute("web-traffic", async () => {
    if (!isGaConfigured()) {
      return { kind: "stat", value: "—", sub: "Google Analytics isn't configured" }
    }

    const [report, live] = await Promise.all([
      // sectionIds: [] — the breakdown tables are a GA report each and a stat
      // card shows none of them. Only the totals are needed.
      getMarketingReport("28d", false, []),
      realtimeActiveUsers(),
    ])

    const now    = Number(report.summary?.sessions ?? 0)
    const change = report.deltas?.sessions ?? null

    return {
      kind: "stat",
      value: now.toLocaleString("en-GB"),
      sub: live == null ? "sessions, last 28 days" : `sessions, last 28 days · ${live} on the site now`,
      delta: change == null
        ? undefined
        : { text: `${change >= 0 ? "+" : ""}${(change * 100).toFixed(1)}% on the previous 28 days`, good: change >= 0 },
      note: "Bots included, matching the Marketing Reports default.",
    }
  })
}
