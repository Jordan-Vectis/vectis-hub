"use client"

import { useEffect, useRef, useState } from "react"

// Shared full-screen image/PDF viewer used by the month page (invoice scans) and
// the reconcile page (uploaded bank statements). Photos: zoom (buttons / wheel /
// pinch) + drag-pan + flick between pages. PDFs render in an iframe.
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const isPdf = (u: string) => u.split("?")[0].toLowerCase().endsWith(".pdf")

export default function ImageViewer({ images, startIndex, onClose, label }: { images: string[]; startIndex: number; onClose: () => void; label?: string }) {
  const [i, setI] = useState(startIndex)
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinch = useRef<{ dist: number; zoom: number } | null>(null)
  const panLast = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => { setZoom(1); setPos({ x: 0, y: 0 }) }, [i])
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
      else if (e.key === "ArrowRight") setI((p) => Math.min(p + 1, images.length - 1))
      else if (e.key === "ArrowLeft") setI((p) => Math.max(p - 1, 0))
      else if (e.key === "+" || e.key === "=") setZoom((z) => clamp(z + 0.25, 1, 6))
      else if (e.key === "-" || e.key === "_") setZoom((z) => clamp(z - 0.25, 1, 6))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [images.length, onClose])

  function spread() {
    const pts = [...pointers.current.values()]
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
  }
  function onPointerDown(e: React.PointerEvent) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) pinch.current = { dist: spread(), zoom }
    else if (pointers.current.size === 1 && zoom > 1) panLast.current = { x: e.clientX, y: e.clientY }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2 && pinch.current) {
      setZoom(clamp(pinch.current.zoom * (spread() / pinch.current.dist), 1, 6))
    } else if (pointers.current.size === 1 && zoom > 1 && panLast.current) {
      setPos((p) => ({ x: p.x + (e.clientX - panLast.current!.x), y: p.y + (e.clientY - panLast.current!.y) }))
      panLast.current = { x: e.clientX, y: e.clientY }
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 0) { panLast.current = null; if (zoom <= 1) setPos({ x: 0, y: 0 }) }
  }

  const btn = "bg-white/15 hover:bg-white/30 text-white rounded-lg w-9 h-9 flex items-center justify-center text-lg leading-none"
  const pdf = isPdf(images[i])
  return (
    <div className="fixed inset-0 z-[70] bg-black/90 flex flex-col" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex items-center justify-between p-3 text-white">
        <span className="text-sm">{label ? label + " · " : ""}{images.length > 1 ? `Page ${i + 1} of ${images.length}` : "Page"}{pdf ? " · PDF" : ` · ${Math.round(zoom * 100)}%`}</span>
        <div className="flex items-center gap-2">
          {!pdf && <button className={btn} onClick={() => setZoom((z) => clamp(z - 0.5, 1, 6))} title="Zoom out">−</button>}
          {!pdf && <button className={btn} onClick={() => { setZoom(1); setPos({ x: 0, y: 0 }) }} title="Fit">⤢</button>}
          {!pdf && <button className={btn} onClick={() => setZoom((z) => clamp(z + 0.5, 1, 6))} title="Zoom in">+</button>}
          <a className={btn} href={images[i]} target="_blank" rel="noreferrer" title="Open in new tab">↗</a>
          <button className={btn} onClick={onClose} title="Close">×</button>
        </div>
      </div>
      {pdf ? (
        <div className="flex-1 bg-white" onClick={(e) => e.stopPropagation()}>
          <iframe src={images[i]} title={`Page ${i + 1}`} className="w-full h-full border-0" />
        </div>
      ) : (
        <div
          className="flex-1 overflow-hidden flex items-center justify-center select-none"
          style={{ touchAction: "none", cursor: zoom > 1 ? "grab" : "zoom-in" }}
          onWheel={(e) => setZoom((z) => clamp(z - e.deltaY * 0.0015, 1, 6))}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={() => setZoom((z) => (z > 1 ? 1 : 2.5))}
        >
          <img
            src={images[i]}
            alt={`Page ${i + 1}`}
            draggable={false}
            className="max-h-full max-w-full object-contain"
            style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom})`, transition: pinch.current || panLast.current ? "none" : "transform 0.08s" }}
          />
        </div>
      )}
      {images.length > 1 && (
        <>
          <button onClick={() => setI((p) => Math.max(p - 1, 0))} disabled={i === 0}
            className="absolute left-3 top-1/2 -translate-y-1/2 bg-white/15 hover:bg-white/30 disabled:opacity-30 text-white rounded-full w-11 h-11 text-2xl leading-none">‹</button>
          <button onClick={() => setI((p) => Math.min(p + 1, images.length - 1))} disabled={i === images.length - 1}
            className="absolute right-3 top-1/2 -translate-y-1/2 bg-white/15 hover:bg-white/30 disabled:opacity-30 text-white rounded-full w-11 h-11 text-2xl leading-none">›</button>
        </>
      )}
    </div>
  )
}
