import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { buildToteMap, checkLot, toteLookupVariants, norm, type ToteCheckIssue } from "@/lib/tote-check"

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
// CHECKS: before the sheet is trusted overnight, every lot on it is verified
// the same way the Tote Check tab verifies a sale — shared lib/tote-check.ts,
// so the two can never disagree — plus three sheet-specific checks (receipt
// not in BC at all, one barcode in two totes, malformed barcode). Checks are
// REPORTS, not writes; only the duplicate-barcode case removes a lot from the
// sheet (importing it under the wrong tote would put the line on the wrong
// receipt in BC — the rest are amber "look at this first" warnings).
//
// ⚠ Prisma `in` is case-sensitive, so original/upper/lower variants are
// queried and compared case-insensitively in code — same as lot-lookup.

const variants = (vals: string[]) => [...new Set(vals.flatMap(v => [v, v.toUpperCase(), v.toLowerCase()]))]

// RULES.md detection regexes — strip non-ASCII first (scanners emit junk).
const clean       = (s: string) => s.replace(/[^\x20-\x7E]/g, "").trim()
const isUniqueId  = (s: string) => /^[A-Za-z]\d{4,7}-\d{1,6}$/.test(s)
const isBarcode   = (s: string) => /^[A-Za-z]\d{6,7}$/.test(s) || isUniqueId(s)

export type EodCheckKey = ToteCheckIssue | "receipt_not_in_bc" | "duplicate_barcode" | "invalid_barcode"

type CheckLot = {
  id: string; barcode: string; uniqueId: string; tote: string; receipt: string
  vendor: string; sale: string; cataloguedBy: string
  bcReceipt?: string; bcVendor?: string; totes?: string[]
}

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
        id: true, barcode: true, receiptUniqueId: true, tote: true, receipt: true, vendor: true,
        title: true, createdAt: true, createdByName: true,
        auction: { select: { id: true, code: true, name: true, complete: true } },
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
    let   ready     = pending.filter(l => l.barcode && l.tote?.trim())

    // ── Checks ───────────────────────────────────────────────────────────────
    const asCheckLot = (l: (typeof ready)[number], extra?: Partial<CheckLot>): CheckLot => ({
      id: l.id, barcode: l.barcode ?? "", uniqueId: l.receiptUniqueId ?? "",
      tote: l.tote?.trim() ?? "", receipt: l.receipt ?? "", vendor: l.vendor ?? "",
      sale: l.auction?.code ?? "", cataloguedBy: l.createdByName ?? "", ...extra,
    })
    const checkMap = new Map<EodCheckKey, CheckLot[]>()
    const addCheck = (key: EodCheckKey, lot: CheckLot) => {
      if (!checkMap.has(key)) checkMap.set(key, [])
      checkMap.get(key)!.push(lot)
    }

    // 1. One barcode in two different totes — one of them is wrong, and running
    //    it would create the BC line on the wrong receipt. The ONLY check that
    //    pulls lots off the sheet (visibly, never silently).
    const toteByBarcode = new Map<string, Set<string>>()
    for (const l of ready) {
      const b = l.barcode!.trim().toUpperCase()
      if (!toteByBarcode.has(b)) toteByBarcode.set(b, new Set())
      toteByBarcode.get(b)!.add(l.tote!.trim().toUpperCase())
    }
    const dupBarcodes = new Set([...toteByBarcode.entries()].filter(([, t]) => t.size > 1).map(([b]) => b))
    if (dupBarcodes.size > 0) {
      for (const l of ready) {
        const b = l.barcode!.trim().toUpperCase()
        if (dupBarcodes.has(b)) addCheck("duplicate_barcode", asCheckLot(l, { totes: [...toteByBarcode.get(b)!] }))
      }
      ready = ready.filter(l => !dupBarcodes.has(l.barcode!.trim().toUpperCase()))
    }

    // 2. Same verification as the Tote Check tab — shared checkLot(), so this
    //    page can never disagree with it. (no_tote can't fire here — ready
    //    lots all have totes — and stays handled by the noTote list above.)
    const bcTotes = ready.length
      ? await prisma.warehouseTote.findMany({
          where:  { toteNo: { in: toteLookupVariants(ready) } },
          select: { toteNo: true, receiptNo: true, vendorNo: true, vendorName: true },
        })
      : []
    const toteMap = buildToteMap(bcTotes)
    for (const l of ready) {
      const { issues, tote } = checkLot(l, toteMap)
      for (const issue of issues) {
        if (issue === "no_tote") continue
        addCheck(issue, asCheckLot(l, { bcReceipt: tote?.receiptNo ?? "", bcVendor: tote?.vendorNo ?? "" }))
      }
    }

    // 3. Receipt that doesn't exist in BC at all (a tote can pass its own check
    //    while the typed receipt is from thin air, e.g. no tote in BC yet).
    //    Existence = any synced BC tote OR item carries that receipt number.
    const receiptVals = [...new Set(ready.map(l => (l.receipt ?? "").trim()).filter(Boolean))]
    if (receiptVals.length) {
      const [toteReceipts, itemReceipts] = await Promise.all([
        prisma.warehouseTote.findMany({ where: { receiptNo: { in: variants(receiptVals) } }, select: { receiptNo: true } }),
        prisma.warehouseItem.findMany({ where: { receiptNo: { in: variants(receiptVals) } }, select: { receiptNo: true }, take: 100000 }),
      ])
      const known = new Set([...toteReceipts, ...itemReceipts].map(r => norm(r.receiptNo)))
      for (const l of ready) {
        const r = (l.receipt ?? "").trim()
        if (r && !known.has(norm(r))) addCheck("receipt_not_in_bc", asCheckLot(l))
      }
    }

    // 4. Malformed barcode — fails the RULES.md format, so the macro/BC is
    //    unlikely to accept it. Flagged, kept on the sheet (BC oddities exist).
    for (const l of ready) {
      if (!isBarcode(clean(l.barcode!))) addCheck("invalid_barcode", asCheckLot(l))
    }

    // When the tote table was last refreshed — an "unknown tote" pile with a
    // stale sync reads as "sync first", not "94 mistakes".
    const lastToteSync = await prisma.warehouseTote.aggregate({ _max: { syncedAt: true } })

    // ── Group by tote ────────────────────────────────────────────────────────
    // Barcodes deduped within a tote (a duplicate Hub lot must not make the
    // macro create the line twice).
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
    const bySale = new Map<string, { id: string; code: string; name: string; complete: boolean; count: number }>()
    for (const l of ready) {
      const code = l.auction?.code ?? "(no sale)"
      let s = bySale.get(code)
      if (!s) { s = { id: l.auction?.id ?? "", code, name: l.auction?.name ?? "", complete: l.auction?.complete ?? false, count: 0 }; bySale.set(code, s) }
      s.count++
    }

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      toteLastSync: lastToteSync._max.syncedAt?.toISOString() ?? null,
      totalLots: lots.length,
      alreadyInBc: lots.length - pending.length,
      readyCount: ready.length,
      totes,
      sales: [...bySale.values()].sort((a, b) => a.code.localeCompare(b.code)),
      checks: [...checkMap.entries()].map(([key, rows]) => ({ key, count: rows.length, lots: rows.slice(0, 300) })),
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
