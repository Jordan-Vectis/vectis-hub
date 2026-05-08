import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAll } from "@/lib/bc"

export const maxDuration = 60

// GET /api/warehouse/collections-due?aisles=A39,A40&search=COL
//
// Live query against BC's Receipt_Lines_Excel — returns items at the
// specified aisle prefixes that have a collection docket number.
// Used by the BC Warehouse "Collections Due" tab to print pick-lists.
//
// We hit BC live rather than reading from the WarehouseItem cache because
// the cache doesn't track EVA_CollectionNo (yet) and this report needs
// real-time accuracy — items move and dockets are issued constantly.

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const token = await getBCToken()
    if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

    const { searchParams } = req.nextUrl
    const aislesRaw = searchParams.get("aisles")?.trim() ?? ""
    const search    = searchParams.get("search")?.trim() ?? "COL"  // collection prefix

    const aisles = aislesRaw
      .split(/[,\s]+/)
      .map(s => s.trim().toUpperCase())
      .filter(Boolean)

    if (aisles.length === 0) {
      return NextResponse.json({ error: "Provide at least one aisle (e.g. ?aisles=A39,A40)" }, { status: 400 })
    }

    // Build filter: items whose EVA_ArticleLocationCode starts with one of
    // the aisle prefixes AND have a non-empty EVA_CollectionNo containing
    // the search term (default "COL").
    const aisleFilter = aisles
      .map(a => `startswith(EVA_ArticleLocationCode, '${a}')`)
      .join(" or ")

    const filter = `(${aisleFilter}) and contains(EVA_CollectionNo, '${search.replace(/'/g, "''")}')`

    const rows = await bcFetchAll(
      token,
      "Receipt_Lines_Excel",
      filter,
      undefined,
      500,
    )

    // Project to the columns we display
    const items = rows.map(r => ({
      uniqueId:     String(r.EVA_UniqueID ?? ""),
      receiptNo:    String(r.EVA_ReceiptNo ?? ""),
      articleNo:    r.EVA_ArticleNo != null ? String(r.EVA_ArticleNo) : "",
      barcode:      String(r.PTE_InternalBarcode ?? ""),
      description:  String(r.EVA_ShortDescription ?? ""),
      location:     String(r.EVA_ArticleLocationCode ?? ""),
      collectionNo: String(r.EVA_CollectionNo ?? ""),
      vendorName:   String(r.EVA_VendorName ?? ""),
    }))
      // Sort by location, then collection number — natural pick order
      .sort((a, b) => {
        const locCmp = a.location.localeCompare(b.location)
        if (locCmp !== 0) return locCmp
        return a.collectionNo.localeCompare(b.collectionNo)
      })

    return NextResponse.json({
      aisles,
      search,
      count: items.length,
      items,
    })
  } catch (e: any) {
    console.error("collections-due error:", e)
    return NextResponse.json({ error: e?.message ?? "BC query failed" }, { status: 500 })
  }
}
