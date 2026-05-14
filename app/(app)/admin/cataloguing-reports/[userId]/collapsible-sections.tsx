"use client"

import { useState, useMemo } from "react"
import { format } from "date-fns"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "—"
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function inDateRange(isoString: string, fromDate: string, toDate: string): boolean {
  const ts = new Date(isoString).getTime()
  if (fromDate && ts < new Date(fromDate).getTime()) return false
  if (toDate   && ts > new Date(toDate + "T23:59:59.999").getTime()) return false
  return true
}

function DateFilters({
  fromDate, toDate,
  setFromDate, setToDate,
  count, total,
}: {
  fromDate: string; toDate: string
  setFromDate: (v: string) => void; setToDate: (v: string) => void
  count: number; total: number
}) {
  return (
    <div className="px-5 py-3 flex flex-wrap items-center gap-3 border-t border-gray-100 bg-gray-50/50">
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500 font-medium whitespace-nowrap">From</label>
        <input
          type="date"
          value={fromDate}
          onChange={e => setFromDate(e.target.value)}
          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500 font-medium whitespace-nowrap">To</label>
        <input
          type="date"
          value={toDate}
          onChange={e => setToDate(e.target.value)}
          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
        />
      </div>
      {(fromDate || toDate) && (
        <button
          onClick={() => { setFromDate(""); setToDate("") }}
          className="text-xs text-red-400 hover:text-red-600 font-medium transition-colors"
        >
          Clear
        </button>
      )}
      <span className="text-xs text-gray-400 ml-auto">
        {count !== total ? `${count} of ${total}` : count} record{count !== 1 ? "s" : ""}
      </span>
    </div>
  )
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type SerialLotLog = {
  id: string
  savedAt: string
  auctionCode: string
  lotNumber: string | null
  method: string
  keyPointsMs: number | null
  durationMs: number
}

export type SerialIdleLog = {
  id: string
  idleStartedAt: string
  idleDurationMs: number
  reason: string
  toteNumbers: string | null
  notes: string | null
  auctionName: string
  auctionCode: string
}

// ─── Collapsible Lots Table ───────────────────────────────────────────────────

export function CollapsibleLotsTable({ logs }: { logs: SerialLotLog[] }) {
  const [open, setOpen]         = useState(false)
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate]     = useState("")

  const filtered = useMemo(
    () => logs.filter(l => inDateRange(l.savedAt, fromDate, toDate)),
    [logs, fromDate, toDate],
  )

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="text-sm font-bold text-gray-700 uppercase tracking-wider">
          All Lots in Period
          <span className="ml-2 font-normal normal-case text-gray-400 text-xs">
            ({logs.length} total)
          </span>
        </span>
        <span className="text-gray-400 text-sm select-none">{open ? "▲ Collapse" : "▼ Expand"}</span>
      </button>

      {open && (
        <>
          <DateFilters
            fromDate={fromDate} toDate={toDate}
            setFromDate={setFromDate} setToDate={setToDate}
            count={filtered.length} total={logs.length}
          />

          <div className="overflow-y-auto max-h-[420px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-400 uppercase tracking-wider">
                  <th className="text-left px-5 py-3">Date / Time</th>
                  <th className="text-left px-5 py-3">Auction</th>
                  <th className="text-left px-5 py-3">Lot / Barcode</th>
                  <th className="text-left px-5 py-3">Method</th>
                  <th className="text-right px-5 py-3">Key Points</th>
                  <th className="text-right px-5 py-3">Total Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-gray-400 text-xs">
                      No lots match the selected date range.
                    </td>
                  </tr>
                ) : filtered.map(log => (
                  <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 text-gray-400 text-xs whitespace-nowrap font-mono">
                      {format(new Date(log.savedAt), "dd/MM/yyyy HH:mm:ss")}
                    </td>
                    <td className="px-5 py-3 font-mono text-slate-600 text-xs">{log.auctionCode}</td>
                    <td className="px-5 py-3 font-mono text-gray-500 text-xs">{log.lotNumber || "—"}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                        log.method === "WIZARD"
                          ? "bg-blue-50 text-blue-600 border border-blue-100"
                          : "bg-purple-50 text-purple-600 border border-purple-100"
                      }`}>
                        {log.method === "WIZARD" ? "Wizard" : "Photo Only"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-gray-500 text-xs">
                      {log.method === "WIZARD" ? fmtDuration(log.keyPointsMs) : "—"}
                    </td>
                    <td className="px-5 py-3 text-right font-mono font-bold text-gray-700">
                      {fmtDuration(log.durationMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Collapsible Idle Time Table ──────────────────────────────────────────────

const REASON_LABEL: Record<string, { label: string; colour: string }> = {
  LUNCH_BREAK: { label: "Lunch Break", colour: "bg-amber-50 text-amber-600 border-amber-100" },
  LOTTING_UP:  { label: "Lotting Up",  colour: "bg-green-50 text-green-600 border-green-100"  },
  OTHER:       { label: "Other",       colour: "bg-gray-100 text-gray-500 border-gray-200"    },
}

export function CollapsibleIdleTable({ logs }: { logs: SerialIdleLog[] }) {
  const [open, setOpen]         = useState(false)
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate]     = useState("")

  const filtered = useMemo(
    () => logs.filter(l => inDateRange(l.idleStartedAt, fromDate, toDate)),
    [logs, fromDate, toDate],
  )

  const totalIdleMs = filtered.reduce((s, l) => s + l.idleDurationMs, 0)

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="text-sm font-bold text-gray-700 uppercase tracking-wider">
          Idle Time
          <span className="ml-2 font-normal normal-case text-gray-400 text-xs">
            ({logs.length} session{logs.length !== 1 ? "s" : ""})
          </span>
        </span>
        <span className="text-gray-400 text-sm select-none">{open ? "▲ Collapse" : "▼ Expand"}</span>
      </button>

      {open && (
        <>
          <DateFilters
            fromDate={fromDate} toDate={toDate}
            setFromDate={setFromDate} setToDate={setToDate}
            count={filtered.length} total={logs.length}
          />

          {/* Summary strip */}
          {filtered.length > 0 && (
            <div className="px-5 py-2 bg-orange-50 border-t border-orange-100 flex gap-6 text-xs">
              <span className="text-orange-700 font-semibold">
                Total idle: <span className="font-bold">{fmtDuration(totalIdleMs)}</span>
              </span>
              <span className="text-orange-500">
                {filtered.filter(l => l.reason === "LUNCH_BREAK").length} lunch ·{" "}
                {filtered.filter(l => l.reason === "LOTTING_UP").length} lotting up ·{" "}
                {filtered.filter(l => l.reason === "OTHER").length} other
              </span>
            </div>
          )}

          <div className="overflow-y-auto max-h-[420px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-400 uppercase tracking-wider">
                  <th className="text-left px-5 py-3">Date / Time</th>
                  <th className="text-left px-5 py-3">Auction</th>
                  <th className="text-left px-5 py-3">Reason</th>
                  <th className="text-left px-5 py-3">Tote Numbers</th>
                  <th className="text-left px-5 py-3">Notes</th>
                  <th className="text-right px-5 py-3">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-gray-400 text-xs">
                      No idle sessions match the selected date range.
                    </td>
                  </tr>
                ) : filtered.map(log => {
                  const r = REASON_LABEL[log.reason] ?? { label: log.reason, colour: "bg-gray-100 text-gray-500 border-gray-200" }
                  return (
                    <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 text-gray-400 text-xs whitespace-nowrap font-mono">
                        {format(new Date(log.idleStartedAt), "dd/MM/yyyy HH:mm:ss")}
                      </td>
                      <td className="px-5 py-3 text-xs">
                        <span className="font-mono text-slate-600">{log.auctionCode}</span>
                        {log.auctionName && (
                          <span className="ml-1.5 text-gray-400">{log.auctionName}</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold border ${r.colour}`}>
                          {r.label}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-xs text-gray-500 font-mono">
                        {log.toteNumbers || "—"}
                      </td>
                      <td className="px-5 py-3 text-xs text-gray-500 max-w-[200px] truncate" title={log.notes ?? ""}>
                        {log.notes || "—"}
                      </td>
                      <td className="px-5 py-3 text-right font-mono font-bold text-orange-600">
                        {fmtDuration(log.idleDurationMs)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
