"use client"

import { useState, useRef, useEffect } from "react"

// Full-screen image viewer with zoom + pan.
// Desktop: scroll wheel to zoom, double-click to toggle zoom, drag to pan.
// Touch: pinch to zoom, double-tap to toggle, one-finger drag to pan.
export default function ZoomableLightbox({
  src,
  onClose,
}: {
  src: string
  onClose: () => void
}) {
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number } | null>(null)
  const pinchDist = useRef<number | null>(null)

  const clamp = (s: number) => Math.min(Math.max(s, 1), 6)
  const reset = () => { setScale(1); setPos({ x: 0, y: 0 }) }

  // Reset when the image changes
  useEffect(() => { reset() }, [src])

  // ESC to close
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [onClose])

  function zoomBy(delta: number) {
    setScale((s) => {
      const next = clamp(s + delta)
      if (next === 1) setPos({ x: 0, y: 0 })
      return next
    })
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault()
    setScale((s) => {
      const next = clamp(s - e.deltaY * 0.0015 * s)
      if (next === 1) setPos({ x: 0, y: 0 })
      return next
    })
  }

  function onDoubleClick() {
    if (scale > 1) reset()
    else setScale(2.5)
  }

  // Pointer pan (mouse / pen / single touch)
  function onPointerDown(e: React.PointerEvent) {
    if (scale <= 1) return
    drag.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return
    setPos({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y })
  }
  function onPointerUp() { drag.current = null }

  // Two-finger pinch zoom
  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length !== 2) return
    const dx = e.touches[0].clientX - e.touches[1].clientX
    const dy = e.touches[0].clientY - e.touches[1].clientY
    const dist = Math.hypot(dx, dy)
    if (pinchDist.current != null) {
      setScale((s) => clamp(s * (dist / pinchDist.current!)))
    }
    pinchDist.current = dist
  }
  function onTouchEnd() { pinchDist.current = null }

  const btn = "w-9 h-9 flex items-center justify-center text-white text-xl rounded-full hover:bg-white/15 transition-colors"

  return (
    <div
      className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center select-none overflow-hidden"
      onClick={onClose}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
          cursor: scale > 1 ? "grab" : "zoom-in",
          transition: drag.current ? "none" : "transform 0.12s ease-out",
          touchAction: "none",
          maxWidth: "100%",
          maxHeight: "100%",
        }}
        className="object-contain rounded-lg"
      />

      {/* Controls */}
      <div
        className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-black/60 rounded-full px-2 py-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={() => zoomBy(-0.5)} className={btn} aria-label="Zoom out">−</button>
        <span className="text-white text-sm w-14 text-center tabular-nums">{Math.round(scale * 100)}%</span>
        <button onClick={() => zoomBy(0.5)} className={btn} aria-label="Zoom in">+</button>
        {scale > 1 && (
          <button onClick={reset} className="text-white text-xs px-3 py-1.5 rounded-full hover:bg-white/15 transition-colors">Reset</button>
        )}
      </div>

      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white text-3xl w-10 h-10 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 transition-colors"
        aria-label="Close"
      >
        &times;
      </button>
    </div>
  )
}
