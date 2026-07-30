import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export const maxDuration = 60

// GET /api/manager-portal/bc-tote-dates
//
// Powers the Manager Portal → Departments "Using totes from — Business Central
// categories" table. It answers "how far behind is cataloguing, per BC
// category?" by looking at the stock currently being worked and when that stock
// came in.
//
// ⚠ WHY THIS IS DB-ONLY, NOT LIVE BC (settled 2026-07-29).
// The obvious source — the live Receipt_Totes_Excel feed filtered to benched
// (PTE_Benched) totes — CANNOT work: that feed is BC's ACTIVE-totes feed, so a
// tote drops out of it once it's finished/shelved. GAMING showed 1,729
// catalogued items but only 5 benched totes in the feed; there is genuinely
// nothing more to fetch. (The fuller benched view Jordan sees in the BC client
// isn't exposed on this OData endpoint.)
//
// So we use our COMPLETE item-level data instead. WarehouseItem holds every
// catalogued item with `cataloguedAt` (when it was worked) and — since the
// 2026-07-29 sync change — `toteNo`, the item's SOURCE TOTE from
// `EVA_CFA_TOT_CreatedFromToteNo` (verified populated in BC incl. old receipts;
// `EVA_ArticleToteNo` is the empty one). So we group by ACTUAL TOTE: the
// newest-10 totes catalogued per category, each dated by its own check-in
// (WarehouseTote.bcCreatedAt, joined directly on toteNo).
//
// Items synced before that change have no toteNo until a full Receipt Lines
// re-sync backfills it — those fall back to grouping by RECEIPT (keyed
// "R:<receiptNo>", dated via the receipt's totes). So the table degrades to the
// receipt view where tote data is missing, never breaks.
//
// ⚠ NOT goodsReceivedDate — verified 2026-07-29 against production: populated on
// 0 of ~208k WarehouseItem rows. A dead field.
//
// "Using totes from" = median check-in month of the newest 10 totes catalogued
// in each category.

const SAMPLE = 10   // newest N catalogued totes per category

// Median — robust to a stray old/new consignment even on a small sample. A
// trimmed mean needs enough points to trim; the median doesn't.
function median(msSorted: number[]): number | null {
  if (msSorted.length === 0) return null
  const mid = Math.floor(msSorted.length / 2)
  return msSorted.length % 2 === 0
    ? Math.round((msSorted[mid - 1] + msSorted[mid]) / 2)
    : msSorted[mid]
}

const toMs = (d: Date | null) => (d ? new Date(d).getTime() : null)

type CategoryOut = {
  category: string
  monthMs: number | null
  oldestMs: number | null
  newestMs: number | null
  sampled: number
  dated: number
  totes: { tote: string; dateMs: number | null }[]
  catalogued: number
  outstanding: number
  lastCataloguedMs: number | null
}

export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    // ── Counts + last-worked per category (all from our synced WarehouseItem) ──
    const totals = await prisma.$queryRaw<{ category: string; catalogued: number; outstanding: number; lastAt: Date | null }[]>`
      SELECT btrim(w."category")                                               AS "category",
             COUNT(*) FILTER (WHERE w."catalogued" = true)::int                AS "catalogued",
             COUNT(*) FILTER (WHERE w."catalogued" IS DISTINCT FROM true)::int AS "outstanding",
             MAX(w."cataloguedAt") FILTER (WHERE w."cataloguedAt" >= DATE '1990-01-01') AS "lastAt"
      FROM "WarehouseItem" w
      WHERE w."category" IS NOT NULL AND btrim(w."category") <> ''
      GROUP BY 1`

    // ── The newest SAMPLE catalogued TOTES per category, each dated by its own
    // check-in (WarehouseTote.bcCreatedAt joined on toteNo). Items without a
    // source tote (not yet re-synced) group by receipt instead, keyed
    // "R:<receiptNo>" and dated via the receipt's totes. Ranked by how recently
    // each group was worked. bcCreatedAt is guarded against BC's empty-date
    // sentinel (0001-01-01 → treated as no date). ──
    const rows = await prisma.$queryRaw<{ category: string; grp: string; received: Date | null; rn: number }[]>`
      WITH groups AS (
        SELECT btrim(w."category")                                       AS category,
               COALESCE(NULLIF(upper(btrim(w."toteNo")), ''),
                        'R:' || upper(btrim(w."receiptNo")))             AS grp,
               MAX(w."cataloguedAt")                                     AS last_cat
        FROM "WarehouseItem" w
        WHERE w."catalogued" = true
          AND w."cataloguedAt" >= DATE '1990-01-01'
          AND w."category" IS NOT NULL AND btrim(w."category") <> ''
          AND (NULLIF(btrim(w."toteNo"), '') IS NOT NULL OR NULLIF(btrim(w."receiptNo"), '') IS NOT NULL)
        GROUP BY 1, 2
      ),
      ranked AS (
        SELECT category, grp,
               ROW_NUMBER() OVER (PARTITION BY category ORDER BY last_cat DESC) AS rn
        FROM groups
      ),
      tote_dates AS (
        SELECT upper(btrim(t."toteNo")) AS tote, MIN(t."bcCreatedAt") AS received
        FROM "WarehouseTote" t
        WHERE t."bcCreatedAt" >= DATE '1990-01-01'
        GROUP BY 1
      ),
      receipt_dates AS (
        SELECT upper(btrim(t."receiptNo")) AS receipt, MIN(t."bcCreatedAt") AS received
        FROM "WarehouseTote" t
        WHERE t."bcCreatedAt" >= DATE '1990-01-01'
          AND t."receiptNo" IS NOT NULL AND btrim(t."receiptNo") <> ''
        GROUP BY 1
      )
      SELECT r.category, r.grp,
             CASE WHEN r.grp LIKE 'R:%' THEN rd.received ELSE td.received END AS received,
             r.rn::int AS rn
      FROM ranked r
      LEFT JOIN tote_dates    td ON td.tote    = r.grp
      LEFT JOIN receipt_dates rd ON rd.receipt = substring(r.grp FROM 3)
      WHERE r.rn <= ${SAMPLE}
      ORDER BY r.category, r.rn`

    // Bucket the sampled totes by category, in rank order (newest first).
    // "R:" receipt-fallback keys lose the prefix for display.
    const sampleByCat = new Map<string, { tote: string; dateMs: number | null }[]>()
    for (const r of rows) {
      const arr = sampleByCat.get(r.category) ?? []
      arr.push({ tote: r.grp.startsWith("R:") ? r.grp.slice(2) : r.grp, dateMs: toMs(r.received) })
      sampleByCat.set(r.category, arr)
    }

    const categories: CategoryOut[] = totals.map(t => {
      const sample = sampleByCat.get(t.category) ?? []
      const dated  = sample.map(s => s.dateMs).filter((d): d is number => d != null).sort((a, b) => a - b)
      return {
        category:  t.category,
        monthMs:   median(dated),
        oldestMs:  dated.length > 0 ? dated[0] : null,
        newestMs:  dated.length > 0 ? dated[dated.length - 1] : null,
        sampled:   sample.length,
        dated:     dated.length,
        totes:     sample,
        catalogued:  Number(t.catalogued ?? 0),
        outstanding: Number(t.outstanding ?? 0),
        lastCataloguedMs: toMs(t.lastAt),
      }
    })

    // Furthest behind first; categories with no dated sample sink to the bottom.
    categories.sort((a, b) => {
      if (a.monthMs == null && b.monthMs == null) return a.category.localeCompare(b.category)
      if (a.monthMs == null) return 1
      if (b.monthMs == null) return -1
      return a.monthMs - b.monthMs
    })

    return NextResponse.json({ connected: true, categories })
  } catch (e: any) {
    console.error("manager-portal/bc-tote-dates error:", e)
    return NextResponse.json({ error: e?.message ?? "Query failed" }, { status: 500 })
  }
}
