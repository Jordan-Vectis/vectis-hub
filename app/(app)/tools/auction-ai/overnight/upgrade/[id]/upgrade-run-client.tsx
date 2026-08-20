"use client"

// One overnight AI Upgrade run, before/after — the morning review.
//
// The runner wrote a rewrite per lot overnight and touched nothing else; this is
// where a person reads the before/after and accepts what they want, exactly like
// the AI Upgrade tab's results list. Accepting goes through the acceptUpgradeLot
// server action (the same logged write path as the tab), which also refuses to
// overwrite a description someone has edited since the run.

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { acceptUpgradeLot, setPipelineQueuePaused, removeFromPipelineQueue, startPipelineQueueItem } from "@/lib/actions/pipeline-queue"
import { queueStatusLabel, isNotStarted } from "@/lib/pipeline-queue"
import { UPGRADE_MODE_LABEL } from "@/lib/upgrade-modes"
import { fmtWhen, statusTone } from "../../overnight-client"

const POLL_MS = 10_000

type Item = {
  id: string; code: string; status: string; stage: string
  kind: string; upgradeModes: string
  done: number; total: number; skipped: number
  model: string; fallbackModel: string
  retryAfter: string | null; startedAt: string | null; finishedAt: string | null
  lastMessage: string | null; logText: string | null; addedBy: string | null
}

type URow = {
  id: string; lotId: string; label: string
  original: string; revised: string
  status: string // done | blocked | empty
  accepted: boolean
}

type Filter = "review" | "accepted" | "problems" | "all"

export default function UpgradeRunClient({ id }: { id: string }) {
  const [item, setItem] = useState<Item | null>(null)
  const [lots, setLots] = useState<URow[]>([])
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>("review")
  const [q, setQ] = useState("")
  const [openLot, setOpenLot] = useState<string | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [acceptingAll, setAcceptingAll] = useState<{ done: number; total: number } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/auction-ai/upgrade-run?id=${encodeURIComponent(id)}`)
      const json = await res.json()
      if (json.error) { setError(json.error); return }
      setItem(json.item ?? null)
      setLots(json.lots ?? [])
    } catch { /* a dropped poll retries on the next tick */ }
    finally { setReady(true) }
  }, [id])

  useEffect(() => {
    load()
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [load])

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) {
    setBusy(true); setError(null); setNotice(null)
    try {
      const res = await fn()
      if (!res.ok) { setError(res.error ?? "Something went wrong"); return }
      if (okMsg) setNotice(okMsg)
      await load()
    } catch (e: any) {
      setError(e?.message ?? "Couldn't reach the server")
    } finally { setBusy(false) }
  }

  async function acceptOne(row: URow) {
    setBusy(true); setError(null); setNotice(null)
    try {
      const res = await acceptUpgradeLot(row.id)
      if (!res.ok) setError(`${row.label}: ${res.error ?? "couldn't accept"}`)
      else setLots(prev => prev.map(l => l.id === row.id ? { ...l, accepted: true } : l))
    } catch (e: any) {
      setError(e?.message ?? "Couldn't reach the server")
    } finally { setBusy(false) }
  }

  // Client-side loop like the tab's Accept All, so a big sale shows progress and a
  // single refusal (e.g. "edited since the rewrite") doesn't stop the rest.
  async function acceptAll() {
    const toAccept = lots.filter(l => l.status === "done" && !l.accepted && l.revised.trim())
    if (toAccept.length === 0) return
    setBusy(true); setError(null); setNotice(null)
    setAcceptingAll({ done: 0, total: toAccept.length })
    const failures: string[] = []
    let doneCount = 0
    for (const row of toAccept) {
      try {
        const res = await acceptUpgradeLot(row.id)
        if (res.ok) setLots(prev => prev.map(l => l.id === row.id ? { ...l, accepted: true } : l))
        else failures.push(`${row.label} — ${res.error ?? "couldn't accept"}`)
      } catch (e: any) {
        failures.push(`${row.label} — ${e?.message ?? "couldn't reach the server"}`)
      }
      doneCount++
      setAcceptingAll({ done: doneCount, total: toAccept.length })
    }
    setAcceptingAll(null)
    setBusy(false)
    if (failures.length > 0) setError(`${failures.length} not accepted:\n${failures.slice(0, 8).join("\n")}${failures.length > 8 ? "\n…" : ""}`)
    else setNotice(`Accepted ${toAccept.length} rewrite${toAccept.length === 1 ? "" : "s"}.`)
    await load()
  }

  const counts = useMemo(() => ({
    review:   lots.filter(l => l.status === "done" && !l.accepted && l.revised.trim()).length,
    accepted: lots.filter(l => l.accepted).length,
    problems: lots.filter(l => l.status !== "done").length,
    all:      lots.length,
  }), [lots])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return lots.filter(l => {
      if (needle && !l.label.toLowerCase().includes(needle)) return false
      switch (filter) {
        case "review":   return l.status === "done" && !l.accepted && !!l.revised.trim()
        case "accepted": return l.accepted
        case "problems": return l.status !== "done"
        default:         return true
      }
    })
  }, [lots, filter, q])

  const fresh = item ? isNotStarted({ status: item.status, startedAt: item.startedAt }) : false
  const tone = item ? statusTone(item.status, fresh) : null
  const running = item?.status === "RUNNING"
  const modeNames = (item?.upgradeModes ?? "").split(",").filter(Boolean).map(m => UPGRADE_MODE_LABEL[m] ?? m)

  if (ready && item === null) {
    return (
      <div className="p-6 lg:p-8 max-w-[1200px] mx-auto">
        <Link href="/tools/auction-ai/overnight" className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">← Overnight runs</Link>
        <p className="mt-6 text-sm text-gray-500 dark:text-gray-400">This run isn&apos;t on the queue any more — it may have been removed.</p>
      </div>
    )
  }

  return (
    <div className="p-6 lg:p-8 max-w-[1200px] mx-auto">
      <Link href="/tools/auction-ai/overnight" className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">← Overnight runs</Link>

      {!ready || !item ? (
        <p className="text-sm text-gray-400 mt-6">Loading…</p>
      ) : (
        <>
          <div className="flex items-start justify-between gap-4 flex-wrap mt-2 mb-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3 flex-wrap">
                ✨ {item.code} — AI Upgrade
                {tone && (
                  <span className={`text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${tone.chip}`}>
                    {queueStatusLabel({ status: item.status, startedAt: item.startedAt })}
                  </span>
                )}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {modeNames.join(", ") || "no options"} · rewrites held for review — nothing reaches the catalogue until you accept it
                {item.addedBy ? ` · queued by ${item.addedBy}` : ""}
              </p>
              {item.total > 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 tabular-nums">
                  {item.done} of {item.total} lots rewritten{item.skipped > 0 ? ` · ${item.skipped} refused by the AI` : ""}
                  {item.finishedAt ? ` · finished ${fmtWhen(item.finishedAt)}` : ""}
                </p>
              )}
              {item.lastMessage && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{item.lastMessage}</p>}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {item.status !== "DONE" && item.status !== "CANCELLED" && (
                fresh ? (
                  <button disabled={busy}
                    onClick={() => run(() => startPipelineQueueItem(item.id), `${item.code} started.`)}
                    className="px-4 py-2 min-h-[44px] rounded-lg text-xs font-bold bg-green-600 hover:bg-green-500 text-white disabled:opacity-40">
                    ▶ Start
                  </button>
                ) : (
                  <button disabled={busy}
                    onClick={() => run(() => setPipelineQueuePaused(item.id, item.status !== "PAUSED"))}
                    className="px-4 py-2 min-h-[44px] rounded-lg text-xs font-semibold bg-gray-100 dark:bg-[#2C2C2E] text-gray-600 dark:text-gray-300 disabled:opacity-40">
                    {item.status === "PAUSED" ? "Resume" : "Hold"}
                  </button>
                )
              )}
              {counts.review > 0 && (
                <button disabled={busy} onClick={acceptAll}
                  className="px-5 py-2 min-h-[44px] rounded-lg text-sm font-bold bg-green-600 hover:bg-green-500 text-white disabled:opacity-40">
                  {acceptingAll ? `Accepting… ${acceptingAll.done}/${acceptingAll.total}` : `✓ Accept all ${counts.review}`}
                </button>
              )}
              <button disabled={busy}
                onClick={() => {
                  if (!confirm(`Take ${item.code} off the queue?\n\nAnything already accepted stays on the lots — this removes the run and its remaining rewrites.`)) return
                  run(() => removeFromPipelineQueue(item.id), `${item.code} removed.`)
                }}
                className="px-4 py-2 min-h-[44px] rounded-lg text-xs font-semibold text-red-500 hover:text-red-700 bg-gray-100 dark:bg-[#2C2C2E] disabled:opacity-40">
                Remove
              </button>
            </div>
          </div>

          {error && <div className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 px-4 py-3 text-sm mb-3 whitespace-pre-line">{error}</div>}
          {notice && <div className="rounded-xl border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300 px-4 py-3 text-sm mb-3">{notice}</div>}
          {running && (
            <div className="rounded-xl border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300 px-4 py-3 text-sm mb-3 animate-pulse">
              Still rewriting — new lots appear here as they finish. You can start accepting already.
            </div>
          )}

          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap mb-4">
            {([["review", `Waiting for review (${counts.review})`], ["accepted", `Accepted (${counts.accepted})`], ["problems", `Refused / empty (${counts.problems})`], ["all", `All (${counts.all})`]] as const).map(([key, lbl]) => (
              <button key={key} onClick={() => setFilter(key)}
                className={`px-3 py-2 min-h-[36px] rounded-lg text-xs font-semibold ${
                  filter === key
                    ? "bg-[#C8A96E] text-black"
                    : "bg-gray-100 dark:bg-[#2C2C2E] text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"}`}>
                {lbl}
              </button>
            ))}
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a barcode…"
              className="ml-auto w-44 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#2C2C2E] px-3 py-2 text-xs text-gray-900 dark:text-white focus:outline-none focus:border-[#C8A96E]" />
            <button onClick={() => setShowLog(s => !s)}
              className="px-3 py-2 min-h-[36px] rounded-lg text-xs font-semibold bg-gray-100 dark:bg-[#2C2C2E] text-gray-600 dark:text-gray-300">
              {showLog ? "Hide log" : "Show log"}
            </button>
          </div>

          {showLog && (
            <pre className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#1C1C1E] p-4 text-[11px] leading-relaxed text-gray-600 dark:text-gray-400 overflow-x-auto max-h-72 overflow-y-auto whitespace-pre-wrap mb-4">
              {item.logText || "Nothing logged yet."}
            </pre>
          )}

          {/* Before / after */}
          {shown.length === 0 ? (
            <p className="text-sm text-gray-400 mt-6">
              {lots.length === 0
                ? (running || item.status === "QUEUED" ? "Nothing rewritten yet — the first lots appear here as they finish." : "No rewrites on this run.")
                : "Nothing matches this filter."}
            </p>
          ) : (
            <div className="space-y-3">
              {shown.map(l => {
                const open = openLot === l.id
                return (
                  <div key={l.id} className={`rounded-2xl border p-4 ${l.accepted ? "border-green-300 dark:border-green-800/70 bg-green-50/40 dark:bg-green-950/10" : "border-gray-200 dark:border-gray-800"}`}>
                    <div className="flex items-center gap-3 flex-wrap">
                      <button onClick={() => setOpenLot(open ? null : l.id)} className="font-mono font-bold text-sm text-gray-900 dark:text-white hover:underline">
                        {open ? "▾" : "▸"} {l.label}
                      </button>
                      {l.accepted && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300">✓ Accepted</span>}
                      {l.status === "blocked" && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300">Refused by the AI</span>}
                      {l.status === "empty" && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300">Empty result</span>}
                      {l.status === "done" && !l.accepted && l.revised.trim() && (
                        <button disabled={busy} onClick={() => acceptOne(l)}
                          className="ml-auto px-4 py-2 min-h-[36px] rounded-lg text-xs font-bold bg-green-600 hover:bg-green-500 text-white disabled:opacity-40">
                          ✓ Accept
                        </button>
                      )}
                    </div>

                    {l.status === "done" && (
                      open ? (
                        <div className="grid gap-3 md:grid-cols-2 mt-3">
                          <div>
                            <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Before</p>
                            <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400 whitespace-pre-wrap rounded-lg bg-gray-50 dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 p-3">{l.original || "—"}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-wider text-[#C8A96E] mb-1">After</p>
                            <p className="text-xs leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap rounded-lg bg-[#C8A96E]/5 border border-[#C8A96E]/30 p-3">{l.revised || "—"}</p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 line-clamp-2">{l.revised}</p>
                      )
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
