"use client"

import { useRef, useState } from "react"

type Item = { id: string; name: string }
type UploadFile = { file: File; preview: string; key: string | null; uploading: boolean; error?: string }

export default function UploadClient({ token, items }: { token: string; items: Item[] }) {
  const [uploads, setUploads] = useState<Record<string, UploadFile[]>>(() =>
    Object.fromEntries(items.map(i => [i.id, []]))
  )
  const [saved, setSaved] = useState<Record<string, boolean>>({})
  const [done, setDone] = useState(false)
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

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
        const res = await fetch(`/api/public/submission/${token}/upload-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId, filename: uf.file.name, contentType: uf.file.type }),
        })
        const { url, key, error } = await res.json()
        if (!url) throw new Error(error ?? "Upload failed")

        await fetch(url, { method: "PUT", body: uf.file, headers: { "Content-Type": uf.file.type } })

        setItemUploads(itemId, prev =>
          prev.map(p => p.preview === uf.preview ? { ...p, key, uploading: false } : p)
        )
      } catch {
        setItemUploads(itemId, prev =>
          prev.map(p => p.preview === uf.preview ? { ...p, uploading: false, error: "Failed" } : p)
        )
      }
    }
  }

  async function handleDrop(itemId: string, e: React.DragEvent) {
    e.preventDefault()
    if (e.dataTransfer.files.length) handleFiles(itemId, e.dataTransfer.files)
  }

  async function handleSubmit() {
    let allOk = true
    for (const item of items) {
      const readyKeys = (uploads[item.id] ?? []).filter(u => u.key && !u.uploading).map(u => u.key!)
      if (readyKeys.length === 0) continue
      const res = await fetch(`/api/public/submission/${token}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, keys: readyKeys }),
      })
      if (!res.ok) allOk = false
      else setSaved(s => ({ ...s, [item.id]: true }))
    }
    if (allOk) setDone(true)
  }

  const anyUploading = Object.values(uploads).flat().some(u => u.uploading)
  const anyReady     = Object.values(uploads).flat().some(u => u.key)

  if (done) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-10 text-center max-w-sm w-full">
        <div className="text-4xl mb-3">✓</div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Photos received</h2>
        <p className="text-sm text-gray-500">Thank you — we'll be in touch with your valuation soon.</p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-lg space-y-5">
      {items.map(item => {
        const itemUploads = uploads[item.id] ?? []
        const isUploading = itemUploads.some(u => u.uploading)
        return (
          <div key={item.id} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
            {items.length > 1 && (
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{item.name}</p>
            )}

            {/* Drop zone */}
            <div
              onDrop={e => handleDrop(item.id, e)}
              onDragOver={e => e.preventDefault()}
              onClick={() => fileInputRefs.current[item.id]?.click()}
              className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition-colors select-none"
            >
              <div className="text-3xl mb-2">📷</div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Tap to choose photos</p>
              <p className="text-xs text-gray-400 mt-1">or drag and drop here</p>
              <input
                ref={el => { fileInputRefs.current[item.id] = el }}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={e => { if (e.target.files) handleFiles(item.id, e.target.files) }}
              />
            </div>

            {/* Thumbnails */}
            {itemUploads.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {itemUploads.map((u, i) => (
                  <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                    <img src={u.preview} alt="" className="w-full h-full object-cover" />
                    {u.uploading && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <span className="text-white text-xs">Uploading…</span>
                      </div>
                    )}
                    {u.error && (
                      <div className="absolute inset-0 bg-red-900/70 flex items-center justify-center">
                        <span className="text-white text-xs">Failed</span>
                      </div>
                    )}
                    {u.key && !u.uploading && (
                      <div className="absolute bottom-1 right-1 bg-green-500 rounded-full w-4 h-4 flex items-center justify-center">
                        <span className="text-white text-xs">✓</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {isUploading && (
              <p className="text-xs text-gray-400 mt-2">Uploading photos…</p>
            )}
          </div>
        )
      })}

      <button
        onClick={handleSubmit}
        disabled={!anyReady || anyUploading}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold text-sm py-3.5 rounded-xl transition-colors"
      >
        {anyUploading ? "Uploading…" : "Send photos to Vectis"}
      </button>

      <p className="text-center text-xs text-gray-400">
        Your photos are sent securely to Vectis Auctions.
      </p>
    </div>
  )
}
