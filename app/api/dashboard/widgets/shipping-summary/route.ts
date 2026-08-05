import { widgetRoute, fetchInternal } from "@/lib/dashboard-guard"
import { gbp0 } from "@/lib/sale-stats"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// Parcels and items despatched by region over the last 90 days — the same
// figures as BC Reports → Shipping, from that report's own endpoint.

type ShipData = {
  byRegion: { region: string; parcels: number; items: number; revenue: number }[]
  meta: { total: number; countries: number }
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)

export async function GET() {
  return widgetRoute("shipping-summary", async () => {
    const to   = new Date()
    const from = new Date(to)
    from.setDate(from.getDate() - 90)

    let data: ShipData
    try {
      data = await fetchInternal<ShipData>(`/api/bc/shipping?from=${ymd(from)}&to=${ymd(to)}`)
    } catch (e: any) {
      if (String(e?.message).includes("BC_NOT_CONNECTED")) {
        return { kind: "table", columns: [], rows: [], empty: "Not connected to Business Central." }
      }
      throw e
    }

    const regions = data.byRegion ?? []
    const totals  = regions.reduce(
      (a, r) => ({ parcels: a.parcels + r.parcels, items: a.items + r.items, revenue: a.revenue + r.revenue }),
      { parcels: 0, items: 0, revenue: 0 },
    )

    return {
      kind: "table",
      columns: ["Region", "Parcels", "Items", "Postage"],
      align:   ["left", "right", "right", "right"],
      rows: [
        ...regions.map(r => [r.region, r.parcels.toLocaleString("en-GB"), r.items.toLocaleString("en-GB"), gbp0(r.revenue)] as (string | number)[]),
        ["All regions", totals.parcels.toLocaleString("en-GB"), totals.items.toLocaleString("en-GB"), gbp0(totals.revenue)],
      ],
      note: `Last 90 days · ${data.meta?.countries ?? 0} countries.`,
      empty: "Nothing despatched in the last 90 days.",
    }
  })
}
