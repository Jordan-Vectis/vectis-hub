"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { auctionTypeEmoji, auctionTypeLabel } from "@/lib/auction-types"
import { fmtPace, daysToSale, paceFor, targetsFor, SALE_TARGETS } from "@/lib/sale-projection"

export type StockAge = {
  medianMs: number | null   // null = totes found, but none resolved to a date
  oldestMs: number | null
  newestMs: number | null
  totesSampled: number      // distinct totes sampled (the last 10 worked)
  dated: number             // how many of those resolved to a date
  totes: { tote: string; dateMs: number | null; lots: number }[]
}

export type SaleRow = {
  id: string
  code: string
  name: string
  auctionDate: string | null
  auctionType: string
  lots: number
  activeDays: number
  complete: boolean
  catalogued: boolean
  addedToBC: boolean
  stock: StockAge | null
}

export type DeptGroup = {
  id: string
  name: string
  types: string[]
  members: string[]
  real: boolean
  active: SaleRow[]
  completed: SaleRow[]
  people: { name: string; lots: number; avgMs: number | null; days: number }[]
}

type SaleBc = { bc: number; overlap: number; combined: number }
type BcState =
  | { status: "loading" }
  | { status: "disconnected" }
  | { status: "error" }
  | { status: "ready"; sales: Record<string, SaleBc | null> }

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
const fmtSaleDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"

function fmtAvg(ms: number | null): string {
  if (!ms || ms <= 0) return "—"
  const mins = ms / 60000
  return mins < 1 ? `${Math.round(ms / 1000)}s` : `${mins.toFixed(1)} min`
}

/** How long ago the stock came in, in the roundest sensible unit. */
function fmtLag(fromMs: number, nowMs: number): string {
  const days = Math.round((nowMs - fromMs) / 86_400_000)
  if (days <= 0) return "today"
  if (days < 14) return `${days}d behind`
  if (days < 70) return `${Math.round(days / 7)}w behind`
  return `${(days / 30.44).toFixed(1)}m behind`
}

function lagColour(fromMs: number, nowMs: number): string {
  const days = (nowMs - fromMs) / 86_400_000
  if (days >= 90) return "text-red-500"
  if (days >= 42) return "text-amber-500"
  return "text-gray-500 dark:text-gray-400"
}

export default function DepartmentsTable({ groups, migrated, anyDepartments, nowMs }: {
  groups: DeptGroup[]
  migrated: boolean
  anyDepartments: boolean
  nowMs: number
}) {
  // Same source as the Sales tab, so a sale's lot total reads identically on
  // both. Without a BC connection we fall back to the Hub count.
  const [bc, setBc] = useState<BcState>({ status: "loading" })
  const [openStock, setOpenStock] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/manager-portal/bc-counts")
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        if (d?.connected === false) { setBc({ status: "disconnected" }); return }
        if (d?.sales) { setBc({ status: "ready", sales: d.sales }); return }
        setBc({ status: "error" })
      })
      .catch(() => { if (!cancelled) setBc({ status: "error" }) })
    return () => { cancelled = true }
  }, [])

  /** The number the manager actually watches: Hub ∪ BC where BC is available. */
  function totalFor(row: SaleRow): { total: number; combined: boolean } {
    if (bc.status !== "ready") return { total: row.lots, combined: false }
    const s = bc.sales[row.code]
    if (!s) return { total: row.lots, combined: false }
    return { total: Math.max(s.combined, row.lots), combined: true }
  }

  return (
    <div>
      {!migrated && (
        <div className="mb-4 rounded-xl border border-amber-400 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          Departments aren&apos;t in the database yet — run the migrations from the banner on Admin,
          then set them up under Admin → Departments.
        </div>
      )}

      {migrated && !anyDepartments && (
        <div className="mb-4 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
          No departments set up yet. Create them under Admin → Departments and tick the sale types
          each one covers — this page fills in once they&apos;re mapped.
        </div>
      )}

      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        Projected dates are when each sale reaches {SALE_TARGETS.join(", ")} lots at its current pace
        (lots ÷ days actually worked). Red means the target lands after the sale date; green means
        it&apos;s already passed. <b className="font-medium">Stock from</b> is the median date the
        stock came in across the last 10 distinct totes worked — click it to list them.
        {bc.status === "loading"     && " Checking Business Central for lots already pushed…"}
        {bc.status === "disconnected" && " Lot totals are Hub-only — connect Business Central to include lots already pushed."}
        {bc.status === "error"        && " Business Central couldn't be reached, so lot totals are Hub-only."}
      </p>

      <div className="flex flex-col gap-5">
        {groups.map(g => {
          const totalLots = [...g.active, ...g.completed].reduce((n, s) => n + totalFor(s).total, 0)
          const paced     = g.active.filter(s => paceFor(s.lots, s.activeDays) > 0)
          const deptPace  = paced.reduce((n, s) => n + paceFor(s.lots, s.activeDays), 0)
          const idle      = g.members.filter(m => !g.people.some(p => p.name === m))

          return (
            <section key={g.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
              {/* Header */}
              <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex flex-wrap items-center justify-between gap-4">
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
                  <Stat label="Active sales" value={g.active.length.toString()} />
                  <Stat label="Lots" value={totalLots.toLocaleString("en-GB")} />
                  <Stat label="Pace" value={deptPace > 0 ? `${fmtPace(deptPace)}/day` : "—"} />
                  <Stat label="Staff" value={g.members.length.toString()} />
                </div>
              </div>

              {/* Active sales + projections */}
              <div className="p-5">
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                  Active sales
                </p>
                {g.active.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500">No active sales.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
                          <th className="text-left  font-medium py-2 pr-3">Sale</th>
                          <th className="text-left  font-medium py-2 px-3">Sale date</th>
                          <th className="text-right font-medium py-2 px-3">Lots</th>
                          <th className="text-right font-medium py-2 px-3">Pace</th>
                          <th className="text-left  font-medium py-2 px-3">Stock from</th>
                          <th className="text-left  font-medium py-2 pl-3">Projected</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.active.map(s => {
                          const { total, combined } = totalFor(s)
                          const pace   = paceFor(s.lots, s.activeDays)
                          const saleTs = s.auctionDate ? Date.parse(s.auctionDate) : Infinity
                          const stones = targetsFor(total, pace, nowMs, saleTs)
                          const left   = daysToSale(s.auctionDate, nowMs)

                          return (
                            <tr key={s.id} className="border-b border-gray-50 dark:border-gray-800/50 last:border-0 align-top">
                              <td className="py-2.5 pr-3">
                                <Link href={`/tools/cataloguing/auctions/${s.id}`} className="font-mono font-semibold text-blue-600 dark:text-blue-400 hover:underline">
                                  {s.code}
                                </Link>
                                <div className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">{s.name}</div>
                              </td>
                              <td className="py-2.5 px-3 whitespace-nowrap text-gray-700 dark:text-gray-300">
                                {fmtSaleDate(s.auctionDate)}
                                {left != null && (
                                  <div className={`text-xs mt-0.5 ${left < 14 ? "text-red-500" : left < 30 ? "text-amber-500" : "text-gray-500 dark:text-gray-400"}`}>
                                    {left < 0 ? `${Math.abs(left)}d ago` : `${left}d to go`}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                                {total.toLocaleString("en-GB")}
                                {combined && total !== s.lots && (
                                  <div className="text-xs font-normal text-gray-500 dark:text-gray-400 mt-0.5">
                                    {s.lots.toLocaleString("en-GB")} in Hub
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-right tabular-nums text-gray-700 dark:text-gray-300 whitespace-nowrap">
                                {pace > 0 ? `${fmtPace(pace)}/day` : "—"}
                              </td>
                              <td className="py-2.5 px-3 whitespace-nowrap">
                                {!s.stock ? (
                                  <span
                                    className="text-xs text-gray-400 dark:text-gray-500"
                                    title="None of the last lots catalogued on this sale have a tote recorded"
                                  >
                                    no totes
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => setOpenStock(openStock === s.id ? null : s.id)}
                                    className="text-left group"
                                    title={
                                      s.stock.medianMs == null
                                        ? "Totes found, but none match a warehouse record — click to see them"
                                        : `Median across the last ${s.stock.totesSampled} totes worked — click to list them`
                                    }
                                  >
                                    <span className={`group-hover:underline ${s.stock.medianMs == null ? "text-amber-500 text-xs" : "text-gray-800 dark:text-gray-200"}`}>
                                      {s.stock.medianMs == null ? "no dates" : fmtDate(s.stock.medianMs)}
                                    </span>
                                    <span className="text-gray-400 dark:text-gray-500 ml-1 text-xs">
                                      {openStock === s.id ? "▾" : "▸"}
                                    </span>
                                    {s.stock.medianMs != null && (
                                      <div className={`text-xs mt-0.5 ${lagColour(s.stock.medianMs, nowMs)}`}>
                                        {fmtLag(s.stock.medianMs, nowMs)}
                                      </div>
                                    )}
                                  </button>
                                )}
                              </td>
                              <td className="py-2.5 pl-3">
                                <div className="flex flex-wrap gap-1.5">
                                  {stones.map(m => {
                                    const cls = m.reached
                                      ? "border-green-300 dark:border-green-800/60 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300"
                                      : m.days == null
                                        ? "border-gray-200 dark:border-gray-700 bg-transparent text-gray-400 dark:text-gray-500"
                                        : m.late
                                          ? "border-red-300 dark:border-red-800/60 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300"
                                          : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-gray-700 dark:text-gray-300"
                                    const title = m.reached
                                      ? `Already past ${m.target} lots`
                                      : m.days == null
                                        ? "Needs two days of cataloguing before a pace can be worked out"
                                        : `${m.target} lots in about ${m.days} day${m.days === 1 ? "" : "s"}${m.late ? " — after the sale date" : ""}`
                                    return (
                                      <span key={m.target} title={title} className={`text-xs px-2 py-1 rounded-lg border whitespace-nowrap ${cls}`}>
                                        <b className="font-semibold">{m.target}</b>
                                        <span className="opacity-60 mx-1">→</span>
                                        {m.reached ? "reached" : m.days == null ? "no pace yet" : fmtDate(m.date!)}
                                      </span>
                                    )
                                  })}
                                </div>
                              </td>
                            </tr>
                          )
                        }).flatMap((row, i) => {
                          const s = g.active[i]
                          if (openStock !== s.id || !s.stock) return [row]
                          return [row, (
                            <tr key={`${s.id}-totes`} className="border-b border-gray-50 dark:border-gray-800/50">
                              <td colSpan={6} className="py-3 px-3 bg-gray-50 dark:bg-gray-800/40">
                                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                                  Last {s.stock.totesSampled} tote{s.stock.totesSampled === 1 ? "" : "s"} worked on {s.code}, most recent first.{" "}
                                  {s.stock.dated === 0 ? (
                                    <span className="text-amber-500">
                                      None of these match a warehouse container id or a Business Central tote
                                      number, so no dates could be worked out.
                                    </span>
                                  ) : (
                                    <>
                                      {s.stock.dated < s.stock.totesSampled &&
                                        `${s.stock.totesSampled - s.stock.dated} had no matching warehouse record and are left out of the median. `}
                                      Oldest {fmtDate(s.stock.oldestMs!)}, newest {fmtDate(s.stock.newestMs!)}.
                                    </>
                                  )}
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  {s.stock.totes.map(t => (
                                    <span
                                      key={t.tote}
                                      title={`${t.lots} lot${t.lots === 1 ? "" : "s"} on this sale came out of this tote`}
                                      className={`text-xs px-2 py-1 rounded-lg border whitespace-nowrap ${
                                        t.dateMs == null
                                          ? "border-dashed border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500"
                                          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
                                      }`}
                                    >
                                      <b className="font-mono font-semibold">{t.tote}</b>
                                      <span className="opacity-60 mx-1">·</span>
                                      {t.dateMs == null ? "no date" : fmtDate(t.dateMs)}
                                      {t.lots > 1 && <span className="opacity-60 ml-1.5">×{t.lots}</span>}
                                    </span>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )]
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Recently completed */}
              {g.completed.length > 0 && (
                <div className="px-5 pb-5">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                    Completed in the last 3 months
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {g.completed.map(s => (
                      <Link
                        key={s.id}
                        href={`/tools/cataloguing/auctions/${s.id}`}
                        className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 hover:border-blue-400 transition-colors"
                      >
                        <span className="font-mono font-semibold text-gray-800 dark:text-gray-200">{s.code}</span>
                        <span className="text-gray-500 dark:text-gray-400 ml-2">{fmtSaleDate(s.auctionDate)}</span>
                        <span className="text-gray-700 dark:text-gray-300 ml-2 tabular-nums">{totalFor(s).total.toLocaleString("en-GB")} lots</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* People */}
              <div className="px-5 pb-5 grid lg:grid-cols-2 gap-6">
                <div>
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                    Cataloguers on these sales
                  </p>
                  {g.people.length === 0 ? (
                    <p className="text-sm text-gray-400 dark:text-gray-500">No cataloguing recorded.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
                          <th className="text-left  font-medium py-1.5 pr-3">Cataloguer</th>
                          <th className="text-right font-medium py-1.5 px-2">Lots</th>
                          <th className="text-right font-medium py-1.5 px-2">Avg / lot</th>
                          <th className="text-right font-medium py-1.5 pl-2">Days</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.people.map(p => (
                          <tr key={p.name} className="border-b border-gray-50 dark:border-gray-800/50 last:border-0">
                            <td className="py-1.5 pr-3 text-gray-800 dark:text-gray-200">{p.name}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{p.lots.toLocaleString("en-GB")}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums text-gray-500 dark:text-gray-400">{fmtAvg(p.avgMs)}</td>
                            <td className="py-1.5 pl-2 text-right tabular-nums text-gray-500 dark:text-gray-400">{p.days}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {g.real && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
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
                            title={idle.includes(m) ? "No lots catalogued on these sales" : undefined}
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
            </section>
          )
        })}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
      <p className="text-xl font-bold text-gray-900 dark:text-white">{value}</p>
    </div>
  )
}
