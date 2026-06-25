"use client"

import { useMemo, useState, useTransition } from "react"
import {
  createConditionReport,
  updateConditionReportStatus,
  setConditionReportDone,
  assignConditionReport,
  updateConditionReportDetails,
  deleteConditionReport,
  syncConditionMailboxNow,
} from "@/lib/actions/condition-reports"

// ─── Types ────────────────────────────────────────────────────────────────────

type Report = {
  id: string
  subject: string
  body: string
  fromName: string | null
  fromEmail: string | null
  status: string
  source: string
  webLink: string | null
  lotNumber: string | null
  auctionId: string | null
  auctionLabel: string | null
  auctionDate: string | null
  assignedToId: string | null
  assignedToName: string | null
  receivedLabel: string
}

type Auction = { id: string; code: string; name: string; date: string | null }
type User    = { id: string; name: string }
type Mailbox = {
  configured: boolean
  address: string
  connected: boolean
  connectedBy: string | null
  lastSyncLabel: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; cls: string }> = {
  NEW:         { label: "New",         cls: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
  IN_PROGRESS: { label: "In progress", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  DONE:        { label: "Done",        cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
}

function fmtDateLabel(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(`${iso}T12:00:00`)
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

// ─── Component ──────────────────────────────────────────────────────────────────

export default function ConditionReportsClient({
  reports, users, auctions, isAdmin, mailbox,
}: {
  reports: Report[]
  users: User[]
  auctions: Auction[]
  isAdmin: boolean
  mailbox: Mailbox
}) {
  const [isPending, start] = useTransition()
  const [search, setSearch]   = useState("")
  const [showDone, setShowDone] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  const auctionById = useMemo(() => new Map(auctions.map(a => [a.id, a])), [auctions])

  // ── Filter ──
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return reports.filter(r => {
      if (!showDone && r.status === "DONE") return false
      if (!q) return true
      return [r.subject, r.body, r.fromName, r.fromEmail, r.lotNumber, r.auctionLabel]
        .some(v => (v ?? "").toLowerCase().includes(q))
    })
  }, [reports, search, showDone])

  // ── Group by auction ──
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; title: string; sub: string | null; date: string | null; items: Report[] }>()
    for (const r of filtered) {
      let key: string, title: string, sub: string | null, date: string | null
      if (r.auctionId && auctionById.has(r.auctionId)) {
        const a = auctionById.get(r.auctionId)!
        key = `a:${a.id}`; title = `${a.code} — ${a.name}`; sub = a.date ? fmtDateLabel(a.date) : null; date = a.date
      } else if (r.auctionLabel) {
        key = `l:${r.auctionLabel.toLowerCase()}`; title = r.auctionLabel; sub = r.auctionDate ? fmtDateLabel(r.auctionDate) : "Not linked to an auction"; date = r.auctionDate
      } else {
        key = "none"; title = "No auction yet"; sub = "Needs an auction assigning"; date = null
      }
      if (!map.has(key)) map.set(key, { key, title, sub, date, items: [] })
      map.get(key)!.items.push(r)
    }
    // Sort: dated groups first (newest sale first), then undated, then the "none" bucket last.
    return [...map.values()].sort((a, b) => {
      if (a.key === "none") return 1
      if (b.key === "none") return -1
      if (a.date && b.date) return b.date.localeCompare(a.date)
      if (a.date) return -1
      if (b.date) return 1
      return a.title.localeCompare(b.title)
    })
  }, [filtered, auctionById])

  const activeCount = reports.filter(r => r.status !== "DONE").length

  function runSync() {
    setSyncMsg(null)
    start(async () => {
      const res = await syncConditionMailboxNow()
      if (res.ok) setSyncMsg(res.created > 0 ? `✓ ${res.created} new report${res.created === 1 ? "" : "s"}` : "✓ No new emails")
      else setSyncMsg(`⚠ ${res.error ?? "Sync failed"}`)
    })
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-[#111318]">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Conditions Reports</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Condition-report requests grouped by auction. {activeCount} active.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAdd(v => !v)}
              className="px-3 py-2 text-sm font-semibold rounded-lg bg-[#2AB4A6] text-white hover:bg-[#249b8f] transition-colors"
            >
              + Add manually
            </button>
            {isAdmin && mailbox.connected && (
              <button
                onClick={runSync}
                disabled={isPending}
                className="px-3 py-2 text-sm font-semibold rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-gray-400 dark:hover:border-gray-500 transition-colors disabled:opacity-50"
              >
                {isPending ? "Syncing…" : "↻ Sync now"}
              </button>
            )}
          </div>
        </div>

        {/* Mailbox status (admin) */}
        {isAdmin && (
          <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-4 text-sm">
            {!mailbox.configured ? (
              <p className="text-amber-500">
                Microsoft Graph isn’t configured (GRAPH_CLIENT_ID / TENANT / SECRET). The mailbox can’t be connected until those env vars are set.
              </p>
            ) : !mailbox.connected ? (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-gray-600 dark:text-gray-300">
                  Mailbox not connected yet{mailbox.address ? <> — will read <span className="font-mono">{mailbox.address}</span></> : <> — set <span className="font-mono">CONDITION_MAILBOX</span> to the inbox address</>}.
                </p>
                <a
                  href="/api/condition-mailbox/auth"
                  className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-500 transition-colors"
                >
                  Connect mailbox
                </a>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 flex-wrap text-gray-600 dark:text-gray-300">
                <p>
                  ✓ Connected{mailbox.address && <> to <span className="font-mono">{mailbox.address}</span></>}
                  {mailbox.connectedBy && <> by {mailbox.connectedBy}</>}
                  {mailbox.lastSyncLabel && <> · last sync {mailbox.lastSyncLabel}</>}
                  {!mailbox.address && <span className="text-amber-500"> · set CONDITION_MAILBOX to start polling</span>}
                </p>
                <a href="/api/condition-mailbox/auth" className="text-xs text-gray-400 hover:text-gray-200 underline">Reconnect</a>
              </div>
            )}
            {syncMsg && <p className="mt-2 text-xs text-gray-400">{syncMsg}</p>}
          </div>
        )}

        {/* Add-manual form */}
        {showAdd && (
          <AddForm auctions={auctions} onDone={() => setShowAdd(false)} start={start} />
        )}

        {/* Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search subject, sender, lot…"
            className="flex-1 min-w-[200px] text-sm border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-[#1C1C1E] text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]"
          />
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer select-none">
            <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} className="accent-[#2AB4A6]" />
            Show done
          </label>
        </div>

        {/* Groups */}
        {groups.length === 0 ? (
          <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-12 text-center">
            <p className="text-lg font-semibold text-gray-600 dark:text-gray-300 mb-1">No condition reports{showDone ? "" : " to action"}</p>
            <p className="text-sm text-gray-500">
              {mailbox.connected ? "New emails will appear here automatically." : "Connect the mailbox or add one manually to get started."}
            </p>
          </div>
        ) : (
          groups.map(g => (
            <div key={g.key} className="space-y-3">
              <div className="flex items-baseline gap-3">
                <h2 className="text-sm font-bold text-gray-900 dark:text-white">{g.title}</h2>
                {g.sub && <span className="text-xs text-gray-500">{g.sub}</span>}
                <span className="text-xs text-gray-400">{g.items.length} report{g.items.length === 1 ? "" : "s"}</span>
                <div className="flex-1 h-px bg-gray-200 dark:bg-white/5" />
              </div>
              <div className="space-y-2">
                {g.items.map(r => (
                  <ReportCard key={r.id} report={r} users={users} auctions={auctions} start={start} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ─── Report card ────────────────────────────────────────────────────────────────

function ReportCard({
  report: r, users, auctions, start,
}: {
  report: Report
  users: User[]
  auctions: Auction[]
  start: (cb: () => Promise<void>) => void
}) {
  const [open, setOpen] = useState(false)
  const [lot, setLot] = useState(r.lotNumber ?? "")
  const done = r.status === "DONE"

  function saveLot() {
    if ((lot.trim() || null) === (r.lotNumber ?? null)) return
    start(async () => { await updateConditionReportDetails(r.id, { lotNumber: lot }) })
  }

  return (
    <div className={`bg-white dark:bg-[#1C1C1E] border rounded-xl p-4 transition-colors ${done ? "border-gray-200/60 dark:border-gray-800/60 opacity-70" : "border-gray-200 dark:border-gray-800"}`}>
      <div className="flex items-start gap-3">
        {/* Done tick */}
        <input
          type="checkbox"
          checked={done}
          title={done ? "Mark not done" : "Mark done"}
          onChange={e => start(async () => { await setConditionReportDone(r.id, e.target.checked) })}
          className="mt-1 w-5 h-5 accent-emerald-500 cursor-pointer shrink-0"
        />

        <div className="flex-1 min-w-0">
          {/* Top line */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-semibold text-gray-900 dark:text-white ${done ? "line-through" : ""}`}>{r.subject}</span>
            <span className={`text-[11px] px-1.5 py-0.5 rounded border ${STATUS_META[r.status]?.cls ?? ""}`}>{STATUS_META[r.status]?.label ?? r.status}</span>
            {r.source === "MANUAL" && <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-500/15 text-gray-400 border border-gray-500/30">Manual</span>}
          </div>

          {/* Meta line */}
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {r.fromName || r.fromEmail || "Unknown sender"}
            {r.fromEmail && r.fromName && <span className="text-gray-400"> · {r.fromEmail}</span>}
            <span className="text-gray-400"> · {r.receivedLabel}</span>
          </div>

          {/* Captured fields */}
          <div className="flex items-center gap-2 flex-wrap mt-3">
            {/* Lot number */}
            <label className="flex items-center gap-1.5 text-xs text-gray-500">
              Lot
              <input
                value={lot}
                onChange={e => setLot(e.target.value)}
                onBlur={saveLot}
                onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
                placeholder="—"
                className="w-20 text-xs border border-gray-300 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-[#2AB4A6]"
              />
            </label>

            {/* Auction */}
            <select
              value={r.auctionId ?? ""}
              onChange={e => start(async () => { await updateConditionReportDetails(r.id, { auctionId: e.target.value || null }) })}
              className="text-xs border border-gray-300 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-[#2AB4A6] max-w-[240px]"
            >
              <option value="">{r.auctionLabel ? `${r.auctionLabel} (unlinked)` : "— pick auction —"}</option>
              {auctions.map(a => (
                <option key={a.id} value={a.id}>{a.code} — {a.name}{a.date ? ` (${fmtDateLabel(a.date)})` : ""}</option>
              ))}
            </select>

            {/* Date (only editable when no linked auction; linked auctions drive their own date) */}
            {!r.auctionId && (
              <input
                type="date"
                defaultValue={r.auctionDate ?? ""}
                onChange={e => start(async () => { await updateConditionReportDetails(r.id, { auctionDate: e.target.value || null }) })}
                className="text-xs border border-gray-300 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-[#2AB4A6]"
              />
            )}

            {/* Assignee */}
            <select
              value={r.assignedToId ?? ""}
              onChange={e => start(async () => { await assignConditionReport(r.id, e.target.value || null) })}
              className="text-xs border border-gray-300 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-[#2AB4A6]"
            >
              <option value="">Unassigned</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>

            {/* Status quick-set */}
            <select
              value={r.status}
              onChange={e => start(async () => { await updateConditionReportStatus(r.id, e.target.value) })}
              className="text-xs border border-gray-300 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-[#2AB4A6]"
            >
              <option value="NEW">New</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="DONE">Done</option>
            </select>
          </div>

          {/* Body toggle */}
          {(r.body || r.webLink) && (
            <div className="mt-2 flex items-center gap-3">
              {r.body && (
                <button onClick={() => setOpen(v => !v)} className="text-xs text-gray-400 hover:text-gray-200">
                  {open ? "Hide email" : "Show email"}
                </button>
              )}
              {r.webLink && (
                <a href={r.webLink} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:text-blue-300">Open in Outlook ↗</a>
              )}
            </div>
          )}
          {open && r.body && (
            <pre className="mt-2 text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap font-sans bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3 border border-gray-200 dark:border-gray-800">{r.body}</pre>
          )}
        </div>

        {/* Delete */}
        <button
          onClick={() => { if (confirm("Delete this condition report?")) start(async () => { await deleteConditionReport(r.id) }) }}
          title="Delete"
          className="text-gray-400 hover:text-red-500 text-sm shrink-0"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

// ─── Add-manual form ────────────────────────────────────────────────────────────

function AddForm({
  auctions, onDone, start,
}: {
  auctions: Auction[]
  onDone: () => void
  start: (cb: () => Promise<void>) => void
}) {
  return (
    <form
      action={(fd) => { start(async () => { await createConditionReport(fd); onDone() }) }}
      className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3"
    >
      <h2 className="text-sm font-bold text-gray-900 dark:text-white">Add a condition report</h2>
      <div className="grid sm:grid-cols-2 gap-3">
        <input name="subject" required placeholder="Subject / summary *" className="text-sm border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]" />
        <input name="lotNumber" placeholder="Lot number" className="text-sm border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]" />
        <input name="fromName" placeholder="Requester name" className="text-sm border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]" />
        <input name="fromEmail" placeholder="Requester email" className="text-sm border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]" />
        <select name="auctionId" className="text-sm border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6] sm:col-span-2">
          <option value="">— pick auction (optional) —</option>
          {auctions.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}{a.date ? ` (${fmtDateLabel(a.date)})` : ""}</option>)}
        </select>
        <textarea name="body" placeholder="Notes / request detail" rows={3} className="text-sm border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6] sm:col-span-2" />
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" className="px-4 py-2 text-sm font-semibold rounded-lg bg-[#2AB4A6] text-white hover:bg-[#249b8f] transition-colors">Add report</button>
        <button type="button" onClick={onDone} className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">Cancel</button>
      </div>
    </form>
  )
}
