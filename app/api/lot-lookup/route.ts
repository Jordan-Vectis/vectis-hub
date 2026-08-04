import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { lookupCataloguerByCode } from "@/lib/cataloguer-directory"

export const dynamic = "force-dynamic"

// Admin Centre lookup: given a receipt / tote / customer (vendor) number, list the
// matching lots in BOTH the Hub cataloguing system (CatalogueLot → CatalogueAuction)
// and Business Central (the synced WarehouseItem / WarehouseTote cache), so you can
// see what's been catalogued and which sale each lot is in.
const LIMIT = 500
const TYPES = ["receipt", "tote", "vendor"] as const
type LookupType = (typeof TYPES)[number]

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
    const type = (searchParams.get("type") ?? "receipt").toLowerCase() as LookupType
    const q = (searchParams.get("q") ?? "").trim()
    if (!q) return NextResponse.json({ error: "Enter something to search for" }, { status: 400 })
    if (!TYPES.includes(type)) return NextResponse.json({ error: "Invalid search type" }, { status: 400 })

    const ci = (value: string) => ({ equals: value, mode: "insensitive" as const })
    // BC sometimes stores an unresolved auction name as the literal "null" — treat as blank.
    const cleanName = (n: string | null | undefined) => (n && n !== "null" ? n : "")

    // A tote isn't tagged onto items in either system reliably, so map the tote to its
    // receipt first (WarehouseTote.receiptNo) and bridge BOTH systems via that receipt.
    const totesInfo = type === "tote"
      ? await prisma.warehouseTote.findMany({
          where: { toteNo: ci(q) },
          select: { toteNo: true, location: true, receiptNo: true, vendorName: true, catalogued: true },
        })
      : []
    const toteReceiptNos = [...new Set(totesInfo.map((t) => t.receiptNo).filter((r): r is string => !!r))]

    // ── Hub cataloguing (CatalogueLot) ───────────────────────────────────────
    let hubWhere: any
    if (type === "receipt") {
      hubWhere = { OR: [
        { receipt: ci(q) },
        { receiptUniqueId: ci(q) },
        { receiptUniqueId: { startsWith: `${q}-`, mode: "insensitive" as const } },
      ] }
    } else if (type === "tote") {
      hubWhere = { OR: [
        { tote: ci(q) },
        ...(toteReceiptNos.length ? [{ receipt: { in: toteReceiptNos } }] : []),
      ] }
    } else {
      // CatalogueLot.vendor holds only the C###### customer number (never a name), so
      // match it EXACTLY — mirrors BC's vendorNo. A substring match would surface other
      // customers whose number merely contains the query.
      hubWhere = { vendor: ci(q) }
    }
    const hubLots = await prisma.catalogueLot.findMany({
      where: hubWhere,
      select: {
        id: true, title: true, barcode: true, receiptUniqueId: true, receipt: true, tote: true, vendor: true,
        status: true, addedToBC: true, category: true, createdByName: true,
        auction: { select: { code: true, name: true, auctionDate: true } },
      },
      orderBy: [{ auctionId: "asc" }, { createdAt: "asc" }],
      take: LIMIT + 1,   // fetch one extra so we can tell a truncated result from an exactly-full one
    })

    // ── Business Central (synced cache) ──────────────────────────────────────
    const BC_SELECT = {
      uniqueId: true, description: true, receiptNo: true, vendorNo: true, vendorName: true,
      catalogued: true, cataloguedBy: true, auctionCode: true, auctionName: true, auctionDate: true,
      lotNo: true, currentLotNo: true, location: true, toteNo: true, barcode: true,
    } as const

    let bcWhere: any = null
    if (type === "receipt") {
      bcWhere = { receiptNo: ci(q) }
    } else if (type === "vendor") {
      bcWhere = { OR: [{ vendorNo: ci(q) }, { vendorName: { contains: q, mode: "insensitive" as const } }] }
    } else {
      bcWhere = toteReceiptNos.length ? { receiptNo: { in: toteReceiptNos } } : null
    }
    const bcItems = bcWhere
      ? await prisma.warehouseItem.findMany({
          where: bcWhere,
          select: BC_SELECT,
          orderBy: [{ auctionCode: "asc" }, { receiptNo: "asc" }],
          take: LIMIT + 1,
        })
      : []

    // ── Is each Hub lot actually in BC? ──────────────────────────────────────
    // NOT from CatalogueLot.addedToBC — that is a manual tick the cataloguers
    // often never make, so it reads "no" for lots that are plainly in BC. The
    // real check is the BARCODE: does an item carrying it exist in the synced BC
    // data? A lot can also be in BC under a different receipt from the one being
    // searched, so this is its own query rather than a scan of `bcItems`.
    const upper    = (s: string) => s.toUpperCase()
    const variants = (vals: string[]) => [...new Set(vals.flatMap(v => [v, v.toUpperCase(), v.toLowerCase()]))]
    const hubBarcodes  = hubLots.map(l => l.barcode).filter((v): v is string => !!v)
    const hubUniqueIds = hubLots.map(l => l.receiptUniqueId).filter((v): v is string => !!v)

    const bcByIdentifier = hubBarcodes.length || hubUniqueIds.length
      ? await prisma.warehouseItem.findMany({
          where: { OR: [
            ...(hubBarcodes.length  ? [{ barcode:  { in: variants(hubBarcodes) } }]  : []),
            ...(hubUniqueIds.length ? [{ uniqueId: { in: variants(hubUniqueIds) } }] : []),
          ] },
          select: BC_SELECT,
          take: LIMIT * 2,
        })
      : []

    // Everything BC knows about, from either query, deduped.
    const bcPool = new Map<string, (typeof bcItems)[number]>()
    for (const w of [...bcItems, ...bcByIdentifier]) bcPool.set(w.uniqueId, w)

    const bcByBarcode  = new Map<string, (typeof bcItems)[number]>()
    const bcByUniqueId = new Map<string, (typeof bcItems)[number]>()
    for (const w of bcPool.values()) {
      if (w.barcode) bcByBarcode.set(upper(w.barcode), w)
      bcByUniqueId.set(upper(w.uniqueId), w)
    }

    // ── One row per physical item, both systems on it ────────────────────────
    const claimed = new Set<string>()
    const merged = hubLots.slice(0, LIMIT).map(l => {
      // Barcode first — that is the label on the item — then the unique ID.
      const bc = (l.barcode && bcByBarcode.get(upper(l.barcode)))
        || (l.receiptUniqueId && bcByUniqueId.get(upper(l.receiptUniqueId)))
        || null
      if (bc) claimed.add(bc.uniqueId)
      return {
        key: l.id,
        barcode: l.barcode ?? bc?.barcode ?? "",
        uniqueId: l.receiptUniqueId ?? bc?.uniqueId ?? "",
        title: l.title || bc?.description || "",
        // BC's toteNo is EVA_CFA_TOT_CreatedFromToteNo — the tote the item was
        // actually made from. The Hub's is what the cataloguer typed in.
        bcTote: bc?.toteNo ?? "",
        hubTote: l.tote ?? "",
        inHub: true,
        hubCataloguedBy: l.createdByName ?? "",
        hubSaleCode: l.auction?.code ?? "",
        hubSaleName: cleanName(l.auction?.name),
        hubSaleDate: l.auction?.auctionDate?.toISOString() ?? "",
        inBC: !!bc,
        bcCataloguedBy: bc ? (lookupCataloguerByCode(bc.cataloguedBy)?.name ?? bc.cataloguedBy ?? "") : "",
        bcCatalogued: bc?.catalogued === true,
        bcSaleCode: bc?.auctionCode ?? "",
        bcSaleName: cleanName(bc?.auctionName),
        bcSaleDate: bc?.auctionDate ?? "",
        bcLotNo: bc ? (bc.currentLotNo || bc.lotNo || "") : "",
        bcLocation: bc?.location ?? "",
      }
    })

    // BC items nothing in the Hub claimed — in BC but never catalogued here.
    // Only ones the ORIGINAL search returned, so an unrelated barcode-match
    // can't wander into the results.
    const bcOnly = bcItems.slice(0, LIMIT).filter(w => !claimed.has(w.uniqueId)).map(w => ({
      key: `bc:${w.uniqueId}`,
      barcode: w.barcode ?? "",
      uniqueId: w.uniqueId,
      title: w.description ?? "",
      bcTote: w.toteNo ?? "",
      hubTote: "",
      inHub: false,
      hubCataloguedBy: "", hubSaleCode: "", hubSaleName: "", hubSaleDate: "",
      inBC: true,
      bcCataloguedBy: lookupCataloguerByCode(w.cataloguedBy)?.name ?? w.cataloguedBy ?? "",
      bcCatalogued: w.catalogued === true,
      bcSaleCode: w.auctionCode ?? "",
      bcSaleName: cleanName(w.auctionName),
      bcSaleDate: w.auctionDate ?? "",
      bcLotNo: w.currentLotNo || w.lotNo || "",
      bcLocation: w.location ?? "",
    }))

    const hubCapped = hubLots.length > LIMIT
    const bcCapped  = bcItems.length > LIMIT

    return NextResponse.json({
      type, q,
      // One row per physical item, both systems on it. The client renders only
      // this — the old separate hub[]/bc[] arrays were dropped with the
      // two-panel layout.
      rows: [...merged, ...bcOnly],
      totes: totesInfo.map((t) => ({
        toteNo: t.toteNo, location: t.location ?? "", receiptNo: t.receiptNo ?? "",
        vendorName: t.vendorName ?? "", catalogued: t.catalogued === true,
      })),
      capped: { hub: hubCapped, bc: bcCapped },
    })
  } catch (e: any) {
    console.error("lot-lookup error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
