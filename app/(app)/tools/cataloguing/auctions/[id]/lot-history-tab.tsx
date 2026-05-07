"use client"

import { useState, useEffect, useRef } from "react"
import { saveLotExtraDetails } from "@/lib/actions/catalogue"

interface Lot {
  id:           string
  lotNumber:    string
  title:        string
  description:  string
  keyPoints:    string
  category:     string | null
  subCategory:  string | null
  brand:        string | null
  condition:    string | null
  estimateLow:  number | null
  estimateHigh: number | null
  extraDetails: string | null
}

interface Props {
  auctionId: string
  lots:      Lot[]
}

const DEFAULT_MODEL = "gemini-2.5-flash-preview-04-17"

type LotState = {
  saved:      string | null   // what's persisted in DB
  draft:      string | null   // generated but not yet saved
  status:     "idle" | "generating" | "error"
  error:      string | null
  expanded:   boolean
}

export default function LotHistoryTab({ auctionId, lots }: Props) {
  const [modelList,  setModelList]  = useState<string[]>([DEFAULT_MODEL])
  const [modelId,    setModelId]    = useState(DEFAULT_MODEL)

  // Per-lot state map
  const [states, setStates] = useState<Record<string, LotState>>(() => {
    const m: Record<string, LotState> = {}
    for (const l of lots) {
      m[l.id] = { saved: l.extraDetails ?? null, draft: null, status: "idle", error: null, expanded: false }
    }
    return m
  })

  const [runningAll,  setRunningAll]  = useState(false)
  const [allProgress, setAllProgress] = useState<{ done: number; total: number } | null>(null)
  const cancelRef = useRef(false)

  useEffect(() => {
    fetch("/api/auction-ai/models")
      .then(r => r.json())
      .then(d => { if (d.models?.length) { setModelList(d.models); setModelId(d.models[0]) } })
      .catch(() => {})
  }, [])

  function updateState(lotId: string, patch: Partial<LotState>) {
    setStates(prev => ({ ...prev, [lotId]: { ...prev[lotId], ...patch } }))
  }

  async function generateOne(lot: Lot): Promise<string | null> {
    updateState(lot.id, { status: "generating", error: null, expanded: true })
    try {
      const res  = await fetch("/api/catalogue/lot-history", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          modelId,
          lot: {
            lotNumber:   lot.lotNumber,
            title:       lot.title,
            description: lot.description,
            keyPoints:   lot.keyPoints,
            category:    lot.category,
            subCategory: lot.subCategory,
            brand:       lot.brand,
            condition:   lot.condition,
            estimateLow: lot.estimateLow,
            estimateHigh:lot.estimateHigh,
          },
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        updateState(lot.id, { status: "error", error: data.error ?? "Generation failed" })
        return null
      }
      updateState(lot.id, { status: "idle", draft: data.extraDetails })
      return data.extraDetails
    } catch (e: any) {
      updateState(lot.id, { status: "error", error: e.message ?? "Network error" })
      return null
    }
  }

  async function saveOne(lot: Lot, text: string) {
    await saveLotExtraDetails(lot.id, auctionId, text)
    updateState(lot.id, { saved: text, draft: null })
  }

  async function generateAll() {
    cancelRef.current = false
    setRunningAll(true)
    setAllProgress({ done: 0, total: lots.length })
    for (let i = 0; i < lots.length; i++) {
      if (cancelRef.current) break
      const lot = lots[i]
      const result = await generateOne(lot)
      // Auto-save on generate-all
      if (result) await saveOne(lot, result)
      setAllProgress({ done: i + 1, total: lots.length })
      // Small delay between lots to avoid rate limits
      if (i < lots.length - 1 && !cancelRef.current) {
        await new Promise(r => setTimeout(r, 3000))
      }
    }
    setRunningAll(false)
    setAllProgress(null)
    cancelRef.current = false
  }

  const savedCount = lots.filter(l => states[l.id]?.saved).length
  const anyGenerating = Object.values(states).some(s => s.status === "generating")

  return (
    <div className="p-6 space-y-5">

      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-1">Lot History Generator</h2>
        <p className="text-sm text-gray-400">
          Generate a detailed SEO paragraph for each lot covering manufacturer history, collectability, and keywords.
          These are stored separately from the main description and can be used on the public lot page.
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={modelId}
          onChange={e => setModelId(e.target.value)}
          disabled={runningAll || anyGenerating}
          className="bg-[#2C2C2E] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]"
        >
          {modelList.map(m => <option key={m} value={m}>{m}</option>)}
        </select>

        {runningAll ? (
          <button
            onClick={() => { cancelRef.current = true }}
            className="bg-red-700 hover:bg-red-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            Cancel
          </button>
        ) : (
          <button
            onClick={generateAll}
            disabled={anyGenerating || lots.length === 0}
            className="bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            ✨ Generate All ({lots.length} lots)
          </button>
        )}

        <span className="text-sm text-gray-400 ml-auto">
          {savedCount} / {lots.length} lots have extra details
        </span>
      </div>

      {/* Progress bar */}
      {allProgress && (
        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Generating… {allProgress.done} / {allProgress.total}</span>
            <span>{Math.round((allProgress.done / allProgress.total) * 100)}%</span>
          </div>
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#2AB4A6] rounded-full transition-all duration-300"
              style={{ width: `${(allProgress.done / allProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Lot list */}
      <div className="space-y-3">
        {lots.map(lot => {
          const s = states[lot.id]
          if (!s) return null
          const activeText = s.draft ?? s.saved ?? null
          const hasSaved   = !!s.saved
          const hasDraft   = !!s.draft

          return (
            <div key={lot.id} className="bg-[#1C1C1E] border border-gray-700 rounded-xl overflow-hidden">
              {/* Lot row header */}
              <div className="flex items-center gap-3 px-4 py-3">
                {/* Status dot */}
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  s.status === "generating" ? "bg-yellow-400 animate-pulse" :
                  hasSaved  ? "bg-green-500" :
                  hasDraft  ? "bg-blue-400" :
                  "bg-gray-600"
                }`} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-gray-500">#{lot.lotNumber}</span>
                    <span className="text-sm font-medium text-gray-200 truncate">{lot.title}</span>
                  </div>
                  {(lot.category || lot.brand) && (
                    <div className="text-xs text-gray-500 mt-0.5">
                      {[lot.brand, lot.category].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>

                {/* Status label */}
                {hasSaved && !hasDraft && (
                  <span className="text-xs text-green-400 flex-shrink-0">✓ Saved</span>
                )}
                {hasDraft && (
                  <span className="text-xs text-blue-400 flex-shrink-0">Draft</span>
                )}

                {/* Generate button */}
                <button
                  onClick={() => generateOne(lot)}
                  disabled={s.status === "generating" || runningAll}
                  className="text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-gray-200 px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
                >
                  {s.status === "generating" ? "Generating…" : hasSaved ? "Regenerate" : "Generate"}
                </button>

                {/* Expand toggle */}
                {activeText && (
                  <button
                    onClick={() => updateState(lot.id, { expanded: !s.expanded })}
                    className="text-gray-500 hover:text-gray-300 flex-shrink-0 text-lg leading-none"
                  >
                    {s.expanded ? "▲" : "▼"}
                  </button>
                )}
              </div>

              {/* Error */}
              {s.error && (
                <div className="px-4 pb-3 text-red-400 text-xs">{s.error}</div>
              )}

              {/* Expanded content */}
              {s.expanded && activeText && (
                <div className="border-t border-gray-700 px-4 py-3 space-y-3">
                  <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{activeText}</p>

                  {hasDraft && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveOne(lot, s.draft!)}
                        className="text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg transition-colors"
                      >
                        ✓ Save
                      </button>
                      <button
                        onClick={() => updateState(lot.id, { draft: null, expanded: false })}
                        className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Discard
                      </button>
                    </div>
                  )}
                  {hasSaved && !hasDraft && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(s.saved!)
                      }}
                      className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      Copy
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {lots.length === 0 && (
        <div className="text-center py-12 text-gray-500">No lots in this auction yet.</div>
      )}
    </div>
  )
}
