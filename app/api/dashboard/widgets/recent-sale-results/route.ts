import { widgetRoute } from "@/lib/dashboard-guard"
import {
  getSaleStatsCached, rollUpBySale, defaultRange,
  offered, sellThrough, vsHigh, pct, pctSigned, gbp0,
} from "@/lib/sale-stats"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// The last 10 completed sales — hammer, sold, passed, withdrawn, sell-through,
// and how the money landed against the high estimate.
export async function GET() {
  return widgetRoute("recent-sale-results", async () => {
    const { from, to } = defaultRange()
    const stats = await getSaleStatsCached(from, to)
    if (!stats.connected) {
      return { kind: "table", columns: [], rows: [], empty: "Not connected to Business Central." }
    }

    const sales = rollUpBySale(stats.buckets).slice(0, 10)

    return {
      kind: "table",
      columns: ["Sale", "Date", "Hammer", "Sold", "Passed", "Sell-through", "vs High"],
      align:   ["left", "left", "right", "right", "right", "right", "right"],
      rows: sales.map(s => [
        s.code,
        s.date ? new Date(s.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }) : "—",
        gbp0(s.roll.hammer),
        s.roll.sold,
        Math.max(0, offered(s.roll) - s.roll.sold),
        pct(sellThrough(s.roll)),
        pctSigned(vsHigh(s.roll)),
      ]),
      note: stats.partial
        ? "⚠ Partial — Business Central didn't finish returning the period."
        : "Last 12 months, most recent first · passed = offered but unsold.",
      empty: "No completed sales in the last 12 months.",
    }
  })
}
