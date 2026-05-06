import { NextRequest, NextResponse } from "next/server"
import { getBCToken, bcPageWithNext } from "@/lib/bc"
import { prisma } from "@/lib/prisma"
import { isAuthedOrCron } from "@/lib/auth-or-cron"

export const maxDuration = 300

// POST /api/warehouse/sync/totes-active
// Syncs Receipt_Totes_Excel — active (uncatalogued) totes only, with richer data:
// precise location, vendor info, reserve status, catalogued flag.
// Upserts into WarehouseTote so records created by the totes sync get enriched,
// and any active totes not yet in the DB are created.
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

  const syncLog = await prisma.warehouseSyncLog.create({
    data: { source: "totes-active", status: "running" },
  })

  let itemsProcessed = 0
  const startMs = Date.now()

  try {
    const urlOrEndpoint = nextLink ?? "Receipt_Totes_Excel"
    // No $orderby — Receipt_Totes_Excel has no sortable timestamp field
    const initialParams = nextLink ? undefined : undefined

    let currentLink: string | null = null
    let pageCount = 0

    while (true) {
      if (Date.now() - startMs > 25_000) break
      if (itemsProcessed >= maxItems) break

      const { rows, nextLink: nl } = await bcPageWithNext(
        token,
        currentLink ?? urlOrEndpoint,
        currentLink ? undefined : initialParams,
      )

      pageCount++
      currentLink = nl
      if (rows.length === 0) break

      const upserts: Promise<any>[] = []
      for (const r of rows) {
        const toteNo = String(r.EVA_TOT_ToteNo ?? "").trim()
        if (!toteNo) continue
        upserts.push(prisma.warehouseTote.upsert({
          where:  { toteNo },
          update: {
            location:   String(r.EVA_TOT_ToteLocation  ?? "").trim() || null,
            receiptNo:  r.EVA_TOT_ReceiptNo  ?? null,
            vendorNo:   r.EVA_TOT_VendorNo   ?? null,
            vendorName: r.EVA_TOT_VendorName ?? null,
            status:     r.EVA_TOT_ReserveStatus ?? null,
            catalogued: r.EVA_TOT_Catalogued === true || r.EVA_TOT_Catalogued === 1,
            syncedAt:   new Date(),
          },
          create: {
            toteNo,
            location:   String(r.EVA_TOT_ToteLocation  ?? "").trim() || null,
            receiptNo:  r.EVA_TOT_ReceiptNo  ?? null,
            vendorNo:   r.EVA_TOT_VendorNo   ?? null,
            vendorName: r.EVA_TOT_VendorName ?? null,
            status:     r.EVA_TOT_ReserveStatus ?? null,
            catalogued: r.EVA_TOT_Catalogued === true || r.EVA_TOT_Catalogued === 1,
          },
        }))
      }

      for (let i = 0; i < upserts.length; i += 20) {
        await Promise.all(upserts.slice(i, i + 20))
      }
      itemsProcessed += upserts.length
      if (!nl) break
    }

    const more = !!currentLink
    await prisma.warehouseSyncLog.update({
      where: { id: syncLog.id },
      data: { status: "complete", completedAt: new Date(), itemsProcessed },
    })
    return NextResponse.json({ ok: true, itemsProcessed, more, nextLink: currentLink, full, pages: pageCount })

  } catch (e: any) {
    await prisma.warehouseSyncLog.update({
      where: { id: syncLog.id },
      data: { status: "failed", completedAt: new Date(), error: e.message, itemsProcessed },
    })
    return NextResponse.json({ error: e.message, itemsProcessed }, { status: 500 })
  }
}
