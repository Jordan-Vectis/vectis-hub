import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { buildToteMap, checkLot, toteLookupVariants } from "@/lib/tote-check"

// GET /api/catalogue/bc-corrections?auctionId=xxx
//
// What needs putting right in BC. BC is correct, our data was wrong — and the
// wrong values are most likely what got pushed INTO BC — so each row says
// "this barcode is on the wrong receipt/vendor in BC, here's where it belongs".
//
// ⚠ The list is LIVE, not a leftover of the Match BC button. Jordan works
// through BC *before* correcting the Hub and checks back afterwards, so it has
// to show today's mismatches straight away. Two sources, merged on lotId:
//
//   1. Live mismatches — computed now, the same way the Tote Check tab does.
//   2. Saved rows (CatalogueBcCorrection) — written when a row is ticked, and
//      by Match BC. These are what keeps the list alive AFTER the lots have
//      been corrected, when the live mismatch no longer exists.
//
// A saved row always wins: it holds the tick and the values as they were when
// the discrepancy was real.

export type BcCorrectionRow = {
  // Identity is the LOT — a live row has no saved record yet.
  lotId:           string
  saved:           boolean
  barcode:         string | null
  receiptUniqueId: string | null
  title:           string | null
  tote:            string | null
  oldVendor:       string | null
  oldReceipt:      string | null
  newVendor:       string | null
  newReceipt:      string | null
  newVendorName:   string | null
  done:            boolean
  doneBy:          string | null
  doneAt:          string | null
  // The Hub still holds the wrong value (Match BC hasn't been run on it yet)
  stillWrong:      boolean
}

export type BcCorrectionGroup = {
  key:        string
  oldReceipt: string | null
  oldVendor:  string | null
  newReceipt: string | null
  newVendor:  string | null
  newVendorName: string | null
  rows:       BcCorrectionRow[]
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const auctionId = req.nextUrl.searchParams.get("auctionId")?.trim()
    if (!auctionId) return NextResponse.json({ error: "Missing auctionId" }, { status: 400 })

    // ── 1. Live mismatches ──
    const lots = await prisma.catalogueLot.findMany({
      where:  { auctionId },
      select: {
        id: true, barcode: true, receiptUniqueId: true, title: true,
        vendor: true, tote: true, receipt: true,
      },
      orderBy: { createdAt: "asc" },
    })

    const variants = toteLookupVariants(lots)
    const totes = variants.length > 0
      ? await prisma.warehouseTote.findMany({
          where:  { toteNo: { in: variants } },
          select: { toteNo: true, receiptNo: true, vendorNo: true, vendorName: true },
        })
      : []
    const toteMap = buildToteMap(totes)

    const live = new Map<string, BcCorrectionRow>()
    for (const l of lots) {
      const { issues, tote } = checkLot(l, toteMap)
      // Only a WRONG value means BC needs putting right. A blank was never
      // pushed as anything, so filling one in isn't a BC correction.
      if (!tote) continue
      if (!issues.includes("receipt_mismatch") && !issues.includes("vendor_mismatch")) continue
      live.set(l.id, {
        lotId: l.id, saved: false,
        barcode: l.barcode, receiptUniqueId: l.receiptUniqueId, title: l.title, tote: l.tote,
        oldVendor: l.vendor, oldReceipt: l.receipt,
        newVendor: tote.vendorNo, newReceipt: tote.receiptNo, newVendorName: tote.vendorName,
        done: false, doneBy: null, doneAt: null,
        stillWrong: true,
      })
    }

    // ── 2. Saved rows (ticked, or written by Match BC) ──
    // Tolerated absent: the table only exists after Run Migrations, while the
    // code reaches Railway immediately.
    let saved: Awaited<ReturnType<typeof prisma.catalogueBcCorrection.findMany>> = []
    let notReady = false
    try {
      saved = await prisma.catalogueBcCorrection.findMany({ where: { auctionId } })
    } catch {
      notReady = true
    }

    const merged = new Map<string, BcCorrectionRow>(live)
    for (const s of saved) {
      const liveRow = live.get(s.lotId)
      merged.set(s.lotId, {
        lotId: s.lotId, saved: true,
        barcode: s.barcode, receiptUniqueId: s.receiptUniqueId, title: s.title, tote: s.tote,
        oldVendor: s.oldVendor, oldReceipt: s.oldReceipt,
        newVendor: s.newVendor, newReceipt: s.newReceipt,
        newVendorName: liveRow?.newVendorName ?? null,
        done: s.done, doneBy: s.doneBy, doneAt: s.doneAt?.toISOString() ?? null,
        // No live mismatch left → the Hub has already been corrected.
        stillWrong: !!liveRow,
      })
    }

    const groups = new Map<string, BcCorrectionGroup>()
    for (const r of merged.values()) {
      const key = `${r.oldReceipt ?? ""}|${r.oldVendor ?? ""}|${r.newReceipt ?? ""}|${r.newVendor ?? ""}`
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          oldReceipt: r.oldReceipt, oldVendor: r.oldVendor,
          newReceipt: r.newReceipt, newVendor: r.newVendor, newVendorName: r.newVendorName,
          rows: [],
        })
      }
      const g = groups.get(key)!
      if (!g.newVendorName && r.newVendorName) g.newVendorName = r.newVendorName
      g.rows.push(r)
    }

    for (const g of groups.values()) {
      g.rows.sort((a, b) => (a.barcode ?? "").localeCompare(b.barcode ?? "", undefined, { numeric: true }))
    }

    // Outstanding work first — a group that's fully ticked off drops to the end.
    const out = [...groups.values()].sort((a, b) => {
      const aLeft = a.rows.filter(r => !r.done).length
      const bLeft = b.rows.filter(r => !r.done).length
      if ((aLeft === 0) !== (bLeft === 0)) return aLeft === 0 ? 1 : -1
      return (a.oldReceipt ?? "").localeCompare(b.oldReceipt ?? "", undefined, { numeric: true })
    })

    const all = [...merged.values()]
    return NextResponse.json({
      groups: out,
      total:  all.length,
      done:   all.filter(r => r.done).length,
      notReady,
    })
  } catch (e: any) {
    console.error("catalogue/bc-corrections GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
