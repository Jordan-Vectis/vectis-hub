import { widgetRoute } from "@/lib/dashboard-guard"
import {
  getSaleStatsCached, rollUp, defaultRange,
  offered, sellThrough, vsHigh, pct, pctSigned, gbp0,
} from "@/lib/sale-stats"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// Sell-through over the last 12 months, and how hammer compared with high estimate.
//
// ⚠ Sell-through is measured against OFFERED lots (total minus withdrawn), not
// total lots. Counting withdrawn lots as failures would understate the rate and
// disagree with the Sale Statistics page.
export async function GET() {
  return widgetRoute("sell-through", async () => {
    const { from, to } = defaultRange()
    const stats = await getSaleStatsCached(from, to)
    if (!stats.connected) {
      return { kind: "stat", value: "—", sub: "Not connected to Business Central" }
    }

    const roll = rollUp(stats.buckets)
    const vs   = vsHigh(roll)

    return {
      kind: "stat",
      value: pct(sellThrough(roll)),
      sub: `${roll.sold.toLocaleString("en-GB")} of ${offered(roll).toLocaleString("en-GB")} lots offered`,
      delta: { text: `${pctSigned(vs)} vs ${gbp0(roll.high)} high estimate`, good: vs >= 0 },
      note: stats.withdrawnField
        ? "Last 12 months · withdrawn lots excluded from the denominator."
        : "Last 12 months · no withdrawn field on the BC lines, so nothing is excluded.",
    }
  })
}
