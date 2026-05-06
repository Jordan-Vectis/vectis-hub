import { NextRequest, NextResponse } from "next/server"
import { getBCToken, bcPageWithNext } from "@/lib/bc"
import { prisma } from "@/lib/prisma"
import { isAuthedOrCron } from "@/lib/auth-or-cron"

export const maxDuration = 300

// POST /api/warehouse/sync/changelog
// Reads ChangeLogEntries for Article Location Code changes, updating
// locationScannedAt on matching WarehouseItems. Uses BC nextLink pagination
// so it can walk the entire change log past the ~38k $skip cap.
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
    where: { source: "changelog", status: "complete" },
    orderBy: { completedAt: "desc" },
  })
  const lastTimestamp = lastSync?.lastTimestamp ?? null

  const syncLog = await prisma.warehouseSyncLog.create({
    data: { source: "changelog", status: "running" },
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
      urlOrEndpoint = "ChangeLogEntries"
      // No $top — Prefer header drives paging; bare ISO datetime, ge for boundary
      const filterParts = [`Field_Caption eq 'Article Location Code'`]
      if (lastTimestamp) filterParts.push(`Date_and_Time ge ${lastTimestamp}`)
      initialParams = {
        $filter:  filterParts.join(" and "),
        $select:  "Primary_Key_Field_2_Value,New_Value,Date_and_Time",
        $orderby: "Date_and_Time asc",
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

      // Build updates: each entry sets locationScannedAt on the matching item
      // if the entry is newer than what's already stored.
      const CHUNK = 20
      const updates: Promise<any>[] = []
      for (const r of rows) {
        const uniqueId  = String(r.Primary_Key_Field_2_Value ?? "").trim()
        const scannedAt = r.Date_and_Time ? new Date(r.Date_and_Time) : null
        if (!uniqueId || !scannedAt) continue

        updates.push(prisma.warehouseItem.updateMany({
          where: {
            uniqueId,
            OR: [
              { locationScannedAt: null },
              { locationScannedAt: { lt: scannedAt } },
            ],
          },
          data: { locationScannedAt: scannedAt },
        }))

        if (r.Date_and_Time) newestTimestamp = r.Date_and_Time
      }

      for (let i = 0; i < updates.length; i += CHUNK) {
        await Promise.all(updates.slice(i, i + CHUNK))
      }
      itemsProcessed += updates.length

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
