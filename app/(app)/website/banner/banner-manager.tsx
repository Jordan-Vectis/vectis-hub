"use client"

import { useState, useTransition, useRef } from "react"
import Image from "next/image"
import {
  createHeroSlide,
  updateHeroSlide,
  deleteHeroSlide,
  reorderHeroSlides,
} from "@/lib/actions/hero-slides"

interface Slide {
  id: string
  order: number
  title: string
  subtitle: string
  cta: string
  ctaHref: string
  imageKey: string | null
  active: boolean
}

const DEFAULT_FORM = {
  title: "",
  subtitle: "",
  cta: "VIEW UPCOMING AUCTIONS",
  ctaHref: "/auctions",
  imageKey: null as string | null,
  active: true,
}

export default function BannerManager({ initialSlides }: { initialSlides: Slide[] }) {
  const [slides, setSlides] = useState<Slide[]>(initialSlides)
  const [editing, setEditing]   = useState<string | null>(null)  // slide id or "new"
  const [form, setForm]         = useState(DEFAULT_FORM)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver]  = useState(false)
  const [pending, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  const photoUrl = (key: string | null) =>
    key ? `/api/public/photo?key=${encodeURIComponent(key)}` : null

  // ── Image upload ─────────────────────────────────────────────────────────
  async function uploadImage(file: File) {
    setUploading(true)
    try {
      const res = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          size: file.size,
        }),
      })
      const { url, key } = await res.json()
      await fetch(url, { method: "PUT", body: file, headers: { "Content-Type": file.type } })
      setForm(f => ({ ...f, imageKey: key }))
    } finally {
      setUploading(false)
    }
  }

  // ── Save (create or update) ───────────────────────────────────────────────
  function save() {
    startTransition(async () => {
      if (editing === "new") {
        const res = await fetch("/api/hero-slides", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        }).catch(() => null)
        // Use server action directly
        await createHeroSlide(form)
        // Refresh from server — simple: reload slides via router, but we optimistically update
        setSlides(prev => [
          ...prev,
          { id: Date.now().toString(), order: prev.length, ...form },
        ])
      } else if (editing) {
        await updateHeroSlide(editing, form)
        setSlides(prev =>
          prev.map(s => (s.id === editing ? { ...s, ...form } : s))
        )
      }
      setEditing(null)
      setForm(DEFAULT_FORM)
    })
  }

  // ── Toggle active ─────────────────────────────────────────────────────────
  function toggleActive(slide: Slide) {
    startTransition(async () => {
      await updateHeroSlide(slide.id, { active: !slide.active })
      setSlides(prev => prev.map(s => (s.id === slide.id ? { ...s, active: !s.active } : s)))
    })
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  function remove(id: string) {
    if (!confirm("Delete this slide?")) return
    startTransition(async () => {
      await deleteHeroSlide(id)
      setSlides(prev => prev.filter(s => s.id !== id))
    })
  }

  // ── Move up / down ────────────────────────────────────────────────────────
  function move(id: string, dir: -1 | 1) {
    const idx = slides.findIndex(s => s.id === id)
    if (idx + dir < 0 || idx + dir >= slides.length) return
    const next = [...slides]
    ;[next[idx], next[idx + dir]] = [next[idx + dir], next[idx]]
    const reordered = next.map((s, i) => ({ ...s, order: i }))
    setSlides(reordered)
    startTransition(() => reorderHeroSlides(reordered.map(s => s.id)))
  }

  // ── Start editing ─────────────────────────────────────────────────────────
  function startEdit(slide: Slide) {
    setEditing(slide.id)
    setForm({
      title: slide.title,
      subtitle: slide.subtitle,
      cta: slide.cta,
      ctaHref: slide.ctaHref,
      imageKey: slide.imageKey,
      active: slide.active,
    })
  }

  const activeCount = slides.filter(s => s.active).length

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900 uppercase tracking-tight">
            Hero Banner Manager
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {activeCount} active slide{activeCount !== 1 ? "s" : ""} · changes go live instantly
          </p>
        </div>
        <button
          onClick={() => { setEditing("new"); setForm(DEFAULT_FORM) }}
          className="flex items-center gap-2 bg-[#32348A] hover:bg-[#28296e] text-white text-sm font-bold px-5 py-2.5 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          Add Slide
        </button>
      </div>

      {/* Slides list */}
      <div className="space-y-3">
        {slides.length === 0 && (
          <div className="border-2 border-dashed border-gray-200 rounded-lg p-12 text-center">
            <p className="text-gray-400 text-sm mb-1">No slides yet</p>
            <p className="text-gray-300 text-xs">Add your first hero slide above</p>
          </div>
        )}

        {slides.map((slide, idx) => {
          const img = photoUrl(slide.imageKey)
          return (
            <div
              key={slide.id}
              className={`bg-white border rounded-lg overflow-hidden transition-all ${
                slide.active ? "border-gray-200" : "border-gray-100 opacity-60"
              }`}
            >
              <div className="flex items-stretch">
                {/* Drag handles / order controls */}
                <div className="flex flex-col items-center justify-center gap-1 bg-gray-50 border-r border-gray-100 px-2 py-3 w-10">
                  <button
                    onClick={() => move(slide.id, -1)}
                    disabled={idx === 0 || pending}
                    className="text-gray-400 hover:text-gray-700 disabled:opacity-20 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <span className="text-[10px] font-bold text-gray-400">{idx + 1}</span>
                  <button
                    onClick={() => move(slide.id, 1)}
                    disabled={idx === slides.length - 1 || pending}
                    className="text-gray-400 hover:text-gray-700 disabled:opacity-20 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>

                {/* Thumbnail */}
                <div className="w-32 h-20 shrink-0 bg-gradient-to-br from-[#1a1b3a] to-[#32348A] relative">
                  {img && (
                    <Image src={img} alt={slide.title} fill className="object-cover" unoptimized />
                  )}
                  {!img && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <svg className="w-6 h-6 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 px-4 py-3 min-w-0">
                  <p className="font-bold text-gray-900 text-sm truncate">{slide.title}</p>
                  <p className="text-gray-500 text-xs truncate mt-0.5">{slide.subtitle}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-[10px] bg-[#32348A]/10 text-[#32348A] px-2 py-0.5 font-bold uppercase tracking-wider rounded">
                      {slide.cta}
                    </span>
                    <span className="text-[10px] text-gray-400 font-mono">{slide.ctaHref}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 px-4 shrink-0">
                  {/* Active toggle */}
                  <button
                    onClick={() => toggleActive(slide)}
                    disabled={pending}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      slide.active ? "bg-[#32348A]" : "bg-gray-200"
                    }`}
                    title={slide.active ? "Click to deactivate" : "Click to activate"}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                        slide.active ? "translate-x-4.5" : "translate-x-0.5"
                      }`}
                    />
                  </button>

                  <button
                    onClick={() => startEdit(slide)}
                    className="p-2 text-gray-400 hover:text-[#32348A] transition-colors"
                    title="Edit"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>

                  <button
                    onClick={() => remove(slide.id)}
                    disabled={pending}
                    className="p-2 text-gray-400 hover:text-[#DB0606] transition-colors"
                    title="Delete"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Edit / Add modal ── */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-black text-gray-900 uppercase tracking-tight">
                {editing === "new" ? "Add New Slide" : "Edit Slide"}
              </h2>
              <button
                onClick={() => { setEditing(null); setForm(DEFAULT_FORM) }}
                className="text-gray-400 hover:text-gray-700 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Form */}
            <div className="px-6 py-5 space-y-4">
              {/* Image upload */}
              <div>
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-2">
                  Background Image <span className="text-gray-400 font-normal normal-case">(optional — leave blank for gradient)</span>
                </label>
                <div
                  className={`relative border-2 border-dashed rounded-lg transition-colors cursor-pointer ${
                    dragOver ? "border-[#32348A] bg-[#32348A]/5" : "border-gray-200 hover:border-gray-300"
                  }`}
                  style={{ height: form.imageKey ? "160px" : "100px" }}
                  onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => {
                    e.preventDefault()
                    setDragOver(false)
                    const file = e.dataTransfer.files[0]
                    if (file) uploadImage(file)
                  }}
                  onClick={() => fileRef.current?.click()}
                >
                  {form.imageKey ? (
                    <div className="relative w-full h-full rounded-lg overflow-hidden">
                      <Image
                        src={`/api/public/photo?key=${encodeURIComponent(form.imageKey)}`}
                        alt="Slide background"
                        fill
                        className="object-cover"
                        unoptimized
                      />
                      <button
                        onClick={e => { e.stopPropagation(); setForm(f => ({ ...f, imageKey: null })) }}
                        className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white rounded-full p-1 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                      {uploading ? (
                        <div className="w-5 h-5 border-2 border-[#32348A] border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <>
                          <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <p className="text-xs text-gray-400">Drag & drop or click to upload</p>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) uploadImage(file)
                }} />
              </div>

              {/* Title */}
              <div>
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1.5">
                  Headline *
                </label>
                <input
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="World's No.1 Diecast Specialist"
                  className="w-full border border-gray-200 rounded px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#32348A] placeholder:text-gray-300"
                />
              </div>

              {/* Subtitle */}
              <div>
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1.5">
                  Subtext *
                </label>
                <textarea
                  value={form.subtitle}
                  onChange={e => setForm(f => ({ ...f, subtitle: e.target.value }))}
                  placeholder="Tens of thousands of lots sold every year to collectors worldwide."
                  rows={2}
                  className="w-full border border-gray-200 rounded px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#32348A] placeholder:text-gray-300 resize-none"
                />
              </div>

              {/* CTA row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1.5">
                    Button Label *
                  </label>
                  <input
                    value={form.cta}
                    onChange={e => setForm(f => ({ ...f, cta: e.target.value }))}
                    placeholder="VIEW UPCOMING AUCTIONS"
                    className="w-full border border-gray-200 rounded px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#32348A] placeholder:text-gray-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1.5">
                    Button Link *
                  </label>
                  <input
                    value={form.ctaHref}
                    onChange={e => setForm(f => ({ ...f, ctaHref: e.target.value }))}
                    placeholder="/auctions"
                    className="w-full border border-gray-200 rounded px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#32348A] placeholder:text-gray-300 font-mono"
                  />
                </div>
              </div>

              {/* Active toggle */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, active: !f.active }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    form.active ? "bg-[#32348A]" : "bg-gray-200"
                  }`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    form.active ? "translate-x-6" : "translate-x-1"
                  }`} />
                </button>
                <span className="text-sm text-gray-600 font-medium">
                  {form.active ? "Visible on site" : "Hidden from site"}
                </span>
              </div>
            </div>

            {/* Preview strip */}
            <div className="mx-6 mb-5 rounded-lg overflow-hidden bg-gradient-to-br from-[#1a1b3a] to-[#32348A] relative" style={{ height: "80px" }}>
              {form.imageKey && (
                <Image
                  src={`/api/public/photo?key=${encodeURIComponent(form.imageKey)}`}
                  alt="Preview"
                  fill
                  className="object-cover opacity-40"
                  unoptimized
                />
              )}
              <div className="absolute inset-0 flex flex-col justify-center px-5">
                <p className="text-white font-black text-sm uppercase tracking-tight leading-tight truncate">
                  {form.title || <span className="opacity-30">Headline will appear here</span>}
                </p>
                <p className="text-gray-300 text-[11px] mt-0.5 truncate opacity-80">
                  {form.subtitle || ""}
                </p>
                {form.cta && (
                  <span className="mt-1.5 bg-[#DB0606] text-white text-[9px] font-black uppercase tracking-widest px-3 py-1 self-start">
                    {form.cta}
                  </span>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 bg-gray-50 border-t border-gray-100">
              <button
                onClick={() => { setEditing(null); setForm(DEFAULT_FORM) }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={!form.title || !form.subtitle || !form.cta || !form.ctaHref || pending || uploading}
                className="bg-[#32348A] hover:bg-[#28296e] disabled:opacity-40 text-white text-sm font-bold px-6 py-2.5 transition-colors"
              >
                {pending ? "Saving…" : editing === "new" ? "Add Slide" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
