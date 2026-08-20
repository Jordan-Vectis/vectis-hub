"use client"

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"

// A draw-your-signature box.
//
// ⚠ components/induction-sign.tsx has its own copy of this canvas logic, written first. It is a
// legal record screen and was not worth disturbing to introduce a shared component — but if you
// are next in there, swap it onto this one rather than leaving two.
//
// The two non-obvious bits are both bugs that were found the hard way in the induction pad, and
// are kept here deliberately:
//   • a single DOT counts as a mark, or somebody whose signature is a short stab cannot submit
//     and has no idea why;
//   • the canvas is measured against its rendered size, so a CSS-scaled box still draws under
//     the pen rather than an inch away from it.

export type SignaturePadHandle = {
  /** PNG data URL, or null if nothing has been drawn. */
  toDataUrl: () => string | null
  clear: () => void
}

const SignaturePad = forwardRef<SignaturePadHandle, {
  /** Told whenever the pad goes from blank to marked, so the caller can enable Submit. */
  onInk?: (hasInk: boolean) => void
  className?: string
}>(function SignaturePad({ onInk, className = "" }, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing   = useRef(false)
  const last      = useRef<{ x: number; y: number } | null>(null)
  const [hasInk, setHasInk] = useState(false)

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) return
    ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round"
    ctx.strokeStyle = "#111827"; ctx.fillStyle = "#111827"
  }, [])

  function mark() {
    if (!hasInk) { setHasInk(true); onInk?.(true) }
  }

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault()
    canvasRef.current?.setPointerCapture(e.pointerId)
    drawing.current = true
    last.current = pos(e)
    const ctx = canvasRef.current?.getContext("2d")
    if (ctx && last.current) {
      ctx.beginPath(); ctx.arc(last.current.x, last.current.y, 1.25, 0, Math.PI * 2); ctx.fill()
    }
    mark()
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    e.preventDefault()
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx || !last.current) return
    const p = pos(e)
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke()
    last.current = p
    mark()
  }
  function up() { drawing.current = false; last.current = null }

  useImperativeHandle(ref, () => ({
    toDataUrl: () => (hasInk ? (canvasRef.current?.toDataURL("image/png") ?? null) : null),
    clear: () => {
      const c = canvasRef.current
      if (c) c.getContext("2d")?.clearRect(0, 0, c.width, c.height)
      setHasInk(false)
      onInk?.(false)
    },
  }), [hasInk, onInk])

  return (
    <canvas
      ref={canvasRef}
      width={900}
      height={260}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerLeave={up}
      // ⚠ touch-none, or on a tablet the page scrolls under the pen instead of drawing.
      className={`w-full h-40 rounded-xl bg-white border-2 border-dashed border-gray-300 dark:border-gray-600 touch-none cursor-crosshair ${className}`}
    />
  )
})

export default SignaturePad
