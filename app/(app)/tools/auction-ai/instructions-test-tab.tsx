"use client"

import { useEffect, useRef, useState } from "react"
import { useInstructionOptions } from "./use-instructions"
import { rateFor, formatUsd, type ModelRate } from "@/lib/ai-pricing"

// ─── Instructions Testing ─────────────────────────────────────────────────────
//
// The Auto Pipeline scoped down to a handful of hand-picked lots, for trying an
// instruction change out before letting it loose on a 500-lot sale.
//
// ⚠⚠ PREVIEW ONLY — this tab NEVER writes. No description, no estimate, no
// aiFlagNote, no pipeline/run row. That is the whole point: you can run the
// awkward lots through new wording as many times as you like without touching
// the catalogue. Every write the real pipeline performs (applyAiDescriptionOne,
// applyAiEstimateOne, saveAiFlagNote, /api/auction-ai/pipeline/lot,
// /api/auction-ai/runs) is deliberately absent — do not "helpfully" add one.
//
// It calls the SAME three server routes as the pipeline (/batch,
// /key-points-check, /double-check), so the instruction text, the Dolls & Bears
// clean-up, the product-code guard and the relaxed/strict KP wording all come
// from the one server-side source. Nothing about the prompts is re-implemented
// here — see RULES.md "Auction AI Instructions — Single Source of Truth".
//
// ⚠ Instruction wording is NOT editable here. Run tabs post a presetKey, never
// instruction text (RULES.md:395). Edit on the Instructions tab, then run.

type StageState = "waiting" | "running" | "ok" | "skipped" | "error"

// What one AI call really cost, as reported by the route from Google's own usage count
// (lib/ai-photo-options.ts). Added 2026-10-01 for the photo measurement.
type Usage = {
  promptTokens:  number | null
  imageTokens:   number | null
  textTokens:    number | null
  outputTokens:  number | null
  thoughtTokens: number | null
  totalTokens:   number | null
  ms?:            number
  imageCount?:    number
  bytesOriginal?: number
  bytesSent?:     number
  photoDetail?:   string
  photoMaxPx?:    number | null
  model?:         string
}

type PhotoDetailChoice = "standard" | "medium" | "low"

type TestLot = {
  id:          string
  label:       string
  keyPoints:   string
  imageUrls:   string[]
  catalogueDesc: string      // what is on the lot right now — for comparison only, never overwritten

  state?:      StageState
  error?:      string

  // Stage 1 — Batch
  batchDesc?:  string
  estimate?:   string
  batchFlag?:  string
  batchSkip?:  string
  batchUsage?: Usage

  // Stage 1b — the same Batch call again at Medium photo detail, for the side-by-side
  // comparison. Only filled when "Compare" is ticked; never feeds the later stages.
  batchDescB?:  string
  estimateB?:   string
  batchFlagB?:  string
  batchUsageB?: Usage
  batchErrorB?: string

  // Stage 2 — Key Points
  kpDesc?:     string
  kpStatus?:   "ok" | "fixed" | "skipped" | "error"
  kpMissing?:  string
  kpAdded?:    string
  kpFlag?:     string
  kpSkip?:     string
  kpUsage?:    Usage

  // Stage 3 — Double Check
  dcDesc?:     string
  dcStatus?:   "ok" | "issues" | "skipped" | "error"
  contradictions?: string
  unsupported?:    string
  dcFlag?:     string
  dcSkip?:     string
  dcUsage?:    Usage
}

// A test run must come back to you. The real pipeline retries forever on purpose
// (a sale must never silently lose a lot), but a tab you are sitting in front of
// waiting for 5 lots must not hang for half an hour on a rate limit — so this
// gives up after MAX_ATTEMPTS and says so loudly on the lot. Nothing fails silently.
const MAX_ATTEMPTS = 3

function chunkedBase64(buf: ArrayBuffer): string {
  // String.fromCharCode(...bigArray) overflows the stack on a large photo.
  const bytes = new Uint8Array(buf)
  let binary = ""
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return btoa(binary)
}

export default function InstructionsTestTab({ model, fallbackModel }: { model: string; fallbackModel: string }) {
  const [auctionList, setAuctionList] = useState<{ code: string; name: string }[]>([])
  const [code,        setCode]        = useState("")
  const [lots,        setLots]        = useState<TestLot[]>([])
  const [selected,    setSelected]    = useState<Set<string>>(new Set())
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  const [instructions, setInstructions] = useState<Record<string, string>>({})
  const [preset,       setPreset]       = useState("")
  const [kpRelaxed,    setKpRelaxed]    = useState(true)
  const [grounded,     setGrounded]     = useState(false)
  const [runKp,        setRunKp]        = useState(true)
  const [runDc,        setRunDc]        = useState(true)

  const [running,   setRunning]   = useState(false)
  const [progress,  setProgress]  = useState<{ done: number; total: number } | null>(null)
  const [log,       setLog]       = useState<string[]>([])
  const [expanded,  setExpanded]  = useState<Set<string>>(new Set())
  const [onlyPhotos, setOnlyPhotos] = useState(true)

  // Photo measurement (2026-10-01). Gemini 3 charges a fixed number of tokens per photo set
  // by its DETAIL level, whatever the pixel size — so Detail is the lever on the bill, and
  // Shrink only changes what is uploaded. See lib/ai-photo-options.ts.
  const [photoDetail,   setPhotoDetail]   = useState<PhotoDetailChoice>("standard")
  const [photoMaxPx,    setPhotoMaxPx]    = useState("")      // "" = send the originals, as every real run does
  const [compareMedium, setCompareMedium] = useState(false)
  const [rateOverrides, setRateOverrides] = useState<Record<string, ModelRate>>({})

  const cancelRef = useRef(false)
  const logRef    = useRef<HTMLDivElement>(null)

  useInstructionOptions(setInstructions, setPreset)

  useEffect(() => {
    fetch("/api/auction-ai/auctions").then(r => r.json()).then(d => { if (Array.isArray(d)) setAuctionList(d) }).catch(() => {})
    // The admin's price overrides (Admin → AI Models), so the totals below are priced the
    // same way the run-cost estimate above the real Run buttons is.
    fetch("/api/ai-rates").then(r => r.json()).then(d => { if (d && d.overrides && typeof d.overrides === "object") setRateOverrides(d.overrides) }).catch(() => {})
  }, [])

  function addLog(msg: string) {
    const ts = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    setLog(l => [...l, `[${ts}]  ${msg}`])
    setTimeout(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }), 50)
  }

  async function handleLoad() {
    const upper = code.trim().toUpperCase()
    if (!upper) return
    setLoading(true); setError(null); setLots([]); setSelected(new Set()); setLog([]); setProgress(null)
    try {
      const res = await fetch(`/api/auction-ai/catalogue-lots?code=${encodeURIComponent(upper)}`)
      if (!res.ok) throw new Error((await res.json()).error ?? "Catalogue not found")
      const data = await res.json()
      const mapped: TestLot[] = (data.lots ?? []).map((l: any) => ({
        id:            l.id,
        label:         l.barcode || l.receiptUniqueId || l.id,
        keyPoints:     l.keyPoints ?? "",
        imageUrls:     l.imageUrls ?? [],
        catalogueDesc: l.description ?? "",
      }))
      const shown = onlyPhotos ? mapped.filter(l => l.imageUrls.length > 0) : mapped
      setLots(shown)
      const hidden = mapped.length - shown.length
      addLog(`▶ Loaded ${shown.length} lots from ${upper}${hidden > 0 ? ` (${hidden} without photos hidden)` : ""} — tick the ones to test`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function toggle(id: string) {
    setSelected(s => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  function selectFirst(n: number) {
    setSelected(new Set(lots.slice(0, n).map(l => l.id)))
  }

  // Bounded retry, alternating primary/fallback model so a rate limit or a
  // RECITATION block gets a shot at the other one. Returns null on give-up; the
  // caller records the reason on the lot so it is visible, never silent.
  async function attempt<T>(label: string, fn: (modelToUse: string) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
    let lastError = ""
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      if (cancelRef.current) return { ok: false, error: "stopped" }
      const modelToUse = (i % 2 === 0 && fallbackModel) ? fallbackModel : model
      if (i > 1) {
        addLog(`  ↺ ${label} — retry ${i}/${MAX_ATTEMPTS} with ${modelToUse}`)
        await new Promise(r => setTimeout(r, 3000))
        if (cancelRef.current) return { ok: false, error: "stopped" }
      }
      try {
        return { ok: true, value: await fn(modelToUse) }
      } catch (e: any) {
        lastError = e?.message ?? String(e)
        if (/block/i.test(lastError)) break   // content block — another attempt won't help
      }
    }
    return { ok: false, error: lastError || "failed" }
  }

  async function fetchImageFiles(lot: TestLot, max: number): Promise<File[]> {
    const out: File[] = []
    for (const [i, url] of lot.imageUrls.slice(0, max).entries()) {
      try {
        const r = await fetch(`/api/catalogue/photo-proxy?key=${encodeURIComponent(url)}`)
        if (!r.ok) continue
        const blob = await r.blob()
        out.push(new File([blob], url.split("/").pop() || `img_${i}.jpg`, { type: blob.type || "image/jpeg" }))
      } catch { /* skip the failed photo, carry on with the rest */ }
    }
    return out
  }

  async function handleRun() {
    const toRun = lots.filter(l => selected.has(l.id))
    if (!toRun.length || !preset) return
    cancelRef.current = false
    setRunning(true)
    setProgress({ done: 0, total: toRun.length })
    setLog([])
    addLog(`🧪 Test run — ${toRun.length} lots · instruction "${preset}" · ${model}${fallbackModel ? ` (fallback ${fallbackModel})` : ""}`)
    addLog(`   Stages: Batch${runKp ? " → Key Points" + (kpRelaxed ? " (relaxed)" : " (strict)") : ""}${runDc ? " → Double Check" : ""}`)
    addLog(`   PREVIEW ONLY — nothing will be written to the catalogue.`)
    addLog(`   Photos: ${compareMedium ? "Standard AND Medium detail, side by side" : `${photoDetail} detail`}${photoMaxPx ? ` · shrunk to ${Number(photoMaxPx).toLocaleString("en-GB")} px before sending` : " · originals sent"}`)

    // Clear any previous results on the selected lots
    const working = lots.map(l => selected.has(l.id)
      ? { ...l, state: "waiting" as StageState, error: undefined, batchDesc: undefined, estimate: undefined, batchFlag: undefined, batchSkip: undefined,
          batchUsage: undefined, batchDescB: undefined, estimateB: undefined, batchFlagB: undefined, batchUsageB: undefined, batchErrorB: undefined, kpUsage: undefined, dcUsage: undefined,
          kpDesc: undefined, kpStatus: undefined, kpMissing: undefined, kpAdded: undefined, kpFlag: undefined, kpSkip: undefined,
          dcDesc: undefined, dcStatus: undefined, contradictions: undefined, unsupported: undefined, dcFlag: undefined, dcSkip: undefined }
      : l)
    setLots([...working])

    let done = 0
    for (const lot of toRun) {
      if (cancelRef.current) break
      const idx = working.findIndex(l => l.id === lot.id)
      working[idx] = { ...working[idx], state: "running" }
      setLots([...working])

      // ── Stage 1: Batch ──────────────────────────────────────────────────────
      addLog(`· ${done + 1}/${toRun.length} ${lot.label} — batch…`)
      let currentDesc = ""

      if (lot.imageUrls.length === 0) {
        working[idx] = { ...working[idx], state: "skipped", batchSkip: "no photos" }
        setLots([...working]); addLog(`  — ${lot.label} skipped (no photos)`)
        done++; setProgress({ done, total: toRun.length }); continue
      }

      // The photos are fetched ONCE per lot so the comparison run sees exactly the same files.
      const files = await fetchImageFiles(lot, 24)
      const batchCall = (detail: PhotoDetailChoice) => async (modelToUse: string) => {
        if (!files.length) throw new Error("No images could be fetched")
        const fd = new FormData()
        fd.append("presetKey", preset)
        fd.append("model", modelToUse)
        fd.append("grounded", grounded ? "true" : "false")
        // Both optional on the route; "standard" and "" mean "send what every real run sends".
        if (detail !== "standard") fd.append("photoDetail", detail)
        if (photoMaxPx) fd.append("photoMaxPx", photoMaxPx)
        files.forEach((f, i) => fd.append(`lot_${lot.label}_image_${i}`, f, f.name))
        if (lot.keyPoints.trim()) {
          fd.append(`lot_${lot.label}_context`, lot.keyPoints.trim())
          fd.append(`lot_${lot.label}_contextType`, "keyPoints")
        }
        const res  = await fetch("/api/auction-ai/batch", { method: "POST", body: fd })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? res.statusText)
        const r = json.results?.[0]
        if (!r || r.status !== "OK") throw new Error(r?.error ?? "No result from Gemini")
        return r
      }

      // In Compare mode the pipeline proper runs at Standard (what production does) and the
      // Medium call is an extra, shown beside it — never fed into Key Points or Double Check.
      const mainDetail: PhotoDetailChoice = compareMedium ? "standard" : photoDetail
      const batch = await attempt(lot.label, batchCall(mainDetail))

      if (!batch.ok) {
        working[idx] = { ...working[idx], state: "error", error: batch.error }
        setLots([...working]); addLog(`  ✗ ${lot.label} — batch failed: ${batch.error}`)
        done++; setProgress({ done, total: toRun.length }); continue
      }

      currentDesc = batch.value.description ?? ""
      working[idx] = { ...working[idx], batchDesc: currentDesc, estimate: batch.value.estimate ?? "", batchFlag: batch.value.flag || undefined, batchUsage: batch.value.usage }
      setLots([...working])
      addLog(`  ✓ ${lot.label} — batch OK${batch.value.usage ? ` · ${describeUsage(batch.value.usage)}` : ""}`)

      if (compareMedium && !cancelRef.current) {
        addLog(`  · ${lot.label} — batch again at Medium detail…`)
        const b = await attempt(lot.label, batchCall("medium"))
        if (b.ok) {
          working[idx] = { ...working[idx], batchDescB: b.value.description ?? "", estimateB: b.value.estimate ?? "", batchFlagB: b.value.flag || undefined, batchUsageB: b.value.usage }
          addLog(`  ✓ ${lot.label} — medium OK${b.value.usage ? ` · ${describeUsage(b.value.usage)}` : ""}`)
        } else {
          working[idx] = { ...working[idx], batchErrorB: b.error }
          addLog(`  ✗ ${lot.label} — medium failed: ${b.error}`)
        }
        setLots([...working])
      }

      // ── Stage 2: Key Points ─────────────────────────────────────────────────
      if (runKp) {
        if (!currentDesc || !lot.keyPoints.trim()) {
          working[idx] = { ...working[idx], kpStatus: "skipped", kpSkip: !currentDesc ? "no description" : "no key points" }
          setLots([...working])
        } else {
          addLog(`  · ${lot.label} — key points…`)
          const kp = await attempt(lot.label, async (modelToUse) => {
            const res = await fetch("/api/auction-ai/key-points-check", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ label: lot.label, keyPoints: lot.keyPoints, description: currentDesc, model: modelToUse, mode: kpRelaxed ? "relaxed" : "strict", presetKey: preset }),
            })
            const json = await res.json()
            if (json.error) throw new Error(json.error)
            return json
          })
          if (kp.ok) {
            const { revised, changed, missing, added, flag } = kp.value
            if (changed && revised) currentDesc = revised
            working[idx] = { ...working[idx], kpDesc: currentDesc, kpStatus: changed && revised ? "fixed" : "ok", kpMissing: missing, kpAdded: added, kpFlag: flag || undefined, kpUsage: kp.value.usage }
            if (flag) addLog(`  ⚑ ${lot.label} — key points flagged: ${flag}`)
          } else {
            working[idx] = { ...working[idx], kpStatus: "error", kpSkip: kp.error }
            addLog(`  ✗ ${lot.label} — key points failed: ${kp.error}`)
          }
          setLots([...working])
        }
      }

      // ── Stage 3: Double Check ───────────────────────────────────────────────
      if (runDc && !cancelRef.current) {
        if (!currentDesc) {
          working[idx] = { ...working[idx], dcStatus: "skipped", dcSkip: "no description" }
          setLots([...working])
        } else {
          addLog(`  · ${lot.label} — double check…`)
          const dc = await attempt(lot.label, async (modelToUse) => {
            const files  = await fetchImageFiles(lot, 6)
            const images = await Promise.all(files.map(async f => ({
              data: chunkedBase64(await f.arrayBuffer()),
              mimeType: f.type || "image/jpeg",
            })))
            const res = await fetch("/api/auction-ai/double-check", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ label: lot.label, description: currentDesc, images, model: modelToUse, keyPoints: lot.keyPoints, presetKey: preset,
                ...(mainDetail !== "standard" ? { photoDetail: mainDetail } : {}) }),
            })
            const json = await res.json()
            if (json.error) throw new Error(json.error)
            return json
          })
          if (dc.ok) {
            const { verdict, contradictions, unsupported, revised, flag } = dc.value
            if (verdict === "issues" && revised) currentDesc = revised
            working[idx] = { ...working[idx], dcDesc: currentDesc, dcStatus: verdict === "issues" ? "issues" : "ok", contradictions, unsupported, dcFlag: flag || undefined, dcUsage: dc.value.usage }
            if (flag) addLog(`  ⚑ ${lot.label} — double check flagged: ${flag}`)
          } else {
            working[idx] = { ...working[idx], dcStatus: "error", dcSkip: dc.error }
            addLog(`  ✗ ${lot.label} — double check failed: ${dc.error}`)
          }
          setLots([...working])
        }
      }

      working[idx] = { ...working[idx], state: "ok" }
      setLots([...working])
      setExpanded(e => new Set(e).add(lot.id))
      done++; setProgress({ done, total: toRun.length })
    }

    addLog(cancelRef.current ? `⏹ Stopped after ${done} lots.` : `🎉 Test run finished — ${done} lots. Nothing was saved.`)
    setRunning(false)
  }

  const selCount = selected.size
  const results  = lots.filter(l => selected.has(l.id) && l.state)

  return (
    <div className="max-w-none">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">🧪 Instructions Testing</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
          Run a handful of real lots through the full pipeline to see what an instruction change actually produces.
        </p>
      </div>

      {/* The one thing that must never be in doubt about this tab. */}
      <div className="mb-4 rounded border border-emerald-600/40 bg-emerald-500/10 px-4 py-2.5">
        <p className="text-sm text-emerald-800 dark:text-emerald-300">
          <strong>Preview only.</strong> Nothing here is written to the catalogue — no descriptions, no estimates, no flag notes.
          Run the same lots as often as you like. To change the wording, edit it on the <strong>Instructions</strong> tab and come back.
        </p>
      </div>

      {/* ── Setup ── */}
      <div className="rounded border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#141416] p-4 mb-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-500 mb-1 uppercase tracking-wider">Sale</label>
            <div className="flex gap-2">
              <select value={code} onChange={e => setCode(e.target.value)}
                className="flex-1 bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[#C8A96E]">
                <option value="">— pick a sale —</option>
                {auctionList.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
              </select>
              <button onClick={handleLoad} disabled={!code || loading || running}
                className="px-4 py-2 rounded text-sm font-medium bg-[#C8A96E] text-black disabled:opacity-40 disabled:cursor-not-allowed">
                {loading ? "Loading…" : "Load lots"}
              </button>
            </div>
            <label className="flex items-center gap-2 mt-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
              <input type="checkbox" checked={onlyPhotos} onChange={e => setOnlyPhotos(e.target.checked)} disabled={running} />
              Only lots with photos (Batch skips the rest anyway)
            </label>
          </div>

          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-500 mb-1 uppercase tracking-wider">Instruction</label>
            <select value={preset} onChange={e => setPreset(e.target.value)} disabled={running}
              className="w-full bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[#C8A96E]">
              {Object.keys(instructions).map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2">
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                <input type="checkbox" checked={runKp} onChange={e => setRunKp(e.target.checked)} disabled={running} />
                Key Points stage
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                <input type="checkbox" checked={kpRelaxed} onChange={e => setKpRelaxed(e.target.checked)} disabled={running || !runKp} />
                …relaxed wording
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                <input type="checkbox" checked={runDc} onChange={e => setRunDc(e.target.checked)} disabled={running} />
                Double Check stage
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                <input type="checkbox" checked={grounded} onChange={e => setGrounded(e.target.checked)} disabled={running} />
                Google grounding
              </label>
            </div>
          </div>
        </div>
        {/* ── Photos — the measurement (2026-10-01) ── */}
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-800">
          <label className="block text-xs text-gray-600 dark:text-gray-500 mb-1.5 uppercase tracking-wider">Photos</label>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
              Detail
              <select value={photoDetail} onChange={e => setPhotoDetail(e.target.value as PhotoDetailChoice)} disabled={running || compareMedium}
                className="bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-xs text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[#C8A96E] disabled:opacity-50">
                <option value="standard">Standard — 1,120 tokens a photo (what every run uses today)</option>
                <option value="medium">Medium — 560 tokens a photo</option>
                <option value="low">Low — 280 tokens a photo</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
              Shrink before sending
              <select value={photoMaxPx} onChange={e => setPhotoMaxPx(e.target.value)} disabled={running}
                className="bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-xs text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[#C8A96E] disabled:opacity-50">
                <option value="">Off — send the originals</option>
                <option value="2048">to 2,048 px</option>
                <option value="1600">to 1,600 px</option>
                <option value="1200">to 1,200 px</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" checked={compareMedium} onChange={e => setCompareMedium(e.target.checked)} disabled={running} />
              Compare — run Batch at Standard <em>and</em> Medium, side by side
            </label>
          </div>
          <p className="mt-2 text-[11px] text-gray-600 dark:text-gray-500 max-w-4xl">
            Gemini 3 charges a fixed amount per photo set by <strong>Detail</strong>, whatever the photo's size — so <strong>Shrink</strong> cuts the upload and the time, not the bill.
            Lower detail does cut the bill; the question is whether box labels and catalogue numbers still get read, which is what <strong>Compare</strong> is for.
            Every figure in the results is Google's own count for the call, not an estimate.
          </p>
        </div>
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
      </div>

      {/* ── Lot picker ── */}
      {lots.length > 0 && (
        <div className="rounded border border-gray-200 dark:border-gray-800 mb-4">
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#141416]">
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              {selCount} of {lots.length} selected
            </span>
            <div className="flex gap-1.5 ml-2">
              <button onClick={() => selectFirst(5)}  disabled={running} className="px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40">First 5</button>
              <button onClick={() => selectFirst(10)} disabled={running} className="px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40">First 10</button>
              <button onClick={() => setSelected(new Set())} disabled={running} className="px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40">Clear</button>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {running
                ? <button onClick={() => { cancelRef.current = true }} className="px-4 py-1.5 rounded text-sm font-medium bg-red-600 text-white">⏹ Stop</button>
                : <button onClick={handleRun} disabled={!selCount || !preset}
                    className="px-4 py-1.5 rounded text-sm font-medium bg-[#C8A96E] text-black disabled:opacity-40 disabled:cursor-not-allowed">
                    🧪 Test {selCount || ""} {selCount === 1 ? "lot" : "lots"}
                  </button>}
            </div>
          </div>

          {selCount > 20 && (
            <p className="px-4 py-2 text-xs text-amber-700 dark:text-amber-400 border-b border-gray-200 dark:border-gray-800">
              {selCount} lots selected — this is meant for 5–10. A large test run costs the same per lot as the real pipeline.
            </p>
          )}

          <div className="max-h-80 overflow-y-auto divide-y divide-gray-200 dark:divide-gray-800">
            {lots.map(l => (
              <label key={l.id} className="flex items-start gap-3 px-4 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-[#1C1C1E]">
                <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} disabled={running} className="mt-1" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{l.label}</span>
                    <span className="text-xs text-gray-500">{l.imageUrls.length} photo{l.imageUrls.length === 1 ? "" : "s"}</span>
                    {!l.keyPoints.trim() && <span className="text-xs text-amber-600 dark:text-amber-400">no key points</span>}
                    {l.catalogueDesc.trim() && <span className="text-xs text-gray-500">already described</span>}
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-500 truncate">{l.keyPoints.split("\n").join(" · ") || "—"}</p>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* ── Progress + log ── */}
      {(running || log.length > 0) && (
        <div className="rounded border border-gray-200 dark:border-gray-800 mb-4">
          {progress && (
            <div className="px-4 pt-3">
              <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
                <span>{progress.done} / {progress.total}</span>
                <span>{Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%</span>
              </div>
              <div className="h-1.5 bg-gray-200 dark:bg-[#2C2C2E] rounded overflow-hidden">
                <div className="h-full bg-[#C8A96E] transition-all" style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} />
              </div>
            </div>
          )}
          <div ref={logRef} className="max-h-48 overflow-y-auto px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
            {log.map((l, i) => <div key={i} className="whitespace-pre-wrap">{l}</div>)}
          </div>
        </div>
      )}

      {/* ── What it cost — totals from the routes' own usage counts ── */}
      {results.length > 0 && <Totals lots={results} model={model} overrides={rateOverrides} compare={compareMedium} />}

      {/* ── Results ── */}
      {results.map(l => {
        const open  = expanded.has(l.id)
        const final = l.dcDesc || l.kpDesc || l.batchDesc || ""
        const hasB  = l.batchDescB !== undefined || !!l.batchErrorB
        return (
          <div key={l.id} className="rounded border border-gray-200 dark:border-gray-800 mb-3">
            <button onClick={() => setExpanded(e => { const n = new Set(e); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n })}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left bg-gray-50 dark:bg-[#141416]">
              <span className="text-gray-500 text-xs">{open ? "▼" : "▶"}</span>
              <span className="text-sm font-medium text-gray-900 dark:text-white">{l.label}</span>
              {l.state === "running" && <span className="text-xs text-[#C8A96E]">running…</span>}
              {l.state === "error"   && <span className="text-xs text-red-500">failed — {l.error}</span>}
              {l.batchSkip           && <span className="text-xs text-gray-500">skipped — {l.batchSkip}</span>}
              {l.estimate            && <span className="text-xs text-gray-500">Est. {l.estimate}</span>}
              {l.batchUsage?.promptTokens != null && <span className="text-xs text-gray-500">{fmtN(l.batchUsage.promptTokens)} tokens in{l.batchUsage.ms != null ? ` · ${(l.batchUsage.ms / 1000).toFixed(0)} s` : ""}</span>}
              {l.kpStatus === "fixed"  && <span className="text-xs text-amber-600 dark:text-amber-400">✓ key points inserted</span>}
              {l.kpStatus === "ok"     && <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ key points present</span>}
              {l.dcStatus === "issues" && <span className="text-xs text-amber-600 dark:text-amber-400">⚑ double check rewrote</span>}
              {(l.batchFlag || l.kpFlag || l.dcFlag) && <span className="text-xs text-red-500">⚑ flag</span>}
            </button>

            {open && (
              <div className="px-4 py-3 space-y-3">
                {(l.batchFlag || l.kpFlag || l.dcFlag) && (
                  <div className="rounded border border-red-600/40 bg-red-500/10 px-3 py-2 space-y-1">
                    {l.batchFlag && <p className="text-xs text-red-700 dark:text-red-300"><strong>Batch flag:</strong> {l.batchFlag}</p>}
                    {l.kpFlag    && <p className="text-xs text-red-700 dark:text-red-300"><strong>Key Points flag:</strong> {l.kpFlag}</p>}
                    {l.dcFlag    && <p className="text-xs text-red-700 dark:text-red-300"><strong>Double Check flag:</strong> {l.dcFlag}</p>}
                  </div>
                )}

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  <Panel title="Key points (cataloguer)" tone="plain" text={l.keyPoints || "—"} />
                  <Panel title="Currently on the catalogue" tone="plain" text={l.catalogueDesc || "— (nothing yet)"} />
                </div>

                {hasB && (
                  // The comparison: the same photos and key points, the same instruction, two
                  // detail levels. Read these for box labels and catalogue numbers.
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                    <Panel title="⚡ 1. Batch — Standard detail (1,120 tokens a photo)" tone="gold"
                      text={l.batchDesc ?? (l.batchSkip ? `skipped — ${l.batchSkip}` : "—")}
                      note={[l.estimate ? `Est. ${l.estimate}` : "", l.batchUsage ? describeUsage(l.batchUsage) : ""].filter(Boolean).join(" · ")} />
                    <Panel title="⚡ 1b. Batch — Medium detail (560 tokens a photo)" tone="gold"
                      text={l.batchErrorB ? `failed — ${l.batchErrorB}` : (l.batchDescB || "—")}
                      note={[l.estimateB ? `Est. ${l.estimateB}` : "", l.batchFlagB ? `flag: ${l.batchFlagB}` : "", l.batchUsageB ? describeUsage(l.batchUsageB) : ""].filter(Boolean).join(" · ")} />
                  </div>
                )}
                <div className={`grid grid-cols-1 gap-3 ${hasB ? "xl:grid-cols-2" : "xl:grid-cols-3"}`}>
                  {!hasB && (
                    <Panel title="⚡ 1. Batch" tone="gold" text={l.batchDesc ?? (l.batchSkip ? `skipped — ${l.batchSkip}` : "—")}
                      note={l.batchUsage ? describeUsage(l.batchUsage) : undefined} />
                  )}
                  <Panel title={`✓ 2. Key Points${kpRelaxed ? " (relaxed)" : " (strict)"}`} tone="gold"
                    text={!runKp ? "not run" : l.kpSkip ? `skipped — ${l.kpSkip}` : (l.kpDesc ?? "—")}
                    note={[l.kpMissing ? `missing: ${l.kpMissing}` : "", l.kpAdded ? `added: ${l.kpAdded}` : "", l.kpUsage ? describeUsage(l.kpUsage) : ""].filter(Boolean).join(" · ")} />
                  <Panel title="🔎 3. Double Check" tone="gold"
                    text={!runDc ? "not run" : l.dcSkip ? `skipped — ${l.dcSkip}` : (l.dcDesc ?? "—")}
                    note={[l.contradictions ? `contradictions: ${l.contradictions}` : "", l.unsupported ? `unsupported: ${l.unsupported}` : "", l.dcUsage ? describeUsage(l.dcUsage) : ""].filter(Boolean).join(" · ")} />
                </div>

                {final && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs uppercase tracking-wider text-gray-600 dark:text-gray-500">Final result (this is what the pipeline would have applied)</p>
                      <button onClick={() => navigator.clipboard.writeText(final)}
                        className="px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300">Copy</button>
                    </div>
                    <pre className="whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-[#141416] border border-gray-200 dark:border-gray-800 rounded p-3">{final}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Panel({ title, text, note, tone }: { title: string; text: string; note?: string; tone: "plain" | "gold" }) {
  return (
    <div>
      <p className={`text-xs uppercase tracking-wider mb-1 ${tone === "gold" ? "text-[#C8A96E]" : "text-gray-600 dark:text-gray-500"}`}>{title}</p>
      <pre className="whitespace-pre-wrap text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-[#141416] border border-gray-200 dark:border-gray-800 rounded p-2.5 max-h-64 overflow-y-auto">{text}</pre>
      {note && <p className="text-[11px] text-gray-600 dark:text-gray-500 mt-1">{note}</p>}
    </div>
  )
}

// ─── The measurement readout ─────────────────────────────────────────────────

const fmtN = (n: number | null | undefined): string => (n == null ? "?" : n.toLocaleString("en-GB"))
const mb   = (bytes: number | null | undefined): string => (bytes == null ? "?" : `${(bytes / 1_048_576).toFixed(1)} MB`)

/** One line a person can read: "24 photos · 61.3 MB → 9.8 MB sent · 29,410 tokens in (26,880 photos + 2,530 text) · 412 out · 48 s". */
function describeUsage(u: Usage): string {
  const parts: string[] = []
  if (u.imageCount) {
    const shrunk = u.bytesSent != null && u.bytesOriginal != null && u.bytesSent !== u.bytesOriginal
    parts.push(`${u.imageCount} photo${u.imageCount === 1 ? "" : "s"} · ${mb(u.bytesOriginal)}${shrunk ? ` → ${mb(u.bytesSent)} sent` : ""}`)
  }
  parts.push(`${fmtN(u.promptTokens)} tokens in${u.imageTokens != null ? ` (${fmtN(u.imageTokens)} photos + ${fmtN(u.textTokens)} text)` : ""}`)
  parts.push(`${fmtN(u.outputTokens)} out${u.thoughtTokens ? ` + ${fmtN(u.thoughtTokens)} thinking` : ""}`)
  if (u.ms != null) parts.push(`${(u.ms / 1000).toFixed(0)} s`)
  if (u.photoDetail && u.photoDetail !== "default" && u.photoDetail !== "none") parts.push(`${u.photoDetail} detail`)
  return parts.join(" · ")
}

type Sum = { lots: number; photos: number; bytesO: number; bytesS: number; inTok: number; imgTok: number; outTok: number; thought: number; ms: number }

function sumUsage(lots: TestLot[], pick: (l: TestLot) => Usage | undefined): Sum {
  const s: Sum = { lots: 0, photos: 0, bytesO: 0, bytesS: 0, inTok: 0, imgTok: 0, outTok: 0, thought: 0, ms: 0 }
  for (const l of lots) {
    const u = pick(l)
    if (!u) continue
    s.lots++
    s.photos  += u.imageCount    ?? 0
    s.bytesO  += u.bytesOriginal ?? 0
    s.bytesS  += u.bytesSent     ?? 0
    s.inTok   += u.promptTokens  ?? 0
    s.imgTok  += u.imageTokens   ?? 0
    s.outTok  += u.outputTokens  ?? 0
    s.thought += u.thoughtTokens ?? 0
    s.ms      += u.ms            ?? 0
  }
  return s
}

/**
 * Totals for the run, priced the way the run-cost estimate above the real Run buttons is
 * (lib/ai-pricing.ts + the admin's overrides). Google bills thinking tokens as output, so
 * they are priced as output here. An unknown model says "price not set" — never $0.
 */
function Totals({ lots, model, overrides, compare }: { lots: TestLot[]; model: string; overrides: Record<string, ModelRate>; compare: boolean }) {
  const batch  = sumUsage(lots, l => l.batchUsage)
  const batchB = sumUsage(lots, l => l.batchUsageB)
  const kp     = sumUsage(lots, l => l.kpUsage)
  const dc     = sumUsage(lots, l => l.dcUsage)
  if (!batch.lots && !batchB.lots) return null

  const rate = rateFor(model, overrides)
  const usd  = (s: Sum): number | null => rate ? (s.inTok / 1e6) * rate.inputPerM + ((s.outTok + s.thought) / 1e6) * rate.outputPerM : null

  // The lot as the pipeline runs it: Batch (at Standard in Compare mode) + Key Points + Double Check.
  const wholeIn   = batch.inTok + kp.inTok + dc.inTok
  const wholeOut  = batch.outTok + batch.thought + kp.outTok + kp.thought + dc.outTok + dc.thought
  const wholeUsd  = rate ? (wholeIn / 1e6) * rate.inputPerM + (wholeOut / 1e6) * rate.outputPerM : null
  const perLotUsd = wholeUsd != null && batch.lots ? wholeUsd / batch.lots : null
  const saleUsd   = perLotUsd != null ? perLotUsd * 500 : null

  // Compare: the same sale with Batch at Medium, Key Points and Double Check as measured.
  const batchPerLot  = usd(batch)  != null && batch.lots  ? (usd(batch)  as number) / batch.lots  : null
  const batchBPerLot = usd(batchB) != null && batchB.lots ? (usd(batchB) as number) / batchB.lots : null
  const saleUsdB     = saleUsd != null && batchPerLot != null && batchBPerLot != null ? saleUsd - batchPerLot * 500 + batchBPerLot * 500 : null

  const rows: { name: string; s: Sum }[] = [
    { name: compare ? "Batch — Standard detail" : "Batch", s: batch },
    ...(compare ? [{ name: "Batch — Medium detail", s: batchB }] : []),
    { name: "Key Points",   s: kp },
    { name: "Double Check", s: dc },
  ].filter(r => r.s.lots > 0)

  const rateNote = rate
    ? `priced at $${rate.inputPerM}/M in · $${rate.outputPerM}/M out (${rate.source === "override" ? "set in Admin → AI Models" : rate.source === "published" ? "published price" : "best match — check it in Admin → AI Models"})`
    : "Price not set for this model — add it in Admin → AI Models"

  return (
    <div className="rounded border border-gray-200 dark:border-gray-800 mb-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2.5 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#141416]">
        <span className="text-sm font-medium text-gray-900 dark:text-white">📐 What this run cost — Google's own count</span>
        <span className="text-xs text-gray-500">{model} · {rateNote}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-600 dark:text-gray-500 uppercase tracking-wider">
              <th className="px-4 py-2 font-medium">Stage</th>
              <th className="px-3 py-2 font-medium text-right">Lots</th>
              <th className="px-3 py-2 font-medium text-right">Photos</th>
              <th className="px-3 py-2 font-medium text-right">Uploaded</th>
              <th className="px-3 py-2 font-medium text-right">Tokens in</th>
              <th className="px-3 py-2 font-medium text-right">of which photos</th>
              <th className="px-3 py-2 font-medium text-right">Tokens out</th>
              <th className="px-3 py-2 font-medium text-right">Time</th>
              <th className="px-3 py-2 font-medium text-right">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-800 text-gray-800 dark:text-gray-200">
            {rows.map(r => (
              <tr key={r.name}>
                <td className="px-4 py-1.5">{r.name}</td>
                <td className="px-3 py-1.5 text-right">{r.s.lots}</td>
                <td className="px-3 py-1.5 text-right">{r.s.photos || "—"}</td>
                <td className="px-3 py-1.5 text-right">{r.s.photos ? `${mb(r.s.bytesS)}${r.s.bytesS !== r.s.bytesO ? ` (was ${mb(r.s.bytesO)})` : ""}` : "—"}</td>
                <td className="px-3 py-1.5 text-right">{fmtN(r.s.inTok)}</td>
                <td className="px-3 py-1.5 text-right">{r.s.imgTok ? fmtN(r.s.imgTok) : "—"}</td>
                <td className="px-3 py-1.5 text-right">{fmtN(r.s.outTok)}{r.s.thought ? ` + ${fmtN(r.s.thought)} thinking` : ""}</td>
                <td className="px-3 py-1.5 text-right">{(r.s.ms / 1000).toFixed(0)} s</td>
                <td className="px-3 py-1.5 text-right">{formatUsd(usd(r.s))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2.5 border-t border-gray-200 dark:border-gray-800 text-xs text-gray-700 dark:text-gray-300 space-y-1">
        <p>
          <strong>Per lot</strong> as the pipeline runs it (Batch + Key Points + Double Check, the stages ticked above):{" "}
          {fmtN(batch.lots ? Math.round(wholeIn / batch.lots) : 0)} tokens in · {fmtN(batch.lots ? Math.round(wholeOut / batch.lots) : 0)} out · {formatUsd(perLotUsd)}
          {" — "}<strong>a 500-lot sale ≈ {formatUsd(saleUsd)}</strong>
        </p>
        {compare && batchB.lots > 0 && (
          <p>
            With Batch at <strong>Medium</strong> detail instead: a 500-lot sale ≈ <strong>{formatUsd(saleUsdB)}</strong>
            {batch.inTok && batchB.inTok ? ` — Batch tokens ${Math.round((1 - batchB.inTok / batch.inTok) * 100)}% lower` : ""}.
            Whether the descriptions are as good is the thing to read for, lot by lot, below.
          </p>
        )}
        {batch.photos > 0 && batch.bytesS !== batch.bytesO && (
          <p>Shrinking cut the upload from {mb(batch.bytesO)} to {mb(batch.bytesS)}; the Tokens column shows whether it changed the bill.</p>
        )}
      </div>
    </div>
  )
}
