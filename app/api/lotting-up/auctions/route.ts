import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getDepartmentAccessForSession, auctionWhere } from "@/lib/departments"

// GET /api/lotting-up/auctions
//
// The sale picker for Lotting Up → "Add to sale". Same department filter as
// every other sale list in the app, so this tool can't be used to reach a sale
// the cataloguer's departments don't cover. Unlike /api/auction-ai/auctions this
// returns the id (needed to create lots against) and addedToBC (so the page can
// warn about the BC lock before the cataloguer types a barcode).

export type LottingUpAuction = {
  id:          string
  code:        string
  name:        string
  auctionDate: string | null
  addedToBC:   boolean
  lotCount:    number
}

export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const access = await getDepartmentAccessForSession(session.user.id)

    const auctions = await prisma.catalogueAuction.findMany({
      where:   auctionWhere(access),
      select:  {
        id: true, code: true, name: true, auctionDate: true, addedToBC: true,
        _count: { select: { lots: true } },
      },
      orderBy: { auctionDate: "desc" },
    })

    const out: LottingUpAuction[] = auctions.map(a => ({
      id:          a.id,
      code:        a.code,
      name:        a.name,
      auctionDate: a.auctionDate?.toISOString() ?? null,
      addedToBC:   a.addedToBC,
      lotCount:    a._count.lots,
    }))

    return NextResponse.json({ auctions: out })
  } catch (e: any) {
    console.error("lotting-up/auctions error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
