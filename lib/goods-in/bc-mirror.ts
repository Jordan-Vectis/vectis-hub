import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { STATUS_FOR_KIND, type LocationKind } from "@/lib/goods-in/model"
import { BC_MIRROR_SOURCE, FROM_BC } from "@/lib/goods-in/source"

// BC's receipts and totes → Goods In's own tables (2026-10-23). Jordan chose "one database, like
// Customers": the nightly copy writes Business Central's receipts and totes INTO GoodsInReceipt /
// GoodsInContainer (source "bc"), linked to the Customer by seller number, so Goods In's Receipts
// list, Find and the customer pages show BC's and the Hub's together — read-only for BC rows until
// WAREHOUSE_OWNER=hub, when the Hub takes them over with nothing to migrate.
//
// It reads the Hub's OWN BC copies (WarehouseTote + WarehouseReceiptTote, filled by the BC
// Warehouse Data Sync) — never BC itself, and it writes nothing to BC. One page a call, the caller
// drives the loop (the cron route and the Settings panel), keyset on the tote number.
//
// Rules, all deliberate:
//   • A row booked in the Hub (source null / "hub") is NEVER overwritten — the INSERT's ON CONFLICT
//     only updates rows whose source is already "bc". A BC number that lands on a Hub row is counted
//     and named (`hubClashes`): the number series carry on from BC's, so this means a series was set
//     too low.
//   • A tote with no receipt in BC (a "shell" tote, ~1,600) is skipped — a container must sit on a
//     receipt. The BC Warehouse page still shows them.
//   • Nothing is deleted. A tote that disappears from BC keeps its row; its bcSyncedAt stops moving.
//   • A receipt's status is worked out from its totes: every tote catalogued → "closed", else "open"
//     (BC has no receipt status). A tote's: BC's catalogued tick → "catalogued"; else at a location
//     the Hub knows → that location's kind; at an unknown code → "stored"; no location → "booked".
//     BC gives no move time, so movedAt stays null (the screens say "as at the last BC copy").
//   • Changes only, by default: rows whose BC copy was touched since the last COMPLETE run began
//     (10 minutes' grace). `full` reads everything.

export const PAGE_SIZE = 1000
const GRACE_MS = 10 * 60_000
const BC_NAME = "Business Central"

export type MirrorPage = {
  /** The last tote number done; null starts from the beginning. */
  cursor: string | null
  /** Read every tote, not only ones changed since the last complete run. */
  full?: boolean
  /** The WarehouseSyncLog row this run writes to (made on the first page). */
  runId?: string | null
}

export type MirrorPageResult = {
  ok: true
  runId: string
  cursor: string | null
  more: boolean
  /** How many totes this run will look at (counted once, on the first page). */
  total: number | null
  totes: number
  receipts: number
  skippedNoReceipt: number
  hubClashes: string[]
} | { ok: false; error: string; notReady?: boolean }

type Line = {
  toteNo: string
  location: string | null
  status: string | null
  catalogued: boolean | null
  category: string | null
  subCategory: string | null
  contents: string | null
  bcCreatedAt: Date | null
  syncedAt: Date
  vendorNo: string | null
  vendorName: string | null
  receiptNo: string | null
  rtReceiptNo: string | null
  rtVendorNo: string | null
  rtVendorName: string | null
  rtCatalogued: boolean | null
  rtCreatedAt: Date | null
}

const isMissingTable = (e: unknown) => {
  const m = String((e as { message?: string })?.message ?? e)
  return /does not exist|P2021|42P01|42703/.test(m)
}

/** When the last complete run started, less the grace — what "changed since" means. */
export async function lastMirrorSince(): Promise<Date | null> {
  const last = await prisma.warehouseSyncLog.findFirst({ where: { source: BC_MIRROR_SOURCE, status: "complete" }, orderBy: { startedAt: "desc" }, select: { startedAt: true } })
  return last ? new Date(last.startedAt.getTime() - GRACE_MS) : null
}

export async function mirrorBcPage(page: MirrorPage): Promise<MirrorPageResult> {
  try {
    const full = !!page.full
    let runId = page.runId ?? null
    let total: number | null = null
    let since: Date | null = null

    // First page: open the run and decide what "changed since" means. The since is kept on the row
    // (lastTimestamp) so later pages of the same run read the same window.
    if (!runId) {
      since = full ? null : await lastMirrorSince()
      const run = await prisma.warehouseSyncLog.create({ data: { source: BC_MIRROR_SOURCE, status: "running", lastTimestamp: since?.toISOString() ?? (full ? "full" : "all") } })
      runId = run.id
    } else {
      const run = await prisma.warehouseSyncLog.findUnique({ where: { id: runId }, select: { lastTimestamp: true, status: true } })
      if (!run) return { ok: false, error: "That copy run can't be found — start it again." }
      if (run.status !== "running") return { ok: false, error: "That copy run has already finished — start it again." }
      since = run.lastTimestamp && run.lastTimestamp !== "full" && run.lastTimestamp !== "all" ? new Date(run.lastTimestamp) : null
    }

    const changed = since
      ? Prisma.sql`AND (t."syncedAt" > ${since} OR EXISTS (SELECT 1 FROM "WarehouseReceiptTote" x WHERE x."toteNo" = t."toteNo" AND x."syncedAt" > ${since}))`
      : Prisma.empty
    if (!page.cursor) {
      const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "WarehouseTote" t WHERE TRUE ${changed}`
      total = n
    }
    const after = page.cursor ? Prisma.sql`AND t."toteNo" > ${page.cursor}` : Prisma.empty

    // The newest receipt line for each tote decides which receipt it is on (a re-used tote number
    // can sit on two receipts in BC's history).
    const lines = await prisma.$queryRaw<Line[]>`
      SELECT t."toteNo", t."location", t."status", t."catalogued", t."category", t."subCategory", t."contents", t."bcCreatedAt", t."syncedAt",
             t."vendorNo", t."vendorName", t."receiptNo",
             rt."receiptNo" AS "rtReceiptNo", rt."vendorNo" AS "rtVendorNo", rt."vendorName" AS "rtVendorName", rt."catalogued" AS "rtCatalogued", rt."bcCreatedAt" AS "rtCreatedAt"
      FROM "WarehouseTote" t
      LEFT JOIN LATERAL (
        SELECT "receiptNo", "vendorNo", "vendorName", "catalogued", "bcCreatedAt"
        FROM "WarehouseReceiptTote" WHERE "toteNo" = t."toteNo"
        ORDER BY "bcCreatedAt" DESC NULLS LAST, "lineNo" DESC NULLS LAST LIMIT 1
      ) rt ON TRUE
      WHERE TRUE ${after} ${changed}
      ORDER BY t."toteNo"
      LIMIT ${PAGE_SIZE}`

    const now = new Date()
    const result = { totes: 0, receipts: 0, skippedNoReceipt: 0, hubClashes: [] as string[] }
    const rows = lines.map(l => ({ ...l, receiptNo: (l.rtReceiptNo ?? l.receiptNo)?.trim().toUpperCase() || null, vendorNo: (l.rtVendorNo ?? l.vendorNo)?.trim().toUpperCase() || null, vendorName: l.rtVendorName ?? l.vendorName }))
    const withReceipt = rows.filter(r => r.receiptNo)
    result.skippedNoReceipt = rows.length - withReceipt.length

    if (withReceipt.length) {
      const receiptNos = [...new Set(withReceipt.map(r => r.receiptNo!))]
      const toteNos = withReceipt.map(r => r.toteNo)

      // Hub rows these numbers would land on — counted and named, never written over.
      const [hubReceipts, hubContainers] = await Promise.all([
        prisma.goodsInReceipt.findMany({ where: { id: { in: receiptNos }, OR: [{ source: null }, { source: { not: FROM_BC } }] }, select: { id: true } }),
        prisma.goodsInContainer.findMany({ where: { id: { in: toteNos }, OR: [{ source: null }, { source: { not: FROM_BC } }] }, select: { id: true } }),
      ])
      result.hubClashes.push(...hubReceipts.map(r => r.id), ...hubContainers.map(c => c.id))
      const hubReceiptSet = new Set(hubReceipts.map(r => r.id))
      const hubContainerSet = new Set(hubContainers.map(c => c.id))

      // Each receipt as a whole (all its lines, not only this page's): first date, every tote catalogued, seller.
      const agg = await prisma.$queryRaw<{ receiptNo: string; first: Date | null; allCatalogued: boolean; vendorNo: string | null; vendorName: string | null; lines: number }[]>`
        SELECT "receiptNo", min("bcCreatedAt") AS first, bool_and("catalogued") AS "allCatalogued",
               max("vendorNo") AS "vendorNo", max("vendorName") AS "vendorName", count(*)::int AS lines
        FROM "WarehouseReceiptTote" WHERE "receiptNo" IN (${Prisma.join(receiptNos)}) GROUP BY 1`
      const aggOf = new Map(agg.map(a => [a.receiptNo.trim().toUpperCase(), a]))
      const vendorNos = [...new Set(withReceipt.map(r => r.vendorNo).filter((v): v is string => !!v))]
      const customers = vendorNos.length ? await prisma.customer.findMany({ where: { vendorNo: { in: vendorNos } }, select: { id: true, vendorNo: true, name: true, name2: true } }) : []
      const customerOf = new Map(customers.map(c => [c.vendorNo!, c]))
      const codes = [...new Set(withReceipt.map(r => r.location?.trim().toUpperCase()).filter((c): c is string => !!c))]
      const locs = codes.length ? await prisma.goodsInLocation.findMany({ where: { code: { in: codes } }, select: { code: true, kind: true } }) : []
      const kindOf = new Map(locs.map(l => [l.code, l.kind]))

      // Receipts first (the containers' foreign key), one INSERT … ON CONFLICT per page.
      const receiptRows = receiptNos.filter(no => !hubReceiptSet.has(no)).map(no => {
        const a = aggOf.get(no)
        const line = withReceipt.find(r => r.receiptNo === no)!
        const vendorNo = a?.vendorNo?.trim().toUpperCase() || line.vendorNo
        const cust = vendorNo ? customerOf.get(vendorNo) : undefined
        const vendorName = a?.vendorName ?? line.vendorName ?? cust?.name ?? cust?.name2 ?? null
        return {
          id: no, customerId: cust?.id ?? null, vendorNo,
          customer: JSON.stringify({ name: vendorName, vendorNo }),
          status: a?.allCatalogued ? "closed" : "open",
          createdAt: a?.first ?? line.rtCreatedAt ?? line.bcCreatedAt ?? now,
          bcData: JSON.stringify({ receiptNo: no, vendorNo, vendorName, lines: a?.lines ?? null, allCatalogued: a?.allCatalogued ?? null, firstBcCreatedAt: a?.first ?? null }),
        }
      })
      if (receiptRows.length) {
        await prisma.$executeRaw`
          INSERT INTO "GoodsInReceipt" ("id", "customerId", "vendorNo", "customer", "status", "createdById", "createdByName", "createdAt", "updatedAt", "source", "bcSyncedAt", "bcData")
          SELECT r.id, r."customerId", r."vendorNo", r.customer::jsonb, r.status, NULL, ${BC_NAME}, r."createdAt", ${now}, ${FROM_BC}, ${now}, r."bcData"::jsonb
          FROM unnest(
            ${receiptRows.map(r => r.id)}::text[], ${receiptRows.map(r => r.customerId)}::text[], ${receiptRows.map(r => r.vendorNo)}::text[],
            ${receiptRows.map(r => r.customer)}::text[], ${receiptRows.map(r => r.status)}::text[], ${receiptRows.map(r => r.createdAt)}::timestamp(3)[], ${receiptRows.map(r => r.bcData)}::text[]
          ) AS r(id, "customerId", "vendorNo", customer, status, "createdAt", "bcData")
          ON CONFLICT ("id") DO UPDATE SET
            "customerId" = COALESCE(EXCLUDED."customerId", "GoodsInReceipt"."customerId"),
            "vendorNo" = EXCLUDED."vendorNo", "customer" = EXCLUDED."customer", "status" = EXCLUDED."status",
            "createdAt" = EXCLUDED."createdAt", "updatedAt" = EXCLUDED."updatedAt", "bcSyncedAt" = EXCLUDED."bcSyncedAt", "bcData" = EXCLUDED."bcData"
          WHERE "GoodsInReceipt"."source" = ${FROM_BC}`
        result.receipts = receiptRows.length
      }

      // Then the totes and pallets.
      const containerRows = withReceipt.filter(r => !hubContainerSet.has(r.toteNo) && !hubReceiptSet.has(r.receiptNo!)).map(r => {
        const location = r.location?.trim().toUpperCase() || null
        const kind = location ? kindOf.get(location) ?? null : null
        const catalogued = r.rtCatalogued ?? r.catalogued ?? false
        const status = catalogued ? "catalogued" : location ? (kind && kind in STATUS_FOR_KIND ? STATUS_FOR_KIND[kind as LocationKind] : "stored") : "booked"
        return {
          id: r.toteNo, receiptId: r.receiptNo!, kind: r.toteNo.startsWith("P") ? "pallet" : "tote",
          category: [r.category, r.subCategory].filter(Boolean).join(" / ") || null,
          description: r.contents?.trim() || null,
          status, locationCode: location, locationKind: kind,
          createdAt: r.rtCreatedAt ?? r.bcCreatedAt ?? now,
          bcData: JSON.stringify({ location: r.location, status: r.status, catalogued, category: r.category, subCategory: r.subCategory, contents: r.contents, bcCreatedAt: r.bcCreatedAt, receiptNo: r.receiptNo, vendorNo: r.vendorNo, vendorName: r.vendorName, copiedFrom: "WarehouseTote + WarehouseReceiptTote" }),
        }
      })
      if (containerRows.length) {
        await prisma.$executeRaw`
          INSERT INTO "GoodsInContainer" ("id", "receiptId", "kind", "category", "description", "status", "locationCode", "locationKind", "movedAt", "createdByName", "createdAt", "updatedAt", "source", "bcSyncedAt", "bcData")
          SELECT c.id, c."receiptId", c.kind, c.category, c.description, c.status, c."locationCode", c."locationKind", NULL, ${BC_NAME}, c."createdAt", ${now}, ${FROM_BC}, ${now}, c."bcData"::jsonb
          FROM unnest(
            ${containerRows.map(c => c.id)}::text[], ${containerRows.map(c => c.receiptId)}::text[], ${containerRows.map(c => c.kind)}::text[],
            ${containerRows.map(c => c.category)}::text[], ${containerRows.map(c => c.description)}::text[], ${containerRows.map(c => c.status)}::text[],
            ${containerRows.map(c => c.locationCode)}::text[], ${containerRows.map(c => c.locationKind)}::text[], ${containerRows.map(c => c.createdAt)}::timestamp(3)[], ${containerRows.map(c => c.bcData)}::text[]
          ) AS c(id, "receiptId", kind, category, description, status, "locationCode", "locationKind", "createdAt", "bcData")
          ON CONFLICT ("id") DO UPDATE SET
            "receiptId" = EXCLUDED."receiptId", "kind" = EXCLUDED."kind", "category" = EXCLUDED."category", "description" = EXCLUDED."description",
            "status" = EXCLUDED."status", "locationCode" = EXCLUDED."locationCode", "locationKind" = EXCLUDED."locationKind",
            "createdAt" = EXCLUDED."createdAt", "updatedAt" = EXCLUDED."updatedAt", "bcSyncedAt" = EXCLUDED."bcSyncedAt", "bcData" = EXCLUDED."bcData"
          WHERE "GoodsInContainer"."source" = ${FROM_BC}`
        result.totes = containerRows.length
      }
    }

    const more = lines.length === PAGE_SIZE
    const cursor = lines.length ? lines[lines.length - 1].toteNo : page.cursor
    // The run's row keeps a running total; the last page closes it.
    await prisma.warehouseSyncLog.update({
      where: { id: runId },
      data: { itemsProcessed: { increment: result.totes }, ...(more ? {} : { status: "complete", completedAt: new Date() }) },
    })
    return { ok: true, runId, cursor, more, total, ...result }
  } catch (e: any) {
    console.error("[goods-in bc-mirror]", e)
    if (page.runId) await prisma.warehouseSyncLog.update({ where: { id: page.runId }, data: { status: "failed", completedAt: new Date(), error: String(e?.message ?? e).slice(0, 500) } }).catch(() => {})
    if (isMissingTable(e)) return { ok: false, notReady: true, error: "Goods In's BC copy needs an admin to press Run Migrations first." }
    return { ok: false, error: String(e?.message ?? e).slice(0, 300) }
  }
}

/** A run stopped from the Settings panel: mark it so, keeping what was copied. */
export async function stopMirrorRun(runId: string, by: string | null): Promise<void> {
  await prisma.warehouseSyncLog.updateMany({ where: { id: runId, status: "running" }, data: { status: "failed", completedAt: new Date(), error: `Stopped${by ? ` by ${by}` : ""} — what was copied so far is kept.` } })
}

export type MirrorStatus = {
  ready: boolean
  bcReceipts: number
  bcTotes: number
  lastComplete: { startedAt: Date; completedAt: Date | null; totes: number } | null
  lastRun: { startedAt: Date; status: string; error: string | null; totes: number } | null
}

/** What the Settings panel and the dashboard say about the copy. Never throws. */
export async function mirrorStatus(): Promise<MirrorStatus> {
  try {
    const [bcReceipts, bcTotes, lastComplete, lastRun] = await Promise.all([
      prisma.goodsInReceipt.count({ where: { source: FROM_BC } }),
      prisma.goodsInContainer.count({ where: { source: FROM_BC } }),
      prisma.warehouseSyncLog.findFirst({ where: { source: BC_MIRROR_SOURCE, status: "complete" }, orderBy: { startedAt: "desc" }, select: { startedAt: true, completedAt: true, itemsProcessed: true } }),
      prisma.warehouseSyncLog.findFirst({ where: { source: BC_MIRROR_SOURCE }, orderBy: { startedAt: "desc" }, select: { startedAt: true, status: true, error: true, itemsProcessed: true } }),
    ])
    return {
      ready: true, bcReceipts, bcTotes,
      lastComplete: lastComplete ? { startedAt: lastComplete.startedAt, completedAt: lastComplete.completedAt, totes: lastComplete.itemsProcessed } : null,
      lastRun: lastRun ? { startedAt: lastRun.startedAt, status: lastRun.status, error: lastRun.error, totes: lastRun.itemsProcessed } : null,
    }
  } catch {
    return { ready: false, bcReceipts: 0, bcTotes: 0, lastComplete: null, lastRun: null }
  }
}
