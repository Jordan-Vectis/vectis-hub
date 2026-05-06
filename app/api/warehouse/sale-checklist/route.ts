import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/warehouse/sale-checklist
// BC-data only. Items come from WarehouseItem (synced from BC).
// auctionName is stored in the DB and populated by the auction-names sync step.
// No live BC call needed here.

export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const rows = await prisma.warehouseItem.findMany({
      where: { auctionCode: { not: null } },
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
        location:     true,
        binCode:      true,
        toteNo:       true,
        vendorNo:     true,
        vendorName:   true,
        withdrawLot:  true,
        collected:    true,
      },
      orderBy: [{ auctionCode: "asc" }, { currentLotNo: "asc" }],
    })

    // Group by auction code
    const auctionMap = new Map<
      string,
      { code: string; name: string | null; date: string | null; items: typeof rows }
    >()
    for (const item of rows) {
      const code = item.auctionCode!
      if (!auctionMap.has(code)) {
        auctionMap.set(code, {
          code,
          name: item.auctionName ?? null,
          date: item.auctionDate ?? null,
          items: [],
        })
      }
      auctionMap.get(code)!.items.push(item)
    }

    const auctions = [...auctionMap.values()].sort(
      (a, b) => (b.date ?? "").localeCompare(a.date ?? ""),
    )

    return NextResponse.json({ auctions, total: rows.length })
  } catch (e: any) {
    console.error("sale-checklist error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
