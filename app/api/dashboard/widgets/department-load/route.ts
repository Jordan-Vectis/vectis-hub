import { prisma } from "@/lib/prisma"
import { widgetRoute } from "@/lib/dashboard-guard"

export const dynamic = "force-dynamic"

// Active sales grouped by the department that covers their auction type, with
// lots done and how many sales each is carrying.
//
// A sale type belongs to one department, so the mapping is auctionType →
// department name. Sale types no department claims are grouped as Unassigned
// rather than dropped — a sale nobody owns is the thing a manager most needs to
// see, not the thing to hide.

export async function GET() {
  return widgetRoute("department-load", async ctx => {
    const [departments, auctions] = await Promise.all([
      prisma.department.findMany({ select: { name: true, auctionTypes: true } }),
      prisma.catalogueAuction.findMany({
        where:  { complete: false, ...ctx.saleWhere },
        select: { auctionType: true, _count: { select: { lots: true } } },
      }),
    ])

    const owner = new Map<string, string>()
    for (const d of departments) for (const t of d.auctionTypes) owner.set(t, d.name)

    const tally = new Map<string, { sales: number; lots: number }>()
    for (const a of auctions) {
      const name = (a.auctionType && owner.get(a.auctionType)) || "Unassigned"
      const e = tally.get(name) ?? { sales: 0, lots: 0 }
      e.sales += 1
      e.lots  += a._count.lots
      tally.set(name, e)
    }

    const rows = [...tally.entries()].sort((a, b) => b[1].lots - a[1].lots)

    return {
      kind: "table",
      columns: ["Department", "Sales", "Lots"],
      align:   ["left", "right", "right"],
      rows: rows.map(([name, v]) => [name, v.sales, v.lots.toLocaleString("en-GB")]),
      note: "Sales in progress only · Unassigned means no department claims that sale type.",
      empty: "No sales in progress.",
    }
  })
}
