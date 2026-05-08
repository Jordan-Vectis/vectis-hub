import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// Returns distinct sales (auctionCode + auctionName + auctionDate) that have at least one
// sold lot. Sorted newest-first.
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    // Distinct on auctionCode — each sale has one row per code.
    const rows = await prisma.warehouseItem.findMany({
      where: {
        auctionCode: { not: null },
        OR: [
          { hammerPrice: { gt: 0 } },
          { lowEstimate: { gt: 0 } },
        ],
      },
      select: { auctionCode: true, auctionName: true, auctionDate: true },
      distinct: ["auctionCode"],
      take: 2000,
    })

    const sales = rows
      .filter(r => r.auctionCode)
      .map(r => ({
        auctionCode: r.auctionCode!,
        auctionName: r.auctionName ?? "",
        auctionDate: r.auctionDate ?? "",
      }))
      // Newest first; sales without a date go last
      .sort((a, b) => {
        if (!a.auctionDate && !b.auctionDate) return 0
        if (!a.auctionDate) return 1
        if (!b.auctionDate) return -1
        return b.auctionDate.localeCompare(a.auctionDate)
      })

    return NextResponse.json({ sales })
  } catch (e: any) {
    console.error("marketing/sales error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
