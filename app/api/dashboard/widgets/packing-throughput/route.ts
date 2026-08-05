import { widgetRoute, fetchInternal } from "@/lib/dashboard-guard"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// Collections and lots packed per staff member over the last 30 days — the same
// figures as BC Reports → Packing, from that report's own endpoint (which also
// does the staff-name merging, so the names match).

type PackData = {
  totalCollections: { staff: string; total: number }[]
  totalLots:        { staff: string; total: number }[]
  dailyAvgLots:     { staff: string; avg: number }[]
  meta: { total: number; staffCount: number }
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)

export async function GET() {
  return widgetRoute("packing-throughput", async () => {
    const to   = new Date()
    const from = new Date(to)
    from.setDate(from.getDate() - 30)

    let data: PackData
    try {
      data = await fetchInternal<PackData>(`/api/bc/packing?from=${ymd(from)}&to=${ymd(to)}`)
    } catch (e: any) {
      if (String(e?.message).includes("BC_NOT_CONNECTED")) {
        return { kind: "table", columns: [], rows: [], empty: "Not connected to Business Central." }
      }
      throw e
    }

    const lots  = new Map((data.totalLots ?? []).map(r => [r.staff, r.total]))
    const avg   = new Map((data.dailyAvgLots ?? []).map(r => [r.staff, r.avg]))
    const rows  = (data.totalCollections ?? [])
      .sort((a, b) => (lots.get(b.staff) ?? 0) - (lots.get(a.staff) ?? 0))
      .slice(0, 12)
      .map(r => [
        r.staff,
        r.total.toLocaleString("en-GB"),
        (lots.get(r.staff) ?? 0).toLocaleString("en-GB"),
        (avg.get(r.staff) ?? 0).toFixed(1),
      ] as (string | number)[])

    return {
      kind: "table",
      columns: ["Packer", "Collections", "Lots", "Lots/day"],
      align:   ["left", "right", "right", "right"],
      rows,
      note: "Last 30 days.",
      empty: "Nothing packed in the last 30 days.",
    }
  })
}
