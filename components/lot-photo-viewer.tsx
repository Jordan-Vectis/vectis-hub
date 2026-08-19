"use client"

import { useCallback, useEffect, useRef, useState } from "react"

// Enlarge a lot's photos and zoom in far enough to read a swing label or a product code off the
// picture — which is the actual job when you are checking whether an AI flag was right.
//
// Shared by the Review tab and Admin → Saved Flagged Lots, so the archive behaves like the
// screen it is a copy of.
//
// ⚠ THIS IS NOT THE ONLY ZOOM COMPONENT. components/zoomable-lightbox.tsx came first and is used
// by the submissions photo viewer and the public valuation page. It takes a single `src` and has
// no photo strip or arrow-key navigation, and this one needs both, so it is a separate
// component rather than a wrapper. Its pinch handling was lifted from there rather than invented
// again. ⚠ If you need a third, extend one of these two instead — three implementations of
// drag-to-pan is how they start disagreeing about what a double-tap does.

/** Photos are normally raw R2 keys. A caller holding presigned URLs can pass its own resolver. */
const defaultResolve = (key: string) => `/api/catalogue/photo-proxy?key=${encodeURIComponent(key)}`

const ZOOM_STEPS = [1, 1.5, 2, 3, 4, 6, 8]
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(1, z))

export default function LotPhotoViewer({
  images, label, index, onIndex, onClose, resolveSrc = defaultResolve,
}: {
  images: string[]
  /** Shown top-left — the barcode or unique ID, so you know which lot you are looking at. */
  label: string
  index: number
  onIndex: (i: number) => void
  onClose: () => void
  resolveSrc?: (key: string) => string
}) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan]   = useState({ x: 0, y: 0 })
  // Refs, not state: these update on every pointer move and re-rendering mid-drag stutters.
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const pinchDist = useRef<number | null>(null)
  const stage = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const total = images.length

  // ⚠ Keep the picture on screen. An unbounded pan — easy to do with a flick on a tablet — throws
  // the photo out of the viewport and leaves a black screen with working controls, which looks
  // exactly like a photo that failed to load.
  const clampPan = useCallback((x: number, y: number, z: number) => {
    const el = stage.current
    if (!el || z <= 1) return { x: 0, y: 0 }
    const limitX = (el.clientWidth  * (z - 1)) / 2
    const limitY = (el.clientHeight * (z - 1)) / 2
    return {
      x: Math.max(-limitX, Math.min(limitX, x)),
      y: Math.max(-limitY, Math.min(limitY, y)),
    }
  }, [])

  // A new photo starts fresh — carrying the previous one's pan leaves you looking at empty space.
  const reset = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [])
  useEffect(() => { reset() }, [index, reset])

  // ⚠ Lock the page behind. Without this the lot list scrolls under the overlay while you zoom,
  // and you lose your place in a long review. (Calling preventDefault in the React onWheel does
  // NOT work — React attaches wheel passively at the root.)
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = prev }
  }, [])

  const setZoomAt = useCallback((next: number) => {
    const z = clampZoom(next)
    setZoom(z)
    setPan(p => clampPan(p.x, p.y, z))
  }, [clampPan])

  const step = useCallback((dir: 1 | -1) => {
    setZoom(z => {
      const i = ZOOM_STEPS.findIndex(s => s >= z - 0.001)
      const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir))]
      setPan(p => clampPan(p.x, p.y, next))
      return next
    })
  }, [clampPan])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
      else if (e.key === "ArrowRight" && total > 1) onIndex((index + 1) % total)
      else if (e.key === "ArrowLeft"  && total > 1) onIndex((index - 1 + total) % total)
      else if (e.key === "+" || e.key === "=") step(1)
      else if (e.key === "-") step(-1)
      else if (e.key === "0") reset()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [index, total, onIndex, onClose, step, reset])

  function onWheel(e: React.WheelEvent) { step(e.deltaY < 0 ? 1 : -1) }

  function onPointerDown(e: React.PointerEvent) {
    if (zoom === 1) return
    drag.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
    setDragging(true)
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    setPan(clampPan(d.panX + (e.clientX - d.x), d.panY + (e.clientY - d.y), zoom))
  }
  function onPointerUp() { drag.current = null; setDragging(false) }

  // ── Pinch to zoom ──────────────────────────────────────────────────────────
  // ⚠ The stage is touch-action: none so a one-finger drag pans instead of scrolling the page.
  // That also kills the browser's own pinch, so it has to be handled here or the first gesture
  // anybody reaches for on the iPads does nothing (RULES.md rule 5).
  function touchDist(t: React.TouchList) {
    const [a, b] = [t[0], t[1]]
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
  }
  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) pinchDist.current = touchDist(e.touches)
  }
  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length !== 2) return
    const dist = touchDist(e.touches)
    if (pinchDist.current != null && pinchDist.current > 0) {
      setZoomAt(zoom * (dist / pinchDist.current))
    }
    pinchDist.current = dist
  }
  function onTouchEnd() { pinchDist.current = null }

  const btn = "px-3 py-2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-sm font-semibold text-white/80 hover:text-white hover:bg-white/10 transition-colors"

  // ⚠ Never render an invisible open modal. Both callers currently guard on there being photos,
  // but a shared component cannot rely on that — a dead click with no feedback is design rule 7.
  if (total === 0) {
    return (
      <div className="fixed inset-0 z-[200] bg-black/90 flex flex-col items-center justify-center gap-4">
        <p className="text-white/70">No photos on this lot.</p>
        <button onClick={onClose} className={btn}>✕ Close</button>
      </div>
    )
  }

  const safe = Math.min(Math.max(index, 0), total - 1)

  return (
    // ⚠ NO click-to-close on this wrapper. A pan drag that starts on the image and releases over
    // the header or the thumbnail strip dispatches its click at the nearest common ancestor —
    // this element — so a backdrop handler here fires mid-pan and closes the viewer under you.
    // Close is the ✕ and Esc.
    <div className="fixed inset-0 z-[200] bg-black/90 flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 shrink-0 text-white/80">
        <button onClick={onClose} className={btn}>✕ Close</button>
        {label && <span className="font-mono text-sm text-white/60">{label}</span>}
        {total > 1 && <span className="text-sm text-white/60 tabular-nums">{safe + 1} / {total}</span>}
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => step(-1)} disabled={zoom <= 1} className={`${btn} disabled:opacity-30`} aria-label="Zoom out">−</button>
          <span className="text-sm tabular-nums w-14 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => step(1)} disabled={zoom >= MAX_ZOOM} className={`${btn} disabled:opacity-30`} aria-label="Zoom in">+</button>
          <button onClick={reset} className={btn}>Reset</button>
        </div>
      </div>

      <div
        ref={stage}
        className="flex-1 min-h-0 overflow-hidden flex items-center justify-center select-none touch-none"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onDoubleClick={() => (zoom === 1 ? step(1) : reset())}
        style={{ cursor: zoom > 1 ? (dragging ? "grabbing" : "grab") : "zoom-in" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={resolveSrc(images[safe])}
          alt={`${label || "Lot"} photo ${safe + 1}`}
          draggable={false}
          className="max-h-full max-w-full object-contain"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
            transition: dragging ? "none" : "transform 120ms ease-out",
            // ⚠ Zooming to read a product code is pointless if the browser smooths the pixels
            // into mush at 400%. Keep it crisp once you are past normal viewing.
            imageRendering: zoom >= 3 ? "pixelated" : "auto",
          }}
        />
      </div>

      {total > 1 && (
        <div className="shrink-0 flex gap-2 overflow-x-auto px-4 py-3">
          {images.map((key, i) => (
            <button
              key={i}
              onClick={() => onIndex(i)}
              className={`shrink-0 rounded-lg overflow-hidden border-2 transition ${
                i === safe ? "border-orange-500" : "border-transparent opacity-60 hover:opacity-100"
              }`}
            >
              {/* ⚠ lazy: the proxy streams the R2 ORIGINAL at full size, and a lot can carry 24
                  photos. Without this, opening one downloads every original to fill 64px boxes. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={resolveSrc(key)} alt={`Photo ${i + 1}`} loading="lazy" className="h-16 w-16 object-cover" />
            </button>
          ))}
        </div>
      )}

      <p className="shrink-0 text-center text-xs text-white/60 pb-3">
        Scroll, pinch or double-tap to zoom · drag to move{total > 1 ? " · arrow keys change photo" : ""} · Esc closes
      </p>
    </div>
  )
}
