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
  startPipelineQueueItem, startAllPipelineQueueItems,
} from "@/lib/actions/pipeline-queue"
import { STAGE_LABEL, queueStatusLabel, isNotStarted, type QueueItem, type QueueKind, type QueueSettings } from "@/lib/pipeline-queue"
import { UPGRADE_MODES, UPGRADE_MODE_LABEL } from "@/lib/upgrade-modes"

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

export function statusTone(status: string, notStarted = false): { chip: string; card: string } {
  // A sale nobody has started yet is not "paused" in the amber, something-is-up sense —
  // it is simply sitting there waiting for a person, which should read as neutral.
  if (notStarted) return { chip: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300", card: "border-dashed border-gray-300 dark:border-gray-700" }
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

  const running    = items.filter(i => i.status === "RUNNING")
  const notStarted = items.filter(isNotStarted)
  const waiting    = items.filter(i => !isNotStarted(i) && (i.status === "QUEUED" || i.status === "PAUSED"))
  const finished   = items.filter(i => i.status === "DONE" || i.status === "CANCELLED")

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] mx-auto">
      <div className="mb-6">
        <Link href="/tools/auction-ai?tab=pipeline" className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 inline-flex items-center gap-1">← Auction AI</Link>
        <div className="flex items-start justify-between gap-4 flex-wrap mt-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🌙 Overnight AI runs</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-3xl leading-relaxed">
              Sales queued to run on the server, one after another, each on its own instruction and settings.
              Nothing needs to be left open — start them, go home, and read what happened here in the morning.
              Open any run to see it lot by lot. <strong>A sale you add sits still until you press Start.</strong>
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
          queuedByKind={{
            pipeline: items.filter(i => i.kind !== "upgrade" && ["QUEUED", "RUNNING", "PAUSED"].includes(i.status)).map(i => i.code),
            upgrade:  items.filter(i => i.kind === "upgrade" && ["QUEUED", "RUNNING", "PAUSED"].includes(i.status)).map(i => i.code),
          }}
          busy={busy}
          onCancel={() => setAdding(false)}
          onSubmit={async (code, settings) => {
            await run(() => addToPipelineQueue(code, settings), `${code} added. It won't run until you press Start.`)
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
            Press <strong>Queue a sale</strong>, pick the sale and the instruction it should run on. It waits until
            you press <strong>Start</strong> — adding a sale never sets it running.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          <Section title="Running now" count={running.length} empty="Nothing is running at the moment.">
            {running.map(i => <RunCard key={i.id} item={i} name={nameFor(i.code)} busy={busy} run={run} />)}
          </Section>

          {/* ⚠ Nothing here runs until someone presses Start — a sale is added held back on
              purpose. Say so on the section, not just on the button. */}
          <Section
            title="Not started"
            count={notStarted.length}
            empty="Nothing is waiting to be started."
            note="These will not run until you start them."
            action={notStarted.length > 1 ? (
              <button onClick={() => run(() => startAllPipelineQueueItems(), "Started — they will run one after another.")} disabled={busy}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-green-600 hover:bg-green-500 text-white disabled:opacity-40">
                ▶ Start all {notStarted.length}
              </button>
            ) : undefined}>
            {notStarted.map((i, idx) => (
              <RunCard key={i.id} item={i} name={nameFor(i.code)} busy={busy} run={run}
                canMoveUp={idx > 0} canMoveDown={idx < notStarted.length - 1} />
            ))}
          </Section>

          <Section title="Started — waiting their turn" count={waiting.length} empty="Nothing else is waiting.">
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

/** The three pipeline stages at a glance, using the Auto Pipeline tab's own icons so a run
 *  reads the same whichever screen you are on: ⚡ Batch · ✓ Key Points · 🔎 Double Check. */
function StagePips({ stage, running }: { stage: string; running: boolean }) {
  const order = ["batch", "kpcheck", "doublecheck", "complete"]
  const at = order.indexOf(stage)
  return (
    <span className="inline-flex items-center gap-1">
      {([["batch", "⚡", "Batch run"], ["kpcheck", "✓", "Key points"], ["doublecheck", "🔎", "Double check"]] as const).map(([key, icon, label]) => {
        const i = order.indexOf(key)
        const done   = i < at
        const active = i === at
        return (
          <span key={key} title={`${label}${done ? " — done" : active ? (running ? " — running" : " — up next") : " — not reached"}`}
            className={`text-[11px] leading-none px-1.5 py-1 rounded ${
              done   ? "bg-green-500/15 text-green-500"
              : active ? `bg-[#C8A96E]/20 text-[#C8A96E] ${running ? "animate-pulse" : ""}`
              : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600"}`}>
            {icon}
          </span>
        )
      })}
      <span className="text-[11px] text-gray-500 dark:text-gray-400 ml-1">{STAGE_LABEL[stage] ?? stage}</span>
    </span>
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

function Section({ title, count, empty, note, action, children }: {
  title: string; count: number; empty?: string; note?: string; action?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">{title}</h2>
        {count > 0 && <span className="text-xs font-semibold text-gray-400">{count}</span>}
        {count > 0 && note && <span className="text-xs text-gray-500 dark:text-gray-400">{note}</span>}
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
  const fresh   = isNotStarted(item)
  const tone    = statusTone(item.status, fresh)
  const pct     = item.total > 0 ? Math.min(100, Math.round((item.done / item.total) * 100)) : 0
  const waiting = item.retryAfter && new Date(item.retryAfter).getTime() > Date.now()
  const ghost   = "px-2.5 py-2 min-h-[36px] rounded-lg text-xs font-semibold bg-gray-100 dark:bg-[#2C2C2E] text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white disabled:opacity-40"
  const isUpgrade = item.kind === "upgrade"
  const openHref  = isUpgrade
    ? `/tools/auction-ai/overnight/upgrade/${encodeURIComponent(item.id)}`
    : `/tools/auction-ai/overnight/${encodeURIComponent(item.code)}`
  const toReview  = isUpgrade ? Math.max(0, item.upgradeDone - item.upgradeAccepted) : 0

  return (
    <div className={`rounded-2xl border p-4 ${tone.card}`}>
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {place && <span className="text-xs font-bold text-gray-400 tabular-nums">#{place}</span>}
            <Link href={openHref}
              className="font-bold text-gray-900 dark:text-white hover:underline">
              {item.code}
            </Link>
            {name && <span className="text-sm text-gray-500 dark:text-gray-400 truncate">{name}</span>}
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
              {isUpgrade ? "✨ AI Upgrade" : "⚙ Auto Pipeline"}
            </span>
            <span className={`text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${tone.chip}`}>
              {queueStatusLabel(item)}
            </span>
            {!fresh && !isUpgrade && <StagePips stage={item.stage} running={item.status === "RUNNING"} />}
          </div>

          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5">
            {isUpgrade ? (
              <>
                {item.upgradeModes.split(",").filter(Boolean).map(m => UPGRADE_MODE_LABEL[m] ?? m).join(", ") || "no options picked"}
                {" · rewrites held for review"}
                {item.addedBy ? ` · queued by ${item.addedBy}` : ""}
              </>
            ) : (
              <>
                {item.preset || "no instruction"}
                {" · "}{item.autoApply ? "auto-apply" : "review before applying"}
                {item.onlyWithPhotos ? " · photos only" : ""}
                {item.skipHasDesc ? " · skip described" : ""}
                {item.fastMode ? " · ⚡ quick" : ""}
                {item.kpRelaxed ? " · relaxed key points" : ""}
                {item.grounded ? " · web search" : ""}
                {item.addedBy ? ` · queued by ${item.addedBy}` : ""}
              </>
            )}
          </p>
          {isUpgrade && toReview > 0 && (
            <p className="text-[11px] font-semibold text-[#C8A96E] mt-1">
              ✨ {toReview} rewrite{toReview === 1 ? "" : "s"} waiting for review
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {item.status !== "DONE" && item.status !== "CANCELLED" && (
            <>
              <button className={ghost} disabled={busy || !canMoveUp || item.status === "RUNNING"}
                onClick={() => run(() => movePipelineQueueItem(item.id, "up"))} title="Run this one sooner">↑</button>
              <button className={ghost} disabled={busy || !canMoveDown || item.status === "RUNNING"}
                onClick={() => run(() => movePipelineQueueItem(item.id, "down"))} title="Run this one later">↓</button>
              {fresh ? (
                <button className="px-3 py-2 min-h-[36px] rounded-lg text-xs font-bold bg-green-600 hover:bg-green-500 text-white disabled:opacity-40"
                  disabled={busy}
                  onClick={() => run(() => startPipelineQueueItem(item.id), `${item.code} started.`)}>
                  ▶ Start
                </button>
              ) : (
                <button className={ghost} disabled={busy}
                  onClick={() => run(() => setPipelineQueuePaused(item.id, item.status !== "PAUSED"))}>
                  {item.status === "PAUSED" ? "Resume" : "Hold"}
                </button>
              )}
            </>
          )}
          <Link href={openHref}
            className="px-3 py-2 min-h-[36px] rounded-lg text-xs font-bold bg-[#C8A96E] hover:bg-[#b9995c] text-black inline-flex items-center">
            {isUpgrade && toReview > 0 ? "Review" : "Open"}
          </Link>
          <button className={`${ghost} text-red-500 hover:text-red-700`} disabled={busy}
            onClick={() => {
              if (!confirm(`Take ${item.code} off the queue?\n\nAnything already written to the catalogue stays — this only stops further work.`)) return
              run(() => removeFromPipelineQueue(item.id), `${item.code} removed.`)
            }}>Remove</button>
        </div>
      </div>

      {item.total > 0 && !fresh && (
        <div className="mt-3">
          {/* ⚠ NOT a lot count. `total` is every stage pass the sale still has to do — a lot
              goes through batch, key points and double check — so a 601-lot sale reads ~1693.
              It was labelled "lots" here and read as nonsense. */}
          <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400 mb-1">
            <span title={isUpgrade ? "One rewrite per lot" : "Each lot goes through up to three stages, so this counts stage passes rather than lots"}>
              {item.done} of {item.total} {isUpgrade ? "lots" : "steps"}{item.skipped > 0 ? ` · ${item.skipped} refused` : ""}
            </span>
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
  auctions, queuedByKind, busy, onCancel, onSubmit,
}: {
  auctions: Auction[]
  queuedByKind: Record<QueueKind, string[]>
  busy: boolean
  onCancel: () => void
  onSubmit: (code: string, settings: QueueSettings) => void
}) {
  const [kind, setKind] = useState<QueueKind>("pipeline")
  const [code, setCode] = useState("")
  const [preset, setPreset] = useState("")
  const [model, setModel] = useState("")
  const [fallbackModel, setFallbackModel] = useState("")
  const [autoApply, setAutoApply] = useState(true)
  const [onlyWithPhotos, setOnlyWithPhotos] = useState(false)
  const [skipHasDesc, setSkipHasDesc] = useState(false)
  const [fastMode, setFastMode] = useState(false)
  const [kpRelaxed, setKpRelaxed] = useState(false)
  const [grounded, setGrounded] = useState(false)
  // Same starting point as the AI Upgrade tab.
  const [modes, setModes] = useState<Set<string>>(new Set(["humanise", "grammar"]))
  const [presets, setPresets] = useState<{ key: string; favourite?: boolean }[]>([])
  const [models, setModels] = useState<string[]>([])

  useEffect(() => {
    fetch("/api/auction-ai/presets?full=1").then(r => r.json())
      .then(d => { if (Array.isArray(d)) setPresets(d) }).catch(() => {})

    // ⚠ The form OPENS on what Admin → AI Models is set to, the same as the nine
    // other model pickers in the app. It used to open on whatever Google's list
    // happened to return first, so a sale queued without touching these boxes ran
    // on an arbitrary model and the central setting was quietly ignored.
    // Both are still per-sale choices — this only decides the starting point.
    //
    // One request each, awaited together, because the default has to WIN over the
    // first-in-the-list stopgap: run separately, whichever landed first would stick.
    Promise.all([
      fetch("/api/auction-ai/models").then(r => r.json()).catch(() => ({})),
      fetch("/api/ai-tool-model?slot=catalogue_batch").then(r => r.json()).catch(() => ({})),
    ]).then(([list, dflt]) => {
      const available: string[] = Array.isArray(list?.models) ? list.models : []
      if (available.length) setModels(available)
      // A model that has since been disabled is not offered, so it would render as
      // an empty box. When the list itself failed to load we can't tell, so the
      // configured value is trusted rather than thrown away.
      const offered = (id: unknown): id is string =>
        typeof id === "string" && !!id && (available.length === 0 || available.includes(id))

      const main = offered(dflt?.model) ? dflt.model : (available[0] ?? "")
      setModel(m => m || main)
      // The fallback select excludes whatever the main model is, so seeding the two
      // the same would leave the box blank while the state still held a value.
      setFallbackModel(f => (f || (offered(dflt?.fallback) && dflt.fallback !== main ? dflt.fallback : "")))
    })
  }, [])

  const already = useMemo(() => new Set(queuedByKind[kind].map(c => c.toUpperCase())), [queuedByKind, kind])
  const conflictModes = modes.has("shorten") && modes.has("expand")
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

      {/* What kind of run this is. */}
      <div className="flex gap-2">
        {([["pipeline", "⚙ Auto Pipeline", "Batch → Key Points → Double Check"], ["upgrade", "✨ AI Upgrade", "Mass rewrite, held for morning review"]] as const).map(([k, lbl, hint]) => (
          <button key={k} onClick={() => setKind(k)}
            className={`px-4 py-2.5 min-h-[44px] rounded-xl text-sm font-bold border text-left ${
              kind === k
                ? "bg-[#C8A96E]/15 border-[#C8A96E]/60 text-[#C8A96E]"
                : "bg-white dark:bg-[#1C1C1E] border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-500"}`}>
            {lbl}
            <span className="block text-[10px] font-normal opacity-70">{hint}</span>
          </button>
        ))}
      </div>

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
        {kind === "pipeline" && (
          <div>
            <label className={label}>Instruction</label>
            <select value={preset} onChange={e => setPreset(e.target.value)} className={input}>
              <option value="">— none —</option>
              {presets.map(p => <option key={p.key} value={p.key}>{p.favourite ? "★ " : ""}{p.key}</option>)}
            </select>
          </div>
        )}
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

      {kind === "pipeline" ? (
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
          <Toggle checked={fastMode} onChange={setFastMode}
            label="⚡ Quick mode" hint="Works through the lots as fast as the AI will allow instead of a fixed wait, backing off on its own if it starts being refused. Nothing is skipped." />
        </div>
      ) : (
        <div>
          <p className={label}>Upgrade options — same choices as the AI Upgrade tab</p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {UPGRADE_MODES.map(m => {
              const on = modes.has(m.key)
              return (
                <label key={m.key} title={m.desc}
                  className={`flex items-start gap-2 cursor-pointer px-3 py-2 min-h-[44px] rounded-lg border text-xs ${
                    on
                      ? "bg-[#C8A96E]/15 border-[#C8A96E]/60 text-[#C8A96E]"
                      : "bg-white dark:bg-[#1C1C1E] border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-500"}`}>
                  <input type="checkbox" checked={on}
                    onChange={() => setModes(prev => { const n = new Set(prev); if (n.has(m.key)) n.delete(m.key); else n.add(m.key); return n })}
                    className="mt-0.5 w-4 h-4 accent-[#C8A96E] shrink-0" />
                  <span>
                    <span className="block font-semibold leading-tight">{m.label}</span>
                    <span className="block text-[10px] opacity-60 mt-0.5 leading-tight">{m.desc}</span>
                  </span>
                </label>
              )
            })}
          </div>
          {conflictModes && (
            <p className="text-xs text-amber-500 mt-2">⚠ Shorten and Add more detail are opposites — the AI will attempt both but results may vary.</p>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            Every lot with a description is rewritten overnight and <strong>held here for review</strong> — nothing
            touches the catalogue until you accept it in the morning.
          </p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          disabled={busy || !code || (kind === "upgrade" && modes.size === 0)}
          onClick={() => onSubmit(code, {
            kind, upgradeModes: kind === "upgrade" ? Array.from(modes).join(",") : "",
            preset: kind === "pipeline" ? preset : "", model, fallbackModel,
            grounded: kind === "pipeline" && grounded,
            autoApply: kind === "pipeline" && autoApply,
            onlyWithPhotos: kind === "pipeline" && onlyWithPhotos,
            skipHasDesc: kind === "pipeline" && skipHasDesc,
            kpRelaxed: kind === "pipeline" && kpRelaxed,
            fastMode: kind === "pipeline" && fastMode,
          })}
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
