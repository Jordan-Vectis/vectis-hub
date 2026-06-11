"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { setLotReviewFlag, saveLotDescription } from "@/lib/actions/catalogue"

// ─── Types ────────────────────────────────────────────────────────────────────

type ReviewLot = {
  id: string
  barcode: string | null
  receiptUniqueId: string | null
  title: string
  keyPoints: string
  description: string
  estimateLow: number | null
  estimateHigh: number | null
  aiEstimateLow: number | null
  aiEstimateHigh: number | null
  condition: string | null
  category: string | null
  subCategory: string | null
  brand: string | null
  status: string
  imageUrls: string[]
  createdByName: string | null
  reviewFlag: string | null
  reviewFlaggedBy: string | null
  reviewFlaggedAt: string | null
  aiFlagNote: string | null
}

// ─── Key point ↔ description matching ────────────────────────────────────────
// Descriptions weave key points in naturally (reordered words, extra words in
// between — "perforated card" → "perforated header card"), so exact-phrase
// matching is too strict. Strategy per key-point line:
//   1. Try the exact phrase (case/whitespace-insensitive) — best highlight.
//   2. Otherwise match word-by-word: every significant word found = ✓ found,
//      most found = ≈ partial, otherwise ⚠ not found. Matched words highlighted.

type KpStatus = "found" | "partial" | "missing"
type KpMatch = { line: string; status: KpStatus }
type Range = { start: number; end: number; kp: number } // kp = key-point index → colour

// One colour per key point — dot in the list pairs with the highlight in the text.
// Static class strings so Tailwind picks them up.
const KP_COLOURS = [
  { mark: "bg-teal-200 dark:bg-teal-700/60",       dot: "bg-teal-400 dark:bg-teal-500" },
  { mark: "bg-amber-200 dark:bg-amber-700/60",     dot: "bg-amber-400 dark:bg-amber-500" },
  { mark: "bg-sky-200 dark:bg-sky-700/60",         dot: "bg-sky-400 dark:bg-sky-500" },
  { mark: "bg-fuchsia-200 dark:bg-fuchsia-700/60", dot: "bg-fuchsia-400 dark:bg-fuchsia-500" },
  { mark: "bg-lime-200 dark:bg-lime-700/60",       dot: "bg-lime-400 dark:bg-lime-500" },
  { mark: "bg-orange-200 dark:bg-orange-700/60",   dot: "bg-orange-400 dark:bg-orange-500" },
  { mark: "bg-violet-200 dark:bg-violet-700/60",   dot: "bg-violet-400 dark:bg-violet-500" },
  { mark: "bg-rose-200 dark:bg-rose-700/60",       dot: "bg-rose-400 dark:bg-rose-500" },
]
const kpColour = (i: number) => KP_COLOURS[i % KP_COLOURS.length]

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "in", "on", "to", "with", "for", "its",
  "is", "are", "has", "have", "at", "by", "from", "as", "inside", "within",
  "all", "this", "that", "it", "be", "been", "etc",
])

function esc(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") }

function significantWords(line: string): string[] {
  return line
    .toLowerCase()
    .split(/[^a-z0-9£"']+/i)
    .map(w => w.replace(/^['"]+|['"]+$/g, ""))
    .filter(w => (w.length >= 3 || /^\d{2,}$/.test(w)) && !STOPWORDS.has(w))
}

// Regex for one word: word boundary on the stem, tolerate suffix differences —
// "electronic" matches "Electronico", "carded" matches "card", "screams" matches
// "scream", "packaging" matches "packaged".
function wordRegex(word: string): RegExp {
  let stem = word
  for (const suf of ["ing", "ed", "es", "s"]) {
    if (stem.endsWith(suf) && stem.length - suf.length >= 4) { stem = stem.slice(0, -suf.length); break }
  }
  return new RegExp(`\\b${esc(stem)}\\w{0,4}\\b`, "gi")
}

function analyseKeyPoints(description: string, keyPoints: string): { matches: KpMatch[]; ranges: Range[] } {
  const lines = keyPoints.split("\n").map(l => l.trim()).filter(Boolean)
  const matches: KpMatch[] = []
  const ranges: Range[] = []

  for (let kpIdx = 0; kpIdx < lines.length; kpIdx++) {
    const line = lines[kpIdx]

    // 1) Exact phrase match — single contiguous highlight
    let phraseMatched = false
    try {
      const pattern = esc(line).replace(/\\?\s+/g, "\\s+")
      const m = new RegExp(pattern, "i").exec(description)
      if (m) {
        phraseMatched = true
        ranges.push({ start: m.index, end: m.index + m[0].length, kp: kpIdx })
      }
    } catch { /* fall through to word matching */ }

    if (phraseMatched) {
      matches.push({ line, status: "found" })
      continue
    }

    // 2) Word-level match
    const words = significantWords(line)
    if (words.length === 0) {
      matches.push({ line, status: "missing" })
      continue
    }

    let matched = 0
    for (const w of words) {
      const re = wordRegex(w)
      let any = false
      let m: RegExpExecArray | null
      while ((m = re.exec(description)) !== null) {
        any = true
        ranges.push({ start: m.index, end: m.index + m[0].length, kp: kpIdx })
        if (m.index === re.lastIndex) re.lastIndex++ // safety against zero-width loops
      }
      if (any) matched++
    }

    const ratio = matched / words.length
    matches.push({ line, status: ratio === 1 ? "found" : ratio >= 0.5 ? "partial" : "missing" })
  }

  // Resolve overlaps while keeping per-key-point colours: earlier key points win
  // the overlapping stretch; the later range keeps only its non-overlapping tail.
  ranges.sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: Range[] = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (!last || r.start >= last.end) merged.push({ ...r })
    else if (r.end > last.end) {
      if (last.kp === r.kp) last.end = r.end
      else merged.push({ start: last.end, end: r.end, kp: r.kp })
    }
    // else fully inside the previous range — drop
  }

  return { matches, ranges: merged }
}

function HighlightedDescription({ description, ranges }: { description: string; ranges: Range[] }) {
  if (!ranges.length) {
    return <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed whitespace-pre-wrap">{description}</p>
  }
  const parts: React.ReactNode[] = []
  let cursor = 0
  ranges.forEach((r, i) => {
    if (r.start > cursor) parts.push(<span key={`p${i}`}>{description.slice(cursor, r.start)}</span>)
    parts.push(
      <mark key={`m${i}`} className={`${kpColour(r.kp).mark} text-gray-900 dark:text-white rounded px-0.5`}>
        {description.slice(r.start, r.end)}
      </mark>
    )
    cursor = r.end
  })
  if (cursor < description.length) parts.push(<span key="tail">{description.slice(cursor)}</span>)
  return <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed whitespace-pre-wrap">{parts}</p>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function proxyUrl(key: string) {
  return `/api/catalogue/photo-proxy?key=${encodeURIComponent(key)}`
}

function fmtEstimate(low: number | null, high: number | null): string | null {
  if (low == null && high == null) return null
  if (low != null && high != null) return `£${low.toLocaleString("en-GB")}–£${high.toLocaleString("en-GB")}`
  return `£${(low ?? high)!.toLocaleString("en-GB")}`
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ReviewTab({ auctionId }: { auctionId: string }) {
  const [lots, setLots]       = useState<ReviewLot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [search, setSearch]   = useState("")
  const [flaggedOnly, setFlaggedOnly]       = useState(false)
  const [aiFlaggedOnly, setAiFlaggedOnly]   = useState(false)
  const [cataloguer, setCataloguer]   = useState("")
  const [issueFilter, setIssueFilter] = useState<"all" | "issues" | "good">("all")
  const [photoLot, setPhotoLot] = useState<ReviewLot | null>(null)
  const [flagOpenId, setFlagOpenId] = useState<string | null>(null)
  const [flagText, setFlagText]     = useState("")
  const [editDescId, setEditDescId] = useState<string | null>(null)
  const [editDescText, setEditDescText] = useState("")
  const [fullscreenImg, setFullscreenImg] = useState<string | null>(null)
  const [pending, start] = useTransition()

  useEffect(() => {
    let cancelled = false
    fetch(`/api/catalogue/review-lots?auctionId=${encodeURIComponent(auctionId)}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        if (data.error) setError(data.error)
        else setLots(data.lots ?? [])
      })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [auctionId])

  const analysed = useMemo(() =>
    new Map(lots.map(l => [l.id, analyseKeyPoints(l.description ?? "", l.keyPoints ?? "")])),
  [lots])

  const flaggedCount = lots.filter(l => l.reviewFlag).length
  const aiFlagCount  = lots.filter(l => l.aiFlagNote).length

  const cataloguers = useMemo(() =>
    [...new Set(lots.map(l => l.createdByName).filter(Boolean))].sort() as string[],
  [lots])

  // A lot "has issues" if any key point is missing/partial, or it lacks a
  // description or photos, or it has been flagged.
  function hasIssues(l: ReviewLot): boolean {
    if (l.reviewFlag) return true
    if (!l.description?.trim() || l.imageUrls.length === 0) return true
    const a = analysed.get(l.id)
    return !!a && a.matches.some(m => m.status !== "found")
  }

  const issueCount = lots.filter(hasIssues).length

  const filtered = lots.filter(l => {
    if (flaggedOnly && !l.reviewFlag) return false
    if (aiFlaggedOnly && !l.aiFlagNote) return false
    if (cataloguer && l.createdByName !== cataloguer) return false
    if (issueFilter === "issues" && !hasIssues(l)) return false
    if (issueFilter === "good"   &&  hasIssues(l)) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return [l.barcode, l.receiptUniqueId, l.title, l.description]
      .some(v => (v ?? "").toLowerCase().includes(q))
  })

  function saveFlag(lot: ReviewLot, flag: string | null) {
    start(async () => {
      try {
        await setLotReviewFlag(lot.id, auctionId, flag)
        setLots(prev => prev.map(l => l.id === lot.id
          ? { ...l, reviewFlag: flag, reviewFlaggedBy: flag ? "You" : null, reviewFlaggedAt: flag ? new Date().toISOString() : null }
          : l))
        setFlagOpenId(null)
        setFlagText("")
      } catch (e: any) {
        setError(e?.message ?? "Failed to save flag")
      }
    })
  }

  function saveDesc(lot: ReviewLot, description: string) {
    start(async () => {
      try {
        await saveLotDescription(lot.id, auctionId, description)
        setLots(prev => prev.map(l => l.id === lot.id ? { ...l, description, aiFlagNote: null } : l))
        setEditDescId(null)
        setEditDescText("")
      } catch (e: any) {
        setError(e?.message ?? "Failed to save description")
      }
    })
  }

  if (loading) return <p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">Loading lots…</p>

  return (
    <div className="space-y-4 pb-10">

      {/* Sticky header — count, search, flagged filter */}
      <div className="sticky top-0 z-10 bg-gray-50 dark:bg-[#141416] -mx-1 px-1 py-3 space-y-2 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            <span className="font-bold text-gray-900 dark:text-white">{filtered.length}</span> of {lots.length} lots
            {issueCount > 0 && <span className="ml-2 text-amber-500 font-semibold">⚠ {issueCount} with issues</span>}
            {flaggedCount > 0 && <span className="ml-2 text-red-500 font-semibold">🚩 {flaggedCount} flagged</span>}
            {aiFlagCount > 0 && <span className="ml-2 text-orange-400 font-semibold">⚠️ {aiFlagCount} AI-flagged</span>}
          </p>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search barcode / ID / text…"
              className="w-44 sm:w-56 bg-white dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-[#2AB4A6]"
            />
            <select
              value={cataloguer}
              onChange={e => setCataloguer(e.target.value)}
              className="bg-white dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-[#2AB4A6]"
            >
              <option value="">All cataloguers</option>
              {cataloguers.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
            <select
              value={issueFilter}
              onChange={e => setIssueFilter(e.target.value as "all" | "issues" | "good")}
              className="bg-white dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-[#2AB4A6]"
            >
              <option value="all">All lots</option>
              <option value="issues">⚠ With issues</option>
              <option value="good">✓ All good</option>
            </select>
            <button
              onClick={() => setFlaggedOnly(v => !v)}
              className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors whitespace-nowrap ${
                flaggedOnly
                  ? "bg-red-600/20 border-red-500 text-red-400"
                  : "bg-white dark:bg-[#2C2C2E] border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400"
              }`}
            >
              🚩 Flagged only
            </button>
            <button
              onClick={() => setAiFlaggedOnly(v => !v)}
              className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors whitespace-nowrap ${
                aiFlaggedOnly
                  ? "bg-orange-600/20 border-orange-500 text-orange-400"
                  : "bg-white dark:bg-[#2C2C2E] border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400"
              }`}
            >
              ⚠️ AI-flagged only
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 rounded-xl px-4 py-3 text-sm text-red-600 dark:text-red-300 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-3">✕</button>
        </div>
      )}

      {filtered.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-10 text-center">
          {lots.length === 0 ? "No lots in this auction yet." : "No lots match the current filter."}
        </p>
      )}

      {/* Lot cards */}
      {filtered.map(lot => {
        const a = analysed.get(lot.id)!
        const est   = fmtEstimate(lot.estimateLow, lot.estimateHigh)
        const aiEst = fmtEstimate(lot.aiEstimateLow, lot.aiEstimateHigh)
        const missing = a.matches.filter(m => m.status === "missing").length
        const partial = a.matches.filter(m => m.status === "partial").length
        const isFlagOpen = flagOpenId === lot.id

        return (
          <div key={lot.id}
            className={`rounded-2xl border p-4 sm:p-5 space-y-4 bg-white dark:bg-[#1C1C1E] ${
              lot.reviewFlag ? "border-red-500/70" : "border-gray-200 dark:border-gray-800"
            }`}>

            {/* Header row */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="font-mono text-base font-bold text-gray-900 dark:text-white">
                  {lot.barcode ?? lot.receiptUniqueId ?? lot.id}
                  {lot.barcode && lot.receiptUniqueId && (
                    <span className="ml-2 text-xs font-normal text-gray-500">{lot.receiptUniqueId}</span>
                  )}
                </p>
                {lot.title && <p className="text-sm text-gray-600 dark:text-gray-400 truncate max-w-[60vw]">{lot.title}</p>}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {missing > 0 && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 font-medium">
                    ⚠ {missing} key point{missing === 1 ? "" : "s"} not found
                  </span>
                )}
                {partial > 0 && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-medium">
                    ≈ {partial} partial
                  </span>
                )}
                <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">{lot.status}</span>
              </div>
            </div>

            {/* Flagged banner */}
            {lot.reviewFlag && (
              <div className="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 px-4 py-3">
                <p className="text-xs uppercase tracking-wider text-red-500 dark:text-red-400 font-semibold mb-1">🚩 Flagged</p>
                <p className="text-sm text-red-700 dark:text-red-300 whitespace-pre-wrap">{lot.reviewFlag}</p>
                <div className="flex items-center justify-between mt-2">
                  <p className="text-xs text-red-400/80">
                    {lot.reviewFlaggedBy ?? ""}{lot.reviewFlaggedAt ? ` · ${new Date(lot.reviewFlaggedAt).toLocaleString("en-GB")}` : ""}
                  </p>
                  <button onClick={() => saveFlag(lot, null)} disabled={pending}
                    className="text-xs text-red-500 hover:text-red-400 underline disabled:opacity-50">
                    Remove flag
                  </button>
                </div>
              </div>
            )}

            {/* AI-flagged potential cataloguer mistake */}
            {lot.aiFlagNote && (
              <div className="rounded-xl bg-orange-50 dark:bg-orange-950/30 border border-orange-300 dark:border-orange-700 px-4 py-3">
                <p className="text-xs uppercase tracking-wider text-orange-500 dark:text-orange-400 font-semibold mb-1">⚠️ Possible cataloguer mistake (flagged by AI)</p>
                <p className="text-sm text-orange-800 dark:text-orange-200 whitespace-pre-wrap mb-2">{lot.aiFlagNote}</p>
                {editDescId === lot.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={editDescText}
                      onChange={e => setEditDescText(e.target.value)}
                      rows={5}
                      autoFocus
                      className="w-full bg-white dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-orange-400"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => saveDesc(lot, editDescText)} disabled={pending || !editDescText.trim()}
                        className="px-4 py-2 text-sm font-semibold rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white transition-colors">
                        {pending ? "Saving…" : "Save description"}
                      </button>
                      <button onClick={() => { setEditDescId(null); setEditDescText("") }}
                        className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { setEditDescId(lot.id); setEditDescText(lot.description ?? "") }}
                    className="text-sm font-medium text-orange-600 dark:text-orange-400 hover:underline">
                    Edit description to fix…
                  </button>
                )}
              </div>
            )}

            {/* Photo + key points side by side (stacks on narrow screens) */}
            <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-4">
              {/* Photo */}
              <div>
                {lot.imageUrls.length > 0 ? (
                  <button onClick={() => setPhotoLot(lot)} className="relative block w-full">
                    <img
                      src={proxyUrl(lot.imageUrls[0])}
                      alt={lot.barcode ?? "Lot photo"}
                      loading="lazy"
                      className="w-full aspect-square object-cover rounded-xl border border-gray-200 dark:border-gray-700"
                    />
                    {lot.imageUrls.length > 1 && (
                      <span className="absolute bottom-2 right-2 text-xs px-2 py-0.5 rounded-full bg-black/70 text-white">
                        1 / {lot.imageUrls.length}
                      </span>
                    )}
                  </button>
                ) : (
                  <div className="w-full aspect-square rounded-xl border border-dashed border-gray-300 dark:border-gray-700 flex items-center justify-center text-xs text-red-400">
                    No photos
                  </div>
                )}

                {/* Details under the photo */}
                <div className="mt-3 space-y-1.5 text-sm">
                  {est && <p><span className="text-gray-500 dark:text-gray-500">Estimate:</span> <span className="font-semibold text-[#2AB4A6]">{est}</span></p>}
                  {!est && aiEst && <p><span className="text-gray-500 dark:text-gray-500">AI Est:</span> <span className="font-semibold text-purple-400">{aiEst}</span></p>}
                  {lot.condition && <p><span className="text-gray-500 dark:text-gray-500">Condition:</span> <span className="text-gray-700 dark:text-gray-300">{lot.condition}</span></p>}
                  {(lot.category || lot.subCategory) && (
                    <p><span className="text-gray-500 dark:text-gray-500">Category:</span> <span className="text-gray-700 dark:text-gray-300">{[lot.category, lot.subCategory].filter(Boolean).join(" / ")}</span></p>
                  )}
                  {lot.brand && <p><span className="text-gray-500 dark:text-gray-500">Brand:</span> <span className="text-gray-700 dark:text-gray-300">{lot.brand}</span></p>}
                  {lot.createdByName && <p><span className="text-gray-500 dark:text-gray-500">Cataloguer:</span> <span className="text-gray-700 dark:text-gray-300">{lot.createdByName}</span></p>}
                </div>
              </div>

              {/* Key points + description */}
              <div className="space-y-3 min-w-0">
                {a.matches.length > 0 && (
                  <div className="rounded-xl bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-gray-700 px-4 py-3">
                    <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">Key Points</p>
                    <ul className="space-y-1">
                      {a.matches.map((m, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <span className={`shrink-0 ${m.status === "found" ? "text-green-500" : m.status === "partial" ? "text-amber-500" : "text-red-500"}`}>
                            {m.status === "found" ? "✓" : m.status === "partial" ? "≈" : "⚠"}
                          </span>
                          {m.status !== "missing" && (
                            <span className={`shrink-0 w-2.5 h-2.5 rounded-full mt-1.5 ${kpColour(i).dot}`} title="Highlight colour in the description" />
                          )}
                          <span className={
                            m.status === "found"   ? "text-gray-700 dark:text-gray-300"
                            : m.status === "partial" ? "text-amber-700 dark:text-amber-300 font-medium"
                            : "text-red-700 dark:text-red-300 font-medium"
                          }>{m.line}</span>
                          {m.status === "partial" && <span className="text-xs text-amber-500/80 shrink-0 mt-0.5">partly worded — check</span>}
                          {m.status === "missing" && <span className="text-xs text-red-500/80 shrink-0 mt-0.5">not found</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-500 mb-1.5">Description</p>
                  {lot.description?.trim()
                    ? <HighlightedDescription description={lot.description} ranges={a.ranges} />
                    : <p className="text-sm text-red-400 italic">No description</p>}
                </div>
              </div>
            </div>

            {/* Edit description (available on all lots) */}
            {editDescId === lot.id && !lot.aiFlagNote ? (
              <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#2C2C2E]/50 p-3 space-y-2">
                <textarea
                  value={editDescText}
                  onChange={e => setEditDescText(e.target.value)}
                  rows={6}
                  autoFocus
                  className="w-full bg-white dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-[#C8A96E]"
                />
                <div className="flex gap-2">
                  <button onClick={() => saveDesc(lot, editDescText)} disabled={pending || !editDescText.trim()}
                    className="px-4 py-2 text-sm font-semibold rounded-lg bg-[#C8A96E] hover:bg-[#b8945a] disabled:opacity-40 text-black transition-colors">
                    {pending ? "Saving…" : "Save description"}
                  </button>
                  <button onClick={() => { setEditDescId(null); setEditDescText("") }}
                    className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

            {/* Flag an error + edit buttons row */}
            {(editDescId !== lot.id || lot.aiFlagNote) && (
              <div className="flex items-center gap-4 flex-wrap">
                {!lot.reviewFlag && (
                  isFlagOpen ? (
                    <div className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20 p-3 space-y-2 w-full">
                      <textarea
                        value={flagText}
                        onChange={e => setFlagText(e.target.value)}
                        rows={3}
                        autoFocus
                        placeholder="What's wrong with this lot? e.g. wrong set number, key point missing from description…"
                        className="w-full bg-white dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-red-400"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => saveFlag(lot, flagText)} disabled={pending || !flagText.trim()}
                          className="px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white transition-colors">
                          {pending ? "Saving…" : "Save flag"}
                        </button>
                        <button onClick={() => { setFlagOpenId(null); setFlagText("") }}
                          className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 transition-colors">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => { setFlagOpenId(lot.id); setFlagText("") }}
                      className="text-sm text-gray-500 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                      🚩 Flag an error…
                    </button>
                  )
                )}
                {!isFlagOpen && !lot.aiFlagNote && (
                  <button onClick={() => { setEditDescId(lot.id); setEditDescText(lot.description ?? "") }}
                    className="text-sm text-gray-500 dark:text-gray-500 hover:text-[#C8A96E] dark:hover:text-[#C8A96E] transition-colors">
                    ✏ Edit description
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Fullscreen image overlay */}
      {fullscreenImg && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95" onClick={() => setFullscreenImg(null)}>
          <button onClick={() => setFullscreenImg(null)} className="absolute top-4 right-4 text-white/70 hover:text-white text-3xl leading-none px-3">✕</button>
          <img src={fullscreenImg} alt="Fullscreen photo" className="max-w-full max-h-full object-contain" onClick={e => e.stopPropagation()} />
        </div>
      )}

      {/* Photo viewer */}
      {photoLot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setPhotoLot(null)}>
          <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-2xl p-4 max-w-2xl w-full max-h-[90vh] overflow-y-auto space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="font-mono font-semibold text-gray-900 dark:text-white">{photoLot.barcode ?? photoLot.receiptUniqueId}</span>
              <button onClick={() => setPhotoLot(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-white text-2xl leading-none px-2">✕</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {photoLot.imageUrls.map((key, i) => (
                <button key={key} onClick={() => setFullscreenImg(proxyUrl(key))} className="relative group block w-full text-left">
                  <img src={proxyUrl(key)} alt={`Photo ${i + 1}`} loading="lazy"
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 object-contain" />
                  <span className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 text-white text-xs px-2 py-1 rounded-lg">⛶ Fullscreen</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
