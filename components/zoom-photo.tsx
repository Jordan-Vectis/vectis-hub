"use client"

import { useState } from "react"
import { createPortal } from "react-dom"
import ZoomableLightbox from "@/components/zoomable-lightbox"

// A thumbnail that opens the Hub's own full-screen zoom viewer — for SERVER-rendered pages (the BC
// and ABC databases), which cannot hold the open/closed state themselves.
//
// ⚠ NOT a link to the file in a new browser tab (Jordan, 2026-09-18, after Website Search's "tap to
// open full size … opens really small"). The files were always full size — 4000 px, measured — but
// a raw storage tab is at the mercy of the browser: Chrome remembers a zoom level per address, his
// was at 25%, and a new tab on an iPad is clumsy anyway. components/zoomable-lightbox.tsx is the
// shared viewer (pinch, wheel, double-tap, drag); this is only the button in front of it.
//
// ⚠ The full-size file is fetched when the viewer OPENS, never before — a results page shows 100
// thumbnails, and preloading 100 × 300 KB to save one tap a moment's wait is the wrong trade.
export default function ZoomPhoto({ thumb, full, className }: {
  /** The small picture shown in the row. */
  thumb: string
  /** The best copy there is — what the viewer shows. Falls back to the thumbnail's own file. */
  full?: string | null
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Zoom in on the photo"
        style={{ touchAction: "manipulation" }} className="block cursor-zoom-in">
        <img src={thumb} alt="" loading="lazy" className={className ?? "h-14 w-14 object-cover rounded-md bg-gray-100 dark:bg-gray-800"} />
      </button>
      {/* Portalled to <body> so no table wrapper's overflow, transform or z-index can trap it. */}
      {open && typeof document !== "undefined" && createPortal(
        <ZoomableLightbox src={full || thumb} onClose={() => setOpen(false)} />,
        document.body,
      )}
    </>
  )
}
