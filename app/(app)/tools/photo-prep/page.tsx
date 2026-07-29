"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  DEFAULT_SETTINGS, ACCEPTED_EXT, AI_FALLBACK_CONFIDENCE, mimeForName,
  fmtDuration, hasFileSystemAccess, workerCount, makeWorkerClient, isSameFolder,
  fetchAiBox, AI_CONCURRENCY,
  type PhotoPrepSettings, type WorkerClient, type CropMode,
} from "@/lib/photo-prep"
import { findBarcode, cardFromBars, rotationFor, cropIsSane, type BarcodeHit } from "@/lib/photo-prep-barcode"

// Photo Prep — auto-crop to the product + brighten, for the photography department.
//
// Runs entirely in the browser. Photos are read straight off disk, processed in
// a pool of Web Workers, and written back into a folder the user picks. Nothing
// is uploaded (the server's body limit is 20MB — a 1000-photo batch could never
// go through it) and memory stays flat because only a few images are in flight.
//
// Cropping is local backdrop detection, which is fast, free and pixel-exact on a
// plain sweep. Photos it isn't confident about can be sent to Gemini afterwards,
// one at a time, and re-cropped with the box it returns.

type SourceFile = { name: string; size: number; get: () => Promise<File> }
type Result = {
  name: string
  status: "done" | "error"
  confidence?: number
  brightened?: boolean
  backdropLuma?: number
  error?: string
  /** "tag" when a barcode was read, "lot" otherwise. */
  kind?: "tag" | "lot"
  barcode?: string
  /** Tag only: the barcode still scanned in the finished image. */
  verified?: boolean
  /** Tag only: no crop would scan, so the whole frame was kept. */
  keptWhole?: boolean
  /** Lot only: the crop was absurdly small and was thrown away. */
  cropRejected?: boolean
  rotateDeg?: number
}

const PREVIEW_DEBOUNCE_MS = 250

export default function PhotoPrepPage() {
  const [files, setFiles]       = useState<SourceFile[]>([])
  const [settings, setSettings] = useState<PhotoPrepSettings>(DEFAULT_SETTINGS)
  const [fsa, setFsa]           = useState(false)

  // Preview
  const [previewIdx, setPreviewIdx]   = useState(0)
  const [beforeUrl, setBeforeUrl]     = useState<string | null>(null)
  const [afterUrl, setAfterUrl]       = useState<string | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewInfo, setPreviewInfo] = useState<any>(null)
  const [aiBox, setAiBox]             = useState<any>(null)
  const [aiBusy, setAiBusy]           = useState(false)

  // Run
  const [running, setRunning]   = useState(false)
  const [done, setDone]         = useState(0)
  const [results, setResults]   = useState<Result[]>([])
  const [error, setError]       = useState<string | null>(null)
  const [elapsed, setElapsed]   = useState(0)
  const [finished, setFinished] = useState(false)
  const [aiFixing, setAiFixing] = useState(false)
  const [aiFixed, setAiFixed]   = useState(0)

  const cancelRef  = useRef(false)
  const previewRef = useRef<WorkerClient | null>(null)
  const outDirRef  = useRef<any>(null)
  const inDirRef   = useRef<any>(null)
  const seqRef     = useRef(0)

  useEffect(() => { setFsa(hasFileSystemAccess()) }, [])

  useEffect(() => {
    const c = makeWorkerClient("/photo-prep-worker.js")
    previewRef.current = c
    return () => { c.terminate(); previewRef.current = null }
  }, [])

  // Revoke preview object URLs on unmount so a long session doesn't leak.
  useEffect(() => () => {
    if (beforeUrl) URL.revokeObjectURL(beforeUrl)
    if (afterUrl)  URL.revokeObjectURL(afterUrl)
  }, [beforeUrl, afterUrl])

  // ── Preview ──────────────────────────────────────────────────────────────
  const runPreview = useCallback(async (forcedBox?: any) => {
    const src = files[previewIdx]
    const c   = previewRef.current
    if (!src || !c) return

    // Guard against an older in-flight preview landing after a newer one.
    const seq = ++seqRef.current
    setPreviewBusy(true)
    try {
      const file = await src.get()
      const url  = URL.createObjectURL(file)
      setBeforeUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url })

      const outType = mimeForName(src.name)

      // Same pipeline as the batch — including barcode detection, tag cropping
      // and the re-read check — so the preview can't flatter the real run.
      // An AI box, when the user has asked for one, overrides all of that.
      const out = forcedBox
        ? await (async () => {
            const buffer = await file.arrayBuffer()
            return c.run(
              { id: "preview", name: src.name, buffer, type: file.type || outType,
                settings: { ...settings, outType }, forcedBox },
              [buffer],
            )
          })()
        : await processPhoto(c, file, src.name)

      if (seq !== seqRef.current) return   // superseded
      if (out.ok) {
        const blob = new Blob([out.buffer], { type: outType })
        const aUrl = URL.createObjectURL(blob)
        setAfterUrl(prev => { if (prev) URL.revokeObjectURL(prev); return aUrl })
        setPreviewInfo(out)
      }
    } catch { /* preview is best-effort */ }
    finally { if (seq === seqRef.current) setPreviewBusy(false) }
  }, [files, previewIdx, settings])

  useEffect(() => {
    if (files.length === 0) return
    setAiBox(null)
    const t = setTimeout(() => runPreview(), PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [files, previewIdx, settings, runPreview])

  async function checkPreviewWithAi() {
    const src = files[previewIdx]
    if (!src) return
    setAiBusy(true); setError(null)
    try {
      const file = await src.get()
      const fd = new FormData()
      fd.append("image", file, src.name)
      const res  = await fetch("/api/photo-prep/crop-box", { method: "POST", body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.statusText)
      if (!json.box) { setError("The AI couldn't find a product in that photo."); return }
      setAiBox(json.box)
      await runPreview(json.box)
    } catch (e: any) {
      setError(e?.message ?? "AI crop failed.")
    } finally { setAiBusy(false) }
  }

  // ── Picking photos ───────────────────────────────────────────────────────
  async function pickFolder() {
    setError(null)
    try {
      const dir = await (window as any).showDirectoryPicker()
      const found: SourceFile[] = []
      for await (const entry of dir.values()) {
        if (entry.kind !== "file" || !ACCEPTED_EXT.test(entry.name)) continue
        found.push({ name: entry.name, size: 0, get: () => entry.getFile() })
      }
      found.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      resetRun()
      inDirRef.current = dir   // kept so the run can refuse to overwrite the originals
      setFiles(found)
      if (found.length === 0) setError("No JPG, PNG or WebP files in that folder.")
    } catch (e: any) {
      if (e?.name !== "AbortError") setError(e?.message ?? "Could not read that folder.")
    }
  }

  function pickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []).filter(f => ACCEPTED_EXT.test(f.name))
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    resetRun()
    setFiles(list.map(f => ({ name: f.name, size: f.size, get: async () => f })))
    if (list.length === 0) setError("No JPG, PNG or WebP files selected.")
  }

  function resetRun() {
    setResults([]); setDone(0); setFinished(false); setElapsed(0)
    setError(null); setPreviewIdx(0); setAiFixed(0)
    // Both cleared: a stale input handle from an earlier pick would make the
    // same-folder guard compare against the wrong folder.
    outDirRef.current = null
    inDirRef.current  = null
  }

  // ── One photo, start to finish ───────────────────────────────────────────
  //
  // Barcode photos and lot photos want opposite things, and a real batch is
  // half of each with nothing in the filename to tell them apart. So the
  // barcode decides: it reads, or it doesn't.
  //
  // A tag crop is anchored to the barcode rather than to contrast, because a
  // white tag on a white wall has no contrast — one real batch cropped to a
  // stray orange fragment and binned the tag entirely. Then the result is
  // re-read to PROVE the barcode survived, rather than assuming it did.
  async function processPhoto(
    client: WorkerClient,
    file: File,
    name: string,
  ): Promise<any> {
    const outType = mimeForName(name)
    const base = { id: name, name, type: file.type || outType }

    let hit: BarcodeHit | null = null
    if (settings.barcodeAware) {
      try {
        const bmp = await createImageBitmap(file, { imageOrientation: "from-image" })
        hit = await findBarcode(bmp)
        bmp.close()
      } catch { /* not decodable — treat as a lot photo */ }
    }

    // ── Lot photo: the path that already works, untouched ──────────────────
    if (!hit) {
      const buffer = await file.arrayBuffer()
      const res = await client.run({ ...base, buffer, settings: { ...settings, outType } }, [buffer])
      return { ...res, kind: "lot" }
    }

    // ── Tag photo ─────────────────────────────────────────────────────────
    const rotateDeg = settings.rotateMode === "tags" ? rotationFor(hit, settings.minRotateDeg) : 0

    // Widen on each retry. If even the most generous crop won't scan, the photo
    // is kept whole — an uncropped tag is a nuisance, an unreadable one is a reshoot.
    const attempts = [settings.tagMarginPct, settings.tagMarginPct + 15, settings.tagMarginPct + 40]
    let last: any = null

    for (let i = 0; i < attempts.length; i++) {
      const box = cardFromBars(hit.bars, attempts[i])
      if (!cropIsSane(box)) continue

      const buffer = await file.arrayBuffer()
      const res = await client.run(
        { ...base, buffer, forcedBox: box, settings: { ...settings, outType, rotateDeg } },
        [buffer],
      )
      if (!res.ok) return { ...res, kind: "tag", barcode: hit.text }
      last = res

      // The proof: can the finished image still be read?
      try {
        const outBmp = await createImageBitmap(new Blob([res.buffer], { type: outType }))
        const again = await findBarcode(outBmp)
        outBmp.close()
        if (again) {
          return { ...res, kind: "tag", barcode: hit.text, verified: true, widened: i, rotateDeg }
        }
      } catch { /* fall through and widen */ }
    }

    // Nothing scanned back. Keep the whole frame, rotated only.
    const buffer = await file.arrayBuffer()
    const whole = await client.run(
      { ...base, buffer, forcedBox: { x0: 0, y0: 0, x1: 1, y1: 1 }, settings: { ...settings, outType, rotateDeg } },
      [buffer],
    )
    return { ...(whole.ok ? whole : last), kind: "tag", barcode: hit.text, verified: false, keptWhole: true, rotateDeg }
  }

  // ── Write one processed blob out ─────────────────────────────────────────
  async function writeOut(name: string, blob: Blob, zip: any) {
    if (outDirRef.current) {
      const fh = await outDirRef.current.getFileHandle(name, { create: true })
      const ws = await fh.createWritable()
      await ws.write(blob)
      await ws.close()
    } else {
      zip.file(name, blob)
    }
  }

  // ── The batch run ────────────────────────────────────────────────────────
  async function run() {
    if (files.length === 0 || running) return
    setError(null); setRunning(true); setFinished(false)
    setDone(0); setResults([]); setAiFixed(0)
    cancelRef.current = false

    const started = Date.now()
    const tick = setInterval(() => setElapsed(Date.now() - started), 500)

    // Preflight the worker. If it can't be fetched as JavaScript — auth
    // redirect, bad deploy, cached 404 — every photo would fail with no visible
    // cause and nothing would be written. Fail loudly here instead.
    try {
      const probe = await fetch("/photo-prep-worker.js", { cache: "no-store" })
      const ctype = probe.headers.get("content-type") ?? ""
      if (!probe.ok || probe.redirected || !/javascript|ecmascript/i.test(ctype)) {
        clearInterval(tick); setRunning(false)
        setError(
          `The image processor couldn't be loaded (got ${probe.status}${probe.redirected ? ", redirected to sign-in" : ""}). ` +
          `Try a hard refresh — if it persists your session may have expired, so sign in again.`,
        )
        return
      }
    } catch (e: any) {
      clearInterval(tick); setRunning(false)
      setError(`The image processor couldn't be loaded: ${e?.message ?? "network error"}.`)
      return
    }

    let zip: any = null
    try {
      if (fsa) {
        const dir = await (window as any).showDirectoryPicker({ mode: "readwrite" })
        // ⚠ Writing into the source folder truncates the originals — the photos
        // would be gone with no undo. Refuse rather than warn.
        if (await isSameFolder(dir, inDirRef.current)) {
          clearInterval(tick); setRunning(false)
          setError("That's the folder your photos came from — saving there would overwrite the originals. Pick or create a different folder.")
          return
        }
        outDirRef.current = dir
      } else {
        zip = new ((await import("jszip")).default)()
      }
    } catch (e: any) {
      clearInterval(tick); setRunning(false)
      // Say something even on cancel — a silent no-op reads as "the button is
      // broken" rather than "you closed the folder picker".
      setError(e?.name === "AbortError"
        ? "Cancelled — no output folder was chosen, so nothing was saved."
        : (e?.message ?? "Could not open the output folder."))
      return
    }

    // In AI mode the Gemini call is the bottleneck — the local worker step is
    // milliseconds by comparison — so the pool is sized to the API concurrency
    // rather than to CPU cores.
    const aiAll = settings.cropMode === "ai"
    const poolSize = aiAll ? AI_CONCURRENCY : workerCount()
    const clients = Array.from({ length: poolSize }, () => makeWorkerClient("/photo-prep-worker.js"))
    const out: Result[] = []
    let next = 0
    let aiUsed = 0

    const pump = (client: WorkerClient) => new Promise<void>((resolve) => {
      const takeNext = async (): Promise<void> => {
        if (cancelRef.current || next >= files.length) { resolve(); return }
        const src = files[next++]
        try {
          const file    = await src.get()
          const outType = mimeForName(src.name)

          let res: any
          if (aiAll) {
            // AI mode: get the box first. A null (rate-limited, or no product
            // found) falls through to local detection — degraded, not lost.
            const box = await fetchAiBox(file, src.name)
            if (box) { aiUsed++; setAiFixed(aiUsed) }
            // Read AFTER the AI call so a pool of in-flight photos isn't holding
            // full-size buffers across the network wait.
            const buffer = await file.arrayBuffer()
            res = await client.run(
              { id: src.name, name: src.name, buffer, type: file.type || outType,
                settings: { ...settings, outType }, forcedBox: box ?? undefined },
              [buffer],
            )
          } else {
            // Barcode-aware pipeline: classifies, crops and verifies.
            res = await processPhoto(client, file, src.name)
          }

          if (res.ok) {
            await writeOut(src.name, new Blob([res.buffer], { type: outType }), zip)
            out.push({
              name: src.name, status: "done", confidence: res.confidence,
              brightened: !!res.brightened, backdropLuma: res.backdropLuma,
              kind: res.kind, barcode: res.barcode, verified: res.verified,
              keptWhole: res.keptWhole, cropRejected: res.cropRejected,
              rotateDeg: res.rotateDeg,
            })
          } else {
            out.push({ name: src.name, status: "error", error: res.error })
          }
        } catch (e: any) {
          out.push({ name: src.name, status: "error", error: e?.message ?? "Failed" })
        }
        setDone(d => d + 1)
        return takeNext()
      }
      takeNext()
    })

    await Promise.all(clients.map(pump))
    clients.forEach(c => c.terminate())
    clearInterval(tick)
    setElapsed(Date.now() - started)

    if (zip && !cancelRef.current) {
      try {
        const blob = await zip.generateAsync({ type: "blob", compression: "STORE" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url; a.download = `photos-prepped-${new Date().toISOString().slice(0, 10)}.zip`
        a.click(); URL.revokeObjectURL(url)
      } catch (e: any) {
        setError(`Processed fine, but the zip failed: ${e?.message ?? "unknown"}. Try a smaller batch, or use Chrome/Edge to save straight to a folder.`)
      }
    }

    out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    setResults(out); setRunning(false); setFinished(!cancelRef.current)
  }

  // ── Second pass: send the unsure ones to Gemini ──────────────────────────
  const lowConf = useMemo(
    () => results.filter(r => r.status === "done" && (r.confidence ?? 0) < AI_FALLBACK_CONFIDENCE),
    [results],
  )

  async function fixWithAi() {
    if (lowConf.length === 0 || !outDirRef.current) return
    setAiFixing(true); setError(null); setAiFixed(0)

    const byName = new Map(files.map(f => [f.name, f]))
    const client = makeWorkerClient("/photo-prep-worker.js")
    let fixed = 0

    for (const r of lowConf) {
      if (cancelRef.current) break
      const src = byName.get(r.name)
      if (!src) continue
      try {
        const file = await src.get()
        const fd = new FormData()
        fd.append("image", file, src.name)
        const res = await fetch("/api/photo-prep/crop-box", { method: "POST", body: fd })
        const json = await res.json()
        if (!res.ok || !json.box) continue

        const outType = mimeForName(src.name)
        const buffer  = await file.arrayBuffer()
        const out = await client.run(
          { id: src.name, name: src.name, buffer, type: file.type || outType,
            settings: { ...settings, outType }, forcedBox: json.box },
          [buffer],
        )
        if (out.ok) {
          await writeOut(src.name, new Blob([out.buffer], { type: outType }), null)
          fixed++
          setAiFixed(fixed)
        }
      } catch { /* leave this one as the local crop produced it */ }
    }

    client.terminate()
    setAiFixing(false)
    setResults(prev => prev.map(r =>
      lowConf.some(l => l.name === r.name) ? { ...r, confidence: 1 } : r,
    ))
  }

  const errors = useMemo(() => results.filter(r => r.status === "error"), [results])
  const brightenedCount = useMemo(() => results.filter(r => r.brightened).length, [results])
  const pct  = files.length > 0 ? Math.round((done / files.length) * 100) : 0
  const rate = elapsed > 0 ? done / (elapsed / 1000) : 0

  const set = <K extends keyof PhotoPrepSettings>(k: K, v: PhotoPrepSettings[K]) =>
    setSettings(s => ({ ...s, [k]: v }))

  const conf = previewInfo?.confidence ?? 0
  const confLabel = aiBox ? "AI crop" : conf >= 0.75 ? "Confident" : conf >= 0.5 ? "Probably fine" : "Not sure"
  const confColour = aiBox ? "text-violet-600 dark:text-violet-400"
    : conf >= 0.75 ? "text-green-600 dark:text-green-400"
    : conf >= 0.5 ? "text-amber-600 dark:text-amber-400"
    : "text-red-600 dark:text-red-400"

  return (
    <div className="p-6 max-w-[1400px]">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Photo Prep</h1>
      <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
        Crops each photo to the product and lifts the under-exposed ones. Filenames are kept exactly as they are.
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-500 mb-5 mt-1">
        Photos are processed on this computer and never uploaded.
        {fsa ? " Results are written straight into a folder you choose."
             : " Your browser can't save straight to a folder, so results come back as a zip — use Chrome or Edge for the folder option."}
      </p>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Step 1 — choose */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0d0f1a] p-5 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          {fsa && (
            <button onClick={pickFolder} disabled={running}
              className="px-4 py-2 bg-[#0078D4] hover:bg-blue-500 text-white text-sm font-medium rounded transition-colors disabled:opacity-50">
              📁 Choose folder
            </button>
          )}
          <label className={`px-4 py-2 text-sm font-medium rounded border transition-colors cursor-pointer
            ${running ? "opacity-50 pointer-events-none" : ""}
            ${fsa ? "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-900"
                  : "bg-[#0078D4] hover:bg-blue-500 text-white border-transparent"}`}>
            🖼 Choose photos
            <input type="file" multiple accept="image/jpeg,image/png,image/webp"
                   onChange={pickFiles} disabled={running} className="hidden" />
          </label>
          {files.length > 0 && (
            <span className="text-sm text-gray-600 dark:text-gray-400">
              <strong className="text-gray-900 dark:text-white">{files.length.toLocaleString()}</strong> photo{files.length === 1 ? "" : "s"} ready
            </span>
          )}
        </div>
      </div>

      {files.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4 mb-4">
          {/* Step 2 — settings */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0d0f1a] p-5 space-y-5">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Settings</h2>

            <div>
              <label className="text-sm text-gray-700 dark:text-gray-300 block mb-2">How to find the product</label>
              <div className="space-y-1.5">
                {([
                  { key: "auto",   label: "Automatic",        hint: "Fast and free. Best on a plain sweep." },
                  { key: "assist", label: "Automatic + AI",   hint: "Automatic, then AI re-crops only the unsure ones." },
                  { key: "ai",     label: "AI on every photo", hint: "Handles anything. Much slower, uses API quota." },
                ] as { key: CropMode; label: string; hint: string }[]).map(m => (
                  <label key={m.key}
                    className={`flex gap-2.5 items-start px-2.5 py-2 rounded border cursor-pointer transition-colors
                      ${settings.cropMode === m.key
                        ? "border-[#0078D4] bg-blue-50 dark:bg-blue-950/30"
                        : "border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900"}`}>
                    <input type="radio" name="cropMode" checked={settings.cropMode === m.key}
                      onChange={() => set("cropMode", m.key)} disabled={running}
                      className="mt-0.5 accent-[#0078D4]" />
                    <span>
                      <span className="block text-sm text-gray-800 dark:text-gray-200">{m.label}</span>
                      <span className="block text-[11px] text-gray-500 dark:text-gray-500">{m.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              {settings.cropMode === "ai" && files.length > 100 && (
                <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-2">
                  {files.length.toLocaleString()} photos through the AI will take a while — {AI_CONCURRENCY} run at a time
                  and each is an API call. The automatic pass already handles plain-sweep shots, so
                  &ldquo;Automatic + AI&rdquo; is usually the better trade.
                </p>
              )}
            </div>

            <div className="border-t border-gray-200 dark:border-gray-800 pt-4">
              <div className="flex items-baseline justify-between mb-1">
                <label className="text-sm text-gray-700 dark:text-gray-300">Margin around product</label>
                <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">{settings.marginPct}%</span>
              </div>
              <input type="range" min={0} max={30} step={1} value={settings.marginPct}
                onChange={e => set("marginPct", Number(e.target.value))} disabled={running}
                className="w-full accent-[#0078D4]" />
              <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-1">
                How much space is left around the item. 0% cuts right to its edge; 5% leaves a small
                border. It&apos;s a share of the item&apos;s own size, so small and large items look consistent.
              </p>
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-1">
                <label className="text-sm text-gray-700 dark:text-gray-300">How hard to look for edges</label>
                <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">{settings.sensitivity}</span>
              </div>
              <input type="range" min={10} max={95} step={1} value={settings.sensitivity}
                onChange={e => set("sensitivity", Number(e.target.value))} disabled={running}
                className="w-full accent-[#0078D4]" />
              <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-1">
                How different from the backdrop something must be to count as part of the item.
                <strong> Raise it</strong> if a white or pale item is getting its edges cut off.
                <strong> Lower it</strong> if shadows or marks on the sweep are making the crop too loose.
              </p>
            </div>

            <div className="border-t border-gray-200 dark:border-gray-800 pt-4">
              <label className="flex items-center gap-2 cursor-pointer select-none mb-3">
                <input type="checkbox" checked={settings.brighten}
                  onChange={e => set("brighten", e.target.checked)} disabled={running}
                  className="w-4 h-4 accent-[#0078D4]" />
                <span className="text-sm text-gray-700 dark:text-gray-300">Brighten under-exposed shots</span>
              </label>

              {settings.brighten && (
                <div className="space-y-4 pl-6">
                  <p className="text-[11px] text-gray-500 dark:text-gray-500 -mt-1">
                    Judged on how white your backdrop came out, not on the product — so a navy box stays navy.
                    Shots that aren&apos;t on a plain light sweep (a bench, a concrete floor) are skipped, since
                    there&apos;s no white to correct against.
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-500">
                    Both numbers are brightness on a 0–255 scale: 0 is black, 255 is pure white.
                    A well-lit sweep reads about 240. The Preview shows what each photo measured.
                  </p>
                  <div>
                    <div className="flex items-baseline justify-between mb-1">
                      <label className="text-xs text-gray-600 dark:text-gray-400">Fix shots whose sweep is below</label>
                      <span className="text-xs font-semibold tabular-nums text-gray-900 dark:text-white">{settings.backdropThreshold}</span>
                    </div>
                    <input type="range" min={150} max={250} step={1} value={settings.backdropThreshold}
                      onChange={e => set("backdropThreshold", Number(e.target.value))} disabled={running}
                      className="w-full accent-[#0078D4]" />
                    <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-1">
                      Raise it to fix more photos, lower it to only rescue the really dark ones.
                    </p>
                  </div>
                  <div>
                    <div className="flex items-baseline justify-between mb-1">
                      <label className="text-xs text-gray-600 dark:text-gray-400">Brighten the sweep up to</label>
                      <span className="text-xs font-semibold tabular-nums text-gray-900 dark:text-white">{settings.targetBackdrop}</span>
                    </div>
                    <input type="range" min={200} max={255} step={1} value={settings.targetBackdrop}
                      onChange={e => set("targetBackdrop", Number(e.target.value))} disabled={running}
                      className="w-full accent-[#0078D4]" />
                    <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-1">
                      How white to make it. 245 is clean white; push toward 255 and highlights start to blow out.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-gray-200 dark:border-gray-800 pt-4">
              <div className="flex items-baseline justify-between mb-1">
                <label className="text-sm text-gray-700 dark:text-gray-300">JPEG quality</label>
                <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">{Math.round(settings.quality * 100)}</span>
              </div>
              <input type="range" min={0.6} max={1} step={0.01} value={settings.quality}
                onChange={e => set("quality", Number(e.target.value))} disabled={running}
                className="w-full accent-[#0078D4]" />
            </div>

            <button onClick={() => setSettings(DEFAULT_SETTINGS)} disabled={running}
              className="text-xs text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 underline disabled:opacity-50">
              Reset to defaults
            </button>
          </div>

          {/* Preview */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0d0f1a] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                Preview {previewBusy && <span className="text-xs font-normal text-gray-500">· updating…</span>}
              </h2>
              <div className="flex items-center gap-2">
                <button onClick={() => setPreviewIdx(i => Math.max(0, i - 1))} disabled={previewIdx === 0}
                  className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 disabled:opacity-30">‹</button>
                <span className="text-xs text-gray-500 dark:text-gray-500 tabular-nums">{previewIdx + 1} / {files.length}</span>
                <button onClick={() => setPreviewIdx(i => Math.min(files.length - 1, i + 1))} disabled={previewIdx >= files.length - 1}
                  className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 disabled:opacity-30">›</button>
              </div>
            </div>

            <p className="text-[11px] font-mono text-gray-500 dark:text-gray-500 mb-3 truncate">{files[previewIdx]?.name}</p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-500 mb-1.5">Before</p>
                <div className="aspect-square rounded border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-black/40 overflow-hidden flex items-center justify-center">
                  {beforeUrl ? <img src={beforeUrl} alt="Before" className="max-w-full max-h-full object-contain" />
                             : <span className="text-xs text-gray-400">…</span>}
                </div>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-500 mb-1.5">
                  After {previewInfo?.brightened && <span className="text-amber-600 dark:text-amber-400 normal-case">· brightened</span>}
                </p>
                <div className="aspect-square rounded border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-black/40 overflow-hidden flex items-center justify-center">
                  {afterUrl ? <img src={afterUrl} alt="After" className="max-w-full max-h-full object-contain" />
                            : <span className="text-xs text-gray-400">…</span>}
                </div>
              </div>
            </div>

            {/* The numbers behind the decision — so it's obvious why it did or didn't brighten */}
            {previewInfo && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                <div className="rounded bg-gray-50 dark:bg-black/30 px-2 py-1.5">
                  <p className="text-gray-500 dark:text-gray-500">Crop</p>
                  <p className="font-semibold text-gray-900 dark:text-white tabular-nums">{previewInfo.width}×{previewInfo.height}</p>
                </div>
                <div className="rounded bg-gray-50 dark:bg-black/30 px-2 py-1.5">
                  <p className="text-gray-500 dark:text-gray-500">Confidence</p>
                  <p className={`font-semibold ${confColour}`}>{confLabel}</p>
                </div>
                <div className="rounded bg-gray-50 dark:bg-black/30 px-2 py-1.5">
                  <p className="text-gray-500 dark:text-gray-500">Backdrop</p>
                  <p className="font-semibold text-gray-900 dark:text-white tabular-nums">
                    {previewInfo.backdropLuma != null ? Math.round(previewInfo.backdropLuma) : "—"}
                    <span className="font-normal text-gray-500">
                      {previewInfo.sweepLike === false ? " · not a sweep" : ` / ${settings.backdropThreshold}`}
                    </span>
                  </p>
                </div>
                <div className="rounded bg-gray-50 dark:bg-black/30 px-2 py-1.5">
                  <p className="text-gray-500 dark:text-gray-500">Brightened</p>
                  <p className={`font-semibold ${previewInfo.brightened ? "text-amber-600 dark:text-amber-400" : "text-gray-500"}`}>
                    {previewInfo.brightened ? "Yes"
                      : previewInfo.sweepLike === false ? "Skipped" : "Not needed"}
                  </p>
                </div>
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button onClick={checkPreviewWithAi} disabled={aiBusy || running}
                className="px-3 py-1.5 text-xs font-medium rounded border border-violet-300 dark:border-violet-800 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/40 disabled:opacity-50">
                {aiBusy ? "Asking AI…" : "✨ Crop this one with AI"}
              </button>
              {aiBox && (
                <button onClick={() => { setAiBox(null); runPreview() }}
                  className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 underline">
                  back to automatic
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step 3 — run */}
      {files.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0d0f1a] p-5">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            {!running ? (
              <button onClick={run}
                className="px-5 py-2.5 bg-green-600 hover:bg-green-500 text-white text-sm font-semibold rounded transition-colors">
                {fsa ? `Process ${files.length.toLocaleString()} photos & save to folder`
                     : `Process ${files.length.toLocaleString()} photos & download zip`}
              </button>
            ) : (
              <button onClick={() => { cancelRef.current = true }}
                className="px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white text-sm font-semibold rounded transition-colors">
                Stop
              </button>
            )}
            {(running || finished) && (
              <span className="text-sm text-gray-600 dark:text-gray-400 tabular-nums">
                {done.toLocaleString()} / {files.length.toLocaleString()}
                {rate > 0 && ` · ${rate.toFixed(1)}/sec`}
                {elapsed > 0 && ` · ${fmtDuration(elapsed)}`}
                {settings.cropMode === "ai" && aiFixed > 0 && ` · ${aiFixed.toLocaleString()} AI crops`}
                {running && rate > 0 && done > 5 && files.length - done > 0 &&
                  ` · ~${fmtDuration(((files.length - done) / rate) * 1000)} left`}
              </span>
            )}
          </div>

          {(running || finished) && (
            <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden mb-4">
              <div className={`h-full rounded-full transition-all duration-300 ${finished && errors.length === 0 ? "bg-green-500" : "bg-[#0078D4]"}`}
                   style={{ width: `${pct}%` }} />
            </div>
          )}

          {finished && (
            <div className="text-sm space-y-2">
              <p className="text-green-700 dark:text-green-400 font-medium">
                ✓ Done — {results.filter(r => r.status === "done").length.toLocaleString()} photo
                {results.filter(r => r.status === "done").length === 1 ? "" : "s"} cropped
                {fsa ? " and saved to your folder." : " and downloaded."}
              </p>
              {settings.brighten && (
                <p className="text-gray-600 dark:text-gray-400">
                  {brightenedCount.toLocaleString()} had a dim backdrop and were lifted; the rest were already well exposed.
                </p>
              )}

              {settings.cropMode === "ai" && (
                <p className="text-gray-600 dark:text-gray-400">
                  {aiFixed.toLocaleString()} cropped using the AI&apos;s box
                  {aiFixed < results.filter(r => r.status === "done").length &&
                    ` · ${(results.filter(r => r.status === "done").length - aiFixed).toLocaleString()} fell back to automatic (no product found, or the API was busy)`}.
                </p>
              )}

              {/* Without this, "Automatic + AI" that finds nothing to fix looks
                  like the AI silently did nothing. */}
              {settings.cropMode === "assist" && lowConf.length === 0 && (
                <p className="text-gray-600 dark:text-gray-400">
                  Every photo was cropped confidently, so none needed the AI.
                </p>
              )}

              {/* Only offered when the AI hasn't already seen every photo. */}
              {settings.cropMode !== "ai" && lowConf.length > 0 && outDirRef.current && (
                <div className="mt-3 p-3 rounded-lg bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-900">
                  <p className="text-violet-800 dark:text-violet-300 mb-2">
                    <strong>{lowConf.length}</strong> photo{lowConf.length === 1 ? " wasn't" : "s weren't"} cropped confidently —
                    busy background, or the item runs off the edge.
                  </p>
                  <button onClick={fixWithAi} disabled={aiFixing}
                    className="px-4 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold rounded disabled:opacity-50">
                    {aiFixing ? `Re-cropping with AI… ${aiFixed}/${lowConf.length}` : `✨ Re-crop those ${lowConf.length} with AI`}
                  </button>
                  <p className="text-[11px] text-violet-700/70 dark:text-violet-400/70 mt-1.5">
                    Sends only these to Gemini and overwrites them in your output folder.
                  </p>
                </div>
              )}

              {errors.length > 0 && (
                <details className="mt-2">
                  <summary className="text-red-600 dark:text-red-400 cursor-pointer">{errors.length} failed — click to see which</summary>
                  <ul className="mt-2 space-y-0.5 max-h-48 overflow-y-auto">
                    {errors.map(e => (
                      <li key={e.name} className="text-xs font-mono text-gray-600 dark:text-gray-400">{e.name} — {e.error}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      {files.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-12 text-center">
          <p className="text-4xl mb-3">📷</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {fsa ? "Choose a folder of photos to get started." : "Choose some photos to get started."}
          </p>
        </div>
      )}
    </div>
  )
}
