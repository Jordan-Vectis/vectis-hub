"use client"

import { useEffect, useRef, useState } from "react"
import type { Comparable } from "@/app/api/catalogue/lens/route"

// "Lens" for the tablet cataloguing screen — photograph an item, get back what it
// is (Gemini + Google Search) and what WE have sold the same thing for.
//
// A MODAL, not a page, for the same reason as the Guide/Help button beside it: a
// cataloguer opens this mid-lot and must not lose the entry in progress.
//
// ⚠ SUGGESTION ONLY — nothing here writes to the lot. The person holding the item
// is the authority; this is a second opinion with its sources shown.

const ACCENT = "#2AB4A6"

type Identification = {
  identified: boolean
  maker: string | null
  model: string | null
  catalogueNumber: string | null
  year: string | null
  variant: string | null
  confidence: "high" | "medium" | "low"
  reasoning: string | null
  searchTerms: string[]
}

type Source = { title: string; uri: string }
type Result = {
  identification: Identification
  comparables: Comparable[]
  searchQueries: string[]
  sources: Source[]
}

const CONFIDENCE: Record<string, { label: string; cls: string }> = {
  high:   { label: "High confidence",   cls: "text-emerald-400 border-emerald-700/60 bg-emerald-950/30" },
  medium: { label: "Medium confidence", cls: "text-amber-400 border-amber-700/60 bg-amber-950/30" },
  low:    { label: "Low confidence",    cls: "text-red-400 border-red-700/60 bg-red-950/30" },
}

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "—"

// Downscale before upload — iPad photos are ~4MB and the long edge is far more
// detail than identification needs. Same reasoning as the smart-scan upload.
async function shrink(file: File | Blob, maxEdge = 1600): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale  = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    if (scale === 1) return file
    const canvas = document.createElement("canvas")
    canvas.width  = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext("2d")
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>(resolve =>
      canvas.toBlob(b => resolve(b ?? file), "image/jpeg", 0.85),
    )
  } catch {
    return file          // any canvas/bitmap failure → send the original
  }
}

export default function LensButton({ tablet = false }: { tablet?: boolean }) {
  const [open, setOpen]       = useState(false)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [result, setResult]   = useState<Result | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [note, setNote]       = useState("")
  const [file, setFile]       = useState<File | Blob | null>(null)
  const cameraRef  = useRef<HTMLInputElement>(null)
  const libraryRef = useRef<HTMLInputElement>(null)

  function clearResult() {
    setResult(null)
    setError(null)
  }

  function takeImage(f: File | Blob) {
    clearResult()
    setFile(f)
    setPreview(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(f)
    })
  }

  // Paste an image straight in (⌘/Ctrl-V) — handy on a desktop where the picture
  // is already on the clipboard from our own website or an email.
  useEffect(() => {
    if (!open) return
    function onPaste(e: ClipboardEvent) {
      const item = Array.from(e.clipboardData?.items ?? []).find(i => i.type.startsWith("image/"))
      if (!item) return
      const blob = item.getAsFile()
      if (!blob) return
      e.preventDefault()
      takeImage(blob)
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [open])

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0]
    e.target.value = ""                       // so the same photo can be retaken
    if (picked) takeImage(picked)
  }

  async function run() {
    if (!file || busy) return
    clearResult()
    setBusy(true)
    try {
      const body = new FormData()
      body.append("image", await shrink(file), "lens.jpg")
      if (note.trim()) body.append("note", note.trim())
      const res  = await fetch("/api/catalogue/lens", { method: "POST", body })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data?.error ?? `Lens failed (${res.status})`); return }
      setResult(data as Result)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Lens failed")
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    clearResult()
    setFile(null)
    setNote("")
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
  }

  const id      = result?.identification
  const singles = (result?.comparables ?? []).filter(c => !c.grouped)
  const groups  = (result?.comparables ?? []).filter(c => c.grouped)
  const prices  = singles.map(c => c.hammerPrice).sort((a, b) => a - b)
  const range   = prices.length > 0 ? { low: prices[0], high: prices[prices.length - 1] } : null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ touchAction: "manipulation", color: ACCENT, border: `1px solid ${ACCENT}66` }}
        className={`flex-shrink-0 rounded-lg font-medium hover:bg-white/5 transition-colors ${
          tablet ? "px-4 py-2 text-sm" : "px-3 py-1 text-xs"
        }`}
      >
        🔍 Lens
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 overflow-y-auto"
          onClick={() => { setOpen(false); reset() }}
        >
          <div
            className="bg-[#1C1C1E] border border-gray-700 rounded-2xl w-full max-w-2xl my-4"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-800">
              <h2 className="text-lg font-bold flex-1" style={{ color: ACCENT }}>🔍 Lens</h2>
              <button
                onClick={() => { setOpen(false); reset() }}
                className="text-gray-400 hover:text-white text-2xl leading-none px-2"
                style={{ touchAction: "manipulation" }}
              >
                ×
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-400">
                Photograph the item — markings, base or box work best — or paste a picture in. You&apos;ll
                get what it looks like it is, and what we&apos;ve sold the same thing for.
                <span className="text-gray-500"> It&apos;s a second opinion, not a valuation — nothing is saved to the lot.</span>
              </p>

              {/* Two inputs: `capture` forces the camera on a tablet, so choosing an
                  existing picture needs its own input without it. */}
              <input ref={cameraRef}  type="file" accept="image/*" capture="environment" onChange={onPick} className="hidden" />
              <input ref={libraryRef} type="file" accept="image/*" onChange={onPick} className="hidden" />

              <div className="flex gap-2">
                <button
                  onClick={() => cameraRef.current?.click()}
                  disabled={busy}
                  style={{ touchAction: "manipulation", background: ACCENT }}
                  className="flex-1 rounded-xl py-3.5 text-base font-bold text-black disabled:opacity-50"
                >
                  📷 Take a photo
                </button>
                <button
                  onClick={() => libraryRef.current?.click()}
                  disabled={busy}
                  style={{ touchAction: "manipulation" }}
                  className="flex-1 rounded-xl py-3.5 text-base font-medium text-gray-200 border border-gray-700 hover:bg-white/5 disabled:opacity-50"
                >
                  🖼 Choose / paste
                </button>
              </div>

              {preview && (
                <img src={preview} alt="" className="w-full max-h-48 object-contain rounded-xl border border-gray-800" />
              )}

              {/* Optional note — they're holding the item, so what they can see beats
                  what the model thinks it sees. Also lets them ask a direct question. */}
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={2}
                placeholder="Anything to add? e.g. “base says Dinky Toys 741” or “which variant is this?” (optional)"
                className="w-full rounded-xl bg-black/30 border border-gray-700 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-gray-500"
              />

              <button
                onClick={run}
                disabled={busy || !file}
                style={{ touchAction: "manipulation", background: file && !busy ? ACCENT : undefined }}
                className={`w-full rounded-xl py-4 text-base font-bold disabled:opacity-40 ${
                  file && !busy ? "text-black" : "text-gray-400 border border-gray-700"
                }`}
              >
                {busy ? "Looking…" : file ? "🔍 Identify it" : "Add a picture first"}
              </button>

              {error && (
                <div className="rounded-xl border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              {/* ── What it is ── */}
              {id && (
                <div className="rounded-xl border border-gray-700 bg-black/20 p-4 space-y-2">
                  {id.identified ? (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-base font-bold text-white">
                            {[id.maker, id.model].filter(Boolean).join(" ") || "Unnamed item"}
                          </div>
                          <div className="text-sm text-gray-400 mt-0.5">
                            {[
                              id.catalogueNumber ? `No. ${id.catalogueNumber}` : null,
                              id.year,
                              id.variant,
                            ].filter(Boolean).join(" · ") || "no catalogue number found"}
                          </div>
                        </div>
                        <span className={`flex-shrink-0 text-[11px] px-2 py-1 rounded-lg border ${CONFIDENCE[id.confidence]?.cls ?? CONFIDENCE.low.cls}`}>
                          {CONFIDENCE[id.confidence]?.label ?? id.confidence}
                        </span>
                      </div>
                      {id.reasoning && <p className="text-xs text-gray-500">{id.reasoning}</p>}

                      {/* Where it found it — so the cataloguer can check the claim
                          rather than take the model's word for it. */}
                      {result!.sources?.length > 0 && (
                        <div className="pt-1 space-y-1">
                          {result!.sources.slice(0, 3).map((s, i) => (
                            <a
                              key={i}
                              href={s.uri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block text-xs text-blue-400 hover:underline truncate"
                            >
                              🔗 {s.title}
                            </a>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-amber-400">
                      Couldn&apos;t identify it from that photo{id.reasoning ? ` — ${id.reasoning}` : ""}. Try the base,
                      the markings or the box.
                    </p>
                  )}
                </div>
              )}

              {/* ── What we've made on them ── */}
              {result && (
                <div className="rounded-xl border border-gray-700 bg-black/20 p-4">
                  <div className="flex items-baseline justify-between gap-3 mb-2">
                    <h3 className="text-sm font-bold text-gray-200">What we&apos;ve sold them for</h3>
                    {range && (
                      <span className="text-sm font-bold" style={{ color: ACCENT }}>
                        £{range.low} – £{range.high}
                      </span>
                    )}
                  </div>

                  {singles.length === 0 && groups.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      Nothing in our sold archive matches
                      {id?.searchTerms?.length ? ` "${id.searchTerms.join(" ")}"` : ""}. That doesn&apos;t mean much on
                      its own — the wording in old descriptions may simply differ.
                    </p>
                  ) : (
                    <div className="space-y-1.5 max-h-64 overflow-y-auto">
                      {singles.slice(0, 8).map((c, i) => (
                        <div key={`s${i}`} className="flex items-start gap-3 text-xs border-b border-gray-800/60 pb-1.5 last:border-0">
                          <span className="font-bold text-white w-14 flex-shrink-0 tabular-nums">£{c.hammerPrice}</span>
                          <span className="text-gray-400 flex-1 min-w-0">{c.description.slice(0, 150)}</span>
                          <span className="text-gray-600 flex-shrink-0">{fmtDate(c.auctionDate)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Group lots are shown apart — a "group of 6" price says nothing
                      about the single item in the cataloguer's hand. */}
                  {groups.length > 0 && (
                    <details className="mt-2">
                      <summary className="text-xs text-gray-500 cursor-pointer">
                        {groups.length} group lot{groups.length === 1 ? "" : "s"} also matched — kept out of the range
                      </summary>
                      <div className="space-y-1.5 mt-2 max-h-48 overflow-y-auto">
                        {groups.slice(0, 8).map((c, i) => (
                          <div key={`g${i}`} className="flex items-start gap-3 text-xs">
                            <span className="font-semibold text-gray-400 w-14 flex-shrink-0 tabular-nums">£{c.hammerPrice}</span>
                            <span className="text-gray-500 flex-1 min-w-0">{c.description.slice(0, 150)}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {result.searchQueries.length > 0 && (
                    <p className="text-[11px] text-gray-600 mt-2">
                      Checked online for: {result.searchQueries.slice(0, 4).join(", ")}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
