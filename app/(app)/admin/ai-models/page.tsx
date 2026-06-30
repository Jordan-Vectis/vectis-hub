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

export default function AiModelsPage() {
  const [tools, setTools]   = useState<Tool[]>([])
  const [models, setModels] = useState<string[]>([])
  const [edits, setEdits]   = useState<Record<string, string>>({}) // slot -> chosen value ("" = use default)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState("")
  const [savedAt, setSavedAt] = useState(0)

  async function load() {
    setLoading(true); setError("")
    try {
      const r = await fetch("/api/admin/ai-models")
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || "Failed to load")
      setTools(j.tools ?? [])
      setModels(j.models ?? [])
      setEdits(Object.fromEntries((j.tools ?? []).map((t: Tool) => [t.slot, t.configured ?? ""])))
    } catch (e: any) {
      setError(e?.message ?? "Failed to load")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const dirty = useMemo(
    () => tools.some((t) => (edits[t.slot] ?? "") !== (t.configured ?? "")),
    [tools, edits],
  )

  // Models that are configured but no longer in the live list (e.g. retired) —
  // still show them as options so the dropdown reflects the saved value.
  function optionsFor(current: string) {
    const set = new Set(models)
    if (current) set.add(current)
    return [...set].sort()
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
        Choose which Gemini model each AI feature uses. Leaving a feature on <span className="font-medium">Default</span> uses
        its built-in model. Tools with their own on-screen model picker use this as their starting default; a user can still
        override it for their session. Only models enabled in Auction AI → Models appear here.
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-500 mb-5">
        Tip: if Google retires a model and a feature starts erroring, just pick a current model here — no code change needed.
      </p>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <>
          {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}
          {models.length === 0 && (
            <p className="text-sm text-amber-600 dark:text-amber-400 mb-3">
              No models loaded from Google (check the API key / connection). You can still see saved values below.
            </p>
          )}

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
                            Using: <span className="font-medium">{val || t.default}</span>
                            {!val && <span> (default)</span>}
                          </p>
                        </div>
                        <select
                          value={val}
                          onChange={(e) => setEdits((p) => ({ ...p, [t.slot]: e.target.value }))}
                          className="text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#0d0f1a] text-gray-800 dark:text-gray-200 px-2 py-1.5 max-w-[18rem]"
                        >
                          <option value="">Default ({t.default})</option>
                          {optionsFor(val).map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="sticky bottom-0 mt-6 flex items-center gap-3 bg-gray-50/90 dark:bg-[#0a0c14]/90 backdrop-blur py-3">
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
        </>
      )}
    </div>
  )
}
