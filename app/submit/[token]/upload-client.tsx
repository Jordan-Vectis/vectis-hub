"use client"

import { useRef, useState } from "react"
import { isVideoKey } from "@/lib/media"

type Item = { id: string; name: string }
type UploadFile = {
  file: File
  preview: string
  isVideo: boolean
  key: string | null
  uploading: boolean
  progress: number   // 0–100, from the upload itself — a video can take minutes on mobile data
  error?: string
}
type Step = "intro" | number | "send" | "done"

/** "3 photos and 1 video" */
function describe(photos: number, videos: number): string {
  const parts: string[] = []
  if (photos) parts.push(`${photos} photo${photos !== 1 ? "s" : ""}`)
  if (videos) parts.push(`${videos} video${videos !== 1 ? "s" : ""}`)
  return parts.join(" and ")
}

function countReady(list: UploadFile[]) {
  const ready = list.filter(u => u.key)
  return { photos: ready.filter(u => !u.isVideo).length, videos: ready.filter(u => u.isVideo).length, total: ready.length }
}

/** PUT straight to storage with a real percentage. ⚠ A refused upload REJECTS — the old fetch
 *  resolved on any answer, so a failed upload still showed a green tick. */
function putWithProgress(url: string, file: File, contentType: string, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", url)
    xhr.setRequestHeader("Content-Type", contentType)
    let last = -1
    xhr.upload.onprogress = e => {
      if (!e.lengthComputable) return
      const pct = Math.min(99, Math.floor((e.loaded / e.total) * 100))
      if (pct !== last) { last = pct; onProgress(pct) }
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)))
    xhr.onerror = () => reject(new Error("Upload failed"))
    xhr.send(file)
  })
}

export default function UploadClient({ token, items }: { token: string; items: Item[] }) {
  const [step, setStep] = useState<Step>("intro")
  const [uploads, setUploads] = useState<Record<string, UploadFile[]>>(() =>
    Object.fromEntries(items.map(i => [i.id, []]))
  )
  const [sending, setSending] = useState(false)
  const cameraRefs  = useRef<Record<string, HTMLInputElement | null>>({})
  const videoRefs   = useRef<Record<string, HTMLInputElement | null>>({})
  const galleryRefs = useRef<Record<string, HTMLInputElement | null>>({})

  function setItemUploads(itemId: string, fn: (prev: UploadFile[]) => UploadFile[]) {
    setUploads(u => ({ ...u, [itemId]: fn(u[itemId] ?? []) }))
  }

  async function handleFiles(itemId: string, files: FileList) {
    const newFiles: UploadFile[] = Array.from(files).map(file => ({
      file,
      preview: URL.createObjectURL(file),
      isVideo: file.type.startsWith("video/") || isVideoKey(file.name || ""),
      key: null,
      uploading: true,
      progress: 0,
    }))
    setItemUploads(itemId, prev => [...prev, ...newFiles])

    for (const uf of newFiles) {
      const patch = (p: Partial<UploadFile>) =>
        setItemUploads(itemId, prev => prev.map(x => x.preview === uf.preview ? { ...x, ...p } : x))
      try {
        const name = uf.file.name || (uf.isVideo ? "video.mp4" : "photo.jpg")
        const res = await fetch(`/api/public/submission/${token}/upload-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId, filename: name, contentType: uf.file.type }),
        })
        const { url, key, contentType, error } = await res.json()
        if (!url) throw new Error(error ?? "Upload failed")

        // ⚠ Send the type the server signed, not the file's own — a mismatch is refused.
        await putWithProgress(url, uf.file, contentType || uf.file.type || "image/jpeg", pct => patch({ progress: pct }))
        patch({ key, uploading: false, progress: 100 })
      } catch {
        patch({ uploading: false, error: "Failed — please try again" })
      }
    }
  }

  async function handleSend() {
    setSending(true)
    let allOk = true
    for (const item of items) {
      const readyKeys = (uploads[item.id] ?? []).filter(u => u.key).map(u => u.key!)
      if (readyKeys.length === 0) continue
      const res = await fetch(`/api/public/submission/${token}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, keys: readyKeys }),
      })
      if (!res.ok) allOk = false
    }
    setSending(false)
    if (allOk) setStep("done")
  }

  const totals       = countReady(Object.values(uploads).flat())
  const anyUploading = Object.values(uploads).flat().some(u => u.uploading)
  const totalSteps   = items.length + 2 // intro + items + send

  function StepDots({ current }: { current: number }) {
    return (
      <div className="flex items-center justify-center gap-2 mb-6">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            className={`rounded-full transition-all ${
              i === current ? "w-6 h-3 bg-blue-600" : i < current ? "w-3 h-3 bg-blue-300" : "w-3 h-3 bg-gray-200"
            }`}
          />
        ))}
      </div>
    )
  }

  // DONE
  if (step === "done") {
    return (
      <div className="w-full max-w-sm mx-auto">
        <div className="bg-white rounded-3xl border border-gray-100 p-10 text-center shadow-sm">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <span className="text-4xl">✅</span>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">Thank you!</h2>
          <p className="text-gray-600 text-base leading-relaxed mb-2">
            We have received your {describe(totals.photos, totals.videos)}.
          </p>
          <p className="text-gray-500 text-base leading-relaxed">
            We will be in touch soon.
          </p>
          <p className="text-sm text-gray-400 mt-6">You can now close this page.</p>
        </div>
      </div>
    )
  }

  // INTRO
  if (step === "intro") {
    return (
      <div className="w-full max-w-sm mx-auto">
        <StepDots current={0} />
        <div className="bg-white rounded-3xl border border-gray-100 p-8 shadow-sm">
          <div className="text-center mb-6">
            <div className="text-6xl mb-4">📸</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">Let's send your photos</h2>
            <p className="text-gray-600 text-base leading-relaxed">
              We'll walk you through it step by step. It only takes a few minutes.
            </p>
          </div>

          <div className="bg-gray-50 rounded-2xl p-4 mb-6 space-y-3">
            <div className="flex items-start gap-3">
              <span className="text-xl flex-shrink-0">💡</span>
              <p className="text-gray-600 text-sm leading-relaxed">
                Good photos from different angles help us give you the most accurate valuation.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-xl flex-shrink-0">🎥</span>
              <p className="text-gray-600 text-sm leading-relaxed">
                You can send short videos too.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-xl flex-shrink-0">🔒</span>
              <p className="text-gray-600 text-sm leading-relaxed">
                Your photos and videos are sent securely and only seen by the Vectis team.
              </p>
            </div>
          </div>

          <button
            onClick={() => setStep(0)}
            className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold text-xl py-5 rounded-2xl transition-colors"
          >
            Get Started →
          </button>
        </div>
      </div>
    )
  }

  // ITEM STEP
  if (typeof step === "number") {
    const item = items[step]
    const itemUploads = uploads[item.id] ?? []
    const isUploading = itemUploads.some(u => u.uploading)
    const ready       = countReady(itemUploads)
    const isLast      = step === items.length - 1

    return (
      <div className="w-full max-w-sm mx-auto">
        <StepDots current={step + 1} />

        <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm mb-4">
          {items.length > 1 && (
            <p className="text-sm font-semibold text-blue-600 uppercase tracking-wide mb-1">
              Item {step + 1} of {items.length}
            </p>
          )}
          <h2 className="text-xl font-bold text-gray-900 mb-1">Add photos or videos</h2>
          <p className="text-gray-500 text-sm mb-6 leading-relaxed">
            Take photos from different angles — front, back, top, and any labels or markings. A short video is welcome too.
          </p>

          {/* Primary buttons */}
          <div className="space-y-3 mb-5">
            <button
              onClick={() => cameraRefs.current[item.id]?.click()}
              className="w-full flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold text-lg py-5 rounded-2xl transition-colors"
            >
              <span className="text-2xl">📷</span>
              <span>Take a Photo</span>
            </button>
            <button
              onClick={() => videoRefs.current[item.id]?.click()}
              className="w-full flex items-center justify-center gap-3 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 text-blue-800 font-bold text-lg py-5 rounded-2xl transition-colors"
            >
              <span className="text-2xl">🎥</span>
              <span>Record a Video</span>
            </button>
            <button
              onClick={() => galleryRefs.current[item.id]?.click()}
              className="w-full flex items-center justify-center gap-3 bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-800 font-bold text-lg py-5 rounded-2xl transition-colors"
            >
              <span className="text-2xl">🖼️</span>
              <span>Choose from Gallery</span>
            </button>

            {/* Hidden inputs */}
            <input
              ref={el => { cameraRefs.current[item.id] = el }}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={e => { if (e.target.files?.length) handleFiles(item.id, e.target.files); e.target.value = "" }}
            />
            <input
              ref={el => { videoRefs.current[item.id] = el }}
              type="file"
              accept="video/*"
              capture="environment"
              className="hidden"
              onChange={e => { if (e.target.files?.length) handleFiles(item.id, e.target.files); e.target.value = "" }}
            />
            <input
              ref={el => { galleryRefs.current[item.id] = el }}
              type="file"
              accept="image/*,video/*"
              multiple
              className="hidden"
              onChange={e => { if (e.target.files?.length) handleFiles(item.id, e.target.files); e.target.value = "" }}
            />
          </div>

          {/* Thumbnails */}
          {itemUploads.length > 0 && (
            <>
              <p className="text-sm font-semibold text-gray-600 mb-2">
                {ready.total === 0
                  ? (isUploading ? "Uploading…" : "Nothing added yet")
                  : `${describe(ready.photos, ready.videos)} added${isUploading ? " — still uploading…" : " — ready ✓"}`}
              </p>
              <div className="flex flex-wrap gap-2">
                {itemUploads.map((u, i) => (
                  <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden border-2 border-gray-100 bg-gray-900">
                    {u.isVideo ? (
                      <>
                        <video src={`${u.preview}#t=0.1`} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                        <span className="absolute top-1 left-1 bg-black/60 text-white text-[10px] font-bold px-1 rounded">🎥 Video</span>
                      </>
                    ) : (
                      <img src={u.preview} alt="" className="w-full h-full object-cover" />
                    )}
                    {u.uploading && (
                      <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-1">
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span className="text-white text-xs font-bold">{u.progress}%</span>
                      </div>
                    )}
                    {u.error && (
                      <div className="absolute inset-0 bg-red-700/80 flex items-center justify-center p-1">
                        <span className="text-white text-xs text-center font-semibold">Failed</span>
                      </div>
                    )}
                    {u.key && !u.uploading && (
                      <div className="absolute inset-0 flex items-end justify-end p-1">
                        <div className="bg-green-500 rounded-full w-6 h-6 flex items-center justify-center">
                          <span className="text-white text-xs font-bold">✓</span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {itemUploads.some(u => u.error) && (
                <p className="text-sm text-red-600 mt-2">
                  Anything marked Failed didn&apos;t send — please add it again.
                </p>
              )}
            </>
          )}
        </div>

        <button
          onClick={() => setStep(isLast ? "send" : step + 1)}
          disabled={isUploading}
          className="w-full bg-gray-900 hover:bg-gray-800 active:bg-black text-white font-bold text-lg py-5 rounded-2xl transition-colors disabled:opacity-40"
        >
          {isUploading
            ? "Please wait — still uploading…"
            : ready.total > 0
              ? isLast
                ? `Next — Review & Send →`
                : `Next →`
              : isLast
                ? `Continue without photos →`
                : `Skip this item →`
          }
        </button>

        {step > 0 && (
          <button
            onClick={() => setStep(step - 1)}
            className="w-full text-gray-400 font-medium text-base py-3 mt-1"
          >
            ← Back
          </button>
        )}
      </div>
    )
  }

  // SEND STEP
  return (
    <div className="w-full max-w-sm mx-auto">
      <StepDots current={totalSteps - 1} />

      <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm mb-4">
        <h2 className="text-xl font-bold text-gray-900 mb-1">Ready to send</h2>
        <p className="text-gray-500 text-sm mb-5">Here's a summary of what you're sending to Vectis Auctions:</p>

        <div className="space-y-3 mb-4">
          {items.map((item, i) => {
            const c = countReady(uploads[item.id] ?? [])
            return (
              <div key={item.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <span className="text-gray-800 font-medium text-sm">{items.length > 1 ? `Item ${i + 1}` : "Your item"}</span>
                <span className={`text-sm font-semibold ${c.total > 0 ? "text-green-600" : "text-gray-400"}`}>
                  {c.total > 0 ? `${describe(c.photos, c.videos)} ✓` : "Nothing added"}
                </span>
              </div>
            )
          })}
        </div>

        {totals.total === 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-amber-800 text-sm font-medium">Nothing added yet.</p>
            <p className="text-amber-700 text-sm mt-1">Go back and add some photos or videos before sending.</p>
          </div>
        )}

        {totals.total > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <p className="text-green-800 text-sm font-semibold">
              {describe(totals.photos, totals.videos)} ready to send
            </p>
          </div>
        )}
      </div>

      <button
        onClick={handleSend}
        disabled={anyUploading || sending || totals.total === 0}
        className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold text-xl py-5 rounded-2xl transition-colors disabled:opacity-40 mb-3"
      >
        {sending ? "Sending…" : "Send to Vectis →"}
      </button>

      <button
        onClick={() => setStep(items.length - 1)}
        className="w-full text-gray-400 font-medium text-base py-3"
      >
        ← Go back and add more
      </button>

      <p className="text-center text-xs text-gray-400 mt-2">
        Everything is sent securely to Vectis Auctions.
      </p>
    </div>
  )
}
