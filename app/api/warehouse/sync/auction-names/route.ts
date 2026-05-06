import { NextRequest, NextResponse } from "next/server"
import { getBCTokenAny, bcPage } from "@/lib/bc"
import { prisma } from "@/lib/prisma"
import { isAuthedOrCron } from "@/lib/auth-or-cron"

// POST /api/warehouse/sync/auction-names
// Populates WarehouseItem.auctionName for every distinct auctionCode in the DB.
// Strategy: for each unique auctionCode, pick one representative uniqueId, then
// batch-query Auction_Lines_Excel by EVA_UniqueID to get EVA_AuctionName, then
// updateMany all items sharing that code.
// Runs after receipt-lines + auction-lines sync so codes are already present.

export async function POST(req: NextRequest) {
  try {
    if (!await isAuthedOrCron(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const token = await getBCTokenAny()
    if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

    // Get one representative uniqueId per distinct auctionCode (only where name is missing)
    const rows = await prisma.warehouseItem.findMany({
      where: { auctionCode: { not: null }, auctionName: null },
      select: { auctionCode: true, uniqueId: true },
      orderBy: { uniqueId: "asc" },
    })

    const codeToUniqueId = new Map<string, string>()
    for (const r of rows) {
      if (!codeToUniqueId.has(r.auctionCode!)) {
        codeToUniqueId.set(r.auctionCode!, r.uniqueId)
      }
    }

    if (codeToUniqueId.size === 0) {
      return NextResponse.json({ ok: true, codesFound: 0, namesWritten: 0, message: "All names already stored" })
    }

    const entries    = [...codeToUniqueId.entries()]
    const BATCH      = 30
    let namesWritten = 0
    const errors: string[] = []

    for (let i = 0; i < entries.length; i += BATCH) {
      const batch  = entries.slice(i, i + BATCH)
      const filter = batch.map(([, id]) => `EVA_UniqueID eq '${id}'`).join(" or ")

      try {
        const bcRows = await bcPage(token, "Auction_Lines_Excel", {
          $filter: filter,
          $top:    batch.length + 5,
        })

        const updates: Promise<any>[] = []
        for (const r of bcRows) {
          const uid  = String(r.EVA_UniqueID    ?? "").trim()
          const name = String(r.EVA_AuctionName ?? "").trim()
          if (!uid || !name) continue

          const code = batch.find(([, id]) => id === uid)?.[0]
          if (!code) continue

          updates.push(
            prisma.warehouseItem.updateMany({
              where: { auctionCode: code },
              data:  { auctionName: name },
            }).then(res => { namesWritten += res.count }),
          )
        }
        await Promise.all(updates)
      } catch (e: any) {
        errors.push(e.message)
      }
    }

    return NextResponse.json({
      ok:           errors.length === 0,
      codesFound:   codeToUniqueId.size,
      namesWritten,
      errors:       errors.length > 0 ? errors : undefined,
    })
  } catch (e: any) {
    console.error("auction-names sync error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
