"use client"

import { useState, useEffect, useRef } from "react"
import { applyAiDescriptionOne } from "@/lib/actions/catalogue"
import { PRESETS } from "@/lib/auction-ai-presets"
import { showError } from "@/lib/error-modal"

interface Lot {
  id: string
  barcode: string | null
  receiptUniqueId: string | null
  title: string
  keyPoints: string
  description: string
  estimateLow: number | null
  estimateHigh: number | null
  imageUrls: string[]
  aiUpgraded: boolean
}

interface Props {
  auctionId: string
  auctionCode: string
  lots: Lot[]
  onDone: () => void
}

type Phase = "idle" | "fetching" | "running" | "review" | "saving" | "done"

interface LotResult {
  lotId:          string
  label:          string
  oldDescription: string
  oldEstimateLow: number | null
  oldEstimateHigh: number | null
  newDescription: string
  newEstimateLow: number | null
  newEstimateHigh: number | null
  newEstimateRaw: string
  status:         "ok" | "failed" | "skipped"
  error?:         string
  approved:       boolean
}

function parseEstimate(est: string): { low: number | null; high: number | null } {
  const m = est.match(/£([\d,]+)\s*[–\-]\s*£([\d,]+)/)
  if (!m) return { low: null, high: null }
  return {
    low:  parseInt(m[1].replace(/,/g, ""), 10),
    high: parseInt(m[2].replace(/,/g, ""), 10),
  }
}

const DEFAULT_MODEL = "gemini-3-flash-preview"

export default function AiUpgradeTab({ auctionId, auctionCode, lots, onDone }: Props) {
  const [phase,  setPhase]  = useState<Phase>("idle")
  const [preset, setPreset] = useState(() => Object.keys(PRESETS).filter(k => k !== "Custom (paste my own)")[0] ?? "")

  // DB overrides — re-fetched whenever preset changes so edited instructions always take effect
  const [overrides, setOverrides] = useState<Record<string, string>>({})

  useEffect(() => {
    fetch("/api/auction-ai/presets")
      .then(r => r.json())
      .then(setOverrides)
      .catch(() => {})
  }, [preset])

  // All preset keys: static built-ins + any DB-only custom keys, excluding "Custom (paste my own)"
  const presetKeys = [
    ...Object.keys(PRESETS).filter(k => k !== "Custom (paste my own)"),
    ...Object.keys(overrides).filter(k => !PRESETS[k]),
  ]
  const [model,  setModel]  = useState(DEFAULT_MODEL)
  const [modelList,    setModelList]    = useState<string[]>([DEFAULT_MODEL])
  const [modelStatus,  setModelStatus]  = useState<Record<string, { ok: boolean; ms: number; error?: string } | "testing">>({})
  const [testingAll,   setTestingAll]   = useState(false)
  const [sendDesc,     setSendDesc]     = useState(true)
  const [contextField, setContextField] = useState<"keyPoints" | "description">("keyPoints")
  const [grounded,     setGrounded]     = useState(false)
  const [selectedLotIds, setSelectedLotIds] = useState<Set<string>>(
    () => new Set(lots.filter(l => !l.aiUpgraded && l.imageUrls.length > 0).map(l => l.id))
  )
  const [results,      setResults]      = useState<LotResult[]>([])
  const [fetchProgress, setFetchProgress] = useState({ done: 0, total: 0 })
  const [runProgress,   setRunProgress]   = useState({ done: 0, total: 0 })
  const [saveProgress,  setSaveProgress]  = useState({ done: 0, total: 0 })
  const [log,          setLog]          = useState<string[]>([])
  const [error,        setError]        = useState<string | null>(null)
  const [paused,       setPaused]       = useState(false)
  const cancelRef  = useRef(false)
  const pauseRef   = useRef(false)
  const abortRef   = useRef<AbortController | null>(null)
  const logRef     = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch("/api/auction-ai/models")
      .then(r => r.json())
      .then(j => { if (j.models?.length) setModelList(j.models) })
      .catch(() => {})
  }, [])

  function addLog(msg: string) {
    const ts = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    setLog(l => [...l, `[${ts}]  ${msg}`])
    setTimeout(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }), 50)
  }

  function handlePause() {
    pauseRef.current = true
    setPaused(true)
    addLog("⏸ Paused — will stop after current lot finishes")
  }

  function handleResume() {
    pauseRef.current = false
    setPaused(false)
    addLog("▶ Resuming…")
  }

  function handleCancel() {
    cancelRef.current = true
    pauseRef.current  = false
    setPaused(false)
    if (abortRef.current) {
      addLog("⛔ Stop requested — aborting current request…")
      abortRef.current.abort()
      abortRef.current = null
    }
  }

  async function testAllModels() {
    setTestingAll(true)
    const initial: Record<string, "testing"> = {}
    modelList.forEach(m => { initial[m] = "testing" })
    setModelStatus(initial)

    await Promise.all(modelList.map(async (m) => {
      try {
        const res  = await fetch("/api/auction-ai/model-test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: m }),
        })
        const data = await res.json()
        setModelStatus(prev => ({ ...prev, [m]: data }))
      } catch (e: any) {
        setModelStatus(prev => ({ ...prev, [m]: { ok: false, ms: 0, error: e.message } }))
      }
    }))

    setTestingAll(false)
  }

  // Wait while paused (called inside the run loop)
  async function waitIfPaused() {
    while (pauseRef.current && !cancelRef.current) {
      await new Promise(r => setTimeout(r, 300))
    }
  }

  function toggleLot(id: string) {
    setSelectedLotIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function quickSelect(ids: string[]) {
    setSelectedLotIds(new Set(ids))
  }

  const eligibleLots = lots.filter(l => selectedLotIds.has(l.id))

  async function start() {
    if (eligibleLots.length === 0) { setError("No lots match the selected filter."); return }
    setError(null)
    cancelRef.current = false
    pauseRef.current  = false
    setPaused(false)
    setLog([])
    setResults([])

    // ── Phase 1: Fetch photos from R2 ──────────────────────────────────────
    setPhase("fetching")
    const photoMap: Record<string, Blob[]> = {}
    const total = eligibleLots.reduce((s, l) => s + l.imageUrls.length, 0)
    setFetchProgress({ done: 0, total })
    addLog(`── Starting run: ${eligibleLots.length} lots, ${total} images, model: ${model}`)
    addLog(`── Preset: "${preset}" ${overrides[preset] !== undefined ? "✎ using your edited instructions" : "(built-in default)"}`)
    addLog(`── Fetching ${total} photos from storage…`)

    let fetched = 0
    for (const lot of eligibleLots) {
      if (cancelRef.current) break
      photoMap[lot.id] = []
      const label = lot.barcode || lot.receiptUniqueId || lot.id
      for (let pi = 0; pi < lot.imageUrls.length; pi++) {
        if (cancelRef.current) break
        const key = lot.imageUrls[pi]
        try {
          const t0  = Date.now()
          const res = await fetch(`/api/catalogue/photo-proxy?key=${encodeURIComponent(key)}`)
          if (res.ok) {
            const blob = await res.blob()
            photoMap[lot.id].push(blob)
            const kb = Math.round(blob.size / 1024)
            addLog(`  ↓ ${label} photo ${pi + 1}/${lot.imageUrls.length} — ${kb} KB (${Date.now() - t0}ms)`)
          } else {
            addLog(`  ✗ ${label} photo ${pi + 1} — HTTP ${res.status}`)
          }
        } catch (err: any) {
          addLog(`  ✗ ${label} photo ${pi + 1} — fetch failed: ${err.message}`)
        }
        fetched++
        setFetchProgress({ done: fetched, total })
      }
    }

    if (cancelRef.current) { setPhase("idle"); return }
    const totalFetched = Object.values(photoMap).reduce((s, a) => s + a.length, 0)
    const totalKb = Math.round(Object.values(photoMap).flat().reduce((s, b) => s + b.size, 0) / 1024)
    addLog(`── All photos fetched: ${totalFetched}/${total} succeeded (${totalKb} KB total)`)
    addLog(`── Starting AI processing…`)

    // ── Phase 2: Run AI lot by lot ──────────────────────────────────────────
    setPhase("running")
    const runTotal = eligibleLots.length
    setRunProgress({ done: 0, total: runTotal })

    // DB override takes precedence over the static preset
    const systemInstruction = overrides[preset] ?? PRESETS[preset] ?? ""
    const collected: LotResult[] = []

    for (let i = 0; i < eligibleLots.length; i++) {
      // Respect pause before starting each lot
      await waitIfPaused()
      if (cancelRef.current) { addLog(`⛔ Cancelled after ${i} lots`); break }

      const lot    = eligibleLots[i]
      const photos = photoMap[lot.id] ?? []
      const label  = lot.barcode || lot.receiptUniqueId || lot.id
      const lotKb  = Math.round(photos.reduce((s, b) => s + b.size, 0) / 1024)
      addLog(`── ${i + 1}/${runTotal} ${label} — ${photos.length} photo${photos.length !== 1 ? "s" : ""} (${lotKb} KB)`)

      // Retry loop — keeps trying until success, with uncapped exponential backoff
      let attempt = 0
      let succeeded = false
      while (!succeeded) {
        try {
          const fd = new FormData()
          fd.set("systemInstruction", systemInstruction)
          fd.set("model", model)
          fd.set("grounded", grounded ? "true" : "false")
          photos.forEach((blob, j) => {
            fd.append(`lot_${lot.id}_image_${j}`, blob, `photo_${j}.jpg`)
          })
          const ctx = sendDesc ? (contextField === "description" ? lot.description : lot.keyPoints).trim() : ""
          if (ctx) {
            fd.set(`lot_${lot.id}_context`, ctx)
            fd.set(`lot_${lot.id}_contextType`, contextField)
            addLog(`  → sending ${contextField === "description" ? "description" : "key points"} as context (${ctx.length} chars)`)
          } else {
            addLog(`  → no existing context — AI working from photos only`)
          }

          addLog(`  → sending to Gemini${attempt > 0 ? ` (attempt ${attempt + 1})` : ""}…`)
          const reqStart = Date.now()

          // Abort after 3 minutes so the retry loop can kick in if the server hangs.
          // Also wired to abortRef so "Stop & review" kills the request immediately.
          const controller = new AbortController()
          abortRef.current = controller
          const timer = setTimeout(() => controller.abort(), 3 * 60 * 1000)
          // Heartbeat every 20s so the UI doesn't look frozen
          let elapsed = 0
          const heartbeat = setInterval(() => {
            elapsed += 20
            addLog(`  ⏳ still waiting for Gemini… (${elapsed}s elapsed)`)
          }, 20_000)
          let res: Response
          try {
            res = await fetch("/api/auction-ai/batch", { method: "POST", body: fd, signal: controller.signal })
          } finally {
            clearTimeout(timer)
            clearInterval(heartbeat)
            if (abortRef.current === controller) abortRef.current = null
          }
          const reqMs = Date.now() - reqStart
          addLog(`  ← response received in ${(reqMs / 1000).toFixed(1)}s — HTTP ${res.status}`)

          // Guard against non-JSON responses (e.g. "first byte timeout" from Railway)
          const text = await res.text()
          let json: any
          try { json = JSON.parse(text) } catch { throw new Error(`Non-JSON response: ${text.slice(0, 120)}`) }
          if (!res.ok) throw new Error(json.error ?? res.statusText)

          const r = json.results?.[0]
          if (!r || r.status !== "OK") throw new Error(r?.error ?? "No result returned")

          const { low, high } = parseEstimate(r.estimate)
          collected.push({
            lotId:           lot.id,
            label:           lot.barcode || lot.receiptUniqueId || lot.id,
            oldDescription:  lot.keyPoints,
            oldEstimateLow:  lot.estimateLow,
            oldEstimateHigh: lot.estimateHigh,
            newDescription:  r.description,
            newEstimateLow:  low,
            newEstimateHigh: high,
            newEstimateRaw:  r.estimate,
            status:          "ok",
            approved:        true,
          })
          // Save to Auction AI runs so it appears in Saved Runs (awaited so count is correct on navigation)
          try {
            const saveRes = await fetch("/api/auction-ai/runs", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                code:        auctionCode,
                preset,
                lot:         label,
                description: r.description,
                estimate:    r.estimate ?? "",
              }),
            })
            if (!saveRes.ok) {
              const txt = await saveRes.text().catch(() => "")
              let errMsg = ""; try { errMsg = JSON.parse(txt).error ?? "" } catch { errMsg = txt }
              addLog(`⚠ ${label} — save to Saved Runs failed: ${errMsg || saveRes.status}`)
              showError(`Save to Saved Runs failed — ${label}`, `HTTP ${saveRes.status}`, errMsg || "No detail returned from server")
            }
          } catch (saveErr: any) {
            addLog(`⚠ ${label} — save to Saved Runs error: ${saveErr.message}`)
            showError(`Save to Saved Runs error — ${label}`, saveErr.message)
          }
          addLog(`  ✓ ${label} — done${r.estimate ? ` · estimate: ${r.estimate}` : ""}`)
          succeeded = true
        } catch (e: any) {
          if (cancelRef.current) break   // "Stop & review" aborted the fetch — exit immediately
          const isTimeout   = e.name === "AbortError" || e.message?.includes("aborted")
          const isRateLimit = e.message?.includes("429") || e.message?.includes("RESOURCE_EXHAUSTED")
          const errType     = isTimeout ? "3min timeout" : isRateLimit ? "rate limited" : "error"
          const delayMs     = Math.pow(2, attempt) * 5000 + Math.random() * 2000
          const delaySec    = Math.round(delayMs / 1000)
          addLog(`  ⚠ ${label} — ${errType}: ${e.message}`)
          addLog(`  ↻ retrying in ${delaySec}s (attempt ${attempt + 1} failed)`)
          // Chunked delay — checks cancelRef every 500ms so Stop & review is instant
          const chunks = Math.ceil(delayMs / 500)
          for (let c = 0; c < chunks; c++) {
            if (cancelRef.current) break
            await new Promise(r => setTimeout(r, Math.min(500, delayMs - c * 500)))
          }
          if (cancelRef.current) break
          attempt++
        }
      }

      setResults([...collected])
      setRunProgress({ done: i + 1, total: runTotal })

      // 8s rate-limit gap — split into small chunks so pause/cancel responds quickly
      if (i < eligibleLots.length - 1 && !cancelRef.current) {
        if (!pauseRef.current) addLog(`  · waiting 8s before next lot…`)
        for (let t = 0; t < 80; t++) {
          if (cancelRef.current || pauseRef.current) break
          await new Promise(r => setTimeout(r, 100))
        }
        if (pauseRef.current && !cancelRef.current) {
          addLog(`⏸ Paused — ${collected.length} lot${collected.length !== 1 ? "s" : ""} done so far. Click Resume to continue or Stop & review to finish.`)
          await waitIfPaused()
          if (!cancelRef.current) addLog(`▶ Resumed`)
        }
      }
    }

    setPhase("review")
  }

  function toggleApprove(lotId: string) {
    setResults(prev => prev.map(r => r.lotId === lotId ? { ...r, approved: !r.approved } : r))
  }
  function approveAll()  { setResults(prev => prev.map(r => r.status === "ok" ? { ...r, approved: true }  : r)) }
  function rejectAll()   { setResults(prev => prev.map(r => ({ ...r, approved: false })) ) }

  async function applyApproved() {
    const toApply = results.filter(r => r.approved && r.status === "ok")
    if (toApply.length === 0) { setError("No approved lots to apply."); return }
    setError(null)
    setSaveProgress({ done: 0, total: toApply.length })
    setLog([])
    setPhase("saving")

    addLog(`── Saving ${toApply.length} lot${toApply.length !== 1 ? "s" : ""} to database…`)

    const failed: string[] = []
    for (let i = 0; i < toApply.length; i++) {
      const r = toApply[i]
      addLog(`  · ${i + 1}/${toApply.length} ${r.label} — saving…`)
      const t0 = Date.now()
      try {
        await applyAiDescriptionOne(auctionId, {
          id:             r.lotId,
          description:    r.newDescription,
          aiEstimateLow:  r.newEstimateLow,
          aiEstimateHigh: r.newEstimateHigh,
        })
        addLog(`  ✓ ${r.label} — saved (${Date.now() - t0}ms)`)
      } catch (e: any) {
        addLog(`  ✗ ${r.label} — failed: ${e.message}`)
        failed.push(r.label)
      }
      setSaveProgress({ done: i + 1, total: toApply.length })
    }

    if (failed.length > 0) {
      addLog(`── Done with ${failed.length} failure${failed.length !== 1 ? "s" : ""}: ${failed.join(", ")}`)
    } else {
      addLog(`── All ${toApply.length} lots saved successfully`)
    }

    setPhase("done")
    onDone()
  }

  const approvedCount = results.filter(r => r.approved && r.status === "ok").length
  const failedCount   = results.filter(r => r.status === "failed").length
  const okCount       = results.filter(r => r.status === "ok").length

  return (
    <div className="p-4 md:p-6 max-w-4xl">

      {/* ── Idle ── */}
      {phase === "idle" && (
        <div className="space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-gray-200">AI Description Upgrade</h2>
            <p className="text-xs text-gray-600 dark:text-gray-500 mt-0.5">
              Select the lots to process, choose a preset and model, then run.
            </p>
          </div>

          {/* Preset */}
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-500 mb-1.5 uppercase tracking-wider">AI Instruction Preset</label>
            <select value={preset} onChange={e => setPreset(e.target.value)}
              className="w-full bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-500">
              {presetKeys.map(k => (
                <option key={k} value={k}>
                  {k}{overrides[k] !== undefined ? " ✎" : ""}
                </option>
              ))}
            </select>
            {/* Read-only preview so you can confirm what will be sent */}
            <details className="mt-2">
              <summary className="text-xs text-purple-400 cursor-pointer select-none hover:text-purple-300 transition-colors">
                {overrides[preset] !== undefined ? "✎ Using your edited instructions — click to preview" : "Click to preview instructions"}
              </summary>
              <textarea readOnly value={overrides[preset] ?? PRESETS[preset] ?? ""}
                rows={6}
                className="mt-1.5 w-full bg-gray-100 dark:bg-[#111113] border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-600 dark:text-gray-400 font-mono resize-none focus:outline-none" />
            </details>
          </div>

          {/* Model */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider">Model</label>
              <button onClick={testAllModels} disabled={testingAll}
                className="text-xs text-purple-400 hover:text-purple-300 disabled:opacity-50 transition-colors">
                {testingAll ? "Testing…" : "⚡ Test all models"}
              </button>
            </div>

            {/* Model list with inline status */}
            <div className="border border-gray-700 rounded-lg overflow-hidden">
              {modelList.map((m, i) => {
                const status = modelStatus[m]
                const isSelected = model === m
                return (
                  <button key={m} onClick={() => setModel(m)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors border-b border-gray-200 dark:border-gray-800 last:border-0 ${
                      isSelected ? "bg-purple-900/20" : "hover:bg-gray-50 dark:hover:bg-[#1a1a1e]"
                    }`}>
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                      isSelected ? "bg-purple-500" : "bg-gray-700"
                    }`} />
                    <span className={`text-sm flex-1 font-mono ${isSelected ? "text-purple-200" : "text-gray-600 dark:text-gray-400"}`}>{m}</span>
                    {status === "testing" && (
                      <span className="text-xs text-gray-600 dark:text-gray-500 animate-pulse">testing…</span>
                    )}
                    {status && status !== "testing" && (
                      status.ok
                        ? <span className={`text-xs font-medium ${status.ms < 5000 ? "text-green-400" : status.ms < 12000 ? "text-yellow-400" : "text-orange-400"}`}>
                            ✓ {(status.ms / 1000).toFixed(1)}s
                          </span>
                        : <span className="text-xs text-red-400 truncate max-w-[200px]" title={status.error}>
                            ✗ {status.error?.match(/\[(\d{3}[^\]]*)\]/)?.[1] ?? "error"}
                          </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Options */}
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input type="checkbox" checked={sendDesc} onChange={e => setSendDesc(e.target.checked)}
                className="w-4 h-4 rounded accent-purple-500" />
              <span className="text-sm text-gray-600 dark:text-gray-300">Send existing</span>
            </label>
            <select value={contextField} onChange={e => setContextField(e.target.value as "keyPoints" | "description")}
              disabled={!sendDesc}
              className="bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg px-2 py-1 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-40">
              <option value="keyPoints">Key Points</option>
              <option value="description">Description</option>
            </select>
            <span className="text-sm text-gray-600 dark:text-gray-300">to the AI</span>
            <span className="text-xs text-gray-600">(helps the AI refine rather than rewrite from scratch)</span>
            <label className={`flex items-center gap-2 cursor-pointer px-2.5 py-1 rounded-lg border transition-colors ${grounded ? "bg-blue-950/50 border-blue-600/60 text-blue-300" : "border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-500"}`}>
              <input type="checkbox" checked={grounded} onChange={e => setGrounded(e.target.checked)}
                className="w-3.5 h-3.5 rounded accent-blue-500" />
              <span className="text-xs font-medium">🔍 Google Search</span>
            </label>
          </div>

          {/* Lot selector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider">Select lots</label>
              <div className="flex gap-2 flex-wrap justify-end">
                <button onClick={() => quickSelect(lots.filter(l => !l.aiUpgraded && l.imageUrls.length > 0).map(l => l.id))}
                  className="text-xs text-gray-600 dark:text-gray-500 hover:text-purple-400 transition-colors">Not upgraded</button>
                <span className="text-gray-700 text-xs">·</span>
                <button onClick={() => quickSelect(lots.filter(l => l.imageUrls.length > 0).map(l => l.id))}
                  className="text-xs text-gray-600 dark:text-gray-500 hover:text-purple-400 transition-colors">Has photos</button>
                <span className="text-gray-700 text-xs">·</span>
                <button onClick={() => quickSelect(lots.map(l => l.id))}
                  className="text-xs text-gray-600 dark:text-gray-500 hover:text-purple-400 transition-colors">All</button>
                <span className="text-gray-700 text-xs">·</span>
                <button onClick={() => quickSelect([])}
                  className="text-xs text-gray-600 dark:text-gray-500 hover:text-gray-300 transition-colors">None</button>
              </div>
            </div>

            <div className="border border-gray-700 rounded-xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center gap-3 px-4 py-2 bg-gray-100 dark:bg-[#111113] border-b border-gray-200 dark:border-gray-800">
                <input type="checkbox"
                  checked={lots.length > 0 && selectedLotIds.size === lots.length}
                  onChange={() => selectedLotIds.size === lots.length ? quickSelect([]) : quickSelect(lots.map(l => l.id))}
                  className="w-3.5 h-3.5 rounded accent-purple-500 flex-shrink-0" />
                <span className="text-xs text-gray-600 flex-1">
                  {selectedLotIds.size} of {lots.length} lots selected
                </span>
                <span className="text-xs text-gray-700 w-10 text-center">Photos</span>
                <span className="text-xs text-gray-700 w-6 text-center">AI</span>
              </div>

              {/* Lot rows */}
              <div className="max-h-56 overflow-y-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "#4b5563 transparent" }}>
                {lots.map(lot => (
                  <label key={lot.id}
                    className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer border-b border-gray-200 dark:border-gray-800 last:border-0 transition-colors ${
                      selectedLotIds.has(lot.id) ? "bg-purple-900/10" : "hover:bg-gray-50 dark:hover:bg-[#1a1a1e]"
                    }`}>
                    <input type="checkbox" checked={selectedLotIds.has(lot.id)} onChange={() => toggleLot(lot.id)}
                      className="w-3.5 h-3.5 rounded accent-purple-500 flex-shrink-0" />
                    <span className="font-mono text-xs text-purple-300 w-14 flex-shrink-0">{lot.barcode ?? lot.receiptUniqueId ?? ""}</span>
                    <span className="text-xs text-gray-600 dark:text-gray-300 flex-1 truncate">{lot.title || <span className="text-gray-600 italic">Untitled</span>}</span>
                    <span className="text-xs w-10 text-center">
                      {lot.imageUrls.length > 0
                        ? <span className="text-[#2AB4A6]">{lot.imageUrls.length}</span>
                        : <span className="text-gray-700">—</span>}
                    </span>
                    <span className="w-6 text-center text-xs">
                      {lot.aiUpgraded ? "✨" : <span className="text-gray-700">—</span>}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {error && <p className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2">{error}</p>}

          <button onClick={start} disabled={eligibleLots.length === 0}
            className="w-full py-3 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 text-white font-semibold rounded-xl text-sm transition-colors">
            ✨ Run AI on {eligibleLots.length} lot{eligibleLots.length !== 1 ? "s" : ""}
          </button>
        </div>
      )}

      {/* ── Fetching photos ── */}
      {phase === "fetching" && (
        <ProgressCard
          title="Fetching photos…"
          subtitle={`${fetchProgress.done} / ${fetchProgress.total} images downloaded`}
          pct={fetchProgress.total > 0 ? (fetchProgress.done / fetchProgress.total) * 100 : 0}
          log={log} logRef={logRef}
          onCancel={handleCancel}
        />
      )}

      {/* ── Running AI ── */}
      {phase === "running" && (
        <ProgressCard
          title={paused ? "Paused" : "Running AI…"}
          subtitle={`${runProgress.done} / ${runProgress.total} lots processed`}
          pct={runProgress.total > 0 ? (runProgress.done / runProgress.total) * 100 : 0}
          log={log} logRef={logRef}
          onCancel={() => { handleCancel(); }}
          cancelLabel="Stop & review"
          onPause={paused ? undefined : handlePause}
          onResume={paused ? handleResume : undefined}
          onReviewNow={paused && results.filter(r => r.status === "ok").length > 0
            ? () => { handleCancel(); }
            : undefined}
          reviewNowCount={results.filter(r => r.status === "ok").length}
          paused={paused}
          liveResults={results}
        />
      )}

      {/* ── Review ── */}
      {phase === "review" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-200">Review AI Results</h2>
              <p className="text-xs text-gray-600 dark:text-gray-500 mt-0.5">
                {okCount} generated · {failedCount > 0 ? `${failedCount} failed · ` : ""}{approvedCount} approved
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={rejectAll}   className="px-3 py-1.5 rounded-lg border border-gray-700 text-gray-600 dark:text-gray-400 text-xs hover:border-gray-500 transition-colors">Deselect all</button>
              <button onClick={approveAll}  className="px-3 py-1.5 rounded-lg border border-purple-700/50 text-purple-300 text-xs hover:border-purple-500 transition-colors">Select all</button>
            </div>
          </div>

          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {results.map(r => (
              <ReviewRow key={r.lotId} result={r} onToggle={() => toggleApprove(r.lotId)} />
            ))}
          </div>

          {error && <p className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button onClick={() => { setPhase("idle"); setResults([]) }}
              className="px-5 py-2.5 rounded-lg border border-gray-700 text-gray-600 dark:text-gray-400 text-sm hover:border-gray-500 transition-colors">
              ← Start over
            </button>
            <button onClick={applyApproved} disabled={approvedCount === 0}
              className="flex-1 py-2.5 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 text-white font-semibold rounded-xl text-sm transition-colors">
              Apply {approvedCount} approved description{approvedCount !== 1 ? "s" : ""}
            </button>
          </div>
        </div>
      )}

      {/* ── Saving ── */}
      {phase === "saving" && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl px-6 py-5 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">Saving descriptions…</p>
              <span className="ml-auto text-xs text-gray-600 dark:text-gray-500">{saveProgress.done} / {saveProgress.total}</span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-2">
              <div className="bg-purple-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${saveProgress.total > 0 ? (saveProgress.done / saveProgress.total) * 100 : 0}%` }} />
            </div>
          </div>
          {log.length > 0 && (
            <div ref={logRef} className="bg-gray-100 dark:bg-[#0d0d0f] border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-72 overflow-y-auto font-mono text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
              {log.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
        </div>
      )}

      {/* ── Done ── */}
      {phase === "done" && (
        <div className="space-y-4">
          <div className="bg-purple-900/10 border border-purple-700/30 rounded-xl px-6 py-8 flex flex-col items-center gap-2">
            <span className="text-4xl">✓</span>
            <p className="text-sm font-semibold text-purple-300">Descriptions updated</p>
            <p className="text-xs text-gray-600 dark:text-gray-400">{approvedCount} lot{approvedCount !== 1 ? "s" : ""} updated with AI-generated descriptions</p>
          </div>
          <button onClick={() => { setPhase("idle"); setResults([]) }}
            className="w-full py-2.5 rounded-lg border border-gray-700 text-gray-600 dark:text-gray-400 text-sm hover:border-gray-500 transition-colors">
            Run again
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProgressCard({
  title, subtitle, pct, log, logRef, onCancel, cancelLabel, onPause, onResume, onReviewNow, reviewNowCount, paused, liveResults,
}: {
  title: string; subtitle: string; pct: number
  log: string[]; logRef: React.RefObject<HTMLDivElement | null>
  onCancel: () => void
  cancelLabel?: string
  onPause?: () => void
  onResume?: () => void
  onReviewNow?: () => void
  reviewNowCount?: number
  paused?: boolean
  liveResults?: { status: string; label: string }[]
}) {
  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl px-6 py-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">{title}</p>
          <div className="flex items-center gap-3">
            {onReviewNow && (
              <button onClick={onReviewNow}
                className="text-xs text-purple-400 hover:text-purple-300 font-medium transition-colors">
                Review {reviewNowCount} result{reviewNowCount !== 1 ? "s" : ""} →
              </button>
            )}
            {onResume && (
              <button onClick={onResume}
                className="text-xs text-green-400 hover:text-green-300 font-medium transition-colors">
                ▶ Resume
              </button>
            )}
            {onPause && (
              <button onClick={onPause}
                className="text-xs text-yellow-500 hover:text-yellow-400 font-medium transition-colors">
                ⏸ Pause
              </button>
            )}
            <button onClick={onCancel}
              className="text-xs text-gray-600 hover:text-red-400 transition-colors">
              {cancelLabel ?? "Cancel"}
            </button>
          </div>
        </div>
        <div className="w-full bg-gray-800 rounded-full h-2.5">
          <div
            className={`h-2.5 rounded-full transition-all duration-300 ${paused ? "bg-yellow-500" : "bg-purple-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-500 text-center">{subtitle}</p>
      </div>
      {log.length > 0 && (
        <div ref={logRef} className="bg-gray-100 dark:bg-[#0d0d0f] border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-72 overflow-y-auto font-mono text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
          {log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
    </div>
  )
}

function ReviewRow({ result, onToggle }: { result: LotResult; onToggle: () => void }) {
  const [expanded, setExpanded] = useState(false)

  if (result.status === "failed") {
    return (
      <div className="bg-red-900/10 border border-red-800/40 rounded-xl px-4 py-3 flex items-center gap-3">
        <span className="font-mono text-xs text-red-400 w-16 flex-shrink-0">{result.label}</span>
        <span className="text-xs text-red-500 flex-1">Failed: {result.error}</span>
      </div>
    )
  }

  return (
    <div className={`border rounded-xl overflow-hidden transition-colors ${
      result.approved ? "border-purple-700/50 bg-purple-900/10" : "border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E]"
    }`}>
      {/* Compact header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <input type="checkbox" checked={result.approved} onChange={onToggle}
          className="accent-purple-500 w-4 h-4 flex-shrink-0 cursor-pointer" />
        <span className="font-mono text-xs text-purple-300 w-16 flex-shrink-0">{result.label}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-300 truncate">{result.newDescription}</p>
          {result.newEstimateRaw && (
            <p className="text-xs text-gray-600 mt-0.5">
              {result.oldEstimateLow ? `£${result.oldEstimateLow}–£${result.oldEstimateHigh}` : "no estimate"} → <span className="text-purple-400">{result.newEstimateRaw}</span>
            </p>
          )}
        </div>
        <button onClick={() => setExpanded(x => !x)}
          className="text-xs text-gray-600 hover:text-gray-400 flex-shrink-0 px-2 py-1 rounded transition-colors">
          {expanded ? "▲ Less" : "▼ More"}
        </button>
      </div>

      {/* Expanded diff */}
      {expanded && (
        <div className="grid grid-cols-2 gap-0 border-t border-gray-200 dark:border-gray-800">
          <div className="p-4 border-r border-gray-200 dark:border-gray-800">
            <p className="text-xs text-gray-600 uppercase tracking-wider mb-2">Current</p>
            <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-wrap">
              {result.oldDescription || <span className="italic text-gray-700">No description</span>}
            </p>
            {result.oldEstimateLow && (
              <p className="text-xs text-gray-600 mt-2">Estimate: £{result.oldEstimateLow}–£{result.oldEstimateHigh}</p>
            )}
          </div>
          <div className="p-4">
            <p className="text-xs text-purple-400 uppercase tracking-wider mb-2">AI Upgraded</p>
            <p className="text-xs text-gray-700 dark:text-gray-200 leading-relaxed whitespace-pre-wrap">{result.newDescription}</p>
            {result.newEstimateRaw && (
              <p className="text-xs text-purple-400 mt-2">Estimate: {result.newEstimateRaw}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
