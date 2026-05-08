import { NextRequest, NextResponse } from "next/server"
import { getBCTokenAny, bcPage } from "@/lib/bc"
import { prisma } from "@/lib/prisma"
import { isAuthedOrCron } from "@/lib/auth-or-cron"

// POST /api/warehouse/sync/auction-names
// Populates WarehouseItem.auctionName for every distinct auctionCode in the DB.
// Strategy: batch-query Auction_Lines_Excel by EVA_AuctionNo (the auction code)
// directly — this is reliable because we're looking up the name FOR the code, not
// indirectly via a UniqueID which may belong to a different auction context.
// Takes a large $top per batch so we get at least one row per code, then groups
// by EVA_AuctionNo on the client side to get the name for each code.
//
// ⚠ DO NOT change EVA_AuctionNo back to EVA_SalesAllocation. The latter
// exists on Receipt_Lines_Excel and Auction_Receipt_Lines_Excel, but NOT
// on Auction_Lines_Excel — using it here causes a BC 400 BadRequest, and
// because errors are caught per batch the sync silently fails for every
// code, leaving stale cached names in the DB. Confirmed via
// /api/bc/api-viewer?endpoint=Auction_Lines_Excel: the auction code column
// is EVA_AuctionNo (e.g. "A999", "F066").

export async function POST(req: NextRequest) {
  try {
    if (!await isAuthedOrCron(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const token = await getBCTokenAny()
    if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

    // Optional ?code=F066 — diagnostic mode that processes a single code and
    // returns verbose info about what BC sent back and what we wrote.
    const debugCode = new URL(req.url).searchParams.get("code")?.trim().toUpperCase()
    if (debugCode) {
      const bcRows = await bcPage(token, "Auction_Lines_Excel", {
        $filter: `EVA_AuctionNo eq '${debugCode}'`,
        $top:    100,
      })
      const namesSeen = new Map<string, { count: number; latestDate: string }>()
      for (const r of bcRows) {
        const name = String(r.EVA_AuctionName ?? "").trim()
        const date = String(r.EVA_AuctionDate ?? "").trim()
        if (!name) continue
        const e = namesSeen.get(name) ?? { count: 0, latestDate: "" }
        e.count++
        if (date && date > e.latestDate) e.latestDate = date
        namesSeen.set(name, e)
      }
      const candidates = [...namesSeen.entries()].map(([name, v]) => ({ name, ...v }))
      candidates.sort((a, b) => {
        if (a.latestDate && b.latestDate) return b.latestDate.localeCompare(a.latestDate)
        if (a.latestDate) return -1
        if (b.latestDate) return  1
        return b.count - a.count
      })
      const winner = candidates[0]?.name ?? null
      let updated = 0
      if (winner) {
        const r = await prisma.warehouseItem.updateMany({
          where: { auctionCode: debugCode },
          data:  { auctionName: winner },
        })
        updated = r.count
      }
      const after = await prisma.warehouseItem.findFirst({
        where:  { auctionCode: debugCode },
        select: { auctionCode: true, auctionName: true },
      })
      return NextResponse.json({
        debugCode,
        bcRowsReceived: bcRows.length,
        candidates,
        winner,
        updateManyCount: updated,
        afterUpdate: after,
      })
    }

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

    // Hardcoded overrides — applied after BC lookup so they always win
    const OVERRIDES: Record<string, string> = {
      "A999": "Lost/Missing/Re-Receipted & Lots with BC Issues",
    }

    let namesWritten = 0
    let codesProcessed = 0
    const errors: string[] = []

    // Process codes one at a time. Earlier we tried batching 20 codes per BC
    // call with $top: 1000, but BC's row distribution across an OR filter is
    // uneven — codes with thousands of historical rows would dominate and
    // crowd newer sales out of the response, leaving them stuck with stale
    // names. One-code-at-a-time is slower but 100% reliable: every code gets
    // its own focused query and a fair sample of rows.
    type SeenName = { name: string; latestDate: string; count: number }

    for (const code of codes) {
      try {
        const bcRows = await bcPage(token, "Auction_Lines_Excel", {
          $filter: `EVA_AuctionNo eq '${code}'`,
          $top:    100,  // 100 rows is plenty to detect the right name + handle reused codes
        })

        const seen = new Map<string, SeenName>()
        for (const r of bcRows) {
          const name = String(r.EVA_AuctionName ?? "").trim()
          if (!name) continue
          const date = String(r.EVA_AuctionDate ?? "").trim()
          const e = seen.get(name) ?? { name, latestDate: "", count: 0 }
          e.count++
          if (date && date > e.latestDate) e.latestDate = date
          seen.set(name, e)
        }

        if (seen.size === 0) continue
        const candidates = [...seen.values()].sort((a, b) => {
          if (a.latestDate && b.latestDate) return b.latestDate.localeCompare(a.latestDate)
          if (a.latestDate) return -1
          if (b.latestDate) return  1
          return b.count - a.count
        })
        const winner = candidates[0].name

        const r = await prisma.warehouseItem.updateMany({
          where: { auctionCode: code },
          data:  { auctionName: winner },
        })
        namesWritten += r.count
        codesProcessed++
      } catch (e: any) {
        errors.push(`${code}: ${e.message}`)
      }
    }

    // Apply hardcoded overrides
    for (const [code, name] of Object.entries(OVERRIDES)) {
      if (codes.includes(code)) {
        await prisma.warehouseItem.updateMany({
          where: { auctionCode: code },
          data:  { auctionName: name },
        }).then(res => { namesWritten += res.count })
      }
    }

    return NextResponse.json({
      ok:             errors.length === 0,
      codesFound:     codes.length,
      codesProcessed,
      namesWritten,
      errors:         errors.length > 0 ? errors : undefined,
    })
  } catch (e: any) {
    console.error("auction-names sync error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
