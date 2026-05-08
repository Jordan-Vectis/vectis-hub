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

    const BATCH      = 20
    let namesWritten = 0
    const errors: string[] = []

    for (let i = 0; i < codes.length; i += BATCH) {
      const batch  = codes.slice(i, i + BATCH)
      const filter = batch.map(c => `EVA_AuctionNo eq '${c}'`).join(" or ")

      try {
        // Large $top so we have multiple rows per code; auction codes
        // sometimes get reused for new sales (old + new under same code),
        // and we need enough rows to detect that.
        const bcRows = await bcPage(token, "Auction_Lines_Excel", {
          $filter: filter,
          $top:    batch.length * 50,
        })

        // For each code, collect every distinct (name, latestDate) pair seen.
        // Codes that have been reused for multiple sales will produce more
        // than one entry — we then pick the name with the most recent date.
        // If no usable date is present, fall back to the most-frequent name.
        type SeenName = { name: string; latestDate: string; count: number }
        const seenByCode = new Map<string, Map<string, SeenName>>()

        for (const r of bcRows) {
          const code = String(r.EVA_AuctionNo ?? "").trim().toUpperCase()
          const name = String(r.EVA_AuctionName    ?? "").trim()
          if (!code || !name) continue
          const date = String(r.EVA_AuctionDate ?? "").trim() // "YYYY-MM-DD" or empty

          const inner = seenByCode.get(code) ?? new Map<string, SeenName>()
          const existing = inner.get(name) ?? { name, latestDate: "", count: 0 }
          existing.count++
          if (date && date > existing.latestDate) existing.latestDate = date
          inner.set(name, existing)
          seenByCode.set(code, inner)
        }

        // Pick the winning name per code: latest date wins; otherwise mode.
        const nameByCode = new Map<string, string>()
        for (const [code, inner] of seenByCode) {
          const candidates = [...inner.values()]
          if (candidates.length === 0) continue
          candidates.sort((a, b) => {
            // Prefer the one with a real date — newest first
            if (a.latestDate && b.latestDate) return b.latestDate.localeCompare(a.latestDate)
            if (a.latestDate) return -1
            if (b.latestDate) return  1
            // Both missing date — pick most frequent
            return b.count - a.count
          })
          nameByCode.set(code, candidates[0].name)
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
