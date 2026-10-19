"use client"

import { useState, useTransition, useRef } from "react"
import { submitPublicForm } from "@/lib/actions/public-submission"

// The customer valuation form. It is drawn in three places — on its own at /submit (outside the
// site layout, where site.css is NOT loaded), inside the site at /sell-with-us, and by the page
// editor's "Live: Valuation form" block — so it is styled with Tailwind utilities only, never the
// site's vs-* classes. The one colour written out is the navy (#2e328e), because the stylesheet
// that names it may be absent; the greys are Tailwind's nearest (stone-100 for the light band,
// neutral-200 for the hairline, neutral-800 ink, neutral-500 muted). Square corners and 16px
// labels and fields, as vectis.co.uk's form. Inside the site the page supplies the title, so the
// standalone header hides itself there ([.vectis-site_&]).
//
// The !important marks are deliberate. The Hub's root layout is dark by default and globals.css
// paints every bare form control dark with an UNLAYERED rule, which beats a Tailwind utility (v4
// puts utilities in a layer) however specific the class — so on /submit the fields rendered dark
// with light text. Likewise the site's own unlayered heading rule flattens every h1–h4 to weight
// 400, so the weights here are marked to hold in both places.

const MAX_FILES_SIZE_GB = 5
const MAX_FILES_SIZE_BYTES = MAX_FILES_SIZE_GB * 1024 * 1024 * 1024
const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "application/pdf"]

// The same eight lines as the home page's introduction (WHY_USE_VECTIS in
// app/(site)/home-sections.tsx) — copied, not imported: nothing under app/submit may depend on
// the site's files, because this page also stands on its own.
const WHY_USE_VECTIS = [
  "World record prices, higher than any other auction house",
  "We will pack and ship all your items to a global audience",
  "Our team of experts cover all collectable genres",
  "Protection against internet fraudsters",
  "We will handle any returns or buyer queries",
  "One-off commission – no extra lotting fees, photography or marketing fees",
  "No collection too small or large",
  "Over 30 years' experience in the collectable toy industry",
]

// One look for every field: 48px tall, square, a hairline border that turns navy on focus.
const FIELD = "block w-full rounded-none border border-neutral-200 !bg-white px-4 text-[16px] !text-neutral-800 outline-none transition-colors placeholder:text-gray-400 focus:border-[#2e328e] focus:ring-1 focus:ring-[#2e328e]"
const INPUT = `${FIELD} h-12`
const TEXTAREA = `${FIELD} min-h-[160px] py-3 resize-y`
const LABEL = "mb-1.5 block text-[16px] font-medium text-black"
const SECTION_TITLE = "mb-2 text-[26px] !font-medium leading-tight text-black"
const NOTE = "mb-5 text-[16px] text-neutral-500"
const BTN = "inline-flex h-12 items-center justify-center gap-2 rounded-none border border-[#2e328e] px-8 text-[14px] font-medium uppercase tracking-[1px] transition-colors"
const BTN_NAVY = `${BTN} bg-[#2e328e] text-white hover:bg-white hover:text-[#2e328e] disabled:opacity-60 disabled:hover:bg-[#2e328e] disabled:hover:text-white`
const BTN_OUTLINE = `${BTN} bg-white text-[#2e328e] hover:bg-[#2e328e] hover:text-white`

interface FileEntry {
  file: File
  key: string | null
  progress: number
  error: string | null
  done: boolean
}

export default function PublicSubmitPage() {
  const [isPending, startTransition] = useTransition()
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [files, setFiles] = useState<FileEntry[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function getTotalSize(entries: FileEntry[]) {
    return entries.reduce((sum, e) => sum + e.file.size, 0)
  }

  function handleFiles(incoming: FileList | null) {
    if (!incoming) return
    const picked = Array.from(incoming)
    const valid = picked.filter((f) => ALLOWED_TYPES.includes(f.type))
    const newEntries: FileEntry[] = valid.map((f) => ({
      file: f,
      key: null,
      progress: 0,
      error: null,
      done: false,
    }))

    // Decided against the current list rather than inside a state updater, which must stay pure.
    const combined = [...files, ...newEntries]
    if (getTotalSize(combined) > MAX_FILES_SIZE_BYTES) {
      setError(`Total file size exceeds ${MAX_FILES_SIZE_GB}GB. Please contact us directly if you have a large number of photos.`)
      return
    }
    // A file of another kind is left out and said so — a photo that silently never arrives is a mystery.
    setError(valid.length < picked.length ? "Only JPG, PNG and PDF files can be added — the other files were left out." : null)
    setFiles(combined)
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index))
    setError(null)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    handleFiles(e.dataTransfer.files)
  }

  async function uploadFile(entry: FileEntry, index: number): Promise<string> {
    // Get signed URL from our server
    const res = await fetch("/api/upload-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: entry.file.name,
        contentType: entry.file.type,
        size: entry.file.size,
      }),
    })

    if (!res.ok) throw new Error("Failed to get upload URL")
    const { url, key } = await res.json()

    // Upload directly to R2 with progress tracking
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open("PUT", url)
      xhr.setRequestHeader("Content-Type", entry.file.type)

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 100)
          setFiles((prev) =>
            prev.map((f, i) => (i === index ? { ...f, progress } : f))
          )
        }
      }

      xhr.onload = () => {
        if (xhr.status === 200 || xhr.status === 204) {
          setFiles((prev) =>
            prev.map((f, i) => (i === index ? { ...f, progress: 100, done: true, key } : f))
          )
          resolve()
        } else {
          reject(new Error(`Upload failed: ${xhr.status}`))
        }
      }

      xhr.onerror = () => reject(new Error("Upload failed"))
      xhr.send(entry.file)
    })

    return key
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const form = e.currentTarget

    // Upload all files to R2 first
    setUploading(true)
    const keys: string[] = []

    try {
      for (let i = 0; i < files.length; i++) {
        const key = await uploadFile(files[i], i)
        keys.push(key)
      }
    } catch {
      setError("One or more photos failed to upload. Please try again.")
      setUploading(false)
      return
    }

    setUploading(false)

    // Submit form data with keys (manually built to exclude file input data)
    const rawForm = new FormData(form)
    const formData = new FormData()
    for (const [key, value] of rawForm.entries()) {
      if (typeof value === "string") formData.append(key, value)
    }
    keys.forEach((k) => formData.append("photoKey", k))

    startTransition(async () => {
      try {
        await submitPublicForm(formData)
        setSubmitted(true)
      } catch {
        setError("Something went wrong. Please try again or contact us directly.")
      }
    })
  }

  const totalSize = getTotalSize(files)
  const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(1)
  const isSubmitting = uploading || isPending

  if (submitted) {
    return (
      <div className="bg-white text-[16px] text-neutral-800" style={{ colorScheme: "light" }}>
        <div className="mx-auto max-w-[640px] px-5 py-20 text-center sm:px-8 sm:py-28">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center bg-[#2e328e] text-white">
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="mb-3 text-[32px] !font-medium leading-tight text-black">Thank you!</h2>
          <p className="text-[18px]">
            We&apos;ve received your submission and one of our specialists will be in touch with a valuation shortly.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white text-[16px] text-neutral-800" style={{ colorScheme: "light" }}>

      {/* The page's own title — only when it stands alone; inside the site the page supplies one. */}
      <header className="border-b border-neutral-200 [.vectis-site_&]:hidden">
        <div className="mx-auto max-w-[1320px] px-5 py-8 sm:px-8">
          <img src="/vectis-logo.svg" alt="Vectis Auctions" width={160} height={65} className="h-14 w-auto" />
          <h1 className="mt-6 text-[32px] font-medium leading-tight text-black sm:text-[40px]">Submit Items for Valuation</h1>
          <p className="mt-3 max-w-[720px] text-[18px]">Fill in your details and describe your items. One of our specialists will get back to you with a valuation.</p>
        </div>
      </header>

      {/* Why use Vectis? — the home page's eight reasons, two columns on a light band. */}
      <section className="bg-stone-100 py-10 sm:py-14" aria-labelledby="why-use-vectis">
        <div className="mx-auto max-w-[1320px] px-5 sm:px-8">
          <h2 id="why-use-vectis" className="mb-6 text-[28px] !font-semibold leading-tight text-black sm:text-[36px]">Why use Vectis?</h2>
          <ul className="grid list-disc gap-x-10 gap-y-2 pl-5 leading-relaxed md:grid-cols-2">
            {WHY_USE_VECTIS.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      </section>

      <section className="py-10 sm:py-14">
        <div className="mx-auto max-w-[1320px] px-5 sm:px-8">
          <form onSubmit={handleSubmit} className="max-w-[900px] space-y-10">

            {/* Your details */}
            <section>
              <h2 className={SECTION_TITLE}>Your details</h2>
              <p className={NOTE}>Fields marked * are required.</p>
              <div className="grid gap-5 md:grid-cols-2">
                <div className="md:col-span-2 md:max-w-[280px]">
                  <label htmlFor="submit-title" className={LABEL}>Title *</label>
                  <select id="submit-title" name="title" required className={INPUT}>
                    <option value="">Select...</option>
                    <option>Mr</option>
                    <option>Mrs</option>
                    <option>Miss</option>
                    <option>Ms</option>
                    <option>Dr</option>
                    <option>Prof</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="submit-first-name" className={LABEL}>First name *</label>
                  <input id="submit-first-name" name="firstName" required autoComplete="given-name" className={INPUT} />
                </div>
                <div>
                  <label htmlFor="submit-last-name" className={LABEL}>Last name *</label>
                  <input id="submit-last-name" name="lastName" required autoComplete="family-name" className={INPUT} />
                </div>
                <div>
                  <label htmlFor="submit-email" className={LABEL}>Email address *</label>
                  <input id="submit-email" name="email" type="email" required autoComplete="email" className={INPUT} />
                </div>
                <div>
                  <label htmlFor="submit-phone" className={LABEL}>Phone number</label>
                  <input id="submit-phone" name="phone" type="tel" autoComplete="tel" className={INPUT} />
                </div>
              </div>
            </section>

            {/* Item description */}
            <section>
              <h2 className={SECTION_TITLE}>Item description</h2>
              <p className={NOTE}>Tell us about your items. Enter as much information as possible to help our specialists evaluate them.</p>
              <label htmlFor="submit-description" className="sr-only">Item description *</label>
              <textarea
                id="submit-description"
                name="description"
                required
                rows={6}
                placeholder="Describe your items — include condition, any markings, whether original packaging is present, approximate age, etc."
                className={TEXTAREA}
              />
            </section>

            {/* Photographs */}
            <section>
              <h2 className={SECTION_TITLE}>Photographs</h2>
              <p className={NOTE}>Acceptable files — JPG, PNG, PDF. Maximum {MAX_FILES_SIZE_GB}GB total.</p>

              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className="cursor-pointer border-2 border-dashed border-neutral-200 bg-white p-8 text-center transition-colors hover:border-[#2e328e] sm:p-10"
              >
                <p className="mb-4">Add images</p>
                <button type="button" className={BTN_OUTLINE}>Browse</button>
                <p className="mt-4 text-[14px] text-neutral-500">or drag and drop files here</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.pdf"
                  className="hidden"
                  // Cleared after reading so the same file can be picked again once it has been removed.
                  onChange={(e) => { handleFiles(e.target.files); e.target.value = "" }}
                />
              </div>

              {files.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-[14px] text-neutral-500">{files.length} file{files.length !== 1 ? "s" : ""} — {totalSizeMB}MB total</p>
                  <ul className="space-y-2" aria-label="Files to upload">
                    {files.map((entry, i) => (
                      <li key={`${entry.file.name}-${entry.file.size}-${i}`} className="border border-neutral-200 bg-stone-100 px-4 py-2">
                        <div className="flex items-center justify-between gap-4 text-[14px]">
                          <span className="truncate">{entry.file.name}</span>
                          {!isSubmitting && (
                            <button
                              type="button"
                              onClick={() => removeFile(i)}
                              className="min-h-[44px] shrink-0 px-2 text-[14px] font-medium uppercase tracking-[1px] text-[#2e328e] hover:underline"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                        {entry.progress > 0 && (
                          <div className="mb-1 h-1.5 w-full bg-neutral-200" role="progressbar" aria-valuenow={entry.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${entry.file.name}`}>
                            <div
                              className={`h-1.5 transition-all ${entry.done ? "bg-green-600" : "bg-[#2e328e]"}`}
                              style={{ width: `${entry.progress}%` }}
                            />
                          </div>
                        )}
                        {entry.error && <p className="mt-1 text-[14px] text-red-700">{entry.error}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {error && (
              <p role="alert" className="border border-red-200 bg-red-50 px-4 py-3 text-red-700">{error}</p>
            )}

            <button type="submit" disabled={isSubmitting} className={`${BTN_NAVY} w-full sm:w-auto`}>
              {uploading
                ? "Uploading photos..."
                : isPending
                ? "Submitting..."
                : "Submit for valuation"}
            </button>

          </form>
        </div>
      </section>
    </div>
  )
}
