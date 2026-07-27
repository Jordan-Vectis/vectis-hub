import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { auctionTypeEmoji, auctionTypeLabel, AUCTION_TYPES } from "@/lib/auction-types"

// Manager Portal → Departments.
// Rolls the cataloguing figures up per department. A department owns a set of
// auction types, so a sale belongs to the department that covers its type —
// that is how lots and people are attributed here.
//
// Counts exclude orphaned timing logs (a lotId matching no lot) exactly as the
// Sales tab and the Reports pages do, so the same sale reads the same
// everywhere. Do not "simplify" that EXISTS clause away.

type Props = { rangeDays: number | null }

const RANGES: { key: string; label: string; days: number | null }[] = [
  { key: "7",   label: "Last 7 days",   days: 7 },
  { key: "30",  label: "Last 30 days",  days: 30 },
  { key: "90",  label: "Last 90 days",  days: 90 },
  { key: "all", label: "All time",      days: null },
]

function fmtAvg(ms: number | null): string {
  if (!ms || ms <= 0) return "—"
  const mins = ms / 60000
  if (mins < 1) return `${Math.round(ms / 1000)}s`
  return `${mins.toFixed(1)} min`
}

export default async function DepartmentsView({ rangeDays }: Props) {
  const since = rangeDays ? new Date(Date.now() - rangeDays * 86_400_000) : null

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

  const [auctions, lotCounts, work] = await Promise.all([
    prisma.catalogueAuction.findMany({
      orderBy: { auctionDate: "desc" },
      select: {
        id: true, code: true, name: true, auctionType: true, auctionDate: true,
        complete: true, catalogued: true, addedToBC: true,
        _count: { select: { lots: true } },
      },
    }),
    // Lots created inside the range, per sale.
    prisma.catalogueLot.groupBy({
      by:     ["auctionId"],
      where:  since ? { createdAt: { gte: since } } : undefined,
      _count: { _all: true },
    }),
    // Cataloguing work in the range, per person per sale.
    since
      ? prisma.$queryRaw<{ auctionId: string; userName: string; n: number; avgMs: number | null; days: number }[]>`
          SELECT t."auctionId" AS "auctionId", t."userName" AS "userName",
                 COUNT(*)::int AS n,
                 AVG(t."durationMs")::float8 AS "avgMs",
                 COUNT(DISTINCT date_trunc('day', t."savedAt"))::int AS days
          FROM "CatalogueTimingLog" t
          WHERE (t."lotId" IS NULL OR EXISTS (SELECT 1 FROM "CatalogueLot" l WHERE l."id" = t."lotId"))
            AND t."savedAt" >= ${since}
          GROUP BY t."auctionId", t."userName"`
      : prisma.$queryRaw<{ auctionId: string; userName: string; n: number; avgMs: number | null; days: number }[]>`
          SELECT t."auctionId" AS "auctionId", t."userName" AS "userName",
                 COUNT(*)::int AS n,
                 AVG(t."durationMs")::float8 AS "avgMs",
                 COUNT(DISTINCT date_trunc('day', t."savedAt"))::int AS days
          FROM "CatalogueTimingLog" t
          WHERE (t."lotId" IS NULL OR EXISTS (SELECT 1 FROM "CatalogueLot" l WHERE l."id" = t."lotId"))
          GROUP BY t."auctionId", t."userName"`,
  ])

  const lotsInRange = new Map(lotCounts.map(c => [c.auctionId, c._count._all]))

  // auctionType → department. A type belongs to one department; anything left
  // over lands in an "Not in a department" group so the totals still add up.
  const deptByType = new Map<string, string>()
  for (const d of departments) for (const t of d.auctionTypes) deptByType.set(t, d.id)

  type Group = {
    id: string
    name: string
    types: string[]
    members: string[]
    sales: typeof auctions
    real: boolean
  }

  const groups: Group[] = departments.map(d => ({
    id: d.id, name: d.name, types: d.auctionTypes, members: d.members,
    sales: auctions.filter(a => deptByType.get(a.auctionType) === d.id),
    real: true,
  }))

  const orphanSales = auctions.filter(a => !deptByType.has(a.auctionType))
  if (orphanSales.length > 0) {
    groups.push({
      id: "__none__",
      name: "Not in a department",
      types: [...new Set(orphanSales.map(a => a.auctionType))],
      members: [],
      sales: orphanSales,
      real: false,
    })
  }

  return (
    <div>
      {/* Range */}
      <div className="flex items-center gap-2 mb-5">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Range</span>
        {RANGES.map(r => {
          const active = (r.days ?? null) === rangeDays
          return (
            <Link
              key={r.key}
              href={`/tools/manager-portal?tab=departments&range=${r.key}`}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                active
                  ? "bg-blue-50 dark:bg-blue-900/30 border-blue-400 dark:border-blue-600 text-blue-700 dark:text-blue-300 font-medium"
                  : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-blue-400"
              }`}
            >
              {r.label}
            </Link>
          )
        })}
      </div>

      {!migrated && (
        <div className="mb-4 rounded-xl border border-amber-400 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          Departments aren&apos;t in the database yet — run the migrations from the banner on Admin,
          then set them up under Admin → Departments.
        </div>
      )}

      {migrated && departments.length === 0 && (
        <div className="mb-4 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
          No departments set up yet. Create them under Admin → Departments and tick the sale types
          each one covers — this page fills in once they&apos;re mapped.
        </div>
      )}

      <div className="flex flex-col gap-5">
        {groups.map(g => {
          const salesIds   = new Set(g.sales.map(s => s.id))
          const rangeLots  = g.sales.reduce((n, s) => n + (lotsInRange.get(s.id) ?? 0), 0)
          const totalLots  = g.sales.reduce((n, s) => n + s._count.lots, 0)
          const activeSales = g.sales.filter(s => !s.complete).length

          // Per-person totals across this department's sales.
          const byPerson = new Map<string, { n: number; msTotal: number; days: number }>()
          for (const w of work) {
            if (!salesIds.has(w.auctionId)) continue
            const cur = byPerson.get(w.userName) ?? { n: 0, msTotal: 0, days: 0 }
            cur.n       += w.n
            cur.msTotal += (w.avgMs ?? 0) * w.n
            cur.days     = Math.max(cur.days, w.days)   // days overlap across sales
            byPerson.set(w.userName, cur)
          }
          const people = [...byPerson.entries()]
            .map(([name, v]) => ({ name, n: v.n, avgMs: v.n > 0 ? v.msTotal / v.n : null, days: v.days }))
            .sort((a, b) => b.n - a.n)

          const deptAvg = people.length > 0
            ? people.reduce((s, p) => s + (p.avgMs ?? 0) * p.n, 0) / Math.max(1, people.reduce((s, p) => s + p.n, 0))
            : null

          const idle = g.members.filter(m => !byPerson.has(m))

          return (
            <section key={g.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
              {/* Header */}
              <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className={`text-lg font-bold ${g.real ? "text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-400"}`}>
                    {g.name}
                  </h2>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {g.types.length === 0
                      ? <span className="text-xs text-amber-600 dark:text-amber-400">No sale types mapped yet</span>
                      : g.types.map(t => (
                          <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                            {auctionTypeEmoji(t)} {auctionTypeLabel(t)}
                          </span>
                        ))}
                  </div>
                </div>
                <div className="flex items-center gap-6 text-right">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Lots in range</p>
                    <p className="text-xl font-bold text-gray-900 dark:text-white">{rangeLots.toLocaleString("en-GB")}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Lots total</p>
                    <p className="text-xl font-bold text-gray-900 dark:text-white">{totalLots.toLocaleString("en-GB")}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Sales</p>
                    <p className="text-xl font-bold text-gray-900 dark:text-white">
                      {g.sales.length}
                      <span className="text-xs font-normal text-gray-500 dark:text-gray-400 ml-1">({activeSales} active)</span>
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Avg / lot</p>
                    <p className="text-xl font-bold text-gray-900 dark:text-white">{fmtAvg(deptAvg)}</p>
                  </div>
                </div>
              </div>

              <div className="grid lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-100 dark:divide-gray-800">
                {/* Sales */}
                <div className="p-5">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Sales</p>
                  {g.sales.length === 0 ? (
                    <p className="text-sm text-gray-400 dark:text-gray-500">No sales of these types.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
                            <th className="text-left font-medium py-1.5 pr-3">Sale</th>
                            <th className="text-right font-medium py-1.5 px-2">In range</th>
                            <th className="text-right font-medium py-1.5 px-2">Lots</th>
                            <th className="text-left font-medium py-1.5 pl-3">Progress</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.sales.map(s => (
                            <tr key={s.id} className="border-b border-gray-50 dark:border-gray-800/50 last:border-0">
                              <td className="py-1.5 pr-3">
                                <Link href={`/tools/cataloguing/auctions/${s.id}`} className="text-blue-600 dark:text-blue-400 hover:underline font-medium">
                                  {s.code}
                                </Link>
                                <span className="text-gray-500 dark:text-gray-400 ml-2">{s.name}</span>
                              </td>
                              <td className="py-1.5 px-2 text-right tabular-nums text-gray-700 dark:text-gray-300">
                                {(lotsInRange.get(s.id) ?? 0).toLocaleString("en-GB")}
                              </td>
                              <td className="py-1.5 px-2 text-right tabular-nums text-gray-500 dark:text-gray-400">
                                {s._count.lots.toLocaleString("en-GB")}
                              </td>
                              <td className="py-1.5 pl-3">
                                <div className="flex flex-wrap gap-1">
                                  {s.complete
                                    ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">Complete</span>
                                    : <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">Active</span>}
                                  {s.catalogued && <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">Catalogued</span>}
                                  {s.addedToBC && <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">In BC</span>}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* People */}
                <div className="p-5">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                    Cataloguers on these sales
                  </p>
                  {people.length === 0 ? (
                    <p className="text-sm text-gray-400 dark:text-gray-500">No cataloguing recorded in this range.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
                            <th className="text-left font-medium py-1.5 pr-3">Cataloguer</th>
                            <th className="text-right font-medium py-1.5 px-2">Lots</th>
                            <th className="text-right font-medium py-1.5 px-2">Avg / lot</th>
                            <th className="text-right font-medium py-1.5 pl-2">Days</th>
                          </tr>
                        </thead>
                        <tbody>
                          {people.map(p => (
                            <tr key={p.name} className="border-b border-gray-50 dark:border-gray-800/50 last:border-0">
                              <td className="py-1.5 pr-3 text-gray-800 dark:text-gray-200">{p.name}</td>
                              <td className="py-1.5 px-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{p.n.toLocaleString("en-GB")}</td>
                              <td className="py-1.5 px-2 text-right tabular-nums text-gray-500 dark:text-gray-400">{fmtAvg(p.avgMs)}</td>
                              <td className="py-1.5 pl-2 text-right tabular-nums text-gray-500 dark:text-gray-400">{p.days}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {g.real && (
                    <div className="mt-4">
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                        Assigned staff
                      </p>
                      {g.members.length === 0 ? (
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                          Nobody assigned — everyone can still see these sales until someone is.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {g.members.map(m => (
                            <span
                              key={m}
                              title={idle.includes(m) ? "No lots catalogued in this range" : undefined}
                              className={`text-xs px-2 py-0.5 rounded-full ${
                                idle.includes(m)
                                  ? "bg-gray-50 dark:bg-gray-800/50 text-gray-400 dark:text-gray-500"
                                  : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                              }`}
                            >
                              {m}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </section>
          )
        })}
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500 mt-4">
        A sale belongs to the department covering its sale type. Someone in two departments appears
        under both. {AUCTION_TYPES.length} sale types exist in total.
      </p>
    </div>
  )
}
