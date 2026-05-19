"use client"

import { useState, useRef, useTransition, useEffect } from "react"
import { createPhotoOnlyLot } from "@/lib/actions/catalogue"

type Phase = "scan" | "photos" | "saving"

interface Props {
  auctionId: string
  auctionCode: string
  onCreated: () => void
  tablet?: boolean
}

export default function PhotoOnlyTab({ auctionId, auctionCode, onCreated, tablet }: Props) {
  const [phase, setPhase]           = useState<Phase>("scan")
  const [lotBarcode, setLotBarcode] = useState("")
  const [toteNumber, setToteNumber] = useState("")
  const [totePinned, setTotePinned] = useState(false)
  const [scanTarget, setScanTarget] = useState<"lot" | "tote">("lot")
  const [scanning, setScanning]     = useState(false)
  const [scanError, setScanError]   = useState<string | null>(null)
  const [itemPhotos, setItemPhotos] = useState<{ file: File; preview: string }[]>([])
  const [notes, setNotes]           = useState("")
  const [error, setError]           = useState<string | null>(null)
  const [pending, start]            = useTransition()
  const [savedCount, setSavedCount] = useState(0)

  const videoRef         = useRef<HTMLVideoElement>(null)
  const controlsRef      = useRef<{ stop: () => void } | null>(null)
  const photoRef         = useRef<HTMLInputElement>(null)
  const barcodeStartedAt = useRef<number | null>(null)

  // Stop scanner on unmount
  useEffect(() => () => { controlsRef.current?.stop() }, [])

  async function startScan(target: "lot" | "tote") {
    setScanTarget(target)
    setScanError(null)
    setScanning(true)
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser")
      const reader = new BrowserMultiFormatReader()
      const controls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current!,
        (result, err) => {
          if (result) {
            const text = result.getText()
            if (target === "lot") {
              if (!lotBarcode && !barcodeStartedAt.current) barcodeStartedAt.current = Date.now()
              setLotBarcode(text)
            } else setToteNumber(text)
            controls.stop()
            controlsRef.current = null
            setScanning(false)
          }
        }
      )
      controlsRef.current = controls
    } catch {
      setScanError("Camera not available — enter manually below.")
      setScanning(false)
    }
  }

  function stopScan() {
    controlsRef.current?.stop()
    controlsRef.current = null
    setScanning(false)
  }

  function handleItemPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    setItemPhotos(prev => [...prev, ...files.map(f => ({ file: f, preview: URL.createObjectURL(f) }))])
    e.target.value = ""
  }

  function removePhoto(i: number) {
    setItemPhotos(prev => { URL.revokeObjectURL(prev[i].preview); return prev.filter((_, j) => j !== i) })
  }

  function toPhotos() {
    if (!lotBarcode.trim()) { setError("Please scan or enter a lot barcode."); return }
    setError(null)
    setPhase("photos")
  }

  function buildFormData() {
    const fd = new FormData()
    fd.set("lotNumber",  lotBarcode.trim())   // temp ID until auto-lotter runs
    fd.set("barcode",    lotBarcode.trim())   // permanent barcode field
    fd.set("durationMs", String(barcodeStartedAt.current ? Date.now() - barcodeStartedAt.current : 0))
    if (toteNumber.trim()) fd.set("tote", toteNumber.trim())
    if (notes.trim()) fd.set("notes", notes.trim())
    itemPhotos.forEach(p => fd.append("itemPhoto", p.file))
    return fd
  }

  function resetLot(scanNext = false) {
    barcodeStartedAt.current = null
    itemPhotos.forEach(p => URL.revokeObjectURL(p.preview))
    setItemPhotos([])
    setLotBarcode("")
    setNotes("")
    if (!totePinned) setToteNumber("")
    setPhase("scan")
    if (scanNext) setTimeout(() => startScan("lot"), 50)
  }

  function handleSave(scanNext = false) {
    if (itemPhotos.length === 0) { setError("Please take at least one photo."); return }
    setError(null)
    start(async () => {
      try {
        await createPhotoOnlyLot(auctionId, buildFormData())
        setSavedCount(n => n + 1)
        onCreated()
        resetLot(scanNext)
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save lot")
      }
    })
  }

  return (
    <div className="p-4 md:p-6 max-w-lg">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className={`font-semibold text-gray-700 dark:text-gray-200 ${tablet ? "text-base" : "text-sm"}`}>Photo Only Cataloguing</h2>
          <p className={`text-gray-600 dark:text-gray-500 mt-0.5 ${tablet ? "text-sm" : "text-xs"}`}>{auctionCode} — scan barcode, take photos, save</p>
        </div>
        {savedCount > 0 && (
          <span className={`font-bold text-[#2AB4A6] ${tablet ? "text-base" : "text-sm"}`}>{savedCount} saved</span>
        )}
      </div>

      {/* Phase indicator */}
      <div className={`flex items-center gap-1 mb-6 ${tablet ? "text-sm" : "text-xs"}`}>
        {[["scan", "1. Barcode"], ["photos", "2. Photos"]].map(([p, label]) => (
          <div key={p} className={`flex items-center gap-1 ${phase === p ? "text-[#2AB4A6] font-semibold" : phase === "saving" || (p === "scan" && phase === "photos") ? "text-[#2AB4A6]/50" : "text-gray-600"}`}>
            <span>{label}</span>
            {p === "scan" && <span className="text-gray-700 mx-1">→</span>}
          </div>
        ))}
      </div>

      {/* ── Phase 1: Barcode ── */}
      {phase === "scan" && (
        <div className="space-y-5">

          {/* Camera viewfinder — always rendered so ref is available */}
          <div className={scanning ? "block" : "hidden"}>
            <div className="relative rounded-xl overflow-hidden border border-gray-300 dark:border-gray-700 bg-black">
              <video ref={videoRef} className="w-full aspect-video object-cover" autoPlay muted playsInline />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-48 h-24 border-2 border-[#2AB4A6] rounded-lg opacity-70" />
              </div>
              <div className="absolute bottom-3 left-0 right-0 flex justify-center">
                <button onClick={stopScan}
                  className="px-4 py-2 bg-black/70 rounded-full text-sm text-gray-300 border border-gray-600 hover:bg-black/90 transition-colors">
                  Cancel scan
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-500 text-center mt-1 animate-pulse">Scanning for {scanTarget === "lot" ? "lot barcode" : "tote number"}…</p>
          </div>

          {/* Lot barcode */}
          {!scanning && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={`font-medium text-gray-600 dark:text-gray-400 ${tablet ? "text-sm" : "text-xs"}`}>Lot Barcode *</label>
                <button onClick={() => startScan("lot")}
                  className={`flex items-center gap-1 text-[#2AB4A6] hover:text-[#24a090] transition-colors ${tablet ? "text-sm" : "text-xs"}`}>
                  📷 {lotBarcode ? "Re-scan" : "Scan"}
                </button>
              </div>
              <input
                value={lotBarcode}
                onChange={e => {
                  const v = e.target.value
                  if (v && !lotBarcode && !barcodeStartedAt.current) barcodeStartedAt.current = Date.now()
                  setLotBarcode(v)
                }}
                placeholder="Scan or type barcode…"
                className={`w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-[#2C2C2E] text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6] font-mono ${tablet ? "px-4 py-3.5 text-base" : "px-3 py-3 text-sm"}`}
              />
              {lotBarcode && (
                <p className={`text-[#2AB4A6] mt-1 ${tablet ? "text-sm" : "text-xs"}`}>✓ {lotBarcode}</p>
              )}
            </div>
          )}

          {/* Tote number (optional, pinnable) */}
          {!scanning && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={`font-medium text-gray-600 dark:text-gray-400 ${tablet ? "text-sm" : "text-xs"}`}>Tote Number <span className="text-gray-600">(optional)</span></label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setTotePinned(p => !p)}
                    className={`rounded border transition-colors ${tablet ? "text-sm px-3 py-1.5" : "text-xs px-2 py-0.5"} ${totePinned ? "border-[#2AB4A6] text-[#2AB4A6]" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-500 hover:border-gray-500"}`}
                  >
                    {totePinned ? "📌 Pinned" : "Pin"}
                  </button>
                  <button onClick={() => startScan("tote")}
                    className={`flex items-center gap-1 text-[#2AB4A6] hover:text-[#24a090] transition-colors ${tablet ? "text-sm" : "text-xs"}`}>
                    📷 {toteNumber ? "Re-scan" : "Scan"}
                  </button>
                </div>
              </div>
              <input
                value={toteNumber}
                onChange={e => setToteNumber(e.target.value)}
                placeholder="e.g. T-1234"
                className={`w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-[#2C2C2E] text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6] font-mono ${tablet ? "px-4 py-3.5 text-base" : "px-3 py-3 text-sm"}`}
              />
              {toteNumber && (
                <p className={`mt-1 ${tablet ? "text-sm" : "text-xs"}`} style={{ color: "#2AB4A6" }}>
                  ✓ {toteNumber}{totePinned && " · pinned for next lot"}
                </p>
              )}
            </div>
          )}

          {scanError && <p className="text-xs text-yellow-400">{scanError}</p>}
          {error && <p className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2">{error}</p>}

          {!scanning && (
            <button onClick={toPhotos}
              style={{ touchAction: tablet ? "manipulation" : undefined }}
              className={`w-full bg-[#2AB4A6] hover:bg-[#24a090] text-black font-semibold rounded-lg transition-colors ${tablet ? "py-4 text-base" : "py-3 text-sm"}`}>
              Next → Take Photos
            </button>
          )}
        </div>
      )}

      {/* ── Phase 2: Photos ── */}
      {phase === "photos" && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-[#1C1C1E] rounded-lg border border-gray-200 dark:border-gray-800 px-4 py-3 text-sm">
            <span className="text-gray-600 dark:text-gray-500">Lot: </span>
            <span className="text-gray-700 dark:text-gray-200 font-mono">{lotBarcode}</span>
            {toteNumber && <><span className="text-gray-600 mx-2">·</span><span className="text-gray-600 dark:text-gray-500">Tote: </span><span className="text-gray-600 dark:text-gray-400 font-mono">{toteNumber}</span></>}
          </div>

          <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleItemPhoto} />

          <button onClick={() => photoRef.current?.click()}
            className="w-full py-5 rounded-xl border-2 border-dashed border-gray-600 hover:border-[#2AB4A6] text-gray-600 dark:text-gray-400 hover:text-[#2AB4A6] transition-colors flex flex-col items-center gap-1">
            <span className="text-3xl">📷</span>
            <span className="text-sm font-medium">Take item photo</span>
            <span className="text-xs text-gray-600">Tap to open camera</span>
          </button>

          {itemPhotos.length > 0 && (
            <div className={`grid gap-3 ${tablet ? "grid-cols-2" : "grid-cols-3"}`}>
              {itemPhotos.map((p, i) => (
                <div key={i} className="relative aspect-square">
                  <img src={p.preview} alt={`Item ${i + 1}`} className="w-full h-full object-cover rounded-lg border border-gray-300 dark:border-gray-700" />
                  <button onClick={() => removePhoto(i)}
                    className={`absolute bg-red-600 rounded-full text-white flex items-center justify-center ${tablet ? "-top-2 -right-2 w-8 h-8 text-sm" : "-top-1.5 -right-1.5 w-5 h-5 text-xs"}`}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <p className={`text-gray-600 ${tablet ? "text-sm" : "text-xs"}`}>{itemPhotos.length} photo{itemPhotos.length !== 1 ? "s" : ""} taken</p>

          <div>
            <label className={`font-medium text-gray-600 dark:text-gray-400 block mb-1 ${tablet ? "text-sm" : "text-xs"}`}>Notes <span className="text-gray-600">(optional)</span></label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any notes about this lot…"
              rows={2}
              className={`w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-[#2C2C2E] text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6] resize-none ${tablet ? "px-4 py-3 text-base" : "px-3 py-2 text-sm"}`}
            />
          </div>

          {error && <p className={`text-red-400 bg-red-900/20 rounded-lg px-3 py-2 ${tablet ? "text-sm" : "text-xs"}`}>{error}</p>}

          <div className="flex gap-3">
            <button onClick={() => { setError(null); setPhase("scan") }}
              style={{ touchAction: tablet ? "manipulation" : undefined }}
              className={`rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium hover:border-gray-500 transition-colors ${tablet ? "py-4 px-5 text-base" : "py-3 px-4 text-sm"}`}>
              ← Back
            </button>
            <button onClick={() => handleSave(false)} disabled={pending}
              style={{ touchAction: tablet ? "manipulation" : undefined }}
              className={`flex-1 bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-50 text-black font-semibold rounded-lg transition-colors ${tablet ? "py-4 text-base" : "py-3 text-sm"}`}>
              {pending ? "Saving…" : "Save ✓"}
            </button>
            <button onClick={() => handleSave(true)} disabled={pending}
              style={{ touchAction: tablet ? "manipulation" : undefined }}
              className={`flex-1 bg-[#1e8a7e] hover:bg-[#186f65] disabled:opacity-50 text-white font-semibold rounded-lg transition-colors ${tablet ? "py-4 text-base" : "py-3 text-sm"}`}>
              {pending ? "Saving…" : "Save & Next →"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
