"use client"

import { useState, useMemo } from "react"
import { format } from "date-fns"
import { useRouter } from "next/navigation"

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
    <div className="px-5 py-3 flex flex-wrap items-center gap-3 border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50">
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500 dark:text-gray-400 font-medium whitespace-nowrap">From</label>
        <input
          type="date"
          value={fromDate}
          onChange={e => setFromDate(e.target.value)}
          className="text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-slate-300"
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500 dark:text-gray-400 font-medium whitespace-nowrap">To</label>
        <input
          type="date"
          value={toDate}
          onChange={e => setToDate(e.target.value)}
          className="text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-slate-300"
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
      <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">
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
  LOTTING_UP:               { label: "Lotting Up",        colour: "bg-blue-100 text-blue-700 border-blue-200",   icon: "📦", idleColour: "#3b82f6" },
  LUNCH_BREAK:              { label: "Lunch Break",        colour: "bg-amber-100 text-amber-700 border-amber-200", icon: "🍽️", idleColour: "#f59e0b" },
  CLERKING:                 { label: "Clerking",           colour: "bg-purple-100 text-purple-700 border-purple-200", icon: "🔨", idleColour: "#9333ea" },
  DEALING_WITH_CUSTOMERS:   { label: "With Customers",     colour: "bg-green-100 text-green-700 border-green-200",   icon: "🤝", idleColour: "#22c55e" },
  VALUATIONS:               { label: "Valuations",         colour: "bg-rose-100 text-rose-700 border-rose-200",      icon: "💰", idleColour: "#f43f5e" },
  OTHER:                    { label: "Other",               colour: "bg-gray-100 text-gray-600 border-gray-200",    icon: "📝", idleColour: "#9ca3af" },
}

const WORK_START_HOUR = 9
const WORK_DAY_MS     = 8 * 60 * 60 * 1000  // 9am–5pm

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

  // Workday: 9am–5pm, Mon–Fri
  const now        = new Date()
  const workStart  = new Date(now); workStart.setHours(WORK_START_HOUR, 0, 0, 0)
  const isWeekend  = now.getDay() === 0 || now.getDay() === 6
  const expectedMs = isWeekend ? 0 : Math.max(0, Math.min(now.getTime() - workStart.getTime(), WORK_DAY_MS))

  const totalTrackedMs = activeMs + totalIdleMs
  const unaccountedMs  = Math.max(0, expectedMs - totalTrackedMs)
  const totalVisibleMs = totalTrackedMs + unaccountedMs  // max(tracked, expected)

  const activePct      = totalVisibleMs > 0 ? (activeMs       / totalVisibleMs) * 100 : 0
  const idlePct        = totalVisibleMs > 0 ? (totalIdleMs    / totalVisibleMs) * 100 : 0
  const unaccPct       = totalVisibleMs > 0 ? (unaccountedMs  / totalVisibleMs) * 100 : 0

  // Group idle sessions by reason for the breakdown
  const byReason = Object.entries(REASON_CONFIG).map(([key, cfg]) => {
    const sessions = idleSessions.filter(s => s.reason === key)
    const totalMs  = sessions.reduce((s, l) => s + l.durationMs, 0)
    return { key, cfg, sessions, totalMs }
  }).filter(r => r.sessions.length > 0)

  const noData = totalVisibleMs === 0 && activeMs === 0 && totalIdleMs === 0

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider">Today's Productivity</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{format(new Date(), "EEEE d MMMM yyyy")}</p>
        </div>
        {!noData && (
          <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" />
              Active cataloguing
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-400" />
              Idle time
            </span>
            {(unaccountedMs > 0 || expectedMs > 0) && (
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-gray-300" />
                Unaccounted
              </span>
            )}
          </div>
        )}
      </div>

      {noData ? (
        <div className="px-5 py-8 text-center text-gray-400">
          <p className="text-sm">No activity recorded today yet.</p>
          {!isWeekend && expectedMs === 0 && (
            <p className="text-xs mt-1">Work day starts at 9:00am.</p>
          )}
        </div>
      ) : (
        <div className="px-5 py-5 space-y-5">

          {/* Split bar */}
          <div className="space-y-2">
            <div className="flex rounded-full overflow-hidden h-5 bg-gray-100 dark:bg-gray-700">
              {activePct > 0 && (
                <div
                  className="h-full bg-emerald-500 transition-all flex items-center justify-center"
                  style={{ width: `${activePct}%` }}
                >
                  {activePct > 10 && <span className="text-white text-xs font-bold">{Math.round(activePct)}%</span>}
                </div>
              )}
              {idlePct > 0 && (
                <div
                  className="h-full bg-orange-400 transition-all flex items-center justify-center"
                  style={{ width: `${idlePct}%` }}
                >
                  {idlePct > 10 && <span className="text-white text-xs font-bold">{Math.round(idlePct)}%</span>}
                </div>
              )}
              {unaccPct > 0 && (
                <div
                  className="h-full bg-gray-300 transition-all flex items-center justify-center"
                  style={{ width: `${unaccPct}%` }}
                >
                  {unaccPct > 10 && <span className="text-gray-600 text-xs font-bold">{Math.round(unaccPct)}%</span>}
                </div>
              )}
            </div>

            {/* Totals row */}
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-emerald-600 font-mono">{fmtDuration(activeMs)}</span>
                <span className="text-xs text-gray-400 dark:text-gray-500">on lots ({lotsCount} created)</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-orange-500 font-mono">{fmtDuration(totalIdleMs)}</span>
                <span className="text-xs text-gray-400 dark:text-gray-500">idle ({idleSessions.length} session{idleSessions.length !== 1 ? "s" : ""})</span>
              </div>
              {unaccountedMs > 0 && (
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-gray-400 font-mono">{fmtDuration(unaccountedMs)}</span>
                  <span className="text-xs text-gray-400">unaccounted</span>
                </div>
              )}
            </div>

            {/* Expected workday context */}
            {!isWeekend && expectedMs > 0 && (
              <p className="text-xs text-gray-400">
                Based on a 9am–5pm workday ·{" "}
                <span className={totalTrackedMs >= expectedMs ? "text-emerald-600 font-semibold" : "text-gray-400"}>
                  {Math.min(100, Math.round((totalTrackedMs / expectedMs) * 100))}% of expected time accounted for
                </span>
              </p>
            )}
          </div>

          {/* Idle breakdown */}
          {byReason.length > 0 && (
            <div className="border-t border-gray-100 dark:border-gray-700 pt-4 space-y-3">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Idle Breakdown</p>
              {byReason.map(({ key, cfg, sessions, totalMs: reasonMs }) => (
                <div key={key} className="space-y-1.5">
                  {/* Reason header */}
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold border ${cfg.colour}`}>
                      {cfg.icon} {cfg.label}
                    </span>
                    <span className="font-mono font-bold text-sm text-gray-700 dark:text-gray-300">{fmtDuration(reasonMs)}</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      ({sessions.length} session{sessions.length !== 1 ? "s" : ""})
                    </span>
                  </div>

                  {/* Per-session detail */}
                  <div className="ml-2 space-y-1">
                    {sessions.map((s, i) => (
                      <div key={i} className="flex items-start gap-3 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
                        <span className="text-gray-400 dark:text-gray-500 font-mono whitespace-nowrap shrink-0">
                          {format(new Date(s.startedAt), "HH:mm")}
                        </span>
                        <span className="font-mono font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap shrink-0">
                          {fmtDuration(s.durationMs)}
                        </span>
                        {s.toteNumbers && (
                          <span className="text-blue-600">
                            Totes: <span className="font-mono font-semibold">{s.toteNumbers}</span>
                          </span>
                        )}
                        {s.notes && (
                          <span className="text-gray-500 italic break-words">
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
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        <span className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
          All Lots in Period
          <span className="ml-2 font-normal normal-case text-gray-400 dark:text-gray-500 text-xs">
            ({logs.length} total)
          </span>
        </span>
        <span className="text-gray-400 dark:text-gray-500 text-sm select-none">{open ? "▲ Collapse" : "▼ Expand"}</span>
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
                <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                  <th className="text-left px-5 py-3">Date / Time</th>
                  <th className="text-left px-5 py-3">Auction</th>
                  <th className="text-left px-5 py-3">Lot / Barcode</th>
                  <th className="text-left px-5 py-3">Method</th>
                  <th className="text-right px-5 py-3">Key Points</th>
                  <th className="text-right px-5 py-3">Total Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-gray-400 dark:text-gray-500 text-xs">
                      No lots match the selected date range.
                    </td>
                  </tr>
                ) : filtered.map(log => (
                  <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="px-5 py-3 text-gray-400 dark:text-gray-500 text-xs whitespace-nowrap font-mono">
                      {format(new Date(log.savedAt), "dd/MM/yyyy HH:mm:ss")}
                    </td>
                    <td className="px-5 py-3 font-mono text-slate-600 dark:text-gray-300 text-xs">{log.auctionCode}</td>
                    <td className="px-5 py-3 font-mono text-gray-500 dark:text-gray-400 text-xs">{log.lotNumber || "—"}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                        log.method === "WIZARD"
                          ? "bg-blue-50 text-blue-600 border border-blue-100"
                          : "bg-purple-50 text-purple-600 border border-purple-100"
                      }`}>
                        {log.method === "WIZARD" ? "Wizard" : "Photo Only"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-gray-500 dark:text-gray-400 text-xs">
                      {log.method === "WIZARD" ? fmtDuration(log.keyPointsMs) : "—"}
                    </td>
                    <td className="px-5 py-3 text-right font-mono font-bold text-gray-700 dark:text-gray-200">
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

// ─── Expandable Notes Cell ────────────────────────────────────────────────────

function NotesCell({ notes, excluded }: { notes: string | null; excluded: boolean }) {
  const [expanded, setExpanded] = useState(false)
  if (excluded) return <span className="italic text-gray-400">Excluded — over 10 hours</span>
  if (!notes) return <span className="text-gray-300">—</span>
  const LIMIT = 80
  const isLong = notes.length > LIMIT
  return (
    <span>
      <span className="text-gray-500">
        &ldquo;{expanded || !isLong ? notes : `${notes.slice(0, LIMIT)}…`}&rdquo;
      </span>
      {isLong && (
        <button
          onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
          className="ml-1 text-[#2AB4A6] hover:text-[#25a396] text-xs underline whitespace-nowrap"
        >
          {expanded ? "less" : "more"}
        </button>
      )}
    </span>
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

  const totalIdleMs   = counted.reduce((s, l) => s + l.idleDurationMs, 0)
  const reasonCounts  = counted.reduce<Record<string, number>>((acc, l) => {
    acc[l.reason] = (acc[l.reason] ?? 0) + 1
    return acc
  }, {})

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
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        <span className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
          Idle Time
          <span className="ml-2 font-normal normal-case text-gray-400 dark:text-gray-500 text-xs">
            ({logs.length} session{logs.length !== 1 ? "s" : ""})
          </span>
        </span>
        <span className="text-gray-400 dark:text-gray-500 text-sm select-none">{open ? "▲ Collapse" : "▼ Expand"}</span>
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
                {Object.entries(reasonCounts).map(([reason, count], i, arr) => {
                  const cfg = REASON_CONFIG[reason]
                  const label = cfg?.label ?? reason.replace(/_/g, " ").toLowerCase()
                  return `${count} ${label.toLowerCase()}${i < arr.length - 1 ? " · " : ""}`
                }).join("")}
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
                <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                  <th className="text-left px-5 py-3">Date / Time</th>
                  <th className="text-left px-5 py-3">Auction</th>
                  <th className="text-left px-5 py-3">Reason</th>
                  <th className="text-left px-5 py-3">Tote Numbers</th>
                  <th className="text-left px-5 py-3">Notes</th>
                  <th className="text-right px-5 py-3">Duration</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-gray-400 dark:text-gray-500 text-xs">
                      No idle sessions match the selected date range.
                    </td>
                  </tr>
                ) : filtered.map(log => {
                  const r        = REASON_CONFIG[log.reason] ?? { label: log.reason, colour: "bg-gray-100 text-gray-500 border-gray-200", icon: "❓", idleColour: "#9ca3af" }
                  const excluded = log.idleDurationMs > MAX_IDLE_MS
                  return (
                    <tr key={log.id} className={`transition-colors ${excluded ? "opacity-40 bg-gray-50 dark:bg-gray-800" : "hover:bg-gray-50 dark:hover:bg-gray-800/50"}`}>
                      <td className="px-5 py-3 text-gray-400 dark:text-gray-500 text-xs whitespace-nowrap font-mono">
                        {format(new Date(log.idleStartedAt), "dd/MM/yyyy HH:mm:ss")}
                      </td>
                      <td className="px-5 py-3 text-xs">
                        <span className="font-mono text-slate-600 dark:text-gray-300">{log.auctionCode}</span>
                        {log.auctionName && (
                          <span className="ml-1.5 text-gray-400 dark:text-gray-500">{log.auctionName}</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold border ${r.colour}`}>
                          {r.label}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-xs text-gray-500 dark:text-gray-400 font-mono">
                        {log.toteNumbers || "—"}
                      </td>
                      <td className="px-5 py-3 text-xs max-w-[260px]">
                        <NotesCell notes={log.notes} excluded={excluded} />
                      </td>
                      <td className="px-5 py-3 text-right font-mono font-bold text-orange-600">
                        {fmtDuration(log.idleDurationMs)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          onClick={() => handleDelete(log.id)}
                          disabled={deleting === log.id}
                          className="text-gray-300 dark:text-gray-600 hover:text-red-500 transition-colors disabled:opacity-50"
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

// ─── Daily Comparison Table ───────────────────────────────────────────────────

export type DayStats = {
  date: string          // "yyyy-MM-dd"
  lots: number
  cataloguingMs: number
  idleMs: number
}

export function DailyComparisonTable({ days }: { days: DayStats[] }) {
  const todayStr   = format(new Date(), "yyyy-MM-dd")
  const nowMs      = new Date().getTime()

  function getExpectedMs(dateStr: string): number {
    const d = new Date(dateStr + "T12:00:00")
    if (d.getDay() === 0 || d.getDay() === 6) return 0  // weekend
    if (dateStr === todayStr) {
      const workStart = new Date(dateStr + "T09:00:00")
      return Math.max(0, Math.min(nowMs - workStart.getTime(), WORK_DAY_MS))
    }
    return WORK_DAY_MS
  }

  const totalCatMs   = days.reduce((s, d) => s + d.cataloguingMs, 0)
  const totalIdleMs  = days.reduce((s, d) => s + d.idleMs, 0)
  const totalUnaccMs = days.reduce((s, d) => {
    const exp = getExpectedMs(d.date)
    return s + Math.max(0, exp - d.cataloguingMs - d.idleMs)
  }, 0)
  const totalExpectedMs  = totalCatMs + totalIdleMs + totalUnaccMs
  const totalLots        = days.reduce((s, d) => s + d.lots, 0)

  const overallActPct  = totalExpectedMs > 0 ? (totalCatMs   / totalExpectedMs) * 100 : 0
  const overallIdlePct = totalExpectedMs > 0 ? (totalIdleMs  / totalExpectedMs) * 100 : 0
  const overallUnacPct = totalExpectedMs > 0 ? (totalUnaccMs / totalExpectedMs) * 100 : 0

  return (
    <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
      {/* Header + overall summary */}
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <h2 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
          Daily Breakdown
          <span className="ml-2 font-normal normal-case text-gray-400">— 9am–5pm weekday · cataloguing vs idle vs unaccounted</span>
        </h2>

        {totalExpectedMs > 0 || totalCatMs > 0 ? (
          <div className="space-y-2">
            {/* Overall split bar */}
            <div className="flex rounded-full overflow-hidden h-5 bg-gray-100 dark:bg-gray-800">
              {overallActPct > 0 && (
                <div className="h-full bg-emerald-500 flex items-center justify-center transition-all" style={{ width: `${overallActPct}%` }}>
                  {overallActPct > 8 && <span className="text-white text-xs font-bold">{Math.round(overallActPct)}%</span>}
                </div>
              )}
              {overallIdlePct > 0 && (
                <div className="h-full bg-orange-400 flex items-center justify-center transition-all" style={{ width: `${overallIdlePct}%` }}>
                  {overallIdlePct > 8 && <span className="text-white text-xs font-bold">{Math.round(overallIdlePct)}%</span>}
                </div>
              )}
              {overallUnacPct > 0 && (
                <div className="h-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center transition-all" style={{ width: `${overallUnacPct}%` }}>
                  {overallUnacPct > 8 && <span className="text-gray-700 dark:text-gray-300 text-xs font-bold">{Math.round(overallUnacPct)}%</span>}
                </div>
              )}
            </div>
            {/* Totals */}
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                <span className="font-bold text-emerald-600 font-mono">{fmtDuration(totalCatMs)}</span>
                <span className="text-gray-400">cataloguing · {Math.round(overallActPct)}% · {totalLots} lots</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-400 shrink-0" />
                <span className="font-bold text-orange-500 font-mono">{fmtDuration(totalIdleMs)}</span>
                <span className="text-gray-400">idle · {Math.round(overallIdlePct)}%</span>
              </span>
              {totalUnaccMs > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-gray-300 dark:bg-gray-600 shrink-0" />
                  <span className="font-bold text-gray-400 font-mono">{fmtDuration(totalUnaccMs)}</span>
                  <span className="text-gray-400">unaccounted · {Math.round(overallUnacPct)}%</span>
                </span>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-400">No tracked time data in this period.</p>
        )}
      </div>

      {days.length === 0 ? (
        <p className="px-5 py-8 text-center text-gray-400 text-sm">No days with recorded activity in this period.</p>
      ) : (
        <div className="overflow-y-auto max-h-[520px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-[#141416] text-xs text-gray-400 uppercase tracking-wider">
                <th className="text-left px-5 py-3">Date</th>
                <th className="text-right px-5 py-3">Lots</th>
                <th className="text-right px-5 py-3">Cataloguing</th>
                <th className="text-right px-5 py-3">Idle</th>
                <th className="text-right px-5 py-3">Unaccounted</th>
                <th className="px-5 py-3 min-w-[120px]">Split</th>
                <th className="text-right px-5 py-3">Accounted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800/60">
              {days.map(day => {
                const expectedMs   = getExpectedMs(day.date)
                const unaccMs      = Math.max(0, expectedMs - day.cataloguingMs - day.idleMs)
                const totalDayMs   = day.cataloguingMs + day.idleMs + unaccMs
                const isWeekend    = new Date(day.date + "T12:00:00").getDay() === 0 || new Date(day.date + "T12:00:00").getDay() === 6
                const catPct       = totalDayMs > 0 ? (day.cataloguingMs / totalDayMs) * 100 : 0
                const idlPct       = totalDayMs > 0 ? (day.idleMs        / totalDayMs) * 100 : 0
                const unacPct      = totalDayMs > 0 ? (unaccMs           / totalDayMs) * 100 : 0
                const accountedPct = expectedMs > 0  ? Math.min(100, Math.round(((day.cataloguingMs + day.idleMs) / expectedMs) * 100)) : null

                return (
                  <tr key={day.date} className={`hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors ${isWeekend ? "opacity-60" : ""}`}>
                    <td className="px-5 py-3 text-xs font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {format(new Date(day.date + "T12:00:00"), "EEE dd MMM yyyy")}
                      {isWeekend && <span className="ml-1.5 text-gray-400 font-sans not-italic">(weekend)</span>}
                    </td>
                    <td className="px-5 py-3 text-right font-bold text-gray-800 dark:text-white tabular-nums">
                      {day.lots || <span className="text-gray-300 dark:text-gray-700">—</span>}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-emerald-600">
                      {day.cataloguingMs > 0 ? fmtDuration(day.cataloguingMs) : <span className="text-gray-300 dark:text-gray-700">—</span>}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-orange-500">
                      {day.idleMs > 0 ? fmtDuration(day.idleMs) : <span className="text-gray-300 dark:text-gray-700">—</span>}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-gray-400">
                      {isWeekend ? <span className="text-gray-300 dark:text-gray-700">—</span> : unaccMs > 0 ? fmtDuration(unaccMs) : <span className="text-emerald-500 font-semibold text-xs">✓ fully accounted</span>}
                    </td>
                    <td className="px-5 py-3">
                      {totalDayMs > 0 ? (
                        <div className="flex rounded-full overflow-hidden h-3 bg-gray-100 dark:bg-gray-800 min-w-[80px]">
                          {catPct  > 0 && <div className="h-full bg-emerald-500" style={{ width: `${catPct}%`  }} />}
                          {idlPct  > 0 && <div className="h-full bg-orange-400" style={{ width: `${idlPct}%`  }} />}
                          {unacPct > 0 && <div className="h-full bg-gray-300 dark:bg-gray-600" style={{ width: `${unacPct}%` }} />}
                        </div>
                      ) : (
                        <div className="h-3 rounded-full bg-gray-100 dark:bg-gray-800" />
                      )}
                    </td>
                    <td className="px-5 py-3 text-right text-xs tabular-nums">
                      {accountedPct !== null ? (
                        <span className={`font-bold ${accountedPct >= 80 ? "text-emerald-600" : accountedPct >= 50 ? "text-amber-500" : "text-red-400"}`}>
                          {accountedPct}%
                        </span>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-700">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Custom Date Range Picker ─────────────────────────────────────────────────

export function CustomRangePicker({
  userId,
  currentFrom,
  currentTo,
}: {
  userId:      string
  currentFrom: string
  currentTo:   string
}) {
  const router   = useRouter()
  const [from, setFrom] = useState(currentFrom)
  const [to,   setTo  ] = useState(currentTo)
  const isActive = !!(currentFrom || currentTo)

  function apply() {
    const params = new URLSearchParams()
    if (from) params.set("from", from)
    if (to)   params.set("to",   to)
    router.push(`/tools/reports/${encodeURIComponent(userId)}?${params.toString()}`)
  }

  function clearCustom() {
    setFrom("")
    setTo("")
    router.push(`/tools/reports/${encodeURIComponent(userId)}?range=30d`)
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
      isActive
        ? "border-[#2AB4A6] bg-[#2AB4A6]/10"
        : "border-gray-700 hover:border-gray-500"
    }`}>
      <span className="text-xs text-gray-400 whitespace-nowrap font-medium">Custom:</span>
      <input
        type="date"
        value={from}
        onChange={e => setFrom(e.target.value)}
        className="text-xs bg-transparent border border-gray-700 rounded px-2 py-1 text-gray-300 focus:outline-none focus:border-[#2AB4A6] [color-scheme:dark]"
      />
      <span className="text-xs text-gray-500">→</span>
      <input
        type="date"
        value={to}
        onChange={e => setTo(e.target.value)}
        className="text-xs bg-transparent border border-gray-700 rounded px-2 py-1 text-gray-300 focus:outline-none focus:border-[#2AB4A6] [color-scheme:dark]"
      />
      <button
        onClick={apply}
        className="text-xs px-2.5 py-1 bg-[#2AB4A6] text-white rounded hover:bg-[#25a396] transition-colors font-semibold"
      >
        Apply
      </button>
      {isActive && (
        <button
          onClick={clearCustom}
          className="text-xs text-red-400 hover:text-red-300 transition-colors font-medium"
        >
          Clear
        </button>
      )}
    </div>
  )
}

// ─── Today's Timeline ─────────────────────────────────────────────────────────

export type TodayLot = {
  savedAt:    string   // ISO string
  durationMs: number
  method:     string
  lotNumber:  string | null
}

export function TodayTimeline({
  lots,
  idleSessions,
}: {
  lots:         TodayLot[]
  idleSessions: TodayIdleSession[]
}) {
  const now         = new Date()
  const todayStr    = format(now, "yyyy-MM-dd")
  const workStartMs = new Date(`${todayStr}T09:00:00`).getTime()
  const workEndMs   = new Date(`${todayStr}T17:00:00`).getTime()
  const totalWorkMs = workEndMs - workStartMs        // 8 hours
  const isWeekend   = now.getDay() === 0 || now.getDay() === 6
  const nowMs       = now.getTime()
  const isInWork    = nowMs >= workStartMs && nowMs <= workEndMs
  const nowPct      = Math.max(0, Math.min(100, ((nowMs - workStartMs) / totalWorkMs) * 100))

  function toPct(ms: number) {
    return Math.max(0, Math.min(100, ((ms - workStartMs) / totalWorkMs) * 100))
  }
  function toWidthPct(durationMs: number) {
    return Math.max(0.5, (durationMs / totalWorkMs) * 100)
  }

  const hourLabels = [
    { label: "9am",  pct: 0     },
    { label: "10am", pct: 12.5  },
    { label: "11am", pct: 25    },
    { label: "12pm", pct: 37.5  },
    { label: "1pm",  pct: 50    },
    { label: "2pm",  pct: 62.5  },
    { label: "3pm",  pct: 75    },
    { label: "4pm",  pct: 87.5  },
    { label: "5pm",  pct: 100   },
  ]

  const hasWizard    = lots.some(l => l.method === "WIZARD")
  const hasPhotoOnly = lots.some(l => l.method !== "WIZARD")
  const hasIdle      = idleSessions.length > 0

  return (
    <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <h2 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          Today's Timeline
          <span className="ml-2 font-normal normal-case text-gray-400">9:00am – 5:00pm workday</span>
        </h2>
      </div>

      <div className="px-5 py-5">
        {isWeekend ? (
          <p className="text-sm text-gray-400 text-center py-3">No working day today (weekend).</p>
        ) : (
          <div className="space-y-1">

            {/* Tick lines behind the track */}
            <div className="relative">
              {/* Hour tick marks */}
              <div className="absolute inset-0 flex">
                {hourLabels.map(({ pct }) => (
                  <div
                    key={pct}
                    className="absolute top-0 bottom-0 w-px bg-gray-200 dark:bg-gray-700/60"
                    style={{ left: `${pct}%` }}
                  />
                ))}
              </div>

              {/* Main track */}
              <div className="relative h-12 bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden">

                {/* Idle sessions — orange bars */}
                {idleSessions.map((session, i) => {
                  const startMs = new Date(session.startedAt).getTime()
                  const left    = toPct(startMs)
                  const width   = Math.min(toWidthPct(session.durationMs), 100 - left)
                  if (left >= 100 || width <= 0) return null
                  const cfg = REASON_CONFIG[session.reason]
                  return (
                    <div
                      key={i}
                      className="absolute top-0 h-full bg-orange-400/75 hover:bg-orange-400 transition-colors cursor-default"
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={`${cfg?.label ?? session.reason} · ${fmtDuration(session.durationMs)} · from ${format(new Date(session.startedAt), "HH:mm")}${session.notes ? ` · "${session.notes}"` : ""}`}
                    />
                  )
                })}

                {/* Lot marks — vertical lines at creation time */}
                {lots.map((lot, i) => {
                  const left = toPct(new Date(lot.savedAt).getTime())
                  if (left < 0 || left > 100) return null
                  const isWizard = lot.method === "WIZARD"
                  return (
                    <div
                      key={i}
                      className={`absolute top-0 h-full w-[3px] opacity-90 hover:opacity-100 transition-opacity cursor-default ${isWizard ? "bg-emerald-500" : "bg-purple-500"}`}
                      style={{ left: `${left}%` }}
                      title={`Lot ${lot.lotNumber || "—"} · ${isWizard ? "Wizard" : "Photo Only"} · ${fmtDuration(lot.durationMs)} · saved ${format(new Date(lot.savedAt), "HH:mm:ss")}`}
                    />
                  )
                })}

                {/* Now indicator */}
                {isInWork && (
                  <div
                    className="absolute top-0 h-full w-[2px] bg-white/90 z-10 shadow-sm"
                    style={{ left: `${nowPct}%` }}
                  />
                )}
              </div>
            </div>

            {/* Hour labels */}
            <div className="relative h-5 mt-0.5">
              {hourLabels.map(({ label, pct }) => (
                <span
                  key={label}
                  className={`absolute text-[10px] text-gray-400 whitespace-nowrap ${pct === 0 ? "" : pct === 100 ? "-translate-x-full" : "-translate-x-1/2"}`}
                  style={{ left: `${pct}%` }}
                >
                  {label}
                </span>
              ))}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-x-5 gap-y-1 pt-2 text-xs text-gray-500 dark:text-gray-400">
              {hasWizard && (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-[3px] h-3.5 bg-emerald-500 rounded-full" />
                  Wizard lot
                </span>
              )}
              {hasPhotoOnly && (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-[3px] h-3.5 bg-purple-500 rounded-full" />
                  Photo Only lot
                </span>
              )}
              {hasIdle && (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-4 h-3 rounded-sm bg-orange-400/75" />
                  Idle
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-4 h-3 rounded-sm bg-gray-200 dark:bg-gray-700" />
                Unaccounted
              </span>
              {isInWork && (
                <span className="flex items-center gap-1.5 ml-auto">
                  <span className="inline-block w-[2px] h-3.5 bg-white/90 border border-gray-300 dark:border-gray-600 rounded-full" />
                  <span className="text-gray-400">Now — {format(now, "HH:mm")}</span>
                </span>
              )}
            </div>

            {lots.length === 0 && idleSessions.length === 0 && (
              <p className="text-xs text-gray-400 text-center pt-1">No lots or idle sessions recorded yet today.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
