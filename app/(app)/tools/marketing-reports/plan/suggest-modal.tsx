"use client"

// ✨ AI suggestions for a marketing plan.
//
// The model reads the figures FROZEN on the plan and proposes objectives and
// actions. Nothing is written until the user ticks it and presses Add — a
// suggestion is a draft, never an edit. Free text (summary / audience) is
// APPENDED by the server action, so accepting a suggestion can never wipe
// something that was typed by hand.

import { useState, type ReactNode } from "react"
import { addPlanSuggestions } from "@/lib/actions/marketing-plans"
import { channelLabel } from "@/lib/marketing-plan"

type SuggestedObjective = { title: string; metric: string; baseline: string; target: string; notes: string }
type SuggestedAction    = { channel: string; title: string; detail: string; effort: string; impact: string }
type Suggestions = {
  model: string
  summary: string
  audience: string
  objectives: SuggestedObjective[]
  actions: SuggestedAction[]
}

const card  = "bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800"
const input = "px-3 py-2 rounded-xl text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
const btn   = "px-3.5 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"

export default function SuggestModal({
  planId, onClose, onAdded,
}: {
  planId: string
  onClose: () => void
  onAdded: () => void
}) {
  const [focus, setFocus]   = useState("")
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [data, setData]     = useState<Suggestions | null>(null)
  const [objOn, setObjOn]   = useState<boolean[]>([])
  const [actOn, setActOn]   = useState<boolean[]>([])
  const [useSummary, setUseSummary]   = useState(true)
  const [useAudience, setUseAudience] = useState(true)

  async function generate() {
    setBusy(true); setError(null)
    try {
      const res = await fetch("/api/marketing/plan-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, focus }),
      })
      // The route always returns JSON, including for its error cases.
      const json = await res.json().catch(() => ({ error: "The server sent something unreadable." }))
      if (!res.ok) { setError(json?.error ?? `Request failed (${res.status})`); return }
      const d = json as Suggestions
      setData(d)
      setObjOn(d.objectives.map(() => true))
      setActOn(d.actions.map(() => true))
      setUseSummary(!!d.summary)
      setUseAudience(!!d.audience)
    } catch (e: any) {
      setError(e?.message ?? "Couldn't reach the server")
    } finally {
      setBusy(false)
    }
  }

  async function add() {
    if (!data) return
    setBusy(true); setError(null)
    try {
      const res = await addPlanSuggestions(planId, {
        objectives: data.objectives.filter((_, i) => objOn[i]),
        actions:    data.actions.filter((_, i) => actOn[i]),
        summary:    useSummary  ? data.summary  : "",
        audience:   useAudience ? data.audience : "",
      })
      if (!res.ok) { setError(res.error ?? "Could not add the suggestions"); return }
      onAdded()
    } finally {
      setBusy(false)
    }
  }

  const picked = objOn.filter(Boolean).length + actOn.filter(Boolean).length

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 sm:p-8 overflow-y-auto" onClick={onClose}>
      <div className={`${card} w-full max-w-4xl p-5`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">✨ AI suggestions</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl leading-none">&times;</button>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Reads the figures saved on this plan and suggests what to do about them. Nothing is added until you tick it and press Add.
        </p>

        {!data ? (
          <>
            <label className="block mb-3">
              <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Anything to focus on? (optional)</span>
              <input
                className={`${input} w-full`}
                placeholder="e.g. getting more vendors consigning, or growing the Star Wars audience"
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
              />
            </label>
            {error && <ErrorBox text={error} />}
            <button className={`${btn} bg-purple-600 hover:bg-purple-700 text-white`} disabled={busy} onClick={generate}>
              {busy ? "Thinking… (up to a minute)" : "Generate suggestions"}
            </button>
          </>
        ) : (
          <>
            {error && <ErrorBox text={error} />}

            {(data.summary || data.audience) && (
              <div className="space-y-2 mb-4">
                {data.summary && (
                  <TickBlock on={useSummary} onToggle={() => setUseSummary((v) => !v)} label="Summary — added to “Where we are now”">
                    <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{data.summary}</p>
                  </TickBlock>
                )}
                {data.audience && (
                  <TickBlock on={useAudience} onToggle={() => setUseAudience((v) => !v)} label="Audience — added to “Who we're targeting”">
                    <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{data.audience}</p>
                  </TickBlock>
                )}
                <p className="text-xs text-gray-400">These are added underneath whatever is already written — nothing you typed is replaced.</p>
              </div>
            )}

            {data.objectives.length > 0 && (
              <>
                <Head text={`Objectives (${objOn.filter(Boolean).length}/${data.objectives.length})`} onAll={(v) => setObjOn(data.objectives.map(() => v))} />
                <div className="space-y-2 mb-4">
                  {data.objectives.map((o, i) => (
                    <TickBlock key={i} on={objOn[i]} onToggle={() => setObjOn((p) => p.map((v, j) => (j === i ? !v : v)))} label={o.title}>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {[o.metric && `Measured on ${o.metric}`, o.baseline && `now ${o.baseline}`, o.target && `target ${o.target}`].filter(Boolean).join(" · ")}
                      </p>
                      {o.notes && <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{o.notes}</p>}
                    </TickBlock>
                  ))}
                </div>
              </>
            )}

            {data.actions.length > 0 && (
              <>
                <Head text={`Actions (${actOn.filter(Boolean).length}/${data.actions.length})`} onAll={(v) => setActOn(data.actions.map(() => v))} />
                <div className="space-y-2 mb-4">
                  {data.actions.map((a, i) => (
                    <TickBlock key={i} on={actOn[i]} onToggle={() => setActOn((p) => p.map((v, j) => (j === i ? !v : v)))} label={a.title}>
                      <p className="text-xs text-pink-600 dark:text-pink-400 font-semibold">
                        {channelLabel(a.channel)}
                        {a.effort ? ` · effort ${a.effort.toLowerCase()}` : ""}
                        {a.impact ? ` · impact ${a.impact.toLowerCase()}` : ""}
                      </p>
                      {a.detail && <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{a.detail}</p>}
                    </TickBlock>
                  ))}
                </div>
              </>
            )}

            <div className="flex items-center gap-2 pt-3 border-t border-gray-100 dark:border-gray-800 flex-wrap">
              <button className={`${btn} bg-pink-600 hover:bg-pink-700 text-white`} disabled={busy} onClick={add}>
                {busy ? "Adding…" : `Add ${picked} to the plan`}
              </button>
              <button className={`${btn} bg-gray-100 dark:bg-[#2C2C2E] text-gray-600 dark:text-gray-300`} disabled={busy} onClick={() => { setData(null); setError(null) }}>
                Start again
              </button>
              <span className="text-xs text-gray-400 ml-auto">Written by {data.model}. Check every figure before it leaves the building.</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Head({ text, onAll }: { text: string; onAll: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <h3 className="text-sm font-bold text-gray-900 dark:text-white">{text}</h3>
      <button className="text-xs font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white" onClick={() => onAll(true)}>All</button>
      <button className="text-xs font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white" onClick={() => onAll(false)}>None</button>
    </div>
  )
}

function TickBlock({ on, onToggle, label, children }: { on: boolean; onToggle: () => void; label: string; children?: ReactNode }) {
  return (
    <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${on ? "border-purple-300 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/20" : "border-gray-200 dark:border-gray-800 opacity-60"}`}>
      {/* 44px tick target — these get read on the iPads, not just at a desk. */}
      <input type="checkbox" checked={on} onChange={onToggle} className="w-5 h-5 accent-purple-600 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className="text-sm font-semibold text-gray-900 dark:text-white">{label}</div>
        {children}
      </div>
    </label>
  )
}

function ErrorBox({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300 mb-3">
      {text}
    </div>
  )
}
