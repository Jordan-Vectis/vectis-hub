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
}

type BcState =
  | { status: "loading" }
  | { status: "disconnected" }
  | { status: "error"; message: string }
  | { status: "ready"; counts: Record<string, number | null> }

function matches(row: SaleRow, search: string, type: string): boolean {
  if (search) {
    const q = search.toLowerCase()
    if (!row.code.toLowerCase().includes(q) && !row.name.toLowerCase().includes(q)) return false
  }
  if (type !== "ALL" && row.auctionType !== type) return false
  return true
}

// What to show in the BC column for one sale, given the overall BC state.
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

function SalesTable({ rows, bc }: { rows: SaleRow[]; bc: BcState }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1C1C1E]">
          <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Code</th>
          <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Name</th>
          <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Date</th>
          <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Type</th>
          <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Hub Lots</th>
          <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">BC Lots</th>
          <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr
            key={row.id}
            className="border-b border-gray-200 dark:border-gray-800 last:border-0 hover:bg-gray-100 dark:hover:bg-[#2C2C2E] transition-colors"
          >
            <td className="px-4 py-3">
              <Link
                href={`/tools/cataloguing/auctions/${row.id}`}
                className="font-mono font-semibold text-[#2AB4A6] hover:text-[#24a090]"
              >
                {row.code}
              </Link>
            </td>
            <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100">{row.name}</td>
            <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
              {row.auctionDate ? new Date(row.auctionDate).toLocaleDateString("en-GB") : "—"}
            </td>
            <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
              <span className="mr-1.5" title={auctionTypeLabel(row.auctionType)}>{auctionTypeEmoji(row.auctionType)}</span>
              {row.auctionType}
            </td>
            <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-200">{row.hubLots.toLocaleString()}</td>
            <td className="px-4 py-3 text-right">{bcCell(row.code, bc)}</td>
            <td className="px-4 py-3 text-right">{totalCell(row, bc)}</td>
          </tr>
        ))}
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

  // Totals across all sales (not just the filtered view).
  const totalHub = useMemo(() => rows.reduce((s, r) => s + r.hubLots, 0), [rows])
  const totalBc = useMemo(() => {
    if (bc.status !== "ready") return null
    return rows.reduce((s, r) => s + (typeof bc.counts[r.code] === "number" ? (bc.counts[r.code] as number) : 0), 0)
  }, [rows, bc])

  const selectCls = "rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E] px-3 py-2 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]"

  return (
    <>
      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Active Sales" value={active.length.toLocaleString()} />
        <StatCard label="Hub Lots" value={totalHub.toLocaleString()} />
        <StatCard label="BC Lots" value={bc.status === "ready" ? (totalBc ?? 0).toLocaleString() : "…"} />
        <StatCard label="Combined Total" value={bc.status === "ready" ? (totalHub + (totalBc ?? 0)).toLocaleString() : "…"} />
      </div>

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
      <div className="bg-white dark:bg-[#1C1C1E] rounded-xl border border-gray-300 dark:border-gray-700 overflow-hidden mb-8">
        {filteredActive.length === 0 ? (
          <div className="text-center py-10 text-gray-600 dark:text-gray-500 text-sm">
            {hasFilter ? "No active sales match your filters." : "No active sales."}
          </div>
        ) : (
          <SalesTable rows={filteredActive} bc={bc} />
        )}
      </div>

      {/* Completed sales — de-emphasised */}
      {completed.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-500 mb-2">
            Completed Sales{hasFilter && ` (${filteredCompleted.length})`}
          </h2>
          <div className="bg-white dark:bg-[#1C1C1E] rounded-xl border border-gray-300 dark:border-gray-700 overflow-hidden opacity-70">
            {filteredCompleted.length === 0 ? (
              <div className="text-center py-10 text-gray-600 dark:text-gray-500 text-sm">
                No completed sales match your filters.
              </div>
            ) : (
              <SalesTable rows={filteredCompleted} bc={bc} />
            )}
          </div>
        </>
      )}

      <p className="mt-6 text-xs text-gray-500 dark:text-gray-500">
        BC Lots are counted live from Business Central, matched on sales allocation (e.g. {`F089`}). Total = Hub + BC.
      </p>
    </>
  )
}
