"use client"

import { useEffect, useRef, useState } from "react"
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

// "Download all" into a folder the user picks — the File System Access API, which Chrome and Edge on
// a PC have and Safari and Firefox don't. Typed here because not every TypeScript DOM library has it.
type FileHandleLike = { createWritable(): Promise<WritableStream<Uint8Array>> }
type DirHandleLike  = { name: string; getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandleLike> }
type Picker = (opts?: { id?: string; mode?: "read" | "readwrite"; startIn?: string }) => Promise<DirHandleLike>

type Saving = { done: number; total: number; failed: string[]; folder: string | null; running: boolean; stopped: boolean }

const fileUrl = (key: string) => `/api/media/file?key=${encodeURIComponent(key)}`

/** A name not already in the folder (or used earlier in this batch) — "IMG_1.jpg", then "IMG_1 (2).jpg"… A
 *  file already in the folder is never overwritten: two customers' photos can easily share a name. */
async function freeName(dir: DirHandleLike, wanted: string, used: Set<string>): Promise<string> {
  const dot  = wanted.lastIndexOf(".")
  const stem = dot > 0 ? wanted.slice(0, dot) : wanted
  const ext  = dot > 0 ? wanted.slice(dot) : ""
  for (let n = 1; ; n++) {
    const name = n === 1 ? wanted : `${stem} (${n})${ext}`
    if (used.has(name.toLowerCase())) continue
    try {
      await dir.getFileHandle(name)   // it exists — try the next name
    } catch {
      used.add(name.toLowerCase())
      return name
    }
  }
}

export default function PhotoViewer({ imageUrls }: { imageUrls: string[] }) {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [video, setVideo] = useState<{ url: string; name: string; note?: string } | null>(null)
  // Images a browser can't show by itself — iPhone HEIC, scanner TIFF, camera RAW — are shown through
  // /api/media/view, which makes a JPEG copy the first time (a few seconds apiece, one at a time), so
  // their tiles fill in one by one (2026-09-15).
  const [convState, setConvState] = useState<Record<number, "ok" | "failed">>({})
  const [saving, setSaving] = useState<Saving | null>(null)
  const stopRef = useRef(false)

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

  /** Save every file into a folder the user picks. Photos a PC can't open come as JPEGs and videos as
   *  their playable copy (/api/media/file). One at a time, with a real count and a Stop. */
  async function downloadAll() {
    const picker = (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker
    stopRef.current = false

    // Safari, Firefox and the iPads can't pick a folder — each file downloads on its own instead.
    if (!picker) {
      setSaving({ done: 0, total: imageUrls.length, failed: [], folder: null, running: true, stopped: false })
      for (let n = 0; n < imageUrls.length; n++) {
        if (stopRef.current) break
        const a = document.createElement("a")
        a.href = fileUrl(imageUrls[n])
        a.download = ""
        document.body.appendChild(a)
        a.click()
        a.remove()
        setSaving(s => s && { ...s, done: n + 1 })
        await new Promise(r => setTimeout(r, 700)) // browsers refuse a burst of downloads
      }
      setSaving(s => s && { ...s, running: false, stopped: stopRef.current })
      return
    }

    let dir: DirHandleLike
    try {
      dir = await picker({ id: "submission-files", mode: "readwrite", startIn: "downloads" })
    } catch {
      return // they closed the folder picker
    }

    const used = new Set<string>()
    const failed: string[] = []
    setSaving({ done: 0, total: imageUrls.length, failed: [], folder: dir.name, running: true, stopped: false })
    for (let n = 0; n < imageUrls.length; n++) {
      if (stopRef.current) break
      const key = imageUrls[n]
      try {
        const res = await fetch(fileUrl(key))
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
        const wanted = decodeURIComponent(res.headers.get("X-File-Name") ?? "") || fileName(key)
        const handle = await dir.getFileHandle(await freeName(dir, wanted, used), { create: true })
        await res.body.pipeTo(await handle.createWritable())
      } catch {
        failed.push(fileName(key))
      }
      setSaving(s => s && { ...s, done: n + 1, failed: [...failed] })
    }
    setSaving(s => s && { ...s, running: false, stopped: stopRef.current })
  }

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
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-xs text-gray-400">
          Attachments ({imageUrls.length})
          {convTotal > 0 && convDone < convTotal && (
            <span className="text-amber-500"> · converting photos so they can be shown — {convDone} of {convTotal} done</span>
          )}
          {convFailed > 0 && (
            <span className="text-red-500"> · {convFailed} couldn&apos;t be converted — open the file from its tile</span>
          )}
        </p>
        {saving?.running ? (
          <span className="ml-auto flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
            {saving.folder ? `Saving ${saving.done} of ${saving.total} to “${saving.folder}”…` : `Downloading ${saving.done} of ${saving.total}…`}
            <button type="button" onClick={() => { stopRef.current = true }}
              className="min-h-[44px] rounded-lg border border-gray-300 dark:border-gray-700 px-3 font-semibold text-gray-700 dark:text-gray-300">
              Stop
            </button>
          </span>
        ) : (
          <button type="button" onClick={downloadAll} title="Save every file into a folder you pick"
            className="ml-auto min-h-[44px] rounded-lg border border-gray-300 dark:border-gray-700 px-3 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500">
            ⬇ Download all ({imageUrls.length})
          </button>
        )}
      </div>
      {saving && !saving.running && (
        <p className={`mb-2 text-xs ${saving.failed.length ? "text-red-500" : "text-green-600 dark:text-green-400"}`}>
          {saving.stopped
            ? `Stopped — ${saving.done - saving.failed.length} of ${saving.total} saved.`
            : saving.folder
              ? `✓ Saved ${saving.done - saving.failed.length} of ${saving.total} to “${saving.folder}”.`
              : `✓ Sent ${saving.done} downloads to your browser — check its downloads.`}
          {saving.failed.length > 0 && ` Couldn't save: ${saving.failed.join(", ")}.`}
          {saving.folder && " iPhone, TIFF and camera RAW photos are saved as JPEGs."}
        </p>
      )}
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
        // Every photo on this item, so the full-screen view can step through them (2026-09-15).
        <ZoomableLightbox
          src={lightbox}
          images={(entries ?? []).flatMap(({ url }, i) => {
            const key = imageUrls[i]
            if (isVideoKey(key)) return []
            if (needsJpegCopy(key)) return convState[i] === "failed" ? [] : [mediaViewUrl(key)]
            return isImage(key) ? [url] : []
          })}
          onClose={() => setLightbox(null)}
        />
      )}
      {video && (
        <VideoModal url={video.url} name={video.name} note={video.note} onClose={() => setVideo(null)} />
      )}
    </div>
  )
}
