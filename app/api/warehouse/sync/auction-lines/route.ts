import { NextRequest, NextResponse } from "next/server"
import { getBCTokenAny, bcPageWithNext } from "@/lib/bc"
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

  const token = await getBCTokenAny()
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

    // ── Lot-number top-up for the sales still being numbered ─────────────────
    //
    // ⚠⚠ ASSIGNING A LOT NUMBER IN BC DOES NOT BUMP EVA_SystemModifiedAt. Measured live on
    // 2026-09-03: F114439 had EVA_CurrentLotNo = 469 in BC with a modified stamp of 01/09 12:29,
    // and our incremental pass above (`ge lastTimestamp`, then 03/09 10:05) had no reason ever to
    // read it again — so our copy said 0, the Admin Centre said "94 not numbered yet", and
    // searching F114 for lot 469 found nothing (Jordan: "why is searching by this lot ... not
    // pulling anything through"). The 600 lots on that sale that DID have numbers only had them
    // because something else edited the line after numbering.
    //
    // So once the incremental pass has caught up, re-read the NUMBERED lines of every sale still
    // in play — dated within the last week or the next year — with no stamp filter at all. Only
    // lines with a number come back (`EVA_CurrentLotNo ne 0`), so it is a few hundred rows, not
    // the whole table, and it runs per sale in parallel because a big OR filter times out (RULES).
    // The placeholder sales (A99x / X999, dated 2099–3000) fall outside the window on purpose.
    let topUp: { sales: number; rowsRead: number; updated: number; failed: string[] } | null = null
    if (!more) {
      const today = new Date()
      const from  = new Date(today.getTime() - 7 * 86_400_000).toISOString().slice(0, 10)
      const to    = new Date(today.getTime() + 365 * 86_400_000).toISOString().slice(0, 10)
      const sales = await prisma.$queryRaw<{ auctionCode: string }[]>`
        SELECT DISTINCT "auctionCode" FROM "WarehouseItem"
        WHERE "auctionCode" IS NOT NULL
          AND "auctionDate" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          AND left("auctionDate", 10) BETWEEN ${from} AND ${to}`
      topUp = { sales: sales.length, rowsRead: 0, updated: 0, failed: [] }

      const oneSale = async (code: string) => {
        let link: string | null = null
        let params: Record<string, string | number> | undefined =
          { $filter: `EVA_SalesAllocation eq '${code.replace(/'/g, "''")}' and EVA_CurrentLotNo ne 0` }
        for (let page = 0; page < 20; page++) {
          const { rows, nextLink: nl }: { rows: any[]; nextLink: string | null } =
            await bcPageWithNext(token, link ?? "Auction_Receipt_Lines_Excel", link ? undefined : params)
          params = undefined
          const writes: Promise<unknown>[] = []
          for (const r of rows) {
            const uniqueId = String(r.EVA_UniqueID ?? "").trim()
            if (!uniqueId || r.EVA_CurrentLotNo == null) continue
            const lotNo = String(r.EVA_CurrentLotNo)
            // Only touch the ones we hold wrong — the write is the expensive part.
            // ⚠ `NOT { currentLotNo: lotNo }` alone would SKIP a NULL — SQL's NOT (NULL = x) is
            // NULL, not true — so a never-numbered row has to be matched explicitly.
            writes.push(prisma.warehouseItem.updateMany({
              where: { uniqueId, OR: [{ currentLotNo: null }, { NOT: { currentLotNo: lotNo } }] },
              data:  { currentLotNo: lotNo },
            }).then(res => { topUp!.updated += res.count }))
          }
          for (let i = 0; i < writes.length; i += 20) await Promise.all(writes.slice(i, i + 20))
          topUp!.rowsRead += rows.length
          if (!nl) break
          link = nl
        }
      }

      // Five sales at a time — enough to be quick, few enough not to trip BC.
      const codes = sales.map(s => s.auctionCode)
      for (let i = 0; i < codes.length; i += 5) {
        const results = await Promise.allSettled(codes.slice(i, i + 5).map(oneSale))
        results.forEach((r, j) => { if (r.status === "rejected") topUp!.failed.push(codes[i + j]) })
      }
    }

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
      // What the numbering top-up did this run — see the block above.
      topUp,
    })
  } catch (e: any) {
    await prisma.warehouseSyncLog.update({
      where: { id: syncLog.id },
      data: { status: "failed", completedAt: new Date(), error: e.message, itemsProcessed },
    })
    return NextResponse.json({ error: e.message, itemsProcessed }, { status: 500 })
  }
}
