"use client"

// One overnight run, in detail.
//
// Two sources, both already existing:
//   · /api/auction-ai/queue          — the queued sale: status, stage, progress, settings, log
//   · /api/auction-ai/pipeline?code= — the PipelineRun and every PipelineLot under it
//
// ⚠ Read-only over the pipeline data. The run itself belongs to lib/pipeline-runner.ts; the only
// writes here are the same queue controls the list has (hold, resume, remove).

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { setPipelineQueuePaused, removeFromPipelineQueue, startPipelineQueueItem } from "@/lib/actions/pipeline-queue"
import { STAGE_LABEL, queueStatusLabel, isNotStarted, type QueueItem } from "@/lib/pipeline-queue"
import { fmtWhen, statusTone } from "../overnight-client"

const POLL_MS = 10_000

type Lot = {
  id: string
  lotId: string
  label: string
  batchStatus: string | null
  description: string | null
  batchDesc: string | null
  estimate: string | null
  dcStatus: string | null
  contradictions: string | null
  unsupported: string | null
  kpStatus: string | null
  revised: string | null
  kpMissing: string | null
  kpAdded: string | null
  appliedDesc: string | null
}

type Filter = "all" | "attention" | "applied" | "waiting" | "skipped"

/** The text that would go to the catalogue: key points revised it last, batch wrote it first. */
function latestText(l: Lot): string {
  return (l.revised ?? l.description ?? "").trim()
}

/** ⚠ Same comparison the Auto Pipeline's Review & Apply uses — appliedDesc is the ONLY record
 *  that a lot's text reached the catalogue (see the appliedDesc memory note). Do not re-derive
 *  this from the live catalogue description. */
function isApplied(l: Lot): boolean {
  const latest = latestText(l)
  return !!latest && (l.appliedDesc ?? "").trim() === latest
}

function needsAttention(l: Lot): boolean {
  return l.batchStatus === "failed" || l.dcStatus === "issues" || l.dcStatus === "error" || l.kpStatus === "error"
}

function notStarted(l: Lot): boolean {
  return !l.batchStatus
}

export default function RunClient({ code }: { code: string }) {
  const [item, setItem]   = useState<QueueItem | null>(null)
  const [lots, setLots]   = useState<Lot[]>([])
  const [stage, setStage] = useState<string>("")
  const [ready, setReady] = useState(false)
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>("all")
  const [q, setQ] = useState("")
  const [openLot, setOpenLot] = useState<string | null>(null)
  const [showLog, setShowLog] = useState(true)

  const load = useCallback(async () => {
    try {
      const [queueRes, runRes] = await Promise.all([
        fetch("/api/auction-ai/queue").then(r => r.json()).catch(() => null),
        fetch(`/api/auction-ai/pipeline?code=${encodeURIComponent(code)}`).then(r => r.json()).catch(() => null),
      ])
      if (queueRes?.items) setItem(queueRes.items.find((i: QueueItem) => i.code === code) ?? null)
      if (runRes?.run) { setLots(runRes.run.lots ?? []); setStage(runRes.run.stage ?? "") }
      else if (runRes && runRes.run === null) { setLots([]); setStage("") }
    } catch { /* a dropped poll retries on the next tick */ }
    finally { setReady(true) }
  }, [code])

  useEffect(() => {
    load()
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [load])

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true); setError(null)
    try {
      const res = await fn()
      if (!res.ok) setError(res.error ?? "Something went wrong")
      await load()
    } catch (e: any) {
      setError(e?.message ?? "Couldn't reach the server")
    } finally { setBusy(false) }
  }

  const counts = useMemo(() => ({
    all:       lots.length,
    attention: lots.filter(needsAttention).length,
    applied:   lots.filter(isApplied).length,
    waiting:   lots.filter(notStarted).length,
    skipped:   lots.filter(l => l.batchStatus === "skipped").length,
  }), [lots])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return lots.filter(l => {
      if (needle && !l.label.toLowerCase().includes(needle)) return false
      switch (filter) {
        case "attention": return needsAttention(l)
        case "applied":   return isApplied(l)
        case "waiting":   return notStarted(l)
        case "skipped":   return l.batchStatus === "skipped"
        default:          return true
      }
    })
  }, [lots, filter, q])

  const fresh = !!item && isNotStarted(item)
  const tone  = item ? statusTone(item.status, fresh) : statusTone("")
  const pct   = item && item.total > 0 ? Math.min(100, Math.round((item.done / item.total) * 100)) : 0
  // The number of lots the pipeline has actually written something for. ⚠ NOT item.total, which
  // counts stage passes (batch + key points + double check), so a 601-lot sale reads ~1693 there.
  const described = lots.filter(l => latestText(l)).length

  return (
    <div className="p-6 lg:p-8 max-w-[1500px] mx-auto">
      <Link href="/tools/auction-ai/overnight" className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 inline-flex items-center gap-1">← All overnight runs</Link>

      <div className="flex items-start justify-between gap-4 flex-wrap mt-2 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            {code}
            {item && (
              <span className={`text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${tone.chip}`}>
                {queueStatusLabel(item)}
              </span>
            )}
          </h1>
          {item ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {STAGE_LABEL[item.stage] ?? item.stage}
              {item.startedAt ? ` · started ${fmtWhen(item.startedAt)}` : ""}
              {item.finishedAt ? ` · finished ${fmtWhen(item.finishedAt)}` : ""}
              {item.addedBy ? ` · queued by ${item.addedBy}` : ""}
            </p>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {stage ? `Not in the queue — showing the saved results of the last run (${STAGE_LABEL[stage] ?? stage}).` : "Not in the queue."}
            </p>
          )}
        </div>

        {item && item.status !== "DONE" && item.status !== "CANCELLED" && (
          <div className="flex items-center gap-2">
            {fresh ? (
              <button disabled={busy}
                onClick={() => run(() => startPipelineQueueItem(item.id))}
                className="px-5 py-2.5 rounded-xl text-sm font-bold bg-green-600 hover:bg-green-500 text-white disabled:opacity-40">
                ▶ Start this sale
              </button>
            ) : (
              <button disabled={busy}
                onClick={() => run(() => setPipelineQueuePaused(item.id, item.status !== "PAUSED"))}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 dark:bg-[#2C2C2E] text-gray-700 dark:text-gray-200 disabled:opacity-40">
                {item.status === "PAUSED" ? "▶ Resume" : "⏸ Hold"}
              </button>
            )}
            <button disabled={busy}
              onClick={() => {
                if (!confirm(`Take ${code} off the queue?\n\nAnything already written to the catalogue stays — this only stops further work.`)) return
                run(() => removeFromPipelineQueue(item.id))
              }}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold text-red-500 hover:text-red-700 disabled:opacity-40">
              Remove
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300 mb-4">{error}</div>
      )}

      {/* Where it has got to */}
      {item && (
        <div className={`rounded-2xl border p-5 mb-5 ${tone.card}`}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Lots described so far" value={String(described)} />
            <Stat label="Applied to the catalogue" value={String(counts.applied)} />
            <Stat label="Need a look" value={String(counts.attention)} tone={counts.attention > 0 ? "amber" : undefined} />
            <Stat label="Refused by the AI" value={String(item.skipped)} tone={item.skipped > 0 ? "amber" : undefined} />
          </div>
          {item.total > 0 && !fresh && (
            <div className="mt-4">
              <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
                <div className={`h-full transition-all ${item.status === "RUNNING" ? "bg-green-500" : "bg-[#C8A96E]"}`} style={{ width: `${pct}%` }} />
              </div>
              {/* ⚠ Spell out what this number counts. It is stage passes, not lots: every lot
                  goes through batch, key points and double check, so a 601-lot sale reads about
                  1693 here, which read as a bug when it was labelled "lots done". */}
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5">
                {item.done} of {item.total} steps done ({pct}%) — each lot goes through up to three stages,
                so this counts stages rather than lots.
              </p>
            </div>
          )}
          {fresh && (
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-4">
              This sale has not been started. It will not run until you press <strong>Start this sale</strong>.
            </p>
          )}
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-3">
            {item.preset || "no instruction"} · {item.model || "default model"}
            {item.fallbackModel ? ` (fallback ${item.fallbackModel})` : ""}
            {" · "}{item.autoApply ? "auto-apply" : "review before applying"}
            {item.onlyWithPhotos ? " · photos only" : ""}
            {item.skipHasDesc ? " · skip described" : ""}
            {item.kpRelaxed ? " · relaxed key points" : ""}
            {item.grounded ? " · web search" : ""}
          </p>
          {item.lastMessage && <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">{item.lastMessage}</p>}
          {item.retryAfter && new Date(item.retryAfter).getTime() > Date.now() && (
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
              Backing off until {fmtWhen(item.retryAfter)} — rate limited, it will carry on by itself.
            </p>
          )}
        </div>
      )}

      {/* The run log */}
      {item?.logText && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 mb-5">
          <button onClick={() => setShowLog(s => !s)}
            className="w-full flex items-center justify-between px-5 py-3 text-left">
            <span className="text-sm font-bold text-gray-900 dark:text-white">Run log</span>
            <span className="text-xs text-gray-400">{showLog ? "Hide" : "Show"}</span>
          </button>
          {showLog && (
            <pre className="max-h-80 overflow-y-auto border-t border-gray-200 dark:border-gray-800 px-5 py-3 text-[11px] leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
              {item.logText}
            </pre>
          )}
        </div>
      )}

      {/* Lot by lot */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mr-2">Lot by lot</h2>
        {([
          ["all", "All", counts.all],
          ["attention", "Need a look", counts.attention],
          ["applied", "Applied", counts.applied],
          ["waiting", "Not started", counts.waiting],
          ["skipped", "Refused", counts.skipped],
        ] as [Filter, string, number][]).map(([k, lbl, n]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`px-3 py-2 min-h-[36px] rounded-lg text-xs font-semibold ${
              filter === k ? "bg-[#C8A96E] text-black" : "bg-gray-100 dark:bg-[#2C2C2E] text-gray-600 dark:text-gray-300"}`}>
            {lbl} {n > 0 && <span className="opacity-70">{n}</span>}
          </button>
        ))}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a lot…"
          className="ml-auto w-48 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#2C2C2E] px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-[#C8A96E]" />
      </div>

      {!ready ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : lots.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Nothing has been saved for this sale yet. If it is still waiting its turn, the lots appear as soon as the
          first slice runs.
        </p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No lots match that.</p>
      ) : (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-[#141416] text-left">
                <tr className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-2.5 font-semibold">Lot</th>
                  <th className="px-4 py-2.5 font-semibold">Batch run</th>
                  <th className="px-4 py-2.5 font-semibold">Key points</th>
                  <th className="px-4 py-2.5 font-semibold">Double check</th>
                  <th className="px-4 py-2.5 font-semibold">Catalogue</th>
                  <th className="px-4 py-2.5 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {shown.map(l => {
                  const open = openLot === l.id
                  return (
                    <Fragment key={l.id}>
                      <tr className="border-t border-gray-200 dark:border-gray-800">
                        <td className="px-4 py-2.5 font-semibold text-gray-900 dark:text-white whitespace-nowrap">{l.label}</td>
                        <td className="px-4 py-2.5"><StageChip stage="batch" status={l.batchStatus} /></td>
                        <td className="px-4 py-2.5"><StageChip stage="kp" status={l.kpStatus} /></td>
                        <td className="px-4 py-2.5"><StageChip stage="dc" status={l.dcStatus} /></td>
                        <td className="px-4 py-2.5">
                          {isApplied(l)
                            ? <span className="text-xs font-semibold text-green-600 dark:text-green-400">✓ Written</span>
                            : latestText(l)
                            ? <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">Held for review</span>
                            : <span className="text-xs text-gray-400">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button onClick={() => setOpenLot(open ? null : l.id)}
                            className="px-3 py-2 min-h-[36px] rounded-lg text-xs font-semibold bg-gray-100 dark:bg-[#2C2C2E] text-gray-600 dark:text-gray-300">
                            {open ? "Hide" : "Look"}
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-t border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-black/20">
                          <td colSpan={6} className="px-4 py-4">
                            <LotDetail lot={l} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "amber" }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`text-2xl font-black tabular-nums ${tone === "amber" ? "text-amber-600 dark:text-amber-400" : "text-gray-900 dark:text-white"}`}>{value}</p>
    </div>
  )
}

/** Each stage has its own vocabulary — "issues" on Double Check is a finding, not a failure,
 *  and "fixed" on Key Points means it put something back that had been dropped. */
function StageChip({ stage, status }: { stage: "batch" | "kp" | "dc"; status: string | null }) {
  if (!status) return <span className="text-xs text-gray-400">not run</span>
  const map: Record<string, { label: string; cls: string }> = {
    ok:      { label: stage === "dc" ? "nothing to flag" : "done", cls: "text-green-600 dark:text-green-400" },
    fixed:   { label: "put back missing detail", cls: "text-sky-600 dark:text-sky-400" },
    issues:  { label: "flagged something", cls: "text-amber-600 dark:text-amber-400" },
    skipped: { label: "skipped", cls: "text-gray-500 dark:text-gray-400" },
    failed:  { label: "failed", cls: "text-red-600 dark:text-red-400" },
    error:   { label: "errored", cls: "text-red-600 dark:text-red-400" },
  }
  const s = map[status] ?? { label: status, cls: "text-gray-500 dark:text-gray-400" }
  return <span className={`text-xs font-semibold ${s.cls}`}>{s.label}</span>
}

function LotDetail({ lot }: { lot: Lot }) {
  const latest = latestText(lot)
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        {lot.kpMissing && <Block title="Key points the description had missed" tone="amber" text={lot.kpMissing} />}
        {lot.kpAdded && <Block title="What key points put back" tone="sky" text={lot.kpAdded} />}
        {lot.contradictions && <Block title="Double check — contradicts the photos or the key points" tone="amber" text={lot.contradictions} />}
        {lot.unsupported && <Block title="Double check — claims nothing supports" tone="amber" text={lot.unsupported} />}
        {lot.estimate && <Block title="Estimate" tone="plain" text={lot.estimate} />}
        {!lot.kpMissing && !lot.kpAdded && !lot.contradictions && !lot.unsupported && (
          <p className="text-sm text-gray-500 dark:text-gray-400">Nothing was flagged on this lot.</p>
        )}
      </div>
      <div className="space-y-3">
        <Block title={isApplied(lot) ? "The text on the catalogue" : "The text this run produced (not written)"} tone="plain" text={latest || "—"} />
        {/* The raw batch text is kept separately so the before/after is visible when a later
            stage rewrote it — otherwise "double check cleaned it up" is unverifiable. */}
        {lot.batchDesc && latest && lot.batchDesc.trim() !== latest && (
          <Block title="What the batch run first wrote, before the later stages changed it" tone="plain" text={lot.batchDesc} muted />
        )}
      </div>
    </div>
  )
}

function Block({ title, text, tone, muted }: { title: string; text: string; tone: "amber" | "sky" | "plain"; muted?: boolean }) {
  const cls = tone === "amber"
    ? "border-amber-300 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/20"
    : tone === "sky"
    ? "border-sky-300 dark:border-sky-800/70 bg-sky-50 dark:bg-sky-950/20"
    : "border-gray-200 dark:border-gray-800 bg-white dark:bg-black/20"
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <p className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">{title}</p>
      <p className={`text-sm whitespace-pre-line leading-relaxed ${muted ? "text-gray-500 dark:text-gray-400" : "text-gray-800 dark:text-gray-200"}`}>{text}</p>
    </div>
  )
}
