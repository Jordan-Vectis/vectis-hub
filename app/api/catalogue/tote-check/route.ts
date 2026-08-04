import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { buildToteMap, checkLot, toteLookupVariants, type ToteCheckIssue } from "@/lib/tote-check"

// GET /api/catalogue/tote-check?auctionId=xxx
//
// Checks every lot's Vendor / Receipt / Tote against the BC-synced tote table
// (WarehouseTote: toteNo → receiptNo → vendorNo), which is the SAME source the
// lot wizard's tote box looks up (/api/warehouse/tote-search). So this answers
// "does this lot still agree with what the tote said?" — a mistyped receipt, a
// vendor carried over from the previous batch, a unique ID minted against the
// wrong receipt.
//
// Read-only: it reports, it never writes. The comparison itself lives in
// lib/tote-check.ts so the "Match BC" button fixes exactly what this reports.

export type { ToteCheckIssue } from "@/lib/tote-check"

export type ToteCheckRow = {
  id:              string
  barcode:         string | null
  receiptUniqueId: string | null
  title:           string
  tote:            string | null
  vendor:          string | null
  receipt:         string | null
  createdByName:   string | null
  // What the BC tote data says it should be (null when the tote is unknown)
  bcReceipt:       string | null
  bcVendor:        string | null
  bcVendorName:    string | null
  issues:          ToteCheckIssue[]
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const auctionId = req.nextUrl.searchParams.get("auctionId")?.trim()
    if (!auctionId) return NextResponse.json({ error: "Missing auctionId" }, { status: 400 })

    const lots = await prisma.catalogueLot.findMany({
      where:  { auctionId },
      select: {
        id: true, barcode: true, receiptUniqueId: true, title: true,
        vendor: true, tote: true, receipt: true, createdByName: true,
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

    // When the tote table was last refreshed from BC — shown on the tab so an
    // "unknown tote" pile reads as "the sync is stale", not "600 mistakes".
    const lastSync = await prisma.warehouseTote.aggregate({ _max: { syncedAt: true } })

    const rows: ToteCheckRow[] = []
    for (const l of lots) {
      const { issues, tote } = checkLot(l, toteMap)
      if (issues.length === 0) continue
      rows.push({
        id: l.id, barcode: l.barcode, receiptUniqueId: l.receiptUniqueId, title: l.title,
        tote: l.tote, vendor: l.vendor, receipt: l.receipt, createdByName: l.createdByName,
        bcReceipt:    tote?.receiptNo  ?? null,
        bcVendor:     tote?.vendorNo   ?? null,
        bcVendorName: tote?.vendorName ?? null,
        issues,
      })
    }

    return NextResponse.json({
      checked:  lots.length,
      clean:    lots.length - rows.length,
      rows,
      lastSync: lastSync._max.syncedAt?.toISOString() ?? null,
    })
  } catch (e: any) {
    console.error("catalogue/tote-check GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
