import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/warehouse/db-explorer?table=items&field=auctionCode&q=F069&limit=100
// Returns raw DB rows for inspection.

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { searchParams } = req.nextUrl
    const table = searchParams.get("table") ?? "items"
    const field = searchParams.get("field") ?? "auctionCode"
    const q     = searchParams.get("q")?.trim() ?? ""
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "100"), 500)

    if (table === "totes") {
      const where: Record<string, any> = q ? { [field]: { contains: q, mode: "insensitive" } } : {}
      const rows = await prisma.warehouseTote.findMany({
        where,
        take: limit,
        orderBy: { toteNo: "asc" },
      })
      return NextResponse.json({ rows, count: rows.length })
    }

    // Default: items
    const where: Record<string, any> = q ? { [field]: { contains: q, mode: "insensitive" } } : {}
    const rows = await prisma.warehouseItem.findMany({
      where,
      select: {
        uniqueId:     true,
        barcode:      true,
        auctionCode:  true,
        auctionName:  true,
        auctionDate:  true,
        lotNo:        true,
        currentLotNo: true,
        description:  true,
        artist:       true,
        category:     true,
        location:     true,
        binCode:      true,
        toteNo:       true,
        vendorNo:     true,
        vendorName:   true,
        catalogued:   true,
        withdrawLot:  true,
        collected:    true,
        bcModifiedAt: true,
      },
      take:    limit,
      orderBy: { uniqueId: "asc" },
    })

    return NextResponse.json({ rows, count: rows.length })
  } catch (e: any) {
    console.error("db-explorer error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
