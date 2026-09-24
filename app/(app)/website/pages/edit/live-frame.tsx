"use client"

import { useEffect, useRef, useState } from "react"

// How the editor shows a LIVE block: the site's own render of it (/site-block), in a frame that
// grows to fit. Live blocks read the database, which the editor in the browser can't — so rather
// than a look-alike, the canvas shows the real thing. The frame ignores the mouse, so a click
// selects the block instead of following a link inside it.
//
// Settings typed into the block reload the frame after a short pause, not on every key.

const strip = (p: Record<string, unknown>) => {
  const { puck: _p, id: _i, editMode: _e, ...rest } = p
  return rest
}

export default function LiveFrame({ type, label, props }: { type: string; label: string; props: Record<string, unknown> }) {
  const target = `/site-block?type=${encodeURIComponent(type)}&p=${encodeURIComponent(JSON.stringify(strip(props)))}`
  const [src, setSrc] = useState(target)
  useEffect(() => {
    if (target === src) return
    const t = setTimeout(() => setSrc(target), 700)
    return () => clearTimeout(t)
  }, [target, src])

  const frame = useRef<HTMLIFrameElement>(null)
  const watcher = useRef<ResizeObserver | null>(null)
  const [height, setHeight] = useState(140)
  const [loading, setLoading] = useState(true)
  const [empty, setEmpty] = useState(false)
  useEffect(() => { setLoading(true) }, [src])
  useEffect(() => () => watcher.current?.disconnect(), [])

  function onLoad() {
    setLoading(false)
    const win = frame.current?.contentWindow as (Window & { ResizeObserver?: typeof ResizeObserver }) | null | undefined
    const el = frame.current?.contentDocument?.getElementById("site-block-root")
    if (!win || !el) { setEmpty(false); return }
    const measure = () => {
      const h = Math.ceil(el.getBoundingClientRect().height)
      setEmpty(h < 8)
      setHeight(Math.max(h, 8))
    }
    measure()
    watcher.current?.disconnect()
    const RO = win.ResizeObserver ?? ResizeObserver
    watcher.current = new RO(measure)
    watcher.current.observe(el)
  }

  return (
    <div className="relative">
      {/* Bottom-right and see-through: at the top it sat over the block's own "See more" links. */}
      <span className="absolute bottom-1.5 right-1.5 z-10 rounded bg-[#2AB4A6]/85 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow pointer-events-none">
        Live · {label}
      </span>
      <iframe
        ref={frame}
        src={src}
        title={label}
        onLoad={onLoad}
        style={{ display: "block", width: "100%", height, border: 0, pointerEvents: "none", background: "transparent" }}
      />
      {empty && !loading && (
        <div className="border-2 border-dashed border-[#2AB4A6]/50 bg-[#2AB4A6]/5 px-4 py-6 text-center text-sm text-gray-500">
          Nothing to show here right now (for example, no sales coming up) — on the site it takes no space.
        </div>
      )}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-xs font-semibold text-gray-500" style={{ minHeight: 60 }}>
          Loading the live block…
        </div>
      )}
    </div>
  )
}
