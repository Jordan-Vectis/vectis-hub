import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/warehouse/vendor-lookup?receipt=R007523
// GET /api/warehouse/vendor-lookup?tote=T001234
//
// Returns the vendor number (and name) for a given receipt or tote by querying
// WarehouseItem. Used by the lot wizard step 1 to auto-fill the Vendor field.

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

    const item = await prisma.warehouseItem.findFirst({
      where: receipt
        ? { receiptNo: { equals: receipt, mode: "insensitive" } }
        : { toteNo:    { equals: tote,    mode: "insensitive" } },
      select: { vendorNo: true, vendorName: true },
    })

    if (!item?.vendorNo) {
      return NextResponse.json({ vendorNo: null, vendorName: null })
    }

    return NextResponse.json({ vendorNo: item.vendorNo, vendorName: item.vendorName ?? null })
  } catch (e: any) {
    console.error("vendor-lookup error:", e)
    return NextResponse.json({ error: e?.message ?? "Lookup failed" }, { status: 500 })
  }
}
