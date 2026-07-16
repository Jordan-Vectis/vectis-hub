"use client"

import { useRef, useState } from "react"

// Mirrors the smart scan's Vectis-format check.
function isVectisBarcode(s: string): boolean {
  const t = s.replace(/[^\x20-\x7E]/g, "").trim()
  return /^[A-Za-z]\d{6,7}$/.test(t) || /^[A-Za-z]\d{4,7}-\d{1,6}$/.test(t)
}

type Mode = "normal" | "contrast" | "bw"

interface PassResult {
  reader:  string        // "Native" | "ZXing · Hybrid" | "ZXing · Global"
  size:    string        // e.g. "2000px" or "full (4032px)"
  mode:    Mode
  rot:     number        // rotation in degrees the image was straightened by
  raw:     string | null // whatever it decoded (may be a non-Vectis value like the date)
  vectis:  boolean       // did it pass the Vectis-format check
}

export default function BarcodeDebugClient() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile]         = useState<File | null>(null)
  const [preview, setPreview]   = useState<string | null>(null)
  const [info, setInfo]         = useState<{ w: number; h: number; type: string; kb: number } | null>(null)
  const [running, setRunning]   = useState(false)
  const [prog, setProg]         = useState({ done: 0, total: 0 })
  const [passes, setPasses]     = useState<PassResult[]>([])
  const [consistency, setConsistency] = useState<{ runs: number; results: Record<string, number> } | null>(null)
  const [canvases, setCanvases] = useState<{ mode: Mode; url: string }[]>([])
  const [aiResult, setAiResult] = useState<string | null>(null)
  const [aiRunning, setAiRunning] = useState(false)
  const [error, setError]       = useState<string | null>(null)

  function pick(f: File | null) {
    if (!f) return
    setFile(f)
    setPasses([]); setConsistency(null); setCanvases([]); setAiResult(null); setError(null)
    setPreview(URL.createObjectURL(f))
  }

  function loadImg(f: File): Promise<HTMLImageElement> {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(f)
      const el = new Image()
      el.onload = () => { URL.revokeObjectURL(url); res(el) }
      el.onerror = () => { URL.revokeObjectURL(url); rej(new Error("load failed")) }
      el.src = url
    })
  }

  // Render the image at a target width, a contrast treatment, and an optional
  // rotation (degrees). Rotating straightens a skewed label so zxing's
  // horizontal scan lines can cross all the bars. The canvas grows to the
  // rotated bounding box so nothing clips.
  function toCanvas(img: HTMLImageElement, targetW: number, mode: Mode, deg = 0): HTMLCanvasElement {
    const scale = Math.min(1, targetW / img.naturalWidth)
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const rad = (deg * Math.PI) / 180
    const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad))
    const cw = deg ? Math.ceil(w * cos + h * sin) : w
    const ch = deg ? Math.ceil(w * sin + h * cos) : h
    const c = document.createElement("canvas")
    c.width = cw; c.height = ch
    const ctx = c.getContext("2d")!
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cw, ch)
    ctx.save()
    ctx.translate(cw / 2, ch / 2)
    if (deg) ctx.rotate(rad)
    if (mode === "contrast") ctx.filter = "contrast(400%) grayscale(100%)"
    ctx.drawImage(img, -w / 2, -h / 2, w, h)
    ctx.restore()
    if (mode === "bw") {
      const id = ctx.getImageData(0, 0, cw, ch)
      for (let i = 0; i < id.data.length; i += 4) {
        const v = 0.299 * id.data[i] + 0.587 * id.data[i+1] + 0.114 * id.data[i+2] > 128 ? 255 : 0
        id.data[i] = id.data[i+1] = id.data[i+2] = v
      }
      ctx.putImageData(id, 0, 0)
    }
    return c
  }

  async function run() {
    if (!file) return
    setRunning(true); setError(null); setPasses([]); setConsistency(null); setCanvases([]); setProg({ done: 0, total: 0 })
    try {
      const img = await loadImg(file)
      setInfo({ w: img.naturalWidth, h: img.naturalHeight, type: file.type || "unknown", kb: Math.round(file.size / 1024) })

      const [{ HTMLCanvasElementLuminanceSource }, zx] =
        await Promise.all([import("@zxing/browser"), import("@zxing/library")])
      const { MultiFormatReader, BinaryBitmap, HybridBinarizer, GlobalHistogramBinarizer, DecodeHintType } = zx as any
      const hints = new Map(); hints.set(DecodeHintType.TRY_HARDER, true)
      const nativeDetector = "BarcodeDetector" in window
        ? new (window as any).BarcodeDetector({ formats: ["code_128", "code_39", "qr_code", "ean_13"] })
        : null

      // Let the browser breathe between passes — zxing.decode is SYNCHRONOUS and
      // heavy, and on devices with no native reader nothing else here awaits, so
      // without a yield the whole run blocks the tab ("Page Unresponsive").
      const yieldToUI = () => new Promise(r => setTimeout(r, 0))

      const modes: Mode[] = ["normal", "contrast", "bw"]
      // Cap at 2000px — bigger just costs CPU without helping a barcode read
      // (the full 4176px canvases were the main cause of the freeze).
      const sizes = [
        { w: Math.min(2000, img.naturalWidth), label: `${Math.min(2000, img.naturalWidth)}px` },
        { w: 1200, label: "1200px" },
      ].filter((s, i, arr) => arr.findIndex(x => x.w === s.w) === i)
      const rotations = [0, -4, 4, -8, 8, -12, 12]   // 0° first, then straighten a few degrees each way

      const out: PassResult[] = []
      const zxCount = sizes.length * rotations.length * modes.length
      setProg({ done: 0, total: zxCount + 8 })   // + the 8 consistency runs
      let done = 0

      for (const s of sizes) {
        for (const rot of rotations) {
          for (const mode of modes) {
            const c = toCanvas(img, s.w, mode, rot)   // one canvas, shared by both binarizers
            if (nativeDetector) {
              try {
                const bmp = await createImageBitmap(c)
                const r = await nativeDetector.detect(bmp)
                const raw = r.length > 0 ? String(r[0].rawValue).replace(/[^\x20-\x7E]/g, "").trim() : null
                out.push({ reader: "Native", size: s.label, mode, rot, raw, vectis: !!raw && isVectisBarcode(raw) })
              } catch { out.push({ reader: "Native", size: s.label, mode, rot, raw: null, vectis: false }) }
            }
            const lum = new HTMLCanvasElementLuminanceSource(c)
            for (const [name, Bin] of [["ZXing · Hybrid", HybridBinarizer], ["ZXing · Global", GlobalHistogramBinarizer]] as const) {
              const reader = new MultiFormatReader(); reader.setHints(hints)
              try {
                const raw = reader.decode(new BinaryBitmap(new Bin(lum))).getText().replace(/[^\x20-\x7E]/g, "").trim()
                out.push({ reader: name, size: s.label, mode, rot, raw: raw || null, vectis: isVectisBarcode(raw) })
              } catch { out.push({ reader: name, size: s.label, mode, rot, raw: null, vectis: false }) }
            }
            done += 1; setProg({ done, total: zxCount + 8 })
            await yieldToUI()   // keep the tab responsive
          }
        }
      }
      out.sort((a, b) => (b.vectis ? 1 : 0) - (a.vectis ? 1 : 0))   // reads first
      setPasses(out)

      // Canvas previews (small) so you can see what the reader "sees".
      setCanvases(modes.map(mode => ({ mode, url: toCanvas(img, 500, mode).toDataURL("image/png") })))

      // Consistency: run the PRODUCTION pipeline (one reused reader, decodeWithState,
      // [2000,1200] × normal/contrast/bw Hybrid) 8× and tally — reveals flakiness.
      const tally: Record<string, number> = {}
      for (let n = 0; n < 8; n++) {
        const reader = new MultiFormatReader(); reader.setHints(hints)
        let found: string | null = null
        outer:
        for (const tw of [2000, 1200]) {
          for (const mode of modes) {
            try {
              const lum = new HTMLCanvasElementLuminanceSource(toCanvas(img, tw, mode))
              const d = reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(lum))).getText().replace(/[^\x20-\x7E]/g, "").trim()
              if (isVectisBarcode(d)) { found = d; break outer }
            } catch {}
          }
        }
        tally[found ?? "— (not read)"] = (tally[found ?? "— (not read)"] ?? 0) + 1
        done += 1; setProg({ done, total: zxCount + 8 })
        await yieldToUI()
      }
      setConsistency({ runs: 8, results: tally })
    } catch (e: any) {
      setError(e?.message === "load failed"
        ? "This browser couldn't open the image (HEIC photos can't be read on Windows — convert to JPEG)."
        : (e?.message ?? "Something went wrong."))
    } finally {
      setRunning(false)
    }
  }

  async function runAi() {
    if (!file) return
    setAiRunning(true); setAiResult(null)
    try {
      const fd = new FormData(); fd.append("photo_0", file, file.name)
      const res = await fetch("/api/catalogue/scan-photos", { method: "POST", body: fd })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.photos?.[0]) {
        const p = data.photos[0]
        setAiResult(p.label ? (p.code ? `Label — read "${p.code}"` : "Label — but couldn't read the code") : "Not a barcode label (item photo)")
      } else {
        setAiResult(`AI error: ${data?.error ?? `HTTP ${res.status}`}`)
      }
    } catch (e: any) {
      setAiResult(`Couldn't reach AI: ${e?.message ?? "network error"}`)
    } finally {
      setAiRunning(false)
    }
  }

  const anyVectis = passes.some(p => p.vectis)
  const readCount = passes.filter(p => p.vectis).length
  // Did straightening (a non-zero rotation) rescue it when 0° failed?
  const readFlat    = passes.some(p => p.vectis && p.rot === 0)
  const readRotated = passes.some(p => p.vectis && p.rot !== 0)
  const rotWinners  = Array.from(new Set(passes.filter(p => p.vectis && p.rot !== 0).map(p => p.rot))).sort((a, b) => a - b)

  return (
    <div className="space-y-5">
      {/* Drop / pick */}
      <div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={e => pick(e.target.files?.[0] ?? null)} />
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); pick(e.dataTransfer.files?.[0] ?? null) }}
          className="cursor-pointer rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-purple-500 px-6 py-8 text-center transition-colors"
        >
          {preview ? (
            <img src={preview} alt="" className="max-h-64 mx-auto rounded-lg" />
          ) : (
            <p className="text-sm text-gray-600 dark:text-gray-400">Click or drop a single photo here</p>
          )}
        </div>
        {info && (
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
            {info.w}×{info.h}px · {info.type} · {info.kb} KB
          </p>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        <button onClick={run} disabled={!file || running}
          className="px-5 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-sm font-semibold transition-colors">
          {running ? "Testing…" : "Test the barcode reader"}
        </button>
        <button onClick={runAi} disabled={!file || aiRunning}
          className="px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:border-gray-500 disabled:opacity-40 transition-colors">
          {aiRunning ? "Asking AI…" : "✨ Ask AI what it reads"}
        </button>
      </div>

      {running && prog.total > 0 && (
        <div>
          <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2">
            <div className="bg-purple-500 h-2 rounded-full transition-all duration-150"
              style={{ width: `${(prog.done / prog.total) * 100}%` }} />
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{prog.done} of {prog.total} passes</p>
        </div>
      )}

      {error && <div className="rounded-lg border border-red-300 dark:border-red-700/50 bg-red-100 dark:bg-red-900/20 px-3 py-2 text-xs text-red-800 dark:text-red-300">{error}</div>}

      {aiResult && (
        <div className="rounded-lg border border-purple-300 dark:border-purple-700/50 bg-purple-100 dark:bg-purple-900/20 px-3 py-2 text-sm text-purple-800 dark:text-purple-300">
          ✨ {aiResult}
        </div>
      )}

      {/* Verdict */}
      {passes.length > 0 && (
        <div className={`rounded-xl border px-4 py-3 ${
          anyVectis
            ? "border-green-300 dark:border-green-700/60 bg-green-100 dark:bg-green-900/20"
            : "border-amber-300 dark:border-amber-700/60 bg-amber-100 dark:bg-amber-900/20"
        }`}>
          <p className={`text-sm font-semibold ${anyVectis ? "text-green-800 dark:text-green-300" : "text-amber-800 dark:text-amber-300"}`}>
            {anyVectis
              ? `The reader CAN read this — ${readCount} of ${passes.length} passes got a valid code.`
              : `The reader could NOT read this on any of ${passes.length} passes, even straightened.`}
          </p>
          {!readFlat && readRotated && (
            <p className="text-xs text-green-800 dark:text-green-300 mt-1">
              ✅ Straight-on (0°) failed, but it read once <strong>rotated {rotWinners.map(r => `${r > 0 ? "+" : ""}${r}°`).join(", ")}</strong> —
              so the fix is to add rotation attempts to the scan.
            </p>
          )}
          {consistency && (
            <p className="text-xs text-gray-700 dark:text-gray-300 mt-1">
              Consistency (production pipeline ×{consistency.runs}):{" "}
              {Object.entries(consistency.results).map(([k, n]) => `${k} ×${n}`).join("   ·   ")}
              {Object.keys(consistency.results).length > 1 && <strong className="text-amber-700 dark:text-amber-400"> — flaky!</strong>}
            </p>
          )}
        </div>
      )}

      {/* Per-pass table */}
      {passes.length > 0 && (
        <div className="rounded-xl border border-gray-300 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-[#141416] text-gray-600 dark:text-gray-400">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Reader</th>
                  <th className="text-left px-3 py-2 font-medium">Size</th>
                  <th className="text-left px-3 py-2 font-medium">Rotation</th>
                  <th className="text-left px-3 py-2 font-medium">Treatment</th>
                  <th className="text-left px-3 py-2 font-medium">Read</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {passes.map((p, i) => (
                  <tr key={i} className={p.vectis ? "bg-green-50 dark:bg-green-900/10" : ""}>
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">{p.reader}</td>
                    <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400">{p.size}</td>
                    <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400">{p.rot === 0 ? "0°" : `${p.rot > 0 ? "+" : ""}${p.rot}°`}</td>
                    <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400">{p.mode}</td>
                    <td className="px-3 py-1.5 font-mono">
                      {p.raw
                        ? <span className={p.vectis ? "text-green-700 dark:text-green-400 font-semibold" : "text-gray-500 dark:text-gray-500"}>{p.raw}{!p.vectis && " (not a Vectis code)"}</span>
                        : <span className="text-gray-400 dark:text-gray-600">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Canvas previews */}
      {canvases.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">What the reader sees</p>
          <div className="grid grid-cols-3 gap-3">
            {canvases.map(c => (
              <div key={c.mode}>
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1 capitalize">{c.mode}</p>
                <img src={c.url} alt={c.mode} className="w-full rounded-lg border border-gray-300 dark:border-gray-700" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
