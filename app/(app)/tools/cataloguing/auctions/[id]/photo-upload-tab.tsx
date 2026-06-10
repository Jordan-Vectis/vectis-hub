"use client"

import { useRef, useState } from "react"
import { uploadLotPhoto } from "@/lib/actions/catalogue"

interface Props {
  auctionId: string
  lots: { id: string; barcode: string | null; receiptUniqueId?: string | null }[]
  onUploaded: () => void
}

interface LotGroup {
  lotId:    string | null
  label:    string
  photos:   File[]
}

type Phase = "idle" | "scanning" | "preview" | "uploading" | "done"
type Mode  = "scan" | "filename"

// ── Filename barcode / unique-ID parser ───────────────────────────────────────
// Strips the extension then removes any trailing _N suffix so that:
//   "F066001.jpg"      → "F066001"
//   "F066001_2.jpg"    → "F066001"
//   "R000016-413_1.jpg"→ "R000016-413"
function parseBarcode(filename: string): string {
  const noExt = filename.replace(/\.[^.]+$/, "")  // strip extension
  return noExt.replace(/_\d+$/, "")               // strip trailing _N suffix
}

export default function PhotoUploadTab({ auctionId, lots, onUploaded }: Props) {
  const scanInputRef               = useRef<HTMLInputElement>(null)
  const filenameInputRef           = useRef<HTMLInputElement>(null)
  const [mode, setMode]            = useState<Mode | null>(null)
  const [phase, setPhase]          = useState<Phase>("idle")
  const [groups, setGroups]        = useState<LotGroup[]>([])
  const [scanProgress, setScanProgress]     = useState({ done: 0, total: 0 })
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 })
  const [error, setError]          = useState<string | null>(null)
  const [skipped, setSkipped]      = useState<string[]>([])

  // Lookup: barcode / receiptUniqueId → lot id
  const lotMap = new Map([
    ...lots.filter(l => l.barcode).map(l => [l.barcode!.toLowerCase().trim(), l.id] as [string, string]),
    ...lots.filter(l => l.receiptUniqueId).map(l => [l.receiptUniqueId!.toLowerCase().trim(), l.id] as [string, string]),
  ])

  // ── Reset to idle ─────────────────────────────────────────────────────────────
  function reset() {
    setMode(null)
    setPhase("idle")
    setGroups([])
    setSkipped([])
    setError(null)
  }

  // ── MODE: match by filename ───────────────────────────────────────────────────
  function handleFilenameFiles(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null)
    const files = Array.from(e.target.files ?? []).filter(
      f => f.type.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(f.name)
    )
    e.target.value = ""
    if (files.length === 0) return

    // Sort by filename so _1, _2 etc. end up in order
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

    // Group by extracted barcode / unique-ID
    const groupMap = new Map<string, LotGroup>()
    const orderedKeys: string[] = []

    for (const file of files) {
      const barcode = parseBarcode(file.name)
      const key     = barcode.toLowerCase().trim()
      if (!groupMap.has(key)) {
        const lotId = lotMap.get(key) ?? null
        groupMap.set(key, { lotId, label: barcode, photos: [] })
        orderedKeys.push(key)
      }
      groupMap.get(key)!.photos.push(file)
    }

    const result = orderedKeys.map(k => groupMap.get(k)!)

    if (result.length === 0) {
      setError("No files selected.")
      return
    }

    setGroups(result)
    setPhase("preview")
  }

  // ── MODE: scan barcodes from images ──────────────────────────────────────────
  async function handleScanFiles(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null)
    const files = Array.from(e.target.files ?? []).filter(
      f => f.type.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(f.name)
    )
    if (files.length === 0) return

    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

    setPhase("scanning")
    setScanProgress({ done: 0, total: files.length })

    const nativeDetector = "BarcodeDetector" in window
      ? new (window as any).BarcodeDetector({ formats: ["code_128", "code_39", "qr_code", "ean_13"] })
      : null

    const [{ HTMLCanvasElementLuminanceSource }, { MultiFormatReader, BinaryBitmap, HybridBinarizer, DecodeHintType }] =
      await Promise.all([import("@zxing/browser"), import("@zxing/library")])
    const hints = new Map()
    hints.set(DecodeHintType.TRY_HARDER, true)
    const zxing = new MultiFormatReader()
    zxing.setHints(hints)

    function loadImgElement(file: File): Promise<HTMLImageElement> {
      return new Promise((res, rej) => {
        const url = URL.createObjectURL(file)
        const el  = new Image()
        el.onload  = () => { URL.revokeObjectURL(url); res(el) }
        el.onerror = () => { URL.revokeObjectURL(url); rej(new Error("load failed")) }
        el.src = url
      })
    }

    // Accept both Vectis barcode formats:
    //   F066001 / F0660012  — tote/item barcodes (letter + 6-7 digits)
    //   R000016-413         — receipt unique IDs (letter + digits + dash + digits)
    // Rejects product EANs, ISBNs, etc.
    function isVectisBarcode(s: string): boolean {
      return /^[A-Za-z]\d{6,7}$/.test(s.trim()) || /^[A-Za-z]\d{4,7}-\d{1,6}$/.test(s.trim())
    }

    async function decodeBarcode(file: File): Promise<string | null> {
      try {
        const imgEl    = await loadImgElement(file)
        const naturalW = imgEl.naturalWidth
        const naturalH = imgEl.naturalHeight

        function toCanvas(targetW: number, scanMode: "normal" | "contrast" | "bw" = "normal"): HTMLCanvasElement {
          const scale = Math.min(1, targetW / naturalW)
          const w = Math.round(naturalW * scale)
          const h = Math.round(naturalH * scale)
          const c = document.createElement("canvas")
          c.width = w; c.height = h
          const ctx = c.getContext("2d")!
          ctx.fillStyle = "#ffffff"
          ctx.fillRect(0, 0, w, h)
          if (scanMode === "contrast") ctx.filter = "contrast(400%) grayscale(100%)"
          ctx.drawImage(imgEl, 0, 0, w, h)
          if (scanMode === "bw") {
            const id = ctx.getImageData(0, 0, w, h)
            for (let i = 0; i < id.data.length; i += 4) {
              const v = 0.299 * id.data[i] + 0.587 * id.data[i+1] + 0.114 * id.data[i+2] > 128 ? 255 : 0
              id.data[i] = id.data[i+1] = id.data[i+2] = v
            }
            ctx.putImageData(id, 0, 0)
          }
          return c
        }

        if (nativeDetector) {
          for (const targetW of [naturalW, 900]) {
            for (const scanMode of ["normal", "contrast", "bw"] as const) {
              const c = toCanvas(targetW, scanMode)
              try {
                const bmp     = await createImageBitmap(c)
                const results = await nativeDetector.detect(bmp)
                if (results.length > 0) {
                  const raw = (results[0].rawValue as string).replace(/[^\x20-\x7E]/g, "").trim()
                  if (raw && isVectisBarcode(raw)) return raw
                }
              } catch {}
            }
          }
        }

        for (const targetW of [2000, 1200]) {
          for (const scanMode of ["normal", "bw"] as const) {
            const c = toCanvas(targetW, scanMode)
            try {
              const luminance = new HTMLCanvasElementLuminanceSource(c)
              const bitmap    = new BinaryBitmap(new HybridBinarizer(luminance))
              const decoded   = zxing.decodeWithState(bitmap).getText().replace(/[^\x20-\x7E]/g, "").trim()
              if (isVectisBarcode(decoded)) return decoded
            } catch {}
          }
        }
        return null
      } catch {
        return null
      }
    }

    const result: LotGroup[] = []
    let current: LotGroup | null = null

    for (let i = 0; i < files.length; i++) {
      setScanProgress({ done: i + 1, total: files.length })
      const file    = files[i]
      const barcode = await decodeBarcode(file)

      if (barcode) {
        const key   = barcode.toLowerCase().trim()
        const lotId = lotMap.get(key) ?? null
        current = { lotId, label: barcode, photos: [] }
        result.push(current)
      } else if (current) {
        current.photos.push(file)
      }
    }

    e.target.value = ""

    if (result.length === 0) {
      setError("No barcodes detected in any of the images. Make sure the lot label photos are included and in focus.")
      setPhase("idle")
      return
    }

    setGroups(result)
    setPhase("preview")
  }

  // ── Upload (shared by both modes) ─────────────────────────────────────────────
  async function handleUpload() {
    const uploadable = groups.filter(g => g.lotId && g.photos.length > 0)
    if (uploadable.length === 0) { setError("No matched lots with photos to upload."); return }

    const total = uploadable.reduce((sum, g) => sum + g.photos.length, 0)
    setUploadProgress({ done: 0, total })
    setPhase("uploading")

    const failedList: string[] = []
    let done = 0

    for (const group of uploadable) {
      for (const photo of group.photos) {
        try {
          const fd = new FormData()
          fd.set("photo", photo)
          await uploadLotPhoto(group.lotId!, auctionId, fd)
        } catch (e: any) {
          failedList.push(`${group.label}/${photo.name} — ${e?.message ?? "unknown error"}`)
        }
        done++
        setUploadProgress({ done, total })
      }
    }

    setSkipped(failedList)
    setPhase("done")
    onUploaded()
  }

  const matchedGroups   = groups.filter(g => g.lotId && g.photos.length > 0)
  const unmatchedGroups = groups.filter(g => !g.lotId)
  const emptyGroups     = groups.filter(g => g.lotId && g.photos.length === 0)
  const totalPhotos     = matchedGroups.reduce((sum, g) => sum + g.photos.length, 0)

  return (
    <div className="p-4 md:p-6 max-w-3xl">

      {/* ── Idle — mode selection ── */}
      {phase === "idle" && (
        <>
          <div className="mb-5">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Upload Photos</h2>
            <p className="text-xs text-gray-600 dark:text-gray-500 mt-0.5">
              Choose how to match photos to lots.
            </p>
          </div>

          {/* Hidden inputs */}
          <input ref={scanInputRef} type="file" multiple
            // @ts-ignore
            webkitdirectory=""
            className="hidden"
            onChange={handleScanFiles}
          />
          <input ref={filenameInputRef} type="file" multiple accept="image/*"
            className="hidden"
            onChange={handleFilenameFiles}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Option A — filename */}
            <button
              onClick={() => { setMode("filename"); filenameInputRef.current?.click() }}
              className="group flex flex-col items-center gap-3 py-10 rounded-xl border-2 border-dashed border-gray-600 hover:border-[#2AB4A6] text-gray-600 dark:text-gray-400 hover:text-[#2AB4A6] transition-colors px-6"
            >
              <span className="text-4xl">📂</span>
              <span className="text-sm font-semibold text-center">Match by filename</span>
              <span className="text-xs text-gray-600 text-center leading-relaxed">
                Filenames must include the barcode or receipt ID.<br />
                e.g. <span className="font-mono text-gray-600 dark:text-gray-500">F066001.jpg</span>,{" "}
                <span className="font-mono text-gray-600 dark:text-gray-500">F066001_2.jpg</span>
              </span>
            </button>

            {/* Option B — scan */}
            <button
              onClick={() => { setMode("scan"); scanInputRef.current?.click() }}
              className="group flex flex-col items-center gap-3 py-10 rounded-xl border-2 border-dashed border-gray-600 hover:border-purple-500 text-gray-600 dark:text-gray-400 hover:text-purple-400 transition-colors px-6"
            >
              <span className="text-4xl">📷</span>
              <span className="text-sm font-semibold text-center">Smart scan folder</span>
              <span className="text-xs text-gray-600 text-center leading-relaxed">
                Select a photo folder — barcodes are read<br />
                from each image automatically.
              </span>
            </button>
          </div>

          {error && <p className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2 mt-3">{error}</p>}
        </>
      )}

      {/* ── Scanning (scan mode only) ── */}
      {phase === "scanning" && (
        <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl px-6 py-10 flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-[#2AB4A6] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">Scanning for barcodes…</p>
          <div className="w-full bg-gray-800 rounded-full h-2">
            <div className="bg-[#2AB4A6] h-2 rounded-full transition-all duration-200"
              style={{ width: `${scanProgress.total > 0 ? (scanProgress.done / scanProgress.total) * 100 : 0}%` }} />
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-500">{scanProgress.done} / {scanProgress.total} images scanned</p>
        </div>
      )}

      {/* ── Preview (shared) ── */}
      {phase === "preview" && (
        <div className="space-y-4">
          <div className="mb-2">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              {mode === "filename" ? "Filename match preview" : "Scan results preview"}
            </h2>
            {mode === "filename" && (
              <p className="text-xs text-gray-600 dark:text-gray-500 mt-0.5">
                IDs extracted from filenames — suffixes like <span className="font-mono">_1</span>, <span className="font-mono">_2</span> are stripped automatically.
              </p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-3 text-center">
              <p className="text-2xl font-bold text-[#2AB4A6]">{matchedGroups.length}</p>
              <p className="text-xs text-gray-600 dark:text-gray-500 mt-0.5">Lots matched</p>
            </div>
            <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-3 text-center">
              <p className="text-2xl font-bold text-gray-700 dark:text-gray-200">{totalPhotos}</p>
              <p className="text-xs text-gray-600 dark:text-gray-500 mt-0.5">Photos to upload</p>
            </div>
            <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-3 text-center">
              <p className={`text-2xl font-bold ${unmatchedGroups.length > 0 ? "text-yellow-400" : "text-gray-600"}`}>
                {unmatchedGroups.length}
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-500 mt-0.5">Unmatched</p>
            </div>
          </div>

          {unmatchedGroups.length > 0 && (
            <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg px-3 py-2">
              <p className="text-xs text-yellow-400 font-medium mb-1">
                {mode === "filename"
                  ? "IDs not matched to any lot in this auction:"
                  : "Barcodes detected but not found in this auction:"}
              </p>
              <p className="text-xs text-yellow-600 font-mono">{unmatchedGroups.map(g => g.label).join(", ")}</p>
            </div>
          )}
          {emptyGroups.length > 0 && (
            <div className="bg-gray-900/50 border border-gray-700 rounded-lg px-3 py-2">
              <p className="text-xs text-gray-600 dark:text-gray-500">
                Lots matched but no photos found: <span className="font-mono">{emptyGroups.map(g => g.label).join(", ")}</span>
              </p>
            </div>
          )}

          {matchedGroups.length > 0 && (
            <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl overflow-hidden max-h-80 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 dark:bg-[#141416] border-b border-gray-300 dark:border-gray-700 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2 text-gray-600 dark:text-gray-500 font-medium">Barcode / ID</th>
                    <th className="text-left px-4 py-2 text-gray-600 dark:text-gray-500 font-medium">Photos</th>
                    <th className="text-left px-4 py-2 text-gray-600 dark:text-gray-500 font-medium">Files</th>
                  </tr>
                </thead>
                <tbody>
                  {matchedGroups.map(g => (
                    <tr key={g.label} className="border-b border-gray-200 dark:border-gray-800 last:border-0">
                      <td className="px-4 py-2 font-mono text-[#2AB4A6]">{g.label}</td>
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-300">{g.photos.length}</td>
                      <td className="px-4 py-2 text-gray-600 truncate max-w-[200px]">{g.photos.map(p => p.name).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {error && <p className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3">
            <button onClick={reset}
              className="px-5 py-2.5 rounded-lg border border-gray-700 text-gray-600 dark:text-gray-400 text-sm hover:border-gray-500 transition-colors">
              ← Back
            </button>
            <button onClick={handleUpload} disabled={matchedGroups.length === 0}
              className="flex-1 py-2.5 bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-50 text-black font-semibold rounded-lg text-sm transition-colors">
              Upload {totalPhotos} photo{totalPhotos !== 1 ? "s" : ""} to {matchedGroups.length} lot{matchedGroups.length !== 1 ? "s" : ""}
            </button>
          </div>
        </div>
      )}

      {/* ── Uploading ── */}
      {phase === "uploading" && (
        <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl px-6 py-10 flex flex-col items-center gap-4">
          <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">Uploading photos…</p>
          <div className="w-full bg-gray-800 rounded-full h-3">
            <div className="bg-[#2AB4A6] h-3 rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress.total > 0 ? (uploadProgress.done / uploadProgress.total) * 100 : 0}%` }} />
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-500">{uploadProgress.done} / {uploadProgress.total} photos</p>
        </div>
      )}

      {/* ── Done ── */}
      {phase === "done" && (
        <div className="space-y-4">
          <div className="bg-[#2AB4A6]/10 border border-[#2AB4A6]/30 rounded-xl px-6 py-8 flex flex-col items-center gap-2">
            <span className="text-4xl">✓</span>
            <p className="text-sm font-semibold text-[#2AB4A6]">Upload complete</p>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              {uploadProgress.done} photo{uploadProgress.done !== 1 ? "s" : ""} uploaded to {matchedGroups.length} lot{matchedGroups.length !== 1 ? "s" : ""}
            </p>
          </div>
          {skipped.length > 0 && (
            <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg px-3 py-2">
              <p className="text-xs text-yellow-400">{skipped.length} photo{skipped.length !== 1 ? "s" : ""} failed: {skipped.join(", ")}</p>
            </div>
          )}
          <button onClick={reset}
            className="w-full py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm hover:border-gray-500 transition-colors">
            Upload more photos
          </button>
        </div>
      )}
    </div>
  )
}
