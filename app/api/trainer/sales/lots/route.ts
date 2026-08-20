import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getDepartmentAccessForSession, canSeeAuction } from "@/lib/departments"
import { lotPhotoUrl } from "@/lib/photo-url"

// GET /api/trainer/sales/lots?code=F064
// A real sale's lots, shaped for the Saleroom Trainer's Test Mode.
//
// Read-only. The trainer runs its practice bidding entirely in memory and never
// writes back — a trainee hammering a lot here must not touch the real one.

// Enough for a long practice run without shipping a whole 5,000-lot sale into a
// browser. The response reports `total` so the picker can say what it truncated
// rather than quietly showing a short sale.
const MAX_LOTS = 500

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const code = req.nextUrl.searchParams.get("code")?.trim().toUpperCase()
    if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 })

    const auction = await prisma.catalogueAuction.findFirst({
      where:  { code },
      select: { id: true, code: true, name: true, auctionType: true },
    })
    if (!auction) return NextResponse.json({ error: `No sale found for code "${code}"` }, { status: 404 })

    const access = await getDepartmentAccessForSession(session.user.id)
    if (!canSeeAuction(access, auction)) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const total = await prisma.catalogueLot.count({ where: { auctionId: auction.id } })

    const lots = await prisma.catalogueLot.findMany({
      where:   { auctionId: auction.id },
      select:  {
        id:              true,
        title:           true,
        description:     true,
        barcode:         true,
        receiptUniqueId: true,
        estimateLow:     true,
        estimateHigh:    true,
        imageUrls:       true,
      },
      // Same order and same lot label the real live sale uses
      // (lib/auction-socket.js), so a practice run walks the sale in the order
      // it would actually be sold.
      orderBy: { createdAt: "asc" },
      take:    MAX_LOTS,
    })

    return NextResponse.json({
      code:     auction.code,
      name:     auction.name,
      total,
      returned: lots.length,
      lots: lots.map(l => ({
        id:   l.barcode || l.receiptUniqueId || l.id,
        est:  l.estimateLow != null && l.estimateHigh != null ? `${l.estimateLow}-${l.estimateHigh}`
            : l.estimateLow != null ? `${l.estimateLow}+`
            : "",
        desc: l.description?.trim() || l.title || "—",
        img:  lotPhotoUrl(l.imageUrls?.[0]),
      })),
    })
  } catch (e: unknown) {
    console.error("trainer/sales/lots error:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    )
  }
}
