import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { resolveTote, resolveReceipt, dedupeByToteAndReceipt } from "@/lib/receipt-totes"
import { normaliseCode, type CustomerSnapshot } from "@/lib/goods-in/model"

// ── Goods In fallback (2026-10-15) ───────────────────────────────────────────────────────────
// A tote or receipt booked in through the Hub's own Goods In (/tools/warehouse) is not in our copy
// of BC — Goods In never touches Business Central — so without this the wizard said "This tote is
// not in our copy of BC" for every one of them. These two reads answer from Goods In instead, in
// EXACTLY the shape a BC hit already has, with `source: "goods-in"` (a value the wizard treats as
// a solid answer: it only ambers "item", and only special-cases "tote-shell").
//
// ⚠⚠ ONLY when BC's copy has NO row of any kind for the number. Every tote and receipt BC knows —
// including a shell tote and one with no vendor yet — answers exactly as it did before; Goods In
// is consulted after BC has said nothing, never instead of it.
// ⚠ `catalogued` is always null here: the wizard words a true value as "BC has already ticked this
// tote catalogued … this is the previous customer", which is false for a Goods In tote (each one
// is a new number on one receipt). `syncedAt` is null because nothing was synced.
// ⚠ A tote on a VOIDED receipt is not offered — the booking was cancelled, and filling its customer
// in would start a batch under a receipt that no longer stands. Nor is one on a check-in that hasn't
// been booked in yet (a DRAFT receipt): its numbers are taken (so its labels can be printed at the
// counter) but nothing is booked in until Book in is pressed, and the check-in may still be thrown
// away — so it is left out exactly like a void. (Hub tables only; no BC change.)
// ⚠ Migration-safe: the Goods In tables only exist after Run Migrations, so any failure reading
// them is "Goods In has nothing" and the reply is exactly what it was before this was added.

type GoodsInWho = { vendorNo: string | null; vendorName: string | null }

const RECEIPT_SELECT = {
  id: true, vendorNo: true, customer: true, status: true,
  contact: { select: { name: true, goodsInCustomer: { select: { vendorNo: true } } } },
} as const

/** Vendor number and name for a Goods In receipt: the receipt's own copy first (what was printed on
 *  it), then the customer's current vendor number for a receipt booked before they were given one. */
function goodsInWho(r: {
  vendorNo: string | null
  customer: unknown
  contact: { name: string; goodsInCustomer: { vendorNo: string | null } | null }
}): GoodsInWho {
  const snap = r.customer && typeof r.customer === "object" ? (r.customer as Partial<CustomerSnapshot>) : null
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)
  return {
    vendorNo:   text(r.vendorNo) ?? text(snap?.vendorNo) ?? text(r.contact.goodsInCustomer?.vendorNo),
    vendorName: text(snap?.name) ?? text(r.contact.name),
  }
}

/** "Comics – 5x boxes of Marvel" — category and description, whichever were filled in. */
function goodsInContents(category: string | null, description: string | null): string | null {
  const parts = [category, description].map(s => (s ?? "").trim()).filter(Boolean)
  return parts.length ? parts.join(" – ") : null
}

async function goodsInTote(raw: string) {
  const id = normaliseCode(raw)
  if (!id) return null
  try {
    const c = await prisma.goodsInContainer.findUnique({
      where:  { id },
      select: { id: true, category: true, description: true, locationCode: true, receipt: { select: RECEIPT_SELECT } },
    })
    if (!c || c.receipt.status === "void" || c.receipt.status === "draft") return null   // not booked in (see above)
    return {
      ...goodsInWho(c.receipt),
      receiptNo: c.receipt.id,
      location:  c.locationCode ?? null,
      contents:  goodsInContents(c.category, c.description),
    }
  } catch {
    return null   // tables not migrated yet, or unreadable — Goods In simply has nothing to add
  }
}

async function goodsInReceipt(raw: string) {
  const id = normaliseCode(raw)
  if (!id) return null
  try {
    const r = await prisma.goodsInReceipt.findUnique({ where: { id }, select: RECEIPT_SELECT })
    if (!r || r.status === "void" || r.status === "draft") return null   // not booked in (see above)
    return { ...goodsInWho(r), receiptNo: r.id }
  } catch {
    return null
  }
}

// GET /api/warehouse/vendor-lookup?receipt=R007523
// GET /api/warehouse/vendor-lookup?tote=T024801
//
// For tote lookups: checks WarehouseTote first (BC-synced, has vendorNo directly),
// then falls back to WarehouseItem (in case only item-level data is present).
// For receipt lookups: checks WarehouseTote.receiptNo, then WarehouseItem.receiptNo.
// Last of all, and only when BC's copy has no row for the number, Goods In (see above).
//
// ⚠⚠ THE ANSWER CARRIES ITS OWN PROVENANCE (2026-09-08). This route used to return vendorNo /
// vendorName / receiptNo and nothing else, so the lot wizard could not tell:
//   • a row synced twenty minutes ago from one synced fourteen hours ago (the tote sync runs every
//     12 h, so a tote re-booked onto a new receipt this morning still answers with the PREVIOUS
//     customer until the next run), or
//   • a tote BC has already ticked Catalogued — i.e. a tote whose contents have been and gone, so
//     its receipt almost certainly is not the one being catalogued now, or
//   • a real receipt-tote row from a weaker WarehouseItem guess.
// All three columns were sitting unused in the table. They are returned now so the wizard can
// show an amber "check this" instead of the identical confident teal label it showed for every
// answer. Nothing here decides anything — it reports, a human decides.
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { searchParams } = req.nextUrl
    const receipt = searchParams.get("receipt")?.trim()
    const tote    = searchParams.get("tote")?.trim()

    if (!receipt && !tote) {
      return NextResponse.json({ error: "Provide receipt or tote" }, { status: 400 })
    }

    const empty = { vendorNo: null, vendorName: null, receiptNo: null, catalogued: null, syncedAt: null, source: null }

    // ── Tote lookup ─────────────────────────────────────────────────────────────
    if (tote) {
      // ⚠ BC's free-text "Contents Description" — what the goods-in clerk actually wrote — lives on
      // the tote-keyed cache no matter which of the branches below answers, because BC's
      // receipt-tote rows carry no such column. Fetched once here and merged into every reply, so
      // the wizard can show it whether the tote resolved from receipt-totes, WarehouseTote or a
      // shell row. Migration-safe: the column ships with the deploy and Run Migrations comes later,
      // so a failure falls back to the columns that have always existed.
      let extra: { location: string | null; contents: string | null } = { location: null, contents: null }
      try {
        const row = await prisma.warehouseTote.findFirst({
          where:  { toteNo: { equals: tote, mode: "insensitive" } },
          select: { location: true, contents: true },
        })
        if (row) extra = { location: row.location ?? null, contents: row.contents ?? null }
      } catch {
        try {
          const row = await prisma.warehouseTote.findFirst({
            where:  { toteNo: { equals: tote, mode: "insensitive" } },
            select: { location: true },
          })
          if (row) extra = { location: row.location ?? null, contents: null }
        } catch { /* leave both blank — the lookup is best-effort */ }
      }

      // ⚠⚠ FIRST: BC's own receipt-tote rows, where a tote is allowed to be on more than one
      // receipt — because in BC it can be. WarehouseTote below is unique on toteNo and therefore
      // answers with only one of them, chosen by whatever the sync wrote last. When BC has two,
      // we say so and fill NOTHING: the wizard shows the choice. Reporting the doubt is the whole
      // point; silently picking is what put a batch under the previous customer.
      const rt = await resolveTote(tote)
      if (rt) {
        if (rt.ambiguous) {
          return NextResponse.json({
            ...extra,
            vendorNo: null, vendorName: null, receiptNo: null,
            catalogued: null, syncedAt: rt.rows[0]?.syncedAt?.toISOString() ?? null,
            source: "receipt-tote", ambiguous: true,
            // ⚠ ONE OPTION PER RECEIPT, not per BC line. `ambiguous` is decided on the count of
            // DISTINCT receipts, so passing the raw rows made the wizard offer the same receipt
            // twice, say "on 3 receipts" when there were 2, and give both buttons the same React
            // key — the identical defect that stranded a row in the tote dropdown.
            options: dedupeByToteAndReceipt(rt.rows).map(r => ({
              receiptNo:  r.receiptNo,
              vendorNo:   r.vendorNo,
              vendorName: r.vendorName,
              catalogued: r.catalogued,
            })),
          })
        }
        const c = rt.chosen
        if (c?.vendorNo) {
          return NextResponse.json({
            ...extra,
            vendorNo:   c.vendorNo,
            vendorName: c.vendorName ?? null,
            receiptNo:  c.receiptNo,
            catalogued: c.catalogued,
            syncedAt:   c.syncedAt?.toISOString() ?? null,
            source:     "receipt-tote",
            ambiguous:  false,
          })
        }
      }

      // Primary: WarehouseTote (BC-synced, vendor lives here)
      const wt = await prisma.warehouseTote.findFirst({
        where:  { toteNo: { equals: tote, mode: "insensitive" } },
        select: { vendorNo: true, vendorName: true, receiptNo: true, catalogued: true, syncedAt: true, location: true },
      })
      if (wt?.vendorNo) {
        return NextResponse.json({
          ...extra,
          vendorNo:   wt.vendorNo,
          vendorName: wt.vendorName ?? null,
          receiptNo:  wt.receiptNo ?? null,
          catalogued: wt.catalogued ?? null,
          syncedAt:   wt.syncedAt?.toISOString() ?? null,
          location:   wt.location ?? null,
          source:     "tote",
        })
      }
      // The tote EXISTS but carries no receipt/vendor yet — a shell row from the Totes_Excel
      // sync (that feed is the tote master and has neither field). Say so explicitly rather than
      // falling through and letting it read as "not in BC": the wizard used to render this as an
      // empty "  ()" label with the not-found warning suppressed, which told the cataloguer
      // nothing at all.
      if (wt) {
        return NextResponse.json({ ...empty, ...extra, source: "tote-shell", knownTote: true })
      }
      // Fallback: WarehouseItem (item-level data). ⚠ This is a HISTORICAL guess, not BC's record
      // of the tote: WarehouseItem.toteNo is the tote a line was CREATED FROM, so it can name a
      // vendor from a receipt long since closed, and it carries no receipt we can trust. Marked as
      // such so the wizard can present it as weak evidence instead of a confident fill.
      const wi = await prisma.warehouseItem.findFirst({
        where:  { toteNo: { equals: tote, mode: "insensitive" } },
        select: { vendorNo: true, vendorName: true },
      })
      if (wi?.vendorNo) {
        return NextResponse.json({
          ...extra,
          vendorNo: wi.vendorNo, vendorName: wi.vendorName ?? null, receiptNo: null,
          catalogued: null, syncedAt: null, source: "item",
        })
      }
      // Goods In — only when BC has no row for this tote at all (no receipt-tote row, no
      // WarehouseTote row — that branch returned above — and no WarehouseItem row). See the top.
      if (!rt && !wi) {
        const gi = await goodsInTote(tote)
        if (gi) {
          return NextResponse.json({
            ...empty,
            location:   gi.location,
            contents:   gi.contents,
            vendorNo:   gi.vendorNo,
            vendorName: gi.vendorName,
            receiptNo:  gi.receiptNo,
            catalogued: null,
            syncedAt:   null,
            source:     "goods-in",
            ambiguous:  false,
          })
        }
      }
      return NextResponse.json({ ...empty, ...extra })
    }

    // ── Receipt lookup ───────────────────────────────────────────────────────────
    if (receipt) {
      // Same order: BC's receipt-tote rows first, WarehouseTote after.
      const rr = await resolveReceipt(receipt)
      if (rr?.vendorNo) {
        if (rr.vendors.length > 1) {
          return NextResponse.json({
            vendorNo: null, vendorName: null, receiptNo: receipt,
            catalogued: null, syncedAt: null, source: "receipt-tote",
            ambiguous: true, vendors: rr.vendors,
          })
        }
        return NextResponse.json({
          vendorNo: rr.vendorNo, vendorName: rr.vendorName, receiptNo: receipt,
          catalogued: null, syncedAt: null, source: "receipt-tote", ambiguous: false,
        })
      }

      // Primary: WarehouseTote (has receiptNo + vendor)
      const wt = await prisma.warehouseTote.findFirst({
        where:  { receiptNo: { equals: receipt, mode: "insensitive" } },
        select: { vendorNo: true, vendorName: true, catalogued: true, syncedAt: true },
      })
      if (wt?.vendorNo) {
        return NextResponse.json({
          vendorNo:   wt.vendorNo,
          vendorName: wt.vendorName ?? null,
          receiptNo:  receipt,
          catalogued: wt.catalogued ?? null,
          syncedAt:   wt.syncedAt?.toISOString() ?? null,
          source:     "tote",
        })
      }
      // Fallback: WarehouseItem
      const wi = await prisma.warehouseItem.findFirst({
        where:  { receiptNo: { equals: receipt, mode: "insensitive" } },
        select: { vendorNo: true, vendorName: true },
      })
      if (wi?.vendorNo) {
        return NextResponse.json({
          vendorNo: wi.vendorNo, vendorName: wi.vendorName ?? null, receiptNo: receipt,
          catalogued: null, syncedAt: null, source: "item",
        })
      }
      // Goods In — only when BC has no row for this receipt at all. See the top.
      if (!rr && !wt && !wi) {
        const gi = await goodsInReceipt(receipt)
        if (gi) {
          return NextResponse.json({
            vendorNo:   gi.vendorNo,
            vendorName: gi.vendorName,
            receiptNo:  gi.receiptNo,
            catalogued: null,
            syncedAt:   null,
            source:     "goods-in",
            ambiguous:  false,
          })
        }
      }
      return NextResponse.json(empty)
    }
  } catch (e: any) {
    console.error("vendor-lookup error:", e)
    return NextResponse.json({ error: e?.message ?? "Lookup failed" }, { status: 500 })
  }
}
