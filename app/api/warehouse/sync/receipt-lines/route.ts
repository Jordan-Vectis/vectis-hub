import { NextRequest, NextResponse } from "next/server"
import { getBCToken, bcPageWithNext } from "@/lib/bc"
import { prisma } from "@/lib/prisma"
import { isAuthedOrCron } from "@/lib/auth-or-cron"

export const maxDuration = 300

function parseDate(v: any): Date | null {
  if (!v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

function parseBool(v: any): boolean | null {
  if (v === null || v === undefined) return null
  if (typeof v === "boolean") return v
  if (v === "true" || v === "Yes" || v === 1) return true
  if (v === "false" || v === "No" || v === 0) return false
  return null
}

function parseFloat_(v: any): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = parseFloat(String(v))
  return isNaN(n) ? null : n
}

// POST /api/warehouse/sync/receipt-lines
// Uses BC's @odata.nextLink (skiptoken) for pagination — bypasses the $skip
// limit (~38k) that breaks plain skip-based paging on large tables.
//
// Request body:
//   { full?: boolean, nextLink?: string, maxItems?: number }
//
// First call: no nextLink — route builds the initial query (filtered by
// last sync timestamp unless full=true). Subsequent calls: pass back the
// nextLink from the previous response.
//
// Response:
//   { ok, itemsProcessed, more, nextLink, full, totalProcessed }
//
// Loop until more === false on the client.
export async function POST(req: NextRequest) {
  if (!await isAuthedOrCron(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const token = await getBCToken()
  if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

  let full = false
  let nextLink: string | null = null
  let maxItems = 5000          // ~10 pages of 500, safely under the 60s edge
  try {
    const body = await req.json()
    if (body?.full)      full      = !!body.full
    if (body?.nextLink)  nextLink  = String(body.nextLink)
    if (body?.maxItems)  maxItems  = body.maxItems
  } catch {}

  // Determine starting URL — only matters when nextLink is null
  const lastSync = (full || nextLink) ? null : await prisma.warehouseSyncLog.findFirst({
    where: { source: "receipt_lines", status: "complete" },
    orderBy: { completedAt: "desc" },
  })
  const lastTimestamp = lastSync?.lastTimestamp ?? null

  const syncLog = await prisma.warehouseSyncLog.create({
    data: { source: "receipt_lines", status: "running" },
  })

  let itemsProcessed = 0
  let newestTimestamp = lastTimestamp
  const startMs = Date.now()

  try {
    // Build initial URL if no nextLink was supplied
    let urlOrEndpoint: string
    let initialParams: Record<string, string | number> | undefined

    if (nextLink) {
      urlOrEndpoint = nextLink
      initialParams = undefined
    } else {
      urlOrEndpoint = "Receipt_Lines_Excel"
      // No $top — let BC paginate via @odata.nextLink using the
      // Prefer: odata.maxpagesize=500 header set in bcPageWithNext.
      // Adding $top here would cap the entire query and BC would NOT
      // emit a nextLink, ending the sync after one page.
      initialParams = {
        $orderby: "EVA_SystemModifiedAt asc",
      }
      if (lastTimestamp) {
        // ge (not gt) so items sharing a timestamp at the boundary aren't skipped
        // OData v4 — bare ISO 8601 literal, no datetime'...' wrapper (that's v3)
        initialParams.$filter = `EVA_SystemModifiedAt ge ${lastTimestamp}`
      }
    }

    let currentLink: string | null = null
    let pageCount = 0

    while (true) {
      // Stop budget — leave ~10s headroom before the 60s edge timeout
      if (Date.now() - startMs > 50_000) break
      if (itemsProcessed >= maxItems) break

      const { rows, nextLink: nl } = await bcPageWithNext(
        token,
        currentLink ?? urlOrEndpoint,
        currentLink ? undefined : initialParams,
      )

      pageCount++
      currentLink = nl

      if (rows.length === 0) {
        // End of data
        break
      }

      // Upsert rows — parallelised in chunks of 20 for ~10× speedup over
      // sequential awaits without overwhelming the connection pool
      const CHUNK = 20
      const upserts: Promise<any>[] = []
      const validRows = rows.filter(r => String(r.EVA_UniqueID ?? "").trim())
      for (const r of validRows) {
        const uniqueId = String(r.EVA_UniqueID).trim()
        upserts.push(prisma.warehouseItem.upsert({
          where:  { uniqueId },
          update: {
            receiptNo:        r.EVA_ReceiptNo        ?? null,
            articleNo:        r.EVA_ArticleNo != null ? String(r.EVA_ArticleNo) : null,
            stockNo:          r.EVA_StockNo          ?? null,
            barcode:          r.PTE_InternalBarcode  ?? null,
            description:      r.EVA_ShortDescription ?? null,
            artist:           r.EVA_Artist           ?? null,
            category:         r.EVA_ArticleCategoryCode    ?? null,
            subcategory:      r.EVA_ArticleSubcategoryCode ?? null,
            vendorNo:         r.EVA_VendorNo         ?? null,
            vendorName:       r.EVA_VendorName       ?? null,
            auctionCode:      r.EVA_SalesAllocation  ?? null,
            auctionDate:      r.EVA_AuctionDate      ?? null,
            lotNo:            r.EVA_LotNo != null ? String(r.EVA_LotNo) : null,
            lowEstimate:      parseFloat_(r.EVA_LowEstimate),
            highEstimate:     parseFloat_(r.EVA_HighEstimate),
            hammerPrice:      parseFloat_(r.EVA_HammerPrice),
            reservePrice:     parseFloat_(r.EVA_ReservePrice),
            location:         r.EVA_ArticleLocationCode ?? null,
            binCode:          r.EVA_ArticleBinCode      ?? null,
            toteNo:           r.EVA_ArticleToteNo       ?? null,
            catalogued:       parseBool(r.EVA_Catalogued),
            cataloguedBy:     r.EVA_CataloguedBy        ?? null,
            cataloguedAt:     parseDate(r.EVA_CataloguedDateTime),
            noOfPhotos:       r.EVA_NoOfPhotos != null ? parseInt(r.EVA_NoOfPhotos) : null,
            goodsReceived:    parseBool(r.EVA_GoodsReceived),
            goodsReceivedDate: parseDate(r.EVA_GoodsReceivedDate),
            collected:        parseBool(r.EVA_Collected),
            bcModifiedAt:     parseDate(r.EVA_SystemModifiedAt),
          },
          create: {
            uniqueId,
            receiptNo:        r.EVA_ReceiptNo        ?? null,
            articleNo:        r.EVA_ArticleNo != null ? String(r.EVA_ArticleNo) : null,
            stockNo:          r.EVA_StockNo          ?? null,
            barcode:          r.PTE_InternalBarcode  ?? null,
            description:      r.EVA_ShortDescription ?? null,
            artist:           r.EVA_Artist           ?? null,
            category:         r.EVA_ArticleCategoryCode    ?? null,
            subcategory:      r.EVA_ArticleSubcategoryCode ?? null,
            vendorNo:         r.EVA_VendorNo         ?? null,
            vendorName:       r.EVA_VendorName       ?? null,
            auctionCode:      r.EVA_SalesAllocation  ?? null,
            auctionDate:      r.EVA_AuctionDate      ?? null,
            lotNo:            r.EVA_LotNo != null ? String(r.EVA_LotNo) : null,
            lowEstimate:      parseFloat_(r.EVA_LowEstimate),
            highEstimate:     parseFloat_(r.EVA_HighEstimate),
            hammerPrice:      parseFloat_(r.EVA_HammerPrice),
            reservePrice:     parseFloat_(r.EVA_ReservePrice),
            location:         r.EVA_ArticleLocationCode ?? null,
            binCode:          r.EVA_ArticleBinCode      ?? null,
            toteNo:           r.EVA_ArticleToteNo       ?? null,
            catalogued:       parseBool(r.EVA_Catalogued),
            cataloguedBy:     r.EVA_CataloguedBy        ?? null,
            cataloguedAt:     parseDate(r.EVA_CataloguedDateTime),
            noOfPhotos:       r.EVA_NoOfPhotos != null ? parseInt(r.EVA_NoOfPhotos) : null,
            goodsReceived:    parseBool(r.EVA_GoodsReceived),
            goodsReceivedDate: parseDate(r.EVA_GoodsReceivedDate),
            collected:        parseBool(r.EVA_Collected),
            bcModifiedAt:     parseDate(r.EVA_SystemModifiedAt),
          },
        }))
        if (r.EVA_SystemModifiedAt) newestTimestamp = r.EVA_SystemModifiedAt
      }

      // Run upserts in parallel chunks of 20
      for (let i = 0; i < upserts.length; i += CHUNK) {
        await Promise.all(upserts.slice(i, i + CHUNK))
      }
      itemsProcessed += validRows.length

      // No next link → end of data
      if (!nl) break
    }

    const more = !!currentLink

    await prisma.warehouseSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status:         "complete",
        completedAt:    new Date(),
        itemsProcessed,
        lastTimestamp:  newestTimestamp,
      },
    })

    return NextResponse.json({
      ok:             true,
      itemsProcessed,
      incremental:    !full && !!lastTimestamp,
      more,
      nextLink:       currentLink,
      full,
      pages:          pageCount,
    })
  } catch (e: any) {
    await prisma.warehouseSyncLog.update({
      where: { id: syncLog.id },
      data: { status: "failed", completedAt: new Date(), error: e.message, itemsProcessed },
    })
    return NextResponse.json({ error: e.message, itemsProcessed }, { status: 500 })
  }
}
