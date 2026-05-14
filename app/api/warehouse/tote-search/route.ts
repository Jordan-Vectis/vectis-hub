import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/warehouse/tote-search?q=T025
// Searches WarehouseTote (BC-synced) by toteNo — used by the lot wizard tote field.

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
    if (!q) return NextResponse.json([])

    const totes = await prisma.warehouseTote.findMany({
      where:   { toteNo: { contains: q, mode: "insensitive" } },
      select:  { toteNo: true, vendorNo: true, vendorName: true, receiptNo: true, location: true },
      orderBy: { toteNo: "asc" },
      take:    20,
    })

    return NextResponse.json(totes)
  } catch (e: any) {
    console.error("tote-search error:", e)
    return NextResponse.json({ error: e?.message ?? "Search failed" }, { status: 500 })
  }
}
