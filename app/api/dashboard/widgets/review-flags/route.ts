import { prisma } from "@/lib/prisma"
import { widgetRoute } from "@/lib/dashboard-guard"

export const dynamic = "force-dynamic"

// Lots someone has flagged for a second look, by sale.
//
// Two separate things are counted, because they mean different things and a
// manager needs to tell them apart: reviewFlag is a HUMAN checker saying this
// lot is wrong; aiFlagNote is the batch pipeline suspecting a mistake. Summing
// them into one number would hide which needs a person.
//
// Department-gated — the sales are filtered by ctx.saleWhere.

export async function GET() {
  return widgetRoute("review-flags", async ctx => {
    const lots = await prisma.catalogueLot.findMany({
      where: {
        OR: [{ reviewFlag: { not: null } }, { aiFlagNote: { not: null } }],
        auction: { complete: false, ...ctx.saleWhere },
      },
      select: { reviewFlag: true, aiFlagNote: true, auction: { select: { code: true } } },
      take: 2000,
    })

    if (lots.length === 0) {
      return { kind: "list", rows: [], empty: "Nothing flagged on sales in progress." }
    }

    const bySale = new Map<string, { human: number; ai: number }>()
    let human = 0, ai = 0
    for (const l of lots) {
      const code = l.auction.code
      const e = bySale.get(code) ?? { human: 0, ai: 0 }
      if (l.reviewFlag)  { e.human++; human++ }
      if (l.aiFlagNote)  { e.ai++;    ai++ }
      bySale.set(code, e)
    }

    const rows = [...bySale.entries()]
      .sort((a, b) => (b[1].human + b[1].ai) - (a[1].human + a[1].ai))
      .slice(0, 8)
      .map(([code, v]) => ({
        label: code,
        sub:   `${v.human} checker · ${v.ai} AI`,
        value: String(v.human + v.ai),
      }))

    return {
      kind: "list",
      rows,
      note: `${human} flagged by a checker, ${ai} by the AI, across sales in progress.`,
    }
  })
}
