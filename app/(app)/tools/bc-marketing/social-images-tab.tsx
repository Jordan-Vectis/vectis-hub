"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { format } from "date-fns"

type SocialImage = {
  id:         string
  key:        string
  filename:   string
  label:      string | null
  tags:       string | null
  uploadedBy: string | null
  createdAt:  string
}

function proxyUrl(key: string) {
  return `/api/catalogue/photo-proxy?key=${encodeURIComponent(key)}`
}

function allTags(images: SocialImage[]): string[] {
  const set = new Set<string>()
  for (const img of images) {
    if (img.tags) img.tags.split(",").map(t => t.trim()).filter(Boolean).forEach(t => set.add(t))
  }
  return [...set].sort()
}

export default function SocialImagesTab() {
  const [images,      setImages]      = useState<SocialImage[]>([])
  const [loading,     setLoading]     = useState(false)
  const [search,      setSearch]      = useState("")
  const [activeTag,   setActiveTag]   = useState<string | null>(null)

  // Upload state
  const [uploading,   setUploading]   = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [pendingLabel, setPendingLabel] = useState("")
  const [pendingTags,  setPendingTags]  = useState("")
  const [dragOver,    setDragOver]    = useState(false)
  const fileInputRef  = useRef<HTMLInputElement>(null)
  const dropRef       = useRef<HTMLDivElement>(null)

  // Edit state
  const [editingId,   setEditingId]   = useState<string | null>(null)
  const [editLabel,   setEditLabel]   = useState("")
  const [editTags,    setEditTags]    = useState("")
  const [saving,      setSaving]      = useState(false)

  // Delete state
  const [deletingId,  setDeletingId]  = useState<string | null>(null)

  // Lightbox
  const [lightbox,    setLightbox]    = useState<SocialImage | null>(null)
  const [copied,      setCopied]      = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch("/api/marketing/social-images")
      .then(r => r.json())
      .then(d => { if (d.images) setImages(d.images) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // ── Upload ──
  async function uploadFile(file: File) {
    if (!file) return
    setUploading(true)
    setUploadError(null)
    try {
      const fd = new FormData()
      fd.append("file",  file)
      fd.append("label", pendingLabel)
      fd.append("tags",  pendingTags)
      const res = await fetch("/api/marketing/social-images", { method: "POST", body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Upload failed")
      setPendingLabel("")
      setPendingTags("")
      if (fileInputRef.current) fileInputRef.current.value = ""
      load()
    } catch (e: any) {
      setUploadError(e.message)
    } finally {
      setUploading(false)
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) uploadFile(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) uploadFile(file)
  }

  // ── Edit ──
  function startEdit(img: SocialImage) {
    setEditingId(img.id)
    setEditLabel(img.label ?? "")
    setEditTags(img.tags ?? "")
  }

  async function saveEdit(id: string) {
    setSaving(true)
    try {
      await fetch(`/api/marketing/social-images/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: editLabel, tags: editTags }),
      })
      setImages(prev => prev.map(img =>
        img.id === id ? { ...img, label: editLabel || null, tags: editTags || null } : img
      ))
      setEditingId(null)
    } catch {} finally { setSaving(false) }
  }

  // ── Delete ──
  async function deleteImage(id: string) {
    setDeletingId(id)
    try {
      await fetch(`/api/marketing/social-images/${id}`, { method: "DELETE" })
      setImages(prev => prev.filter(img => img.id !== id))
      if (lightbox?.id === id) setLightbox(null)
    } catch {} finally { setDeletingId(null) }
  }

  // ── Copy ──
  function copyKey(img: SocialImage) {
    navigator.clipboard.writeText(proxyUrl(img.key))
    setCopied(img.id)
    setTimeout(() => setCopied(null), 2000)
  }

  const tags = allTags(images)

  const filtered = images.filter(img => {
    if (activeTag && !img.tags?.split(",").map(t => t.trim()).includes(activeTag)) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        img.filename.toLowerCase().includes(q) ||
        img.label?.toLowerCase().includes(q) ||
        img.tags?.toLowerCase().includes(q)
      )
    }
    return true
  })

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">

      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-800 shrink-0 flex-wrap">
        <h2 className="text-sm font-bold text-white">📸 Social Media Images</h2>

        <input
          type="text"
          placeholder="Search images…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-pink-500 w-48"
        />

        {/* Tag filters */}
        {tags.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => setActiveTag(null)}
              className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${!activeTag ? "bg-pink-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}
            >
              All
            </button>
            {tags.map(t => (
              <button
                key={t}
                onClick={() => setActiveTag(activeTag === t ? null : t)}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${activeTag === t ? "bg-pink-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        <span className="text-xs text-gray-600 ml-auto">{filtered.length} image{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      <div className="flex flex-1 min-h-0">

        {/* ── Upload panel ── */}
        <div className="w-64 shrink-0 border-r border-gray-800 p-4 flex flex-col gap-4">
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Upload New Image</p>

            {/* Drop zone */}
            <div
              ref={dropRef}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => !uploading && fileInputRef.current?.click()}
              className={`rounded-xl border-2 border-dashed h-32 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors ${
                dragOver ? "border-pink-500 bg-pink-900/20" : "border-gray-700 hover:border-pink-600 hover:bg-gray-900"
              } ${uploading ? "opacity-50 cursor-wait" : ""}`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
                onChange={handleFileChange}
                className="hidden"
              />
              {uploading ? (
                <>
                  <span className="text-2xl animate-spin">⟳</span>
                  <span className="text-xs text-gray-400">Uploading…</span>
                </>
              ) : (
                <>
                  <span className="text-3xl">📷</span>
                  <span className="text-xs text-gray-400 text-center px-2">Click or drag & drop<br/>JPG, PNG, WEBP, GIF</span>
                  <span className="text-xs text-gray-700">Max 20MB</span>
                </>
              )}
            </div>

            {uploadError && <p className="text-xs text-red-400 mt-2">{uploadError}</p>}
          </div>

          {/* Pre-upload label + tags */}
          <div className="space-y-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Label <span className="text-gray-700">(optional)</span></label>
              <input
                type="text"
                placeholder="e.g. Transformers promo"
                value={pendingLabel}
                onChange={e => setPendingLabel(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-pink-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Tags <span className="text-gray-700">(comma separated)</span></label>
              <input
                type="text"
                placeholder="e.g. star wars, promo, auction"
                value={pendingTags}
                onChange={e => setPendingTags(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-pink-500"
              />
            </div>
          </div>
        </div>

        {/* ── Image grid ── */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-full text-gray-600 text-sm">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-700">
              <span className="text-5xl">🖼️</span>
              <p className="text-sm font-medium text-gray-500">
                {images.length === 0 ? "No images uploaded yet." : "No images match your search."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {filtered.map(img => (
                <div
                  key={img.id}
                  className="group bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex flex-col"
                >
                  {/* Thumbnail */}
                  <div
                    className="relative aspect-square cursor-pointer overflow-hidden bg-gray-800"
                    onClick={() => setLightbox(img)}
                  >
                    <img
                      src={proxyUrl(img.key)}
                      alt={img.label ?? img.filename}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                    />
                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-white text-xs font-medium">View</span>
                    </div>
                  </div>

                  {/* Info / edit */}
                  <div className="p-2 flex flex-col gap-1 flex-1">
                    {editingId === img.id ? (
                      <>
                        <input
                          type="text"
                          value={editLabel}
                          onChange={e => setEditLabel(e.target.value)}
                          placeholder="Label"
                          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-pink-500"
                        />
                        <input
                          type="text"
                          value={editTags}
                          onChange={e => setEditTags(e.target.value)}
                          placeholder="Tags (comma separated)"
                          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-pink-500"
                        />
                        <div className="flex gap-1 mt-1">
                          <button onClick={() => saveEdit(img.id)} disabled={saving} className="flex-1 text-xs py-1 rounded bg-pink-600 hover:bg-pink-500 text-white transition-colors disabled:opacity-40">
                            {saving ? "…" : "Save"}
                          </button>
                          <button onClick={() => setEditingId(null)} className="flex-1 text-xs py-1 rounded bg-gray-700 hover:bg-gray-600 text-white transition-colors">
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-white font-medium truncate" title={img.label ?? img.filename}>
                          {img.label ?? img.filename}
                        </p>
                        {img.tags && (
                          <div className="flex flex-wrap gap-1">
                            {img.tags.split(",").map(t => t.trim()).filter(Boolean).map(t => (
                              <span key={t} className="text-xs bg-gray-800 text-pink-400 px-1.5 py-0.5 rounded">
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                        <p className="text-xs text-gray-700 mt-auto">
                          {format(new Date(img.createdAt), "d MMM yy")}
                        </p>

                        {/* Action buttons */}
                        <div className="flex gap-1 mt-1">
                          <button
                            onClick={() => copyKey(img)}
                            className="flex-1 text-xs py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
                          >
                            {copied === img.id ? "✓" : "Copy URL"}
                          </button>
                          <button
                            onClick={() => startEdit(img)}
                            className="px-2 text-xs py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
                            title="Edit label/tags"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => deleteImage(img.id)}
                            disabled={deletingId === img.id}
                            className="px-2 text-xs py-1 rounded bg-red-900/30 hover:bg-red-800/50 text-red-400 transition-colors disabled:opacity-40"
                            title="Delete"
                          >
                            {deletingId === img.id ? "…" : "✕"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Lightbox ── */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-6"
          onClick={() => setLightbox(null)}
        >
          <div
            className="bg-gray-900 border border-gray-700 rounded-2xl overflow-hidden max-w-3xl w-full max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="relative">
              <img
                src={proxyUrl(lightbox.key)}
                alt={lightbox.label ?? lightbox.filename}
                className="w-full max-h-[60vh] object-contain bg-gray-950"
              />
              <button
                onClick={() => setLightbox(null)}
                className="absolute top-3 right-3 bg-black/70 hover:bg-black text-white rounded-full w-8 h-8 flex items-center justify-center font-bold transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="p-4 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-white font-semibold">{lightbox.label ?? lightbox.filename}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {lightbox.filename} · Uploaded {format(new Date(lightbox.createdAt), "d MMM yyyy")} by {lightbox.uploadedBy ?? "Unknown"}
                </p>
                {lightbox.tags && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {lightbox.tags.split(",").map(t => t.trim()).filter(Boolean).map(t => (
                      <span key={t} className="text-xs bg-gray-800 text-pink-400 px-2 py-0.5 rounded-full">{t}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => copyKey(lightbox)}
                  className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium transition-colors"
                >
                  {copied === lightbox.id ? "✓ Copied!" : "Copy URL"}
                </button>
                <button
                  onClick={() => deleteImage(lightbox.id)}
                  disabled={deletingId === lightbox.id}
                  className="px-4 py-2 rounded-lg bg-red-900/40 hover:bg-red-800/60 text-red-400 text-sm font-medium transition-colors disabled:opacity-40"
                >
                  {deletingId === lightbox.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
