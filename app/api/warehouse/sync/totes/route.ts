import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcPageWithNext } from "@/lib/bc"
import { prisma } from "@/lib/prisma"
import { isAuthedOrCron } from "@/lib/auth-or-cron"

export const maxDuration = 300

// GET — probe: field names + count from Totes_Excel
export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
  const token = await getBCToken()
  if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })
  const { rows, count } = await bcPageWithNext(token, "Totes_Excel", { $top: 2, "$count": "true" })
  if (!rows.length) return NextResponse.json({ bcCount: count ?? null, fields: [], sample: null })
  return NextResponse.json({ bcCount: count ?? null, fields: Object.keys(rows[0]), sample: rows[0], sample2: rows[1] ?? null })
}

// POST /api/warehouse/sync/totes
// Syncs Totes_Excel — all T/P-prefixed totes (catalogued + uncatalogued) with basic location data.
// On full re-sync the table is cleared first.
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

  if (full && !nextLink) {
    await prisma.warehouseTote.deleteMany({})
  }

  const syncLog = await prisma.warehouseSyncLog.create({
    data: { source: "totes", status: "running" },
  })

  let itemsProcessed = 0
  const startMs = Date.now()

  try {
    const urlOrEndpoint = nextLink ?? "Totes_Excel"
    // No $orderby — BC skiptoken pagination doesn't require explicit ordering
    // and sorting adds overhead on this table slowing each page response
    const initialParams = nextLink ? undefined : {
      $filter: "startswith(EVA_No,'T') or startswith(EVA_No,'P')",
    }

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
        const toteNo = String(r.EVA_No ?? "").trim()
        if (!toteNo) continue
        upserts.push(prisma.warehouseTote.upsert({
          where:  { toteNo },
          update: { location: String(r.EVA_Location ?? "").trim() || null, syncedAt: new Date() },
          create: { toteNo, location: String(r.EVA_Location ?? "").trim() || null },
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
