import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAll } from "@/lib/bc"

export const maxDuration = 60

// GET /api/warehouse/unsold-items?aisles=A50,A51
//
// Live BC query against Receipt_Lines_Excel — returns items in the given
// aisle prefixes whose Hammer Price is 0. Mirrors how staff filter inside
// BC: Article Location Code = "A50*" + Hammer Price = 0. Used by the
// "Unsold Items" tab to print recovery / re-allocation pick-lists.

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const token = await getBCToken()
    if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

    const { searchParams } = req.nextUrl
    const aislesRaw = searchParams.get("aisles")?.trim() ?? ""

    const aisles = aislesRaw
      .split(/[,\s.;/|]+/)
      .map(s => s.trim().toUpperCase())
      .filter(Boolean)

    if (aisles.length === 0) {
      return NextResponse.json({ error: "Provide at least one aisle (e.g. ?aisles=A50,A51)" }, { status: 400 })
    }

    // Parallel per-aisle queries — same pattern as collections-due. BC times
    // out on big OR-filters across many aisles, so we run one focused query
    // per prefix concurrently.
    const settled = await Promise.allSettled(aisles.map(a =>
      bcFetchAll(
        token,
        "Receipt_Lines_Excel",
        `startswith(EVA_ArticleLocationCode, '${a}') and EVA_HammerPrice eq 0`,
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
      return NextResponse.json({ error: `BC query failed: ${errs[0]}` }, { status: 500 })
    }

    const rawItems = rows.map(r => ({
      uniqueId:    String(r.EVA_UniqueID ?? ""),
      receiptNo:   String(r.EVA_ReceiptNo ?? ""),
      articleNo:   r.EVA_ArticleNo != null ? String(r.EVA_ArticleNo) : "",
      barcode:     String(r.PTE_InternalBarcode ?? ""),
      description: String(r.EVA_ShortDescription ?? ""),
      location:    String(r.EVA_ArticleLocationCode ?? ""),
      vendorNo:    String(r.EVA_VendorNo ?? ""),
      vendorName:  String(r.EVA_VendorName ?? ""),
      auctionCode: String(r.EVA_SalesAllocation ?? ""),
    }))

    // Look up auction dates for every auction code that appears, so we can
    // drop items whose sale hasn't happened yet (Hammer Price = 0 on a
    // future sale just means "not sold yet", not "unsold"). Receipt_Lines_Excel
    // doesn't expose EVA_AuctionDate — we hit Auction_Lines_Excel per code in
    // parallel (one-row $top=1) for speed and to dodge the BC OR-filter timeout.
    const uniqueCodes = Array.from(new Set(rawItems.map(i => i.auctionCode).filter(Boolean)))
    const dateMap = new Map<string, string>()
    if (uniqueCodes.length > 0) {
      const dateResults = await Promise.allSettled(uniqueCodes.map(code =>
        bcFetchAll(
          token,
          "Auction_Lines_Excel",
          `EVA_AuctionNo eq '${code.replace(/'/g, "''")}'`,
          undefined,
          1,
        )
      ))
      dateResults.forEach((r, i) => {
        if (r.status === "fulfilled" && r.value.length > 0) {
          const d = r.value[0].EVA_AuctionDate
          if (d) dateMap.set(uniqueCodes[i], String(d))
        }
      })
    }

    // "Today" in ISO yyyy-mm-dd — string compare works because EVA_AuctionDate
    // is emitted by BC as ISO 8601.
    const todayIso = new Date().toISOString().slice(0, 10)

    const items = rawItems
      .map(it => ({ ...it, auctionDate: dateMap.get(it.auctionCode) ?? "" }))
      // Drop items where the auction date is in the future. Items with no
      // resolved date are kept (would rather show a stray than silently hide).
      .filter(it => !it.auctionDate || it.auctionDate.slice(0, 10) <= todayIso)
      .sort((a, b) => {
        const locCmp = a.location.localeCompare(b.location)
        if (locCmp !== 0) return locCmp
        return a.barcode.localeCompare(b.barcode)
      })

    return NextResponse.json({
      aisles,
      count: items.length,
      excludedFuture: rawItems.length - items.length,
      items,
      partialErrors: errs.length > 0 ? errs : undefined,
    })
  } catch (e: any) {
    console.error("unsold-items error:", e)
    return NextResponse.json({ error: e?.message ?? "BC query failed" }, { status: 500 })
  }
}
