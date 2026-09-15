"use client"

import { useEffect, useState } from "react"
import ZoomableLightbox from "@/components/zoomable-lightbox"
import { VideoModal, VideoThumb } from "@/components/video-modal"
import { heicViewUrl, isHeicKey, isVideoKey } from "@/lib/media"

export default function PhotoViewer({ imageUrls }: { imageUrls: string[] }) {
  const [signedUrls, setSignedUrls] = useState<string[]>([])
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [video, setVideo] = useState<{ url: string; name: string } | null>(null)
  // iPhone photos (HEIC) are shown through /api/image/heic, which converts each to a JPEG the first
  // time — a few seconds apiece, one at a time — so their tiles fill in one by one (2026-09-15).
  const [heicState, setHeicState] = useState<Record<number, "ok" | "failed">>({})

  useEffect(() => {
    if (imageUrls.length === 0) return
    Promise.all(
      imageUrls.map((key) =>
        fetch(`/api/image?key=${encodeURIComponent(key)}`)
          .then((r) => r.json())
          .then((d) => d.url as string)
      )
    ).then(setSignedUrls)
  }, [imageUrls])

  if (imageUrls.length === 0) return null

  const isImage = (key: string) => /\.(jpe?g|png|gif|webp|heic|heif|tiff?|bmp)$/i.test(key)
  // Keys look like "submissions/<timestamp>-<original name>" — recover a display name.
  const fileName = (key: string) => decodeURIComponent(key.split("/").pop() ?? key).replace(/^\d+-/, "")

  const heicTotal  = imageUrls.filter(isHeicKey).length
  const heicDone   = Object.keys(heicState).length
  const heicFailed = Object.values(heicState).filter(s => s === "failed").length
  const markHeic   = (i: number, s: "ok" | "failed") => setHeicState(prev => (prev[i] ? prev : { ...prev, [i]: s }))

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
        {heicTotal > 0 && heicDone < heicTotal && (
          <span className="text-amber-500"> · converting iPhone photos so they can be shown — {heicDone} of {heicTotal} done</span>
        )}
        {heicFailed > 0 && (
          <span className="text-red-500"> · {heicFailed} couldn&apos;t be converted — open the file from its tile</span>
        )}
      </p>
      {signedUrls.length === 0 ? (
        <p className="text-xs text-gray-400">Loading...</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {signedUrls.map((url, i) => {
            const key = imageUrls[i]
            // Customer videos from the photo request link (2026-09-14) — the extension says which.
            if (isVideoKey(key)) {
              return <VideoThumb key={i} url={url} title={fileName(key)} onClick={() => setVideo({ url, name: fileName(key) })} />
            }
            if (isHeicKey(key)) {
              if (heicState[i] === "failed") return fileLink(url, key, i, " (can't preview)")
              const src = heicViewUrl(key)
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
                    onLoad={() => markHeic(i, "ok")}
                    onError={() => markHeic(i, "failed")}
                    className="w-full h-full object-cover"
                  />
                  {!heicState[i] && (
                    <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/40">
                      <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span className="text-[10px] font-semibold text-white">iPhone photo</span>
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
        <VideoModal url={video.url} name={video.name} onClose={() => setVideo(null)} />
      )}
    </div>
  )
}
