"use client"

// The overnight queue, on the Auto Pipeline tab.
//
// Line up several sales, each with its OWN settings — a Bears sale on the bears
// instruction, then a Trains sale on a different one — and the server works
// through them. Unlike the Run button above it, nothing here needs the browser
// left open: close the tab, go home, read the result in the morning.

import { useCallback, useEffect, useRef, useState } from "react"
import {
  addToPipelineQueue, movePipelineQueueItem, setPipelineQueuePaused,
  removeFromPipelineQueue, clearFinishedQueueItems,
} from "@/lib/actions/pipeline-queue"
import { QUEUE_STATUS_LABEL, STAGE_LABEL, type QueueItem, type QueueSettings } from "@/lib/pipeline-queue"

const btn   = "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40"
const ghost = `${btn} bg-gray-100 dark:bg-[#2C2C2E] text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white`

function fmtTime(iso: string | null): string {
  if (!iso) return ""
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

function statusTone(status: string): string {
  switch (status) {
    case "RUNNING":   return "border-green-400 dark:border-green-700 bg-green-50/60 dark:bg-green-950/25"
    case "DONE":      return "border-gray-200 dark:border-gray-800 opacity-70"
    case "PAUSED":    return "border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/25"
    case "CANCELLED": return "border-red-300 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20"
    default:          return "border-gray-200 dark:border-gray-800"
  }
}

export default function PipelineQueuePanel({
  code, settings, canAdd,
}: {
  /** The sale currently loaded in the tab — what "Add this sale" queues. */
  code: string
  /** The tab's current settings, captured onto the queued sale so each one
   *  keeps the instruction/model/toggles it was queued with. */
  settings: QueueSettings
  canAdd: boolean
}) {
  const [items, setItems]   = useState<QueueItem[]>([])
  const [ready, setReady]   = useState(false)
  const [runnerOk, setRunnerOk] = useState(true)
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [note, setNote]     = useState<string | null>(null)
  const [openLog, setOpenLog] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const res  = await fetch("/api/auction-ai/queue")
      const json = await res.json()
      if (json.error) { setError(json.error); return }
      setItems(json.items ?? [])
      setRunnerOk(json.runnerConfigured !== false)
    } catch { /* a dropped poll is not worth shouting about — the next one retries */ }
    finally { setReady(true) }
  }, [])

  // Polls while the tab is open. The work carries on regardless — this is only
  // the window onto it.
  useEffect(() => {
    load()
    timer.current = setInterval(load, 10_000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [load])

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) {
    setBusy(true); setError(null); setNote(null)
    try {
      const res = await fn()
      if (!res.ok) { setError(res.error ?? "Something went wrong"); return }
      if (okMsg) setNote(okMsg)
      await load()
    } catch (e: any) {
      setError(e?.message ?? "Couldn't reach the server")
    } finally {
      setBusy(false)
    }
  }

  const active   = items.filter(i => i.status === "QUEUED" || i.status === "RUNNING" || i.status === "PAUSED")
  const finished = items.filter(i => i.status === "DONE" || i.status === "CANCELLED")

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 p-4 mt-6">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div>
          <h3 className="text-base font-bold text-gray-900 dark:text-white">🌙 Overnight queue</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Line up sales to run one after another, each with its own instruction, model and settings.
            This runs on the server — you can close the tab and go home.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={`${btn} bg-[#C8A96E] hover:bg-[#b9995c] text-black`}
            disabled={busy || !canAdd}
            title={canAdd ? `Queue ${code} with the settings above` : "Load a sale above first"}
            onClick={() => run(() => addToPipelineQueue(code, settings), `${code.toUpperCase()} added to the queue.`)}
          >
            + Add {code ? code.toUpperCase() : "this sale"}
          </button>
          {finished.length > 0 && (
            <button className={ghost} disabled={busy} onClick={() => run(() => clearFinishedQueueItems(), "Cleared.")}>
              Clear finished
            </button>
          )}
        </div>
      </div>

      {!runnerOk && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 mt-2">
          The overnight runner isn&apos;t switched on for this environment (CRON_SECRET isn&apos;t set), so anything added here will just sit and wait. Ask IT before relying on it tonight.
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300 mt-2">{error}</div>
      )}
      {note && (
        <div className="rounded-xl border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/40 px-3 py-2 text-xs text-green-700 dark:text-green-300 mt-2">{note}</div>
      )}

      {!ready ? (
        <p className="text-sm text-gray-400 mt-3">Loading the queue…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">
          Nothing queued. Load a sale above, set it up how you want it, then press <strong>Add</strong> — repeat for each sale and they&apos;ll run in order.
        </p>
      ) : (
        <div className="space-y-2 mt-3">
          {[...active, ...finished].map((i, idx) => (
            <QueueRow
              key={i.id}
              item={i}
              first={idx === 0}
              busy={busy}
              openLog={openLog === i.id}
              onToggleLog={() => setOpenLog(openLog === i.id ? null : i.id)}
              onMove={(d) => run(() => movePipelineQueueItem(i.id, d))}
              onPause={() => run(() => setPipelineQueuePaused(i.id, i.status !== "PAUSED"))}
              onRemove={() => {
                if (!confirm(`Take ${i.code} off the queue?\n\nAnything already written to the catalogue stays — this only stops further work.`)) return
                run(() => removeFromPipelineQueue(i.id), `${i.code} removed from the queue.`)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function QueueRow({
  item, first, busy, openLog, onToggleLog, onMove, onPause, onRemove,
}: {
  item: QueueItem
  first: boolean
  busy: boolean
  openLog: boolean
  onToggleLog: () => void
  onMove: (d: "up" | "down") => void
  onPause: () => void
  onRemove: () => void
}) {
  const pct = item.total > 0 ? Math.min(100, Math.round((item.done / item.total) * 100)) : 0
  const waiting = item.retryAfter && new Date(item.retryAfter).getTime() > Date.now()

  return (
    <div className={`rounded-xl border p-3 ${statusTone(item.status)}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-bold text-sm text-gray-900 dark:text-white">{item.code}</span>
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
          {QUEUE_STATUS_LABEL[item.status] ?? item.status}
        </span>
        {item.status !== "DONE" && (
          <span className="text-[11px] text-gray-500 dark:text-gray-400">{STAGE_LABEL[item.stage] ?? item.stage}</span>
        )}
        {item.total > 0 && (
          <span className="text-[11px] text-gray-500 dark:text-gray-400">{item.done}/{item.total}</span>
        )}
        {item.skipped > 0 && (
          <span className="text-[11px] text-amber-600 dark:text-amber-400" title="Lots the AI refused to describe — these are never retried, and are listed in the log">
            {item.skipped} skipped
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          {item.logText && (
            <button className={ghost} onClick={onToggleLog}>{openLog ? "Hide log" : "Log"}</button>
          )}
          {item.status !== "DONE" && item.status !== "CANCELLED" && (
            <>
              <button className={ghost} disabled={busy || first || item.status === "RUNNING"} onClick={() => onMove("up")} title="Run this one sooner">↑</button>
              <button className={ghost} disabled={busy || item.status === "RUNNING"} onClick={() => onMove("down")} title="Run this one later">↓</button>
              <button className={ghost} disabled={busy} onClick={onPause}>{item.status === "PAUSED" ? "Resume" : "Hold"}</button>
            </>
          )}
          <button className={`${btn} text-red-500 hover:text-red-700`} disabled={busy} onClick={onRemove}>Remove</button>
        </div>
      </div>

      {item.total > 0 && item.status !== "DONE" && (
        <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-800 mt-2 overflow-hidden">
          <div className="h-full bg-[#C8A96E] transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}

      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
        {item.preset || "no instruction"}
        {" · "}{item.autoApply ? "auto-apply" : "review before applying"}
        {item.onlyWithPhotos ? " · photos only" : ""}
        {item.skipHasDesc ? " · skip described" : ""}
        {item.kpRelaxed ? " · relaxed key points" : ""}
        {item.grounded ? " · web search" : ""}
        {item.addedBy ? ` · queued by ${item.addedBy}` : ""}
      </p>

      {(item.lastMessage || waiting) && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
          {waiting ? `Waiting until ${fmtTime(item.retryAfter)} before carrying on. ` : ""}
          {item.lastMessage}
        </p>
      )}
      {item.finishedAt && (
        <p className="text-[11px] text-gray-400 mt-1">Finished {fmtTime(item.finishedAt)}</p>
      )}

      {openLog && item.logText && (
        <pre className="mt-2 max-h-64 overflow-y-auto rounded-lg bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800 p-2 text-[11px] leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
          {item.logText}
        </pre>
      )}
    </div>
  )
}
