import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { bcPersonName } from "@/lib/cataloguer-directory"

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

    // ⚠⚠ BC's auctionCode is NOT always an auction. Measured on production 2026-08-18, the A9xx
    // codes are holding pens: A995 "Temp F109 Bears" (570 items), A992 "Temp F110 - Dolls and
    // bears day 2" (424), A999 "Lost/Missing/Re-Receipted & Lots with BC Issues" (130), A996
    // "Temp F119 Trains", A998 "Unsold Mover". Grouping by them put "A995 · 1 Jan 2099" on screen
    // as though it were a sale, which means nothing to an admin with a customer on the phone.
    const isHoldingPen = (code: string) => /^A9\d\d$/i.test((code ?? "").trim())
    // A999 is the one that MATTERS — it is BC's problem pile, not a waiting room.
    const isProblemPen = (code: string) => (code ?? "").trim().toUpperCase() === "A999"

    // ⚠ The barcode carries the sale: F109034 → F109. Measured across the 211,229 BC rows that
    // have a real auction code, the barcode prefix agrees with it 199,901 times (94.6%) — and
    // ALL 692 A995 placeholders carry an F109 barcode, which is the sale they are really for.
    // So the barcode beats BC's own field whenever that field is a holding pen.
    const saleFromBarcode = (barcode: string | null | undefined) => {
      const m = (barcode ?? "").trim().match(/^([A-Za-z]\d{3})/)
      return m ? m[1].toUpperCase() : ""
    }
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

    // ── The customer's totes ─────────────────────────────────────────────────
    // Shown for EVERY kind of search (Jordan, 2026-08-18: "based off whatever you search it
    // smart matches to find everything a customer may have"), not just a tote search:
    //   receipt  → every tote booked in on that receipt
    //   tote     → the whole receipt that tote belongs to, so its siblings show too
    //   customer → every tote for that customer number
    // ⚠ Migration-safe: category/subCategory arrive with the deploy but the columns only exist
    // once the migrations have run, so a failure falls back to the columns that always existed.
    const toteWhere =
      type === "receipt" ? { receiptNo: ci(q) }
      : type === "tote"  ? (toteReceiptNos.length
                              ? { OR: [{ toteNo: ci(q) }, { receiptNo: { in: toteReceiptNos } }] }
                              : { toteNo: ci(q) })
      : { vendorNo: ci(q) }

    const TOTE_BASE = {
      toteNo: true, location: true, receiptNo: true, vendorName: true, catalogued: true,
      bcCreatedAt: true,
    } as const
    let totes: any[] = []
    try {
      totes = await prisma.warehouseTote.findMany({
        where: toteWhere,
        select: { ...TOTE_BASE, category: true, subCategory: true },
        orderBy: [{ bcCreatedAt: "desc" }, { toteNo: "asc" }],
        take: 500,
      })
    } catch {
      try {
        totes = await prisma.warehouseTote.findMany({
          where: toteWhere, select: TOTE_BASE, orderBy: { toteNo: "asc" }, take: 500,
        })
      } catch { totes = [] }
    }

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
      catalogued: true, cataloguedBy: true, cataloguedByUser: true, bcCreatedBy: true,
      auctionCode: true, auctionName: true, auctionDate: true,
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

    // ⚠⚠ A BARCODE IS NOT UNIQUE IN BC. Measured on production 2026-08-18: 2,039 barcodes appear
    // under MORE THAN ONE RECEIPT — F109050 exists as R009300-1 (customer C209142, the real lot)
    // AND as R008537-51 (customer C223610, an empty A995 placeholder). A plain Map keyed on
    // barcode let whichever row was written last win, so a Hub lot could be shown carrying a
    // DIFFERENT CUSTOMER's BC record. Keep every candidate and pick deliberately below.
    const bcByBarcode  = new Map<string, (typeof bcItems)[number][]>()
    const bcByUniqueId = new Map<string, (typeof bcItems)[number]>()
    for (const w of bcPool.values()) {
      if (w.barcode) {
        const k = upper(w.barcode)
        const list = bcByBarcode.get(k) ?? []
        list.push(w)
        bcByBarcode.set(k, list)
      }
      bcByUniqueId.set(upper(w.uniqueId), w)
    }

    // Which of several BC rows sharing a barcode actually belongs to THIS Hub lot?
    // The receipt decides it — that is the customer's own paperwork, and two records for the
    // same barcode under different receipts are two different customers' items. Never fall back
    // to "whichever one" when the receipt disagrees: attaching one customer's lot to another's
    // record is worse than showing no BC data at all.
    function pickBcFor(lot: { barcode: string | null; receipt: string | null; receiptUniqueId: string | null; vendor: string | null }) {
      const byUid = lot.receiptUniqueId ? bcByUniqueId.get(upper(lot.receiptUniqueId)) : undefined
      if (byUid) return byUid                                   // the unique ID is exact
      const candidates = lot.barcode ? (bcByBarcode.get(upper(lot.barcode)) ?? []) : []
      if (candidates.length === 0) return null
      if (candidates.length === 1) return candidates[0]
      const same = (a?: string | null, b?: string | null) =>
        !!a && !!b && a.trim().toUpperCase() === b.trim().toUpperCase()
      return candidates.find(w => same(w.receiptNo, lot.receipt))
          ?? candidates.find(w => same(w.vendorNo, lot.vendor))
          ?? null                                               // ambiguous — say nothing
    }

    // ── Which sale is each lot actually going into? ──────────────────────────
    // Our auction if we catalogued it; otherwise the sale its barcode names, PROVIDED we hold
    // that sale (so a stray prefix can't invent one); otherwise BC's code if it isn't a holding
    // pen; otherwise nothing, and it shows as not allocated yet.
    const codeCandidates = new Set<string>()
    for (const l of hubLots) { const c2 = saleFromBarcode(l.barcode); if (c2) codeCandidates.add(c2) }
    for (const w of bcPool.values()) { const c2 = saleFromBarcode(w.barcode); if (c2) codeCandidates.add(c2) }
    const knownAuctions = codeCandidates.size
      ? await prisma.catalogueAuction.findMany({
          where:  { code: { in: [...codeCandidates] } },
          select: { code: true, name: true, auctionDate: true },
        })
      : []
    const auctionByCode = new Map(knownAuctions.map(a => [a.code.toUpperCase(), a]))

    type Sale = { code: string; name: string; date: string }
    function resolveSale(
      hubAuction: { code: string; name: string | null; auctionDate: Date | null } | null | undefined,
      barcode: string | null | undefined,
      bc: { auctionCode: string | null; auctionName: string | null; auctionDate: string | null } | null,
    ): Sale {
      // 1 · Ours — always wins, and always with OUR name and date.
      if (hubAuction?.code) {
        return { code: hubAuction.code, name: cleanName(hubAuction.name), date: hubAuction.auctionDate?.toISOString() ?? "" }
      }
      // 2 · The sale the barcode names, if we hold it — this is what rescues the placeholders.
      const fromBarcode = auctionByCode.get(saleFromBarcode(barcode))
      if (fromBarcode) {
        return { code: fromBarcode.code, name: cleanName(fromBarcode.name), date: fromBarcode.auctionDate?.toISOString() ?? "" }
      }
      // 3 · BC's own code, but only when it is a real sale rather than a waiting room.
      const bcCode = (bc?.auctionCode ?? "").trim()
      if (bcCode && !isHoldingPen(bcCode)) {
        return { code: bcCode, name: cleanName(bc?.auctionName), date: bc?.auctionDate ?? "" }
      }
      return { code: "", name: "", date: "" }
    }

    // ── One row per physical item ────────────────────────────────────────────
    const claimed = new Set<string>()
    const merged = hubLots.slice(0, LIMIT).map(l => {
      const bc = pickBcFor(l)
      if (bc) claimed.add(bc.uniqueId)
      const sale = resolveSale(l.auction, l.barcode ?? bc?.barcode, bc)
      return {
        key: l.id,
        barcode: l.barcode ?? bc?.barcode ?? "",
        uniqueId: l.receiptUniqueId ?? bc?.uniqueId ?? "",
        title: l.title || bc?.description || "",
        saleCode: sale.code, saleName: sale.name, saleDate: sale.date,
        // The Hub's tote is what the cataloguer typed; BC's is the tote it was made from.
        tote: l.tote || bc?.toteNo || "",
        catalogued: true,   // it is in our system, so it has been catalogued
        cataloguedBy: l.createdByName || (bc ? bcPersonName(bc.cataloguedBy, bc.cataloguedByUser, bc.bcCreatedBy) : ""),
        lotNo: bc ? (bc.currentLotNo || bc.lotNo || "") : "",
        location: bc?.location ?? "",
        needsAttention: isProblemPen(bc?.auctionCode ?? ""),
      }
    })

    // BC items nothing in the Hub claimed — in BC but never catalogued here.
    // Only ones the ORIGINAL search returned, so an unrelated barcode-match
    // can't wander into the results.
    // ⚠⚠ THE HUB ALWAYS WINS (Jordan, 2026-08-18: "the lot is in the hub which it should always
    // be using first and only checking BC for backups — if there is overlaps the hub should
    // always win").
    //
    // ⚠ WHICH MEANS: IF THE HUB KNOWS THE BARCODE, A LEFTOVER BC ROW FOR IT IS NOT A NEW ITEM.
    // BC files 2,039 barcodes under more than one receipt, and its A995 placeholders grabbed
    // barcodes that belong to other people's lots. Measured on tote T024817 (receipt R008537):
    // 142 BC rows, 110 of whose barcodes the Hub holds — only 17 genuinely on that receipt, and
    // 93 on a DIFFERENT receipt, tote and customer. Those 93 were dragging another customer's
    // tote onto the screen. Either way the BC row is wrong, so it is dropped: if the Hub lot is
    // in this search the real row is already above, and if it isn't, the item is not here at all.
    //
    // ⚠ The count is REPORTED, never silently swallowed — see design rule 7.
    const leftovers = bcItems.slice(0, LIMIT).filter(w => !claimed.has(w.uniqueId))
    const leftoverBarcodes = leftovers.map(w => w.barcode).filter((b): b is string => !!b)
    const hubKnowsBarcode = new Set<string>()
    if (leftoverBarcodes.length) {
      const known = await prisma.catalogueLot.findMany({
        where:  { barcode: { in: variants(leftoverBarcodes) } },
        select: { barcode: true },
        take:   LIMIT * 2,
      })
      for (const l of known) if (l.barcode) hubKnowsBarcode.add(upper(l.barcode))
    }

    const phantoms = leftovers.filter(w => w.barcode && hubKnowsBarcode.has(upper(w.barcode))).length

    const bcOnly = leftovers
      .filter(w => !(w.barcode && hubKnowsBarcode.has(upper(w.barcode))))
      .map(w => {
        const sale = resolveSale(null, w.barcode, w)
        return {
          key: `bc:${w.uniqueId}`,
          barcode: w.barcode ?? "",
          uniqueId: w.uniqueId,
          title: w.description ?? "",
          saleCode: sale.code, saleName: sale.name, saleDate: sale.date,
          tote: w.toteNo ?? "",
          catalogued: w.catalogued === true,
          cataloguedBy: bcPersonName(w.cataloguedBy, w.cataloguedByUser, w.bcCreatedBy),
          lotNo: w.currentLotNo || w.lotNo || "",
          location: w.location ?? "",
          needsAttention: isProblemPen(w.auctionCode ?? ""),
        }
      })

    const hubCapped = hubLots.length > LIMIT
    const bcCapped  = bcItems.length > LIMIT

    return NextResponse.json({
      type, q,
      // One row per physical item, both systems on it. The client renders only
      // this — the old separate hub[]/bc[] arrays were dropped with the
      // two-panel layout.
      rows: [...merged, ...bcOnly],
      totes: totes.map((t) => ({
        toteNo: t.toteNo, location: t.location ?? "", receiptNo: t.receiptNo ?? "",
        vendorName: t.vendorName ?? "", catalogued: t.catalogued === true,
        createdAt: t.bcCreatedAt ? new Date(t.bcCreatedAt).toISOString() : "",
        category: t.category ?? "", subCategory: t.subCategory ?? "",
      })),
      capped: { hub: hubCapped, bc: bcCapped },
      phantoms,
    })
  } catch (e: any) {
    console.error("lot-lookup error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
