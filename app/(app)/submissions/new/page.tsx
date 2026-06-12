"use client"

import { useState, useRef, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { createSubmission } from "@/lib/actions/submissions"

type Photo = { file: File; preview: string; key: string | null; uploading: boolean }
type Item  = { name: string; description: string; photos: Photo[] }

export default function NewSubmissionPage() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [items, setItems] = useState<Item[]>([{ name: "", description: "", photos: [] }])
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({})

  function addItem() {
    setItems(prev => [...prev, { name: "", description: "", photos: [] }])
  }

  function removeItem(index: number) {
    setItems(prev => prev.filter((_, i) => i !== index))
  }

  function updateItem(index: number, field: "name" | "description", value: string) {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item))
  }

  async function handlePhotoFiles(index: number, files: FileList) {
    const newPhotos: Photo[] = Array.from(files).map(file => ({
      file,
      preview: URL.createObjectURL(file),
      key: null,
      uploading: true,
    }))

    setItems(prev => prev.map((item, i) => i === index
      ? { ...item, photos: [...item.photos, ...newPhotos] }
      : item
    ))

    for (const photo of newPhotos) {
      try {
        const res = await fetch("/api/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: photo.file.name, contentType: photo.file.type, size: photo.file.size }),
        })
        const { url, key } = await res.json()
        await fetch(url, { method: "PUT", body: photo.file, headers: { "Content-Type": photo.file.type } })

        setItems(prev => prev.map((item, i) => i === index
          ? { ...item, photos: item.photos.map(p => p.preview === photo.preview ? { ...p, key, uploading: false } : p) }
          : item
        ))
      } catch {
        setItems(prev => prev.map((item, i) => i === index
          ? { ...item, photos: item.photos.map(p => p.preview === photo.preview ? { ...p, uploading: false } : p) }
          : item
        ))
      }
    }
  }

  function removePhoto(itemIndex: number, photoPreview: string) {
    setItems(prev => prev.map((item, i) => i === itemIndex
      ? { ...item, photos: item.photos.filter(p => p.preview !== photoPreview) }
      : item
    ))
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const formData = new FormData(form)

    items.forEach((item, i) => {
      formData.append("itemName", item.name)
      formData.append("itemDescription", item.description)
      item.photos.filter(p => p.key).forEach(p => {
        formData.append(`item_${i}_imageKey`, p.key!)
      })
    })

    startTransition(async () => {
      const result = await createSubmission(formData)
      router.push(`/submissions/${result.id}`)
    })
  }

  const anyUploading = items.some(item => item.photos.some(p => p.uploading))

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <Link href="/submissions" className="text-sm text-gray-400 hover:text-gray-600 mb-1 block">
          &larr; Back to submissions
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">New Submission</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Customer details */}
        <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-4">Customer Details</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Full name *</label>
              <input
                name="customerName"
                required
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
                <input
                  name="customerEmail"
                  type="email"
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone</label>
                <input
                  name="customerPhone"
                  type="tel"
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Submission details */}
        <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-4">Submission Details</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">How did they contact us? *</label>
              <select
                name="channel"
                required
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select channel...</option>
                <option value="EMAIL">Email</option>
                <option value="WEB_FORM">Web Form</option>
                <option value="PHONE">Phone</option>
                <option value="WALK_IN">Walk-in</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
              <textarea
                name="notes"
                rows={3}
                placeholder="Any general notes about this submission..."
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
          </div>
        </section>

        {/* Items */}
        <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-4">Items</h2>
          <div className="space-y-4">
            {items.map((item, index) => (
              <div key={index} className="border border-gray-100 dark:border-gray-700 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-500">Item {index + 1}</span>
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeItem(index)}
                      className="text-xs text-red-400 hover:text-red-600"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  <input
                    placeholder="Item name (e.g. Corgi Toy Batmobile) *"
                    value={item.name}
                    onChange={(e) => updateItem(index, "name", e.target.value)}
                    required
                    className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <textarea
                    placeholder="Description (condition, any markings, box present, etc.)"
                    value={item.description}
                    onChange={(e) => updateItem(index, "description", e.target.value)}
                    rows={2}
                    className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />

                  {/* Photo upload */}
                  <div>
                    {item.photos.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {item.photos.map((photo, pi) => (
                          <div key={pi} className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 group">
                            <img src={photo.preview} alt="" className="w-full h-full object-cover" />
                            {photo.uploading && (
                              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                <span className="text-white text-xs">…</span>
                              </div>
                            )}
                            {!photo.uploading && (
                              <button
                                type="button"
                                onClick={() => removePhoto(index, photo.preview)}
                                className="absolute inset-0 bg-black/0 group-hover:bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                              >
                                <span className="text-white text-sm font-bold">✕</span>
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => fileInputRefs.current[index]?.click()}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 font-medium flex items-center gap-1"
                    >
                      <span>📷</span> Add photos
                    </button>
                    <input
                      ref={el => { fileInputRefs.current[index] = el }}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={e => { if (e.target.files) handlePhotoFiles(index, e.target.files) }}
                    />
                  </div>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={addItem}
              className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 font-medium"
            >
              + Add another item
            </button>
          </div>
        </section>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={isPending || anyUploading}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            {anyUploading ? "Uploading photos…" : isPending ? "Creating…" : "Create Submission"}
          </button>
          <Link
            href="/submissions"
            className="text-gray-500 hover:text-gray-700 font-medium px-4 py-2 text-sm"
          >
            Cancel
          </Link>
        </div>

      </form>
    </div>
  )
}
