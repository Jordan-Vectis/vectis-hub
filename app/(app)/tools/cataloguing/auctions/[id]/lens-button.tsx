"use client"

import { useEffect, useRef, useState } from "react"
import type { Comparable, ComparableSummary } from "@/app/api/catalogue/lens/route"

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
  keyPoints: string | null
}

type Source = { title: string; uri: string }
type Result = {
  identification: Identification
  comparables: Comparable[]
  /** Middle half of single-lot sales + the typical figure; null when none. */
  summary: ComparableSummary | null
  /** "number" = the summary is from the lots with the same catalogue number only. */
  summaryBasis: "number" | "all"
  /** What "See every match in Website Search" searches for. */
  searchText: string
  searchQueries: string[]
  sources: Source[]
}

// The same colours as Website Search beside it, so a BC or ABC lot reads the same in both.
const SOURCE_BADGE: Record<"bc" | "abc", { label: string; cls: string }> = {
  bc:  { label: "BC",  cls: "bg-violet-100 dark:bg-violet-500/20 text-violet-800 dark:text-violet-200 border-violet-300 dark:border-violet-400/50" },
  abc: { label: "ABC", cls: "bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-400/50" },
}

const gbp = (n: number) => "£" + n.toLocaleString("en-GB", { maximumFractionDigits: 0 })

const CONFIDENCE: Record<string, { label: string; cls: string }> = {
  high:   { label: "High confidence",   cls: "text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700/60 bg-emerald-50 dark:bg-emerald-950/30" },
  medium: { label: "Medium confidence", cls: "text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30" },
  low:    { label: "Low confidence",    cls: "text-red-600 dark:text-red-400 border-red-300 dark:border-red-700/60 bg-red-50 dark:bg-red-950/30" },
}

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "—"

/** One of our sold lots: photo, price, where and when, and the description. Tapping it opens
 *  the lot on vectis.co.uk when we hold its link. */
function ComparableRow({ c, muted = false }: { c: Comparable; muted?: boolean }) {
  const badge = c.source ? SOURCE_BADGE[c.source] : null
  const body = (
    <>
      <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-black/40">
        {c.photo
          ? <img src={c.photo} alt="" loading="lazy" className="h-full w-full object-cover" />
          : <div className="flex h-full items-center justify-center text-[10px] text-gray-600">No photo</div>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={`font-bold tabular-nums ${muted ? "text-gray-600 dark:text-gray-400" : "text-gray-900 dark:text-white"}`}>{gbp(c.hammerPrice)}</span>
          {badge && <span className={`rounded border px-1.5 py-px text-[10px] font-semibold ${badge.cls}`}>{badge.label}</span>}
          {c.exact && <span className="rounded border border-emerald-400 dark:border-emerald-500/50 bg-emerald-100 dark:bg-emerald-500/15 px-1.5 py-px text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">Same No.</span>}
          <span className="text-gray-500">{[fmtDate(c.auctionDate), c.auctionName].filter(Boolean).join(" · ")}</span>
        </div>
        <p className={`mt-0.5 line-clamp-2 ${muted ? "text-gray-500" : "text-gray-600 dark:text-gray-400"}`}>{c.description}</p>
      </div>
      {c.link && <span className="flex-shrink-0 self-center text-sm" style={{ color: ACCENT }}>↗</span>}
    </>
  )
  const cls = "flex items-start gap-3 rounded-lg px-1 py-1.5 text-xs border-b border-gray-200 dark:border-gray-800/60 last:border-0"
  return c.link ? (
    <a href={c.link} target="_blank" rel="noopener noreferrer" style={{ touchAction: "manipulation" }} className={`${cls} hover:bg-black/5 dark:hover:bg-white/5`}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  )
}

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
  const [copied, setCopied]   = useState<"" | "kp" | "desc">("")
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
    setCopied("")
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
  }

  async function copyText(text: string, which: "kp" | "desc") {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard API needs a secure context and can be blocked on iPad — fall
      // back to the old select-and-copy trick so the button always does something.
      const ta = document.createElement("textarea")
      ta.value = text
      ta.style.position = "fixed"
      ta.style.opacity = "0"
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand("copy") } catch { /* nothing more we can do */ }
      ta.remove()
    }
    setCopied(which)
    setTimeout(() => setCopied(""), 2000)
  }

  // Hands the search to Website Search beside it. Lens is closed WITHOUT resetting, so
  // opening it again shows this same result — nothing is lost going back and forth.
  function openInSearch() {
    const q = result?.searchText?.trim()
    if (!q) return
    setOpen(false)
    window.dispatchEvent(new CustomEvent("hub:website-search", { detail: { q } }))
  }

  const id      = result?.identification
  // The identification as one line, exactly as the card shows it — what the
  // Copy button beside the confidence badge puts on the clipboard.
  const descText = id?.identified
    ? [
        [id.maker, id.model].filter(Boolean).join(" "),
        [id.catalogueNumber ? `No. ${id.catalogueNumber}` : null, id.year, id.variant]
          .filter(Boolean).join(" · "),
      ].filter(Boolean).join(" — ")
    : ""
  const singles = (result?.comparables ?? []).filter(c => !c.grouped)
  const groups  = (result?.comparables ?? []).filter(c => c.grouped)
  const summary = result?.summary ?? null
  const sameNo  = singles.filter(c => c.exact)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ touchAction: "manipulation", color: ACCENT, border: `1px solid ${ACCENT}66` }}
        className={`flex-shrink-0 rounded-lg font-medium hover:bg-black/5 dark:hover:bg-white/5 transition-colors ${
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
            className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-2xl w-full max-w-3xl my-4"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200 dark:border-gray-800">
              <h2 className="text-lg font-bold flex-1" style={{ color: ACCENT }}>🔍 Lens</h2>
              <button
                onClick={() => { setOpen(false); reset() }}
                className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-2xl leading-none px-2"
                style={{ touchAction: "manipulation" }}
              >
                ×
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Shown every time it's opened — this is new and we want people
                  telling us what's wrong with it rather than quietly distrusting it. */}
              <div className="rounded-xl border border-amber-300 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-950/25 px-4 py-3">
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">🧪 Experimental — still being built</p>
                <p className="text-xs text-amber-800 dark:text-amber-200/80 mt-1">
                  This is a work in progress, so please double-check anything it tells you before using it.
                  If you spot something wrong, or you can think of a way it&apos;d be more useful, come and
                  tell <b>Jack</b> or <b>Jordan</b> — we&apos;re actively improving it and your feedback shapes
                  what it does next.
                </p>
              </div>

              <p className="text-sm text-gray-600 dark:text-gray-400">
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
                  className="flex-1 rounded-xl py-3.5 text-base font-medium text-gray-800 dark:text-gray-200 border border-gray-300 dark:border-gray-700 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
                >
                  🖼 Choose / paste
                </button>
              </div>

              {preview && (
                <img src={preview} alt="" className="w-full max-h-48 object-contain rounded-xl border border-gray-200 dark:border-gray-800" />
              )}

              {/* Optional note — they're holding the item, so what they can see beats
                  what the model thinks it sees. Also lets them ask a direct question. */}
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={2}
                placeholder="Anything to add? e.g. “base says Dinky Toys 741” or “which variant is this?” (optional)"
                className="w-full rounded-xl bg-gray-50 dark:bg-black/30 border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm text-gray-800 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500"
              />

              <button
                onClick={run}
                disabled={busy || !file}
                style={{ touchAction: "manipulation", background: file && !busy ? ACCENT : undefined }}
                className={`w-full rounded-xl py-4 text-base font-bold disabled:opacity-40 ${
                  file && !busy ? "text-black" : "text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-700"
                }`}
              >
                {busy ? "Looking…" : file ? "🔍 Identify it" : "Add a picture first"}
              </button>

              {error && (
                <div className="rounded-xl border border-red-300 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                  {error}
                </div>
              )}

              {/* ── What it is ── */}
              {id && (
                <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-black/20 p-4 space-y-2">
                  {id.identified ? (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-base font-bold text-gray-900 dark:text-white">
                            {[id.maker, id.model].filter(Boolean).join(" ") || "Unnamed item"}
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                            {[
                              id.catalogueNumber ? `No. ${id.catalogueNumber}` : null,
                              id.year,
                              id.variant,
                            ].filter(Boolean).join(" · ") || "no catalogue number found"}
                          </div>
                        </div>
                        <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
                          <span className={`text-[11px] px-2 py-1 rounded-lg border ${CONFIDENCE[id.confidence]?.cls ?? CONFIDENCE.low.cls}`}>
                            {CONFIDENCE[id.confidence]?.label ?? id.confidence}
                          </span>
                          {descText && (
                            <button
                              onClick={() => copyText(descText, "desc")}
                              style={{ touchAction: "manipulation" }}
                              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors whitespace-nowrap"
                            >
                              {copied === "desc" ? "✓ Copied" : "📋 Copy"}
                            </button>
                          )}
                        </div>
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
                              className="block text-xs text-blue-600 dark:text-blue-400 hover:underline truncate"
                            >
                              🔗 {s.title}
                            </a>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-amber-600 dark:text-amber-400">
                      Couldn&apos;t identify it from that photo{id.reasoning ? ` — ${id.reasoning}` : ""}. Try the base,
                      the markings or the box.
                    </p>
                  )}
                </div>
              )}

              {/* ── Suggested key points, ready to paste ──
                  ⚠ Key points are treated as AUTHORITATIVE by the batch AI — it is
                  told never to overrule them. So anything pasted from here becomes
                  fact downstream, which is exactly why this says check it first. */}
              {id?.keyPoints && (
                <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-black/20 p-4">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">Suggested key points</h3>
                    <button
                      onClick={() => copyText(id.keyPoints!, "kp")}
                      style={{ touchAction: "manipulation" }}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors whitespace-nowrap"
                    >
                      {copied === "kp" ? "✓ Copied" : "📋 Copy"}
                    </button>
                  </div>
                  <p className="text-sm text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-black/30 rounded-lg px-3 py-2 border border-gray-200 dark:border-gray-800">
                    {id.keyPoints}
                  </p>
                  <p className="text-[11px] text-amber-700 dark:text-amber-300/80 mt-2">
                    ⚠ Read it before you paste — key points are taken as fact when the descriptions
                    are written, so anything wrong here carries straight through.
                  </p>
                </div>
              )}

              {/* ── What we've made on them ── */}
              {result && (
                <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-black/20 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">What we&apos;ve sold them for</h3>
                    {summary && (
                      <span className="text-sm font-bold" style={{ color: ACCENT }}>
                        {summary.low === summary.high ? gbp(summary.low) : `${gbp(summary.low)} – ${gbp(summary.high)}`}
                      </span>
                    )}
                  </div>
                  {summary && (
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {summary.count >= 4 ? "The middle half of " : "From "}{summary.count} single-lot sale{summary.count === 1 ? "" : "s"}
                      {result.summaryBasis === "number" && id?.catalogueNumber ? ` with the same number (${id.catalogueNumber})` : ""}
                      {" "}· typically {gbp(summary.median)}
                      {summary.groupedExcluded > 0 ? ` · ${summary.groupedExcluded} group lot${summary.groupedExcluded === 1 ? "" : "s"} set aside` : ""}
                    </p>
                  )}
                  {/* One sale with the same number is worth saying out loud — measured: Kämmer &
                      Reinhardt 102 "Walter" made £43,000, while the similar dolls around it that
                      set the range made £80–£140. */}
                  {result.summaryBasis === "all" && sameNo.length === 1 && id?.catalogueNumber && (
                    <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                      Only one sale with the same number ({id.catalogueNumber}): <b>{gbp(sameNo[0].hammerPrice)}</b>
                      {sameNo[0].auctionDate ? `, ${fmtDate(sameNo[0].auctionDate)}` : ""}
                      {summary ? " — the range above is from similar lots." : ""}
                    </p>
                  )}
                  <p className="text-[11px] text-gray-600 mt-0.5 mb-2">
                    Checked against our BC sales and the ABC archive (1999–2023). Tap a lot to open it on vectis.co.uk.
                  </p>

                  {singles.length === 0 && groups.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      Nothing in our sold archive matches
                      {id?.searchTerms?.length ? ` "${id.searchTerms.join(" ")}"` : ""}. That doesn&apos;t mean much on
                      its own — the wording in old descriptions may simply differ.
                    </p>
                  ) : (
                    <div className="max-h-80 overflow-y-auto">
                      {singles.slice(0, 12).map((c, i) => <ComparableRow key={`s${i}`} c={c} />)}
                    </div>
                  )}

                  {/* Group lots are shown apart — a "group of 6" price says nothing
                      about the single item in the cataloguer's hand. */}
                  {groups.length > 0 && (
                    <details className="mt-2">
                      <summary className="text-xs text-gray-500 cursor-pointer">
                        {groups.length} group lot{groups.length === 1 ? "" : "s"} also matched — kept out of the range
                      </summary>
                      <div className="mt-2 max-h-64 overflow-y-auto">
                        {groups.slice(0, 8).map((c, i) => <ComparableRow key={`g${i}`} c={c} muted />)}
                      </div>
                    </details>
                  )}

                  {/* Everything else that matches — with filters, sorting and paging — is one tap away. */}
                  {result.searchText && (
                    <button
                      type="button"
                      onClick={openInSearch}
                      style={{ touchAction: "manipulation", color: ACCENT, border: `1px solid ${ACCENT}66` }}
                      className="mt-3 w-full min-h-[44px] rounded-xl px-3 text-sm font-semibold hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      🔎 See every match in Website Search — “{result.searchText}”
                    </button>
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
