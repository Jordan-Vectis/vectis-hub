import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getDepartmentAccessForSession, auctionWhere } from "@/lib/departments"

export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    // Same department filter as the cataloguing sale lists, so the Auction AI
    // dropdown can't be used to reach another department's sale.
    const access = await getDepartmentAccessForSession(session.user.id)

    const auctions = await prisma.catalogueAuction.findMany({
      where:   auctionWhere(access),
      select:  { code: true, name: true, auctionDate: true },
      orderBy: { auctionDate: "desc" },
    })

    return NextResponse.json(auctions)
  } catch (e: any) {
    console.error("auction-ai/auctions error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
