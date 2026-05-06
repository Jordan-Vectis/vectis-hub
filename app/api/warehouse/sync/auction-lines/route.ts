import { NextRequest, NextResponse } from "next/server"
import { getBCToken, bcPageWithNext } from "@/lib/bc"
import { prisma } from "@/lib/prisma"
import { isAuthedOrCron } from "@/lib/auth-or-cron"

export const maxDuration = 300

function parseBool(v: any): boolean | null {
  if (v === null || v === undefined) return null
  if (typeof v === "boolean") return v
  if (v === "true" || v === "Yes" || v === 1) return true
  if (v === "false" || v === "No" || v === 0) return false
  return null
}

// POST /api/warehouse/sync/auction-lines
// Same pattern as receipt-lines: BC nextLink pagination, parallel upserts,
// loop-driven by the client until more === false.
export async function POST(req: NextRequest) {
  if (!await isAuthedOrCron(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const token = await getBCToken()
  if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

  let full = false
  let nextLink: string | null = null
  let maxItems = 5000
  try {
    const body = await req.json()
    if (body?.full)     full     = !!body.full
    if (body?.nextLink) nextLink = String(body.nextLink)
    if (body?.maxItems) maxItems = body.maxItems
  } catch {}

  const lastSync = (full || nextLink) ? null : await prisma.warehouseSyncLog.findFirst({
    where: { source: "auction_lines", status: "complete" },
    orderBy: { completedAt: "desc" },
  })
  const lastTimestamp = lastSync?.lastTimestamp ?? null

  const syncLog = await prisma.warehouseSyncLog.create({
    data: { source: "auction_lines", status: "running" },
  })

  let itemsProcessed = 0
  let newestTimestamp = lastTimestamp
  const startMs = Date.now()

  try {
    let urlOrEndpoint: string
    let initialParams: Record<string, string | number> | undefined

    if (nextLink) {
      urlOrEndpoint = nextLink
      initialParams = undefined
    } else {
      urlOrEndpoint = "Auction_Receipt_Lines_Excel"
      // No $top — Prefer: odata.maxpagesize=500 in bcPageWithNext drives paging
      initialParams = { $orderby: "EVA_SystemModifiedAt asc" }
      if (lastTimestamp) {
        // OData v4 — bare ISO 8601 literal, ge so boundary items aren't skipped
        initialParams.$filter = `EVA_SystemModifiedAt ge ${lastTimestamp}`
      }
    }

    let currentLink: string | null = null
    let pageCount = 0

    while (true) {
      if (Date.now() - startMs > 50_000) break
      if (itemsProcessed >= maxItems) break

      const { rows, nextLink: nl } = await bcPageWithNext(
        token,
        currentLink ?? urlOrEndpoint,
        currentLink ? undefined : initialParams,
      )

      pageCount++
      currentLink = nl

      if (rows.length === 0) break

      const CHUNK = 20
      const upserts: Promise<any>[] = []
      const validRows = rows.filter(r => String(r.EVA_UniqueID ?? "").trim())
      for (const r of validRows) {
        const uniqueId = String(r.EVA_UniqueID).trim()
        upserts.push(prisma.warehouseItem.upsert({
          where:  { uniqueId },
          // Only fields that auction lines adds — don't overwrite receipt lines data
          update: {
            currentLotNo: r.EVA_CurrentLotNo != null ? String(r.EVA_CurrentLotNo) : null,
            vendorEmail:  r.EVA_VendorEmail  ?? null,
            withdrawLot:  parseBool(r.EVA_WithdrawLot),
          },
          create: {
            uniqueId,
            currentLotNo: r.EVA_CurrentLotNo != null ? String(r.EVA_CurrentLotNo) : null,
            vendorEmail:  r.EVA_VendorEmail  ?? null,
            withdrawLot:  parseBool(r.EVA_WithdrawLot),
            location:     r.EVA_ArticleLocationCode ?? null,
            binCode:      r.EVA_ArticleBinCode      ?? null,
            toteNo:       r.EVA_ArticleToteNo       ?? null,
            auctionCode:  r.EVA_SalesAllocation     ?? null,
            description:  r.EVA_ShortDescription    ?? null,
            vendorNo:     r.EVA_VendorNo            ?? null,
            vendorName:   r.EVA_VendorName          ?? null,
            bcModifiedAt: r.EVA_SystemModifiedAt ? new Date(r.EVA_SystemModifiedAt) : null,
          },
        }))
        if (r.EVA_SystemModifiedAt) newestTimestamp = r.EVA_SystemModifiedAt
      }

      // Parallel chunks of 20
      for (let i = 0; i < upserts.length; i += CHUNK) {
        await Promise.all(upserts.slice(i, i + CHUNK))
      }
      itemsProcessed += validRows.length

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
      ok:           true,
      itemsProcessed,
      incremental:  !full && !!lastTimestamp,
      more,
      nextLink:     currentLink,
      full,
      pages:        pageCount,
    })
  } catch (e: any) {
    await prisma.warehouseSyncLog.update({
      where: { id: syncLog.id },
      data: { status: "failed", completedAt: new Date(), error: e.message, itemsProcessed },
    })
    return NextResponse.json({ error: e.message, itemsProcessed }, { status: 500 })
  }
}
