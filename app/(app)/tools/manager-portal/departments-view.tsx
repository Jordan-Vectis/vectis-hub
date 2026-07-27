import { prisma } from "@/lib/prisma"
import DepartmentsTable, { type DeptGroup } from "./departments-table"

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

  // Resolve each tote to a date. A tote reference can be either an internal
  // warehouse container (its created date = when it was booked in) or a BC tote
  // number (its items' goods-received date). Try the container first, fall back
  // to BC, so it works whichever the cataloguers entered.
  const toteDate = new Map<string, number>()
  const toteIds = [...new Set(toteRows.map(r => r.tote))]
  if (toteIds.length > 0) {
    try {
      const containers = await prisma.warehouseContainer.findMany({
        where:  { id: { in: toteIds } },
        select: { id: true, createdAt: true },
      })
      for (const c of containers) toteDate.set(c.id, c.createdAt.getTime())
    } catch { /* leave unresolved */ }

    const stillMissing = toteIds.filter(t => !toteDate.has(t))
    if (stillMissing.length > 0) {
      try {
        const bc = await prisma.$queryRaw<{ toteNo: string; d: Date }[]>`
          SELECT "toteNo", MIN("goodsReceivedDate") AS d
          FROM "WarehouseItem"
          WHERE "toteNo" = ANY(${stillMissing}) AND "goodsReceivedDate" IS NOT NULL
          GROUP BY "toteNo"`
        for (const r of bc) if (r.d) toteDate.set(r.toteNo, new Date(r.d).getTime())
      } catch { /* leave unresolved */ }
    }
  }

  // One entry per DISTINCT tote, most recently worked first.
  const totesBySale = new Map<string, { tote: string; lotCount: number }[]>()
  for (const r of toteRows) {
    totesBySale.set(r.auctionId, [...(totesBySale.get(r.auctionId) ?? []), { tote: r.tote, lotCount: r.lotCount }])
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
  function stockFor(auctionId: string) {
    const totes = totesBySale.get(auctionId) ?? []
    if (totes.length === 0) return null

    // One date per tote — each tote is a single data point in the median,
    // regardless of how many lots came out of it.
    const dated = totes.map(t => toteDate.get(t.tote)).filter((d): d is number => d != null)

    return {
      medianMs:     dated.length > 0 ? median(dated) : null,
      oldestMs:     dated.length > 0 ? Math.min(...dated) : null,
      newestMs:     dated.length > 0 ? Math.max(...dated) : null,
      totesSampled: totes.length,
      dated:        dated.length,
      totes: totes.map(t => ({ tote: t.tote, dateMs: toteDate.get(t.tote) ?? null, lots: t.lotCount })),
    }
  }

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
    stock:       a.complete ? null : stockFor(a.id),
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
    const active = sales.filter(s => !s.complete).map(toRow)
    const done   = sales.filter(s => s.complete).map(toRow)
    return {
      id, name, types, members, real,
      active,
      completed: done,
      people: peopleFor(new Set(sales.map(s => s.id))),
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
      migrated={migrated}
      anyDepartments={departments.length > 0}
      nowMs={Date.now()}
    />
  )
}
