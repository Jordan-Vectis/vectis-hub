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

    // Accept comma, space, period, semicolon, slash or pipe as separators —
    // common typos shouldn't silently turn 'A36.A37' into one bogus aisle.
    const aisles = aislesRaw
      .split(/[,\s.;/|]+/)
      .map(s => s.trim().toUpperCase())
      .filter(Boolean)

    if (aisles.length === 0) {
      return NextResponse.json({ error: "Provide at least one aisle (e.g. ?aisles=A39,A40)" }, { status: 400 })
    }

    // Query each aisle in parallel — one BC call per aisle. A combined OR
    // filter across many aisles times out at BC's end, especially when each
    // aisle has thousands of locations and items. Running them concurrently
    // keeps the per-call filter simple and the total wall time fast.
    const escSearch = search.replace(/'/g, "''")
    const settled = await Promise.allSettled(aisles.map(a =>
      bcFetchAll(
        token,
        "Receipt_Lines_Excel",
        `startswith(EVA_ArticleLocationCode, '${a}') and contains(EVA_CollectionNo, '${escSearch}')`,
        undefined,
        500,
      )
    ))

    const errs: string[] = []
    const rows = settled.flatMap((r, i) => {
      if (r.status === "fulfilled") return r.value
      errs.push(`${aisles[i]}: ${r.reason?.message ?? r.reason}`)
      return []
    })
    if (errs.length === aisles.length) {
      // Every aisle failed — surface the first error
      return NextResponse.json({ error: `BC query failed: ${errs[0]}` }, { status: 500 })
    }

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
      partialErrors: errs.length > 0 ? errs : undefined,
    })
  } catch (e: any) {
    console.error("collections-due error:", e)
    return NextResponse.json({ error: e?.message ?? "BC query failed" }, { status: 500 })
  }
}
