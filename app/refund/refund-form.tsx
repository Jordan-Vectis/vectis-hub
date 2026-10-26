"use client"

import { useEffect, useRef, useState } from "react"
import { FORM_REASONS, REFUND_LIMITS, REFUND_REASON_LABELS, type RefundReason } from "@/lib/refunds"
import {
  REFUND_DETAILS_MIN, REFUND_PHOTO_MAX_EDGE, REFUND_PHOTO_QUALITY, TOO_MANY_PHOTOS, checkRefundForm,
  type RefundFormField, type RefundFormFields,
} from "@/lib/refunds-public"
import { londonDay } from "@/lib/uncollected"

// The one write on the public refund page: ONE multipart POST to /api/public/refund-request, the
// fields and the photos together. Nothing is ever read back — not even the request's number (the
// route answers {ok:true} only); the thank-you shows the email address they typed, so a typo can be
// spotted, and staff quote the reference when they reply.
//
// ⚠ The <form> itself also posts there (method="post", multipart): if this script never runs — an old
// iPad, a page that didn't finish loading on a weak signal — the browser's own submit sends the fields
// in the BODY, and the route answers with a redirect back to /refund?sent=1. Without method="post" it
// would be a GET, with the customer's name, email and what happened in the address (and the history,
// and the server's logs) — and nothing saved.
//
// Photos are shrunk HERE, in the browser, before anything is sent: a phone's photo is often 10MB,
// six of them would be too much to send, and the Hub needs nothing like that much detail. Each one is
// drawn onto a canvas at most REFUND_PHOTO_MAX_EDGE on its long edge and saved as a JPEG — which also
// drops the photo's hidden details (where it was taken, the phone it was taken on). They're shrunk
// one at a time as they're picked, so pressing Send usually finds them ready.

const BRAND = "bg-[#2e328e] hover:bg-[#22256f] text-white"
const INPUT = "w-full min-h-[44px] rounded-xl border border-gray-300 px-3 py-2 text-base focus:outline-none focus:border-[#2e328e] focus:ring-2 focus:ring-[#2e328e]/20"
const FIELD_ID: Record<RefundFormField, string> = {
  name: "rf-name", email: "rf-email", customerNo: "rf-customerNo", auctionDate: "rf-auctionDate",
  lots: "rf-lots", reason: `rf-reason-${FORM_REASONS[0]}`, details: "rf-details",
}
const COULD_NOT_SEND = "Something went wrong sending that — please try again in a minute."

type Pic = { id: number; state: "shrinking" | "ready" | "failed"; url: string | null }
type Phase =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "sending"; loaded: number; total: number }
  | { kind: "done"; email: string }

export default function RefundForm({ today }: { today: string }) {
  const [phase, setPhase]   = useState<Phase>({ kind: "idle" })
  const [error, setError]   = useState<string | null>(null)
  const [reason, setReason] = useState<RefundReason | null>(null)
  const [pics, setPics]     = useState<Pic[]>([])
  const [picNote, setPicNote] = useState<string | null>(null)

  // Each photo's shrinking, one after another (a phone runs out of memory doing six at once).
  const jobs   = useRef(new Map<number, Promise<Blob | null>>())
  const queue  = useRef<Promise<unknown>>(Promise.resolve())
  const nextId = useRef(1)
  const urls   = useRef(new Set<string>())
  const thanks = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const live = urls.current
    return () => { for (const u of live) URL.revokeObjectURL(u) }
  }, [])

  // The thank-you replaces a long form — take the reader (and a screen reader) straight to it.
  useEffect(() => {
    if (phase.kind === "done") thanks.current?.focus()
  }, [phase.kind])

  function addPhotos(picked: File[]) {
    setPicNote(null)
    const images = picked.filter(f => !f.type || f.type.startsWith("image/"))
    const room = Math.max(0, REFUND_LIMITS.photos - pics.length)
    const take = images.slice(0, room)
    const notes: string[] = []
    if (images.length > take.length) {
      const left = images.length - take.length
      notes.push(`${TOO_MANY_PHOTOS} ${left} ${left === 1 ? "photo wasn't" : "photos weren't"} added.`)
    }
    const notImages = picked.length - images.length
    if (notImages) notes.push(`${notImages === 1 ? "1 file isn't a photo, so it wasn't" : `${notImages} files aren't photos, so they weren't`} added.`)
    if (notes.length) setPicNote(notes.join(" "))
    if (!take.length) return

    const added: Pic[] = take.map(() => ({ id: nextId.current++, state: "shrinking", url: null }))
    setPics(p => [...p, ...added])
    added.forEach((pic, i) => {
      const job = queue.current.then(() => shrinkPhoto(take[i])).catch(() => null)
      queue.current = job
      jobs.current.set(pic.id, job)
      void job.then(blob => {
        if (!jobs.current.has(pic.id)) return // removed while it was being shrunk
        const url = blob ? URL.createObjectURL(blob) : null
        if (url) urls.current.add(url)
        setPics(p => p.map(x => (x.id === pic.id ? { ...x, state: blob ? "ready" : "failed", url } : x)))
      })
    })
  }

  function removePhoto(id: number) {
    const gone = pics.find(p => p.id === id)
    if (gone?.url) { URL.revokeObjectURL(gone.url); urls.current.delete(gone.url) }
    jobs.current.delete(id)
    setPics(p => p.filter(x => x.id !== id))
    setPicNote(null)
  }

  function goTo(field: RefundFormField) {
    const el = document.getElementById(FIELD_ID[field])
    el?.focus()
    el?.scrollIntoView({ block: "center", behavior: "smooth" })
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (phase.kind !== "idle") return
    setError(null)
    const form = new FormData(e.currentTarget)
    const get = (k: string) => String(form.get(k) ?? "")
    const fields: RefundFormFields = {
      name: get("name"), email: get("email"), customerNo: get("customerNo"), auctionDate: get("auctionDate"),
      lots: get("lots"), reason: get("reason"), details: get("details"),
    }
    // The same rules the server keeps — caught here so nobody waits on a send to hear about a typo.
    const check = checkRefundForm(fields, londonDay())
    if (!check.ok) { setError(check.error); goTo(check.field); return }
    const unreadable = pics.findIndex(p => p.state === "failed")
    if (unreadable >= 0) { setError(cantRead(unreadable + 1)); return }

    const list = pics
    setPhase(list.length ? { kind: "preparing" } : { kind: "sending", loaded: 0, total: 0 })
    try {
      const blobs = await Promise.all(list.map(p => jobs.current.get(p.id) ?? Promise.resolve(null)))
      const bad = blobs.findIndex(b => !b)
      if (bad >= 0) throw new Error(cantRead(bad + 1))

      const out = new FormData()
      for (const [k, v] of Object.entries(fields)) out.append(k, v)
      out.append("hp_ref", get("hp_ref"))
      blobs.forEach((b, i) => out.append("photos", b as Blob, `photo-${i + 1}.jpg`))

      setPhase({ kind: "sending", loaded: 0, total: 0 })
      const res = await send(out, (loaded, total) => setPhase({ kind: "sending", loaded, total }))
      if (res.status < 200 || res.status >= 300 || !res.data.ok) throw new Error(res.data.error || errorFor(res.status))
      setPhase({ kind: "done", email: check.value.email })
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : COULD_NOT_SEND)
      setPhase({ kind: "idle" })
    }
  }

  if (phase.kind === "done") {
    return (
      <section className="rounded-2xl border-2 border-[#2e328e]/30 bg-white p-6 text-center">
        <p className="text-3xl text-[#2e328e]" aria-hidden>✓</p>
        <h2 ref={thanks} tabIndex={-1} className="text-xl font-bold mt-1 outline-none">Thank you — we&apos;ve got your request.</h2>
        <p className="text-[15px] text-gray-700 mt-2">
          We&apos;ll reply by email to <b className="break-all">{phase.email}</b>, with a reference to quote if you contact us about it.
        </p>
      </section>
    )
  }

  const busy = phase.kind !== "idle"
  const ready = pics.filter(p => p.state === "ready").length
  const detailsNeeded = reason === "other"

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="text-lg font-bold">Your request</h2>
      <p className="text-sm text-gray-600 mt-1">Everything is needed unless it says optional.</p>

      {/* method / action / encType: only for a browser that never ran this script (see the top). */}
      <form onSubmit={submit} method="post" action="/api/public/refund-request" encType="multipart/form-data" className="mt-4">
        <fieldset disabled={busy} className="space-y-6 min-w-0">
          <Part title="About you">
            <Field id={FIELD_ID.name} name="name" label="Your name" autoComplete="name" required maxLength={REFUND_LIMITS.name} />
            <Field id={FIELD_ID.email} name="email" label="Your email address" type="email" autoComplete="email"
              required maxLength={REFUND_LIMITS.email} hint="The one you bought with — we'll reply to it." />
            <Field id={FIELD_ID.customerNo} name="customerNo" label="Buyer number (optional)"
              autoCapitalize="characters" maxLength={REFUND_LIMITS.customerNo} hint="If you know it — it starts with a C, like C123456." />
          </Part>

          <Part title="The lot">
            <div>
              <label htmlFor={FIELD_ID.auctionDate} className="block text-sm font-semibold mb-1">Date of the auction</label>
              <input id={FIELD_ID.auctionDate} name="auctionDate" type="date" required max={today} className={INPUT} />
            </div>
            <Field id={FIELD_ID.lots} name="lots" label="Lot number (or numbers)"
              required maxLength={REFUND_LIMITS.lotsText} hint="e.g. 808 or 808 & 809" />
          </Part>

          <Part title="What's wrong">
            <fieldset className="min-w-0">
              <legend className="block text-sm font-semibold mb-2">What&apos;s the problem?</legend>
              <div className="space-y-2">
                {FORM_REASONS.map(r => (
                  <label key={r} htmlFor={`rf-reason-${r}`}
                    className={`flex items-center gap-3 min-h-[48px] rounded-xl border-2 px-3 py-2 cursor-pointer transition-colors ${
                      reason === r ? "border-[#2e328e] bg-indigo-50" : "border-gray-200 hover:border-gray-300"
                    }`}>
                    <input id={`rf-reason-${r}`} type="radio" name="reason" value={r} required
                      checked={reason === r} onChange={() => setReason(r)}
                      className="h-5 w-5 shrink-0 accent-[#2e328e]" />
                    <span className="text-[15px] font-medium">{REFUND_REASON_LABELS[r]}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label htmlFor={FIELD_ID.details} className="block text-sm font-semibold mb-1">
                What happened{detailsNeeded ? "" : " (optional)"}
              </label>
              <p className="text-xs text-gray-600 mb-1">
                {detailsNeeded
                  ? "Please tell us what's wrong — a sentence or two is plenty."
                  : "Anything that helps — what's damaged or missing, or how it differs from the description."}
              </p>
              <textarea id={FIELD_ID.details} name="details" rows={4} maxLength={REFUND_LIMITS.details}
                required={detailsNeeded} minLength={detailsNeeded ? REFUND_DETAILS_MIN : undefined}
                className={INPUT} />
            </div>

            <Photos pics={pics} note={picNote} onAdd={addPhotos} onRemove={removePhoto} />
          </Part>

          {/* Honeypot — hidden from people, and it never discards anything: a filled one only flags the
              request for a human, because a password manager can fill it for a real person. */}
          <div hidden aria-hidden>
            <input id="hp_ref" name="hp_ref" type="text" tabIndex={-1} autoComplete="off" />
          </div>

          <p className="rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm p-3">
            Please don&apos;t send bank or card details — we&apos;ll ask how to pay you if a refund is agreed.
          </p>

          {error && (
            <p role="alert" className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-[15px] p-3">{error}</p>
          )}

          <button type="submit" disabled={busy}
            className={`w-full min-h-[52px] rounded-xl ${BRAND} disabled:opacity-60 font-bold text-base py-3`}>
            {phase.kind === "preparing" ? `Sending… ${ready} of ${pics.length} photo${pics.length === 1 ? "" : "s"} ready`
              : phase.kind === "sending" ? sendingWords(phase.loaded, phase.total)
              : "Send my request"}
          </button>
        </fieldset>
      </form>
    </section>
  )
}

// ─── Photos ─────────────────────────────────────────────────────────────────────────────────

function Photos({ pics, note, onAdd, onRemove }: {
  pics: Pic[]; note: string | null; onAdd: (files: File[]) => void; onRemove: (id: number) => void
}) {
  const full = pics.length >= REFUND_LIMITS.photos
  return (
    <div>
      <p className="block text-sm font-semibold mb-1">Photos (optional)</p>
      <p className="text-xs text-gray-600 mb-2">
        Up to {REFUND_LIMITS.photos}. If it&apos;s damaged, a photo of the damage and one of the packaging help most.
      </p>

      {pics.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 mb-2">
          {pics.map((p, i) => (
            <li key={p.id} className="rounded-xl border border-gray-200 overflow-hidden bg-gray-50 flex flex-col">
              <div className="aspect-square flex items-center justify-center text-center">
                {p.state === "ready" && p.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                ) : p.state === "failed" ? (
                  <span className="px-2 text-xs font-semibold text-red-700">Photo {i + 1} can&apos;t be read — please remove it</span>
                ) : (
                  <span className="px-2 text-xs text-gray-500">Getting photo {i + 1} ready…</span>
                )}
              </div>
              <button type="button" onClick={() => onRemove(p.id)}
                className="min-h-[44px] border-t border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-100">
                Remove<span className="sr-only"> photo {i + 1}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {full ? (
        <p className="text-sm text-gray-600">That&apos;s the most — {REFUND_LIMITS.photos} photos.</p>
      ) : (
        <label htmlFor="rf-photos"
          className="flex items-center justify-center min-h-[48px] rounded-xl border-2 border-dashed border-gray-300 hover:border-[#2e328e] px-3 text-[15px] font-semibold text-[#2e328e] cursor-pointer focus-within:ring-2 focus-within:ring-[#2e328e]/40">
          {pics.length ? "Add more photos" : "Add photos"}
          <input id="rf-photos" type="file" accept="image/*" multiple className="sr-only"
            onChange={e => {
              const files = Array.from(e.currentTarget.files ?? [])
              e.currentTarget.value = "" // so the same photo can be picked again after removing it
              if (files.length) onAdd(files)
            }} />
        </label>
      )}
      {note && <p className="mt-2 text-sm text-amber-800">{note}</p>}
    </div>
  )
}

/** A photo drawn at most REFUND_PHOTO_MAX_EDGE on its long edge, as a JPEG. Throws when the browser
 *  can't read it (an iPhone HEIC on some Android and Windows browsers). */
async function shrinkPhoto(file: File): Promise<Blob> {
  let source: ImageBitmap | HTMLImageElement
  let w: number, h: number
  try {
    // "from-image": turned the way the camera held it (a phone photo's rotation lives in its details).
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" })
    source = bmp; w = bmp.width; h = bmp.height
  } catch {
    const img = await loadImage(file) // older Safari: no createImageBitmap for a file
    source = img; w = img.naturalWidth; h = img.naturalHeight
  }
  if (!w || !h) throw new Error("empty image")
  const scale = Math.min(1, REFUND_PHOTO_MAX_EDGE / Math.max(w, h))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(w * scale))
  canvas.height = Math.max(1, Math.round(h * scale))
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("no canvas")
  // White behind it: a see-through PNG would otherwise turn black as a JPEG.
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  if ("close" in source) source.close()
  let blob = await toJpeg(canvas, REFUND_PHOTO_QUALITY)
  // A very busy photo can still be big at 0.85 — one more go, a little smaller, before giving up.
  if (blob && blob.size > REFUND_LIMITS.photoBytes) blob = await toJpeg(canvas, 0.7)
  canvas.width = 0; canvas.height = 0 // hands the memory back straight away (iOS keeps it otherwise)
  if (!blob || blob.size > REFUND_LIMITS.photoBytes) throw new Error("could not shrink")
  return blob
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(b => resolve(b), "image/jpeg", quality))
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("unreadable")) }
    img.src = url
  })
}

const cantRead = (n: number) =>
  `Photo ${n} can't be read on this phone or computer — please remove it, or pick a JPEG or PNG photo instead.`

// ─── Sending ────────────────────────────────────────────────────────────────────────────────

type Answer = { ok?: boolean; error?: string }

/** The POST, through XMLHttpRequest rather than fetch — only XHR can say how much has gone, and a few
 *  megabytes of photos on a phone signal is long enough to need saying. */
function send(body: FormData, onProgress: (loaded: number, total: number) => void): Promise<{ status: number; data: Answer }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", "/api/public/refund-request")
    xhr.timeout = 180_000
    xhr.upload.onprogress = ev => { if (ev.lengthComputable) onProgress(ev.loaded, ev.total) }
    xhr.onload = () => {
      let data: Answer = {}
      try { data = JSON.parse(xhr.responseText) as Answer } catch { /* not JSON — a proxy's error page */ }
      resolve({ status: xhr.status, data: data && typeof data === "object" ? data : {} })
    }
    xhr.onerror = () => reject(new Error("We couldn't reach our server — please check your connection and try again."))
    xhr.ontimeout = () => reject(new Error("That took too long to send — please check your connection and try again."))
    xhr.send(body)
  })
}

function errorFor(status: number): string {
  if (status === 413) return "That's too much to send in one go — please send fewer photos."
  if (status === 429) return "A lot of requests are coming in just now — please try again in an hour."
  if (status === 503) return "The refund form isn't ready yet — please try again later."
  return COULD_NOT_SEND
}

/** "Sending… 1.2 of 4.8 MB" while it goes (the browser's own count), then the server's turn. */
function sendingWords(loaded: number, total: number): string {
  if (!total) return "Sending…"
  if (loaded >= total) return "Sent — saving your request…"
  const mb = (n: number) => (n / 1_000_000).toFixed(1)
  return `Sending… ${mb(loaded)} of ${mb(total)} MB`
}

// ─── Bits ───────────────────────────────────────────────────────────────────────────────────

function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <p className="text-xs font-bold uppercase tracking-wider text-[#2e328e] border-b border-indigo-100 pb-1">{title}</p>
      {children}
    </div>
  )
}

function Field({ id, name, label, hint, type = "text", ...rest }: {
  id: string; name: string; label: string; hint?: string; type?: string
  required?: boolean; maxLength?: number; autoComplete?: string; autoCapitalize?: string
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold mb-1">{label}</label>
      {hint && <p id={`${id}-hint`} className="text-xs text-gray-600 mb-1">{hint}</p>}
      <input id={id} name={name} type={type} aria-describedby={hint ? `${id}-hint` : undefined} className={INPUT} {...rest} />
    </div>
  )
}
