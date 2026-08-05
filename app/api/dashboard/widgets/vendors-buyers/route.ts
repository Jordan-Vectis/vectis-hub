import { widgetRoute } from "@/lib/dashboard-guard"
import { getSaleStatsCached, rollUp, defaultRange, gbp0 } from "@/lib/sale-stats"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// Distinct vendors selling and buyers winning over the last 12 months.
//
// ⚠ These are DISTINCT counts across the whole period, so they can't be summed
// from the per-sale figures — one vendor in six sales is one vendor here. They
// come from the sets built during the BC walk.
export async function GET() {
  return widgetRoute("vendors-buyers", async () => {
    const { from, to } = defaultRange()
    const stats = await getSaleStatsCached(from, to)
    if (!stats.connected) {
      return { kind: "stats", items: [], empty: "Not connected to Business Central." }
    }

    const roll = rollUp(stats.buckets)
    const avgLot = roll.sold > 0 ? roll.hammer / roll.sold : 0

    const items = [
      {
        label: "Vendors",
        value: stats.vendorField ? stats.totalVendors.toLocaleString("en-GB") : "—",
        sub: stats.vendorField ? "sold something" : "no vendor field in BC",
      },
      {
        label: "Successful buyers",
        value: stats.buyerField ? stats.totalSuccessfulBuyers.toLocaleString("en-GB") : "—",
        sub: stats.buyerField ? "won at least one lot" : "no buyer field in BC",
      },
      { label: "Average lot", value: gbp0(avgLot), sub: "hammer ÷ lots sold" },
      { label: "Items collected", value: roll.collected.toLocaleString("en-GB"), sub: "scanned as collected" },
    ]

    return { kind: "stats", items, note: "Last 12 months · vendors and buyers are distinct over the whole period." }
  })
}
