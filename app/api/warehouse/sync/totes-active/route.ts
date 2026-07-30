import { NextRequest, NextResponse } from "next/server"
import { getBCTokenAny, bcPageWithNext } from "@/lib/bc"
import { prisma } from "@/lib/prisma"
import { isAuthedOrCron } from "@/lib/auth-or-cron"

export const maxDuration = 300

// ⚠ Business Central sends an EMPTY date as "0001-01-01T00:00:00Z", which parses
// into a perfectly valid Date in year 1 — stored as-is it reads as real data
// (the Manager Portal showed a tote as "2,025 years behind"). Anything before
// 1990 is BC's way of saying "no date".
function bcDate(v: unknown): Date | null {
  if (!v) return null
  const d = new Date(String(v))
  if (isNaN(d.getTime())) return null
  return d.getUTCFullYear() < 1990 ? null : d
}

// ⚠ BC returns booleans as strings sometimes ("true"/"Yes"). The old
// `x === true || x === 1` stored `catalogued` as FALSE for every tote when BC
// sent a string — matching parseBool in the receipt-lines sync fixes that.
function bcBool(v: unknown): boolean {
  return v === true || v === 1 || v === "true" || v === "Yes" || v === "1"
}

// POST /api/warehouse/sync/totes-active
// Syncs Receipt_Totes_Excel — active (uncatalogued) totes only, with richer data:
// precise location, vendor info, reserve status, catalogued flag.
// Upserts into WarehouseTote so records created by the totes sync get enriched,
// and any active totes not yet in the DB are created.
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

  const syncLog = await prisma.warehouseSyncLog.create({
    data: { source: "totes-active", status: "running" },
  })

  let itemsProcessed = 0
  const startMs = Date.now()

  // bcCreatedAt arrives with Run Migrations, but code deploys to Railway before
  // that happens. Writing a column that doesn't exist yet fails EVERY upsert and
  // takes the whole tote sync down with it — so check once and omit the field
  // until the column is there.
  let hasBcCreatedAt = false
  try {
    const [row] = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'WarehouseTote' AND column_name = 'bcCreatedAt'
      ) AS "exists"`
    hasBcCreatedAt = !!row?.exists
  } catch { hasBcCreatedAt = false }

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
            catalogued: bcBool(r.EVA_TOT_Catalogued),
            ...(hasBcCreatedAt ? { bcCreatedAt: bcDate(r.SystemCreatedAt) } : {}),
            syncedAt:   new Date(),
          },
          create: {
            toteNo,
            location:   String(r.EVA_TOT_ToteLocation  ?? "").trim() || null,
            receiptNo:  r.EVA_TOT_ReceiptNo  ?? null,
            vendorNo:   r.EVA_TOT_VendorNo   ?? null,
            vendorName: r.EVA_TOT_VendorName ?? null,
            status:     r.EVA_TOT_ReserveStatus ?? null,
            catalogued: bcBool(r.EVA_TOT_Catalogued),
            ...(hasBcCreatedAt ? { bcCreatedAt: bcDate(r.SystemCreatedAt) } : {}),
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
