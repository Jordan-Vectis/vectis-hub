"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import {
  createHeroSlide,
  updateHeroSlide,
  deleteHeroSlide,
  reorderHeroSlides,
} from "@/lib/actions/hero-slides"
import SlideView, { focusPosition } from "@/app/(site)/hero-slide-view"
import { BRAND_COLOURS, DEFAULT_STYLE, HEX_COLOUR, type SlideStyle } from "@/app/(site)/hero-style"

// The Banner Manager — every slide of the website's hero, with an editor for its words, picture
// and look. The editor's preview is the site's own slide rendering (hero-slide-view.tsx) at the
// site's size, scaled to fit, so what it shows is what the site shows (Jordan, 2026-09-24: "I need
// a better banner editor so I can change font colours etc").

interface Slide {
  id: string
  order: number
  title: string
  subtitle: string
  cta: string
  ctaHref: string
  imageKey: string | null
  /** A signed address for the picture, made by the page (an hour's worth) — the public photo proxy never served banner keys. */
  imageUrl: string | null
  /** Which part of the picture stays when it is cropped to the banner: "top" | "center" | "bottom" (null = centre). */
  imageFocus: string | null
  style: SlideStyle | null
  active: boolean
}

type Form = {
  title: string
  subtitle: string
  cta: string
  ctaHref: string
  imageKey: string | null
  imageUrl: string | null
  imageFocus: string | null
  active: boolean
  style: SlideStyle
  /** The optional second button, edited as two boxes; it only becomes part of the look when both are filled in. */
  secondLabel: string
  secondHref: string
}

const DEFAULT_FORM: Form = {
  title: "",
  subtitle: "",
  cta: "VIEW UPCOMING AUCTIONS",
  ctaHref: "/auctions",
  imageKey: null,
  imageUrl: null,
  imageFocus: null,
  active: true,
  style: DEFAULT_STYLE,
  secondLabel: "",
  secondHref: "",
}

const FOCUS_CHOICES = [{ value: "top", label: "Top" }, { value: "center", label: "Centre" }, { value: "bottom", label: "Bottom" }] as const
const LINK = /^(\/|https?:\/\/)/

// The look the site will render for what is in the form right now.
function styleOf(f: Form): SlideStyle {
  const label = f.secondLabel.trim(), href = f.secondHref.trim()
  return { ...f.style, second: label && LINK.test(href) ? { label, href } : null }
}

export default function BannerManager({ initialSlides }: { initialSlides: Slide[] }) {
  const [slides, setSlides] = useState<Slide[]>(initialSlides)
  const [editing, setEditing]   = useState<string | null>(null)  // slide id or "new"
  const [form, setForm]         = useState<Form>(DEFAULT_FORM)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [dragOver, setDragOver]  = useState(false)
  const [pending, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  const patch = (p: Partial<Form>) => setForm(f => ({ ...f, ...p }))
  const patchStyle = (p: Partial<SlideStyle>) => setForm(f => ({ ...f, style: { ...f.style, ...p } }))

  // ── Image upload ─────────────────────────────────────────────────────────
  // Straight to R2 on a presigned PUT under hero-slides/ (the banners' own place), then shown by
  // the signed address the route hands back. A refused upload says so — it used to fail silently.
  async function uploadImage(file: File) {
    setUploading(true)
    setUploadError(null)
    try {
      const res = await fetch("/api/website/banner-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.error ?? `Could not get an upload address (${res.status})`)
      const put = await fetch(j.url, { method: "PUT", body: file, headers: { "Content-Type": j.contentType ?? file.type } })
      if (!put.ok) throw new Error(`Storage refused the picture (${put.status})`)
      setForm(f => ({ ...f, imageKey: j.key, imageUrl: j.viewUrl ?? null }))
    } catch (e: any) {
      setUploadError(e?.message ?? "The picture could not be uploaded")
    } finally {
      setUploading(false)
    }
  }

  // ── Save (create or update) ───────────────────────────────────────────────
  function save() {
    setSaveError(null)
    startTransition(async () => {
      // The signed picture address and the second button's two boxes are for the screen only —
      // the row keeps the key and the composed look.
      const { imageUrl, secondLabel, secondHref, ...rest } = form
      const data = { ...rest, style: styleOf(form) }
      try {
        if (editing === "new") {
          await createHeroSlide(data)
          setSlides(prev => [...prev, { id: Date.now().toString(), order: prev.length, ...data, imageUrl }])
        } else if (editing) {
          await updateHeroSlide(editing, data)
          setSlides(prev => prev.map(s => (s.id === editing ? { ...s, ...data, imageUrl } : s)))
        }
        setEditing(null)
        setForm(DEFAULT_FORM)
      } catch (e: any) {
        // A production build hides the real message from a thrown server action; the likeliest cause is named.
        setSaveError(`The slide couldn't be saved${e?.message ? ` — ${e.message}` : ""}. If Run Migrations hasn't been pressed on this environment since the editor was added, that is why.`)
      }
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
    setSaveError(null)
    const st = slide.style ?? DEFAULT_STYLE
    setForm({
      title: slide.title,
      subtitle: slide.subtitle,
      cta: slide.cta,
      ctaHref: slide.ctaHref,
      imageKey: slide.imageKey,
      imageUrl: slide.imageUrl,
      imageFocus: slide.imageFocus,
      active: slide.active,
      style: st,
      secondLabel: st.second?.label ?? "",
      secondHref: st.second?.href ?? "",
    })
  }

  function closeEditor() {
    setEditing(null)
    setForm(DEFAULT_FORM)
    setSaveError(null)
    setUploadError(null)
  }

  const activeCount = slides.filter(s => s.active).length
  const st = form.style

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight">
            Hero Banner Manager
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {activeCount} active slide{activeCount !== 1 ? "s" : ""} · changes go live instantly
          </p>
        </div>
        <button
          onClick={() => { setEditing("new"); setForm(DEFAULT_FORM); setSaveError(null) }}
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
          const img = slide.imageUrl
          return (
            <div
              key={slide.id}
              className={`bg-white border rounded-lg overflow-hidden transition-all ${
                slide.active ? "border-gray-200" : "border-gray-100 opacity-60"
              }`}
            >
              <div className="flex items-stretch">
                {/* Order controls */}
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
                    <img src={img} alt={slide.title} className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: focusPosition(slide.imageFocus) }} />
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
                    {slide.style && <span className="text-[10px] text-gray-400">{slide.style.seconds}s · {slide.style.align} · {slide.style.shade ? `${slide.style.shade}% shade` : "no shade"}</span>}
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

      {/* ── Editor ── */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl w-full max-w-6xl shadow-2xl my-4">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-black text-gray-900 uppercase tracking-tight">
                {editing === "new" ? "Add New Slide" : "Edit Slide"}
              </h2>
              <button onClick={closeEditor} className="text-gray-400 hover:text-gray-700 transition-colors" title="Close">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Live preview — the site's own rendering at the site's size, scaled to fit the panel */}
            <div className="px-6 pt-5">
              <p className="text-[10px] font-black uppercase tracking-wider text-gray-500 mb-2">Preview — as the site will show it</p>
              <ScaledPreview>
                <SlideView slide={{ ...form, style: styleOf(form) }} isLoggedIn={false} preview />
              </ScaledPreview>
            </div>

            {/* Form */}
            <div className="px-6 py-5 grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-6">
              {/* ── Left column ── */}
              <div className="space-y-6">
                <Section title="Picture">
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
                      <div className="relative w-full h-full rounded-lg overflow-hidden bg-gradient-to-br from-[#1a1b3a] to-[#32348A]">
                        {form.imageUrl && <img src={form.imageUrl} alt="Slide background" className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: focusPosition(form.imageFocus) }} />}
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); patch({ imageKey: null, imageUrl: null }) }}
                          className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white rounded-full p-1 transition-colors"
                          title="Remove the picture"
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
                            <p className="text-xs text-gray-400">Drag &amp; drop or click to upload — leave empty for the blue gradient</p>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => {
                    const file = e.target.files?.[0]
                    if (file) uploadImage(file)
                  }} />
                  {uploadError && <p className="mt-2 text-xs text-red-700">⚠ {uploadError}</p>}

                  {form.imageKey && (
                    <>
                      <Field label="Keep in frame" hint="The banner is wide, so a tall picture loses its top or bottom — choose which part to keep.">
                        <Seg value={form.imageFocus ?? "center"} options={FOCUS_CHOICES} onChange={v => patch({ imageFocus: v === "center" ? null : v })} />
                      </Field>
                      <Field label={`Shade behind the words — ${st.shade}%`} hint="Darkens this slide's picture so light words can be read on a bright picture. 0 leaves the picture exactly as it is.">
                        <input type="range" min={0} max={100} step={5} value={st.shade} onChange={e => patchStyle({ shade: Number(e.target.value) })} className="w-full accent-[#32348A]" />
                      </Field>
                    </>
                  )}
                </Section>

                <Section title="Words">
                  <Field label="Headline *">
                    <input value={form.title} onChange={e => patch({ title: e.target.value })} placeholder="World's No.1 Diecast Specialist" className={INPUT} />
                  </Field>
                  <Field label="Subtext *">
                    <textarea value={form.subtitle} onChange={e => patch({ subtitle: e.target.value })} placeholder="Tens of thousands of lots sold every year to collectors worldwide." rows={2} className={`${INPUT} resize-none`} />
                  </Field>
                  <Field label="Small line above the headline">
                    <div className="flex items-center gap-3">
                      <Switch on={st.showKicker} onChange={v => patchStyle({ showKicker: v })} />
                      <input value={st.kicker} onChange={e => patchStyle({ kicker: e.target.value })} disabled={!st.showKicker} className={`${INPUT} flex-1 disabled:opacity-40`} maxLength={80} />
                    </div>
                  </Field>
                </Section>

                <Section title="Buttons">
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Button label *">
                      <input value={form.cta} onChange={e => patch({ cta: e.target.value })} placeholder="VIEW UPCOMING AUCTIONS" className={INPUT} />
                    </Field>
                    <Field label="Button link *">
                      <input value={form.ctaHref} onChange={e => patch({ ctaHref: e.target.value })} placeholder="/auctions" className={`${INPUT} font-mono`} />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Second button (optional)">
                      <input value={form.secondLabel} onChange={e => patch({ secondLabel: e.target.value })} placeholder="e.g. SEE THE RESULTS" className={INPUT} maxLength={60} />
                    </Field>
                    <Field label="Second button link" hint={form.secondLabel.trim() && !LINK.test(form.secondHref.trim()) ? "Needs a link starting with / or https:// before it shows." : undefined}>
                      <input value={form.secondHref} onChange={e => patch({ secondHref: e.target.value })} placeholder="/auctions?tab=past" className={`${INPUT} font-mono`} />
                    </Field>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch on={st.showRegister} onChange={v => patchStyle({ showRegister: v })} />
                    <span className="text-sm text-gray-600">Show the outlined REGISTER FREE button (visitors who aren&apos;t signed in only)</span>
                  </div>
                </Section>
              </div>

              {/* ── Right column ── */}
              <div className="space-y-6">
                <Section title="Colours">
                  <ColourField label="Headline" value={st.headlineColor} onChange={v => patchStyle({ headlineColor: v })} />
                  <ColourField label="Subtext" value={st.subtextColor} onChange={v => patchStyle({ subtextColor: v })} />
                  <ColourField label="Small line" value={st.kickerColor} onChange={v => patchStyle({ kickerColor: v })} />
                  <ColourField label="Button background" value={st.buttonBg} onChange={v => patchStyle({ buttonBg: v })} />
                  <ColourField label="Button text" value={st.buttonText} onChange={v => patchStyle({ buttonText: v })} />
                </Section>

                <Section title="Layout">
                  <Field label="Words across">
                    <Seg value={st.align} options={[{ value: "left", label: "Left" }, { value: "center", label: "Centre" }, { value: "right", label: "Right" }] as const} onChange={v => patchStyle({ align: v })} />
                  </Field>
                  <Field label="Words down">
                    <Seg value={st.valign} options={[{ value: "top", label: "Top" }, { value: "middle", label: "Middle" }, { value: "bottom", label: "Bottom" }] as const} onChange={v => patchStyle({ valign: v })} />
                  </Field>
                  <Field label="Headline size">
                    <Seg value={st.headlineSize} options={[{ value: "s", label: "Small" }, { value: "m", label: "Medium" }, { value: "l", label: "Large" }] as const} onChange={v => patchStyle({ headlineSize: v })} />
                  </Field>
                  <Field label="Width of the words">
                    <Seg value={st.textWidth} options={[{ value: "narrow", label: "Narrow" }, { value: "medium", label: "Medium" }, { value: "wide", label: "Wide" }] as const} onChange={v => patchStyle({ textWidth: v })} />
                  </Field>
                </Section>

                <Section title="Timing & visibility">
                  <Field label="Seconds this slide stays before the next" hint="3 to 20. Only matters when there is more than one live slide.">
                    <input type="number" min={3} max={20} value={st.seconds} onChange={e => patchStyle({ seconds: Math.min(20, Math.max(3, Math.round(Number(e.target.value)) || 5)) })} className={`${INPUT} w-24`} />
                  </Field>
                  <div className="flex items-center gap-3">
                    <Switch on={form.active} onChange={v => patch({ active: v })} />
                    <span className="text-sm text-gray-600 font-medium">{form.active ? "Visible on site" : "Hidden from site"}</span>
                  </div>
                </Section>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 bg-gray-50 border-t border-gray-100 rounded-b-xl">
              {saveError && <p className="mr-auto text-xs text-red-700">⚠ {saveError}</p>}
              <button onClick={closeEditor} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors">
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

const INPUT = "w-full border border-gray-200 rounded px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#32348A] placeholder:text-gray-300 bg-white"

// The site's hero is 520px tall on a wide screen; the preview renders it at 1400×520 and scales
// that down to the panel's width, so the words, sizes and gaps are the site's own.
const PREVIEW_W = 1400, PREVIEW_H = 520
function ScaledPreview({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [k, setK] = useState(0.5)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => setK(Math.min(1, el.clientWidth / PREVIEW_W))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={ref} className="w-full overflow-hidden rounded-lg border border-gray-200" style={{ height: PREVIEW_H * k }}>
      <div className="relative overflow-hidden" style={{ width: PREVIEW_W, height: PREVIEW_H, transform: `scale(${k})`, transformOrigin: "top left" }}>
        {children}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-100 rounded-lg p-4 space-y-4">
      <p className="text-[10px] font-black uppercase tracking-widest text-[#32348A]">{title}</p>
      {children}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex border border-gray-300 rounded overflow-hidden">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`min-h-[36px] px-4 text-xs font-bold tracking-wider transition-colors ${o.value === value ? "bg-[#32348A] text-white" : "text-gray-700 hover:bg-gray-100"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${on ? "bg-[#32348A]" : "bg-gray-200"}`}
      aria-pressed={on}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  )
}

// The brand swatches first, then any colour: the browser's own picker, or a hex typed in.
function ColourField({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  return (
    <div>
      <label className="block text-[10px] font-black text-gray-700 uppercase tracking-wider mb-1">{label}</label>
      <div className="flex items-center gap-1.5 flex-wrap">
        {BRAND_COLOURS.map(c => (
          <button
            key={c.hex}
            type="button"
            title={c.name}
            onClick={() => onChange(c.hex)}
            className={`h-7 w-7 rounded-full border-2 transition-shadow ${value === c.hex ? "border-[#32348A] ring-2 ring-[#32348A]/30" : "border-gray-200"}`}
            style={{ background: c.hex }}
          />
        ))}
        <label className="relative h-7 w-7 rounded-full border-2 border-dashed border-gray-300 overflow-hidden cursor-pointer" title="Any colour">
          <input type="color" value={value} onChange={e => onChange(e.target.value.toLowerCase())} className="absolute -inset-2 w-[200%] h-[200%] cursor-pointer" />
        </label>
        {/* The typed hex is its own box, remounted when a swatch is picked, so half-typed values don't fight the swatches. */}
        <input
          key={value}
          defaultValue={value}
          onChange={e => { const v = e.target.value.trim().toLowerCase(); if (HEX_COLOUR.test(v)) onChange(v) }}
          className="w-24 border border-gray-200 rounded px-2 py-1 text-xs font-mono text-gray-800 bg-white"
          maxLength={7}
        />
      </div>
    </div>
  )
}
