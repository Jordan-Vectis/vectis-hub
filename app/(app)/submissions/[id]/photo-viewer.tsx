"use client"

import { useEffect, useState } from "react"
import ZoomableLightbox from "@/components/zoomable-lightbox"
import { VideoModal, VideoThumb } from "@/components/video-modal"
import { isVideoKey, mediaViewUrl, needsJpegCopy } from "@/lib/media"

type VideoState = "ready" | "original" | "converting" | "failed"
/** url = the signed original — or, for a video, the version a browser can play. */
type Entry = { url: string; videoState?: VideoState }

const VIDEO_NOTES: Partial<Record<VideoState, string>> = {
  converting: "A copy that plays in every browser is being made — it'll be ready in a few minutes. Until then this is the original, which some browsers can't play.",
  failed: "This video couldn't be converted to play here — open the file below to watch it.",
}

export default function PhotoViewer({ imageUrls }: { imageUrls: string[] }) {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [video, setVideo] = useState<{ url: string; name: string; note?: string } | null>(null)
  // Images a browser can't show by itself — iPhone HEIC, scanner TIFF, camera RAW — are shown through
  // /api/media/view, which makes a JPEG copy the first time (a few seconds apiece, one at a time), so
  // their tiles fill in one by one (2026-09-15).
  const [convState, setConvState] = useState<Record<number, "ok" | "failed">>({})

  useEffect(() => {
    if (imageUrls.length === 0) return
    Promise.all(
      imageUrls.map(async (key): Promise<Entry> => {
        if (isVideoKey(key)) {
          const d = await fetch(`/api/media/video?key=${encodeURIComponent(key)}`).then(r => r.json())
          return { url: d.url as string, videoState: d.state as VideoState }
        }
        const d = await fetch(`/api/image?key=${encodeURIComponent(key)}`).then(r => r.json())
        return { url: d.url as string }
      })
    ).then(setEntries)
  }, [imageUrls])

  if (imageUrls.length === 0) return null

  const isImage = (key: string) => /\.(jpe?g|png|gif|webp|avif|bmp)$/i.test(key)
  // Keys look like "submissions/<timestamp>-<original name>" — recover a display name.
  const fileName = (key: string) => decodeURIComponent(key.split("/").pop() ?? key).replace(/^\d+-/, "")

  const convTotal  = imageUrls.filter(needsJpegCopy).length
  const convDone   = Object.keys(convState).length
  const convFailed = Object.values(convState).filter(s => s === "failed").length
  const markConv   = (i: number, s: "ok" | "failed") => setConvState(prev => (prev[i] ? prev : { ...prev, [i]: s }))

  const fileLink = (url: string, key: string, i: number, note = "") => (
    <a
      key={i}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={fileName(key)}
      className="flex items-center gap-1 max-w-[10rem] text-xs text-blue-600 hover:text-blue-800 bg-gray-50 dark:bg-[#141416] border border-gray-200 dark:border-gray-800 rounded px-2 py-1"
    >
      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
      <span className="truncate">{fileName(key)}{note}</span>
    </a>
  )

  return (
    <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
      <p className="text-xs text-gray-400 mb-2">
        Attachments ({imageUrls.length})
        {convTotal > 0 && convDone < convTotal && (
          <span className="text-amber-500"> · converting photos so they can be shown — {convDone} of {convTotal} done</span>
        )}
        {convFailed > 0 && (
          <span className="text-red-500"> · {convFailed} couldn&apos;t be converted — open the file from its tile</span>
        )}
      </p>
      {!entries ? (
        <p className="text-xs text-gray-400">Loading...</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {entries.map(({ url, videoState }, i) => {
            const key = imageUrls[i]
            // Customer videos (2026-09-14) — a converted copy when the original won't play (2026-09-15).
            if (isVideoKey(key)) {
              const note = videoState ? VIDEO_NOTES[videoState] : undefined
              return (
                <VideoThumb
                  key={i}
                  url={url}
                  title={fileName(key)}
                  badge={videoState === "converting" ? "Preparing" : videoState === "failed" ? "Original" : undefined}
                  onClick={() => setVideo({ url, name: fileName(key), note })}
                />
              )
            }
            if (needsJpegCopy(key)) {
              if (convState[i] === "failed") return fileLink(url, key, i, " (can't preview)")
              const src = mediaViewUrl(key)
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setLightbox(src)}
                  title={fileName(key)}
                  className="relative w-20 h-20 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-[#141416] hover:opacity-80 transition-opacity"
                >
                  <img
                    src={src}
                    alt={`Photo ${i + 1}`}
                    onLoad={() => markConv(i, "ok")}
                    onError={() => markConv(i, "failed")}
                    className="w-full h-full object-cover"
                  />
                  {!convState[i] && (
                    <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/40">
                      <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span className="text-[10px] font-semibold text-white">Converting</span>
                    </span>
                  )}
                </button>
              )
            }
            return isImage(key) ? (
              <img
                key={i}
                src={url}
                alt={`Photo ${i + 1}`}
                onClick={() => setLightbox(url)}
                className="w-20 h-20 object-cover rounded-lg border border-gray-200 dark:border-gray-800 cursor-pointer hover:opacity-80 transition-opacity"
              />
            ) : fileLink(url, key, i)
          })}
        </div>
      )}

      {lightbox && (
        <ZoomableLightbox src={lightbox} onClose={() => setLightbox(null)} />
      )}
      {video && (
        <VideoModal url={video.url} name={video.name} note={video.note} onClose={() => setVideo(null)} />
      )}
    </div>
  )
}
