import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"

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
        auction: { select: { code: true, name: true } },
      },
      orderBy: [{ auctionId: "asc" }, { createdAt: "asc" }],
      take: LIMIT + 1,   // fetch one extra so we can tell a truncated result from an exactly-full one
    })

    // ── Business Central (synced cache) ──────────────────────────────────────
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
          select: {
            uniqueId: true, description: true, receiptNo: true, vendorNo: true, vendorName: true,
            catalogued: true, cataloguedBy: true, auctionCode: true, auctionName: true,
            lotNo: true, location: true, toteNo: true, barcode: true,
          },
          orderBy: [{ auctionCode: "asc" }, { receiptNo: "asc" }],
          take: LIMIT + 1,
        })
      : []

    const hubCapped = hubLots.length > LIMIT
    const bcCapped  = bcItems.length > LIMIT

    return NextResponse.json({
      type, q,
      hub: hubLots.slice(0, LIMIT).map((l) => ({
        id: l.id, title: l.title, barcode: l.barcode, receiptUniqueId: l.receiptUniqueId,
        receipt: l.receipt, tote: l.tote, vendor: l.vendor, status: l.status, addedToBC: l.addedToBC,
        category: l.category, cataloguedBy: l.createdByName,
        saleCode: l.auction?.code ?? "", saleName: cleanName(l.auction?.name),
      })),
      bc: bcItems.slice(0, LIMIT).map((w) => ({
        uniqueId: w.uniqueId, description: w.description ?? "", receiptNo: w.receiptNo ?? "",
        vendorNo: w.vendorNo ?? "", vendorName: w.vendorName ?? "",
        catalogued: w.catalogued === true, cataloguedBy: w.cataloguedBy ?? "",
        saleCode: w.auctionCode ?? "", saleName: cleanName(w.auctionName),
        lotNo: w.lotNo ?? "", location: w.location ?? "", toteNo: w.toteNo ?? "", barcode: w.barcode ?? "",
      })),
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
