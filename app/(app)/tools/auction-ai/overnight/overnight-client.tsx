"use client"

// The list of overnight runs, and the form that adds one.
//
// ⚠ The settings live HERE. On the old panel a queued sale silently took whatever the Auto
// Pipeline tab was set to at that moment, so what a sale would run with depended on a screen
// somewhere else. Queueing now states its own instruction, models and toggles.

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  addToPipelineQueue, movePipelineQueueItem, setPipelineQueuePaused,
  removeFromPipelineQueue, clearFinishedQueueItems,
} from "@/lib/actions/pipeline-queue"
import { QUEUE_STATUS_LABEL, STAGE_LABEL, type QueueItem } from "@/lib/pipeline-queue"

type Auction = { code: string; name: string | null; auctionDate: string | null }

const POLL_MS = 10_000

export function fmtWhen(iso: string | null): string {
  if (!iso) return ""
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

/** How long a finished run took, in words. */
function duration(from: string | null, to: string | null): string {
  if (!from || !to) return ""
  const mins = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000))
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  return `${h}h ${mins % 60}m`
}

export function statusTone(status: string): { chip: string; card: string } {
  switch (status) {
    case "RUNNING":   return { chip: "bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300", card: "border-green-400 dark:border-green-700/70 bg-green-50/50 dark:bg-green-950/20" }
    case "PAUSED":    return { chip: "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300", card: "border-amber-300 dark:border-amber-800" }
    case "CANCELLED": return { chip: "bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300",         card: "border-red-300 dark:border-red-900" }
    case "DONE":      return { chip: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300",        card: "border-gray-200 dark:border-gray-800" }
    default:          return { chip: "bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300",         card: "border-gray-200 dark:border-gray-800" }
  }
}

export default function OvernightClient() {
  const [items, setItems]   = useState<QueueItem[]>([])
  const [ready, setReady]   = useState(false)
  const [runnerOk, setRunnerOk]       = useState(true)
  const [notMigrated, setNotMigrated] = useState(false)
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [note, setNote]     = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [auctions, setAuctions] = useState<Auction[]>([])

  const load = useCallback(async () => {
    try {
      const res  = await fetch("/api/auction-ai/queue")
      const json = await res.json()
      if (json.error) { setError(json.error); return }
      setItems(json.items ?? [])
      setRunnerOk(json.runnerConfigured !== false)
      setNotMigrated(!!json.notMigrated)
    } catch { /* a dropped poll is not worth shouting about — the next one retries */ }
    finally { setReady(true) }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    fetch("/api/auction-ai/auctions").then(r => r.json()).then(d => { if (Array.isArray(d)) setAuctions(d) }).catch(() => {})
  }, [])

  const nameFor = useCallback((code: string) => auctions.find(a => a.code === code)?.name ?? "", [auctions])

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) {
    setBusy(true); setError(null); setNote(null)
    try {
      const res = await fn()
      if (!res.ok) { setError(res.error ?? "Something went wrong"); return }
      if (okMsg) setNote(okMsg)
      await load()
    } catch (e: any) {
      setError(e?.message ?? "Couldn't reach the server")
    } finally { setBusy(false) }
  }

  const running  = items.filter(i => i.status === "RUNNING")
  const waiting  = items.filter(i => i.status === "QUEUED" || i.status === "PAUSED")
  const finished = items.filter(i => i.status === "DONE" || i.status === "CANCELLED")

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] mx-auto">
      <div className="mb-6">
        <Link href="/tools/auction-ai?tab=pipeline" className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 inline-flex items-center gap-1">← Auction AI</Link>
        <div className="flex items-start justify-between gap-4 flex-wrap mt-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🌙 Overnight AI runs</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-3xl leading-relaxed">
              Sales queued to run on the server, one after another, each on its own instruction and settings.
              Nothing needs to be left open — add a sale, go home, and read what happened here in the morning.
              Open any run to see it lot by lot.
            </p>
          </div>
          <button
            onClick={() => setAdding(a => !a)}
            disabled={notMigrated}
            className="px-5 py-2.5 rounded-xl bg-[#C8A96E] hover:bg-[#b9995c] text-black font-bold text-sm disabled:opacity-40">
            {adding ? "Close" : "＋ Queue a sale"}
          </button>
        </div>
      </div>

      {notMigrated && (
        <Banner tone="amber">
          The queue isn&apos;t switched on yet on this environment — an admin needs to finish setting it up before
          sales can be added. Nothing is lost; there just isn&apos;t anywhere to put it yet.
        </Banner>
      )}
      {!notMigrated && !runnerOk && (
        <Banner tone="amber">
          The overnight runner isn&apos;t switched on for this environment (CRON_SECRET isn&apos;t set), so anything
          queued here will sit and wait. Ask IT before relying on it tonight.
        </Banner>
      )}
      {error && <Banner tone="red">{error}</Banner>}
      {note && <Banner tone="green">{note}</Banner>}

      {adding && (
        <QueueForm
          auctions={auctions}
          queuedCodes={items.filter(i => ["QUEUED", "RUNNING", "PAUSED"].includes(i.status)).map(i => i.code)}
          busy={busy}
          onCancel={() => setAdding(false)}
          onSubmit={async (code, settings) => {
            await run(() => addToPipelineQueue(code, settings), `${code} added — it will start when the sales ahead of it finish.`)
            setAdding(false)
          }}
        />
      )}

      {!ready ? (
        <p className="text-sm text-gray-400 mt-6">Loading…</p>
      ) : items.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center">
          <p className="text-gray-700 dark:text-gray-200 font-semibold">Nothing is queued.</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Press <strong>Queue a sale</strong>, pick the sale and the instruction it should run on, and it will
            start on its own.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          <Section title="Running now" count={running.length} empty="Nothing is running at the moment.">
            {running.map(i => <RunCard key={i.id} item={i} name={nameFor(i.code)} busy={busy} run={run} />)}
          </Section>

          <Section title="Waiting" count={waiting.length} empty="Nothing else is waiting.">
            {waiting.map((i, idx) => (
              <RunCard key={i.id} item={i} name={nameFor(i.code)} busy={busy} run={run}
                place={i.status === "QUEUED" ? idx + 1 : undefined}
                canMoveUp={idx > 0} canMoveDown={idx < waiting.length - 1} />
            ))}
          </Section>

          {finished.length > 0 && (
            <Section
              title="Finished"
              count={finished.length}
              action={
                <button onClick={() => run(() => clearFinishedQueueItems(), "Cleared.")} disabled={busy}
                  className="text-xs font-semibold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 underline">
                  Clear finished
                </button>
              }>
              {finished.map(i => <RunCard key={i.id} item={i} name={nameFor(i.code)} busy={busy} run={run} />)}
            </Section>
          )}
        </div>
      )}
    </div>
  )
}

function Banner({ tone, children }: { tone: "amber" | "red" | "green"; children: React.ReactNode }) {
  const cls = tone === "red"
    ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300"
    : tone === "green"
    ? "border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300"
    : "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300"
  return <div className={`rounded-xl border px-4 py-3 text-sm mb-3 ${cls}`}>{children}</div>
}

function Section({ title, count, empty, action, children }: {
  title: string; count: number; empty?: string; action?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">{title}</h2>
        {count > 0 && <span className="text-xs font-semibold text-gray-400">{count}</span>}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {count === 0 ? <p className="text-sm text-gray-400">{empty}</p> : <div className="space-y-3">{children}</div>}
    </div>
  )
}

// ─── One run in the list ──────────────────────────────────────────────────

function RunCard({
  item, name, busy, run, place, canMoveUp, canMoveDown,
}: {
  item: QueueItem
  name: string
  busy: boolean
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) => void
  place?: number
  canMoveUp?: boolean
  canMoveDown?: boolean
}) {
  const tone    = statusTone(item.status)
  const pct     = item.total > 0 ? Math.min(100, Math.round((item.done / item.total) * 100)) : 0
  const waiting = item.retryAfter && new Date(item.retryAfter).getTime() > Date.now()
  const ghost   = "px-2.5 py-2 min-h-[36px] rounded-lg text-xs font-semibold bg-gray-100 dark:bg-[#2C2C2E] text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white disabled:opacity-40"

  return (
    <div className={`rounded-2xl border p-4 ${tone.card}`}>
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {place && <span className="text-xs font-bold text-gray-400 tabular-nums">#{place}</span>}
            <Link href={`/tools/auction-ai/overnight/${encodeURIComponent(item.code)}`}
              className="font-bold text-gray-900 dark:text-white hover:underline">
              {item.code}
            </Link>
            {name && <span className="text-sm text-gray-500 dark:text-gray-400 truncate">{name}</span>}
            <span className={`text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${tone.chip}`}>
              {QUEUE_STATUS_LABEL[item.status] ?? item.status}
            </span>
            {item.status !== "DONE" && (
              <span className="text-[11px] text-gray-500 dark:text-gray-400">{STAGE_LABEL[item.stage] ?? item.stage}</span>
            )}
          </div>

          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5">
            {item.preset || "no instruction"}
            {" · "}{item.autoApply ? "auto-apply" : "review before applying"}
            {item.onlyWithPhotos ? " · photos only" : ""}
            {item.skipHasDesc ? " · skip described" : ""}
            {item.kpRelaxed ? " · relaxed key points" : ""}
            {item.grounded ? " · web search" : ""}
            {item.addedBy ? ` · queued by ${item.addedBy}` : ""}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {item.status !== "DONE" && item.status !== "CANCELLED" && (
            <>
              <button className={ghost} disabled={busy || !canMoveUp || item.status === "RUNNING"}
                onClick={() => run(() => movePipelineQueueItem(item.id, "up"))} title="Run this one sooner">↑</button>
              <button className={ghost} disabled={busy || !canMoveDown || item.status === "RUNNING"}
                onClick={() => run(() => movePipelineQueueItem(item.id, "down"))} title="Run this one later">↓</button>
              <button className={ghost} disabled={busy}
                onClick={() => run(() => setPipelineQueuePaused(item.id, item.status !== "PAUSED"))}>
                {item.status === "PAUSED" ? "Resume" : "Hold"}
              </button>
            </>
          )}
          <Link href={`/tools/auction-ai/overnight/${encodeURIComponent(item.code)}`}
            className="px-3 py-2 min-h-[36px] rounded-lg text-xs font-bold bg-[#C8A96E] hover:bg-[#b9995c] text-black inline-flex items-center">
            Open
          </Link>
          <button className={`${ghost} text-red-500 hover:text-red-700`} disabled={busy}
            onClick={() => {
              if (!confirm(`Take ${item.code} off the queue?\n\nAnything already written to the catalogue stays — this only stops further work.`)) return
              run(() => removeFromPipelineQueue(item.id), `${item.code} removed.`)
            }}>Remove</button>
        </div>
      </div>

      {item.total > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400 mb-1">
            <span>{item.done} of {item.total} lots{item.skipped > 0 ? ` · ${item.skipped} skipped` : ""}</span>
            <span className="tabular-nums">{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
            <div className={`h-full transition-all ${item.status === "RUNNING" ? "bg-green-500" : "bg-[#C8A96E]"}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {(item.lastMessage || waiting) && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
          {waiting ? `Backing off until ${fmtWhen(item.retryAfter)} before carrying on. ` : ""}
          {item.lastMessage}
        </p>
      )}
      {item.finishedAt && (
        <p className="text-[11px] text-gray-400 mt-1">
          Finished {fmtWhen(item.finishedAt)}{duration(item.startedAt, item.finishedAt) ? ` · took ${duration(item.startedAt, item.finishedAt)}` : ""}
        </p>
      )}
    </div>
  )
}

// ─── Queue a sale ─────────────────────────────────────────────────────────

function QueueForm({
  auctions, queuedCodes, busy, onCancel, onSubmit,
}: {
  auctions: Auction[]
  queuedCodes: string[]
  busy: boolean
  onCancel: () => void
  onSubmit: (code: string, settings: {
    preset: string; model: string; fallbackModel: string
    grounded: boolean; autoApply: boolean; onlyWithPhotos: boolean; skipHasDesc: boolean; kpRelaxed: boolean
  }) => void
}) {
  const [code, setCode] = useState("")
  const [preset, setPreset] = useState("")
  const [model, setModel] = useState("")
  const [fallbackModel, setFallbackModel] = useState("")
  const [autoApply, setAutoApply] = useState(true)
  const [onlyWithPhotos, setOnlyWithPhotos] = useState(false)
  const [skipHasDesc, setSkipHasDesc] = useState(false)
  const [kpRelaxed, setKpRelaxed] = useState(false)
  const [grounded, setGrounded] = useState(false)
  const [presets, setPresets] = useState<{ key: string; favourite?: boolean }[]>([])
  const [models, setModels] = useState<string[]>([])

  useEffect(() => {
    fetch("/api/auction-ai/presets?full=1").then(r => r.json())
      .then(d => { if (Array.isArray(d)) setPresets(d) }).catch(() => {})
    fetch("/api/auction-ai/models").then(r => r.json())
      .then(j => { if (j.models?.length) { setModels(j.models); setModel(m => m || j.models[0]) } }).catch(() => {})
  }, [])

  const already = useMemo(() => new Set(queuedCodes.map(c => c.toUpperCase())), [queuedCodes])
  const input = "w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#2C2C2E] px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-[#C8A96E] dark:[color-scheme:dark]"
  const label = "block text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1"

  return (
    <div className="rounded-2xl border border-[#C8A96E]/50 bg-[#C8A96E]/5 p-5 mb-6 space-y-4">
      <p className="text-sm font-bold text-gray-900 dark:text-white">Queue a sale</p>
      {/* ⚠ Every setting is chosen HERE. The old panel captured whatever the Auto Pipeline tab
          was showing, so what a sale ran with depended on a screen somewhere else entirely. */}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        These settings are saved onto this sale, so the next one you queue can use a completely different
        instruction and model.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className={label}>Sale</label>
          <select value={code} onChange={e => setCode(e.target.value)} className={input}>
            <option value="">— pick a sale —</option>
            {auctions.map(a => (
              <option key={a.code} value={a.code} disabled={already.has(a.code.toUpperCase())}>
                {a.code}{a.name ? ` — ${a.name}` : ""}{already.has(a.code.toUpperCase()) ? " (already queued)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Instruction</label>
          <select value={preset} onChange={e => setPreset(e.target.value)} className={input}>
            <option value="">— none —</option>
            {presets.map(p => <option key={p.key} value={p.key}>{p.favourite ? "★ " : ""}{p.key}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Model</label>
          <select value={model} onChange={e => setModel(e.target.value)} className={input}>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Fallback model <span className="normal-case">(used when rate limited)</span></label>
          <select value={fallbackModel} onChange={e => setFallbackModel(e.target.value)} className={input}>
            <option value="">— none —</option>
            {models.filter(m => m !== model).map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 text-sm text-gray-700 dark:text-gray-300">
        <Toggle checked={autoApply} onChange={setAutoApply}
          label="Apply the descriptions" hint="All three stages write to the catalogue. Off means everything is held for review." />
        <Toggle checked={onlyWithPhotos} onChange={setOnlyWithPhotos}
          label="Only lots with photos" hint="Leaves anything not photographed yet for a later run." />
        <Toggle checked={skipHasDesc} onChange={setSkipHasDesc}
          label="Skip lots already described" hint="Leaves anything that already has a description alone." />
        <Toggle checked={kpRelaxed} onChange={setKpRelaxed}
          label="Relaxed key points" hint="Accepts the meaning rather than the exact wording." />
        <Toggle checked={grounded} onChange={setGrounded}
          label="Web search" hint="Lets the AI look things up while describing." />
      </div>

      <div className="flex items-center gap-2">
        <button
          disabled={busy || !code}
          onClick={() => onSubmit(code, { preset, model, fallbackModel, grounded, autoApply, onlyWithPhotos, skipHasDesc, kpRelaxed })}
          className="px-5 py-2.5 rounded-xl bg-[#C8A96E] hover:bg-[#b9995c] text-black font-bold text-sm disabled:opacity-40">
          Add to the queue
        </button>
        <button onClick={onCancel} className="px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
          Cancel
        </button>
      </div>
    </div>
  )
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex items-start gap-2.5 min-h-[44px] cursor-pointer">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        className="accent-[#C8A96E] h-5 w-5 shrink-0 mt-0.5" />
      <span>
        <span className="block font-semibold text-gray-800 dark:text-gray-200">{label}</span>
        <span className="block text-xs text-gray-500 dark:text-gray-400">{hint}</span>
      </span>
    </label>
  )
}
