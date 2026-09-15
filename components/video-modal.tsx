"use client"

import { useEffect, useState } from "react"

// Customer videos from a Submission's photo request link (2026-09-14). A small tile that shows the
// video's first frame with a play badge, and a pop-up player. A video browsers can't play gets a
// converted copy in the background (lib/video-convert.ts, 2026-09-15); until it's ready, and for any
// that can't be converted, the pop-up offers the file itself as well.

/** A 5rem square tile with the first frame, a ▶ badge and an optional status badge. */
export function VideoThumb({ url, title, badge, onClick }: { url: string; title?: string; badge?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ? `Play ${title}` : "Play video"}
      className="relative w-20 h-20 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-800 bg-black flex-shrink-0 hover:opacity-90 transition-opacity"
    >
      {/* #t=0.1 asks the browser for a frame just in, so the tile isn't blank */}
      <video src={`${url}#t=0.1`} muted playsInline preload="metadata" className="w-full h-full object-cover pointer-events-none" />
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="w-9 h-9 rounded-full bg-black/60 text-white flex items-center justify-center text-sm">▶</span>
      </span>
      <span className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] font-semibold px-1 rounded">Video</span>
      {badge && (
        <span className="absolute top-1 right-1 bg-amber-500 text-black text-[9px] font-bold px-1 rounded">{badge}</span>
      )}
    </button>
  )
}

/** Full-screen player. Click outside the video or press Esc to close. `note` explains a video that
 *  is still being converted, or couldn't be. */
export function VideoModal({ url, name, note, onClose }: { url: string; name?: string; note?: string; onClose: () => void }) {
  const [cantPlay, setCantPlay] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-5xl flex flex-col items-center gap-3" onClick={e => e.stopPropagation()}>
        <video
          src={url}
          controls
          autoPlay
          playsInline
          onError={() => setCantPlay(true)}
          className="max-h-[75vh] max-w-full rounded-lg bg-black"
        />
        {note && <p className="text-amber-300 text-sm text-center max-w-lg">{note}</p>}
        {cantPlay && !note && (
          <p className="text-amber-300 text-sm text-center max-w-lg">
            This browser can&apos;t play this video&apos;s format. Open the file below instead.
          </p>
        )}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-[44px] inline-flex items-center px-4 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-semibold"
          >
            ⬇ Open the video file{name ? ` (${name})` : ""}
          </a>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-5 rounded-xl bg-white text-gray-900 text-sm font-semibold hover:bg-gray-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
