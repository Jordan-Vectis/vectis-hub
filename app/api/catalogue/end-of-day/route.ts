import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// End of Day → BC. Every Hub lot that has NOT yet reached Business Central,
// grouped by tote, ready to be exported as the hotkey sheet the overnight
// "add to BC" macro works through (ToteNumber / LotCount / pipe-separated
// Barcodes — the exact format BC Import Check reads and writes).
//
// ⚠ "Not in BC" is decided the same way as the Admin Centre: does the synced
// BC data (WarehouseItem) contain the lot's BARCODE (falling back to
// receiptUniqueId ↔ uniqueId)? It is deliberately NOT CatalogueLot.addedToBC —
// that manual tick is routinely left unticked on lots that are plainly in BC
// (measured: 11 of 44 ticked, 44/44 matched by barcode).
//
// ⚠ Prisma `in` is case-sensitive, so original/upper/lower variants are
// queried and compared case-insensitively in code — same as lot-lookup.

const variants = (vals: string[]) => [...new Set(vals.flatMap(v => [v, v.toUpperCase(), v.toLowerCase()]))]

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const dbUser = await prisma.user.findUnique({
      where:  { id: session.user.id },
      select: { role: true, allowedApps: true },
    })
    if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "CATALOGUING")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Completed sales are old news — their unmatched lots are historical noise,
    // not tonight's work. Opt in to sweep them too.
    const includeComplete = req.nextUrl.searchParams.get("includeComplete") === "1"

    const lots = await prisma.catalogueLot.findMany({
      where: includeComplete ? {} : { auction: { complete: false } },
      select: {
        id: true, barcode: true, receiptUniqueId: true, tote: true, receipt: true,
        title: true, createdAt: true, createdByName: true,
        auction: { select: { code: true, name: true, complete: true } },
      },
      orderBy: { createdAt: "asc" },
    })

    // What does BC already have? One query over both identifier fields.
    const barcodes  = lots.map(l => l.barcode).filter((v): v is string => !!v)
    const uniqueIds = lots.map(l => l.receiptUniqueId).filter((v): v is string => !!v)
    const bcRows = (barcodes.length || uniqueIds.length)
      ? await prisma.warehouseItem.findMany({
          where: { OR: [
            ...(barcodes.length  ? [{ barcode:  { in: variants(barcodes) } }]  : []),
            ...(uniqueIds.length ? [{ uniqueId: { in: variants(uniqueIds) } }] : []),
          ] },
          select: { barcode: true, uniqueId: true },
        })
      : []
    const inBcBarcode  = new Set(bcRows.map(w => w.barcode?.toUpperCase()).filter(Boolean))
    const inBcUniqueId = new Set(bcRows.map(w => w.uniqueId.toUpperCase()))

    const inBc = (l: { barcode: string | null; receiptUniqueId: string | null }) =>
      (l.barcode && inBcBarcode.has(l.barcode.toUpperCase())) ||
      (l.receiptUniqueId && inBcUniqueId.has(l.receiptUniqueId.toUpperCase()))

    const pending = lots.filter(l => !inBc(l))

    // The macro's sheet is keyed on tote and driven by barcode — a lot missing
    // either can't go on it and is reported separately for fixing, never
    // silently dropped.
    const noBarcode = pending.filter(l => !l.barcode)
    const noTote    = pending.filter(l => l.barcode && !l.tote?.trim())
    const ready     = pending.filter(l => l.barcode && l.tote?.trim())

    // Group by tote. Barcodes deduped within a tote (a duplicate Hub lot must
    // not make the macro create the line twice).
    const byTote = new Map<string, { tote: string; barcodes: string[]; seen: Set<string>; sales: Set<string> }>()
    for (const l of ready) {
      const tote = l.tote!.trim().toUpperCase()
      let g = byTote.get(tote)
      if (!g) { g = { tote, barcodes: [], seen: new Set(), sales: new Set() }; byTote.set(tote, g) }
      const bc = l.barcode!.trim()
      if (!g.seen.has(bc.toUpperCase())) { g.seen.add(bc.toUpperCase()); g.barcodes.push(bc) }
      if (l.auction?.code) g.sales.add(l.auction.code)
    }
    const totes = [...byTote.values()]
      .sort((a, b) => a.tote.localeCompare(b.tote, "en-GB", { numeric: true }))
      .map(g => ({ tote: g.tote, count: g.barcodes.length, barcodes: g.barcodes, sales: [...g.sales].sort() }))

    // Per-sale summary so a surprise (an old sale suddenly contributing lots)
    // is visible before the sheet is run.
    const bySale = new Map<string, { code: string; name: string; complete: boolean; count: number }>()
    for (const l of ready) {
      const code = l.auction?.code ?? "(no sale)"
      let s = bySale.get(code)
      if (!s) { s = { code, name: l.auction?.name ?? "", complete: l.auction?.complete ?? false, count: 0 }; bySale.set(code, s) }
      s.count++
    }

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      totalLots: lots.length,
      alreadyInBc: lots.length - pending.length,
      readyCount: ready.length,
      totes,
      sales: [...bySale.values()].sort((a, b) => a.code.localeCompare(b.code)),
      noBarcode: noBarcode.map(l => ({
        id: l.id, uniqueId: l.receiptUniqueId ?? "", tote: l.tote ?? "",
        sale: l.auction?.code ?? "", title: l.title, cataloguedBy: l.createdByName ?? "",
      })),
      noTote: noTote.map(l => ({
        id: l.id, barcode: l.barcode ?? "", uniqueId: l.receiptUniqueId ?? "",
        sale: l.auction?.code ?? "", title: l.title, cataloguedBy: l.createdByName ?? "",
      })),
    })
  } catch (e: any) {
    console.error("catalogue/end-of-day error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
