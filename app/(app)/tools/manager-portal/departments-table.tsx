"use client"

import { Fragment, useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { auctionTypeEmoji, auctionTypeLabel } from "@/lib/auction-types"
import { toggleHiddenBcCategory } from "@/lib/actions/manager-portal"
import { fmtPace, daysToSale, paceFor, targetsFor, SALE_TARGETS } from "@/lib/sale-projection"

export type StockAge = {
  medianMs: number | null   // null = totes found, but none resolved to a date
  oldestMs: number | null
  newestMs: number | null
  totesSampled: number      // distinct totes sampled (the last 10 worked)
  dated: number             // how many of those resolved to a date
  totes: { tote: string; dateMs: number | null; lots: number; reason: string | null; source: string | null; location?: string | null; estimated?: boolean }[]
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
  poolTotes: number        // catalogued totes BC holds for this category
  estimatedCount: number   // of the sample, how many dates are estimated
  catalogued: number
  outstanding: number
  lastCataloguedMs: number | null
}

export type BcDiagnostics = {
  endpoint: string
  anchors: number
  loggedTotes: number
  sampled: number
  estimated: number
  shortfall: number
  note: string
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
// "Using totes from" shows a single average MONTH, e.g. "Mar 2026".
const fmtMonth = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { month: "short", year: "numeric" })
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

// Shape returned by /api/manager-portal/bc-tote-dates.
type BcLiveCategory = {
  category: string
  monthMs: number | null
  oldestMs: number | null
  newestMs: number | null
  sampled: number
  dated: number
  totes: { tote: string; dateMs: number | null; location?: string | null; estimated?: boolean }[]
  poolTotes?: number
  estimatedCount?: number
  catalogued: number
  outstanding: number
  lastCataloguedMs: number | null
}
export type HiddenBcCategory = { category: string; hiddenByName: string }
type BcLiveState =
  | { status: "loading" }
  | { status: "disconnected"; hidden: HiddenBcCategory[]; isAdmin: boolean }
  | { status: "error" }
  | { status: "ready"; categories: BcCategoryRow[]; hidden: HiddenBcCategory[]; isAdmin: boolean; diagnostics: BcDiagnostics | null }

export default function DepartmentsTable({ groups, migrated, anyDepartments, nowMs }: {
  groups: DeptGroup[]
  migrated: boolean
  anyDepartments: boolean
  nowMs: number
}) {
  // Same source as the Sales tab, so a sale's lot total reads identically on
  // both. Without a BC connection we fall back to the Hub count.
  const [bc, setBc] = useState<BcState>({ status: "loading" })
  // The BC-only category table is fetched LIVE from BC's Receipt Totes, so it
  // loads async with its own state.
  const [bcCats, setBcCats] = useState<BcLiveState>({ status: "loading" })
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

  // Re-run after hiding/restoring a category — the data comes from an API route,
  // so a router refresh wouldn't pick the change up.
  const loadBcCats = useCallback((cancelledRef?: { current: boolean }) => {
    const cancelled = () => cancelledRef?.current === true
    fetch("/api/manager-portal/bc-tote-dates")
      .then(r => r.json())
      .then((d: { connected?: boolean; categories?: BcLiveCategory[]; hidden?: HiddenBcCategory[]; isAdmin?: boolean; diagnostics?: BcDiagnostics }) => {
        if (cancelled()) return
        const hidden  = d?.hidden ?? []
        const isAdmin = d?.isAdmin === true
        if (d?.connected === false) { setBcCats({ status: "disconnected", hidden, isAdmin }); return }
        if (!d?.categories) { setBcCats({ status: "error" }); return }
        const rows: BcCategoryRow[] = d.categories.map(c => ({
          category:         c.category,
          poolTotes:        c.poolTotes ?? 0,
          estimatedCount:   c.estimatedCount ?? 0,
          catalogued:       c.catalogued,
          outstanding:      c.outstanding,
          lastCataloguedMs: c.lastCataloguedMs,
          stock: c.sampled > 0 ? {
            medianMs:     c.monthMs,
            oldestMs:     c.oldestMs,
            newestMs:     c.newestMs,
            totesSampled: c.sampled,
            dated:        c.dated,
            totes: c.totes.map(t => ({
              tote:      t.tote,
              dateMs:    t.dateMs,
              lots:      1,
              reason:    t.dateMs == null ? "no check-in date in BC" : null,
              source:    t.dateMs != null ? "bc" : null,
              location:  t.location ?? null,
              estimated: t.estimated,
            })),
          } : null,
        }))
        setBcCats({ status: "ready", categories: rows, hidden, isAdmin, diagnostics: d?.diagnostics ?? null })
      })
      .catch(() => { if (!cancelled()) setBcCats({ status: "error" }) })
  }, [])

  useEffect(() => {
    const ref = { current: false }
    loadBcCats(ref)
    return () => { ref.current = true }
  }, [loadBcCats])

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

      {/* ── Business Central on its own terms — live from Receipt Totes ── */}
      {bcCats.status === "loading" && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 mb-5 text-sm text-gray-500 dark:text-gray-400">
          Loading the Business Central categories live from Receipt Totes…
        </div>
      )}
      {bcCats.status === "disconnected" && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 mb-5 text-sm text-amber-800 dark:text-amber-300">
          Business Central isn&apos;t connected, so the BC category table can&apos;t be shown. Connect BC from the top bar.
        </div>
      )}
      {bcCats.status === "error" && (
        <div className="rounded-xl border border-red-300 dark:border-red-800/60 bg-red-50 dark:bg-red-950/20 px-4 py-3 mb-5 text-sm text-red-700 dark:text-red-300">
          Couldn&apos;t load the Business Central categories. Try reloading.
        </div>
      )}
      {bcCats.status === "ready" && (bcCats.categories.length > 0 || bcCats.hidden.length > 0) && (
        <BcCategoryTable
          rows={bcCats.categories}
          hidden={bcCats.hidden}
          isAdmin={bcCats.isAdmin}
          diagnostics={bcCats.diagnostics}
          onChanged={loadBcCats}
          nowMs={nowMs}
        />
      )}

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
 * Business Central on its own terms — no departments, no CatalogueAuction, no
 * CatalogueLot. Rows are BC's own article categories, straight off the Receipt
 * Totes feed. "Using totes from" is the median check-in month of the newest 10
 * totes sat on a cataloguing bench in each category — the same view Jordan gets
 * in BC by filtering Receipt Totes to a category + Location BENCH*
 * (see /api/manager-portal/bc-tote-dates).
 */
function BcCategoryTable({ rows, hidden, isAdmin, diagnostics, onChanged, nowMs }: {
  rows: BcCategoryRow[]
  hidden: HiddenBcCategory[]
  isAdmin: boolean
  diagnostics: BcDiagnostics | null
  onChanged: () => void
  nowMs: number
}) {
  const [showDiag, setShowDiag] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)   // category being toggled
  const [error, setError] = useState<string | null>(null)
  const TH = "text-left font-medium py-2 px-3 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400"

  async function toggle(category: string, currentlyHidden: boolean) {
    if (!currentlyHidden && !confirm(
      `Hide ${category} from this table?\n\nIt's display-only — nothing about the category, its totes or its items changes, ` +
      `and you can put it back from the bottom of this table.`,
    )) return
    setError(null)
    setBusy(category)
    const res = await toggleHiddenBcCategory(category)
    setBusy(null)
    if (!res.ok) { setError(res.error ?? "Something went wrong"); return }
    onChanged()
  }

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden mb-5">
      <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            Using totes from — Business Central categories
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Live from Business Central, grouped by BC&apos;s own article category. &ldquo;Using totes
            from&rdquo; is the middle (median) check-in month of the newest 10 totes ticked as catalogued
            in BC — where cataloguing has got to. Furthest behind first. Dates marked ~ are estimated
            (those totes predate BC&apos;s change logging).
          </p>
        </div>
        {/* Export mirrors exactly what's on screen, hidden categories included. */}
        <div className="flex items-center gap-1.5 shrink-0">
          <a
            href="/api/manager-portal/bc-tote-dates/pdf"
            title="Download this table as a PDF (hidden categories are left out)"
            className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors whitespace-nowrap"
          >
            ⬇ Export PDF
          </a>
          <a
            href="/api/manager-portal/bc-tote-dates/pdf?totes=1"
            title="PDF including the 10 totes behind each category's month"
            className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors whitespace-nowrap"
          >
            + totes
          </a>
        </div>
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
                  <tr className="border-b border-gray-50 dark:border-gray-800/50 last:border-0 group">
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span className="font-mono font-semibold text-gray-900 dark:text-white">{r.category}</span>
                      {isAdmin && (
                        <button
                          onClick={() => toggle(r.category, false)}
                          disabled={busy === r.category}
                          title={`Hide ${r.category} from this table`}
                          className="ml-2 text-[11px] font-semibold text-gray-300 dark:text-gray-600 hover:text-red-500 disabled:opacity-50 transition-colors md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
                        >
                          {busy === r.category ? "…" : "✕ Hide"}
                        </button>
                      )}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {median != null ? (
                        <button onClick={() => setOpen(open === r.category ? null : r.category)} className="group text-left" title={`Median check-in month of the ${r.stock?.totesSampled ?? 0} newest tote(s) on a bench — click to list them`}>
                          <span className="font-semibold text-gray-900 dark:text-white group-hover:underline">{fmtMonth(median)}</span>
                          <span
                            className={`ml-1.5 text-[11px] ${(r.stock?.totesSampled ?? 0) < 10 ? "text-amber-500" : "text-gray-400 dark:text-gray-500"}`}
                            title={
                              (r.stock?.totesSampled ?? 0) < 10
                                ? `Only ${r.stock?.totesSampled ?? 0} tote(s) available — BC's web service doesn't return totes already ticked Catalogued, so recent finished work is invisible here`
                                : "Based on the full sample of 10 totes"
                            }
                          >
                            {r.stock?.totesSampled ?? 0} tote{(r.stock?.totesSampled ?? 0) === 1 ? "" : "s"}
                          </span>
                          <span className="text-gray-400 dark:text-gray-500 ml-1 text-xs">{open === r.category ? "▾" : "▸"}</span>
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {r.stock ? "no check-in dates on those totes" : "nothing catalogued yet"}
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
                          The newest {r.stock.totesSampled} tote{r.stock.totesSampled === 1 ? "" : "s"} catalogued in {r.category},
                          by check-in date. The month above is the middle (median) of these.
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {r.stock.totes.map(t => (
                            <span
                              key={t.tote}
                              title={`Tote ${t.tote}${t.location ? ` on ${t.location}` : ""}${
                                t.reason
                                  ? ` — ${t.reason}`
                                  : t.estimated
                                    ? " — estimated from neighbouring tote numbers (this tote predates BC's change logging)"
                                    : " — checked in on this date (from BC's change log)"
                              }`}
                              className={`text-xs px-2 py-1 rounded-lg border whitespace-nowrap ${
                                t.dateMs == null
                                  ? "border-dashed border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500"
                                  : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
                              }`}
                            >
                              <b className="font-mono font-semibold">{t.tote}</b>
                              <span className="opacity-60 mx-1">·</span>
                              {t.dateMs == null ? (t.reason ?? "no date") : `${t.estimated ? "~" : ""}${fmtToteDate(t.dateMs)}`}
                              {t.location && <span className="opacity-50 ml-1.5">{t.location}</span>}
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

      {/* ── Diagnostics — why a category is thin, without guesswork ── */}
      {diagnostics && (
        <div className="px-4 py-2.5 border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={() => setShowDiag(v => !v)}
            className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            {showDiag ? "▾" : "▸"} Where these numbers come from
            {diagnostics.shortfall > 0 && (
              <span className="ml-1.5 text-amber-500">
                — {diagnostics.shortfall} categor{diagnostics.shortfall === 1 ? "y has" : "ies have"} fewer than 10 totes
              </span>
            )}
          </button>
          {showDiag && (
            <div className="mt-2.5 text-xs text-gray-600 dark:text-gray-400 space-y-2">
              <p>
                Totes come from Business Central&apos;s full receipt-tote table via{" "}
                <code className="font-mono">{diagnostics.endpoint}</code>. Dates come from BC&apos;s change
                log — <b>{diagnostics.loggedTotes.toLocaleString("en-GB")}</b> logged tote creations, of which{" "}
                <b>{(diagnostics.sampled - diagnostics.estimated).toLocaleString("en-GB")}</b> of{" "}
                <b>{diagnostics.sampled.toLocaleString("en-GB")}</b> sampled totes are real dates
                {diagnostics.estimated > 0 && <> and <b>{diagnostics.estimated}</b> are estimated (shown with ~)</>}.
              </p>
              <p className="text-amber-700 dark:text-amber-400">⚠ {diagnostics.note}</p>
              <div className="overflow-x-auto">
                <table className="text-xs">
                  <thead>
                    <tr className="text-gray-500 dark:text-gray-400">
                      <th className="text-left font-medium pr-4 pb-1">Category</th>
                      <th className="text-right font-medium pr-4 pb-1">Totes catalogued in BC</th>
                      <th className="text-right font-medium pr-4 pb-1">Used for the month</th>
                      <th className="text-right font-medium pr-4 pb-1">Dates estimated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...rows]
                      .sort((a, b) => (a.stock?.totesSampled ?? 0) - (b.stock?.totesSampled ?? 0))
                      .map(r => (
                        <tr key={r.category}>
                          <td className="pr-4 py-0.5 font-mono text-gray-700 dark:text-gray-300">{r.category}</td>
                          <td className="pr-4 py-0.5 text-right tabular-nums">{r.poolTotes.toLocaleString("en-GB")}</td>
                          <td className={`pr-4 py-0.5 text-right tabular-nums ${(r.stock?.totesSampled ?? 0) < 10 ? "text-amber-500" : ""}`}>
                            {r.stock?.totesSampled ?? 0}
                          </td>
                          <td className="pr-4 py-0.5 text-right tabular-nums">
                            {r.estimatedCount > 0 ? r.estimatedCount : <span className="opacity-40">—</span>}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Hidden categories (admin) — display-only, always restorable ── */}
      {isAdmin && hidden.length > 0 && (
        <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/25">
          <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">
            Hidden from this table ({hidden.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {hidden.map(h => (
              <span
                key={h.category}
                className="text-xs px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 whitespace-nowrap"
              >
                <b className="font-mono font-semibold text-gray-700 dark:text-gray-300">{h.category}</b>
                <span className="opacity-60 ml-1.5">hidden by {h.hiddenByName}</span>
                <button
                  onClick={() => toggle(h.category, true)}
                  disabled={busy === h.category}
                  title={`Show ${h.category} in this table again`}
                  className="ml-2 font-semibold text-[#2AB4A6] hover:underline disabled:opacity-50"
                >
                  {busy === h.category ? "…" : "↺ Restore"}
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
      {error && <p className="px-4 pb-3 text-xs text-red-500">{error}</p>}
    </section>
  )
}
