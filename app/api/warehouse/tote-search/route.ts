import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { searchReceiptTotes } from "@/lib/receipt-totes"
import { normaliseCode, type CustomerSnapshot } from "@/lib/goods-in/model"

// ── Goods In fallback (2026-10-15) ───────────────────────────────────────────────────────────
// Totes and pallets booked in through the Hub's own Goods In (/tools/warehouse) are not in our copy
// of BC — Goods In never touches Business Central — so the wizard's tote box and Lotting Up found
// nothing for them. When, and ONLY when, both BC searches below come back empty, Goods In is
// searched the same way (from the start of the number, then anywhere) and answers in the same row
// shape as a BC row, plus `source: "goods-in"`. Any search BC answers is returned exactly as before.
// ⚠ `catalogued` is null (the wizard words a true value as BC's tick and "the previous customer",
// false for a Goods In tote); `syncedAt` is null (nothing was synced). Totes on a VOIDED receipt
// are left out, and so are totes on a check-in that hasn't been booked in yet (a DRAFT receipt —
// numbered so its labels can be printed, but not booked in, and it may still be thrown away).
// Migration-safe: before Run Migrations the tables don't exist, and any failure here
// means "Goods In has nothing" — the reply is then the same empty list it always was.
async function searchGoodsIn(q: string) {
  const code = normaliseCode(q)
  if (!code) return []
  // A receipt with no status counts as live; Prisma's `notIn` alone would drop NULLs as well as
  // voids. Drafts (not booked in yet) are left out exactly like voids — see above.
  const live = { receipt: { is: { OR: [{ status: null }, { status: { notIn: ["void", "draft"] } }] } } }
  const select = {
    id: true, category: true, description: true, locationCode: true,
    receipt: {
      select: {
        id: true, vendorNo: true, customer: true,
        contact: { select: { name: true, goodsInCustomer: { select: { vendorNo: true } } } },
      },
    },
  } as const
  try {
    let rows = await prisma.goodsInContainer.findMany({
      where: { id: { startsWith: code }, ...live }, select, orderBy: { id: "asc" }, take: 20,
    })
    if (rows.length === 0) {
      rows = await prisma.goodsInContainer.findMany({
        where: { id: { contains: code }, ...live }, select, orderBy: { id: "asc" }, take: 20,
      })
    }
    const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)
    return rows.map(c => {
      const snap = c.receipt.customer && typeof c.receipt.customer === "object"
        ? (c.receipt.customer as Partial<CustomerSnapshot>)
        : null
      const contents = [c.category, c.description].map(s => (s ?? "").trim()).filter(Boolean).join(" – ")
      return {
        toteNo:     c.id,
        // The receipt's own copy first (what was printed on it), then the customer's current
        // vendor number for a receipt booked before they were given one.
        vendorNo:   text(c.receipt.vendorNo) ?? text(snap?.vendorNo) ?? text(c.receipt.contact.goodsInCustomer?.vendorNo),
        vendorName: text(snap?.name) ?? text(c.receipt.contact.name),
        receiptNo:  c.receipt.id,
        location:   c.locationCode ?? null,
        contents:   contents || null,
        catalogued: null,
        syncedAt:   null,
        source:     "goods-in" as const,
      }
    })
  } catch {
    return []   // tables not migrated yet, or unreadable — Goods In simply has nothing to add
  }
}

// GET /api/warehouse/tote-search?q=T025
// Searches WarehouseTote (BC-synced) by toteNo — used by the lot wizard tote field and Lotting Up.
// Goods In is searched last, only when BC's copy has nothing (see searchGoodsIn above).
//
// ⚠ PREFIX FIRST, "anywhere" only as a fallback (2026-09-08). Tote numbers are typed by hand, one
// character at a time, so an unanchored `contains` answers a half-typed "P0050" with every tote
// whose number contains those digits anywhere — a list of unrelated consignments presented in the
// same ascending order as the real neighbours. Matching from the START is what somebody typing a
// number from the start actually means. The `contains` search is kept as a second try so a
// deliberate partial search still finds something rather than returning nothing.
//
// ⚠ `catalogued` and `syncedAt` are returned so the wizard can tell a fresh row from a stale one
// and a tote BC has already finished with from one it has not. They were in the table and unused.
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
    if (!q) return NextResponse.json([])

    // ⚠⚠ BC's own receipt-tote rows first: ONE ENTRY PER RECEIPT-TOTE PAIR. A tote booked onto two
    // receipts appears twice, each with its own receipt and customer, so the cataloguer picks the
    // right one instead of being handed whichever the tote-keyed cache happened to keep. Falls back
    // to WarehouseTote when the table is not migrated/populated yet, which is the old behaviour.
    const rt = await searchReceiptTotes(q)
    if (rt) {
      // BC's free-text contents description isn't on the receipt-tote rows — it lives on the
      // tote-keyed cache — so it is looked up once for the handful of totes being offered.
      // Migration-safe: no column yet simply means no description.
      const contentsByTote = new Map<string, string>()
      try {
        const rows = await prisma.warehouseTote.findMany({
          where:  { toteNo: { in: [...new Set(rt.map(r => r.toteNo))] } },
          select: { toteNo: true, contents: true },
        })
        for (const row of rows) if (row.contents) contentsByTote.set(row.toteNo.toUpperCase(), row.contents)
      } catch { /* pre-migration — no contents to offer */ }
      return NextResponse.json(rt.map(r => ({
        toteNo:     r.toteNo,
        vendorNo:   r.vendorNo,
        vendorName: r.vendorName,
        receiptNo:  r.receiptNo,
        location:   null,
        contents:   contentsByTote.get(r.toteNo.toUpperCase()) ?? null,
        catalogued: r.catalogued,
        syncedAt:   r.syncedAt,
      })))
    }

    const BASE = {
      toteNo:     true,
      vendorNo:   true,
      vendorName: true,
      receiptNo:  true,
      location:   true,
      catalogued: true,
      syncedAt:   true,
    } as const
    // Migration-safe: `contents` ships with the deploy, Run Migrations comes later. A failure
    // drops back to the columns that have always existed rather than emptying the dropdown.
    let select: any = { ...BASE, contents: true }

    const find = (where: any) =>
      prisma.warehouseTote.findMany({ where, select, orderBy: { toteNo: "asc" }, take: 20 })

    let totes: any[]
    try {
      totes = await find({ toteNo: { startsWith: q, mode: "insensitive" } })
    } catch {
      select = BASE
      totes = await find({ toteNo: { startsWith: q, mode: "insensitive" } })
    }

    if (totes.length === 0) {
      totes = await find({ toteNo: { contains: q, mode: "insensitive" } })
    }

    // BC's copy has nothing for this — try Goods In (see the top). Never mixed into a BC answer.
    if (totes.length === 0) {
      const goodsIn = await searchGoodsIn(q)
      if (goodsIn.length > 0) return NextResponse.json(goodsIn)
    }

    return NextResponse.json(totes)
  } catch (e: any) {
    console.error("tote-search error:", e)
    return NextResponse.json({ error: e?.message ?? "Search failed" }, { status: 500 })
  }
}
