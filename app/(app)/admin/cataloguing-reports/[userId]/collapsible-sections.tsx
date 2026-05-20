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
  if (h > 0) return `${h}h ${m}m`
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

// ─── Today's Productivity Card ───────────────────────────────────────────────

export type TodayIdleSession = {
  reason:      string
  durationMs:  number
  toteNumbers: string | null
  notes:       string | null
  startedAt:   string
}

const REASON_CONFIG: Record<string, { label: string; colour: string; icon: string; idleColour: string }> = {
  LOTTING_UP:  { label: "Lotting Up",  colour: "bg-blue-100 text-blue-700 border-blue-200",   icon: "📦", idleColour: "#3b82f6" },
  LUNCH_BREAK: { label: "Lunch Break", colour: "bg-amber-100 text-amber-700 border-amber-200", icon: "🍽️", idleColour: "#f59e0b" },
  OTHER:       { label: "Other",       colour: "bg-gray-100 text-gray-600 border-gray-200",    icon: "📝", idleColour: "#9ca3af" },
}

export function TodayProductivityCard({
  activeMs,
  lotsCount,
  idleSessions,
}: {
  activeMs:      number
  lotsCount:     number
  idleSessions:  TodayIdleSession[]
}) {
  const totalIdleMs = idleSessions.reduce((s, l) => s + l.durationMs, 0)
  const totalMs     = activeMs + totalIdleMs
  const activePct   = totalMs > 0 ? (activeMs / totalMs) * 100 : 0
  const idlePct     = 100 - activePct

  // Group idle sessions by reason for the breakdown
  const byReason = Object.entries(REASON_CONFIG).map(([key, cfg]) => {
    const sessions = idleSessions.filter(s => s.reason === key)
    const totalMs  = sessions.reduce((s, l) => s + l.durationMs, 0)
    return { key, cfg, sessions, totalMs }
  }).filter(r => r.sessions.length > 0)

  const noData = activeMs === 0 && totalIdleMs === 0

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wider">Today's Productivity</h2>
          <p className="text-xs text-gray-400 mt-0.5">{format(new Date(), "EEEE d MMMM yyyy")}</p>
        </div>
        {!noData && (
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" />
              Active cataloguing
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-400" />
              Idle time
            </span>
          </div>
        )}
      </div>

      {noData ? (
        <div className="px-5 py-8 text-center text-gray-400">
          <p className="text-sm">No activity recorded today yet.</p>
        </div>
      ) : (
        <div className="px-5 py-5 space-y-5">

          {/* Split bar */}
          <div className="space-y-2">
            <div className="flex rounded-full overflow-hidden h-5 bg-gray-100">
              {activePct > 0 && (
                <div
                  className="h-full bg-emerald-500 transition-all flex items-center justify-center"
                  style={{ width: `${activePct}%` }}
                >
                  {activePct > 12 && (
                    <span className="text-white text-xs font-bold">{Math.round(activePct)}%</span>
                  )}
                </div>
              )}
              {idlePct > 0 && (
                <div
                  className="h-full bg-orange-400 transition-all flex items-center justify-center"
                  style={{ width: `${idlePct}%` }}
                >
                  {idlePct > 12 && (
                    <span className="text-white text-xs font-bold">{Math.round(idlePct)}%</span>
                  )}
                </div>
              )}
            </div>

            {/* Totals row */}
            <div className="flex gap-6">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-emerald-600 font-mono">{fmtDuration(activeMs)}</span>
                <span className="text-xs text-gray-400">on lots ({lotsCount} created)</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-orange-500 font-mono">{fmtDuration(totalIdleMs)}</span>
                <span className="text-xs text-gray-400">idle ({idleSessions.length} session{idleSessions.length !== 1 ? "s" : ""})</span>
              </div>
            </div>
          </div>

          {/* Idle breakdown */}
          {byReason.length > 0 && (
            <div className="border-t border-gray-100 pt-4 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Idle Breakdown</p>
              {byReason.map(({ key, cfg, sessions, totalMs: reasonMs }) => (
                <div key={key} className="space-y-1.5">
                  {/* Reason header */}
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold border ${cfg.colour}`}>
                      {cfg.icon} {cfg.label}
                    </span>
                    <span className="font-mono font-bold text-sm text-gray-700">{fmtDuration(reasonMs)}</span>
                    <span className="text-xs text-gray-400">
                      ({sessions.length} session{sessions.length !== 1 ? "s" : ""})
                    </span>
                  </div>

                  {/* Per-session detail */}
                  <div className="ml-2 space-y-1">
                    {sessions.map((s, i) => (
                      <div key={i} className="flex items-start gap-3 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                        <span className="text-gray-400 font-mono whitespace-nowrap shrink-0">
                          {format(new Date(s.startedAt), "HH:mm")}
                        </span>
                        <span className="font-mono font-semibold text-gray-700 whitespace-nowrap shrink-0">
                          {fmtDuration(s.durationMs)}
                        </span>
                        {s.toteNumbers && (
                          <span className="text-blue-600">
                            Totes: <span className="font-mono font-semibold">{s.toteNumbers}</span>
                          </span>
                        )}
                        {s.notes && (
                          <span className="text-gray-500 italic truncate" title={s.notes}>
                            "{s.notes}"
                          </span>
                        )}
                        {!s.toteNumbers && !s.notes && (
                          <span className="text-gray-300 italic">No details recorded</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
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

export function CollapsibleIdleTable({ logs: initialLogs }: { logs: SerialIdleLog[] }) {
  const [open, setOpen]         = useState(false)
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate]     = useState("")
  const [logs, setLogs]         = useState<SerialIdleLog[]>(initialLogs)
  const [deleting, setDeleting] = useState<string | null>(null)

  const MAX_IDLE_MS = 10 * 60 * 60 * 1000 // 10 hours — anything longer is likely a forgotten open device

  const filtered = useMemo(
    () => logs.filter(l => inDateRange(l.idleStartedAt, fromDate, toDate)),
    [logs, fromDate, toDate],
  )

  const skipped  = filtered.filter(l => l.idleDurationMs > MAX_IDLE_MS)
  const counted  = filtered.filter(l => l.idleDurationMs <= MAX_IDLE_MS)

  const totalIdleMs = counted.reduce((s, l) => s + l.idleDurationMs, 0)

  async function handleDelete(id: string) {
    if (!confirm("Delete this idle time entry? This cannot be undone.")) return
    setDeleting(id)
    try {
      const res = await fetch(`/api/catalogue/idle-log/${id}`, { method: "DELETE" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        alert(body.error ?? "Failed to delete entry.")
        return
      }
      setLogs(prev => prev.filter(l => l.id !== id))
    } catch {
      alert("Network error — please try again.")
    } finally {
      setDeleting(null)
    }
  }

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
          {counted.length > 0 && (
            <div className="px-5 py-2 bg-orange-50 border-t border-orange-100 flex flex-wrap gap-x-6 gap-y-1 text-xs">
              <span className="text-orange-700 font-semibold">
                Total idle: <span className="font-bold">{fmtDuration(totalIdleMs)}</span>
              </span>
              <span className="text-orange-500">
                {counted.filter(l => l.reason === "LUNCH_BREAK").length} lunch ·{" "}
                {counted.filter(l => l.reason === "LOTTING_UP").length} lotting up ·{" "}
                {counted.filter(l => l.reason === "OTHER").length} other
              </span>
              {skipped.length > 0 && (
                <span className="text-gray-400 italic ml-auto">
                  {skipped.length} entr{skipped.length === 1 ? "y" : "ies"} over 10 hours excluded (likely device left open)
                </span>
              )}
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
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-gray-400 text-xs">
                      No idle sessions match the selected date range.
                    </td>
                  </tr>
                ) : filtered.map(log => {
                  const r        = REASON_CONFIG[log.reason] ?? { label: log.reason, colour: "bg-gray-100 text-gray-500 border-gray-200", icon: "❓", idleColour: "#9ca3af" }
                  const excluded = log.idleDurationMs > MAX_IDLE_MS
                  return (
                    <tr key={log.id} className={`transition-colors ${excluded ? "opacity-40 bg-gray-50" : "hover:bg-gray-50"}`}>
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
                        {excluded ? <span className="italic">Excluded — over 10 hours</span> : (log.notes || "—")}
                      </td>
                      <td className="px-5 py-3 text-right font-mono font-bold text-orange-600">
                        {fmtDuration(log.idleDurationMs)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          onClick={() => handleDelete(log.id)}
                          disabled={deleting === log.id}
                          className="text-gray-300 hover:text-red-500 transition-colors disabled:opacity-50"
                          title="Delete entry"
                        >
                          {deleting === log.id ? "…" : "✕"}
                        </button>
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
