import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET — list auctions with lot counts for the auction picker
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const raw = await prisma.catalogueAuction.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        code: true,
        name: true,
        auctionType: true,
        auctionDate: true,
        _count: { select: { lots: true } },
      },
    })

    const auctions = raw.map(a => ({
      id:          a.id,
      code:        a.code,
      name:        a.name,
      auctionType: a.auctionType,
      auctionDate: a.auctionDate?.toISOString() ?? null,
      lotCount:    a._count.lots,
    }))

    return NextResponse.json({ auctions })
  } catch (e: any) {
    console.error("web-descriptions auctions error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
