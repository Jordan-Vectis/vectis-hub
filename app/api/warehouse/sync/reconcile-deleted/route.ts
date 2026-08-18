import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isAuthedOrCron } from "@/lib/auth-or-cron"
import { getBCTokenAny, bcPage } from "@/lib/bc"

export const maxDuration = 300
export const runtime = "nodejs"

// POST /api/warehouse/sync/reconcile-deleted
//
// Removes cached WarehouseItem rows that NO LONGER EXIST in Business Central.
//
// ⚠ WHY (found 2026-08-18, Jordan: "Then something is wrong as BC only holds 50"): every sync
// stage is upsert-only — deliberately, so a partial walk can never wipe good data — which means
// a row DELETED in BC lives in our copy forever. Receipt R008537 had 143 cached rows against
// live BC's 50: the extra 93 were A995 temp lines BC deleted when the items were re-receipted.
// Those ghosts carried barcodes that now belong to OTHER customers' lots, which is how a search
// for one customer's tote showed another customer's items in the Admin Centre.
//
// ⚠ HOW IT STAYS SAFE — this is the first stage allowed to delete, so the rules are strict:
//   • SUSPECTS ONLY. It only examines receipts that have at least one row in an A9xx holding
//     pen (Temp/Unsold/problem sales) — the shape every observed ghost has. It never walks the
//     whole table deciding what to kill.
//   • LIVE BC IS THE ONLY AUTHORITY. For each suspect receipt it fetches that receipt's rows
//     from BC itself, right now — never a heuristic, never our own cache.
//   • AN EMPTY ANSWER DELETES NOTHING. If BC returns no rows for a receipt (deleted receipt?
//     transient error? odd filter behaviour?) we skip it and say so, because "delete everything"
//     must never ride on a response that might just have failed.
//   • A FETCH ERROR STOPS THE RUN rather than skipping ahead.
//
// Speaks the same contract as the other sync stages ({nextLink, maxItems} in;
// {itemsProcessed, pages, more, nextLink} out) so the Data Sync tab's stage loop drives it
// unchanged. `nextLink` is the last receipt processed; `itemsProcessed` is rows deleted.
const RECEIPTS_PER_CALL = 25

export async function POST(req: NextRequest) {
  if (!await isAuthedOrCron(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const token = await getBCTokenAny()
  if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

  let cursor = ""
  try {
    const body = await req.json()
    if (body?.nextLink) cursor = String(body.nextLink)
  } catch {}

  const syncLog = await prisma.warehouseSyncLog.create({
    data: { source: "reconcile-deleted", status: "running" },
  })

  let deleted = 0
  let checked = 0
  let skippedEmpty = 0

  try {
    // Receipts that hold at least one holding-pen row — the ghosts' signature.
    const suspects = await prisma.$queryRaw<{ receiptNo: string }[]>`
      SELECT DISTINCT "receiptNo" FROM "WarehouseItem"
       WHERE "auctionCode" ~ '^A9[0-9][0-9]$'
         AND "receiptNo" IS NOT NULL AND "receiptNo" <> ''
         AND "receiptNo" > ${cursor}
       ORDER BY "receiptNo"
       LIMIT ${RECEIPTS_PER_CALL}`

    let last = cursor
    for (const { receiptNo } of suspects) {
      last = receiptNo
      // Live truth for this one receipt, straight from BC. A throw aborts the run (caught
      // below) — we never delete on the back of a failed read.
      const esc = receiptNo.replace(/'/g, "''")
      const live = await bcPage(token, "Receipt_Lines_Excel", {
        $filter: `EVA_ReceiptNo eq '${esc}'`,
        $select: "EVA_UniqueID",
        $top: 5000,
      })
      checked++
      if (live.length === 0) { skippedEmpty++; continue }   // see the safety note above

      const liveIds = live.map((r: any) => String(r.EVA_UniqueID ?? "")).filter(Boolean)
      const res = await prisma.warehouseItem.deleteMany({
        where: { receiptNo, uniqueId: { notIn: liveIds } },
      })
      deleted += res.count
    }

    const more = suspects.length === RECEIPTS_PER_CALL
    await prisma.warehouseSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status: "complete", completedAt: new Date(), itemsProcessed: deleted,
        error: skippedEmpty ? `skipped ${skippedEmpty} receipt(s) with an empty BC answer` : null,
      },
    }).catch(() => {})

    return NextResponse.json({
      itemsProcessed: deleted,
      pages: checked,
      more,
      nextLink: more ? last : null,
    })
  } catch (e: any) {
    await prisma.warehouseSyncLog.update({
      where: { id: syncLog.id },
      data: { status: "failed", completedAt: new Date(), error: String(e?.message ?? e).slice(0, 500) },
    }).catch(() => {})
    console.error("warehouse/sync/reconcile-deleted error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
