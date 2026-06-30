"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AUCTION_TYPES, auctionTypeEmoji, auctionTypeLabel } from "@/lib/auction-types"

export type SaleRow = {
  id: string
  code: string
  name: string
  auctionDate: string | null
  auctionType: string
  hubLots: number
  complete: boolean
  addedToBC: boolean          // whole-sale "added to BC" flag
  addedToBCLots: number       // lots individually ticked Added-to-BC
  // Estimate value
  estLowSum: number
  estHighSum: number
  estLowAvg: number | null
  estHighAvg: number | null
  estCount: number
  // Recent activity (for cataloguing pace)
  lots7d: number
  firstLot7d: string | null
  lastLot7d: string | null
  // Cool stats
  statusCounts: Record<string, number>
  withPhotos: number | null
  avgDurationMs: number | null
  timedLots: number
  topCataloguers: { name: string; count: number }[]
}

type BcState =
  | { status: "loading" }
  | { status: "disconnected" }
  | { status: "error"; message: string }
  | { status: "ready"; counts: Record<string, number | null> }

const STATUS_ORDER = ["ENTERED", "REVIEWED", "PUBLISHED", "SOLD", "UNSOLD", "WITHDRAWN"]
const STALE_DAYS = 3

// ─── Formatting helpers ──────────────────────────────────────────────────────

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

function gbp(n: number): string {
  return "£" + Math.round(n).toLocaleString("en-GB")
}

// Compact money for tight cells: £950 · £12.3k · £100k · £1.0m
function gbpShort(n: number): string {
  const neg = n < 0 ? "-" : ""
  const abs = Math.abs(n)
  if (abs < 999.5) return neg + "£" + Math.round(abs).toLocaleString("en-GB")
  // >= 999_500 rolls up to "1.0m" rather than rendering a malformed "£1000k".
  if (abs >= 999_500) { const m = abs / 1_000_000; return neg + "£" + m.toFixed(m >= 10 ? 0 : 1) + "m" }
  const k = abs / 1_000
  const dp = (Math.round(k * 10) / 10) >= 100 ? 0 : 1
  return neg + "£" + k.toFixed(dp) + "k"
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

function fmtDuration(ms: number | null): string {
  if (ms == null || ms <= 0) return "—"
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m >= 60) { const h = Math.floor(m / 60); return `${h}h ${m % 60}m` }
  return m > 0 ? `${m}m ${r}s` : `${r}s`
}

function pct(n: number, total: number): string {
  return total > 0 ? Math.round((n / total) * 100) + "%" : "—"
}

const startOfDay = (ts: number) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime() }

// Late only if the projected day is strictly after the sale DAY (compare on
// calendar days so a same-day projection isn't flagged late by the clock time).
function isAfterSaleDay(date: Date, auctionDate: string | null): boolean {
  if (!auctionDate) return false
  return startOfDay(date.getTime()) > startOfDay(Date.parse(auctionDate))
}

// ─── Pace + milestone projection ─────────────────────────────────────────────

type Pace = { perDay: number; window: string | null; stale: boolean }

// Cataloguing rate over the actual active span in the last 7 days (so a burst
// isn't diluted). Reports no pace ("idle") when nothing has been catalogued in
// the last few days, so stalled sales aren't given an optimistic projection.
function paceFor(row: SaleRow): Pace {
  if (row.lots7d <= 0 || !row.firstLot7d || !row.lastLot7d) return { perDay: 0, window: null, stale: false }
  const now = Date.now()
  const first = Date.parse(row.firstLot7d)
  const last  = Date.parse(row.lastLot7d)
  if (now - last > STALE_DAYS * 86_400_000) return { perDay: 0, window: "last 7 days", stale: true }
  const spanDays = clamp((last - first) / 86_400_000, 1, 7)
  return { perDay: row.lots7d / spanDays, window: "last 7 days", stale: false }
}

type Milestone = { target: number; days: number | null; date: Date | null }

function milestonesFor(hubLots: number, perDay: number, count = 4): Milestone[] {
  const out: Milestone[] = []
  let m = Math.floor(hubLots / 100) * 100 + 100
  for (let i = 0; i < count; i++) {
    const remaining = m - hubLots
    const days = perDay > 0 ? Math.ceil(remaining / perDay) : null
    out.push({ target: m, days, date: days != null ? new Date(Date.now() + days * 86_400_000) : null })
    m += 100
  }
  return out
}

function daysToSale(auctionDate: string | null): number | null {
  if (!auctionDate) return null
  return Math.ceil((Date.parse(auctionDate) - Date.now()) / 86_400_000)
}

// ─── Cells ───────────────────────────────────────────────────────────────────

function matches(row: SaleRow, search: string, type: string): boolean {
  if (search) {
    const q = search.toLowerCase()
    if (!row.code.toLowerCase().includes(q) && !row.name.toLowerCase().includes(q)) return false
  }
  if (type !== "ALL" && row.auctionType !== type) return false
  return true
}

function bcCell(code: string, bc: BcState) {
  if (bc.status === "loading") return <span className="text-gray-400 dark:text-gray-500 animate-pulse">…</span>
  if (bc.status !== "ready")   return <span className="text-gray-400 dark:text-gray-600">—</span>
  const c = bc.counts[code]
  if (c === null || c === undefined) return <span className="text-gray-400 dark:text-gray-600">—</span>
  return <span className="text-gray-700 dark:text-gray-200">{c.toLocaleString()}</span>
}

function totalCell(row: SaleRow, bc: BcState) {
  const c = bc.status === "ready" ? bc.counts[row.code] : undefined
  const total = row.hubLots + (typeof c === "number" ? c : 0)
  return <span className="font-semibold text-gray-900 dark:text-white">{total.toLocaleString()}</span>
}

function paceCell(row: SaleRow, pace: Pace, mounted: boolean) {
  if (!mounted) return <span className="text-gray-400 dark:text-gray-500">…</span>
  if (row.complete) return <span className="text-gray-400 dark:text-gray-600">—</span>
  if (pace.perDay <= 0) {
    return <span className="text-gray-400 dark:text-gray-600" title={pace.stale ? "No lots added in the last few days" : "No lots added recently"}>idle</span>
  }
  const perDay = pace.perDay >= 10 ? Math.round(pace.perDay) : pace.perDay.toFixed(1)
  return <span className="text-gray-700 dark:text-gray-200" title={`Based on the ${pace.window}`}>{perDay}/day</span>
}

function nextMilestoneCell(row: SaleRow, pace: Pace, mounted: boolean) {
  if (!mounted) return <span className="text-gray-400 dark:text-gray-500">…</span>
  if (row.complete || pace.perDay <= 0) return <span className="text-gray-400 dark:text-gray-600">—</span>
  const m = milestonesFor(row.hubLots, pace.perDay, 1)[0]
  if (!m?.date) return <span className="text-gray-400 dark:text-gray-600">—</span>
  const late = isAfterSaleDay(m.date, row.auctionDate)
  return (
    <span className={late ? "text-amber-600 dark:text-amber-400" : "text-gray-700 dark:text-gray-200"}>
      {m.target.toLocaleString()} ≈ {fmtDate(m.date)}
      <span className="text-gray-400 dark:text-gray-500"> ({m.days}d)</span>
    </span>
  )
}

function valueCell(row: SaleRow) {
  if (!row.estLowSum && !row.estHighSum) return <span className="text-gray-400 dark:text-gray-600">—</span>
  return (
    <span className="text-gray-700 dark:text-gray-200" title={`${gbp(row.estLowSum)} – ${gbp(row.estHighSum)} across ${row.estCount.toLocaleString()} lots`}>
      {gbpShort(row.estLowSum)}<span className="text-gray-400 dark:text-gray-500">–</span>{gbpShort(row.estHighSum)}
    </span>
  )
}

function bcTickCell(row: SaleRow) {
  return row.addedToBC
    ? <span className="text-green-600 dark:text-green-400 font-semibold" title={`${row.addedToBCLots.toLocaleString()} lots ticked Added-to-BC`}>✓ Added</span>
    : <span className="text-gray-400 dark:text-gray-600">—</span>
}

// ─── Expanded detail panel ───────────────────────────────────────────────────

function Line({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-4">
      <span className="text-gray-600 dark:text-gray-300">{label}</span>
      <span className="text-gray-800 dark:text-gray-100">{value}</span>
    </li>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">{title}</p>
      {children}
    </div>
  )
}

function DetailPanel({ row, pace }: { row: SaleRow; pace: Pace }) {
  const dts = daysToSale(row.auctionDate)
  const ladder = milestonesFor(row.hubLots, pace.perDay, 4)
  const photoTxt = row.withPhotos == null ? "—" : `${row.withPhotos.toLocaleString()} / ${row.hubLots.toLocaleString()} (${pct(row.withPhotos, row.hubLots)})`

  return (
    <div className="px-6 py-4 bg-gray-50 dark:bg-[#161618] grid gap-x-8 gap-y-5 md:grid-cols-2 lg:grid-cols-3 text-sm">
      {/* Projected milestones */}
      <Block title="Projected milestones">
        {row.complete ? (
          <p className="text-gray-500 dark:text-gray-500">Sale marked complete.</p>
        ) : pace.perDay <= 0 ? (
          <p className="text-gray-500 dark:text-gray-500">{pace.stale ? "No lots added in the last few days — can't project a pace." : "No recent activity to project a pace."}</p>
        ) : (
          <ul className="space-y-1">
            {ladder.map(m => {
              const late = m.date ? isAfterSaleDay(m.date, row.auctionDate) : false
              return (
                <li key={m.target} className="flex items-center justify-between gap-4">
                  <span className="text-gray-600 dark:text-gray-300">{m.target.toLocaleString()} lots</span>
                  <span className={late ? "text-amber-600 dark:text-amber-400 font-medium" : "text-gray-800 dark:text-gray-100"}>
                    {m.date ? fmtDate(m.date) : "—"}<span className="text-gray-400 dark:text-gray-500"> ({m.days}d)</span>{late && <span title="After the sale date"> ⚠</span>}
                  </span>
                </li>
              )
            })}
            <li className="pt-1 text-xs text-gray-400 dark:text-gray-500">Pace: {pace.perDay.toFixed(1)}/day ({pace.window})</li>
          </ul>
        )}
      </Block>

      {/* Progress */}
      <Block title="Progress">
        <ul className="space-y-1">
          <Line label="Added to BC" value={`${row.addedToBCLots.toLocaleString()} / ${row.hubLots.toLocaleString()} (${pct(row.addedToBCLots, row.hubLots)})`} />
          <Line label="With photos" value={photoTxt} />
          <Line label="Published"   value={`${(row.statusCounts.PUBLISHED ?? 0).toLocaleString()} (${pct(row.statusCounts.PUBLISHED ?? 0, row.hubLots)})`} />
        </ul>
      </Block>

      {/* Status breakdown */}
      <Block title="Status breakdown">
        {row.hubLots === 0 ? (
          <p className="text-gray-500 dark:text-gray-500">No lots yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {STATUS_ORDER.filter(s => (row.statusCounts[s] ?? 0) > 0).map(s => (
              <span key={s} className="inline-flex items-center gap-1 rounded-full border border-gray-300 dark:border-gray-700 px-2 py-0.5 text-xs text-gray-700 dark:text-gray-300">
                {s} <span className="font-semibold text-gray-900 dark:text-white">{(row.statusCounts[s] ?? 0).toLocaleString()}</span>
              </span>
            ))}
          </div>
        )}
      </Block>

      {/* Estimate value */}
      <Block title="Estimate value">
        {row.estLowSum || row.estHighSum ? (
          <ul className="space-y-1">
            <Line label="Total" value={<span className="font-medium">{gbp(row.estLowSum)} – {gbp(row.estHighSum)}</span>} />
            <Line label="Average / lot" value={`${row.estLowAvg != null ? gbp(row.estLowAvg) : "—"} – ${row.estHighAvg != null ? gbp(row.estHighAvg) : "—"}`} />
            <Line label="Lots with an estimate" value={`${row.estCount.toLocaleString()} / ${row.hubLots.toLocaleString()}`} />
          </ul>
        ) : (
          <p className="text-gray-500 dark:text-gray-500">No estimates entered yet.</p>
        )}
      </Block>

      {/* Cataloguing speed */}
      <Block title="Cataloguing speed">
        {row.timedLots > 0 ? (
          <ul className="space-y-1">
            <Line label="Avg time / lot" value={fmtDuration(row.avgDurationMs)} />
            <Line label="Lots timed" value={row.timedLots.toLocaleString()} />
          </ul>
        ) : (
          <p className="text-gray-500 dark:text-gray-500">No timing data for this sale.</p>
        )}
      </Block>

      {/* Top cataloguers */}
      <Block title="Top cataloguers">
        {row.topCataloguers.length > 0 ? (
          <ul className="space-y-1">
            {row.topCataloguers.map(c => (
              <Line key={c.name} label={c.name || "Unknown"} value={`${c.count.toLocaleString()} lots`} />
            ))}
          </ul>
        ) : (
          <p className="text-gray-500 dark:text-gray-500">No cataloguer data.</p>
        )}
      </Block>

      {/* Timing */}
      <Block title="Timing">
        <ul className="space-y-1">
          <Line label="Sale date" value={row.auctionDate ? new Date(row.auctionDate).toLocaleDateString("en-GB") : "—"} />
          <Line label="Days to sale" value={dts == null ? "—" : dts < 0 ? `${Math.abs(dts)}d ago` : dts === 0 ? "today" : `${dts}d`} />
          <Line label="Added last 7 days" value={row.lots7d.toLocaleString()} />
        </ul>
        <Link href={`/tools/cataloguing/auctions/${row.id}`} className="inline-block mt-3 text-[#2AB4A6] hover:text-[#24a090] font-medium">Open in Cataloguing →</Link>
      </Block>
    </div>
  )
}

// ─── Table ───────────────────────────────────────────────────────────────────

const thBase = "px-4 py-3 font-medium text-gray-600 dark:text-gray-400"

function SalesTable({ rows, bc, expanded, onToggle, mounted, completed }: {
  rows: SaleRow[]
  bc: BcState
  expanded: Set<string>
  onToggle: (id: string) => void
  mounted: boolean
  completed: boolean
}) {
  const colSpan = completed ? 7 : 11
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1C1C1E]">
          <th className="w-8 px-2 py-3"></th>
          <th className={`text-left ${thBase}`}>Code</th>
          <th className={`text-left ${thBase}`}>Name</th>
          <th className={`text-left ${thBase}`}>Date</th>
          <th className={`text-left ${thBase}`}>Type</th>
          {completed ? (
            <th className={`text-left ${thBase}`}>Added to BC</th>
          ) : (
            <>
              <th className={`text-right ${thBase}`}>Hub</th>
              <th className={`text-right ${thBase}`}>BC</th>
              <th className={`text-right ${thBase}`}>Total</th>
              <th className={`text-right ${thBase}`}>Pace</th>
              <th className={`text-left  ${thBase}`}>Next milestone</th>
            </>
          )}
          <th className={`text-right ${thBase}`}>Est. value</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => {
          const pace = paceFor(row)
          const isOpen = expanded.has(row.id)
          return (
            <Fragment key={row.id}>
              <tr
                className="border-b border-gray-200 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer"
                onClick={() => onToggle(row.id)}
              >
                <td className="px-2 py-3 text-center text-gray-400 dark:text-gray-500 select-none">{isOpen ? "▾" : "▸"}</td>
                <td className="px-4 py-3">
                  <Link
                    href={`/tools/cataloguing/auctions/${row.id}`}
                    onClick={e => e.stopPropagation()}
                    className="font-mono font-semibold text-[#2AB4A6] hover:text-[#24a090]"
                  >
                    {row.code}
                  </Link>
                </td>
                <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100 max-w-[220px] truncate" title={row.name}>{row.name}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                  {row.auctionDate ? new Date(row.auctionDate).toLocaleDateString("en-GB") : "—"}
                </td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                  <span className="mr-1.5" title={auctionTypeLabel(row.auctionType)}>{auctionTypeEmoji(row.auctionType)}</span>
                  {row.auctionType}
                </td>
                {completed ? (
                  <td className="px-4 py-3 text-left whitespace-nowrap">{bcTickCell(row)}</td>
                ) : (
                  <>
                    <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-200">{row.hubLots.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">{bcCell(row.code, bc)}</td>
                    <td className="px-4 py-3 text-right">{totalCell(row, bc)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{paceCell(row, pace, mounted)}</td>
                    <td className="px-4 py-3 text-left whitespace-nowrap">{nextMilestoneCell(row, pace, mounted)}</td>
                  </>
                )}
                <td className="px-4 py-3 text-right whitespace-nowrap">{valueCell(row)}</td>
              </tr>
              {isOpen && (
                <tr className="border-b border-gray-200 dark:border-gray-800">
                  <td colSpan={colSpan} className="p-0"><DetailPanel row={row} pace={pace} /></td>
                </tr>
              )}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-[#1C1C1E] rounded-xl border border-gray-300 dark:border-gray-700 p-4">
      <p className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{value}</p>
    </div>
  )
}

export default function ManagerPortalTable({ rows }: { rows: SaleRow[] }) {
  const [bc, setBc] = useState<BcState>({ status: "loading" })
  const [search, setSearch] = useState("")
  const [type, setType] = useState("ALL")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Pace/milestone dates depend on "now" — only render them after mount so the
  // server-rendered HTML and first client render agree (no hydration mismatch).
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/manager-portal/bc-counts")
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) { setBc({ status: "error", message: data?.error ?? "BC query failed" }); return }
        if (!data.connected) { setBc({ status: "disconnected" }); return }
        setBc({ status: "ready", counts: data.counts ?? {} })
      } catch (e: any) {
        if (!cancelled) setBc({ status: "error", message: e?.message ?? "BC query failed" })
      }
    })()
    return () => { cancelled = true }
  }, [])

  const active    = useMemo(() => rows.filter(r => !r.complete), [rows])
  const completed = useMemo(() => rows.filter(r => r.complete), [rows])

  const filteredActive    = useMemo(() => active.filter(r => matches(r, search, type)),    [active, search, type])
  const filteredCompleted = useMemo(() => completed.filter(r => matches(r, search, type)), [completed, search, type])
  const hasFilter = !!search || type !== "ALL"

  // Headline totals cover ACTIVE sales only — completed sales' BC counts double
  // once their lots are pushed into BC, so summing them would mislead.
  const totalHub = useMemo(() => active.reduce((s, r) => s + r.hubLots, 0), [active])
  const totalBc = useMemo(() => {
    if (bc.status !== "ready") return null
    return active.reduce((s, r) => s + (typeof bc.counts[r.code] === "number" ? (bc.counts[r.code] as number) : 0), 0)
  }, [active, bc])
  const totalEstLow  = useMemo(() => active.reduce((s, r) => s + r.estLowSum, 0), [active])
  const totalEstHigh = useMemo(() => active.reduce((s, r) => s + r.estHighSum, 0), [active])

  const selectCls = "rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E] px-3 py-2 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]"

  return (
    <>
      {/* Stat strip — active sales */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-2">
        <StatCard label="Active Sales" value={active.length.toLocaleString()} />
        <StatCard label="Hub Lots" value={totalHub.toLocaleString()} />
        <StatCard label="BC Lots" value={bc.status === "ready" ? (totalBc ?? 0).toLocaleString() : "…"} />
        <StatCard label="Combined Total" value={bc.status === "ready" ? (totalHub + (totalBc ?? 0)).toLocaleString() : "…"} />
        <StatCard label="Est. Value" value={totalEstLow || totalEstHigh ? `${gbpShort(totalEstLow)}–${gbpShort(totalEstHigh)}` : "—"} />
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-500 mb-6">Headline totals cover active sales. Completed sales are shown below as ticks, since their Hub + BC counts double once lots are pushed into BC.</p>

      {/* BC connection status */}
      {bc.status === "disconnected" && (
        <div className="mb-4 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-300">
          Business Central isn't connected for your account, so only Hub counts are shown. Connect BC (Tools → BC Warehouse) to see live BC lot counts.
        </div>
      )}
      {bc.status === "error" && (
        <div className="mb-4 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-2.5 text-sm text-red-700 dark:text-red-300">
          Couldn't load Business Central counts: {bc.message}. Hub counts are still shown below.
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search code or name…"
          className={`${selectCls} flex-1 min-w-[200px]`}
        />
        <select value={type} onChange={e => setType(e.target.value)} className={selectCls}>
          <option value="ALL">All types</option>
          {AUCTION_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.emoji} {t.label}</option>
          ))}
        </select>
        {hasFilter && (
          <button
            onClick={() => { setSearch(""); setType("ALL") }}
            className="text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#2C2C2E] transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Active sales */}
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
        Active Sales{hasFilter && ` (${filteredActive.length})`}
      </h2>
      <div className="bg-white dark:bg-[#1C1C1E] rounded-xl border border-gray-300 dark:border-gray-700 overflow-x-auto mb-8">
        {filteredActive.length === 0 ? (
          <div className="text-center py-10 text-gray-600 dark:text-gray-500 text-sm">
            {hasFilter ? "No active sales match your filters." : "No active sales."}
          </div>
        ) : (
          <SalesTable rows={filteredActive} bc={bc} expanded={expanded} onToggle={toggle} mounted={mounted} completed={false} />
        )}
      </div>

      {/* Completed sales — de-emphasised, ticks instead of counts */}
      {completed.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-500 mb-2">
            Completed Sales{hasFilter && ` (${filteredCompleted.length})`}
          </h2>
          <div className="bg-white dark:bg-[#1C1C1E] rounded-xl border border-gray-300 dark:border-gray-700 overflow-x-auto opacity-70">
            {filteredCompleted.length === 0 ? (
              <div className="text-center py-10 text-gray-600 dark:text-gray-500 text-sm">
                No completed sales match your filters.
              </div>
            ) : (
              <SalesTable rows={filteredCompleted} bc={bc} expanded={expanded} onToggle={toggle} mounted={mounted} completed={true} />
            )}
          </div>
        </>
      )}

      <p className="mt-6 text-xs text-gray-500 dark:text-gray-500">
        BC Lots are counted live from Business Central, matched on sales allocation (e.g. F089). Pace and projected milestones are based on the rate lots have been added recently; an amber date means that milestone falls after the sale date. Click any sale for the full breakdown.
      </p>
    </>
  )
}
