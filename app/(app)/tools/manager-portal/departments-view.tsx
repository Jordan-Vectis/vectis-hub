import { prisma } from "@/lib/prisma"
import DepartmentsTable, { type DeptGroup, type BcCategoryRow } from "./departments-table"

// Manager Portal → Departments.
// Rolls cataloguing up per department. A department owns a set of auction types,
// so a sale belongs to the department covering its type — that is how sales and
// people are attributed here.
//
// Counts exclude orphaned timing logs (a lotId matching no lot) exactly as the
// Sales tab and the Reports pages do, so the same sale reads the same
// everywhere. Do not "simplify" that EXISTS clause away.

const THREE_MONTHS_MS = 92 * 86_400_000

export default async function DepartmentsView() {
  const cutoff = new Date(Date.now() - THREE_MONTHS_MS)

  // Departments and their members. Own table + column, so guard until Run
  // Migrations has been clicked rather than showing an error page.
  let departments: { id: string; name: string; auctionTypes: string[]; members: string[] }[] = []
  let migrated = true
  try {
    const rows = await prisma.department.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, auctionTypes: true,
        userLinks: { select: { user: { select: { name: true } } } },
      },
    })
    departments = rows.map(d => ({
      id: d.id, name: d.name,
      auctionTypes: d.auctionTypes ?? [],
      members: d.userLinks.map(l => l.user.name).sort(),
    }))
  } catch {
    migrated = false
  }

  const [auctions, dailyRows, work] = await Promise.all([
    prisma.catalogueAuction.findMany({
      orderBy: { auctionDate: "desc" },
      select: {
        id: true, code: true, name: true, auctionType: true, auctionDate: true, updatedAt: true,
        complete: true, catalogued: true, addedToBC: true,
        _count: { select: { lots: true } },
      },
    }),
    // Distinct days that actually had lots saved, per ACTIVE sale — the pace
    // denominator. Same query the Sales tab uses. Defensive: a failure just
    // means no projections rather than a broken page.
    (async () => {
      try {
        return await prisma.$queryRaw<{ auctionId: string; days: number }[]>`
          SELECT l."auctionId" AS "auctionId",
                 COUNT(DISTINCT date_trunc('day', l."createdAt"))::int AS days
          FROM "CatalogueLot" l
          JOIN "CatalogueAuction" a ON a.id = l."auctionId"
          WHERE a.complete = false
          GROUP BY l."auctionId"`
      } catch {
        return [] as { auctionId: string; days: number }[]
      }
    })(),
    prisma.$queryRaw<{ auctionId: string; userName: string; n: number; avgMs: number | null; days: number }[]>`
      SELECT t."auctionId" AS "auctionId", t."userName" AS "userName",
             COUNT(*)::int AS n,
             AVG(t."durationMs")::float8 AS "avgMs",
             COUNT(DISTINCT date_trunc('day', t."savedAt"))::int AS days
      FROM "CatalogueTimingLog" t
      WHERE (t."lotId" IS NULL OR EXISTS (SELECT 1 FROM "CatalogueLot" l WHERE l."id" = t."lotId"))
      GROUP BY t."auctionId", t."userName"`,
  ])

  const activeDaysById = new Map(dailyRows.map(r => [r.auctionId, r.days]))

  // ── How far behind: what dates are the totes being catalogued from? ────────
  // The last 10 DISTINCT totes worked on each active sale (most recently
  // catalogued first), resolved to the date that tote came in, then taken as a
  // MEDIAN. ⚠ Distinct totes, not the last 10 lots — a run of 10 lots can easily
  // all come out of one tote, which would tell you nothing. Each tote counts
  // once however many lots came from it. Median rather than average so one stray
  // old tote can't drag the figure back and misreport the lag.
  const activeIds = auctions.filter(a => !a.complete).map(a => a.id)

  let toteRows: { auctionId: string; tote: string; lotCount: number }[] = []
  if (activeIds.length > 0) {
    try {
      toteRows = await prisma.$queryRaw<{ auctionId: string; tote: string; lotCount: number }[]>`
        SELECT "auctionId", "tote", "lotCount" FROM (
          SELECT l."auctionId", l."tote",
                 COUNT(*)::int AS "lotCount",
                 ROW_NUMBER() OVER (PARTITION BY l."auctionId" ORDER BY MAX(l."createdAt") DESC)::int AS rn
          FROM "CatalogueLot" l
          WHERE l."auctionId" = ANY(${activeIds})
            AND l."tote" IS NOT NULL AND btrim(l."tote") <> ''
          GROUP BY l."auctionId", l."tote"
        ) t WHERE rn <= 10
        ORDER BY "auctionId", rn`
    } catch {
      toteRows = []
    }
  }

  // ── Business Central on its own terms ──────────────────────────────────────
  // Nothing to do with our departments, our sales or our lots. Grouped by BC's
  // OWN main category (EVA_ArticleCategoryCode), covering every category BC
  // holds — including ones we have no sale or department for.
  //
  // ⚠ Keyed by RECEIPT, not tote. When BC catalogues an item it CLEARS the
  // item's toteNo (the item has left the tote), so a catalogued item can't be
  // linked back to its tote directly — that's why an earlier tote-keyed version
  // showed "nothing catalogued" for categories with thousands done. The receipt
  // number survives cataloguing, and the tote record itself persists in
  // WarehouseTote with its receipt + BC created date, so receipt is the bridge.
  // The last 10 distinct receipts catalogued in each category, by cataloguedAt.
  let bcReceiptRows: { category: string; receipt: string; itemCount: number }[] = []
  let bcCatTotals: { category: string; catalogued: number; outstanding: number; lastAt: Date | null }[] = []
  try {
    [bcReceiptRows, bcCatTotals] = await Promise.all([
      prisma.$queryRaw<{ category: string; receipt: string; itemCount: number }[]>`
        SELECT "category", "receipt", "itemCount" FROM (
          SELECT btrim(w."category")         AS "category",
                 upper(btrim(w."receiptNo")) AS "receipt",
                 COUNT(*)::int               AS "itemCount",
                 ROW_NUMBER() OVER (
                   PARTITION BY btrim(w."category")
                   ORDER BY MAX(w."cataloguedAt") DESC
                 )::int AS rn
          FROM "WarehouseItem" w
          WHERE w."category" IS NOT NULL AND btrim(w."category") <> ''
            AND w."catalogued" = true
            -- ⚠ BC sends an empty date as 0001-01-01, which is a VALID date
            AND w."cataloguedAt" IS NOT NULL AND w."cataloguedAt" >= DATE '1990-01-01'
            AND w."receiptNo" IS NOT NULL AND btrim(w."receiptNo") <> ''
          GROUP BY 1, 2
        ) t WHERE rn <= 10
        ORDER BY "category", rn`,
      prisma.$queryRaw<{ category: string; catalogued: number; outstanding: number; lastAt: Date | null }[]>`
        SELECT btrim(w."category")                                          AS "category",
               COUNT(*) FILTER (WHERE w."catalogued" = true)::int            AS "catalogued",
               COUNT(*) FILTER (WHERE w."catalogued" IS DISTINCT FROM true)::int AS "outstanding",
               MAX(w."cataloguedAt") FILTER (WHERE w."cataloguedAt" >= DATE '1990-01-01') AS "lastAt"
        FROM "WarehouseItem" w
        WHERE w."category" IS NOT NULL AND btrim(w."category") <> ''
        GROUP BY 1`,
    ])
  } catch {
    bcReceiptRows = []
    bcCatTotals   = []
  }

  // Date each BC receipt = when that receipt's stock came into BC. The tote it
  // belongs to carries the real created date (bcCreatedAt = SystemCreatedAt);
  // fall back to the receipt's goods-received date where a tote date is missing.
  const bcReceiptDate = new Map<string, number>()
  const bcReceiptKeys = [...new Set(bcReceiptRows.map(r => r.receipt))]
  if (bcReceiptKeys.length > 0) {
    try {
      const fromTotes = await prisma.$queryRaw<{ r: string; d: Date | null }[]>`
        SELECT upper(btrim("receiptNo")) AS r, MAX("bcCreatedAt") AS d
        FROM "WarehouseTote"
        WHERE upper(btrim("receiptNo")) = ANY(${bcReceiptKeys})
          AND "bcCreatedAt" IS NOT NULL AND "bcCreatedAt" >= DATE '1990-01-01'
        GROUP BY 1`
      for (const x of fromTotes) if (x.d) bcReceiptDate.set(x.r, new Date(x.d).getTime())
    } catch { /* bcCreatedAt column arrives with Run Migrations */ }

    const missing = bcReceiptKeys.filter(k => !bcReceiptDate.has(k))
    if (missing.length > 0) {
      try {
        const fromItems = await prisma.$queryRaw<{ r: string; d: Date | null }[]>`
          SELECT upper(btrim("receiptNo")) AS r, MIN("goodsReceivedDate") AS d
          FROM "WarehouseItem"
          WHERE upper(btrim("receiptNo")) = ANY(${missing})
            AND "goodsReceivedDate" IS NOT NULL AND "goodsReceivedDate" >= DATE '1990-01-01'
          GROUP BY 1`
        for (const x of fromItems) if (x.d) bcReceiptDate.set(x.r, new Date(x.d).getTime())
      } catch { /* leave unresolved */ }
    }
  }

  // Resolve each tote to a date. A tote reference can be either an internal
  // warehouse container (its id IS the tote number, and createdAt = when it was
  // booked in) or a BC tote number (its items' goods-received date). Try the
  // container first, fall back to BC, so it works whichever was entered.
  //
  // ⚠ Matched on upper(btrim(...)) both sides: tote values are upper-cased on
  // some write paths (importLots) and stored raw on others, so exact matching
  // silently found nothing.
  const norm = (s: string) => s.trim().toUpperCase()

  type ToteLookup = {
    dateMs: number | null
    source: "tote" | "item" | "receipt" | "container" | null
    receiptNo: string | null
    found: boolean            // the tote exists somewhere in the warehouse data
  }
  const toteInfo = new Map<string, ToteLookup>()
  // Only the Hub table resolves tote → date here; the BC table works by receipt
  // (see bcReceiptDate above), because catalogued items have no tote number.
  const toteKeys = [...new Set(toteRows.map(r => norm(r.tote)))]

  if (toteKeys.length > 0) {
    const put = (k: string, patch: Partial<ToteLookup>) => {
      const prev = toteInfo.get(k) ?? { dateMs: null, source: null, receiptNo: null, found: false }
      toteInfo.set(k, { ...prev, ...patch })
    }

    // 1 ─ WarehouseTote is where the cataloguers' tote numbers actually live
    //     (T025326, P000865…). bcCreatedAt is BC's SystemCreatedAt for the tote
    //     — when it was created — which is exactly the date wanted here. Its
    //     receiptNo is kept as the fallback route to a goods-received date.
    try {
      const totes = await prisma.$queryRaw<{ k: string; receiptNo: string | null; d: Date | null }[]>`
        SELECT upper(btrim("toteNo")) AS k, MAX("receiptNo") AS "receiptNo", MAX("bcCreatedAt") AS d
        FROM "WarehouseTote"
        WHERE upper(btrim("toteNo")) = ANY(${toteKeys})
        GROUP BY 1`
      for (const t of totes) {
        put(t.k, {
          found: true,
          receiptNo: t.receiptNo,
          ...(t.d && new Date(t.d).getUTCFullYear() >= 1990
            ? { dateMs: new Date(t.d).getTime(), source: "tote" as const }
            : {}),
        })
      }
    } catch {
      // bcCreatedAt arrives with Run Migrations. Until then still read the
      // receipt, or the fallback chain below would have nothing to work with.
      try {
        const totes = await prisma.$queryRaw<{ k: string; receiptNo: string | null }[]>`
          SELECT upper(btrim("toteNo")) AS k, MAX("receiptNo") AS "receiptNo"
          FROM "WarehouseTote"
          WHERE upper(btrim("toteNo")) = ANY(${toteKeys})
          GROUP BY 1`
        for (const t of totes) put(t.k, { found: true, receiptNo: t.receiptNo })
      } catch { /* leave unresolved */ }
    }

    // 2 ─ Items tagged with the tote directly, if BC has them that way.
    //     ⚠ The year floor matters: BC sends an empty date as "0001-01-01",
    //     which is a valid date, so MIN() would happily return year 1 and the
    //     report would read "2,025 years behind". The sync now nulls these on
    //     write, but rows synced before that fix still hold them.
    try {
      const byTote = await prisma.$queryRaw<{ k: string; d: Date | null }[]>`
        SELECT upper(btrim("toteNo")) AS k, MIN("goodsReceivedDate") AS d
        FROM "WarehouseItem"
        WHERE upper(btrim("toteNo")) = ANY(${toteKeys})
          AND "goodsReceivedDate" >= DATE '1990-01-01'
        GROUP BY 1`
      for (const r of byTote) {
        put(r.k, { found: true, ...(r.d ? { dateMs: new Date(r.d).getTime(), source: "item" as const } : {}) })
      }
    } catch { /* leave unresolved */ }

    // 3 ─ Otherwise date the tote by its RECEIPT — when that receipt's goods
    //     were booked in. This is the path that works for the real data.
    const receipts = [...new Set(
      [...toteInfo.values()].filter(v => v.dateMs == null && v.receiptNo).map(v => norm(v.receiptNo!)),
    )]
    if (receipts.length > 0) {
      try {
        const byReceipt = await prisma.$queryRaw<{ r: string; d: Date | null }[]>`
          SELECT upper(btrim("receiptNo")) AS r, MIN("goodsReceivedDate") AS d
          FROM "WarehouseItem"
          WHERE upper(btrim("receiptNo")) = ANY(${receipts})
            AND "goodsReceivedDate" >= DATE '1990-01-01'
          GROUP BY 1`
        const dateByReceipt = new Map(byReceipt.filter(x => x.d).map(x => [x.r, new Date(x.d!).getTime()]))
        for (const [k, v] of toteInfo) {
          if (v.dateMs != null || !v.receiptNo) continue
          const d = dateByReceipt.get(norm(v.receiptNo))
          if (d != null) put(k, { dateMs: d, source: "receipt" })
        }
      } catch { /* leave unresolved */ }
    }

    // 4 ─ Last resort: an internal warehouse container whose id IS the tote
    //     number — its created date is when it was booked in.
    const stillMissing = toteKeys.filter(k => toteInfo.get(k)?.dateMs == null)
    if (stillMissing.length > 0) {
      try {
        const containers = await prisma.$queryRaw<{ k: string; d: Date | null }[]>`
          SELECT upper(btrim("id")) AS k, MIN("createdAt") AS d
          FROM "WarehouseContainer"
          WHERE upper(btrim("id")) = ANY(${stillMissing})
          GROUP BY 1`
        for (const c of containers) {
          put(c.k, { found: true, ...(c.d ? { dateMs: new Date(c.d).getTime(), source: "container" as const } : {}) })
        }
      } catch { /* leave unresolved */ }
    }
  }

  // One entry per DISTINCT tote, most recently worked first.
  const totesBySale = new Map<string, { tote: string; lotCount: number }[]>()
  for (const r of toteRows) {
    totesBySale.set(r.auctionId, [...(totesBySale.get(r.auctionId) ?? []), { tote: r.tote, lotCount: r.lotCount }])
  }

  // BC receipts, keyed by BC's own main category.
  const bcReceiptsByCategory = new Map<string, { receipt: string; itemCount: number }[]>()
  for (const r of bcReceiptRows) {
    bcReceiptsByCategory.set(r.category, [...(bcReceiptsByCategory.get(r.category) ?? []), { receipt: r.receipt, itemCount: r.itemCount }])
  }

  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b)
    const mid = Math.floor(s.length / 2)
    return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
  }

  // Returns null ONLY when the last lots carry no tote at all. When there are
  // totes but none resolve to a date, it still returns them with a null median —
  // so the column can say which of the two happened and the expanded panel can
  // show the actual tote values rather than a bare dash that explains nothing.
  // Takes lists of totes so the same maths serves one sale, a whole department,
  // and either source (our Hub lots or BC's catalogued record).
  function stockFrom(lists: { tote: string; lotCount: number }[][]) {
    const merged = new Map<string, number>()   // tote → lots, deduped across sales
    for (const list of lists) {
      for (const t of list) merged.set(t.tote, (merged.get(t.tote) ?? 0) + t.lotCount)
    }
    const totes = [...merged.entries()].map(([tote, lotCount]) => ({ tote, lotCount }))
    if (totes.length === 0) return null

    // One date per tote — each tote is a single data point in the median,
    // regardless of how many lots came out of it.
    const dated = totes
      .map(t => toteInfo.get(norm(t.tote))?.dateMs)
      .filter((d): d is number => d != null)

    return {
      medianMs:     dated.length > 0 ? median(dated) : null,
      oldestMs:     dated.length > 0 ? Math.min(...dated) : null,
      newestMs:     dated.length > 0 ? Math.max(...dated) : null,
      totesSampled: totes.length,
      dated:        dated.length,
      totes: totes.map(t => {
        const info = toteInfo.get(norm(t.tote))
        return {
          tote:    t.tote,
          dateMs:  info?.dateMs ?? null,
          lots:    t.lotCount,
          // Why it has no date, so the panel says which step failed rather than
          // just showing a blank.
          reason:  info?.dateMs != null
            ? null
            : !info?.found
              ? "not found in the warehouse"
              : info.receiptNo
                ? `no created date yet — receipt ${info.receiptNo} has no goods-received date either`
                : "no created date yet, and no receipt on this tote",
          source:  info?.source ?? null,
        }
      }),
    }
  }

  /** From our Hub lots — what the cataloguers recorded. */
  const stockFor = (auctionIds: string[]) => stockFrom(auctionIds.map(id => totesBySale.get(id) ?? []))

  // ── The BC-only table: one row per BC category, our system not involved ──
  // Median of the last-10-catalogued receipts' created dates. Each receipt is
  // one data point; unresolved receipts stay listed but drop out of the median.
  function bcStockFor(receipts: { receipt: string; itemCount: number }[]): BcCategoryRow["stock"] {
    if (receipts.length === 0) return null
    const dated = receipts.map(r => bcReceiptDate.get(r.receipt)).filter((d): d is number => d != null)
    return {
      medianMs:     dated.length > 0 ? median(dated) : null,
      oldestMs:     dated.length > 0 ? Math.min(...dated) : null,
      newestMs:     dated.length > 0 ? Math.max(...dated) : null,
      totesSampled: receipts.length,
      dated:        dated.length,
      totes: receipts.map(r => ({
        tote:   r.receipt,        // a receipt number here, shown as such in the panel
        dateMs: bcReceiptDate.get(r.receipt) ?? null,
        lots:   r.itemCount,
        reason: bcReceiptDate.get(r.receipt) != null ? null : "no created date yet — run the totes sync",
        source: bcReceiptDate.get(r.receipt) != null ? "receipt" : null,
      })),
    }
  }

  const bcCategories: BcCategoryRow[] = bcCatTotals
    .map(c => ({
      category:    c.category,
      stock:       bcStockFor(bcReceiptsByCategory.get(c.category) ?? []),
      catalogued:  Number(c.catalogued),
      outstanding: Number(c.outstanding),
      lastCataloguedMs: c.lastAt ? new Date(c.lastAt).getTime() : null,
    }))
    // Furthest behind first; categories with no dated receipts sink to the bottom.
    .sort((a, b) => {
      const am = a.stock?.medianMs, bm = b.stock?.medianMs
      if (am == null && bm == null) return a.category.localeCompare(b.category)
      if (am == null) return 1
      if (bm == null) return -1
      return am - bm
    })

  // Active sales, plus sales finished in the last three months. There is no
  // "completed at" timestamp — `complete` is just a flag — so recency uses the
  // sale date, falling back to when the record was last touched.
  const recentlyDone = (a: { complete: boolean; auctionDate: Date | null; updatedAt: Date }) =>
    a.complete && (a.auctionDate ?? a.updatedAt) >= cutoff

  const relevant = auctions.filter(a => !a.complete || recentlyDone(a))

  // auctionType → department. A type belongs to one department; anything left
  // over lands in a "Not in a department" group so the totals still add up.
  const deptByType = new Map<string, string>()
  for (const d of departments) for (const t of d.auctionTypes) deptByType.set(t, d.id)

  const toRow = (a: typeof auctions[number]) => ({
    id:          a.id,
    code:        a.code,
    name:        a.name,
    auctionDate: a.auctionDate ? a.auctionDate.toISOString() : null,
    auctionType: a.auctionType,
    lots:        a._count.lots,
    activeDays:  activeDaysById.get(a.id) ?? 0,
    complete:    !!a.complete,
    catalogued:  !!a.catalogued,
    addedToBC:   !!a.addedToBC,
    stock:       a.complete ? null : stockFor([a.id]),
  })

  const peopleFor = (saleIds: Set<string>) => {
    const byPerson = new Map<string, { n: number; msTotal: number; days: number }>()
    for (const w of work) {
      if (!saleIds.has(w.auctionId)) continue
      const cur = byPerson.get(w.userName) ?? { n: 0, msTotal: 0, days: 0 }
      cur.n       += w.n
      cur.msTotal += (w.avgMs ?? 0) * w.n
      cur.days     = Math.max(cur.days, w.days)   // days overlap across sales
      byPerson.set(w.userName, cur)
    }
    return [...byPerson.entries()]
      .map(([name, v]) => ({ name, lots: v.n, avgMs: v.n > 0 ? v.msTotal / v.n : null, days: v.days }))
      .sort((a, b) => b.lots - a.lots)
  }

  const buildGroup = (
    id: string, name: string, types: string[], members: string[], sales: typeof auctions, real: boolean,
  ): DeptGroup => {
    const activeSales = sales.filter(s => !s.complete)
    const done        = sales.filter(s => s.complete)
    return {
      id, name, types, members, real,
      active:    activeSales.map(toRow),
      completed: done.map(toRow),
      people:    peopleFor(new Set(sales.map(s => s.id))),
      // Pooled across every active sale in the department — the summary strip's
      // "using totes from" is a median over the department's whole tote sample,
      // not a median of per-sale medians.
      stock:     stockFor(activeSales.map(s => s.id)),
    }
  }

  const groups: DeptGroup[] = departments.map(d =>
    buildGroup(d.id, d.name, d.auctionTypes, d.members, relevant.filter(a => deptByType.get(a.auctionType) === d.id), true),
  )

  const orphans = relevant.filter(a => !deptByType.has(a.auctionType))
  if (orphans.length > 0) {
    groups.push(buildGroup(
      "__none__", "Not in a department",
      [...new Set(orphans.map(a => a.auctionType))], [], orphans, false,
    ))
  }

  return (
    <DepartmentsTable
      groups={groups}
      bcCategories={bcCategories}
      migrated={migrated}
      anyDepartments={departments.length > 0}
      nowMs={Date.now()}
    />
  )
}
