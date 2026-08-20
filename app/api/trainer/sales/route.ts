import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getDepartmentAccessForSession, auctionWhere } from "@/lib/departments"

// GET /api/trainer/sales
// Sales the viewer may pick from in the Saleroom Trainer's Test Mode, so a
// practice run can use the lots from a real sale instead of the built-in ten.
//
// Read-only, and it stays read-only: the trainer never writes a bid, a hammer
// price or anything else back to a CatalogueLot. Same department filter as the
// cataloguing sale lists (RULES.md → "Departments gate which sales a cataloguer
// sees"), so this cannot be used to reach another department's sale.

export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const access = await getDepartmentAccessForSession(session.user.id)

    const auctions = await prisma.catalogueAuction.findMany({
      where:   auctionWhere(access),
      select:  {
        code:        true,
        name:        true,
        auctionDate: true,
        auctionType: true,
        _count:      { select: { lots: true } },
      },
      orderBy: { auctionDate: "desc" },
    })

    // A sale with no lots would load an empty trainer, so leave it out of the list.
    return NextResponse.json(
      auctions
        .filter(a => a._count.lots > 0)
        .map(a => ({
          code:        a.code,
          name:        a.name,
          auctionDate: a.auctionDate,
          auctionType: a.auctionType,
          lotCount:    a._count.lots,
        })),
    )
  } catch (e: unknown) {
    console.error("trainer/sales error:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    )
  }
}
