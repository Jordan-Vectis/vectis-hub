"use client"

import { useRef, useState } from "react"

type Item = { id: string; name: string }
type UploadFile = { file: File; preview: string; key: string | null; uploading: boolean; error?: string }
type Step = "intro" | number | "send" | "done"

export default function UploadClient({ token, items }: { token: string; items: Item[] }) {
  const [step, setStep] = useState<Step>("intro")
  const [uploads, setUploads] = useState<Record<string, UploadFile[]>>(() =>
    Object.fromEntries(items.map(i => [i.id, []]))
  )
  const [sending, setSending] = useState(false)
  const cameraRefs  = useRef<Record<string, HTMLInputElement | null>>({})
  const galleryRefs = useRef<Record<string, HTMLInputElement | null>>({})

  function setItemUploads(itemId: string, fn: (prev: UploadFile[]) => UploadFile[]) {
    setUploads(u => ({ ...u, [itemId]: fn(u[itemId] ?? []) }))
  }

  async function handleFiles(itemId: string, files: FileList) {
    const newFiles = Array.from(files).map(file => ({
      file,
      preview: URL.createObjectURL(file),
      key: null,
      uploading: true,
    }))
    setItemUploads(itemId, prev => [...prev, ...newFiles])

    for (const uf of newFiles) {
      try {
        const ct = uf.file.type || "image/jpeg"
        const name = uf.file.name || "photo.jpg"
        const res = await fetch(`/api/public/submission/${token}/upload-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId, filename: name, contentType: ct }),
        })
        const { url, key, error } = await res.json()
        if (!url) throw new Error(error ?? "Upload failed")

        await fetch(url, { method: "PUT", body: uf.file, headers: { "Content-Type": ct } })

        setItemUploads(itemId, prev =>
          prev.map(p => p.preview === uf.preview ? { ...p, key, uploading: false } : p)
        )
      } catch {
        setItemUploads(itemId, prev =>
          prev.map(p => p.preview === uf.preview ? { ...p, uploading: false, error: "Failed — please try again" } : p)
        )
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

  const totalPhotos  = Object.values(uploads).flat().filter(u => u.key).length
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
          <h2 className="text-2xl font-bold text-gray-900 mb-3">Photos Received!</h2>
          <p className="text-gray-600 text-base leading-relaxed mb-2">
            Thank you — we have received your photos.
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
              <span className="text-xl flex-shrink-0">🔒</span>
              <p className="text-gray-600 text-sm leading-relaxed">
                Your photos are sent securely and only seen by the Vectis team.
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
    const readyCount  = itemUploads.filter(u => u.key).length
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
          <h2 className="text-xl font-bold text-gray-900 mb-1">{item.name}</h2>
          <p className="text-gray-500 text-sm mb-6 leading-relaxed">
            Take photos from different angles — front, back, top, and any labels or markings.
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
              onChange={e => { if (e.target.files?.length) handleFiles(item.id, e.target.files) }}
            />
            <input
              ref={el => { galleryRefs.current[item.id] = el }}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={e => { if (e.target.files?.length) handleFiles(item.id, e.target.files) }}
            />
          </div>

          {/* Thumbnails */}
          {itemUploads.length > 0 && (
            <>
              <p className="text-sm font-semibold text-gray-600 mb-2">
                {readyCount} photo{readyCount !== 1 ? "s" : ""} added
                {isUploading ? " — uploading…" : " — ready ✓"}
              </p>
              <div className="flex flex-wrap gap-2">
                {itemUploads.map((u, i) => (
                  <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden border-2 border-gray-100">
                    <img src={u.preview} alt="" className="w-full h-full object-cover" />
                    {u.uploading && (
                      <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-1">
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
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
            </>
          )}
        </div>

        <button
          onClick={() => setStep(isLast ? "send" : step + 1)}
          disabled={isUploading}
          className="w-full bg-gray-900 hover:bg-gray-800 active:bg-black text-white font-bold text-lg py-5 rounded-2xl transition-colors disabled:opacity-40"
        >
          {readyCount > 0
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
          {items.map(item => {
            const count = (uploads[item.id] ?? []).filter(u => u.key).length
            return (
              <div key={item.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <span className="text-gray-800 font-medium text-sm">{item.name}</span>
                <span className={`text-sm font-semibold ${count > 0 ? "text-green-600" : "text-gray-400"}`}>
                  {count > 0 ? `${count} photo${count !== 1 ? "s" : ""} ✓` : "No photos"}
                </span>
              </div>
            )
          })}
        </div>

        {totalPhotos === 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-amber-800 text-sm font-medium">No photos added yet.</p>
            <p className="text-amber-700 text-sm mt-1">Go back and add some photos before sending.</p>
          </div>
        )}

        {totalPhotos > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <p className="text-green-800 text-sm font-semibold">
              {totalPhotos} photo{totalPhotos !== 1 ? "s" : ""} ready to send
            </p>
          </div>
        )}
      </div>

      <button
        onClick={handleSend}
        disabled={anyUploading || sending || totalPhotos === 0}
        className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold text-xl py-5 rounded-2xl transition-colors disabled:opacity-40 mb-3"
      >
        {sending ? "Sending your photos…" : "Send Photos to Vectis →"}
      </button>

      <button
        onClick={() => setStep(items.length - 1)}
        className="w-full text-gray-400 font-medium text-base py-3"
      >
        ← Go back and add more photos
      </button>

      <p className="text-center text-xs text-gray-400 mt-2">
        Your photos are sent securely to Vectis Auctions.
      </p>
    </div>
  )
}
