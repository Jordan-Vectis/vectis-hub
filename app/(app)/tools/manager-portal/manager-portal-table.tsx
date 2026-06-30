"use client"

import { useEffect, useMemo, useState } from "react"
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
  addedToBC: boolean
  firstLot: string | null
  lastLot: string | null
  avgDurationMs: number | null
  timedLots: number
  topCataloguers: { name: string; count: number }[]
}

type SaleBc = { bc: number; overlap: number; combined: number }
type BcState =
  | { status: "loading" }
  | { status: "disconnected" }
  | { status: "error"; message: string }
  | { status: "ready"; sales: Record<string, SaleBc | null> }

const DAY = 86_400_000

// ─── Formatting ──────────────────────────────────────────────────────────────

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
const fmtFullDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB")

function fmtDuration(ms: number | null): string {
  if (ms == null || ms <= 0) return "—"
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime() }

// ─── Pace + milestones (steady rate over the whole cataloguing span) ─────────

type Pace = { perDay: number; spanDays: number | null }

function paceFor(row: SaleRow): Pace {
  if (row.hubLots < 1 || !row.firstLot || !row.lastLot) return { perDay: 0, spanDays: null }
  const spanDays = Math.max(1, Math.round((Date.parse(row.lastLot) - Date.parse(row.firstLot)) / DAY))
  return { perDay: row.hubLots / spanDays, spanDays }
}

type Milestone = { target: number; days: number; date: number }

function milestonesFor(hubLots: number, perDay: number, nowMs: number, count = 4): Milestone[] {
  if (perDay <= 0) return []
  const out: Milestone[] = []
  let m = Math.floor(hubLots / 100) * 100 + 100
  for (let i = 0; i < count; i++) {
    const days = Math.ceil((m - hubLots) / perDay)
    out.push({ target: m, days, date: nowMs + days * DAY })
    m += 100
  }
  return out
}

function daysToSale(auctionDate: string | null, nowMs: number): number | null {
  if (!auctionDate) return null
  return Math.ceil((Date.parse(auctionDate) - nowMs) / DAY)
}

function bcFor(code: string, bc: BcState): { loading: boolean; data: SaleBc | null } {
  if (bc.status === "loading") return { loading: true, data: null }
  if (bc.status !== "ready")   return { loading: false, data: null }
  return { loading: false, data: bc.sales[code] ?? null }
}

// ─── Small UI bits ───────────────────────────────────────────────────────────

function Num({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="text-right min-w-[60px]">
      <div className={`text-xl font-bold leading-none ${accent ? "text-[#2AB4A6]" : "text-gray-900 dark:text-white"}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500 mt-1">{label}</div>
    </div>
  )
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-[#161618] border border-gray-200 dark:border-gray-800 px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-base font-semibold text-gray-900 dark:text-white mt-0.5">{value}</div>
      {sub && <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}

// ─── Active sale card ────────────────────────────────────────────────────────

function ActiveSaleCard({ row, bc, nowMs, open, onToggle }: {
  row: SaleRow; bc: BcState; nowMs: number; open: boolean; onToggle: () => void
}) {
  const pace = paceFor(row)
  const { loading, data } = bcFor(row.code, bc)
  const bcTxt    = loading ? "…" : data ? data.bc.toLocaleString() : "—"
  const totalTxt = loading ? "…" : data ? data.combined.toLocaleString() : row.hubLots.toLocaleString()
  const overlap  = data?.overlap
  const dts = daysToSale(row.auctionDate, nowMs)
  const ladder = milestonesFor(row.hubLots, pace.perDay, nowMs)
  const next = ladder[0]
  const saleTs = row.auctionDate ? Date.parse(row.auctionDate) : Infinity
  const nextLate = next ? startOfDay(next.date) > startOfDay(saleTs) : false

  const dtsChip = dts == null ? null
    : dts < 0 ? <span className="text-gray-400">sale passed</span>
    : dts === 0 ? <span className="text-amber-500">sale today</span>
    : <span className={dts <= 7 ? "text-amber-500" : "text-gray-500 dark:text-gray-400"}>{dts}d to sale</span>

  return (
    <div className="rounded-xl border border-gray-300 dark:border-gray-800 bg-white dark:bg-[#1C1C1E] overflow-hidden">
      {/* Header */}
      <div onClick={onToggle} className="w-full flex items-center gap-3 px-5 py-4 text-left cursor-pointer hover:bg-gray-50 dark:hover:bg-[#222225] transition-colors">
        <span className="text-gray-400 dark:text-gray-500 select-none w-4">{open ? "▾" : "▸"}</span>
        <Link
          href={`/tools/cataloguing/auctions/${row.id}`}
          onClick={e => e.stopPropagation()}
          className="font-mono font-bold text-lg text-[#2AB4A6] hover:text-[#24a090]"
        >
          {row.code}
        </Link>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900 dark:text-white truncate">{row.name}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 flex flex-wrap items-center gap-x-2">
            <span><span title={auctionTypeLabel(row.auctionType)}>{auctionTypeEmoji(row.auctionType)}</span> {row.auctionType}</span>
            {row.auctionDate && <><span>·</span><span>{fmtFullDate(row.auctionDate)}</span></>}
            {dtsChip && <><span>·</span>{dtsChip}</>}
          </div>
        </div>
        <div className="flex items-center gap-5 sm:gap-7 shrink-0">
          <Num label="Hub" value={row.hubLots.toLocaleString()} />
          <Num label="BC" value={bcTxt} />
          <Num label="Total" value={totalTxt} accent />
        </div>
      </div>

      {/* Always-visible summary line */}
      <div className="px-5 pb-3 -mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600 dark:text-gray-300">
        {pace.perDay > 0
          ? <span>📈 <span className="font-medium">{pace.perDay >= 10 ? Math.round(pace.perDay) : pace.perDay.toFixed(1)}/day</span></span>
          : <span className="text-gray-400 dark:text-gray-500">📈 not enough history for a pace</span>}
        {next && <span className={nextLate ? "text-amber-600 dark:text-amber-400" : ""}>→ {next.target.toLocaleString()} lots by {fmtDate(next.date)}{nextLate && " ⚠"}</span>}
        {overlap != null && overlap > 0 && <span className="text-gray-500 dark:text-gray-400">· {overlap.toLocaleString()} of {row.hubLots.toLocaleString()} Hub lots already in BC</span>}
      </div>

      {/* Expanded detail */}
      {open && (
        <div className="border-t border-gray-200 dark:border-gray-800 px-5 py-4 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            <Tile label="Pace" value={pace.perDay > 0 ? `${pace.perDay >= 10 ? Math.round(pace.perDay) : pace.perDay.toFixed(1)}/day` : "—"} sub={pace.spanDays ? `over ${pace.spanDays}d` : undefined} />
            <Tile label="Avg / lot" value={fmtDuration(row.avgDurationMs)} sub={row.timedLots > 0 ? `${row.timedLots.toLocaleString()} timed` : "no timing"} />
            <Tile label="Days to sale" value={dts == null ? "—" : dts < 0 ? `${Math.abs(dts)}d ago` : dts === 0 ? "today" : `${dts}d`} sub={row.auctionDate ? fmtFullDate(row.auctionDate) : undefined} />
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Projected milestones</p>
              {ladder.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-500">Not enough cataloguing history to project.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {ladder.map(m => {
                    const late = startOfDay(m.date) > startOfDay(saleTs)
                    return (
                      <li key={m.target} className="flex justify-between gap-4">
                        <span className="text-gray-600 dark:text-gray-300">{m.target.toLocaleString()} lots</span>
                        <span className={late ? "text-amber-600 dark:text-amber-400 font-medium" : "text-gray-800 dark:text-gray-100"}>{fmtDate(m.date)} <span className="text-gray-400 dark:text-gray-500">({m.days}d)</span>{late && " ⚠"}</span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Top cataloguers</p>
              {row.topCataloguers.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {row.topCataloguers.map(c => (
                    <li key={c.name} className="flex justify-between gap-4">
                      <span className="text-gray-600 dark:text-gray-300 truncate">{c.name || "Unknown"}</span>
                      <span className="text-gray-800 dark:text-gray-100">{c.count.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-500">No cataloguer data.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Completed sales (compact, ticks not counts) ─────────────────────────────

function CompletedTable({ rows }: { rows: SaleRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-200 dark:border-gray-800">
          {["Code", "Name", "Date", "Type"].map(h => <th key={h} className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">{h}</th>)}
          <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Added to BC</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.id} className="border-b border-gray-200 dark:border-gray-800 last:border-0">
            <td className="px-4 py-2.5">
              <Link href={`/tools/cataloguing/auctions/${row.id}`} className="font-mono font-semibold text-[#2AB4A6] hover:text-[#24a090]">{row.code}</Link>
            </td>
            <td className="px-4 py-2.5 text-gray-800 dark:text-gray-100">{row.name}</td>
            <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">{row.auctionDate ? fmtFullDate(row.auctionDate) : "—"}</td>
            <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 whitespace-nowrap"><span className="mr-1" title={auctionTypeLabel(row.auctionType)}>{auctionTypeEmoji(row.auctionType)}</span>{row.auctionType}</td>
            <td className="px-4 py-2.5">{row.addedToBC ? <span className="text-green-600 dark:text-green-400 font-semibold">✓ Added</span> : <span className="text-gray-400 dark:text-gray-600">—</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function matches(row: SaleRow, search: string, type: string): boolean {
  if (search) {
    const q = search.toLowerCase()
    if (!row.code.toLowerCase().includes(q) && !row.name.toLowerCase().includes(q)) return false
  }
  if (type !== "ALL" && row.auctionType !== type) return false
  return true
}

export default function ManagerPortalTable({ rows, nowMs }: { rows: SaleRow[]; nowMs: number }) {
  const [bc, setBc] = useState<BcState>({ status: "loading" })
  const [search, setSearch] = useState("")
  const [type, setType] = useState("ALL")
  const [open, setOpen] = useState<Set<string>>(new Set())

  const toggle = (id: string) => setOpen(prev => {
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
        setBc({ status: "ready", sales: data.sales ?? {} })
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

  const selectCls = "rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E] px-3 py-2 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]"

  return (
    <>
      {/* BC connection status */}
      {bc.status === "disconnected" && (
        <div className="mb-4 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-300">
          Business Central isn&apos;t connected for your account, so only Hub counts are shown. Connect BC (Tools → BC Warehouse) to see live BC lot counts.
        </div>
      )}
      {bc.status === "error" && (
        <div className="mb-4 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-2.5 text-sm text-red-700 dark:text-red-300">
          Couldn&apos;t load Business Central counts: {bc.message}. Hub counts are still shown below.
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search code or name…" className={`${selectCls} flex-1 min-w-[200px]`} />
        <select value={type} onChange={e => setType(e.target.value)} className={selectCls}>
          <option value="ALL">All types</option>
          {AUCTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.emoji} {t.label}</option>)}
        </select>
        {hasFilter && (
          <button onClick={() => { setSearch(""); setType("ALL") }} className="text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#2C2C2E] transition-colors">Clear</button>
        )}
      </div>

      {/* Active sales — cards */}
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Active Sales{hasFilter && ` (${filteredActive.length})`}</h2>
      {filteredActive.length === 0 ? (
        <div className="text-center py-10 text-gray-600 dark:text-gray-500 text-sm bg-white dark:bg-[#1C1C1E] rounded-xl border border-gray-300 dark:border-gray-700 mb-8">
          {hasFilter ? "No active sales match your filters." : "No active sales."}
        </div>
      ) : (
        <div className="space-y-3 mb-8">
          {filteredActive.map(row => (
            <ActiveSaleCard key={row.id} row={row} bc={bc} nowMs={nowMs} open={open.has(row.id)} onToggle={() => toggle(row.id)} />
          ))}
        </div>
      )}

      {/* Completed sales — compact */}
      {completed.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-500 mb-2">Completed Sales{hasFilter && ` (${filteredCompleted.length})`}</h2>
          <div className="bg-white dark:bg-[#1C1C1E] rounded-xl border border-gray-300 dark:border-gray-700 overflow-x-auto opacity-80">
            {filteredCompleted.length === 0 ? (
              <div className="text-center py-10 text-gray-600 dark:text-gray-500 text-sm">No completed sales match your filters.</div>
            ) : (
              <CompletedTable rows={filteredCompleted} />
            )}
          </div>
        </>
      )}
    </>
  )
}
