import { NextRequest, NextResponse } from "next/server"
import { getBCTokenAny, bcPage } from "@/lib/bc"
import { prisma } from "@/lib/prisma"
import { isAuthedOrCron } from "@/lib/auth-or-cron"

// POST /api/warehouse/sync/auction-names
// Populates WarehouseItem.auctionName for every distinct auctionCode in the DB.
// Strategy: batch-query Auction_Lines_Excel by EVA_SalesAllocation (the auction code)
// directly — this is reliable because we're looking up the name FOR the code, not
// indirectly via a UniqueID which may belong to a different auction context.
// Takes a large $top per batch so we get at least one row per code, then groups
// by EVA_SalesAllocation on the client side to get the name for each code.

export async function POST(req: NextRequest) {
  try {
    if (!await isAuthedOrCron(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const token = await getBCTokenAny()
    if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

    // Get all distinct auction codes — refresh all names, not just missing ones,
    // so corrected names from BC always overwrite stale cached values.
    const rows = await prisma.warehouseItem.findMany({
      where:    { auctionCode: { not: null } },
      select:   { auctionCode: true },
      distinct: ["auctionCode"],
      orderBy:  { auctionCode: "asc" },
    })

    const codes = rows.map(r => r.auctionCode!)
    if (codes.length === 0) {
      return NextResponse.json({ ok: true, codesFound: 0, namesWritten: 0, message: "No auction codes in DB" })
    }

    const BATCH      = 20
    let namesWritten = 0
    const errors: string[] = []

    for (let i = 0; i < codes.length; i += BATCH) {
      const batch  = codes.slice(i, i + BATCH)
      const filter = batch.map(c => `EVA_SalesAllocation eq '${c}'`).join(" or ")

      try {
        // Large $top to ensure we get at least one row per code in the batch
        const bcRows = await bcPage(token, "Auction_Lines_Excel", {
          $filter: filter,
          $top:    batch.length * 15,
        })

        // Group by EVA_SalesAllocation — take first non-empty name per code
        const nameByCode = new Map<string, string>()
        for (const r of bcRows) {
          const code = String(r.EVA_SalesAllocation ?? "").trim().toUpperCase()
          const name = String(r.EVA_AuctionName    ?? "").trim()
          if (!code || !name || nameByCode.has(code)) continue
          nameByCode.set(code, name)
        }

        const updates: Promise<any>[] = []
        for (const [code, name] of nameByCode) {
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
      codesFound:   codes.length,
      namesWritten,
      errors:       errors.length > 0 ? errors : undefined,
    })
  } catch (e: any) {
    console.error("auction-names sync error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
