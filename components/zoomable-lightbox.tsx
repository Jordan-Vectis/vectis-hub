"use client"

import { useState, useRef, useEffect } from "react"

// Full-screen image viewer with zoom + pan — and, when given the whole set in `images`, a way to step
// through them without closing (Jordan, 2026-09-15).
// Desktop: scroll wheel to zoom, double-click to toggle zoom, drag to pan; the ‹ › buttons or the ← →
//          keys for the previous / next photo.
// Touch:   pinch to zoom, double-tap to toggle, one-finger drag to pan; swipe left / right (when not
//          zoomed in) for the next / previous photo.
export default function ZoomableLightbox({
  src,
  images,
  onClose,
}: {
  src: string
  /** Every photo in the set, in order, with `src` among them. Leave it out for a single photo. */
  images?: string[]
  onClose: () => void
}) {
  const list = images && images.length > 1 && images.includes(src) ? images : null
  // Follows the photo, not its position — if the set changes while open (a photo that couldn't be
  // converted drops out), the one on screen stays on screen.
  const [current, setCurrent] = useState(src)
  const index = list ? Math.max(0, list.indexOf(current)) : 0
  const shown = list ? list[index] : src

  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number } | null>(null)
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const pinchDist = useRef<number | null>(null)

  const clamp = (s: number) => Math.min(Math.max(s, 1), 6)
  const reset = () => { setScale(1); setPos({ x: 0, y: 0 }) }

  /** Previous (-1) or next (+1), wrapping round at either end. */
  const go = (step: number) => {
    if (!list) return
    setCurrent(list[(index + step + list.length) % list.length])
  }
  const goRef = useRef(go)
  goRef.current = go

  // Back to fit-to-screen whenever the photo changes
  useEffect(() => { reset() }, [shown])

  // Fetch the photos either side, so the next one is already there when it's asked for.
  useEffect(() => {
    if (!list) return
    for (const u of [list[(index + 1) % list.length], list[(index - 1 + list.length) % list.length]]) {
      const img = new Image()
      img.src = u
    }
  }, [list, index])

  // ESC to close, ← → to move between photos
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      else if (e.key === "ArrowRight") goRef.current(1)
      else if (e.key === "ArrowLeft") goRef.current(-1)
    }
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

  // Pointer pan when zoomed in (mouse / pen / single touch); a swipe to change photo when not.
  function onPointerDown(e: React.PointerEvent) {
    if (scale <= 1) {
      swipe.current = { x: e.clientX, y: e.clientY }
      return
    }
    drag.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return
    setPos({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y })
  }
  function onPointerUp(e: React.PointerEvent) {
    drag.current = null
    const start = swipe.current
    swipe.current = null
    if (!start || scale > 1) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1)
  }

  // Two-finger pinch zoom
  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length !== 2) return
    swipe.current = null // a pinch is never a swipe
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
  const arrow = "absolute top-1/2 -translate-y-1/2 w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white text-4xl leading-none transition-colors"

  return (
    <div
      className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center select-none overflow-hidden"
      onClick={onClose}
    >
      <img
        src={shown}
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

      {list && (
        <>
          <button onClick={(e) => { e.stopPropagation(); go(-1) }} className={`${arrow} left-2 sm:left-4`} aria-label="Previous photo">‹</button>
          <button onClick={(e) => { e.stopPropagation(); go(1) }} className={`${arrow} right-2 sm:right-4`} aria-label="Next photo">›</button>
          <span
            className="absolute top-5 left-1/2 -translate-x-1/2 bg-black/60 text-white text-sm rounded-full px-3 py-1 tabular-nums"
            onClick={(e) => e.stopPropagation()}
          >
            {index + 1} / {list.length}
          </span>
        </>
      )}

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
