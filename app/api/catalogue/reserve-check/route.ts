import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/catalogue/reserve-check?auctionId=xxx
//
// "Which of this sale's reserves have actually reached Business Central?"
//
// Jordan, 2026-09-02: a reserve cannot be typed into BC until the lot is in BC, so he records it
// in the Hub first and wants Locking Check to remind him. ⚠⚠ The reminder CLEARS ITSELF — BC's
// own reserve comes back on the sync (`WarehouseItem.reservePrice`, 1,889 rows already carry
// one), so there is no "done" tick for anybody to forget to press. Same principle as the In BC
// column on Auction Manager: measure it, never assert it.
//
// ⚠ BARCODE ONLY, never receiptUniqueId — the standing rule for deciding anything about BC.
// ⚠ It reflects the last Data Sync, not BC live, so the tab reports `lastSync` alongside and
// says so. Read-only: it reports, it never writes.

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const auctionId = req.nextUrl.searchParams.get("auctionId")?.trim()
    if (!auctionId) return NextResponse.json({ error: "Missing auctionId" }, { status: 400 })

    // Only the lots that actually have a reserve recorded here — the rest cannot be outstanding.
    const lots = await prisma.catalogueLot.findMany({
      where:  { auctionId, reserve: { not: null }, barcode: { not: null } },
      select: { id: true, barcode: true, reserve: true },
    })
    if (lots.length === 0) return NextResponse.json({ inBc: [], notInBc: [], lastSync: null })

    const barcodes = lots.map(l => l.barcode!).filter(b => b.trim())
    const rows = barcodes.length
      ? await prisma.$queryRaw<{ barcode: string; reservePrice: number | null }[]>`
          SELECT w.barcode AS barcode, max(w."reservePrice") AS "reservePrice"
          FROM "WarehouseItem" w
          WHERE upper(w.barcode) = ANY(${barcodes.map(b => b.toUpperCase())}::text[])
          GROUP BY w.barcode`
      : []

    // ⚠ Upper-cased both sides — barcodes are stored as they were typed.
    const bcReserve = new Map(rows.map(r => [(r.barcode ?? "").toUpperCase(), Number(r.reservePrice ?? 0)]))

    const inBc: string[] = []
    const notInBc: { id: string; barcode: string; reserve: number; inBcReserve: number | null }[] = []
    for (const l of lots) {
      const key = (l.barcode ?? "").toUpperCase()
      const bc  = bcReserve.get(key)
      // Not in the sync at all → the lot itself is not in BC yet, so the reserve cannot be done.
      // In the sync with no reserve → in BC, reserve still to type in. Either way it is outstanding.
      if (bc && bc > 0) inBc.push(l.id)
      else notInBc.push({ id: l.id, barcode: l.barcode!, reserve: l.reserve!, inBcReserve: bc ?? null })
    }

    const latest = await prisma.warehouseItem.findFirst({
      orderBy: { updatedAt: "desc" }, select: { updatedAt: true },
    })

    return NextResponse.json({
      inBc, notInBc,
      lastSync: latest?.updatedAt?.toISOString() ?? null,
    })
  } catch (e: any) {
    console.error("catalogue/reserve-check error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
