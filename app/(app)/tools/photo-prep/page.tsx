"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  DEFAULT_SETTINGS, ACCEPTED_EXT, mimeForName, fmtBytes, fmtDuration,
  hasFileSystemAccess, workerCount, type PhotoPrepSettings,
} from "@/lib/photo-prep"

// Photo Prep — bulk crop + brighten for the photography department.
//
// Everything happens in the browser: photos are read straight off disk,
// processed in a pool of Web Workers, and written back into a folder the
// user picks. Nothing is uploaded. That is what makes ~1000 photos practical
// — no upload wait, no request size limit, and memory stays flat because only
// a handful of images are ever in flight.

type SourceFile = { name: string; size: number; get: () => Promise<File> }
type Status     = "pending" | "done" | "skipped" | "error"
type Result     = { name: string; status: Status; brightened?: boolean; error?: string }

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
  const [previewInfo, setPreviewInfo] = useState<{ w: number; h: number; brightened: boolean } | null>(null)

  // Run
  const [running, setRunning]   = useState(false)
  const [done, setDone]         = useState(0)
  const [results, setResults]   = useState<Result[]>([])
  const [error, setError]       = useState<string | null>(null)
  const [elapsed, setElapsed]   = useState(0)
  const [finished, setFinished] = useState(false)

  const cancelRef  = useRef(false)
  const previewRef = useRef<Worker | null>(null)

  useEffect(() => { setFsa(hasFileSystemAccess()) }, [])

  // ── Preview worker ───────────────────────────────────────────────────────
  useEffect(() => {
    const w = new Worker("/photo-prep-worker.js")
    previewRef.current = w
    return () => { w.terminate(); previewRef.current = null }
  }, [])

  const runPreview = useCallback(async () => {
    const src = files[previewIdx]
    const w   = previewRef.current
    if (!src || !w) return

    setPreviewBusy(true)
    try {
      const file = await src.get()
      setBeforeUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file) })

      const buffer = await file.arrayBuffer()
      const outType = mimeForName(src.name)

      const out = await new Promise<any>((resolve) => {
        const onMsg = (e: MessageEvent) => { w.removeEventListener("message", onMsg); resolve(e.data) }
        w.addEventListener("message", onMsg)
        w.postMessage({ id: "preview", name: src.name, buffer, type: file.type || outType,
                        settings: { ...settings, outType } }, [buffer])
      })

      if (out.ok) {
        const blob = new Blob([out.buffer], { type: outType })
        setAfterUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob) })
        setPreviewInfo({ w: out.width, h: out.height, brightened: !!out.brightened })
      }
    } catch { /* preview is best-effort */ }
    finally { setPreviewBusy(false) }
  }, [files, previewIdx, settings])

  // Re-render the preview when the settings or the chosen photo change.
  useEffect(() => {
    if (files.length === 0) return
    const t = setTimeout(runPreview, PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [files, previewIdx, settings, runPreview])

  // ── Picking photos ───────────────────────────────────────────────────────
  async function pickFolder() {
    setError(null)
    try {
      const dir = await (window as any).showDirectoryPicker()
      const found: SourceFile[] = []
      for await (const entry of dir.values()) {
        if (entry.kind !== "file" || !ACCEPTED_EXT.test(entry.name)) continue
        found.push({
          name: entry.name,
          size: 0,
          get:  () => entry.getFile(),
        })
      }
      found.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      resetRun()
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
    setResults([]); setDone(0); setFinished(false); setElapsed(0); setError(null); setPreviewIdx(0)
  }

  // ── The batch run ────────────────────────────────────────────────────────
  async function run() {
    if (files.length === 0 || running) return
    setError(null); setRunning(true); setFinished(false)
    setDone(0); setResults([])
    cancelRef.current = false

    const started = Date.now()
    const tick = setInterval(() => setElapsed(Date.now() - started), 500)

    // Writing straight into a folder keeps memory flat; the zip path has to
    // hold every processed image until the end, so it is the fallback only.
    let outDir: any = null
    let zip: any = null

    try {
      if (fsa) {
        outDir = await (window as any).showDirectoryPicker({ mode: "readwrite" })
      } else {
        const JSZip = (await import("jszip")).default
        zip = new JSZip()
      }
    } catch (e: any) {
      clearInterval(tick); setRunning(false)
      if (e?.name !== "AbortError") setError(e?.message ?? "Could not open the output folder.")
      return
    }

    const n       = workerCount()
    const workers = Array.from({ length: n }, () => new Worker("/photo-prep-worker.js"))
    const out: Result[] = []
    let next = 0

    const pump = (worker: Worker) => new Promise<void>((resolve) => {
      const takeNext = async () => {
        if (cancelRef.current || next >= files.length) { resolve(); return }
        const src = files[next++]

        try {
          const file    = await src.get()
          const buffer  = await file.arrayBuffer()
          const outType = mimeForName(src.name)

          const res = await new Promise<any>((rs) => {
            const onMsg = (e: MessageEvent) => { worker.removeEventListener("message", onMsg); rs(e.data) }
            worker.addEventListener("message", onMsg)
            worker.postMessage({ id: src.name, name: src.name, buffer, type: file.type || outType,
                                 settings: { ...settings, outType } }, [buffer])
          })

          if (res.ok) {
            const blob = new Blob([res.buffer], { type: outType })
            if (outDir) {
              // Original filename, unchanged — the photo-upload flow reads the
              // lot barcode out of it, so it must survive exactly.
              const fh = await outDir.getFileHandle(src.name, { create: true })
              const ws = await fh.createWritable()
              await ws.write(blob)
              await ws.close()
            } else {
              zip.file(src.name, blob)
            }
            out.push({ name: src.name, status: "done", brightened: !!res.brightened })
          } else {
            out.push({ name: src.name, status: "error", error: res.error })
          }
        } catch (e: any) {
          out.push({ name: src.name, status: "error", error: e?.message ?? "Failed" })
        }

        setDone(d => d + 1)
        takeNext()
      }
      takeNext()
    })

    await Promise.all(workers.map(pump))
    workers.forEach(w => w.terminate())
    clearInterval(tick)
    setElapsed(Date.now() - started)

    // Zip fallback: build and download once everything is processed.
    if (zip && !cancelRef.current) {
      try {
        // JPEGs are already compressed — STORE avoids a pointless second pass.
        const blob = await zip.generateAsync({ type: "blob", compression: "STORE" })
        const url  = URL.createObjectURL(blob)
        const a    = document.createElement("a")
        a.href = url
        a.download = `photos-prepped-${new Date().toISOString().slice(0, 10)}.zip`
        a.click()
        URL.revokeObjectURL(url)
      } catch (e: any) {
        setError(`Processed fine, but the zip failed: ${e?.message ?? "unknown error"}. Try a smaller batch, or use Chrome/Edge to save straight to a folder.`)
      }
    }

    out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    setResults(out)
    setRunning(false)
    setFinished(!cancelRef.current)
  }

  const errors     = useMemo(() => results.filter(r => r.status === "error"), [results])
  const brightened = useMemo(() => results.filter(r => r.brightened).length, [results])
  const pct        = files.length > 0 ? Math.round((done / files.length) * 100) : 0
  const rate       = elapsed > 0 ? done / (elapsed / 1000) : 0

  const set = <K extends keyof PhotoPrepSettings>(k: K, v: PhotoPrepSettings[K]) =>
    setSettings(s => ({ ...s, [k]: v }))

  return (
    <div className="p-6 max-w-[1400px]">
      <div className="mb-1">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Photo Prep</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
          Trim the edges off a batch of product shots and lift the dark ones. Filenames are kept exactly as they are.
        </p>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-500 mb-5">
        Photos are processed on this computer and never uploaded.
        {fsa
          ? " Results are written straight into a folder you choose."
          : " Your browser can't save straight to a folder, so results come back as a zip — use Chrome or Edge for the folder option."}
      </p>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* ── Step 1: choose photos ──────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0d0f1a] p-5 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          {fsa && (
            <button
              onClick={pickFolder} disabled={running}
              className="px-4 py-2 bg-[#0078D4] hover:bg-blue-500 text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
            >
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
          {/* ── Step 2: settings ─────────────────────────────────────────── */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0d0f1a] p-5 space-y-5">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Settings</h2>

            <div>
              <div className="flex items-baseline justify-between mb-1">
                <label className="text-sm text-gray-700 dark:text-gray-300">Trim from each edge</label>
                <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">{settings.trimPct}%</span>
              </div>
              <input
                type="range" min={0} max={25} step={0.5} value={settings.trimPct}
                onChange={e => set("trimPct", Number(e.target.value))}
                disabled={running}
                className="w-full accent-[#0078D4]"
              />
              <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-1">
                Same amount off the left, right, top and bottom of every photo.
              </p>
            </div>

            <div className="border-t border-gray-200 dark:border-gray-800 pt-4">
              <label className="flex items-center gap-2 cursor-pointer select-none mb-3">
                <input
                  type="checkbox" checked={settings.brighten}
                  onChange={e => set("brighten", e.target.checked)}
                  disabled={running}
                  className="w-4 h-4 accent-[#0078D4]"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Brighten the dark ones</span>
              </label>

              {settings.brighten && (
                <div className="space-y-4 pl-6">
                  <div>
                    <div className="flex items-baseline justify-between mb-1">
                      <label className="text-xs text-gray-600 dark:text-gray-400">Counts as dark below</label>
                      <span className="text-xs font-semibold tabular-nums text-gray-900 dark:text-white">{settings.darkThreshold}</span>
                    </div>
                    <input
                      type="range" min={40} max={190} step={1} value={settings.darkThreshold}
                      onChange={e => set("darkThreshold", Number(e.target.value))}
                      disabled={running} className="w-full accent-[#0078D4]"
                    />
                    <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-1">
                      Higher = more photos get lifted. Anything brighter than this is left untouched.
                    </p>
                  </div>
                  <div>
                    <div className="flex items-baseline justify-between mb-1">
                      <label className="text-xs text-gray-600 dark:text-gray-400">Brighten up to</label>
                      <span className="text-xs font-semibold tabular-nums text-gray-900 dark:text-white">{settings.targetLuma}</span>
                    </div>
                    <input
                      type="range" min={90} max={200} step={1} value={settings.targetLuma}
                      onChange={e => set("targetLuma", Number(e.target.value))}
                      disabled={running} className="w-full accent-[#0078D4]"
                    />
                    <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-1">
                      Shadows and midtones lift; white backdrops stay white.
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
              <input
                type="range" min={0.6} max={1} step={0.01} value={settings.quality}
                onChange={e => set("quality", Number(e.target.value))}
                disabled={running} className="w-full accent-[#0078D4]"
              />
            </div>

            <button
              onClick={() => setSettings(DEFAULT_SETTINGS)} disabled={running}
              className="text-xs text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 underline disabled:opacity-50"
            >
              Reset to defaults
            </button>
          </div>

          {/* ── Preview ──────────────────────────────────────────────────── */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0d0f1a] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                Preview {previewBusy && <span className="text-xs font-normal text-gray-500">· updating…</span>}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPreviewIdx(i => Math.max(0, i - 1))}
                  disabled={previewIdx === 0}
                  className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 disabled:opacity-30"
                >‹</button>
                <span className="text-xs text-gray-500 dark:text-gray-500 tabular-nums">
                  {previewIdx + 1} / {files.length}
                </span>
                <button
                  onClick={() => setPreviewIdx(i => Math.min(files.length - 1, i + 1))}
                  disabled={previewIdx >= files.length - 1}
                  className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 disabled:opacity-30"
                >›</button>
              </div>
            </div>

            <p className="text-[11px] font-mono text-gray-500 dark:text-gray-500 mb-3 truncate">{files[previewIdx]?.name}</p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-500 mb-1.5">Before</p>
                <div className="aspect-square rounded border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-black/40 overflow-hidden flex items-center justify-center">
                  {beforeUrl
                    ? <img src={beforeUrl} alt="Before" className="max-w-full max-h-full object-contain" />
                    : <span className="text-xs text-gray-400">…</span>}
                </div>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-500 mb-1.5">
                  After {previewInfo?.brightened && <span className="text-amber-600 dark:text-amber-400 normal-case">· brightened</span>}
                </p>
                <div className="aspect-square rounded border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-black/40 overflow-hidden flex items-center justify-center">
                  {afterUrl
                    ? <img src={afterUrl} alt="After" className="max-w-full max-h-full object-contain" />
                    : <span className="text-xs text-gray-400">…</span>}
                </div>
              </div>
            </div>

            {previewInfo && (
              <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-2 tabular-nums">
                Output {previewInfo.w} × {previewInfo.h} px
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Step 3: run ─────────────────────────────────────────────────── */}
      {files.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0d0f1a] p-5">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            {!running ? (
              <button
                onClick={run}
                className="px-5 py-2.5 bg-green-600 hover:bg-green-500 text-white text-sm font-semibold rounded transition-colors"
              >
                {fsa ? `Process ${files.length.toLocaleString()} photos & save to folder` : `Process ${files.length.toLocaleString()} photos & download zip`}
              </button>
            ) : (
              <button
                onClick={() => { cancelRef.current = true }}
                className="px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white text-sm font-semibold rounded transition-colors"
              >
                Stop
              </button>
            )}

            {(running || finished) && (
              <span className="text-sm text-gray-600 dark:text-gray-400 tabular-nums">
                {done.toLocaleString()} / {files.length.toLocaleString()}
                {rate > 0 && ` · ${rate.toFixed(1)}/sec`}
                {elapsed > 0 && ` · ${fmtDuration(elapsed)}`}
              </span>
            )}
          </div>

          {(running || finished) && (
            <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden mb-4">
              <div
                className={`h-full rounded-full transition-all duration-300 ${finished && errors.length === 0 ? "bg-green-500" : "bg-[#0078D4]"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}

          {finished && (
            <div className="text-sm space-y-1">
              <p className="text-green-700 dark:text-green-400 font-medium">
                ✓ Done — {results.filter(r => r.status === "done").length.toLocaleString()} photo
                {results.filter(r => r.status === "done").length === 1 ? "" : "s"} processed
                {fsa ? " and saved to your folder." : " and downloaded."}
              </p>
              {settings.brighten && (
                <p className="text-gray-600 dark:text-gray-400">
                  {brightened.toLocaleString()} were dark enough to brighten; the rest were left as shot.
                </p>
              )}
              {errors.length > 0 && (
                <details className="mt-2">
                  <summary className="text-red-600 dark:text-red-400 cursor-pointer">
                    {errors.length} failed — click to see which
                  </summary>
                  <ul className="mt-2 space-y-0.5 max-h-48 overflow-y-auto">
                    {errors.map(e => (
                      <li key={e.name} className="text-xs font-mono text-gray-600 dark:text-gray-400">
                        {e.name} — {e.error}
                      </li>
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
