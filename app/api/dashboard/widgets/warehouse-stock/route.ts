import { widgetRoute, fetchInternal } from "@/lib/dashboard-guard"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// Stock waiting to be catalogued, by category — the same figures as
// BC Reports → Warehouse, fetched from that report's own endpoint.

type WhData = {
  byCategory: { category: string; count: number }[]
  meta: { total: number; openTotes: number; categoryCount: number; largestCategory: string }
}

export async function GET() {
  return widgetRoute("warehouse-stock", async () => {
    let data: WhData
    try {
      data = await fetchInternal<WhData>("/api/bc/warehouse")
    } catch (e: any) {
      if (String(e?.message).includes("BC_NOT_CONNECTED")) {
        return { kind: "bars", rows: [], empty: "Not connected to Business Central." }
      }
      throw e
    }

    const top = (data.byCategory ?? []).slice(0, 10)
    return {
      kind: "bars",
      rows: top.map(c => ({
        label: c.category,
        value: Number(c.count),
        display: Number(c.count).toLocaleString("en-GB"),
      })),
      note: `${(data.meta?.total ?? 0).toLocaleString("en-GB")} items awaiting cataloguing across ${data.meta?.categoryCount ?? 0} categories · ${(data.meta?.openTotes ?? 0).toLocaleString("en-GB")} open totes.`,
      empty: "Nothing awaiting cataloguing.",
    }
  })
}
