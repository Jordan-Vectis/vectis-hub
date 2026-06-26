"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import CompleteToggle from "./complete-toggle"
import AuctionNotesButton from "./auction-notes-button"
import { AUCTION_TYPES, auctionTypeEmoji, auctionTypeLabel } from "@/lib/auction-types"

export type AuctionRow = {
  id: string
  code: string
  name: string
  auctionDate: string | null
  auctionType: string
  lots: number
  catalogued: boolean
  addedToBC: boolean
  photography: boolean
  aiRan: boolean
  complete: boolean
  notes: string | null
}

const STATUS_FILTERS = [
  { value: "ALL",          label: "All statuses" },
  { value: "catalogued",   label: "Catalogued" },
  { value: "!catalogued",  label: "Not catalogued" },
  { value: "addedToBC",    label: "Added to BC" },
  { value: "!addedToBC",   label: "Not added to BC" },
  { value: "photography",  label: "Photographed" },
  { value: "!photography", label: "Not photographed" },
  { value: "aiRan",        label: "Ran through AI" },
  { value: "!aiRan",       label: "Not ran through AI" },
] as const

function matches(row: AuctionRow, search: string, type: string, status: string): boolean {
  if (search) {
    const q = search.toLowerCase()
    if (!row.code.toLowerCase().includes(q) && !row.name.toLowerCase().includes(q)) return false
  }
  if (type !== "ALL" && row.auctionType !== type) return false
  if (status !== "ALL") {
    const negate = status.startsWith("!")
    const key = (negate ? status.slice(1) : status) as keyof AuctionRow
    const val = !!row[key]
    if (negate ? val : !val) return false
  }
  return true
}

function AuctionTable({ rows }: { rows: AuctionRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1C1C1E]">
          <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Code</th>
          <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Name</th>
          <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Date</th>
          <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Type</th>
          <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Lots</th>
          <th className="text-center px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Catalogued</th>
          <th className="text-center px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Added to BC</th>
          <th className="text-center px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Photography</th>
          <th className="text-center px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Ran through AI</th>
          <th className="text-center px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Complete</th>
          <th className="px-4 py-3"></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((auction) => (
          <tr
            key={auction.id}
            className="border-b border-gray-200 dark:border-gray-800 last:border-0 hover:bg-gray-100 dark:hover:bg-[#2C2C2E] transition-colors"
          >
            <td className="px-4 py-3">
              <Link
                href={`/tools/cataloguing/auctions/${auction.id}`}
                className="font-mono font-semibold text-[#2AB4A6] hover:text-[#24a090]"
              >
                {auction.code}
              </Link>
            </td>
            <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100">{auction.name}</td>
            <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
              {auction.auctionDate
                ? new Date(auction.auctionDate).toLocaleDateString("en-GB")
                : "—"}
            </td>
            <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
              <span className="mr-1.5" title={auctionTypeLabel(auction.auctionType)}>{auctionTypeEmoji(auction.auctionType)}</span>
              {auction.auctionType}
            </td>
            <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{auction.lots}</td>
            {(["catalogued", "addedToBC", "photography", "aiRan"] as const).map(f => (
              <td key={f} className="px-4 py-3 text-center">
                {auction[f]
                  ? <span className="text-green-400 font-bold">✓</span>
                  : <span className="text-gray-600">—</span>}
              </td>
            ))}
            <td className="px-4 py-3 text-center">
              <CompleteToggle id={auction.id} complete={auction.complete} />
            </td>
            <td className="px-4 py-3 text-right">
              {auction.notes ? <AuctionNotesButton notes={auction.notes} auctionName={auction.name} /> : <span className="text-gray-600">—</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function AuctionsTables({ active, completed }: { active: AuctionRow[]; completed: AuctionRow[] }) {
  const [search, setSearch] = useState("")
  const [type, setType] = useState("ALL")
  const [status, setStatus] = useState("ALL")

  const filteredActive    = useMemo(() => active.filter(r => matches(r, search, type, status)),    [active, search, type, status])
  const filteredCompleted = useMemo(() => completed.filter(r => matches(r, search, type, status)), [completed, search, type, status])

  const hasFilter = !!search || type !== "ALL" || status !== "ALL"

  const selectCls = "rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E] px-3 py-2 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]"

  return (
    <>
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
        <select value={status} onChange={e => setStatus(e.target.value)} className={selectCls}>
          {STATUS_FILTERS.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        {hasFilter && (
          <button
            onClick={() => { setSearch(""); setType("ALL"); setStatus("ALL") }}
            className="text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#2C2C2E] transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Active auctions */}
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
        Active Auctions{hasFilter && ` (${filteredActive.length})`}
      </h2>
      <div className="bg-white dark:bg-[#1C1C1E] rounded-xl border border-gray-300 dark:border-gray-700 overflow-hidden mb-8">
        {filteredActive.length === 0 ? (
          <div className="text-center py-10 text-gray-600 dark:text-gray-500 text-sm">
            {hasFilter
              ? "No active auctions match your filters."
              : "No active auctions. Create one, or tick Complete to bring one back here."}
          </div>
        ) : (
          <AuctionTable rows={filteredActive} />
        )}
      </div>

      {/* Completed auctions */}
      {completed.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Completed Auctions{hasFilter && ` (${filteredCompleted.length})`}
          </h2>
          <div className="bg-white dark:bg-[#1C1C1E] rounded-xl border border-gray-300 dark:border-gray-700 overflow-hidden opacity-80">
            {filteredCompleted.length === 0 ? (
              <div className="text-center py-10 text-gray-600 dark:text-gray-500 text-sm">
                No completed auctions match your filters.
              </div>
            ) : (
              <AuctionTable rows={filteredCompleted} />
            )}
          </div>
        </>
      )}
    </>
  )
}
