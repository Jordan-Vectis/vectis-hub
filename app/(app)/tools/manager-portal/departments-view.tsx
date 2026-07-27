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
  // The tote off each of the LAST 10 LOTS catalogued on an active sale, resolved
  // to the date that tote came in, then taken as a MEDIAN — a median because one
  // stray old tote in the batch would drag an average back and misreport how far
  // behind the sale really is. Comparing that date against today is the lag.
  const activeIds = auctions.filter(a => !a.complete).map(a => a.id)

  let toteRows: { auctionId: string; tote: string; rn: number }[] = []
  if (activeIds.length > 0) {
    try {
      toteRows = await prisma.$queryRaw<{ auctionId: string; tote: string; rn: number }[]>`
        SELECT "auctionId", "tote", rn FROM (
          SELECT l."auctionId", l."tote",
                 ROW_NUMBER() OVER (PARTITION BY l."auctionId" ORDER BY l."createdAt" DESC)::int AS rn
          FROM "CatalogueLot" l
          WHERE l."auctionId" = ANY(${activeIds})
            AND l."tote" IS NOT NULL AND btrim(l."tote") <> ''
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

  // One entry per lot, newest first — the same tote appears as many times as it
  // was used, which is right: the median should reflect the actual work done.
  const totesBySale = new Map<string, string[]>()
  for (const r of toteRows) totesBySale.set(r.auctionId, [...(totesBySale.get(r.auctionId) ?? []), r.tote])

  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b)
    const mid = Math.floor(s.length / 2)
    return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
  }

  function stockFor(auctionId: string) {
    const totes = totesBySale.get(auctionId) ?? []
    if (totes.length === 0) return null
    const dated = totes.map(t => toteDate.get(t)).filter((d): d is number => d != null)
    if (dated.length === 0) return null

    // Listed out for the manager: each distinct tote from those lots, with its
    // date and how many of the sampled lots came out of it.
    const seen = new Map<string, { tote: string; dateMs: number | null; lots: number }>()
    for (const t of totes) {
      const cur = seen.get(t) ?? { tote: t, dateMs: toteDate.get(t) ?? null, lots: 0 }
      cur.lots++
      seen.set(t, cur)
    }

    return {
      medianMs: median(dated),
      oldestMs: Math.min(...dated),
      newestMs: Math.max(...dated),
      lots:     totes.length,
      dated:    dated.length,
      totes:    [...seen.values()],
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
