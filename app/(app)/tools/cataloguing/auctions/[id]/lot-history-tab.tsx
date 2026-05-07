"use client"

import { useState, useEffect, useRef } from "react"
import { saveLotExtraDetails } from "@/lib/actions/catalogue"

const LS_KEY = "lot_history_instructions"

const DEFAULT_INSTRUCTIONS = `Write a single, long, detailed SEO-optimised paragraph (250–400 words) about the item described below. This paragraph will appear on the auction lot page to help collectors find it via search engines.

The paragraph should cover ALL of the following where relevant:
- History and background of the manufacturer or brand (founding, key years, notable products, country of origin)
- What makes this specific type of item collectable and desirable
- Details about the particular item: model, era, variant, features, materials
- Why collectors seek this out (rarity, nostalgia, investment value, cultural significance)
- Any notable information about the condition or completeness
- Relevant keywords woven in naturally (brand name, product type, era, materials, collector terms)

Write in flowing, informative prose — NOT as bullet points. British English throughout. Do not start with "This" or "The item". Do not mention Vectis by name. Output plain text only — no HTML tags, no headings, no markdown.`

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

  // Editable instructions
  const [instructions,     setInstructions]     = useState(DEFAULT_INSTRUCTIONS)
  const [showInstructions, setShowInstructions] = useState(false)
  const [instructionsDirty, setInstructionsDirty] = useState(false)

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
    // Load saved instructions from localStorage
    try {
      const saved = localStorage.getItem(LS_KEY)
      if (saved) { setInstructions(saved); setInstructionsDirty(true) }
    } catch {}
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
          customInstructions: instructions !== DEFAULT_INSTRUCTIONS ? instructions : undefined,
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

        <button
          onClick={() => setShowInstructions(v => !v)}
          className={`text-sm px-3 py-2 rounded-lg border transition-colors ${showInstructions ? "border-[#2AB4A6] text-[#2AB4A6] bg-[#2AB4A6]/10" : "border-gray-700 text-gray-400 hover:border-gray-500"}`}
        >
          {showInstructions ? "▲" : "▼"} Instructions{instructionsDirty ? " ✎" : ""}
        </button>

        <span className="text-sm text-gray-400 ml-auto">
          {savedCount} / {lots.length} lots have extra details
        </span>
      </div>

      {/* Editable instructions panel */}
      {showInstructions && (
        <div className="bg-[#1C1C1E] border border-gray-700 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">These instructions are sent to the AI along with each lot's details. Edit to change the style or focus of the generated text.</p>
            {instructionsDirty && (
              <button
                onClick={() => {
                  setInstructions(DEFAULT_INSTRUCTIONS)
                  setInstructionsDirty(false)
                  try { localStorage.removeItem(LS_KEY) } catch {}
                }}
                className="text-xs text-red-400 hover:text-red-300 whitespace-nowrap ml-3"
              >
                Reset to default
              </button>
            )}
          </div>
          <textarea
            value={instructions}
            onChange={e => {
              setInstructions(e.target.value)
              setInstructionsDirty(e.target.value !== DEFAULT_INSTRUCTIONS)
              try { localStorage.setItem(LS_KEY, e.target.value) } catch {}
            }}
            rows={12}
            className="w-full bg-[#2C2C2E] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 font-mono focus:outline-none focus:ring-2 focus:ring-[#2AB4A6] resize-none"
          />
        </div>
      )}

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
