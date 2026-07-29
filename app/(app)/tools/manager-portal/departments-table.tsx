"use client"

import { Fragment, useEffect, useState } from "react"
import Link from "next/link"
import { auctionTypeEmoji, auctionTypeLabel } from "@/lib/auction-types"
import { fmtPace, daysToSale, paceFor, targetsFor, SALE_TARGETS } from "@/lib/sale-projection"

export type StockAge = {
  medianMs: number | null   // null = totes found, but none resolved to a date
  oldestMs: number | null
  newestMs: number | null
  totesSampled: number      // distinct totes sampled (the last 10 worked)
  dated: number             // how many of those resolved to a date
  totes: { tote: string; dateMs: number | null; lots: number; reason: string | null; source: string | null; ignored?: boolean }[]
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
  stock: StockAge | null    // pooled across the department's active sales (Hub lots)
}

/**
 * A row of the Business Central table. Deliberately has NOTHING to do with our
 * departments, sales or lots — it is grouped by BC's own main category
 * (EVA_ArticleCategoryCode) and covers every category BC holds, including ones
 * we have no sale or department for.
 */
export type BcCategoryRow = {
  category: string
  stock: StockAge | null
  catalogued: number
  outstanding: number
  lastCataloguedMs: number | null
}

type SaleBc = { bc: number; overlap: number; combined: number }
type BcState =
  | { status: "loading" }
  | { status: "disconnected" }
  | { status: "error" }
  | { status: "ready"; sales: Record<string, SaleBc | null> }

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
// Tote dates carry the year — they can be months or years old, and a bare
// "31 Dec" hid a year-1 date from Business Central for a whole round.
const fmtToteDate = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })
const fmtSaleDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }) : "—"

function fmtAvg(ms: number | null): string {
  if (!ms || ms <= 0) return "—"
  const mins = ms / 60000
  return mins < 1 ? `${Math.round(ms / 1000)}s` : `${mins.toFixed(1)} min`
}

/** How far behind the totes being worked are, in the roundest sensible unit. */
function fmtLag(fromMs: number, nowMs: number): string {
  const days = Math.round((nowMs - fromMs) / 86_400_000)
  if (days <= 0) return "today"
  if (days < 14) return `${days}d`
  if (days < 70) return `${Math.round(days / 7)}w`
  return `${(days / 30.44).toFixed(1)}m`
}

const LAG_RED   = 90   // days
const LAG_AMBER = 42

function lagTone(fromMs: number, nowMs: number) {
  const days = (nowMs - fromMs) / 86_400_000
  if (days >= LAG_RED)   return { text: "text-red-500",   bar: "bg-red-500",   pct: 100 }
  if (days >= LAG_AMBER) return { text: "text-amber-500", bar: "bg-amber-500", pct: Math.min(100, (days / LAG_RED) * 100) }
  return { text: "text-gray-500 dark:text-gray-400", bar: "bg-gray-400 dark:bg-gray-500", pct: Math.max(6, (days / LAG_RED) * 100) }
}

export default function DepartmentsTable({ groups, bcCategories, migrated, anyDepartments, nowMs }: {
  groups: DeptGroup[]
  bcCategories: BcCategoryRow[]
  migrated: boolean
  anyDepartments: boolean
  nowMs: number
}) {
  // Same source as the Sales tab, so a sale's lot total reads identically on
  // both. Without a BC connection we fall back to the Hub count.
  const [bc, setBc] = useState<BcState>({ status: "loading" })
  const [openTotes, setOpenTotes] = useState<string | null>(null)   // sale id
  const [openDept, setOpenDept]   = useState<string | null>(null)   // department id

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

  const deptLots = (g: DeptGroup) => [...g.active, ...g.completed].reduce((n, s) => n + totalFor(s).total, 0)
  const deptPace = (g: DeptGroup) => g.active.reduce((n, s) => n + paceFor(s.lots, s.activeDays), 0)

  // Furthest behind first; departments with no tote dates sink to the bottom.
  const byOldest = (pick: (g: DeptGroup) => StockAge | null) => (a: DeptGroup, b: DeptGroup) => {
    const am = pick(a)?.medianMs, bm = pick(b)?.medianMs
    if (am == null && bm == null) return a.name.localeCompare(b.name)
    if (am == null) return 1
    if (bm == null) return -1
    return am - bm
  }
  const summary = [...groups].sort(byOldest(g => g.stock))

  const TH = "text-left font-medium py-2 px-3 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400"

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

      {/* ── Summary: which department is working the oldest stock ── */}
      {groups.length > 0 && (
        <ToteSummary
          title="Using totes from"
          subtitle="Furthest behind first — the median date the totes each department is working came into stock. From the totes our cataloguers recorded against Hub lots."
          rows={summary.map(g => ({
            id: g.id, name: g.name, types: g.types, real: g.real,
            stock: g.stock, active: g.active.length, lots: deptLots(g), pace: deptPace(g),
          }))}
          nowMs={nowMs}
        />
      )}

      {/* ── Business Central on its own terms — nothing from our system ── */}
      {bcCategories.length > 0 && <BcCategoryTable rows={bcCategories} nowMs={nowMs} />}

      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Projected dates are when each sale reaches {SALE_TARGETS.join(", ")} lots at its current pace
        (lots ÷ days actually worked). Red means the target lands after the sale date; green means
        it&apos;s already passed. Click a department for its cataloguers, or a tote date to list the totes.
        {bc.status === "loading"      && " Checking Business Central for lots already pushed…"}
        {bc.status === "disconnected" && " Lot totals are Hub-only — connect Business Central to include lots already pushed."}
        {bc.status === "error"        && " Business Central couldn't be reached, so lot totals are Hub-only."}
      </p>

      {/* ── One table, departments as group rows ── */}
      <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className={TH}>Sale</th>
                <th className={TH}>Sale date</th>
                <th className={`${TH} text-right`}>Lots</th>
                <th className={`${TH} text-right`}>Pace</th>
                <th className={TH}>Using totes from</th>
                <th className={TH}>Projected</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => {
                const median = g.stock?.medianMs ?? null
                const tone   = median != null ? lagTone(median, nowMs) : null
                const pace   = deptPace(g)
                const rows: React.ReactNode[] = []

                // ── Department group row ──
                rows.push(
                  <tr key={`${g.id}-head`} className="bg-gray-50 dark:bg-gray-800/50 border-y border-gray-200 dark:border-gray-700">
                    <td colSpan={6} className="px-3 py-2">
                      <button
                        onClick={() => setOpenDept(openDept === g.id ? null : g.id)}
                        className="flex items-center gap-2 text-left w-full group"
                      >
                        <span className="text-gray-400 dark:text-gray-500 text-xs w-3">{openDept === g.id ? "▾" : "▸"}</span>
                        <span className={`font-bold group-hover:underline ${g.real ? "text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-400"}`}>
                          {g.name}
                        </span>
                        {g.types.map(t => (
                          <span key={t} className="text-[11px] px-1.5 py-0.5 rounded-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                            {auctionTypeEmoji(t)} {auctionTypeLabel(t)}
                          </span>
                        ))}
                        <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">
                          {g.active.length} active · {deptLots(g).toLocaleString("en-GB")} lots
                          {pace > 0 && ` · ${fmtPace(pace)}/day`}
                          {median != null && tone && <> · totes from <span className={tone.text}>{fmtToteDate(median)} ({fmtLag(median, nowMs)} behind)</span></>}
                        </span>
                      </button>
                    </td>
                  </tr>,
                )

                // ── Expanded: cataloguers, staff, recently completed ──
                if (openDept === g.id) {
                  rows.push(
                    <tr key={`${g.id}-detail`} className="border-b border-gray-100 dark:border-gray-800">
                      <td colSpan={6} className="px-3 py-3 bg-gray-50/60 dark:bg-gray-800/25">
                        <div className="grid md:grid-cols-3 gap-5">
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Cataloguers</p>
                            {g.people.length === 0 ? (
                              <p className="text-xs text-gray-400 dark:text-gray-500">No cataloguing recorded.</p>
                            ) : (
                              <table className="w-full text-xs">
                                <tbody>
                                  {g.people.map(p => (
                                    <tr key={p.name}>
                                      <td className="py-0.5 pr-3 text-gray-700 dark:text-gray-300">{p.name}</td>
                                      <td className="py-0.5 px-2 text-right tabular-nums text-gray-600 dark:text-gray-400">{p.lots.toLocaleString("en-GB")} lots</td>
                                      <td className="py-0.5 px-2 text-right tabular-nums text-gray-500 dark:text-gray-500">{fmtAvg(p.avgMs)}</td>
                                      <td className="py-0.5 pl-2 text-right tabular-nums text-gray-500 dark:text-gray-500">{p.days}d</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Assigned staff</p>
                            {g.members.length === 0 ? (
                              <p className="text-xs text-gray-400 dark:text-gray-500">
                                {g.real ? "Nobody assigned — everyone can still see these sales." : "—"}
                              </p>
                            ) : (
                              <div className="flex flex-wrap gap-1.5">
                                {g.members.map(m => (
                                  <span key={m} className="text-xs px-2 py-0.5 rounded-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300">{m}</span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Completed in the last 3 months</p>
                            {g.completed.length === 0 ? (
                              <p className="text-xs text-gray-400 dark:text-gray-500">None.</p>
                            ) : (
                              <div className="flex flex-wrap gap-1.5">
                                {g.completed.map(s => (
                                  <Link
                                    key={s.id}
                                    href={`/tools/cataloguing/auctions/${s.id}`}
                                    className="text-xs px-2 py-0.5 rounded-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 hover:border-blue-400 transition-colors"
                                  >
                                    <span className="font-mono font-semibold text-gray-800 dark:text-gray-200">{s.code}</span>
                                    <span className="text-gray-500 dark:text-gray-400 ml-1.5">{fmtSaleDate(s.auctionDate)}</span>
                                    <span className="text-gray-600 dark:text-gray-400 ml-1.5 tabular-nums">{totalFor(s).total.toLocaleString("en-GB")}</span>
                                  </Link>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>,
                  )
                }

                // ── Sale rows ──
                if (g.active.length === 0) {
                  rows.push(
                    <tr key={`${g.id}-empty`} className="border-b border-gray-50 dark:border-gray-800/50">
                      <td colSpan={6} className="px-3 py-2.5 pl-9 text-xs text-gray-400 dark:text-gray-500">No active sales.</td>
                    </tr>,
                  )
                }

                for (const s of g.active) {
                  const { total, combined } = totalFor(s)
                  const salePace = paceFor(s.lots, s.activeDays)
                  const saleTs   = s.auctionDate ? Date.parse(s.auctionDate) : Infinity
                  const stones   = targetsFor(total, salePace, nowMs, saleTs)
                  const left     = daysToSale(s.auctionDate, nowMs)
                  const sTone    = s.stock?.medianMs != null ? lagTone(s.stock.medianMs, nowMs) : null

                  rows.push(
                    <tr key={s.id} className="border-b border-gray-50 dark:border-gray-800/50 align-middle">
                      <td className="px-3 py-2.5 pl-9">
                        <Link href={`/tools/cataloguing/auctions/${s.id}`} className="font-mono font-semibold text-blue-600 dark:text-blue-400 hover:underline">
                          {s.code}
                        </Link>
                        <span className="text-gray-500 dark:text-gray-400 ml-2 text-xs">{s.name}</span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-gray-700 dark:text-gray-300">
                        {fmtSaleDate(s.auctionDate)}
                        {left != null && (
                          <span className={`ml-1.5 text-xs ${left < 14 ? "text-red-500" : left < 30 ? "text-amber-500" : "text-gray-400 dark:text-gray-500"}`}>
                            {left < 0 ? `${Math.abs(left)}d ago` : `${left}d`}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                        <span className="font-semibold text-gray-900 dark:text-white">{total.toLocaleString("en-GB")}</span>
                        {combined && total !== s.lots && (
                          <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">({s.lots.toLocaleString("en-GB")} Hub)</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300 whitespace-nowrap">
                        {salePace > 0 ? `${fmtPace(salePace)}/day` : "—"}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {!s.stock ? (
                          <span className="text-xs text-gray-400 dark:text-gray-500" title="None of the last lots catalogued on this sale have a tote recorded">
                            no totes
                          </span>
                        ) : (
                          <button
                            onClick={() => setOpenTotes(openTotes === s.id ? null : s.id)}
                            className="text-left group"
                            title={
                              s.stock.medianMs == null
                                ? "Totes found, but none match a warehouse record — click to see them"
                                : `Median across the last ${s.stock.totesSampled} totes worked — click to list them`
                            }
                          >
                            {s.stock.medianMs == null ? (
                              <span className="text-amber-500 text-xs group-hover:underline">no dates</span>
                            ) : (
                              <>
                                <span className="text-gray-800 dark:text-gray-200 group-hover:underline">{fmtToteDate(s.stock.medianMs)}</span>
                                <span className={`ml-1.5 text-xs ${sTone!.text}`}>{fmtLag(s.stock.medianMs, nowMs)}</span>
                              </>
                            )}
                            <span className="text-gray-400 dark:text-gray-500 ml-1 text-xs">{openTotes === s.id ? "▾" : "▸"}</span>
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
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
                              <span key={m.target} title={title} className={`text-[11px] px-1.5 py-0.5 rounded border whitespace-nowrap ${cls}`}>
                                <b className="font-semibold">{m.target}</b>
                                <span className="opacity-60 mx-1">→</span>
                                {m.reached ? "✓" : m.days == null ? "—" : fmtDate(m.date!)}
                              </span>
                            )
                          })}
                        </div>
                      </td>
                    </tr>,
                  )

                  // Tote breakdown — forced open when nothing resolved, since
                  // then the panel's whole job is to say why.
                  const forced = !!s.stock && s.stock.dated === 0
                  if (s.stock && (openTotes === s.id || forced)) {
                    rows.push(
                      <tr key={`${s.id}-totes`} className="border-b border-gray-50 dark:border-gray-800/50">
                        <td colSpan={6} className="px-3 py-3 pl-9 bg-gray-50/60 dark:bg-gray-800/25">
                          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                            Last {s.stock.totesSampled} tote{s.stock.totesSampled === 1 ? "" : "s"} worked on {s.code}, most recent first.{" "}
                            {s.stock.dated === 0 ? (
                              <span className="text-amber-500">No dates could be worked out — each tote below says which step failed.</span>
                            ) : (
                              <>
                                {s.stock.dated < s.stock.totesSampled &&
                                  `${s.stock.totesSampled - s.stock.dated} had no matching warehouse record and are left out of the median. `}
                                Oldest {fmtToteDate(s.stock.oldestMs!)}, newest {fmtToteDate(s.stock.newestMs!)}.
                              </>
                            )}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {s.stock.totes.map(t => (
                              <span
                                key={t.tote}
                                title={
                                  `${t.lots} lot${t.lots === 1 ? "" : "s"} on this sale came out of this tote` +
                                  (t.reason
                                    ? ` — ${t.reason}`
                                    : t.source === "tote"
                                      ? " — when the tote was created in Business Central"
                                      : t.source === "receipt"
                                        ? " — from its receipt's goods-received date"
                                        : t.source === "item"
                                          ? " — from the item's goods-received date"
                                          : " — from the warehouse container")
                                }
                                className={`text-xs px-2 py-1 rounded-lg border whitespace-nowrap ${
                                  t.dateMs == null
                                    ? "border-dashed border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500"
                                    : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
                                }`}
                              >
                                <b className="font-mono font-semibold">{t.tote}</b>
                                <span className="opacity-60 mx-1">·</span>
                                {t.dateMs == null ? (t.reason ?? "no date") : fmtToteDate(t.dateMs)}
                                {t.lots > 1 && <span className="opacity-60 ml-1.5">×{t.lots}</span>}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>,
                    )
                  }
                }

                return rows
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

type SummaryRow = {
  id: string
  name: string
  types: string[]
  real: boolean
  stock: StockAge | null
  active: number
  lots: number
  pace: number
}

// Shared by both summary tables — the Hub one and the BC one. Identical shape on
// purpose: the whole point is that the two are directly comparable.
function ToteSummary({ title, subtitle, rows, nowMs }: {
  title: string
  subtitle: string
  rows: SummaryRow[]
  nowMs: number
}) {
  const TH = "text-left font-medium py-2 px-3 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400"

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden mb-5">
      <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{title}</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800">
              <th className={TH}>Department</th>
              <th className={TH}>Using totes from</th>
              <th className={`${TH} w-48`}>How far behind</th>
              <th className={`${TH} text-right`}>Active</th>
              <th className={`${TH} text-right`}>Lots</th>
              <th className={`${TH} text-right`}>Pace</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const median = r.stock?.medianMs ?? null
              const tone   = median != null ? lagTone(median, nowMs) : null
              return (
                <tr key={r.id} className="border-b border-gray-50 dark:border-gray-800/50 last:border-0">
                  <td className="py-2.5 px-3">
                    <span className={r.real ? "font-semibold text-gray-900 dark:text-white" : "font-semibold text-gray-500 dark:text-gray-400"}>
                      {r.name}
                    </span>
                    <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                      {r.types.map(t => (
                        <span key={t} className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                          {auctionTypeEmoji(t)} {auctionTypeLabel(t)}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {median != null
                      ? <span className="font-semibold text-gray-900 dark:text-white">{fmtToteDate(median)}</span>
                      : <span className="text-xs text-gray-400 dark:text-gray-500">
                          {r.stock ? "no dates on those totes" : "no totes recorded"}
                        </span>}
                  </td>
                  <td className="py-2.5 px-3">
                    {median != null && tone ? (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 min-w-[70px] rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                          <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${tone.pct}%` }} />
                        </div>
                        <span className={`text-xs tabular-nums ${tone.text}`}>{fmtLag(median, nowMs)} behind</span>
                      </div>
                    ) : <span className="text-xs text-gray-400 dark:text-gray-500">—</span>}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-gray-700 dark:text-gray-300">{r.active}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-gray-700 dark:text-gray-300">{r.lots.toLocaleString("en-GB")}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-gray-700 dark:text-gray-300">
                    {r.pace > 0 ? `${fmtPace(r.pace)}/day` : "—"}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * Business Central on its own terms. NOTHING in here comes from our system — no
 * departments, no CatalogueAuction, no CatalogueLot. Rows are BC's own main
 * categories (EVA_ArticleCategoryCode) and every category BC holds appears,
 * whether or not we have a sale or department for it.
 */
function BcCategoryTable({ rows, nowMs }: { rows: BcCategoryRow[]; nowMs: number }) {
  const [open, setOpen] = useState<string | null>(null)
  const TH = "text-left font-medium py-2 px-3 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400"

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden mb-5">
      <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
          Using totes from — Business Central categories
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Straight from Business Central and nothing else — grouped by BC&apos;s own main category,
          showing every category it holds whether or not we have a sale or department for it.
          &ldquo;Using totes from&rdquo; is where cataloguing has reached — the newest tote BC has marked
          catalogued, ignoring the newest couple in case one was ticked off out of order. Furthest behind first.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800">
              <th className={TH}>BC category</th>
              <th className={TH}>Using totes from</th>
              <th className={`${TH} w-48`}>How far behind</th>
              <th className={TH}>Last worked</th>
              <th className={`${TH} text-right`}>Catalogued</th>
              <th className={`${TH} text-right`}>Still to do</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const median = r.stock?.medianMs ?? null
              const tone   = median != null ? lagTone(median, nowMs) : null
              return (
                <Fragment key={r.category}>
                  <tr className="border-b border-gray-50 dark:border-gray-800/50 last:border-0">
                    <td className="py-2.5 px-3">
                      <span className="font-mono font-semibold text-gray-900 dark:text-white">{r.category}</span>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {median != null ? (
                        <button onClick={() => setOpen(open === r.category ? null : r.category)} className="group text-left">
                          <span className="font-semibold text-gray-900 dark:text-white group-hover:underline">{fmtToteDate(median)}</span>
                          <span className="text-gray-400 dark:text-gray-500 ml-1 text-xs">{open === r.category ? "▾" : "▸"}</span>
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {r.stock ? "no dates yet — run totes sync" : "nothing catalogued"}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      {median != null && tone ? (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 min-w-[70px] rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                            <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${tone.pct}%` }} />
                          </div>
                          <span className={`text-xs tabular-nums ${tone.text}`}>{fmtLag(median, nowMs)} behind</span>
                        </div>
                      ) : <span className="text-xs text-gray-400 dark:text-gray-500">—</span>}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap text-gray-700 dark:text-gray-300">
                      {r.lastCataloguedMs != null
                        ? fmtToteDate(r.lastCataloguedMs)
                        : <span className="text-gray-400 dark:text-gray-500">—</span>}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-gray-700 dark:text-gray-300">
                      {r.catalogued.toLocaleString("en-GB")}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      <span className={r.outstanding > 0 ? "text-gray-900 dark:text-white font-semibold" : "text-gray-400 dark:text-gray-500"}>
                        {r.outstanding.toLocaleString("en-GB")}
                      </span>
                    </td>
                  </tr>
                  {open === r.category && r.stock && (
                    <tr className="border-b border-gray-50 dark:border-gray-800/50">
                      <td colSpan={6} className="px-3 py-3 bg-gray-50/60 dark:bg-gray-800/25">
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                          Newest {r.stock.totesSampled} tote{r.stock.totesSampled === 1 ? "" : "s"} Business Central has
                          marked catalogued in {r.category}, newest first. Ones struck through were ticked off out of
                          order and are ignored — the frontier is the newest one that counts.
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {r.stock.totes.map(t => (
                            <span
                              key={t.tote}
                              title={
                                t.ignored
                                  ? `Tote ${t.tote} — newer than the frontier, ignored as an out-of-order tick`
                                  : `Tote ${t.tote}${t.reason ? ` — ${t.reason}` : " — created in Business Central"}`
                              }
                              className={`text-xs px-2 py-1 rounded-lg border whitespace-nowrap ${
                                t.ignored
                                  ? "border-gray-200 dark:border-gray-700 bg-transparent text-gray-400 dark:text-gray-500 line-through decoration-gray-400/70"
                                  : t.dateMs == null
                                    ? "border-dashed border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500"
                                    : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
                              }`}
                            >
                              <b className="font-mono font-semibold">{t.tote}</b>
                              <span className="opacity-60 mx-1">·</span>
                              {t.dateMs == null ? (t.reason ?? "no date") : fmtToteDate(t.dateMs)}
                              {t.lots > 1 && <span className="opacity-60 ml-1.5">×{t.lots}</span>}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
