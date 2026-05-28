import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import * as XLSX from "xlsx"

// GET /api/catalogue/export?code=X
// Returns an Excel workbook with two sheets: Auction + Lots
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const code = req.nextUrl.searchParams.get("code")?.trim().toUpperCase()
    if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 })

    const auction = await prisma.catalogueAuction.findFirst({
      where: { code },
      include: {
        lots: { orderBy: { createdAt: "asc" } },
      },
    })

    if (!auction) return NextResponse.json({ error: `No auction found for code "${code}"` }, { status: 404 })

    // ── Sheet 1: Auction ──────────────────────────────────────────────────────
    const auctionSheet = XLSX.utils.json_to_sheet([{
      id:          auction.id,
      code:        auction.code,
      name:        auction.name,
      auctionDate: auction.auctionDate ? auction.auctionDate.toISOString() : "",
      auctionType: auction.auctionType,
      eventName:   auction.eventName ?? "",
      locked:      auction.locked,
      finished:    auction.finished,
      complete:    auction.complete,
      catalogued:  auction.catalogued,
      addedToBC:   auction.addedToBC,
      photography: auction.photography,
      aiRan:       auction.aiRan,
      published:   auction.published,
      notes:       auction.notes ?? "",
    }])

    // ── Sheet 2: Lots ─────────────────────────────────────────────────────────
    const lotsData = auction.lots.map(l => ({
      id:              l.id,
      title:           l.title,
      description:     l.description,
      keyPoints:       l.keyPoints,
      barcode:         l.barcode ?? "",
      receiptUniqueId: l.receiptUniqueId ?? "",
      estimateLow:     l.estimateLow ?? "",
      estimateHigh:    l.estimateHigh ?? "",
      aiEstimateLow:   l.aiEstimateLow ?? "",
      aiEstimateHigh:  l.aiEstimateHigh ?? "",
      startingBid:     l.startingBid ?? "",
      reserve:         l.reserve ?? "",
      currentBid:      l.currentBid ?? "",
      hammerPrice:     l.hammerPrice ?? "",
      condition:       l.condition ?? "",
      vendor:          l.vendor ?? "",
      tote:            l.tote ?? "",
      receipt:         l.receipt ?? "",
      category:        l.category ?? "",
      subCategory:     l.subCategory ?? "",
      brand:           l.brand ?? "",
      notes:           l.notes ?? "",
      extraDetails:    l.extraDetails ?? "",
      imageUrls:       l.imageUrls.join(", "),
      status:          l.status,
      aiUpgraded:      l.aiUpgraded,
      addedToBC:       l.addedToBC,
      createdByName:   l.createdByName ?? "",
      createdAt:       l.createdAt.toISOString(),
    }))

    const lotsSheet = lotsData.length > 0
      ? XLSX.utils.json_to_sheet(lotsData)
      : XLSX.utils.json_to_sheet([{}]) // empty sheet with no rows

    // ── Workbook ──────────────────────────────────────────────────────────────
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, auctionSheet, "Auction")
    XLSX.utils.book_append_sheet(wb, lotsSheet,    "Lots")

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" })

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${code}.xlsx"`,
      },
    })
  } catch (e: any) {
    console.error("catalogue/export error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
