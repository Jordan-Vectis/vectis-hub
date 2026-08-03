import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/catalogue/bc-corrections?auctionId=xxx
//
// What still needs putting right in BC — one row per lot whose wrong
// Vendor/Receipt was corrected in the Hub by Tote Check → "Match BC". Because
// the Hub's wrong values were most likely what got pushed into BC, each row is
// "this barcode is on the wrong receipt/vendor in BC; here's where it belongs".
//
// Grouped by the move itself (from receipt+vendor → to receipt+vendor) so a
// whole group can be dealt with in BC in one go.

export type BcCorrectionRow = {
  id:              string
  lotId:           string
  barcode:         string | null
  receiptUniqueId: string | null
  title:           string | null
  tote:            string | null
  oldVendor:       string | null
  oldReceipt:      string | null
  newVendor:       string | null
  newReceipt:      string | null
  done:            boolean
  doneBy:          string | null
  doneAt:          string | null
}

export type BcCorrectionGroup = {
  key:        string
  oldReceipt: string | null
  oldVendor:  string | null
  newReceipt: string | null
  newVendor:  string | null
  rows:       BcCorrectionRow[]
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const auctionId = req.nextUrl.searchParams.get("auctionId")?.trim()
    if (!auctionId) return NextResponse.json({ error: "Missing auctionId" }, { status: 400 })

    // Tolerated absent: the table only exists after Run Migrations, while the
    // code reaches Railway immediately.
    let rows: Awaited<ReturnType<typeof prisma.catalogueBcCorrection.findMany>> = []
    try {
      rows = await prisma.catalogueBcCorrection.findMany({
        where:   { auctionId },
        orderBy: [{ oldReceipt: "asc" }, { barcode: "asc" }],
      })
    } catch {
      return NextResponse.json({ groups: [], total: 0, done: 0, notReady: true })
    }

    const groups = new Map<string, BcCorrectionGroup>()
    for (const r of rows) {
      const key = `${r.oldReceipt ?? ""}|${r.oldVendor ?? ""}|${r.newReceipt ?? ""}|${r.newVendor ?? ""}`
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          oldReceipt: r.oldReceipt, oldVendor: r.oldVendor,
          newReceipt: r.newReceipt, newVendor: r.newVendor,
          rows: [],
        })
      }
      groups.get(key)!.rows.push({
        id: r.id, lotId: r.lotId, barcode: r.barcode, receiptUniqueId: r.receiptUniqueId,
        title: r.title, tote: r.tote,
        oldVendor: r.oldVendor, oldReceipt: r.oldReceipt,
        newVendor: r.newVendor, newReceipt: r.newReceipt,
        done: r.done, doneBy: r.doneBy, doneAt: r.doneAt?.toISOString() ?? null,
      })
    }

    // Outstanding work first — a group that's fully ticked off drops to the end.
    const out = [...groups.values()].sort((a, b) => {
      const aLeft = a.rows.filter(r => !r.done).length
      const bLeft = b.rows.filter(r => !r.done).length
      if ((aLeft === 0) !== (bLeft === 0)) return aLeft === 0 ? 1 : -1
      return (a.oldReceipt ?? "").localeCompare(b.oldReceipt ?? "", undefined, { numeric: true })
    })

    return NextResponse.json({
      groups: out,
      total:  rows.length,
      done:   rows.filter(r => r.done).length,
    })
  } catch (e: any) {
    console.error("catalogue/bc-corrections GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
