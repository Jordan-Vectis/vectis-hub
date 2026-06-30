"use client"

import { useState, useRef, useEffect } from "react"
import type { LotGroup, LottingUpResult } from "@/app/api/lotting-up/route"
import { showError } from "@/lib/error-modal"

// ── Photo with CSS overlay ────────────────────────────────────────────────────

function PhotoOverlay({ imageUrl, groups, highlightId }: {
  imageUrl:    string
  groups:      LotGroup[]
  highlightId: number | null
}) {
  const g = highlightId !== null ? groups.find(x => x.id === highlightId) ?? null : null

  return (
    <div className="relative">
      <img src={imageUrl} alt="Upload" className="w-full h-auto block rounded-xl" />

      {g && (
        <>
          <div className="absolute inset-x-0 top-0 bg-black/55 pointer-events-none rounded-t-xl"
            style={{ height: `${g.bounds.y}%` }} />
          <div className="absolute inset-x-0 bottom-0 bg-black/55 pointer-events-none rounded-b-xl"
            style={{ height: `${100 - g.bounds.y - g.bounds.h}%` }} />
          <div className="absolute inset-x-0 pointer-events-none"
            style={{
              top:             `${g.bounds.y}%`,
              height:          `${g.bounds.h}%`,
              border:          `3px solid ${g.colour}`,
              backgroundColor: `${g.colour}18`,
            }}
          />
          <div className="absolute text-white text-xs font-bold px-2 py-0.5 rounded pointer-events-none"
            style={{ left: `6px`, top: `calc(${g.bounds.y}% + 6px)`, backgroundColor: g.colour }}>
            {g.id}
          </div>
        </>
      )}
    </div>
  )
}

// ── Per-photo panel (full existing single-photo experience) ───────────────────

type PhotoRun = {
  file:      File
  url:       string
  result:    LottingUpResult | null
  analysing: boolean
}

function PhotoPanel({ run, model, minLotValue, onResult, onAnalysing }: {
  run:          PhotoRun
  model:        string
  minLotValue:  string
  onResult:     (r: LottingUpResult | null) => void
  onAnalysing:  (v: boolean) => void
}) {
  const [hoverId,    setHoverId]    = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const highlightId = selectedId ?? hoverId

  async function analyse() {
    if (run.analysing) return
    onAnalysing(true)
    onResult(null)
    try {
      const fd = new FormData()
      fd.append("photo", run.file)
      fd.append("model", model)
      if (minLotValue) fd.append("minLotValue", minLotValue)
      const res = await fetch("/api/lotting-up", { method: "POST", body: fd })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      onResult(await res.json())
    } catch (e: any) {
      showError("Analysis failed", e.message)
    } finally {
      onAnalysing(false)
    }
  }

  const { url, result, analysing } = run

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

      {/* Left — sticky photo */}
      <div className="space-y-3 sticky top-6">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-300">Photo</p>
          <button
            onClick={analyse}
            disabled={analysing}
            className="text-xs bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-40 text-black font-semibold px-4 py-1 rounded-lg transition-colors">
            {analysing ? "Analysing…" : result ? "Re-analyse" : "✦ Analyse"}
          </button>
        </div>

        <div className="rounded-xl bg-[#1C1C1E] border border-gray-800">
          {result ? (
            <PhotoOverlay imageUrl={url} groups={result.groups} highlightId={highlightId} />
          ) : (
            <img src={url} alt="Upload" className="w-full h-auto block rounded-xl" />
          )}
        </div>

        {analysing && (
          <div className="flex items-center gap-3 text-sm text-gray-400 bg-[#1C1C1E] border border-gray-800 rounded-xl px-4 py-3">
            <span className="animate-spin text-[#2AB4A6]">⟳</span>
            Analysing photo — this may take 10–20 seconds…
          </div>
        )}
      </div>

      {/* Right — results */}
      <div className="space-y-4">
        {!result && !analysing && (
          <div className="bg-[#1C1C1E] border border-gray-800 rounded-xl p-8 text-center text-gray-600">
            <p className="text-3xl mb-3">✦</p>
            <p className="text-sm">Click <span className="text-[#2AB4A6]">Analyse</span> to get lot suggestions</p>
          </div>
        )}

        {result && (
          <>
            {/* Total estimate */}
            <div className="bg-[#1C1C1E] border border-[#2AB4A6]/30 rounded-xl px-5 py-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-0.5">Photo estimate</p>
                <p className="text-2xl font-bold text-white">
                  £{result.totalEstimateLow.toLocaleString()} – £{result.totalEstimateHigh.toLocaleString()}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-0.5">Suggested lots</p>
                <p className="text-2xl font-bold text-[#2AB4A6]">{result.groups.length}</p>
              </div>
            </div>

            {/* Regroup controls */}
            <div className="flex items-center gap-2 bg-[#1C1C1E] border border-gray-800 rounded-xl px-4 py-3">
              <span className="text-xs text-gray-400 flex-shrink-0">Regroup with min lot value</span>
              <div className="relative flex-shrink-0">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs">£</span>
                <input
                  type="number" min={1} value={minLotValue} readOnly
                  placeholder="set above"
                  className="bg-[#2C2C2E] border border-gray-700 rounded-lg pl-5 pr-2 py-1 text-xs text-gray-200 w-24 focus:outline-none"
                />
              </div>
              <button
                onClick={analyse}
                disabled={analysing || !minLotValue}
                className="text-xs bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-40 text-black font-semibold px-3 py-1 rounded-lg transition-colors flex-shrink-0">
                {analysing ? "Regrouping…" : "Regroup"}
              </button>
            </div>

            {/* Lot cards */}
            {selectedId !== null && (
              <p className="text-xs text-gray-500 text-center">
                Lot {selectedId} pinned —{" "}
                <button onClick={() => setSelectedId(null)} className="text-[#2AB4A6] hover:underline">clear</button>
              </p>
            )}
            <div className="space-y-2">
              {result.groups.map(g => {
                const isSelected    = selectedId === g.id
                const isHighlighted = highlightId === g.id
                return (
                  <div
                    key={g.id}
                    onMouseEnter={() => setHoverId(g.id)}
                    onMouseLeave={() => setHoverId(null)}
                    onClick={() => setSelectedId(isSelected ? null : g.id)}
                    className={`rounded-xl border transition-all cursor-pointer ${
                      isHighlighted ? "bg-[#2C2C2E]" : "border-gray-800 bg-[#1C1C1E] hover:bg-[#232323]"
                    }`}
                    style={{ borderColor: isHighlighted ? g.colour : undefined }}
                  >
                    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                        style={{ backgroundColor: g.colour }}>
                        {g.id}
                      </div>
                      <p className="text-sm font-medium text-white flex-1">{g.title}</p>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isSelected && (
                          <span className="text-xs px-1.5 py-0.5 rounded font-medium text-white"
                            style={{ backgroundColor: g.colour }}>pinned</span>
                        )}
                        <p className="text-sm font-semibold text-[#2AB4A6]">
                          £{g.estimateLow}–{g.estimateHigh}
                        </p>
                      </div>
                    </div>
                    <div className="px-4 py-3 space-y-2">
                      <ul className="space-y-0.5">
                        {g.items.map((item, i) => (
                          <li key={i} className="text-xs text-gray-400 flex items-start gap-1.5">
                            <span className="text-gray-600 mt-0.5 flex-shrink-0">·</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                      {g.notes && (
                        <p className="text-xs text-gray-500 italic border-t border-gray-800 pt-2">{g.notes}</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const DEFAULT_MODEL    = "gemini-2.5-flash-preview-04-17"
const MODEL_STORAGE_KEY = "lotting-up-model"

export default function LottingUpPage() {
  const [runs,         setRuns]         = useState<PhotoRun[]>([])
  const [activeIdx,    setActiveIdx]    = useState(0)
  const [model,        setModel]        = useState(() =>
    (typeof window !== "undefined" ? localStorage.getItem(MODEL_STORAGE_KEY) : null) ?? DEFAULT_MODEL
  )
  const [modelList,    setModelList]    = useState<string[]>([DEFAULT_MODEL])
  const [savedDefault, setSavedDefault] = useState(() =>
    (typeof window !== "undefined" ? localStorage.getItem(MODEL_STORAGE_KEY) : null) ?? DEFAULT_MODEL
  )
  const [defaultSaved, setDefaultSaved] = useState(false)
  const [minLotValue,  setMinLotValue]  = useState<string>("")
  const fileRef    = useRef<HTMLInputElement>(null)
  const addMoreRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch("/api/auction-ai/models")
      .then(r => r.json())
      .then(j => { if (j.models?.length) setModelList(j.models) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem(MODEL_STORAGE_KEY)) return
    fetch("/api/ai-tool-model?slot=catalogue_lotting_up")
      .then(r => r.json())
      .then(j => { if (j?.model) setModel(j.model) })
      .catch(() => {})
  }, [])

  function addFiles(files: File[]) {
    const images = files.filter(f => f.type.startsWith("image/"))
    if (!images.length) return
    const newRuns: PhotoRun[] = images.map(file => ({
      file,
      url: URL.createObjectURL(file),
      result:    null,
      analysing: false,
    }))
    setRuns(prev => {
      const merged = [...prev, ...newRuns]
      setActiveIdx(merged.length - newRuns.length) // jump to first new tab
      return merged
    })
  }

  function removeRun(idx: number) {
    setRuns(prev => {
      URL.revokeObjectURL(prev[idx].url)
      const next = prev.filter((_, i) => i !== idx)
      setActiveIdx(i => Math.min(i, Math.max(0, next.length - 1)))
      return next
    })
  }

  function updateRun(idx: number, patch: Partial<PhotoRun>) {
    setRuns(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(e.target.files ?? []))
    e.target.value = ""
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    addFiles(Array.from(e.dataTransfer.files))
  }

  async function analyseOne(idx: number, currentRuns: PhotoRun[]) {
    const run = currentRuns[idx]
    if (!run || run.analysing) return
    updateRun(idx, { analysing: true, result: null })
    try {
      const fd = new FormData()
      fd.append("photo", run.file)
      fd.append("model", model)
      if (minLotValue) fd.append("minLotValue", minLotValue)
      const res = await fetch("/api/lotting-up", { method: "POST", body: fd })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      updateRun(idx, { result: await res.json(), analysing: false })
    } catch (e: any) {
      updateRun(idx, { analysing: false })
      showError(`Photo ${idx + 1} failed`, e.message)
    }
  }

  function analyseAll() {
    const snapshot = runs // capture current array
    snapshot.forEach((_, idx) => analyseOne(idx, snapshot))
  }

  // Combined totals across all completed runs
  const completedRuns = runs.filter(r => r.result)
  const overallLow    = completedRuns.reduce((s, r) => s + (r.result?.totalEstimateLow  ?? 0), 0)
  const overallHigh   = completedRuns.reduce((s, r) => s + (r.result?.totalEstimateHigh ?? 0), 0)
  const overallLots   = completedRuns.reduce((s, r) => s + (r.result?.groups.length     ?? 0), 0)

  const activeRun = runs[activeIdx] ?? null

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white">Lotting Up</h1>
          <p className="text-sm text-gray-400 mt-1">
            Upload photos and AI will suggest how to group items into auction lots with estimated values.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
          {/* Min lot value */}
          <label className="text-xs text-gray-500">Min lot £</label>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs">£</span>
            <input
              type="number" min={1} value={minLotValue}
              onChange={e => setMinLotValue(e.target.value)}
              placeholder="none"
              className="bg-[#2C2C2E] border border-gray-700 rounded-lg pl-5 pr-2 py-1.5 text-xs text-gray-200 w-20 focus:outline-none focus:border-[#2AB4A6]"
            />
          </div>
          <span className="text-gray-700">|</span>
          {/* Model selector */}
          <label className="text-xs text-gray-500">Model</label>
          <select value={model} onChange={e => setModel(e.target.value)}
            className="bg-[#2C2C2E] border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-[#2AB4A6]">
            {modelList.map(m => (
              <option key={m} value={m}>{m}{m === savedDefault ? " ★" : ""}</option>
            ))}
          </select>
          {defaultSaved ? (
            <span className="text-xs text-[#2AB4A6]">✓ Saved</span>
          ) : (
            <button
              onClick={() => {
                localStorage.setItem(MODEL_STORAGE_KEY, model)
                setSavedDefault(model)
                setDefaultSaved(true)
                setTimeout(() => setDefaultSaved(false), 2000)
              }}
              disabled={model === savedDefault}
              className={`text-xs px-2 py-1 rounded border transition-colors ${
                model === savedDefault
                  ? "border-gray-700 text-gray-600 cursor-default"
                  : "border-[#2AB4A6]/50 text-[#2AB4A6] hover:bg-[#2AB4A6]/10"
              }`}
            >
              {model === savedDefault ? "★ Default" : "Set as default"}
            </button>
          )}
        </div>
      </div>

      {/* Combined totals (shown when 2+ photos have results) */}
      {completedRuns.length >= 2 && (
        <div className="bg-[#1C1C1E] border border-[#2AB4A6]/20 rounded-xl px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-0.5">Overall estimate ({completedRuns.length} photos)</p>
            <p className="text-2xl font-bold text-white">
              £{overallLow.toLocaleString()} – £{overallHigh.toLocaleString()}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-0.5">Total lots</p>
            <p className="text-2xl font-bold text-[#2AB4A6]">{overallLots}</p>
          </div>
        </div>
      )}

      {/* Upload drop zone (when no photos) */}
      {runs.length === 0 && (
        <div
          onDrop={onDrop} onDragOver={e => e.preventDefault()}
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-gray-700 hover:border-[#2AB4A6] rounded-2xl p-16 text-center cursor-pointer transition-colors group"
        >
          <div className="text-5xl mb-4">📷</div>
          <p className="text-white font-medium text-lg group-hover:text-[#2AB4A6] transition-colors">
            Drop photos here or click to upload
          </p>
          <p className="text-gray-500 text-sm mt-1">JPG, PNG, WEBP — select multiple for separate analyses</p>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onInputChange} />
        </div>
      )}

      {/* Tab bar + content */}
      {runs.length > 0 && (
        <>
          {/* Tab bar */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {runs.map((r, i) => (
              <div key={i} className="relative flex-shrink-0 group/tab">
                <button
                  onClick={() => setActiveIdx(i)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors border ${
                    i === activeIdx
                      ? "bg-[#2C2C2E] border-[#2AB4A6]/50 text-white"
                      : "bg-[#1C1C1E] border-gray-800 text-gray-400 hover:text-white hover:bg-[#232323]"
                  }`}
                >
                  <img src={r.url} alt="" className="w-6 h-6 rounded object-cover flex-shrink-0" />
                  <span>Photo {i + 1}</span>
                  {r.analysing && <span className="animate-spin text-[#2AB4A6] text-xs">⟳</span>}
                  {r.result && !r.analysing && (
                    <span className="text-xs text-[#2AB4A6]">
                      £{r.result.totalEstimateLow}–{r.result.totalEstimateHigh}
                    </span>
                  )}
                </button>
                {/* Remove button */}
                <button
                  onClick={() => removeRun(i)}
                  className="absolute -top-1 -right-1 w-4 h-4 bg-gray-900 border border-gray-600 rounded-full text-gray-400 hover:text-white text-[10px] flex items-center justify-center opacity-0 group-hover/tab:opacity-100 transition-opacity"
                >×</button>
              </div>
            ))}

            {/* Add more tab */}
            <button
              onClick={() => addMoreRef.current?.click()}
              className="flex-shrink-0 px-4 py-2 rounded-xl text-sm border-2 border-dashed border-gray-700 hover:border-[#2AB4A6] text-gray-600 hover:text-[#2AB4A6] transition-colors"
            >
              + Add photo
            </button>

            {/* Analyse all */}
            {runs.length > 1 && (
              <button
                onClick={analyseAll}
                disabled={runs.every(r => r.analysing)}
                className="flex-shrink-0 ml-auto text-xs bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-40 text-black font-semibold px-4 py-2 rounded-xl transition-colors"
              >
                {runs.some(r => r.analysing) ? "Analysing…" : "✦ Analyse all"}
              </button>
            )}

            <input ref={addMoreRef} type="file" accept="image/*" multiple className="hidden" onChange={onInputChange} />
          </div>

          {/* Active photo panel */}
          {activeRun && (
            <PhotoPanel
              key={activeIdx}
              run={activeRun}
              model={model}
              minLotValue={minLotValue}
              onResult={r => updateRun(activeIdx, { result: r })}
              onAnalysing={v => updateRun(activeIdx, { analysing: v })}
            />
          )}
        </>
      )}
    </div>
  )
}
