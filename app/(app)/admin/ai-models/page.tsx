"use client"

import { useEffect, useMemo, useState } from "react"

type Tool = {
  slot: string
  label: string
  group: string
  default: string
  configured: string | null
  effective: string
}
type ModelRow = {
  id: string
  displayName?: string
  description?: string
  inputTokenLimit?: number
  outputTokenLimit?: number
  enabled: boolean
}
type TestState = { ok: boolean; ms: number; error?: string }

// Plain-English tier description for a model id (mirrors the old Auction AI Models tab).
function describeModel(id: string): string {
  const m = id.toLowerCase()
  if (m.includes("image") || m.includes("imagen")) return "Image generation model — not for cataloguing text."
  if (m.includes("tts") || m.includes("audio"))   return "Audio / speech model — not for cataloguing text."
  if (m.includes("embedding"))                      return "Embedding model — not for cataloguing text."
  let base: string
  if (m.includes("lite")) {
    base = "Fastest and cheapest tier. Best for very high-volume, simple lots where speed matters most — but the lowest quality and most likely to miss detail."
  } else if (m.includes("flash")) {
    base = "The everyday workhorse — fast, low cost, strong balance of speed and quality. Best default for bulk cataloguing."
  } else if (m.includes("pro")) {
    base = "Highest quality and reasoning. Best for tricky identifications and maximum accuracy — but slower and more expensive."
  } else {
    base = "General-purpose Gemini model."
  }
  if (m.includes("preview") || m.includes("exp")) base += " (Preview — newest version, behaviour may still change.)"
  return base
}
function fmtTokens(n?: number): string {
  if (!n) return ""
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1).replace(/\.0$/, "")}M`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}k`
  return String(n)
}

export default function AiModelsPage() {
  const [tools, setTools]       = useState<Tool[]>([])
  const [allModels, setAllModels] = useState<ModelRow[]>([]) // full list incl. disabled, with descriptions
  const [edits, setEdits]       = useState<Record<string, string>>({}) // slot -> chosen value ("" = use default)
  const [bulk, setBulk]         = useState<string>("")        // "Update all" selection
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState("")
  const [savedAt, setSavedAt]   = useState(0)
  const [tests, setTests]       = useState<Record<string, TestState | "testing">>({})
  const [testingAll, setTestingAll] = useState(false)

  async function load() {
    setLoading(true); setError("")
    try {
      const [tr, mr] = await Promise.all([
        fetch("/api/admin/ai-models").then((r) => r.json()),
        fetch("/api/auction-ai/model-config").then((r) => r.json()),
      ])
      if (tr.error) throw new Error(tr.error)
      setTools(tr.tools ?? [])
      setEdits(Object.fromEntries((tr.tools ?? []).map((t: Tool) => [t.slot, t.configured ?? ""])))
      setAllModels(mr.models ?? [])
    } catch (e: any) {
      setError(e?.message ?? "Failed to load")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  // Models offered in the per-tool dropdowns = the enabled ones.
  const enabledModels = useMemo(
    () => allModels.filter((m) => m.enabled).map((m) => m.id).sort(),
    [allModels],
  )
  const dirty = useMemo(
    () => tools.some((t) => (edits[t.slot] ?? "") !== (t.configured ?? "")),
    [tools, edits],
  )
  const enabledCount = allModels.filter((m) => m.enabled).length

  function optionsFor(current: string) {
    const set = new Set(enabledModels)
    if (current) set.add(current) // keep a configured value visible even if since-disabled
    return [...set].sort()
  }

  function applyToAll() {
    setEdits(Object.fromEntries(tools.map((t) => [t.slot, bulk])))
  }

  async function save() {
    setSaving(true); setError("")
    try {
      const updates = tools
        .filter((t) => (edits[t.slot] ?? "") !== (t.configured ?? ""))
        .map((t) => ({ slot: t.slot, modelId: edits[t.slot] ?? "" }))
      const r = await fetch("/api/admin/ai-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || "Save failed")
      setSavedAt(Date.now())
      await load()
    } catch (e: any) {
      setError(e?.message ?? "Save failed")
    } finally {
      setSaving(false)
    }
  }

  // ── Model enable/disable + test (merged from the old Auction AI Models tab) ──
  async function toggle(id: string, enabled: boolean) {
    setAllModels((prev) => prev.map((m) => (m.id === id ? { ...m, enabled } : m)))
    setError("")
    try {
      const res = await fetch("/api/auction-ai/model-config", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: id, enabled }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? `Save failed (${res.status})`) }
      window.dispatchEvent(new Event("ai-models-changed")) // tell open pickers to refresh
    } catch (e: any) {
      setAllModels((prev) => prev.map((m) => (m.id === id ? { ...m, enabled: !enabled } : m)))
      setError(`Couldn't ${enabled ? "enable" : "disable"} ${id}: ${e.message}. If it mentions a missing table, run the Migrations button on /admin first.`)
    }
  }
  async function testOne(id: string) {
    setTests((p) => ({ ...p, [id]: "testing" }))
    try {
      const res = await fetch("/api/auction-ai/model-test", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: id }),
      })
      const d = await res.json()
      setTests((p) => ({ ...p, [id]: { ok: !!d.ok, ms: d.ms ?? 0, error: d.error } }))
    } catch (e: any) {
      setTests((p) => ({ ...p, [id]: { ok: false, ms: 0, error: e.message } }))
    }
  }
  async function testAll() {
    setTestingAll(true)
    for (const m of allModels) { await testOne(m.id); await new Promise((r) => setTimeout(r, 1000)) }
    setTestingAll(false)
  }

  const groups = useMemo(() => {
    const order: string[] = []
    const byGroup: Record<string, Tool[]> = {}
    for (const t of tools) {
      if (!byGroup[t.group]) { byGroup[t.group] = []; order.push(t.group) }
      byGroup[t.group].push(t)
    }
    return order.map((g) => ({ group: g, items: byGroup[g] }))
  }, [tools])

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">AI Models</h1>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
        Choose which Gemini model each AI feature uses, and manage which models are available. Leaving a feature on{" "}
        <span className="font-medium">Default</span> uses its built-in model. Tools with their own on-screen picker start on this
        default; a user can still override it for their session.
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-500 mb-5">
        Tip: if Google retires a model and a feature starts erroring, just pick a current model here — no code change needed.
      </p>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <>
          {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}

          {/* Update all */}
          <div className="flex flex-wrap items-center gap-2 mb-5 rounded-lg border border-gray-200 dark:border-gray-800 px-4 py-3">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Set every tool to:</span>
            <select
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              className="text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#0d0f1a] text-gray-800 dark:text-gray-200 px-2 py-1.5 max-w-[16rem]"
            >
              <option value="">Default (each tool's built-in)</option>
              {enabledModels.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <button
              onClick={applyToAll}
              className="rounded bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium px-3 py-1.5"
            >
              Apply to all
            </button>
            <span className="text-xs text-gray-500 dark:text-gray-500">then Save below</span>
          </div>

          {/* Per-tool config */}
          <div className="space-y-6">
            {groups.map(({ group, items }) => (
              <div key={group}>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-500 mb-2">{group}</h2>
                <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-200 dark:divide-gray-800">
                  {items.map((t) => {
                    const val = edits[t.slot] ?? ""
                    return (
                      <div key={t.slot} className="flex items-center gap-3 px-4 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 dark:text-gray-200 truncate">{t.label}</p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-500">
                            Using: <span className="font-medium">{val || t.default}</span>{!val && <span> (default)</span>}
                          </p>
                        </div>
                        <select
                          value={val}
                          onChange={(e) => setEdits((p) => ({ ...p, [t.slot]: e.target.value }))}
                          className="text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#0d0f1a] text-gray-800 dark:text-gray-200 px-2 py-1.5 max-w-[18rem]"
                        >
                          <option value="">Default ({t.default})</option>
                          {optionsFor(val).map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="sticky bottom-0 mt-6 mb-8 flex items-center gap-3 bg-gray-50/90 dark:bg-[#0a0c14]/90 backdrop-blur py-3">
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            {dirty && !saving && <span className="text-xs text-amber-600 dark:text-amber-400">Unsaved changes</span>}
            {!dirty && savedAt > 0 && <span className="text-xs text-green-600 dark:text-green-400">Saved</span>}
          </div>

          {/* ── Available models (enable/disable + test) ── */}
          <div className="border-t border-gray-200 dark:border-gray-800 pt-6">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Available models</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Every Gemini model your API key can see. Disable ones that are discontinued or fail — disabled models are hidden
                  from every picker and the dropdowns above. {allModels.length > 0 && <span className="text-gray-500">{enabledCount} of {allModels.length} enabled.</span>}
                </p>
              </div>
              <button onClick={testAll} disabled={testingAll || !allModels.length}
                className="shrink-0 px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white">
                {testingAll ? "Testing…" : "⚡ Test all"}
              </button>
            </div>

            {allModels.length === 0 ? (
              <p className="text-sm text-amber-600 dark:text-amber-400">No models loaded from Google (check the API key / connection).</p>
            ) : (
              <div className="space-y-2">
                {allModels.map((m) => {
                  const t = tests[m.id]
                  return (
                    <div key={m.id} className={`rounded-xl border p-4 ${m.enabled ? "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1C1C1E]" : "border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#161618] opacity-60"}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-gray-900 dark:text-white">{m.displayName ?? m.id}</span>
                            <span className="text-[11px] font-mono text-gray-500">{m.id}</span>
                          </div>
                          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-snug">{describeModel(m.id)}</p>
                          {(m.inputTokenLimit || m.outputTokenLimit) && (
                            <p className="text-[10px] text-gray-500 mt-1">Reads ~{fmtTokens(m.inputTokenLimit)} in · writes ~{fmtTokens(m.outputTokenLimit)} out</p>
                          )}
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          {t === "testing"
                            ? <span className="text-xs text-gray-500 animate-pulse">testing…</span>
                            : t
                              ? (t.ok
                                  ? <span className={`text-xs font-medium ${t.ms < 5000 ? "text-green-500" : t.ms < 12000 ? "text-yellow-500" : "text-orange-500"}`}>✓ {(t.ms / 1000).toFixed(1)}s</span>
                                  : <span className="text-xs text-red-500 max-w-[160px] truncate" title={t.error}>✗ {t.error?.match(/\[(\d{3}[^\]]*)\]/)?.[1] ?? "failed"}</span>)
                              : null}
                          <button onClick={() => testOne(m.id)} disabled={t === "testing"}
                            className="text-xs px-2.5 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-indigo-500 hover:text-indigo-400 disabled:opacity-40">
                            Test
                          </button>
                          <button onClick={() => toggle(m.id, !m.enabled)} title={m.enabled ? "Disable" : "Enable"}
                            className={`relative w-10 h-5 rounded-full transition-colors ${m.enabled ? "bg-green-600" : "bg-gray-400 dark:bg-gray-600"}`}>
                            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${m.enabled ? "left-5" : "left-0.5"}`} />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
