import { widgetRoute } from "@/lib/dashboard-guard"
import { getSaleStatsCached, rollUp, rollUpBySale, defaultRange, gbp0 } from "@/lib/sale-stats"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// Total hammer over the last 12 months, with buyer's premium earned.
export async function GET() {
  return widgetRoute("sale-value", async () => {
    const { from, to } = defaultRange()
    const stats = await getSaleStatsCached(from, to)
    if (!stats.connected) {
      return { kind: "stat", value: "—", sub: "Not connected to Business Central" }
    }

    const roll  = rollUp(stats.buckets)
    const sales = rollUpBySale(stats.buckets).length

    return {
      kind: "stat",
      value: gbp0(roll.hammer),
      sub: `${sales} sale${sales === 1 ? "" : "s"} · ${roll.sold.toLocaleString("en-GB")} lots sold`,
      delta: { text: `${gbp0(roll.hammer * stats.buyersPremiumRate)} buyer's premium`, good: true },
      note: stats.partial
        ? "⚠ Business Central didn't finish returning the period — this is a partial total."
        : "Last 12 months.",
    }
  })
}
