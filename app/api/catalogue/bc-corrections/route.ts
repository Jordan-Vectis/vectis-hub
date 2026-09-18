import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { buildToteMap, checkLot, toteLookupVariants } from "@/lib/tote-check"

// GET /api/catalogue/bc-corrections?auctionId=xxx
//
// What needs putting right in BC. BC is correct, our data was wrong — and the
// wrong values are most likely what got pushed INTO BC — so each row says
// "this barcode is on the wrong receipt/vendor in BC, here's where it belongs".
//
// ⚠ The list is LIVE, not a leftover of the Match BC button. Jordan works
// through BC *before* correcting the Hub and checks back afterwards, so it has
// to show today's mismatches straight away. Two sources, merged on lotId:
//
//   1. Live mismatches — computed now, the same way the Tote Check tab does.
//   2. Saved rows (CatalogueBcCorrection) — written when a row is ticked, and
//      by Match BC. These are what keeps the list alive AFTER the lots have
//      been corrected, when the live mismatch no longer exists.
//
// A saved row always wins: it holds the tick and the values as they were when
// the discrepancy was real.

export type BcCorrectionRow = {
  // Identity is the LOT — a live row has no saved record yet.
  lotId:           string
  saved:           boolean
  barcode:         string | null
  receiptUniqueId: string | null
  /** BC's OWN unique ID for this barcode, as at the last Data Sync (WarehouseItem). The Hub's
   *  receiptUniqueId is blank until BC Match is run — this is what fills the gap. */
  bcUniqueId:      string | null
  title:           string | null
  tote:            string | null
  oldVendor:       string | null
  oldReceipt:      string | null
  newVendor:       string | null
  newReceipt:      string | null
  newVendorName:   string | null
  done:            boolean
  doneBy:          string | null
  doneAt:          string | null
  // The Hub still holds the wrong value (Match BC hasn't been run on it yet)
  stillWrong:      boolean
}

export type BcCorrectionGroup = {
  key:        string
  oldReceipt: string | null
  oldVendor:  string | null
  newReceipt: string | null
  newVendor:  string | null
  newVendorName: string | null
  rows:       BcCorrectionRow[]
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const auctionId = req.nextUrl.searchParams.get("auctionId")?.trim()
    if (!auctionId) return NextResponse.json({ error: "Missing auctionId" }, { status: 400 })

    // ── 1. Live mismatches ──
    const lots = await prisma.catalogueLot.findMany({
      where:  { auctionId },
      select: {
        id: true, barcode: true, receiptUniqueId: true, title: true,
        vendor: true, tote: true, receipt: true,
      },
      orderBy: { createdAt: "asc" },
    })

    const variants = toteLookupVariants(lots)
    const totes = variants.length > 0
      ? await prisma.warehouseTote.findMany({
          where:  { toteNo: { in: variants } },
          select: { toteNo: true, receiptNo: true, vendorNo: true, vendorName: true },
        })
      : []
    const toteMap = buildToteMap(totes)

    const live = new Map<string, BcCorrectionRow>()
    for (const l of lots) {
      const { issues, tote } = checkLot(l, toteMap)
      // Only a WRONG value means BC needs putting right. A blank was never
      // pushed as anything, so filling one in isn't a BC correction.
      if (!tote) continue
      if (!issues.includes("receipt_mismatch") && !issues.includes("vendor_mismatch")) continue
      live.set(l.id, {
        lotId: l.id, saved: false,
        barcode: l.barcode, receiptUniqueId: l.receiptUniqueId, bcUniqueId: null, title: l.title, tote: l.tote,
        oldVendor: l.vendor, oldReceipt: l.receipt,
        newVendor: tote.vendorNo, newReceipt: tote.receiptNo, newVendorName: tote.vendorName,
        done: false, doneBy: null, doneAt: null,
        stillWrong: true,
      })
    }

    // ── 2. Saved rows (ticked, or written by Match BC) ──
    // Tolerated absent: the table only exists after Run Migrations, while the
    // code reaches Railway immediately.
    let saved: Awaited<ReturnType<typeof prisma.catalogueBcCorrection.findMany>> = []
    let notReady = false
    try {
      saved = await prisma.catalogueBcCorrection.findMany({ where: { auctionId } })
    } catch {
      notReady = true
    }

    // ⚠⚠ REVERSED 2026-08-20 (Jordan). This list is now LIVE MISMATCHES ONLY. A saved row
    // contributes its TICK and nothing else — it can no longer put a lot on the list by itself.
    //
    // It used to merge saved rows in so the list survived Tote Check → Match BC tidying the Hub.
    // The effect on F109 was 97 listed against 4 real ones: Locking Check said 591/595 and Tote
    // Check said "4 to look at", while this tab showed 97, so the one screen meant to drive BC
    // work disagreed with both live checks and could not be trusted. Jordan: "the 4 wrong is the
    // correct answer and thats what BC corrections should also show".
    //
    // ⚠ THE TRADE, so nobody reinstates it by accident: a lot whose Hub value has already been
    // corrected no longer appears here, even if BC still holds the old value. The list follows
    // the same source of truth as Tote Check — the BC tote data — so a row clears when BC is put
    // right and Data Sync runs, NOT when the Hub is tidied.
    const merged = new Map<string, BcCorrectionRow>(live)
    for (const s of saved) {
      const liveRow = live.get(s.lotId)
      if (!liveRow) continue   // no live mismatch — nothing to correct in BC
      merged.set(s.lotId, {
        lotId: s.lotId, saved: true,
        barcode: s.barcode, receiptUniqueId: s.receiptUniqueId, bcUniqueId: null, title: s.title, tote: s.tote,
        // ⚠ LIVE values win. The saved row holds them as they were when it was written, which
        // may be stale — showing those would tell someone to make a move BC no longer needs.
        oldVendor: liveRow.oldVendor, oldReceipt: liveRow.oldReceipt,
        newVendor: liveRow.newVendor, newReceipt: liveRow.newReceipt,
        newVendorName: liveRow?.newVendorName ?? null,
        done: s.done, doneBy: s.doneBy, doneAt: s.doneAt?.toISOString() ?? null,
        stillWrong: true,   // only live rows reach here now
      })
    }

    // ── 3. BC's OWN unique ID for each lot, found by BARCODE in the synced BC data ──
    // ⚠⚠ The Hub never mints unique IDs (RULES.md) — a lot's receiptUniqueId is blank until BC
    // Match is run on the sale. But this tab exists to hand BC's Transfer/Copy dialog a list of
    // unique IDs, and these are exactly the lots least likely to have been matched: they went into
    // BC wrong. Jordan, 2026-09-18: 45 of 47 lots on F134 had no ID, so the button read "Copy 0
    // IDs" on the one screen built for copying them — "there has 100% been a BC sync done since
    // then so it should have the ids". It did: WarehouseItem holds BC's unique ID against the
    // internal barcode. Matched ON the barcode and the ID is BC's own, which is the one direction
    // the barcode-only rule allows (never the other way round).
    // ⚠ It is what BC held at the LAST DATA SYNC. A line transferred since then has a new ID, which
    // is why the tab prefers the ID from an uploaded export over this one.
    const rowsNow = [...merged.values()]
    const codes = [...new Set(rowsNow.map(r => (r.barcode ?? "").trim()).filter(Boolean))]
    if (codes.length > 0) {
      try {
        // The three spellings keep this on the barcode index; upper() in SQL would scan the table.
        const spellings = [...new Set(codes.flatMap(c => [c, c.toUpperCase(), c.toLowerCase()]))]
        const items = await prisma.warehouseItem.findMany({
          where:  { barcode: { in: spellings } },
          select: { barcode: true, uniqueId: true, receiptNo: true },
        })
        const byCode = new Map<string, { uniqueId: string; receiptNo: string | null }[]>()
        for (const it of items) {
          const k = (it.barcode ?? "").trim().toUpperCase()
          if (!k) continue
          if (!byCode.has(k)) byCode.set(k, [])
          byCode.get(k)!.push({ uniqueId: it.uniqueId, receiptNo: it.receiptNo })
        }
        const same = (a: string | null, b: string | null) => !!a && !!b && a.trim().toUpperCase() === b.trim().toUpperCase()
        for (const r of rowsNow) {
          const hits = byCode.get((r.barcode ?? "").trim().toUpperCase())
          if (!hits?.length) continue
          // A barcode normally appears once. If BC holds it twice, the line on the receipt this row
          // is about is the one to move; failing that, the one already where it belongs; else the first.
          const pick = hits.find(h => same(h.receiptNo, r.oldReceipt)) ?? hits.find(h => same(h.receiptNo, r.newReceipt)) ?? hits[0]
          r.bcUniqueId = pick.uniqueId
        }
      } catch (e) {
        // The sync table being absent or slow must not take the to-do list down with it.
        console.error("catalogue/bc-corrections: BC unique ID lookup failed:", e)
      }
    }

    const groups = new Map<string, BcCorrectionGroup>()
    for (const r of merged.values()) {
      const key = `${r.oldReceipt ?? ""}|${r.oldVendor ?? ""}|${r.newReceipt ?? ""}|${r.newVendor ?? ""}`
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          oldReceipt: r.oldReceipt, oldVendor: r.oldVendor,
          newReceipt: r.newReceipt, newVendor: r.newVendor, newVendorName: r.newVendorName,
          rows: [],
        })
      }
      const g = groups.get(key)!
      if (!g.newVendorName && r.newVendorName) g.newVendorName = r.newVendorName
      g.rows.push(r)
    }

    for (const g of groups.values()) {
      g.rows.sort((a, b) => (a.barcode ?? "").localeCompare(b.barcode ?? "", undefined, { numeric: true }))
    }

    // Outstanding work first — a group that's fully ticked off drops to the end.
    const out = [...groups.values()].sort((a, b) => {
      const aLeft = a.rows.filter(r => !r.done).length
      const bLeft = b.rows.filter(r => !r.done).length
      if ((aLeft === 0) !== (bLeft === 0)) return aLeft === 0 ? 1 : -1
      return (a.oldReceipt ?? "").localeCompare(b.oldReceipt ?? "", undefined, { numeric: true })
    })

    const all = [...merged.values()]
    return NextResponse.json({
      groups: out,
      total:  all.length,
      done:   all.filter(r => r.done).length,
      notReady,
    })
  } catch (e: any) {
    console.error("catalogue/bc-corrections GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
