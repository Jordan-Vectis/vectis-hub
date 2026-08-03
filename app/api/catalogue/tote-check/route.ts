import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/catalogue/tote-check?auctionId=xxx
//
// Checks every lot's Vendor / Receipt / Tote against the BC-synced tote table
// (WarehouseTote: toteNo → receiptNo → vendorNo), which is the SAME source the
// lot wizard's tote box looks up (/api/warehouse/tote-search). So this answers
// "does this lot still agree with what the tote said?" — a mistyped receipt, a
// vendor carried over from the previous batch, a unique ID minted against the
// wrong receipt.
//
// Read-only: it reports, it never writes.

export type ToteCheckIssue =
  | "no_tote"             // nothing to check against
  | "tote_unknown"        // tote isn't in the BC data (typo, or not synced yet)
  | "receipt_mismatch"
  | "receipt_missing"
  | "vendor_mismatch"
  | "vendor_missing"
  | "unique_id_mismatch"  // R008729-38 on a lot whose receipt says something else

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

// Tote / receipt / vendor numbers are compared trimmed and case-insensitively —
// a hand-typed "t024808" is the same tote as "T024808".
const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase()

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

    // Look the totes up by every casing the lots actually use — Prisma's `in`
    // is case-sensitive, and a hand-typed tote may not match the BC casing.
    const toteVariants = new Set<string>()
    for (const l of lots) {
      const t = (l.tote ?? "").trim()
      if (t) { toteVariants.add(t); toteVariants.add(t.toUpperCase()); toteVariants.add(t.toLowerCase()) }
    }

    const totes = toteVariants.size > 0
      ? await prisma.warehouseTote.findMany({
          where:  { toteNo: { in: [...toteVariants] } },
          select: { toteNo: true, receiptNo: true, vendorNo: true, vendorName: true, syncedAt: true },
        })
      : []

    const toteMap = new Map(totes.map(t => [norm(t.toteNo), t]))

    // When the tote table was last refreshed from BC — shown on the tab so an
    // "unknown tote" pile reads as "the sync is stale", not "600 mistakes".
    const lastSync = await prisma.warehouseTote.aggregate({ _max: { syncedAt: true } })

    const rows: ToteCheckRow[] = []
    for (const l of lots) {
      const issues: ToteCheckIssue[] = []
      const tote = norm(l.tote) ? toteMap.get(norm(l.tote)) : undefined

      if (!norm(l.tote)) {
        issues.push("no_tote")
      } else if (!tote) {
        issues.push("tote_unknown")
      } else {
        if (norm(tote.receiptNo)) {
          if (!norm(l.receipt))                            issues.push("receipt_missing")
          else if (norm(l.receipt) !== norm(tote.receiptNo)) issues.push("receipt_mismatch")
        }
        if (norm(tote.vendorNo)) {
          if (!norm(l.vendor))                           issues.push("vendor_missing")
          else if (norm(l.vendor) !== norm(tote.vendorNo)) issues.push("vendor_mismatch")
        }
      }

      // The unique ID carries its receipt as a prefix (R008729-38). If the lot's
      // receipt says otherwise, one of the two is wrong — worth seeing even when
      // the tote itself checks out.
      const uid = (l.receiptUniqueId ?? "").trim()
      if (uid && norm(l.receipt)) {
        const base = uid.includes("-") ? uid.slice(0, uid.lastIndexOf("-")) : uid
        if (norm(base) !== norm(l.receipt)) issues.push("unique_id_mismatch")
      }

      if (issues.length > 0) {
        rows.push({
          id: l.id, barcode: l.barcode, receiptUniqueId: l.receiptUniqueId, title: l.title,
          tote: l.tote, vendor: l.vendor, receipt: l.receipt, createdByName: l.createdByName,
          bcReceipt:    tote?.receiptNo   ?? null,
          bcVendor:     tote?.vendorNo    ?? null,
          bcVendorName: tote?.vendorName  ?? null,
          issues,
        })
      }
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
