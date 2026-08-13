"use client"

// Marketing Business Plan — the whole editor.
//
// Layout mirrors the order a plan is read in: where we are now → objectives →
// channel plan → audience & competitors. Everything saves through the server
// actions in lib/actions/marketing-plans.ts, which RETURN their errors (never
// throw), so a failure shows the real reason rather than the production
// "An error occurred…" mask.

import { useState, useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import {
  createMarketingPlan, updateMarketingPlan, refreshPlanSnapshot, deleteMarketingPlan,
  addPlanObjective, updatePlanObjective, deletePlanObjective,
  addPlanAction, updatePlanAction, deletePlanAction,
} from "@/lib/actions/marketing-plans"
import { PLAN_CHANNELS, ACTION_STATUSES, EFFORT_LEVELS, channelLabel, fmtNum, higherIsBetter, type PlanSnapshot } from "@/lib/marketing-plan"
import { maybeReloadForSkew } from "@/lib/skew-reload"
import SuggestModal from "./suggest-modal"

// ─── Types (mirror what the server page sends) ──────────────────────────────
export type PlanListItem = { id: string; name: string; periodLabel: string | null; status: string; updatedAt: string }
export type Objective = {
  id: string; title: string; metric: string | null; baseline: string | null
  target: string | null; dueBy: string | null; notes: string | null; source: string
}
export type Action = {
  id: string; channel: string; title: string; detail: string | null; owner: string | null
  dueBy: string | null; effort: string | null; impact: string | null; status: string; source: string
}
export type Plan = {
  id: string; name: string; periodLabel: string | null; status: string
  rangeKey: string; ukOnly: boolean; excludeBots: boolean
  summary: string | null; audience: string | null; competitors: string | null
  createdBy: string | null
  snapshot: PlanSnapshot | null; snapshotAt: string | null
  objectives: Objective[]; actions: Action[]
}

const card  = "bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800"
const input = "px-3 py-2 rounded-xl text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-pink-500"
const btn   = "px-3.5 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
const btnPrimary = `${btn} bg-pink-600 hover:bg-pink-700 text-white`
const btnGhost   = `${btn} bg-gray-100 dark:bg-[#2C2C2E] text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white`

const RANGES = [
  { key: "7d",   label: "7 days" },
  { key: "28d",  label: "28 days" },
  { key: "90d",  label: "90 days" },
  { key: "365d", label: "1 year" },
]

function fmtWhen(iso: string | null): string {
  if (!iso) return "never"
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

export default function PlanWorkspace({
  plans, plan, gaConfigured,
}: {
  plans: PlanListItem[]
  plan: Plan | null
  gaConfigured: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [warn, setWarn]   = useState<string | null>(null)
  const [note, setNote]   = useState<string | null>(null)
  const [showNew, setShowNew]     = useState(false)
  const [showSuggest, setSuggest] = useState(false)

  // Every action goes through here so an error is always shown, never swallowed.
  // ⚠ The try/catch matters as much as the !res.ok branch: the actions return
  // their business errors, but a REJECTION still happens on a stale-deploy
  // action miss (the shared iPads sit open across a deploy). Without it the
  // button simply resets and the user believes the save worked.
  function run(fn: () => Promise<{ ok: boolean; error?: string; id?: string; warning?: string }>, okMsg?: string, after?: (id?: string) => void) {
    setError(null); setWarn(null); setNote(null)
    start(async () => {
      try {
        const res = await fn()
        if (!res.ok) { setError(res.error ?? "Something went wrong"); return }
        // A warning means it worked but not fully — say so instead of the tick.
        if (res.warning) setWarn(res.warning)
        else if (okMsg) setNote(okMsg)
        after?.(res.id)
        router.refresh()
      } catch (e: any) {
        if (!maybeReloadForSkew(e)) setError(e?.message ?? "Couldn't reach the server — nothing was saved.")
      }
    })
  }

  return (
    <div className="space-y-5">
      {/* ── Plan switcher ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        {plans.length > 0 && (
          <select
            value={plan?.id ?? ""}
            onChange={(e) => router.push(`/tools/marketing-reports/plan?id=${e.target.value}`)}
            className="px-3 py-2 rounded-xl text-sm font-semibold bg-gray-100 dark:bg-[#2C2C2E] text-gray-700 dark:text-gray-200 border-none focus:outline-none focus:ring-2 focus:ring-pink-500 cursor-pointer"
            title="Switch plan"
          >
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.periodLabel ? ` — ${p.periodLabel}` : ""}{p.status === "ARCHIVED" ? " (archived)" : ""}
              </option>
            ))}
          </select>
        )}
        <button onClick={() => setShowNew(true)} className={btnPrimary}>+ New plan</button>
        {plan && (
          <>
            <a href={`/api/marketing/plan-pdf?id=${plan.id}`} className={btnGhost}>🖨 Download PDF</a>
            <button
              onClick={() => setSuggest(true)}
              disabled={!plan.snapshot}
              className={`${btn} bg-purple-600 hover:bg-purple-700 text-white`}
              title={plan.snapshot ? "Suggest objectives and actions from these figures" : "Refresh the figures first"}
            >
              ✨ AI suggestions
            </button>
            <span className="ml-auto text-xs text-gray-400">
              {plan.createdBy ? `Written by ${plan.createdBy} · ` : ""}Figures taken {fmtWhen(plan.snapshotAt)}
            </span>
          </>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
      {warn && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          {warn}
        </div>
      )}
      {note && (
        <div className="rounded-xl border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/40 px-4 py-3 text-sm text-green-700 dark:text-green-300">
          {note}
        </div>
      )}

      {!plan ? (
        <div className={`${card} p-8 text-center`}>
          <p className="text-lg font-bold text-gray-900 dark:text-white mb-1">No plans yet</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Start one and the current analytics figures are captured with it, ready to build objectives on.
          </p>
          <button onClick={() => setShowNew(true)} className={btnPrimary}>+ New plan</button>
        </div>
      ) : (
        // ⚠ key={plan.id} is load-bearing. Switching plans is a search-param-only
        // navigation, which Next deliberately does NOT treat as a state reset — so
        // without this the editors below keep the PREVIOUS plan's text in useState
        // and the next save writes it onto the newly-selected plan.
        <PlanBody key={plan.id} plan={plan} run={run} pending={pending} gaConfigured={gaConfigured} />
      )}

      {showNew && (
        <NewPlanModal
          gaConfigured={gaConfigured}
          pending={pending}
          onClose={() => setShowNew(false)}
          onCreate={(fields) => run(
            () => createMarketingPlan(fields),
            "Plan created.",
            (id) => { setShowNew(false); if (id) router.push(`/tools/marketing-reports/plan?id=${id}`) },
          )}
        />
      )}

      {showSuggest && plan && (
        <SuggestModal planId={plan.id} onClose={() => setSuggest(false)} onAdded={() => { setSuggest(false); router.refresh() }} />
      )}
    </div>
  )
}

// ═══ The plan itself ═══════════════════════════════════════════════════════
type Run = (fn: () => Promise<{ ok: boolean; error?: string; id?: string; warning?: string }>, okMsg?: string, after?: (id?: string) => void) => void

function PlanBody({ plan, run, pending, gaConfigured }: { plan: Plan; run: Run; pending: boolean; gaConfigured: boolean }) {
  return (
    <div className="space-y-5">
      <PlanHeaderCard plan={plan} run={run} pending={pending} gaConfigured={gaConfigured} />
      <WhereWeAreNow plan={plan} run={run} pending={pending} />
      <Objectives plan={plan} run={run} pending={pending} />
      <ChannelPlan plan={plan} run={run} pending={pending} />
      <AudienceAndCompetitors plan={plan} run={run} pending={pending} />
    </div>
  )
}

function PlanHeaderCard({ plan, run, pending, gaConfigured }: { plan: Plan; run: Run; pending: boolean; gaConfigured: boolean }) {
  const [name, setName]     = useState(plan.name)
  const [period, setPeriod] = useState(plan.periodLabel ?? "")
  const [range, setRange]   = useState(plan.rangeKey)
  const [uk, setUk]         = useState(plan.ukOnly)
  const [bots, setBots]     = useState(plan.excludeBots)

  return (
    <div className={`${card} p-4`}>
      <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_auto] gap-3 items-end">
        <label className="block">
          <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Plan name</span>
          <input
            className={`${input} w-full`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name !== plan.name && run(() => updateMarketingPlan(plan.id, { name }))}
          />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Period</span>
          <input
            className={`${input} w-full`}
            placeholder="e.g. Q4 2026"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            onBlur={() => period !== (plan.periodLabel ?? "") && run(() => updateMarketingPlan(plan.id, { periodLabel: period }))}
          />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Status</span>
          <select
            className={`${input} w-full`}
            value={plan.status}
            onChange={(e) => run(() => updateMarketingPlan(plan.id, { status: e.target.value }))}
          >
            <option value="DRAFT">Draft</option>
            <option value="ACTIVE">Active</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </label>
      </div>

      <div className="flex items-center gap-2 flex-wrap mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Figures from</span>
        <select className={input} value={range} onChange={(e) => setRange(e.target.value)}>
          {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
          <input type="checkbox" className="w-4 h-4 accent-pink-600" checked={uk} onChange={(e) => setUk(e.target.checked)} />
          UK only
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
          <input type="checkbox" className="w-4 h-4 accent-pink-600" checked={bots} onChange={(e) => setBots(e.target.checked)} />
          Hide bot traffic
        </label>
        <button
          className={btnGhost}
          disabled={pending || !gaConfigured}
          title={gaConfigured ? "Re-read Google Analytics and freeze the new figures onto this plan" : "Google Analytics isn't connected on this environment"}
          onClick={() => run(
            () => refreshPlanSnapshot(plan.id, { range, ukOnly: uk, excludeBots: bots }),
            "Figures refreshed.",
          )}
        >
          ⟳ Refresh figures
        </button>
        <button
          className={`${btn} ml-auto text-red-500 hover:text-red-700`}
          disabled={pending}
          onClick={() => {
            if (!confirm(`Delete the plan "${plan.name}"? This cannot be undone.`)) return
            run(() => deleteMarketingPlan(plan.id), "Plan deleted.")
          }}
        >
          Delete plan
        </button>
      </div>
      <p className="text-xs text-gray-400 mt-2">
        The figures are frozen onto the plan when you refresh them, so the plan and its PDF always show the numbers it was written against.
      </p>
    </div>
  )
}

// ─── 1. Where we are now ────────────────────────────────────────────────────
function WhereWeAreNow({ plan, run, pending }: { plan: Plan; run: Run; pending: boolean }) {
  const [text, setText] = useServerText(plan.summary)
  const snap = plan.snapshot
  const dirty = text !== (plan.summary ?? "")

  return (
    <div className={`${card} p-4`}>
      <SectionHead title="Where we are now" hint="The figures this plan is built on, and what they say in words." />

      {!snap ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No figures attached yet — use <strong>⟳ Refresh figures</strong> above to capture them.
        </p>
      ) : (
        <>
          <p className="text-xs text-gray-400 mb-3">
            {snap.rangeLabel}
            {snap.ukOnly ? " · UK visitors only" : ""}
            {snap.excludeBots ? " · bot-heavy countries excluded" : ""}
            {" · change shown against the previous period"}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
            {snap.stats.map((s) => (
              <div key={s.key} className="rounded-xl border border-gray-200 dark:border-gray-800 p-3">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{s.label}</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white mt-0.5">{s.value}</p>
                <Delta pct={s.delta} label={s.label} />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-4">
            {snap.sections.filter((sec) => sec.rows.length > 0).map((sec) => (
              <div key={sec.id} className="rounded-xl border border-gray-200 dark:border-gray-800 p-3">
                <p className="text-[11px] font-semibold text-pink-600 dark:text-pink-400 uppercase tracking-wide mb-1.5">{sec.title}</p>
                <ul className="space-y-1">
                  {sec.rows.slice(0, 6).map((r) => (
                    <li key={r.name} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-gray-600 dark:text-gray-300 truncate">{r.name}</span>
                      <span className="font-semibold text-gray-900 dark:text-white shrink-0">{fmtNum(r.value)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}

      <label className="block">
        <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Summary — what the figures say</span>
        <textarea
          className={`${input} w-full min-h-[110px]`}
          placeholder="Two or three sentences on where the website stands this period."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <SaveRow dirty={dirty} pending={pending} onSave={() => run(() => updateMarketingPlan(plan.id, { summary: text }), "Summary saved.")} />
    </div>
  )
}

function Delta({ pct, label }: { pct: number | null; label: string }) {
  if (pct === null || !isFinite(pct)) return <span className="text-[11px] text-gray-400">no comparison</span>
  const up = pct >= 0
  // Shared with the PDF so the same movement can't print red here and green there
  // — a falling bounce rate is good news on both.
  const good = up === higherIsBetter(label)
  return (
    <span className={`text-[11px] font-semibold ${good ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
      {up ? "↑" : "↓"} {Math.abs(pct * 100).toFixed(1)}%
    </span>
  )
}

// ─── 2. Objectives & KPIs ───────────────────────────────────────────────────
function Objectives({ plan, run, pending }: { plan: Plan; run: Run; pending: boolean }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({ title: "", metric: "", baseline: "", target: "", dueBy: "", notes: "" })
  const metricOptions = plan.snapshot?.stats ?? []

  function add() {
    run(() => addPlanObjective(plan.id, draft), "Objective added.", () => {
      setDraft({ title: "", metric: "", baseline: "", target: "", dueBy: "", notes: "" })
      setOpen(false)
    })
  }

  return (
    <div className={`${card} p-4`}>
      <SectionHead
        title={`Objectives & KPIs (${plan.objectives.length})`}
        hint="What we want to move, from where to where."
        right={<button className={btnGhost} onClick={() => setOpen((v) => !v)}>{open ? "Cancel" : "+ Add objective"}</button>}
      />

      {open && (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-3 mb-4 space-y-2">
          <input className={`${input} w-full`} placeholder="Objective — e.g. Grow organic search sessions" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <select className={input} value={draft.metric} onChange={(e) => {
              const m = e.target.value
              const stat = metricOptions.find((s) => s.label === m)
              setDraft({ ...draft, metric: m, baseline: stat ? stat.value : draft.baseline })
            }}>
              <option value="">Measured on…</option>
              {metricOptions.map((s) => <option key={s.key} value={s.label}>{s.label}</option>)}
              <option value="Other">Other</option>
            </select>
            <input className={input} placeholder="Now" value={draft.baseline} onChange={(e) => setDraft({ ...draft, baseline: e.target.value })} />
            <input className={input} placeholder="Target" value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} />
            <input className={input} placeholder="By when" value={draft.dueBy} onChange={(e) => setDraft({ ...draft, dueBy: e.target.value })} />
          </div>
          <input className={`${input} w-full`} placeholder="Notes (optional)" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          <button className={btnPrimary} disabled={pending || !draft.title.trim()} onClick={add}>Add objective</button>
        </div>
      )}

      {plan.objectives.length === 0 ? (
        <Empty text="No objectives yet — add one, or use ✨ AI suggestions to get a starting set from the figures." />
      ) : (
        <div className="space-y-2">
          {plan.objectives.map((o) => <ObjectiveRow key={o.id} o={o} run={run} pending={pending} metricOptions={metricOptions.map((s) => s.label)} />)}
        </div>
      )}
    </div>
  )
}

function ObjectiveRow({ o, run, pending, metricOptions }: { o: Objective; run: Run; pending: boolean; metricOptions: string[] }) {
  const [f, setF] = useState({
    title: o.title, metric: o.metric ?? "", baseline: o.baseline ?? "",
    target: o.target ?? "", dueBy: o.dueBy ?? "", notes: o.notes ?? "",
  })
  const save = (patch: Partial<typeof f>) => run(() => updatePlanObjective(o.id, patch))

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-3">
      <div className="flex items-start gap-2">
        <input
          className={`${input} flex-1 font-semibold`}
          value={f.title}
          onChange={(e) => setF({ ...f, title: e.target.value })}
          onBlur={() => f.title !== o.title && save({ title: f.title })}
        />
        {o.source === "ai" && <span className="text-[10px] font-bold text-purple-500 border border-purple-300 dark:border-purple-800 rounded px-1.5 py-1 shrink-0" title="Suggested by AI">AI</span>}
        <button
          className="text-red-500 hover:text-red-700 text-sm font-semibold px-2 py-2 shrink-0"
          disabled={pending}
          onClick={() => confirm("Delete this objective?") && run(() => deletePlanObjective(o.id))}
        >
          Delete
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
        <select className={input} value={f.metric} onChange={(e) => { setF({ ...f, metric: e.target.value }); save({ metric: e.target.value }) }}>
          <option value="">Measured on…</option>
          {metricOptions.map((m) => <option key={m} value={m}>{m}</option>)}
          {f.metric && !metricOptions.includes(f.metric) && <option value={f.metric}>{f.metric}</option>}
        </select>
        <input className={input} placeholder="Now"     value={f.baseline} onChange={(e) => setF({ ...f, baseline: e.target.value })} onBlur={() => f.baseline !== (o.baseline ?? "") && save({ baseline: f.baseline })} />
        <input className={input} placeholder="Target"  value={f.target}   onChange={(e) => setF({ ...f, target: e.target.value })}   onBlur={() => f.target   !== (o.target ?? "")   && save({ target: f.target })} />
        <input className={input} placeholder="By when" value={f.dueBy}    onChange={(e) => setF({ ...f, dueBy: e.target.value })}    onBlur={() => f.dueBy    !== (o.dueBy ?? "")    && save({ dueBy: f.dueBy })} />
      </div>
      <input
        className={`${input} w-full mt-2 text-sm`}
        placeholder="Notes (optional)"
        value={f.notes}
        onChange={(e) => setF({ ...f, notes: e.target.value })}
        onBlur={() => f.notes !== (o.notes ?? "") && save({ notes: f.notes })}
      />
    </div>
  )
}

// ─── 3. Channel plan ────────────────────────────────────────────────────────
function ChannelPlan({ plan, run, pending }: { plan: Plan; run: Run; pending: boolean }) {
  const [addTo, setAddTo] = useState<string | null>(null)
  const [draft, setDraft] = useState({ title: "", detail: "", owner: "", dueBy: "", effort: "", impact: "" })

  function add(channel: string) {
    run(() => addPlanAction(plan.id, { ...draft, channel }), "Action added.", () => {
      setDraft({ title: "", detail: "", owner: "", dueBy: "", effort: "", impact: "" })
      setAddTo(null)
    })
  }

  const done = plan.actions.filter((a) => a.status === "DONE").length

  return (
    <div className={`${card} p-4`}>
      <SectionHead
        title={`Channel plan (${plan.actions.length} action${plan.actions.length === 1 ? "" : "s"})`}
        hint={plan.actions.length > 0 ? `${done} of ${plan.actions.length} done. What we're actually going to do, by channel.` : "What we're actually going to do, by channel."}
      />

      <div className="space-y-4">
        {PLAN_CHANNELS.map((ch) => {
          const rows = plan.actions.filter((a) => a.channel === ch.key)
          return (
            <div key={ch.key}>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-sm font-bold text-pink-600 dark:text-pink-400">{ch.label}</h3>
                <span className="text-xs text-gray-400">{ch.hint}</span>
                <button
                  className="ml-auto text-xs font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white px-2 py-1"
                  onClick={() => setAddTo(addTo === ch.key ? null : ch.key)}
                >
                  {addTo === ch.key ? "Cancel" : "+ Add"}
                </button>
              </div>

              {addTo === ch.key && (
                <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-3 mb-2 space-y-2">
                  <input className={`${input} w-full`} placeholder={`What are we doing? — e.g. ${ch.key === "organic" ? "Rewrite the diecast landing page titles" : "Short description of the action"}`} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                  <input className={`${input} w-full`} placeholder="Detail — and which figure justifies it (optional)" value={draft.detail} onChange={(e) => setDraft({ ...draft, detail: e.target.value })} />
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <input className={input} placeholder="Owner"   value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} />
                    <input className={input} placeholder="By when" value={draft.dueBy} onChange={(e) => setDraft({ ...draft, dueBy: e.target.value })} />
                    <select className={input} value={draft.effort} onChange={(e) => setDraft({ ...draft, effort: e.target.value })}>
                      <option value="">Effort…</option>
                      {EFFORT_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                    <select className={input} value={draft.impact} onChange={(e) => setDraft({ ...draft, impact: e.target.value })}>
                      <option value="">Impact…</option>
                      {EFFORT_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </div>
                  <button className={btnPrimary} disabled={pending || !draft.title.trim()} onClick={() => add(ch.key)}>Add action</button>
                </div>
              )}

              {rows.length === 0
                ? <p className="text-sm text-gray-400 pl-0.5">Nothing planned for this channel yet.</p>
                : <div className="space-y-2">{rows.map((a) => <ActionRow key={a.id} a={a} run={run} pending={pending} />)}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ActionRow({ a, run, pending }: { a: Action; run: Run; pending: boolean }) {
  const [f, setF] = useState({
    title: a.title, detail: a.detail ?? "", owner: a.owner ?? "",
    dueBy: a.dueBy ?? "", effort: a.effort ?? "", impact: a.impact ?? "", channel: a.channel,
  })
  const save = (patch: Partial<typeof f> & { status?: string }) => run(() => updatePlanAction(a.id, patch))
  const done = a.status === "DONE"

  return (
    <div className={`rounded-xl border p-3 ${done ? "border-green-300 dark:border-green-900 bg-green-50/50 dark:bg-green-950/20" : "border-gray-200 dark:border-gray-800"}`}>
      <div className="flex items-start gap-2">
        <input
          className={`${input} flex-1 font-semibold ${done ? "line-through text-gray-400" : ""}`}
          value={f.title}
          onChange={(e) => setF({ ...f, title: e.target.value })}
          onBlur={() => f.title !== a.title && save({ title: f.title })}
        />
        {a.source === "ai" && <span className="text-[10px] font-bold text-purple-500 border border-purple-300 dark:border-purple-800 rounded px-1.5 py-1 shrink-0" title="Suggested by AI">AI</span>}
        <button
          className="text-red-500 hover:text-red-700 text-sm font-semibold px-2 py-2 shrink-0"
          disabled={pending}
          onClick={() => confirm("Delete this action?") && run(() => deletePlanAction(a.id))}
        >
          Delete
        </button>
      </div>

      <input
        className={`${input} w-full mt-2 text-sm`}
        placeholder="Detail — and which figure justifies it"
        value={f.detail}
        onChange={(e) => setF({ ...f, detail: e.target.value })}
        onBlur={() => f.detail !== (a.detail ?? "") && save({ detail: f.detail })}
      />

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mt-2">
        <input className={input} placeholder="Owner"   value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} onBlur={() => f.owner !== (a.owner ?? "") && save({ owner: f.owner })} />
        <input className={input} placeholder="By when" value={f.dueBy} onChange={(e) => setF({ ...f, dueBy: e.target.value })} onBlur={() => f.dueBy !== (a.dueBy ?? "") && save({ dueBy: f.dueBy })} />
        <select className={input} value={f.effort} onChange={(e) => { setF({ ...f, effort: e.target.value }); save({ effort: e.target.value }) }}>
          <option value="">Effort…</option>
          {EFFORT_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select className={input} value={f.impact} onChange={(e) => { setF({ ...f, impact: e.target.value }); save({ impact: e.target.value }) }}>
          <option value="">Impact…</option>
          {EFFORT_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select className={input} value={f.channel} onChange={(e) => { setF({ ...f, channel: e.target.value }); save({ channel: e.target.value }) }} title="Move to another channel">
          {PLAN_CHANNELS.map((c) => <option key={c.key} value={c.key}>{channelLabel(c.key)}</option>)}
        </select>
        <select className={input} value={a.status} onChange={(e) => save({ status: e.target.value })}>
          {ACTION_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>
    </div>
  )
}

// ─── 4. Audience & competitors ──────────────────────────────────────────────
function AudienceAndCompetitors({ plan, run, pending }: { plan: Plan; run: Run; pending: boolean }) {
  const [aud, setAud]   = useServerText(plan.audience)
  const [comp, setComp] = useServerText(plan.competitors)
  const snap = plan.snapshot
  const where = snap?.sections.find((s) => s.id === "countries")
  const regions = snap?.sections.find((s) => s.id === "regions")
  const devices = snap?.sections.find((s) => s.id === "devices")
  const returning = snap?.sections.find((s) => s.id === "newReturning")

  return (
    <div className={`${card} p-4`}>
      <SectionHead title="Audience & competitors" hint="Who's actually visiting, and who else is chasing them." />

      {snap && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          {[where, regions, devices, returning].filter(Boolean).map((sec) => (
            <div key={sec!.id} className="rounded-xl border border-gray-200 dark:border-gray-800 p-3">
              <p className="text-[11px] font-semibold text-pink-600 dark:text-pink-400 uppercase tracking-wide mb-1.5">{sec!.title}</p>
              <ul className="space-y-1">
                {sec!.rows.slice(0, 5).map((r) => (
                  <li key={r.name} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-gray-600 dark:text-gray-300 truncate">{r.name}</span>
                    <span className="font-semibold text-gray-900 dark:text-white shrink-0">{fmtNum(r.value)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <label className="block">
            <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Who we&apos;re targeting</span>
            <textarea className={`${input} w-full min-h-[120px]`} placeholder="Who the figures say is visiting, and who we want more of." value={aud} onChange={(e) => setAud(e.target.value)} />
          </label>
          <SaveRow dirty={aud !== (plan.audience ?? "")} pending={pending} onSave={() => run(() => updateMarketingPlan(plan.id, { audience: aud }), "Audience notes saved.")} />
        </div>
        <div>
          <label className="block">
            <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Competitors</span>
            <textarea className={`${input} w-full min-h-[120px]`} placeholder="Other salerooms and marketplaces chasing the same buyers, and what they do differently." value={comp} onChange={(e) => setComp(e.target.value)} />
          </label>
          <SaveRow dirty={comp !== (plan.competitors ?? "")} pending={pending} onSave={() => run(() => updateMarketingPlan(plan.id, { competitors: comp }), "Competitor notes saved.")} />
        </div>
      </div>
    </div>
  )
}

// ─── Shared bits ────────────────────────────────────────────────────────────

/** A textarea whose text is edited locally but must FOLLOW the server value when
 *  that genuinely changes — which is what happens when ✨ AI suggestions appends
 *  to the summary or audience. Without this the box still shows the pre-suggestion
 *  text, so the added paragraph is invisible and pressing Save writes the old text
 *  back over it. React's documented "adjust state during render" pattern: it fires
 *  only on a real change of the server value, so an unrelated refresh can't wipe
 *  what someone is part-way through typing. */
function useServerText(serverValue: string | null): [string, (v: string) => void] {
  const initial = serverValue ?? ""
  const [text, setText] = useState(initial)
  const [seen, setSeen] = useState(initial)
  if (seen !== initial) { setSeen(initial); setText(initial) }
  return [text, setText]
}

function SectionHead({ title, hint, right }: { title: string; hint?: string; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h2>
        {hint && <p className="text-sm text-gray-500 dark:text-gray-400">{hint}</p>}
      </div>
      {right}
    </div>
  )
}

function SaveRow({ dirty, pending, onSave }: { dirty: boolean; pending: boolean; onSave: () => void }) {
  return (
    <div className="flex items-center gap-2 mt-2">
      <button className={btnPrimary} disabled={!dirty || pending} onClick={onSave}>Save</button>
      {dirty && <span className="text-xs text-amber-600 dark:text-amber-400">Unsaved changes</span>}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-gray-500 dark:text-gray-400">{text}</p>
}

// ─── New plan ───────────────────────────────────────────────────────────────
function NewPlanModal({
  gaConfigured, pending, onClose, onCreate,
}: {
  gaConfigured: boolean
  pending: boolean
  onClose: () => void
  onCreate: (f: { name: string; periodLabel: string; range: string; ukOnly: boolean; excludeBots: boolean }) => void
}) {
  const [name, setName]     = useState("")
  const [period, setPeriod] = useState("")
  const [range, setRange]   = useState("28d")
  const [uk, setUk]         = useState(false)
  const [bots, setBots]     = useState(true)

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 sm:p-8 overflow-y-auto" onClick={onClose}>
      <div className={`${card} w-full max-w-lg p-5`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">New marketing plan</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl leading-none">&times;</button>
        </div>

        <label className="block mb-3">
          <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Plan name</span>
          <input className={`${input} w-full`} autoFocus placeholder="e.g. Autumn growth plan" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block mb-3">
          <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Period (optional)</span>
          <input className={`${input} w-full`} placeholder="e.g. Q4 2026" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </label>

        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Capture the figures from</p>
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <select className={input} value={range} onChange={(e) => setRange(e.target.value)}>
            {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
            <input type="checkbox" className="w-4 h-4 accent-pink-600" checked={uk} onChange={(e) => setUk(e.target.checked)} />
            UK only
          </label>
          <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
            <input type="checkbox" className="w-4 h-4 accent-pink-600" checked={bots} onChange={(e) => setBots(e.target.checked)} />
            Hide bot traffic
          </label>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          {gaConfigured
            ? "These figures are frozen onto the plan, so its targets and its PDF stay tied to the numbers you started from."
            : "Google Analytics isn't connected on this environment — the plan will start with no figures."}
        </p>

        <div className="flex items-center gap-2">
          <button className={btnPrimary} disabled={pending || !name.trim()} onClick={() => onCreate({ name, periodLabel: period, range, ukOnly: uk, excludeBots: bots })}>
            {pending ? "Creating…" : "Create plan"}
          </button>
          <button className={btnGhost} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
