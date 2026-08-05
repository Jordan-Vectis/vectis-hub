import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { lookupCataloguerByCode } from "@/lib/cataloguer-directory"

export const dynamic = "force-dynamic"

// Admin Centre → "Who catalogued the lots in this sale?"
//
// The lot NUMBER only exists in Business Central (EVA_CurrentLotNo) — the Hub
// has no lot number at all (CatalogueLot.lotNumber was dropped, see RULES.md).
// But BC's own EVA_CataloguedBy is NOT the cataloguer: lots are pushed across in
// bulk, so it records whoever ran the import (Jack / Jordan) on every lot in the
// sale. The real cataloguer is CatalogueLot.createdByName in the Hub.
//
// So this route reads the sale FROM BC (for the lot numbers) and joins each item
// back to its Hub lot on the barcode / unique ID to get the person who actually
// catalogued it.
//
//   ?sales=1        → the list of sales BC knows about, for the picker
//   ?sale=F088      → every item in that sale, lot number + real cataloguer
//   &lot=247        → narrow to one lot number

const MAX_ITEMS = 5000   // a big sale is ~2-3k lots; this is headroom, not a target

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const dbUser = await prisma.user.findUnique({
      where:  { id: session.user.id },
      select: { role: true, allowedApps: true },
    })
    if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "ADMIN_CENTRE")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    // BC sometimes stores an unresolved auction name as the literal "null".
    const cleanName = (n: string | null | undefined) => (n && n !== "null" ? n : "")

    // ── The sale picker ──────────────────────────────────────────────────────
    if (searchParams.get("sales")) {
      const groups = await prisma.warehouseItem.groupBy({
        by:    ["auctionCode", "auctionName", "auctionDate"],
        where: { auctionCode: { not: null }, NOT: { auctionCode: "" } },
        _count: { _all: true },
      })

      // One row per code — BC leaves the name/date off some rows of the same
      // sale, so take the first non-blank of each and add the counts up.
      const byCode = new Map<string, { code: string; name: string; date: string; lots: number }>()
      for (const g of groups) {
        const code = g.auctionCode!.trim()
        if (!code) continue
        const s = byCode.get(code) ?? { code, name: "", date: "", lots: 0 }
        s.lots += g._count._all
        if (!s.name) s.name = cleanName(g.auctionName)
        if (!s.date && g.auctionDate) s.date = g.auctionDate
        byCode.set(code, s)
      }

      // Newest sale first — that is the one an admin is nearly always asking about.
      const stamp = (d: string) => {
        const t = new Date(d).getTime()
        return isNaN(t) ? 0 : t
      }
      const sales = [...byCode.values()].sort((a, b) =>
        stamp(b.date) - stamp(a.date) || b.code.localeCompare(a.code, "en-GB", { numeric: true }))

      return NextResponse.json({ sales })
    }

    // ── One sale ─────────────────────────────────────────────────────────────
    const sale = (searchParams.get("sale") ?? "").replace(/[^\x20-\x7E]/g, "").trim()
    if (!sale) return NextResponse.json({ error: "Pick a sale" }, { status: 400 })

    const bcItems = await prisma.warehouseItem.findMany({
      where: { auctionCode: { equals: sale, mode: "insensitive" } },
      select: {
        uniqueId: true, barcode: true, description: true, receiptNo: true,
        vendorNo: true, vendorName: true, catalogued: true, cataloguedBy: true,
        auctionCode: true, auctionName: true, auctionDate: true,
        lotNo: true, currentLotNo: true, location: true, binCode: true,
      },
      take: MAX_ITEMS + 1,
    })
    const capped = bcItems.length > MAX_ITEMS
    const items  = bcItems.slice(0, MAX_ITEMS)

    // ── Join each BC item back to its Hub lot ────────────────────────────────
    // Postgres `in` is case-sensitive and the two systems disagree on case, so
    // match on every casing — the same approach the receipt/tote lookup uses.
    const upper    = (s: string) => s.toUpperCase()
    const variants = (vals: string[]) => [...new Set(vals.flatMap(v => [v, v.toUpperCase(), v.toLowerCase()]))]
    const barcodes  = items.map(i => i.barcode).filter((v): v is string => !!v)
    const uniqueIds = items.map(i => i.uniqueId).filter(Boolean)

    const hubLots = barcodes.length || uniqueIds.length
      ? await prisma.catalogueLot.findMany({
          where: { OR: [
            ...(barcodes.length  ? [{ barcode:         { in: variants(barcodes) } }]  : []),
            ...(uniqueIds.length ? [{ receiptUniqueId: { in: variants(uniqueIds) } }] : []),
          ] },
          select: {
            id: true, title: true, barcode: true, receiptUniqueId: true, tote: true,
            createdByName: true, createdAt: true, imageUrls: true,
            auction: { select: { code: true, name: true } },
          },
        })
      : []

    const hubByBarcode  = new Map<string, (typeof hubLots)[number]>()
    const hubByUniqueId = new Map<string, (typeof hubLots)[number]>()
    for (const l of hubLots) {
      if (l.barcode)         hubByBarcode.set(upper(l.barcode), l)
      if (l.receiptUniqueId) hubByUniqueId.set(upper(l.receiptUniqueId), l)
    }

    const rows = items.map(w => {
      // Barcode first — that is the label physically on the item.
      const hub = (w.barcode && hubByBarcode.get(upper(w.barcode)))
        || hubByUniqueId.get(upper(w.uniqueId))
        || null
      // BC writes 0 until the sale is numbered — treat that as "no number yet".
      const lotNo = [w.currentLotNo, w.lotNo].find(v => v && v.trim() && v.trim() !== "0")?.trim() ?? ""
      return {
        key: w.uniqueId,
        lotNo,
        lotSort: Number.parseInt(lotNo.replace(/[^\d]/g, ""), 10) || 0,
        uniqueId: w.uniqueId,
        barcode: w.barcode ?? hub?.barcode ?? "",
        title: hub?.title || w.description || "",
        vendor: w.vendorName || w.vendorNo || "",
        location: [w.location, w.binCode].filter(Boolean).join(" · "),
        tote: hub?.tote ?? "",
        photos: hub?.imageUrls.length ?? 0,
        // The answer: who entered the lot in the Hub.
        inHub: !!hub,
        hubLotId: hub?.id ?? "",
        cataloguedBy: hub?.createdByName ?? "",
        cataloguedAt: hub?.createdAt.toISOString() ?? "",
        // Kept only so a mismatch is visible — this is the import stamp, not a
        // cataloguer, which is the whole reason this page exists.
        bcStampCode: w.cataloguedBy?.trim() ?? "",
        bcStampName: lookupCataloguerByCode(w.cataloguedBy)?.name ?? "",
        bcCatalogued: w.catalogued === true,
        // The Hub can have the lot filed under a different sale than BC does.
        hubSaleCode: hub?.auction?.code ?? "",
      }
    })

    rows.sort((a, b) =>
      // Unnumbered lots sit at the bottom rather than jumbled in at 0.
      (a.lotSort || Infinity) - (b.lotSort || Infinity) ||
      a.lotNo.localeCompare(b.lotNo, "en-GB", { numeric: true }) ||
      a.uniqueId.localeCompare(b.uniqueId, "en-GB", { numeric: true }))

    // Who catalogued this sale, and how much of it each.
    const tally = new Map<string, number>()
    for (const r of rows) tally.set(r.cataloguedBy || "", (tally.get(r.cataloguedBy || "") ?? 0) + 1)
    const cataloguers = [...tally.entries()]
      .map(([name, lots]) => ({ name, lots }))
      .sort((a, b) => b.lots - a.lots || a.name.localeCompare(b.name))

    const first = items[0]
    return NextResponse.json({
      sale: {
        code: first?.auctionCode ?? sale,
        name: cleanName(items.find(i => cleanName(i.auctionName))?.auctionName),
        date: items.find(i => i.auctionDate)?.auctionDate ?? "",
      },
      rows,
      cataloguers,
      capped,
    })
  } catch (e: any) {
    console.error("lot-lookup/sale error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
