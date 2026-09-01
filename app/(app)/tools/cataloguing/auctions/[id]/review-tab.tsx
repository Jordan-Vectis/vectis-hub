"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { setLotReviewFlag, saveLotDescription, saveAiFlagNote, resolveKeyPointsMistake, clearKeyPointsMistake, applyFlagFixes } from "@/lib/actions/catalogue"
import { saveAiFlagSnapshot } from "@/lib/actions/saved-ai-flags"
import LotPhotoViewer from "@/components/lot-photo-viewer"
import { analyseKeyPoints, HighlightedDescription, kpColour } from "@/lib/kp-analysis"
// ⚠ The one title rule, shared with the Generate Titles action — never re-derive it here.
import { titleFromDescription } from "@/lib/lot-title"
// Same check the AI routes use — never a second copy of the patterns here.
import { hasToolCallLeak, stripToolCallLeak } from "@/lib/description-cleanup"

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
  // Set when a checker confirmed the KEY POINTS were wrong rather than the description.
  // Optional — the columns may not exist until Run Migrations has been clicked.
  kpFixNote?: string | null
  kpFixedBy?: string | null
  kpFixedAt?: string | null
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

// ─── Bulk "Fix all AI-flagged" ────────────────────────────────────────────────
// One row per flagged lot. Every fix is generated and listed BEFORE anything is written
// (Jordan, 2026-08-17: preview, then apply) — 36 factual rewrites landing unread is exactly
// what the flag exists to prevent.
type BulkFix = {
  lot: ReviewLot
  status: "queued" | "working" | "ready" | "failed"
  keep: boolean
  description?: string
  keyPoints?: string | null   // non-null only when the AI corrected the cataloguer's notes
  note?: string
  error?: string
  attempt?: number
  waiting?: number            // seconds being waited out after a rate limit
}

// The key-point lines that actually differ, paired old → new, so the reader sees the one
// changed value instead of diffing two blocks of notes by eye.
function changedKpLines(before: string, after: string): { before: string; after: string }[] {
  const a = (before ?? "").split("\n")
  const b = (after ?? "").split("\n")
  const out: { before: string; after: string }[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const l = (a[i] ?? "").trim(), r = (b[i] ?? "").trim()
    if (l !== r) out.push({ before: l, after: r })
  }
  return out
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ─── Component ────────────────────────────────────────────────────────────────

export default function ReviewTab({ auctionId, kpMode = "strict" }: { auctionId: string; kpMode?: "strict" | "relaxed" }) {
  const [lots, setLots]       = useState<ReviewLot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [saveErr, setSaveErr] = useState<string | null>(null)   // shown inline at the Save button (not the far-off top banner)
  // ⚠ Auto-fix needs the same treatment for the same reason. It used to report through
  // the top-of-page `error` banner, which on a long Review list is far off screen — so a
  // failed fix looked exactly like nothing happening: the button said "Auto-fixing…" and
  // then went back to normal (Jordan, 2026-08-19: "it just resets and nothing is happening").
  const [fixErr, setFixErr] = useState<{ id: string; msg: string } | null>(null)
  // What the AI provider actually said the first time it refused. The per-lot chip only
  // ever showed "rate limited", which cannot tell a per-MINUTE limit (wait and it clears)
  // from a per-DAY one (waiting will never clear it) — so the detail is surfaced once.
  const [rateNote, setRateNote] = useState<string | null>(null)
  const [search, setSearch]   = useState("")
  const [flaggedOnly, setFlaggedOnly]       = useState(false)
  const [aiFlaggedOnly, setAiFlaggedOnly]   = useState(false)
  const [cataloguer, setCataloguer]   = useState("")
  const [savingFlags, setSavingFlags] = useState(false)
  type IssueFilter = "all" | "attention" | "wording" | "issues" | "good"
  const [issueFilter, setIssueFilter] = useState<IssueFilter>("all")
  const [photoLot, setPhotoLot] = useState<ReviewLot | null>(null)
  const [flagOpenId, setFlagOpenId] = useState<string | null>(null)
  const [flagText, setFlagText]     = useState("")
  const [editDescId, setEditDescId] = useState<string | null>(null)
  const [editDescText, setEditDescText] = useState("")
  const [photoIndex, setPhotoIndex] = useState(0)
  const [fixingId, setFixingId] = useState<string | null>(null)
  const [kpFixId, setKpFixId]     = useState<string | null>(null)
  const [kpFixText, setKpFixText] = useState("")
  const [kpErr, setKpErr]         = useState<string | null>(null)
  const [bulkOpen, setBulkOpen]         = useState(false)
  const [bulkFixes, setBulkFixes]       = useState<BulkFix[]>([])
  const [bulkRunning, setBulkRunning]   = useState(false)
  const [bulkApplying, setBulkApplying] = useState(false)
  const [bulkResult, setBulkResult]     = useState<string | null>(null)
  const [expandedFix, setExpandedFix]   = useState<string | null>(null)
  // Re-run the cataloguer-mistake check over the lots on screen (Jordan, 2026-09-01 — he
  // wanted it here rather than only on Auction AI → Auto Pipeline, which is where the
  // identical "⚠️ Re-check Cataloguer Flags" button already lives).
  const [recheckRunning, setRecheckRunning]   = useState(false)
  const [recheckProgress, setRecheckProgress] = useState<{ done: number; total: number } | null>(null)
  const [recheckMsg, setRecheckMsg]           = useState<string | null>(null)
  const recheckStopRef = useRef(false)
  const stopRef = useRef(false)
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
    new Map(lots.map(l => [l.id, analyseKeyPoints(l.description ?? "", l.keyPoints ?? "", kpMode)])),
  [lots, kpMode])

  const flaggedCount = lots.filter(l => l.reviewFlag).length
  const aiFlagCount  = lots.filter(l => l.aiFlagNote).length

  // Freeze this sale's flags into Admin → Saved Flagged Lots before an AI run replaces them.
  async function saveFlagsSnapshot() {
    if (savingFlags) return
    setSavingFlags(true)
    setError(null)
    try {
      const res = await saveAiFlagSnapshot(auctionId, `Review tab — ${new Date().toLocaleDateString("en-GB")}`)
      if (res.ok) {
        alert(`Saved ${res.saved} flagged lot${res.saved === 1 ? "" : "s"}.

Read them back any time at Admin → Saved Flagged Lots.`)
      } else {
        setError(res.error)
      }
    } catch (e: any) {
      setError(e?.message ?? "Could not save the flags")
    } finally { setSavingFlags(false) }
  }

  // ── Re-check the AI's cataloguer-mistake flags ──────────────────────────────
  // The same text-only pass the Auto Pipeline tab runs (/api/auction-ai/recheck-flags) —
  // one call per lot, no photos — but scoped to the lots CURRENTLY ON SCREEN, so the
  // filters above decide what it costs. With no filter set that is the whole sale.
  //
  // ⚠ It only ADDS flags; a lot that now comes back clean keeps the flag it already had.
  // That is the existing behaviour of this check and it is not changed here — use
  // "Ignore (AI is wrong)" on a lot to clear one.
  //
  // ⚠⚠ It SNAPSHOTS the current flags first, without being asked. Re-running the AI
  // overwrites every aiFlagNote with a bare update that never reaches the lot change log,
  // so a previous run's flags are otherwise gone with no trace — which is exactly why the
  // "💾 Save these flags" button next to it exists.
  async function handleRecheckFlags() {
    if (recheckRunning) return
    const toCheck = filtered.filter(l => l.description?.trim() && l.keyPoints?.trim())
    if (!toCheck.length) {
      setRecheckMsg("Nothing to check — these lots need both a description and key points.")
      return
    }
    const scope = filtered.length === lots.length ? "the whole sale" : "the lots matching the current filters"
    if (!confirm(
      `Re-check ${toCheck.length} lot${toCheck.length === 1 ? "" : "s"} (${scope}) for possible cataloguer mistakes?\n\n`
      + `That is one AI call each, so it takes a while and it costs. The flags on this sale are saved to `
      + `Admin → Saved Flagged Lots first. Anything already flagged stays flagged.`
    )) return

    setRecheckRunning(true); setRecheckMsg(null)
    recheckStopRef.current = false
    setRecheckProgress({ done: 0, total: toCheck.length })

    // Freeze what is there now — the run is about to overwrite it.
    if (aiFlagCount > 0) {
      try { await saveAiFlagSnapshot(auctionId, `Before re-check — ${new Date().toLocaleDateString("en-GB")}`) }
      catch { /* advisory — never block the run for it */ }
    }

    let flagCount = 0
    for (let i = 0; i < toCheck.length; i++) {
      if (recheckStopRef.current) break
      const lot = toCheck[i]
      setRecheckProgress({ done: i, total: toCheck.length })
      let attempt = 0
      while (!recheckStopRef.current) {
        attempt++
        try {
          const res = await fetch("/api/auction-ai/recheck-flags", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ keyPoints: lot.keyPoints, description: lot.description }),
          })
          if (res.status === 429) {
            // Same backoff the Auto Pipeline tab uses for this check.
            await new Promise(r => setTimeout(r, Math.min(60000 * Math.pow(2, attempt - 1), 300000)))
            continue
          }
          const data = await res.json()
          if (data.flag) {
            flagCount++
            await saveAiFlagNote(lot.id, data.flag)
            // Show it straight away rather than making him reload to see the run's work.
            setLots(prev => prev.map(l => l.id === lot.id ? { ...l, aiFlagNote: data.flag } : l))
          }
          break
        } catch {
          if (attempt >= 3) break
          await new Promise(r => setTimeout(r, attempt * 5000))
        }
      }
      if (i < toCheck.length - 1 && !recheckStopRef.current) await new Promise(r => setTimeout(r, 2000))
    }

    const done = recheckStopRef.current
    setRecheckProgress(null)
    setRecheckRunning(false)
    setRecheckMsg(
      (done ? "Stopped — " : "Done — ")
      + (flagCount > 0
          ? `${flagCount} possible cataloguer mistake${flagCount === 1 ? "" : "s"} flagged.`
          : `nothing new found across ${toCheck.length} lot${toCheck.length === 1 ? "" : "s"}.`)
    )
  }

  const cataloguers = useMemo(() =>
    [...new Set(lots.map(l => l.createdByName).filter(Boolean))].sort() as string[],
  [lots])

  // Issues are split in two, because they are not the same job (Jordan
  // 2026-07-31: almost every "issue" was only a wording check, which buried the
  // handful of real problems).
  //
  //  NEEDS ATTENTION — something is actually wrong or absent: a key point that
  //  isn't in the description at all, no description, no photos, or a human has
  //  flagged an error. These need fixing.
  //
  //  WORDING CHECK — the key point IS covered, just not word for word (partial,
  //  or "reworded" in relaxed mode). These only need reading.
  //
  // The buckets are exclusive — a lot with a missing key point AND a partial one
  // counts as "needs attention" only, so the two counts plus the all-good lots
  // add up to the total.
  //
  // ⚠ A lot whose key points a checker has confirmed WRONG (kpFixedAt) no longer counts for
  //  either. The matcher isn't mistaken on those — the key point really is absent — but the
  //  description is the correct one and there is nothing left to do, so leaving it in the
  //  count means it gets re-read on every pass for ever. A missing description or photos
  //  still counts; that verdict was only ever about the key points.
  function kpResolved(l: ReviewLot): boolean {
    return !!l.kpFixedAt
  }

  // ⚠⚠ The description is Gemini's SEARCH, written out instead of run — "tool_code
  // print(google_search.search(…))". It is not a description in any language and the lot needs
  // generating again. Kept ABOVE kpResolved: it is not a key-points verdict, so a lot someone
  // has already settled the key points on must still come back if its text is this.
  // (Jordan, 2026-09-01 — 10 lots on F113, three of them nothing but the leak.)
  function leakedSearch(l: ReviewLot): boolean {
    return hasToolCallLeak(l.description ?? "")
  }

  function needsAttention(l: ReviewLot): boolean {
    if (l.reviewFlag) return true
    if (!l.description?.trim() || l.imageUrls.length === 0) return true
    if (leakedSearch(l)) return true
    if (kpResolved(l)) return false
    const a = analysed.get(l.id)
    return !!a && a.matches.some(m => m.status === "missing")
  }

  function wordingOnly(l: ReviewLot): boolean {
    if (needsAttention(l) || kpResolved(l)) return false
    const a = analysed.get(l.id)
    return !!a && a.matches.some(m => m.status === "partial" || m.status === "reworded")
  }

  // Either bucket — what the old single "with issues" filter meant.
  function hasIssues(l: ReviewLot): boolean {
    return needsAttention(l) || wordingOnly(l)
  }

  const attentionCount = lots.filter(needsAttention).length
  const wordingCount   = lots.filter(wordingOnly).length

  const filtered = lots.filter(l => {
    if (l.id === editDescId) return true
    if (flaggedOnly && !l.reviewFlag) return false
    if (aiFlaggedOnly && !l.aiFlagNote) return false
    if (cataloguer && l.createdByName !== cataloguer) return false
    if (issueFilter === "attention" && !needsAttention(l)) return false
    if (issueFilter === "wording"   && !wordingOnly(l))    return false
    if (issueFilter === "issues"    && !hasIssues(l))      return false
    if (issueFilter === "good"      &&  hasIssues(l))      return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return [l.barcode, l.receiptUniqueId, l.title, l.description]
      .some(v => (v ?? "").toLowerCase().includes(q))
  })

  function saveFlag(lot: ReviewLot, flag: string | null) {
    setError(null)
    start(async () => {
      try {
        const res = await setLotReviewFlag(lot.id, auctionId, flag)
        if (!res?.ok) { setError(res?.error ?? "Couldn't save the flag."); return }
        setLots(prev => prev.map(l => l.id === lot.id
          ? { ...l, reviewFlag: flag, reviewFlaggedBy: flag ? "You" : null, reviewFlaggedAt: flag ? new Date().toISOString() : null }
          : l))
        setFlagOpenId(null)
        setFlagText("")
      } catch {
        setError("Couldn't save — the app may have just updated. Please reload the page and try again.")
      }
    })
  }

  function ignoreAiFlag(lot: ReviewLot) {
    setError(null)
    start(async () => {
      try {
        const res = await saveAiFlagNote(lot.id, null)
        if (!res?.ok) { setError(res?.error ?? "Couldn't dismiss the flag."); return }
        setLots(prev => prev.map(l => l.id === lot.id ? { ...l, aiFlagNote: null } : l))
      } catch {
        setError("Couldn't update — the app may have just updated. Please reload the page and try again.")
      }
    })
  }

  function saveDesc(lot: ReviewLot, description: string) {
    setSaveErr(null)
    start(async () => {
      try {
        // The action RETURNS its error (real reason, e.g. the BC lock) rather than
        // throwing — a thrown message is redacted in production.
        const res = await saveLotDescription(lot.id, auctionId, description)
        if (!res?.ok) { setSaveErr(res?.error ?? "Couldn't save — please try again."); return }
        setLots(prev => prev.map(l => l.id === lot.id ? { ...l, description, aiFlagNote: null } : l))
        setEditDescId(null)
        setEditDescText("")
        setSaveErr(null)
      } catch {
        // Transport-level failure (e.g. a mid-deploy blip) — the call itself failed.
        setSaveErr("Couldn't save — the app may have just updated. Please reload the page and try again.")
      }
    })
  }

  // "The key points were wrong, not the description."
  // Two outcomes, both recorded: pass the edited text to CORRECT the cataloguer's key points
  // (much the better one — every later AI run is measured against them), or pass null to leave
  // their notes untouched and simply record the verdict so the warning stops.
  function saveKpFix(lot: ReviewLot, keyPoints: string | null) {
    setKpErr(null)
    start(async () => {
      try {
        const res = await resolveKeyPointsMistake(lot.id, auctionId, keyPoints == null ? {} : { keyPoints })
        if (!res?.ok) { setKpErr(res?.error ?? "Couldn't save — please try again."); return }
        setLots(prev => prev.map(l => l.id === lot.id ? {
          ...l,
          keyPoints: keyPoints != null ? keyPoints.trim() : l.keyPoints,
          kpFixNote: keyPoints != null
            ? "Key points corrected — the cataloguer's notes were wrong"
            : "Cataloguer mistake — the key points were wrong, the description is right",
          kpFixedBy: "You",
          kpFixedAt: new Date().toISOString(),
        } : l))
        setKpFixId(null)
        setKpFixText("")
      } catch {
        setKpErr("Couldn't save — the app may have just updated. Please reload the page and try again.")
      }
    })
  }

  function undoKpFix(lot: ReviewLot) {
    setKpErr(null)
    start(async () => {
      try {
        const res = await clearKeyPointsMistake(lot.id, auctionId)
        if (!res?.ok) { setKpErr(res?.error ?? "Couldn't undo that."); return }
        setLots(prev => prev.map(l => l.id === lot.id
          ? { ...l, kpFixNote: null, kpFixedBy: null, kpFixedAt: null } : l))
      } catch {
        setKpErr("Couldn't undo — the app may have just updated. Please reload the page and try again.")
      }
    })
  }

  // Ask the AI to rewrite the description applying the flagged correction, then
  // drop it into the editor for a quick review — we never write AI output to the
  // catalogue unseen. The user clicks "Save description" to commit (which clears
  // the flag).
  async function autoFix(lot: ReviewLot) {
    setFixingId(lot.id)
    setError(null)
    setFixErr(null)
    try {
      const res = await fetch("/api/auction-ai/autofix-flag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyPoints: lot.keyPoints, description: lot.description, flagNote: lot.aiFlagNote }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Auto-fix failed")

      const fixed = String(data.description ?? "")
      // ⚠ The AI can legitimately decide the description is already right — which is
      // COMMON on these flags, since the code guard has usually put the cataloguer's
      // value back before the flag is ever raised. Opening an editor containing the
      // identical text reads as "nothing happened", so say so plainly instead.
      if (!fixed.trim() || fixed.trim() === (lot.description ?? "").trim()) {
        setFixErr({
          id: lot.id,
          msg: "The AI didn't change anything — it thinks the description is already right. If the key points are the thing that's wrong, use the key-points box above.",
        })
        return
      }
      setEditDescId(lot.id)
      setEditDescText(fixed)
    } catch (e: any) {
      setFixErr({ id: lot.id, msg: e?.message ?? "Auto-fix failed" })
    } finally {
      setFixingId(null)
    }
  }

  // ── Fix all AI-flagged ──────────────────────────────────────────────────────
  // Generate every correction first and list them; nothing is written until Apply.
  function patchFix(lotId: string, p: Partial<BulkFix>) {
    setBulkFixes(prev => prev.map(f => f.lot.id === lotId ? { ...f, ...p } : f))
  }

  async function runBulkFix(flagged: ReviewLot[]) {
    stopRef.current = false
    setBulkRunning(true)
    setRateNote(null)

    // ⚠ PACING. This was a flat 400ms between lots — about 150 requests a minute if
    // nothing blocks, far past any per-minute quota — so a sale with 59 flags was
    // rate limited on the FIRST lot and then crawled through the retry backoff
    // (Jordan, 2026-08-19: "instantly rate limited on the mass autofix"). For
    // comparison the batch route waits 12 SECONDS between lots (RULES.md).
    //
    // Rather than guess the right number, the gap ADAPTS: every refusal widens it
    // and it STAYS widened. The old code dropped straight back to 400ms after a
    // successful retry and tripped again immediately. It eases back only after a
    // run of clean lots, so a sale that is simply busy speeds up again on its own.
    //
    // ⚠⚠ MEASURED 2026-08-19, Google Cloud → Quotas on project "auction-ai":
    // "Request limit per model per minute for a project in the PAID TIER 1" is
    // **4** for gemini-omni-flash (20 for gemini-3-pro-image). Four a minute is
    // FIFTEEN SECONDS between calls — which is why the batch route's 12s exists
    // and why anything faster refuses immediately. So this starts at 8s and the
    // first refusal takes it to 16s, i.e. under a 4/min limit in ONE step rather
    // than crawling up from a value that was never going to work.
    let gap = 8_000
    let clean = 0
    const GAP_MAX = 60_000

    for (const lot of flagged) {
      if (stopRef.current) { patchFix(lot.id, { status: "failed", error: "Stopped", keep: false }); continue }
      patchFix(lot.id, { status: "working", waiting: undefined })

      for (let attempt = 1; ; attempt++) {
        if (stopRef.current) { patchFix(lot.id, { status: "failed", error: "Stopped", keep: false }); break }
        try {
          const res = await fetch("/api/auction-ai/autofix-flag", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ keyPoints: lot.keyPoints, description: lot.description, flagNote: lot.aiFlagNote }),
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error ?? "Auto-fix failed")
          patchFix(lot.id, {
            status: "ready", attempt, waiting: undefined,
            description: data.description,
            keyPoints:   data.keyPoints ?? null,
            note:        data.note ?? "",
          })
          // ⚠ Never eases below 8s — the measured quota makes anything faster futile.
          if (++clean >= 5) { gap = Math.max(8_000, Math.round(gap * 0.8)); clean = 0 }
          break
        } catch (e: any) {
          const msg: string = e?.message ?? "Auto-fix failed"
          // Rate limits are transient — wait it out rather than dropping the lot (RULES.md).
          // The countdown is on screen and Stop is always available, so this can't hang silently.
          if (/RATE_LIMITED|429/i.test(msg) && attempt < 8) {
            // Widen the gap for every lot after this one, and keep it widened.
            gap = Math.min(GAP_MAX, Math.max(gap * 2, 16_000))
            clean = 0
            setRateNote(prev => prev ?? msg.replace(/^RATE_LIMITED:\s*/i, "").slice(0, 400))
            const wait = Math.min(20 * attempt, 60)
            for (let s = wait; s > 0 && !stopRef.current; s--) {
              patchFix(lot.id, { status: "working", waiting: s, attempt })
              await sleep(1000)
            }
            continue
          }
          patchFix(lot.id, { status: "failed", error: msg, keep: false, waiting: undefined })
          break
        }
      }
      await sleep(gap)   // adaptive spacing — see the note at the top of this function
    }
    setBulkRunning(false)
  }

  function openBulkFix() {
    const flagged = lots.filter(l => l.aiFlagNote)
    if (flagged.length === 0) return
    setBulkFixes(flagged.map(lot => ({ lot, status: "queued", keep: true })))
    setBulkResult(null)
    setExpandedFix(null)
    setBulkOpen(true)
    void runBulkFix(flagged)
  }

  function retryFailed() {
    const again = bulkFixes.filter(f => f.status === "failed").map(f => f.lot)
    if (!again.length) return
    again.forEach(l => patchFix(l.id, { status: "queued", keep: true, error: undefined }))
    void runBulkFix(again)
  }

  function applyBulk() {
    const ready = bulkFixes.filter(f => f.status === "ready" && f.keep && f.description?.trim())
    if (!ready.length) return
    setBulkApplying(true)
    setBulkResult(null)
    start(async () => {
      try {
        const res = await applyFlagFixes(auctionId, ready.map(f => ({
          lotId: f.lot.id, description: f.description!, keyPoints: f.keyPoints ?? null,
        })))
        const failed = new Set(res.failed ?? [])
        setLots(prev => prev.map(l => {
          const f = ready.find(r => r.lot.id === l.id)
          if (!f || failed.has(l.id)) return l
          return {
            ...l,
            description: f.description!,
            title:       titleFromDescription(f.description!),
            aiFlagNote:  null,
            ...(f.keyPoints ? {
              keyPoints: f.keyPoints,
              kpFixNote: "Key points corrected while fixing an AI-flagged mistake",
              kpFixedBy: "You",
              kpFixedAt: new Date().toISOString(),
            } : {}),
          }
        }))
        setBulkFixes(prev => prev.filter(f => failed.has(f.lot.id) || !(f.status === "ready" && f.keep)))
        setBulkResult(res.errors.length
          ? `Saved ${res.applied} of ${ready.length}. ${res.errors.length} couldn't be saved — they're still listed.`
          : `✓ Saved ${res.applied} lot${res.applied === 1 ? "" : "s"}.`)
      } catch {
        setBulkResult("Couldn't save — the app may have just updated. Please reload the page and try again.")
      } finally {
        setBulkApplying(false)
      }
    })
  }

  const bulkReady   = bulkFixes.filter(f => f.status === "ready").length
  const bulkKept    = bulkFixes.filter(f => f.status === "ready" && f.keep).length
  const bulkFailed  = bulkFixes.filter(f => f.status === "failed").length
  const bulkDoneCnt = bulkFixes.filter(f => f.status === "ready" || f.status === "failed").length

  if (loading) return <p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">Loading lots…</p>

  return (
    <div className="space-y-4 pb-10">

      {/* Sticky header — count, search, flagged filter */}
      <div className="sticky top-0 z-10 bg-gray-50 dark:bg-[#141416] -mx-1 px-1 py-3 space-y-2 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            <span className="font-bold text-gray-900 dark:text-white">{filtered.length}</span> of {lots.length} lots
            {kpMode === "relaxed" && (
              <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300"
                title="Set in Auction Settings. Key points whose numbers, codes and sizes are all present but whose wording differs show as amber ‘reworded — check wording’ instead of red.">
                ✍ Relaxed wording matching
              </span>
            )}
            {attentionCount > 0 && (
              <button
                onClick={() => setIssueFilter(f => (f === "attention" ? "all" : "attention"))}
                title="Something is wrong or missing: a key point that isn't in the description at all, no description, no photos, or an error someone has flagged."
                className={`ml-2 font-semibold rounded px-1.5 py-0.5 transition-colors ${
                  issueFilter === "attention"
                    ? "bg-red-500/20 text-red-400 ring-1 ring-red-500/50"
                    : "text-red-500 hover:bg-red-500/10"
                }`}
              >
                ⚠ {attentionCount} need{attentionCount === 1 ? "s" : ""} attention
              </button>
            )}
            {wordingCount > 0 && (
              <button
                onClick={() => setIssueFilter(f => (f === "wording" ? "all" : "wording"))}
                title="The key points ARE covered, just not word for word — read them over. Nothing is missing on these."
                className={`ml-2 font-semibold rounded px-1.5 py-0.5 transition-colors ${
                  issueFilter === "wording"
                    ? "bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/50"
                    : "text-amber-500 hover:bg-amber-500/10"
                }`}
              >
                ≈ {wordingCount} wording check{wordingCount === 1 ? "" : "s"}
              </button>
            )}
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
              onChange={e => setIssueFilter(e.target.value as IssueFilter)}
              className="bg-white dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-[#2AB4A6]"
            >
              <option value="all">All lots</option>
              <option value="attention">⚠ Needs attention</option>
              <option value="wording">≈ Wording to check</option>
              <option value="issues">Either of the above</option>
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
            {aiFlagCount > 0 && (
              <button
                onClick={openBulkFix}
                title="Work through every AI-flagged lot in one go. Each correction is listed for you to read before anything is saved."
                className="px-3 py-2 text-sm font-semibold rounded-lg border border-emerald-500 bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-600/20 transition-colors whitespace-nowrap"
              >
                ✨ Fix all AI-flagged ({aiFlagCount})
              </button>
            )}
            {/* ⚠ Re-running the AI overwrites every aiFlagNote with a bare update that does not
                reach the lot change log, so the previous run's flags are gone with no trace.
                This freezes them first — read them back at Admin → Saved Flagged Lots. */}
            {(aiFlagCount > 0 || lots.some(l => l.reviewFlag)) && (
              <button
                onClick={saveFlagsSnapshot}
                disabled={savingFlags}
                title="Freeze the flags on this sale before the AI overwrites them. Kept in Admin → Saved Flagged Lots."
                className="px-3 py-2 text-sm font-semibold rounded-lg border border-orange-500 bg-orange-600/10 text-orange-600 dark:text-orange-400 hover:bg-orange-600/20 disabled:opacity-40 transition-colors whitespace-nowrap"
              >
                {savingFlags ? "Saving…" : "💾 Save these flags"}
              </button>
            )}
            {/* Re-run the cataloguer-mistake check over what is on screen. Scoped to the
                filters above on purpose — it is one AI call per lot, so "all 507" should be
                a choice rather than the only option. */}
            {recheckRunning ? (
              <button
                onClick={() => { recheckStopRef.current = true }}
                className="px-3 py-2 text-sm font-semibold rounded-lg border border-red-500 bg-red-600/10 text-red-600 dark:text-red-400 hover:bg-red-600/20 transition-colors whitespace-nowrap"
              >
                ✕ Stop{recheckProgress ? ` (${recheckProgress.done}/${recheckProgress.total})` : ""}
              </button>
            ) : (
              <button
                onClick={handleRecheckFlags}
                title="Ask the AI again whether any key point looks wrong, on the lots currently shown. One call per lot. Existing flags are saved to Admin → Saved Flagged Lots first, and anything already flagged stays flagged."
                className="px-3 py-2 text-sm font-semibold rounded-lg border border-orange-500 bg-orange-600/10 text-orange-600 dark:text-orange-400 hover:bg-orange-600/20 transition-colors whitespace-nowrap"
              >
                ⚠️ Re-check AI flags ({filtered.filter(l => l.description?.trim() && l.keyPoints?.trim()).length})
              </button>
            )}
          </div>
        </div>
        {recheckMsg && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {recheckMsg}
            <button onClick={() => setRecheckMsg(null)} className="ml-2 underline hover:text-gray-700 dark:hover:text-gray-200">dismiss</button>
          </p>
        )}
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
        // A confirmed key-points mistake retires the three warning pills — the per-line ⚠ stays
        // in the list below, so you can still see WHICH key point was the wrong one.
        const kpDone   = kpResolved(lot)
        const missing  = kpDone ? 0 : a.matches.filter(m => m.status === "missing").length
        const partial  = kpDone ? 0 : a.matches.filter(m => m.status === "partial").length
        const reworded = kpDone ? 0 : a.matches.filter(m => m.status === "reworded").length
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
                {leakedSearch(lot) && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 font-medium"
                    title="The description is the AI's own search, written out instead of run. Nothing to do with the cataloguer — the lot needs generating again.">
                    ⚠ Not a description
                  </span>
                )}
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
                {reworded > 0 && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-medium"
                    title="All the numbers, codes and sizes in these key points are present, but the wording differs — read the description to check the facts survived.">
                    ✍ {reworded} reworded — check wording
                  </span>
                )}
                {kpDone && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-medium"
                    title={lot.kpFixNote ?? undefined}>
                    ✓ Key points were the mistake
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

            {/* ⚠⚠ The description is the AI's SEARCH, not a description. Its own banner, ABOVE the
                amber "possible cataloguer mistake" one, because that banner is exactly what these
                lots wrongly produce: Double Check reads the mess, invents a code trying to rewrite
                it, and the lot gets read as the CATALOGUER's mistake. Say plainly that it is not. */}
            {leakedSearch(lot) && (
              <div className="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 px-4 py-3">
                <p className="text-xs uppercase tracking-wider text-red-500 dark:text-red-400 font-semibold mb-1">⚠ This is not a description</p>
                <p className="text-sm text-red-700 dark:text-red-300 mb-2">
                  The AI wrote out the web search it wanted to run instead of running it, and broke off
                  mid-answer to do it. <strong>Nothing to do with the cataloguer.</strong> The lot needs its
                  description generating again — re-run it in Auction AI, then check the key points are covered.
                </p>
                {stripToolCallLeak(lot.description ?? "").text.trim() ? (
                  <p className="text-xs text-red-500 dark:text-red-400/90">
                    All it managed before it broke off: “{stripToolCallLeak(lot.description ?? "").text.trim()}”
                  </p>
                ) : (
                  <p className="text-xs text-red-500 dark:text-red-400/90">It wrote no description at all — the whole text is the search.</p>
                )}
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
                    <div className="flex gap-2 items-center">
                      <button onClick={() => saveDesc(lot, editDescText)} disabled={pending || !editDescText.trim()}
                        className="px-4 py-2 text-sm font-semibold rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white transition-colors">
                        {pending ? "Saving…" : "Save description"}
                      </button>
                      <button onClick={() => { setEditDescId(null); setEditDescText(""); setSaveErr(null) }}
                        className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 transition-colors">
                        Cancel
                      </button>
                    </div>
                    {saveErr && <p className="text-sm text-red-600 dark:text-red-400 font-medium">{saveErr}</p>}
                  </div>
                ) : (
                  <div className="flex items-center gap-4 flex-wrap">
                    <button
                      onClick={() => autoFix(lot)}
                      disabled={fixingId === lot.id || pending}
                      className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 hover:underline disabled:opacity-40">
                      {fixingId === lot.id ? "Auto-fixing…" : "✨ Auto-fix (apply AI's advice)"}
                    </button>
                    <button
                      onClick={() => { setEditDescId(lot.id); setEditDescText(lot.description ?? "") }}
                      className="text-sm font-medium text-orange-600 dark:text-orange-400 hover:underline">
                      Edit description to fix…
                    </button>
                    <button
                      onClick={() => ignoreAiFlag(lot)}
                      disabled={pending}
                      className="text-sm text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-40 transition-colors">
                      Ignore (AI is wrong)
                    </button>
                    {fixErr?.id === lot.id && (
                      <p className="basis-full text-sm text-red-600 dark:text-red-400 font-medium">
                        {fixErr.msg}
                        <button onClick={() => setFixErr(null)} className="ml-3 opacity-60 hover:opacity-100">✕</button>
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Photo + key points side by side (stacks on narrow screens) */}
            <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-4">
              {/* Photo */}
              <div>
                {lot.imageUrls.length > 0 ? (
                  <button onClick={() => { setPhotoIndex(0); setPhotoLot(lot) }} className="relative block w-full">
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
                          <span className={`shrink-0 ${m.status === "found" ? "text-green-500" : m.status === "missing" ? "text-red-500" : "text-amber-500"}`}>
                            {m.status === "found" ? "✓" : m.status === "partial" ? "≈" : m.status === "reworded" ? "✍" : "⚠"}
                          </span>
                          {m.status !== "missing" && (
                            <span className={`shrink-0 w-2.5 h-2.5 rounded-full mt-1.5 ${kpColour(i).dot}`} title="Highlight colour in the description" />
                          )}
                          <span className={
                            m.status === "found"   ? "text-gray-700 dark:text-gray-300"
                            : m.status === "missing" ? "text-red-700 dark:text-red-300 font-medium"
                            : "text-amber-700 dark:text-amber-300 font-medium"
                          }>{m.line}</span>
                          {/* ⚠ Name the part, not just the verdict. "not found" made the reader
                              diff a whole line against the description by eye; "not found: 7"
                              points straight at the edition number the AI got wrong. */}
                          {m.status === "partial" && (
                            <span className="text-xs text-amber-500/80 shrink-0 mt-0.5">
                              partly worded{m.missing.length > 0 ? ` — missing: ${m.missing.slice(0, 4).join(", ")}` : " — check"}
                            </span>
                          )}
                          {m.status === "reworded" && (
                            <span className="text-xs text-amber-500/80 shrink-0 mt-0.5"
                              title="The numbers, codes and sizes are all present but the wording differs — read the description to check the facts survived.">
                              reworded{m.missing.length > 0 ? ` — wording differs on: ${m.missing.slice(0, 4).join(", ")}` : " — check wording"}
                            </span>
                          )}
                          {m.status === "missing" && (
                            <span className="text-xs text-red-500/80 shrink-0 mt-0.5"
                              title={m.missing.length > 0 ? "These parts of the key point could not be found anywhere in the description." : undefined}>
                              not found{m.missing.length > 0 ? `: ${m.missing.slice(0, 5).join(", ")}` : ""}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>

                    {/* ── "The key points are wrong, not the description" ──────────────
                        Editing the description cannot clear a key-point warning: the wrong
                        text is in the KEY POINTS. Correcting them here both clears it and
                        leaves the right facts for the next AI run to be measured against. */}
                    {kpResolved(lot) ? (
                      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 flex items-start justify-between gap-3 flex-wrap">
                        <p className="text-xs text-emerald-600 dark:text-emerald-400">
                          ✓ {lot.kpFixNote}
                          <span className="text-gray-500 dark:text-gray-500">
                            {lot.kpFixedBy ? ` — ${lot.kpFixedBy}` : ""}
                            {lot.kpFixedAt ? ` · ${new Date(lot.kpFixedAt).toLocaleDateString("en-GB")}` : ""}
                          </span>
                        </p>
                        <button onClick={() => undoKpFix(lot)} disabled={pending}
                          className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 underline disabled:opacity-50">
                          Undo
                        </button>
                      </div>
                    ) : kpFixId === lot.id ? (
                      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 space-y-2">
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                          Correct the cataloguer's key points below — every AI run is checked against these,
                          so putting them right stops the same warning coming back.
                        </p>
                        <textarea
                          value={kpFixText}
                          onChange={e => setKpFixText(e.target.value)}
                          rows={Math.min(8, Math.max(3, kpFixText.split("\n").length + 1))}
                          autoFocus
                          className="w-full bg-white dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500"
                        />
                        <div className="flex gap-2 items-center flex-wrap">
                          <button
                            onClick={() => saveKpFix(lot, kpFixText)}
                            disabled={pending || !kpFixText.trim() || kpFixText.trim() === (lot.keyPoints ?? "").trim()}
                            title={kpFixText.trim() === (lot.keyPoints ?? "").trim() ? "Nothing has been changed yet" : undefined}
                            className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white transition-colors">
                            {pending ? "Saving…" : "Save corrected key points"}
                          </button>
                          <button
                            onClick={() => saveKpFix(lot, null)}
                            disabled={pending}
                            title="Records that the key points were the mistake and leaves them exactly as the cataloguer wrote them. The warning stops."
                            className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-emerald-500 disabled:opacity-40 transition-colors">
                            Leave them — just mark it as a mistake
                          </button>
                          <button onClick={() => { setKpFixId(null); setKpFixText(""); setKpErr(null) }}
                            className="px-3 py-1.5 text-sm text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
                            Cancel
                          </button>
                        </div>
                        {kpErr && <p className="text-sm text-red-600 dark:text-red-400 font-medium">{kpErr}</p>}
                      </div>
                    ) : a.matches.some(m => m.status !== "found") ? (
                      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                        <button
                          onClick={() => { setKpFixId(lot.id); setKpFixText(lot.keyPoints ?? ""); setKpErr(null) }}
                          title="Use this when the description is right and it is the cataloguer's key points that are wrong — a mistyped catalogue number, for instance."
                          className="text-sm text-gray-500 dark:text-gray-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">
                          ✏ The key points are wrong, not the description…
                        </button>
                      </div>
                    ) : null}
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
                <div className="flex gap-2 items-center">
                  <button onClick={() => saveDesc(lot, editDescText)} disabled={pending || !editDescText.trim()}
                    className="px-4 py-2 text-sm font-semibold rounded-lg bg-[#C8A96E] hover:bg-[#b8945a] disabled:opacity-40 text-black transition-colors">
                    {pending ? "Saving…" : "Save description"}
                  </button>
                  <button onClick={() => { setEditDescId(null); setEditDescText(""); setSaveErr(null) }}
                    className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 transition-colors">
                    Cancel
                  </button>
                </div>
                {saveErr && <p className="text-sm text-red-600 dark:text-red-400 font-medium mt-1">{saveErr}</p>}
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

      {/* ── Fix all AI-flagged: generate everything, then read it, then save ───────── */}
      {bulkOpen && (
        <div className="fixed inset-0 z-[55] flex items-start justify-center bg-black/70 p-3 sm:p-6 overflow-y-auto">
          <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-2xl w-full max-w-6xl my-4 flex flex-col max-h-[92vh]">

            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800 flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">✨ Fix all AI-flagged lots</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                  {bulkRunning
                    ? `Working out the corrections — ${bulkDoneCnt} of ${bulkFixes.length} done. Nothing is saved yet. This is deliberately slow: the AI quota allows only a few requests a minute.`
                    : `${bulkReady} correction${bulkReady === 1 ? "" : "s"} ready to read${bulkFailed ? `, ${bulkFailed} failed` : ""}. Nothing is saved until you press Save.`}
                </p>
                {/* ⚠ "rate limited" on a chip cannot tell a per-MINUTE limit (waiting clears
                    it) from a per-DAY one (waiting never will). Show what the provider
                    actually said, once, so the difference is visible. */}
                {rateNote && (
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-2 max-w-2xl">
                    <strong>The AI is refusing requests:</strong> {rateNote}
                    <br />
                    Each refusal widens the gap between lots automatically. If it mentions a
                    <em> daily</em> quota, waiting won&apos;t help — it needs a different model in
                    Admin → AI Models, or tomorrow.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {bulkRunning && (
                  <button onClick={() => { stopRef.current = true }}
                    className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                    Stop
                  </button>
                )}
                <button onClick={() => { stopRef.current = true; setBulkOpen(false) }}
                  className="text-gray-400 hover:text-gray-700 dark:hover:text-white text-2xl leading-none px-2">✕</button>
              </div>
            </div>

            {/* Progress bar while generating */}
            {bulkRunning && (
              <div className="h-1 bg-gray-200 dark:bg-gray-800 shrink-0">
                <div className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${bulkFixes.length ? (bulkDoneCnt / bulkFixes.length) * 100 : 0}%` }} />
              </div>
            )}

            {/* Rows */}
            <div className="overflow-y-auto px-5 py-4 space-y-3 flex-1">
              {bulkFixes.length === 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">Nothing left to fix.</p>
              )}
              {bulkFixes.map(f => {
                const kpLines = f.keyPoints ? changedKpLines(f.lot.keyPoints ?? "", f.keyPoints) : []
                const open = expandedFix === f.lot.id
                return (
                  <div key={f.lot.id}
                    className={`rounded-xl border px-4 py-3 ${
                      f.status === "failed" ? "border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20"
                      : f.status === "ready" && f.keep ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/15"
                      : "border-gray-200 dark:border-gray-800"
                    }`}>
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={f.keep && f.status === "ready"}
                        disabled={f.status !== "ready" || bulkApplying}
                        onChange={e => patchFix(f.lot.id, { keep: e.target.checked })}
                        className="mt-1 w-5 h-5 shrink-0 accent-emerald-600 disabled:opacity-30"
                      />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-bold text-gray-900 dark:text-white">
                            {f.lot.barcode ?? f.lot.receiptUniqueId ?? f.lot.id}
                          </span>
                          {f.status === "queued"  && <span className="text-xs text-gray-500">waiting…</span>}
                          {f.status === "working" && (
                            <span className="text-xs text-amber-500">
                              {f.waiting ? `rate limited — retrying in ${f.waiting}s (attempt ${f.attempt})` : "working it out…"}
                            </span>
                          )}
                          {f.status === "ready" && f.note && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                              {f.note}
                            </span>
                          )}
                          {f.keyPoints && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300"
                              title="The wrong fact is in the cataloguer's key points, so those are corrected too — otherwise the next AI run puts it straight back.">
                              ✏ also corrects the key points
                            </span>
                          )}
                        </div>

                        {/* The AI's own flag — the reason this lot is here */}
                        <p className="text-xs text-orange-700 dark:text-orange-300/90 whitespace-pre-wrap">{f.lot.aiFlagNote}</p>

                        {f.status === "failed" && (
                          <p className="text-xs text-red-600 dark:text-red-400 font-medium">{f.error}</p>
                        )}

                        {/* Key points: only the lines that changed */}
                        {kpLines.length > 0 && (
                          <div className="text-sm space-y-0.5 pt-1">
                            {kpLines.map((l, i) => (
                              <div key={i} className="flex flex-wrap items-baseline gap-2">
                                <span className="line-through text-red-600/80 dark:text-red-400/80">{l.before || "(blank)"}</span>
                                <span className="text-gray-400">→</span>
                                <span className="font-semibold text-emerald-700 dark:text-emerald-300">{l.after || "(removed)"}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {f.status === "ready" && (
                          <button onClick={() => setExpandedFix(open ? null : f.lot.id)}
                            className="text-xs text-gray-500 hover:text-[#C8A96E] underline">
                            {open ? "Hide the description change" : "Show the description change"}
                          </button>
                        )}
                        {open && (
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pt-1">
                            <div>
                              <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">Now</p>
                              <p className="text-xs whitespace-pre-wrap text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-black/30 rounded-lg p-2 border border-gray-200 dark:border-gray-800">{f.lot.description}</p>
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-1">After the fix</p>
                              <p className="text-xs whitespace-pre-wrap text-gray-800 dark:text-gray-200 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg p-2 border border-emerald-200 dark:border-emerald-900">{f.description}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-800 flex items-center gap-3 flex-wrap">
              <button
                onClick={applyBulk}
                disabled={bulkRunning || bulkApplying || bulkKept === 0}
                className="px-5 py-2.5 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white transition-colors">
                {bulkApplying ? "Saving…" : `Save ${bulkKept} lot${bulkKept === 1 ? "" : "s"}`}
              </button>
              {bulkFailed > 0 && !bulkRunning && (
                <button onClick={retryFailed} disabled={bulkApplying}
                  className="px-4 py-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40">
                  Try the {bulkFailed} that failed again
                </button>
              )}
              <button onClick={() => { stopRef.current = true; setBulkOpen(false) }}
                className="px-4 py-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                Close
              </button>
              {bulkResult && (
                <p className={`text-sm font-medium ${bulkResult.startsWith("✓") ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                  {bulkResult}
                </p>
              )}
              {!bulkRunning && bulkKept === 0 && bulkReady === 0 && bulkFixes.length > 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-400">Nothing is ticked to save.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Photos — enlarge and zoom, shared with Admin → Saved Flagged Lots so the two cannot
          drift. Replaced a grid-then-fullscreen pair that could not zoom, which is what you
          actually need to check a product code against the description. */}
      {photoLot && (
        <LotPhotoViewer
          images={photoLot.imageUrls}
          label={photoLot.barcode ?? photoLot.receiptUniqueId ?? ""}
          index={photoIndex}
          onIndex={setPhotoIndex}
          onClose={() => setPhotoLot(null)}
        />
      )}

    </div>
  )
}
