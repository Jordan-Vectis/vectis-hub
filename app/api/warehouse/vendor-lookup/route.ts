import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/warehouse/vendor-lookup?receipt=R007523
// GET /api/warehouse/vendor-lookup?tote=T025401
//
// For tote lookups: checks WarehouseTote first (BC-synced, has vendorNo directly),
// then falls back to WarehouseItem (in case only item-level data is present).
// For receipt lookups: checks WarehouseTote.receiptNo, then WarehouseItem.receiptNo.

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { searchParams } = req.nextUrl
    const receipt = searchParams.get("receipt")?.trim()
    const tote    = searchParams.get("tote")?.trim()

    if (!receipt && !tote) {
      return NextResponse.json({ error: "Provide receipt or tote" }, { status: 400 })
    }

    // ── Tote lookup ─────────────────────────────────────────────────────────────
    if (tote) {
      // Primary: WarehouseTote (BC-synced, vendor lives here)
      const wt = await prisma.warehouseTote.findFirst({
        where:  { toteNo: { equals: tote, mode: "insensitive" } },
        select: { vendorNo: true, vendorName: true, receiptNo: true },
      })
      if (wt?.vendorNo) {
        return NextResponse.json({ vendorNo: wt.vendorNo, vendorName: wt.vendorName ?? null, receiptNo: wt.receiptNo ?? null })
      }
      // Fallback: WarehouseItem (item-level data)
      const wi = await prisma.warehouseItem.findFirst({
        where:  { toteNo: { equals: tote, mode: "insensitive" } },
        select: { vendorNo: true, vendorName: true },
      })
      if (wi?.vendorNo) {
        return NextResponse.json({ vendorNo: wi.vendorNo, vendorName: wi.vendorName ?? null, receiptNo: null })
      }
      return NextResponse.json({ vendorNo: null, vendorName: null, receiptNo: null })
    }

    // ── Receipt lookup ───────────────────────────────────────────────────────────
    if (receipt) {
      // Primary: WarehouseTote (has receiptNo + vendor)
      const wt = await prisma.warehouseTote.findFirst({
        where:  { receiptNo: { equals: receipt, mode: "insensitive" } },
        select: { vendorNo: true, vendorName: true },
      })
      if (wt?.vendorNo) {
        return NextResponse.json({ vendorNo: wt.vendorNo, vendorName: wt.vendorName ?? null, receiptNo: receipt })
      }
      // Fallback: WarehouseItem
      const wi = await prisma.warehouseItem.findFirst({
        where:  { receiptNo: { equals: receipt, mode: "insensitive" } },
        select: { vendorNo: true, vendorName: true },
      })
      if (wi?.vendorNo) {
        return NextResponse.json({ vendorNo: wi.vendorNo, vendorName: wi.vendorName ?? null, receiptNo: receipt })
      }
      return NextResponse.json({ vendorNo: null, vendorName: null, receiptNo: null })
    }
  } catch (e: any) {
    console.error("vendor-lookup error:", e)
    return NextResponse.json({ error: e?.message ?? "Lookup failed" }, { status: 500 })
  }
}
