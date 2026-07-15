"use client"

import { useEffect, useRef, useState } from "react"
import { uploadLotPhoto } from "@/lib/actions/catalogue"

interface Props {
  auctionId: string
  lots: { id: string; barcode: string | null; receiptUniqueId?: string | null }[]
  onUploaded: () => void
}

interface LotGroup {
  lotId:    string | null
  label:    string
  photos:   File[]
  aiRead?:          boolean   // the barcode scanner missed this label; AI read the printed code
  unreadableLabel?: boolean   // AI says this is a label photo but couldn't read the code
}

type Phase = "idle" | "scanning" | "preview" | "uploading" | "done"
type Mode  = "scan" | "filename"

// ── Filename barcode / unique-ID parser ───────────────────────────────────────
// Strips the extension then removes any trailing _N suffix so that:
//   "F066001.jpg"      → "F066001"
//   "F066001_2.jpg"    → "F066001"
//   "R000016-413_1.jpg"→ "R000016-413"
function parseBarcode(filename: string): string {
  const noExt = filename.replace(/\.[^.]+$/, "")  // strip extension
  return noExt.replace(/_\d+$/, "")               // strip trailing _N suffix
}

// Order-preserving concurrency pool: results land at their item's index no
// matter which worker finishes first, so the sequential grouping stays correct.
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  onProgress?: (done: number) => void
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  let done = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
      done++
      onProgress?.(done)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

function loadImgElement(file: File): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file)
    const el  = new Image()
    el.onload  = () => { URL.revokeObjectURL(url); res(el) }
    el.onerror = () => { URL.revokeObjectURL(url); rej(new Error("load failed")) }
    el.src = url
  })
}

// Shrink a photo to a small JPEG before sending it to the AI check — a 1000px
// image is plenty to spot/read a label and keeps each batch small. Returns null
// when the browser can't decode the file (HEIC on Windows); the caller sends
// the original instead, since Gemini reads HEIC natively.
async function toJpegBlob(file: File, maxW = 1000): Promise<Blob | null> {
  try {
    const img = await loadImgElement(file)
    const scale = Math.min(1, maxW / img.naturalWidth)
    const c = document.createElement("canvas")
    c.width  = Math.max(1, Math.round(img.naturalWidth * scale))
    c.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = c.getContext("2d")!
    ctx.drawImage(img, 0, 0, c.width, c.height)
    return await new Promise<Blob | null>(res => c.toBlob(b => res(b), "image/jpeg", 0.75))
  } catch {
    return null
  }
}

// Thumbnail with a fallback tile for images the browser can't display
// (typically HEIC on Windows) — the file still uploads fine.
function Thumb({ url, name }: { url: string; name: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div title={name}
        className="w-14 h-14 rounded-md bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 flex items-center justify-center text-lg flex-shrink-0">
        🖼️
      </div>
    )
  }
  return (
    <img src={url} alt={name} title={name} loading="lazy" onError={() => setFailed(true)}
      className="w-14 h-14 rounded-md object-cover border border-gray-300 dark:border-gray-700 flex-shrink-0" />
  )
}

export default function PhotoUploadTab({ auctionId, lots, onUploaded }: Props) {
  const scanInputRef               = useRef<HTMLInputElement>(null)
  const filenameInputRef           = useRef<HTMLInputElement>(null)
  const [mode, setMode]            = useState<Mode | null>(null)
  const [phase, setPhase]          = useState<Phase>("idle")
  const [groups, setGroups]        = useState<LotGroup[]>([])
  const [preGroup, setPreGroup]    = useState<File[]>([])       // scan mode: photos before the first barcode
  const [unreadable, setUnreadable] = useState(0)               // scan mode: files the browser couldn't decode (HEIC etc.)
  const [scanProgress, setScanProgress]     = useState({ done: 0, total: 0 })
  const [scanStage, setScanStage]           = useState<"local" | "ai">("local")  // scanning phase sub-stage
  const [aiProgress, setAiProgress]         = useState({ done: 0, total: 0 })
  const [aiFailed, setAiFailed]             = useState(false)   // AI check errored/skipped for some photos — grouping fell back to scanner-only
  const [aiReadCount, setAiReadCount]       = useState(0)       // labels the scanner missed but AI read
  const skipAiRef  = useRef(false)                              // user pressed "Skip AI check"
  const aiAbortRef = useRef<AbortController | null>(null)       // in-flight AI request, for skip + timeout
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 })
  const [error, setError]          = useState<string | null>(null)
  const [skipped, setSkipped]      = useState<string[]>([])
  const [okLotCount, setOkLotCount] = useState(0)              // lots that actually received ≥1 photo

  // Object URLs for preview thumbnails — created once per file when groups are
  // built, revoked on reset/unmount.
  const thumbUrls = useRef(new Map<File, string>())
  function makeThumbs(files: File[]) {
    for (const f of files) {
      if (!thumbUrls.current.has(f)) thumbUrls.current.set(f, URL.createObjectURL(f))
    }
  }
  function revokeThumbs() {
    thumbUrls.current.forEach(u => URL.revokeObjectURL(u))
    thumbUrls.current.clear()
  }
  useEffect(() => () => revokeThumbs(), [])

  // Lookup: barcode / receiptUniqueId → lot id
  const lotMap = new Map([
    ...lots.filter(l => l.barcode).map(l => [l.barcode!.toLowerCase().trim(), l.id] as [string, string]),
    ...lots.filter(l => l.receiptUniqueId).map(l => [l.receiptUniqueId!.toLowerCase().trim(), l.id] as [string, string]),
  ])

  // ── Reset to idle ─────────────────────────────────────────────────────────────
  function reset() {
    revokeThumbs()
    setMode(null)
    setPhase("idle")
    setGroups([])
    setPreGroup([])
    setUnreadable(0)
    setScanStage("local")
    setAiProgress({ done: 0, total: 0 })
    setAiFailed(false)
    setAiReadCount(0)
    setSkipped([])
    setOkLotCount(0)
    setError(null)
  }

  // ── MODE: match by filename ───────────────────────────────────────────────────
  function handleFilenameFiles(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null)
    const files = Array.from(e.target.files ?? []).filter(
      f => f.type.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(f.name)
    )
    e.target.value = ""
    if (files.length === 0) return

    // Sort by filename so _1, _2 etc. end up in order
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

    // Group by extracted barcode / unique-ID
    const groupMap = new Map<string, LotGroup>()
    const orderedKeys: string[] = []

    for (const file of files) {
      const barcode = parseBarcode(file.name)
      const key     = barcode.toLowerCase().trim()
      if (!groupMap.has(key)) {
        const lotId = lotMap.get(key) ?? null
        groupMap.set(key, { lotId, label: barcode, photos: [] })
        orderedKeys.push(key)
      }
      groupMap.get(key)!.photos.push(file)
    }

    const result = orderedKeys.map(k => {
      const g = groupMap.get(k)!
      g.photos.reverse()
      return g
    })

    if (result.length === 0) {
      setError("No files selected.")
      return
    }

    makeThumbs(files)
    setGroups(result)
    setPhase("preview")
  }

  // ── MODE: scan barcodes from images ──────────────────────────────────────────
  async function handleScanFiles(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null)
    const files = Array.from(e.target.files ?? []).filter(
      f => f.type.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(f.name)
    )
    e.target.value = ""
    if (files.length === 0) return

    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

    setPhase("scanning")
    setScanStage("local")
    setScanProgress({ done: 0, total: files.length })
    setAiProgress({ done: 0, total: 0 })
    setAiFailed(false)
    setAiReadCount(0)
    skipAiRef.current = false

    const nativeDetector = "BarcodeDetector" in window
      ? new (window as any).BarcodeDetector({ formats: ["code_128", "code_39", "qr_code", "ean_13"] })
      : null

    const [{ HTMLCanvasElementLuminanceSource }, { MultiFormatReader, BinaryBitmap, HybridBinarizer, DecodeHintType }] =
      await Promise.all([import("@zxing/browser"), import("@zxing/library")])
    const hints = new Map()
    hints.set(DecodeHintType.TRY_HARDER, true)
    const zxing = new MultiFormatReader()
    zxing.setHints(hints)

    // Accept both Vectis barcode formats:
    //   F066001 / F0660012  — tote/item barcodes (letter + 6-7 digits)
    //   R000016-413         — receipt unique IDs (letter + digits + dash + digits)
    // Rejects product EANs, ISBNs, etc.
    function isVectisBarcode(s: string): boolean {
      return /^[A-Za-z]\d{6,7}$/.test(s.trim()) || /^[A-Za-z]\d{4,7}-\d{1,6}$/.test(s.trim())
    }

    // unreadable = the browser couldn't decode the image at all (HEIC on
    // Windows/Android) — a label in such a photo can never be detected.
    async function decodeBarcode(file: File): Promise<{ barcode: string | null; unreadable: boolean }> {
      let imgEl: HTMLImageElement
      try {
        imgEl = await loadImgElement(file)
      } catch {
        return { barcode: null, unreadable: true }
      }
      try {
        const naturalW = imgEl.naturalWidth
        const naturalH = imgEl.naturalHeight

        function toCanvas(targetW: number, scanMode: "normal" | "contrast" | "bw" = "normal"): HTMLCanvasElement {
          const scale = Math.min(1, targetW / naturalW)
          const w = Math.round(naturalW * scale)
          const h = Math.round(naturalH * scale)
          const c = document.createElement("canvas")
          c.width = w; c.height = h
          const ctx = c.getContext("2d")!
          ctx.fillStyle = "#ffffff"
          ctx.fillRect(0, 0, w, h)
          if (scanMode === "contrast") ctx.filter = "contrast(400%) grayscale(100%)"
          ctx.drawImage(imgEl, 0, 0, w, h)
          if (scanMode === "bw") {
            const id = ctx.getImageData(0, 0, w, h)
            for (let i = 0; i < id.data.length; i += 4) {
              const v = 0.299 * id.data[i] + 0.587 * id.data[i+1] + 0.114 * id.data[i+2] > 128 ? 255 : 0
              id.data[i] = id.data[i+1] = id.data[i+2] = v
            }
            ctx.putImageData(id, 0, 0)
          }
          return c
        }

        if (nativeDetector) {
          for (const targetW of [naturalW, 900]) {
            for (const scanMode of ["normal", "contrast", "bw"] as const) {
              const c = toCanvas(targetW, scanMode)
              try {
                const bmp     = await createImageBitmap(c)
                const results = await nativeDetector.detect(bmp)
                if (results.length > 0) {
                  const raw = (results[0].rawValue as string).replace(/[^\x20-\x7E]/g, "").trim()
                  if (raw && isVectisBarcode(raw)) return { barcode: raw, unreadable: false }
                }
              } catch {}
            }
          }
        }

        for (const targetW of [2000, 1200]) {
          for (const scanMode of ["normal", "bw"] as const) {
            const c = toCanvas(targetW, scanMode)
            try {
              const luminance = new HTMLCanvasElementLuminanceSource(c)
              const bitmap    = new BinaryBitmap(new HybridBinarizer(luminance))
              const decoded   = zxing.decodeWithState(bitmap).getText().replace(/[^\x20-\x7E]/g, "").trim()
              if (isVectisBarcode(decoded)) return { barcode: decoded, unreadable: false }
            } catch {}
          }
        }
        return { barcode: null, unreadable: false }
      } catch {
        return { barcode: null, unreadable: false }
      }
    }

    // Decode up to 3 images at once (order-preserving), then group sequentially.
    const decoded = await mapPool(files, 3, decodeBarcode,
      done => setScanProgress({ done, total: files.length }))

    // ── AI second pass ────────────────────────────────────────────────────────
    // Every photo the scanner could NOT decode goes to Gemini, which answers:
    // is this a barcode LABEL photo or an ITEM photo, and if a label, what does
    // the printed code say? Two wins: a blurry label the scanner missed can
    // still be read, and a label AI can SEE but not read still breaks the
    // grouping (instead of silently merging two lots). Unreadable-in-browser
    // files (HEIC) are sent as originals — Gemini reads HEIC.
    // If the AI check fails entirely, grouping proceeds scanner-only + warns.
    const aiCodes       = new Map<number, string>()   // file index → code AI read
    const aiLabelUnread = new Set<number>()           // file index → label AI couldn't read
    let   aiErrored     = false

    const candidates = decoded.map((d, i) => (d.barcode ? -1 : i)).filter(i => i >= 0)
    if (candidates.length > 0) {
      setScanStage("ai")
      setAiProgress({ done: 0, total: candidates.length })

      // Build the actual payloads FIRST (a downscaled JPEG is ~200KB; the
      // original could be 8MB), so batches are sized by what is really sent —
      // sizing by original bytes collapsed batches to 1-2 photos and swamped
      // Gemini with 8× the requests.
      type AiItem = { i: number; payload: Blob | File }
      const items: AiItem[] = []
      let unchecked = 0
      for (const i of candidates) {
        if (skipAiRef.current) { unchecked += 1; continue }
        if (files[i].size === 0) { unchecked++; continue }   // glitched transfer / iCloud placeholder
        const blob = decoded[i].unreadable ? null : await toJpegBlob(files[i])
        const payload = blob ?? files[i]                     // HEIC original — Gemini reads it
        if (payload.size > 15_000_000) { unchecked++; continue }
        items.push({ i, payload })
      }

      const batches: AiItem[][] = []
      let cur: AiItem[] = []
      let curBytes = 0
      for (const it of items) {
        if (cur.length >= 8 || (cur.length > 0 && curBytes + it.payload.size > 12_000_000)) {
          batches.push(cur); cur = []; curBytes = 0
        }
        cur.push(it); curBytes += it.payload.size
      }
      if (cur.length > 0) batches.push(cur)

      let doneCount = unchecked
      let consecutiveFails = 0
      for (const batch of batches) {
        // Escape hatches: the user pressed Skip, or Gemini is clearly down /
        // rate-limited (2 whole batches failed in a row) — stop burning time,
        // fall back to scanner-only grouping and say so.
        if (skipAiRef.current || consecutiveFails >= 2) {
          aiErrored = true
          doneCount += batch.length
          setAiProgress({ done: doneCount, total: candidates.length })
          continue
        }

        const fd = new FormData()
        batch.forEach((it, j) => fd.append(`photo_${j}`, it.payload, files[it.i].name))

        let ok = false
        for (let attempt = 0; attempt < 3 && !ok && !skipAiRef.current; attempt++) {
          const ctrl = new AbortController()
          aiAbortRef.current = ctrl
          const timer = setTimeout(() => ctrl.abort(), 150_000)  // route maxDuration is 120s
          try {
            const res  = await fetch("/api/catalogue/scan-photos", { method: "POST", body: fd, signal: ctrl.signal })
            const data = await res.json().catch(() => null)
            if (res.ok && Array.isArray(data?.photos) && data.photos.length === batch.length) {
              data.photos.forEach((p: any, j: number) => {
                const i = batch[j].i
                if (typeof p?.code === "string" && p.code) aiCodes.set(i, p.code)
                else if (p?.label === true) aiLabelUnread.add(i)
              })
              ok = true
            } else if (res.status === 422) {
              break   // content block — retrying can never help
            } else if (attempt < 2) {
              // 429 = Gemini rate limit — wait longer. Never sleep after the
              // final attempt; that was pure dead time.
              await new Promise(r => setTimeout(r, res.status === 429 ? (attempt + 1) * 15000 : 4000))
            }
          } catch {
            if (attempt < 2 && !skipAiRef.current) await new Promise(r => setTimeout(r, 4000))
          } finally {
            clearTimeout(timer)
            aiAbortRef.current = null
          }
        }
        if (ok) consecutiveFails = 0
        else { aiErrored = true; consecutiveFails++ }

        doneCount += batch.length
        setAiProgress({ done: doneCount, total: candidates.length })
      }

      if (unchecked > 0 || skipAiRef.current) aiErrored = true
    }

    const result: LotGroup[] = []
    const pre: File[] = []
    let unreadableCount = 0
    let aiRead = 0
    let current: LotGroup | null = null

    for (let i = 0; i < files.length; i++) {
      const d = decoded[i]
      if (d.unreadable) unreadableCount++
      const aiCode = aiCodes.get(i)
      const code   = d.barcode ?? aiCode ?? null
      if (code) {
        const key   = code.toLowerCase().trim()
        const lotId = lotMap.get(key) ?? null
        const aiOnly = !d.barcode && !!aiCode
        if (aiOnly) aiRead++
        current = { lotId, label: code, photos: [], aiRead: aiOnly }
        result.push(current)
      } else if (aiLabelUnread.has(i)) {
        // AI is sure this is a label photo but couldn't read the code: break
        // the group here so the following photos can't pollute the previous
        // lot, and KEEP the label photo so the user can read it by eye.
        current = { lotId: null, label: `Unreadable label — ${files[i].name}`, photos: [files[i]], unreadableLabel: true }
        result.push(current)
      } else if (current) {
        current.photos.push(files[i])
      } else {
        pre.push(files[i])
      }
    }

    if (result.length === 0) {
      // The AI pass has already run at this point, so say what it did — a total
      // miss with a WORKING AI check means the labels genuinely aren't there,
      // while a failed AI check on HEIC files means "convert to JPEG" advice.
      const aiNote = candidates.length === 0 ? ""
        : aiErrored ? " The AI check couldn't run fully, so it may have missed labels too."
        : " AI also checked every photo and found no readable labels."
      if (unreadableCount === files.length && aiErrored) {
        setError(`None of the ${files.length} photos could be read on this device — they're probably HEIC format (the iPhone default) — and the AI check couldn't run. Convert them to JPEG and rescan, or run the scan on an iPad.`)
      } else if (unreadableCount > 0) {
        setError(`No barcodes detected. ${unreadableCount} of the ${files.length} photos couldn't be shown on this device (probably HEIC format).${aiNote} Make sure the lot label photos are included and in focus.`)
      } else {
        setError(`No barcodes detected in any of the images.${aiNote} Make sure the lot label photos are included and in focus.`)
      }
      setPhase("idle")
      return
    }

    makeThumbs(files)
    setGroups(result)
    setPreGroup(pre)
    setUnreadable(unreadableCount)
    setAiFailed(aiErrored)
    setAiReadCount(aiRead)
    setPhase("preview")
  }

  // ── Upload (shared by both modes) ─────────────────────────────────────────────
  async function handleUpload() {
    const uploadable = groups.filter(g => g.lotId && g.photos.length > 0)
    if (uploadable.length === 0) { setError("No matched lots with photos to upload."); return }

    const total = uploadable.reduce((sum, g) => sum + g.photos.length, 0)
    setUploadProgress({ done: 0, total })
    setPhase("uploading")

    const failedList: string[] = []
    const okLotIds = new Set<string>()
    let done = 0

    for (const group of uploadable) {
      for (const photo of group.photos) {
        try {
          const fd = new FormData()
          fd.set("photo", photo)
          const res = await uploadLotPhoto(group.lotId!, auctionId, fd)
          if (res.ok) okLotIds.add(group.lotId!)
          else failedList.push(`${group.label}/${photo.name} — ${res.error}`)
        } catch (e: any) {
          failedList.push(`${group.label}/${photo.name} — ${e?.message ?? "unknown error"}`)
        }
        done++
        setUploadProgress({ done, total })
      }
    }

    setSkipped(failedList)
    setOkLotCount(okLotIds.size)
    setPhase("done")
    onUploaded()
  }

  const matchedGroups   = groups.filter(g => g.lotId && g.photos.length > 0)
  const unmatchedGroups = groups.filter(g => !g.lotId && !g.unreadableLabel)
  const unreadableLabelGroups = groups.filter(g => g.unreadableLabel)
  const emptyGroups     = groups.filter(g => g.lotId && g.photos.length === 0)
  const totalPhotos     = matchedGroups.reduce((sum, g) => sum + g.photos.length, 0)
  const uploadedCount   = uploadProgress.done - skipped.length

  // Scan mode only: flag groups with far more photos than typical — the classic
  // sign that the next lot's label photo failed to decode and both lots' photos
  // ran together. Median-based so one genuinely big lot doesn't flag everything.
  // LOWER median on even counts: with two groups [4, 9] the upper median (9)
  // would make the threshold 18 — mathematically unreachable — so the exact
  // merged-lot case the flag exists for would never fire.
  const photoCounts   = groups.filter(g => g.photos.length > 0).map(g => g.photos.length).sort((a, b) => a - b)
  const median        = photoCounts.length ? photoCounts[Math.floor((photoCounts.length - 1) / 2)] : 0
  const flagThreshold = Math.max(6, median * 2)
  // Matched lots only, so the banner count always equals the highlighted cards
  // (unmatched groups already get their own yellow "won't upload" treatment).
  const isFlagged     = (g: LotGroup) => mode === "scan" && !!g.lotId && g.photos.length >= flagThreshold
  const flaggedCount  = groups.filter(isFlagged).length

  // Manual recovery for an AI false positive: if AI wrongly called an item
  // photo an "unreadable label", its group is holding that lot's remaining
  // photos hostage — this dissolves the group back into the lot above.
  function dissolveUnreadableGroup(gi: number) {
    const g = groups[gi]
    if (!g?.unreadableLabel) return
    const next = groups.filter((_, k) => k !== gi)
    if (gi > 0) next[gi - 1] = { ...next[gi - 1], photos: [...next[gi - 1].photos, ...g.photos] }
    else setPreGroup(p => [...p, ...g.photos])
    setGroups(next)
  }

  function renderGroupCard(g: LotGroup, i: number) {
    const flagged = isFlagged(g)
    return (
      <div key={`${g.label}-${i}`}
        className={`rounded-xl border px-4 py-3 ${
          g.unreadableLabel
            ? "bg-orange-50 border-orange-400 dark:bg-orange-900/10 dark:border-orange-500/70"
            : !g.lotId
              ? "bg-yellow-50 border-yellow-400 dark:bg-yellow-900/10 dark:border-yellow-700/50"
              : flagged
                ? "bg-amber-50 border-amber-400 dark:bg-amber-900/10 dark:border-amber-500/70"
                : "bg-white dark:bg-[#1C1C1E] border-gray-300 dark:border-gray-700"
        }`}>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className={`font-mono text-sm ${
            g.unreadableLabel ? "text-orange-700 dark:text-orange-400"
              : g.lotId ? "text-[#2AB4A6]" : "text-yellow-700 dark:text-yellow-400"
          }`}>{g.label}</span>
          <span className="text-xs text-gray-600 dark:text-gray-500">
            {g.photos.length} photo{g.photos.length !== 1 ? "s" : ""}
          </span>
          {g.unreadableLabel && (
            <>
              <span className="text-xs bg-orange-200 text-orange-800 dark:bg-orange-900/40 dark:text-orange-400 rounded-full px-2 py-0.5">
                🔎 AI saw a label here it couldn&apos;t read — first photo is the label, check it by eye
              </span>
              <button
                onClick={() => dissolveUnreadableGroup(i)}
                className="text-xs px-2 py-0.5 rounded-full border border-orange-400 dark:border-orange-500/70 text-orange-800 dark:text-orange-400 hover:bg-orange-200 dark:hover:bg-orange-900/40 transition-colors">
                ✕ Not a label — {i > 0 ? "move these photos to the lot above" : "discard grouping"}
              </button>
            </>
          )}
          {!g.lotId && !g.unreadableLabel && (
            <span className="text-xs bg-yellow-200 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-400 rounded-full px-2 py-0.5">
              not in this auction — won&apos;t upload
            </span>
          )}
          {g.aiRead && (
            <span className="text-xs bg-purple-200 text-purple-800 dark:bg-purple-900/40 dark:text-purple-400 rounded-full px-2 py-0.5">
              ✨ read by AI
            </span>
          )}
          {flagged && (
            <span className="text-xs bg-amber-200 text-amber-800 dark:bg-amber-900/40 dark:text-amber-400 rounded-full px-2 py-0.5">
              ⚠ unusually many photos — check none belong to the next lot
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {g.photos.map((p, j) => (
            <Thumb key={j} url={thumbUrls.current.get(p) ?? ""} name={p.name} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl">

      {/* ── Idle — mode selection ── */}
      {phase === "idle" && (
        <>
          <div className="mb-5">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Upload Photos</h2>
            <p className="text-xs text-gray-600 dark:text-gray-500 mt-0.5">
              Choose how to match photos to lots.
            </p>
          </div>

          {/* Hidden inputs */}
          <input ref={scanInputRef} type="file" multiple
            // @ts-ignore
            webkitdirectory=""
            className="hidden"
            onChange={handleScanFiles}
          />
          <input ref={filenameInputRef} type="file" multiple accept="image/*"
            className="hidden"
            onChange={handleFilenameFiles}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Option A — filename */}
            <button
              onClick={() => { setMode("filename"); filenameInputRef.current?.click() }}
              className="group flex flex-col items-center gap-3 py-10 rounded-xl border-2 border-dashed border-gray-600 hover:border-[#2AB4A6] text-gray-600 dark:text-gray-400 hover:text-[#2AB4A6] transition-colors px-6"
            >
              <span className="text-4xl">📂</span>
              <span className="text-sm font-semibold text-center">Match by filename</span>
              <span className="text-xs text-gray-600 text-center leading-relaxed">
                Filenames must include the barcode or receipt ID.<br />
                e.g. <span className="font-mono text-gray-600 dark:text-gray-500">F066001.jpg</span>,{" "}
                <span className="font-mono text-gray-600 dark:text-gray-500">F066001_2.jpg</span>
              </span>
            </button>

            {/* Option B — scan */}
            <button
              onClick={() => { setMode("scan"); scanInputRef.current?.click() }}
              className="group flex flex-col items-center gap-3 py-10 rounded-xl border-2 border-dashed border-gray-600 hover:border-purple-500 text-gray-600 dark:text-gray-400 hover:text-purple-400 transition-colors px-6"
            >
              <span className="text-4xl">📷</span>
              <span className="text-sm font-semibold text-center">Smart scan folder</span>
              <span className="text-xs text-gray-600 text-center leading-relaxed">
                Select a photo folder — barcodes are read<br />
                from each image automatically.
              </span>
            </button>
          </div>

          {error && <p className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2 mt-3">{error}</p>}
        </>
      )}

      {/* ── Scanning (scan mode only) ── */}
      {phase === "scanning" && (
        <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl px-6 py-10 flex flex-col items-center gap-4">
          <div className={`w-8 h-8 border-2 border-t-transparent rounded-full animate-spin ${scanStage === "ai" ? "border-purple-500" : "border-[#2AB4A6]"}`} />
          <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">
            {scanStage === "ai" ? "✨ Asking AI about the photos the scanner couldn't read…" : "Scanning for barcodes…"}
          </p>
          <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2">
            <div className={`h-2 rounded-full transition-all duration-200 ${scanStage === "ai" ? "bg-purple-500" : "bg-[#2AB4A6]"}`}
              style={{ width: `${scanStage === "ai"
                ? (aiProgress.total > 0 ? (aiProgress.done / aiProgress.total) * 100 : 0)
                : (scanProgress.total > 0 ? (scanProgress.done / scanProgress.total) * 100 : 0)}%` }} />
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-500">
            {scanStage === "ai"
              ? `${aiProgress.done} / ${aiProgress.total} photos checked by AI`
              : `${scanProgress.done} / ${scanProgress.total} images scanned`}
          </p>
          {scanStage === "ai" && (
            <>
              <p className="text-xs text-gray-500 dark:text-gray-600">This can take a minute or two on big folders.</p>
              <button
                onClick={() => { skipAiRef.current = true; aiAbortRef.current?.abort() }}
                className="px-4 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-xs hover:border-gray-500 transition-colors">
                Skip AI check — use barcode scanning only
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Preview (shared) ── */}
      {phase === "preview" && (
        <div className="space-y-4">
          <div className="mb-2">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              {mode === "filename" ? "Filename match preview" : "Scan results preview"}
            </h2>
            {mode === "filename" && (
              <p className="text-xs text-gray-600 dark:text-gray-500 mt-0.5">
                IDs extracted from filenames — suffixes like <span className="font-mono">_1</span>, <span className="font-mono">_2</span> are stripped automatically.
              </p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-3 text-center">
              <p className="text-2xl font-bold text-[#2AB4A6]">{matchedGroups.length}</p>
              <p className="text-xs text-gray-600 dark:text-gray-500 mt-0.5">Lots matched</p>
            </div>
            <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-3 text-center">
              <p className="text-2xl font-bold text-gray-700 dark:text-gray-200">{totalPhotos}</p>
              <p className="text-xs text-gray-600 dark:text-gray-500 mt-0.5">Photos to upload</p>
            </div>
            <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-3 text-center">
              <p className={`text-2xl font-bold ${unmatchedGroups.length > 0 ? "text-yellow-400" : "text-gray-600"}`}>
                {unmatchedGroups.length}
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-500 mt-0.5">Unmatched</p>
            </div>
          </div>

          {/* Scan-mode warnings */}
          {aiFailed && (
            <div className="bg-red-100 border border-red-300 dark:bg-red-900/20 dark:border-red-700/50 rounded-lg px-3 py-2">
              <p className="text-xs text-red-700 dark:text-red-400">
                ⚠ The AI double-check couldn&apos;t run for some photos (AI or network problem) — grouping below relied
                on barcode scanning alone, so a missed label could have merged two lots. Check the groups carefully or
                try the scan again.
              </p>
            </div>
          )}
          {aiReadCount > 0 && (
            <div className="bg-purple-100 border border-purple-300 dark:bg-purple-900/20 dark:border-purple-700/50 rounded-lg px-3 py-2">
              <p className="text-xs text-purple-800 dark:text-purple-400">
                ✨ AI read {aiReadCount} label{aiReadCount !== 1 ? "s" : ""} the barcode scanner missed — marked below.
              </p>
            </div>
          )}
          {unreadableLabelGroups.length > 0 && (
            <div className="bg-orange-100 border border-orange-300 dark:bg-orange-900/20 dark:border-orange-700/50 rounded-lg px-3 py-2">
              <p className="text-xs text-orange-800 dark:text-orange-400">
                🔎 AI spotted {unreadableLabelGroups.length} barcode label{unreadableLabelGroups.length !== 1 ? "s" : ""} it
                couldn&apos;t read. Their photos are kept separate below (so they can&apos;t pollute another lot) but
                won&apos;t upload — the first photo in each is the label itself, so you can read the code by eye and
                re-shoot or rename those photos. (A label photo that shows as a placeholder tile can&apos;t be
                previewed on this device — re-shoot or convert it.) If AI got it wrong, use the card&apos;s
                &quot;Not a label&quot; button.
              </p>
            </div>
          )}
          {unreadable > 0 && (
            <div className="bg-orange-100 border border-orange-300 dark:bg-orange-900/20 dark:border-orange-700/50 rounded-lg px-3 py-2">
              <p className="text-xs text-orange-800 dark:text-orange-400">
                {aiFailed ? (
                  <>⚠ {unreadable} photo{unreadable !== 1 ? "s" : ""} couldn&apos;t be read on this device (usually HEIC
                  format from an iPhone) and the AI check didn&apos;t run for them — labels in those photos may have
                  merged their lot into the one before. Check the groups below carefully, or convert the photos to JPEG
                  and rescan.</>
                ) : (
                  <>ℹ {unreadable} photo{unreadable !== 1 ? "s" : ""} can&apos;t be previewed on this device (usually
                  HEIC format from an iPhone) — they were still checked by AI and will still upload, but show as a
                  placeholder tile below.</>
                )}
              </p>
            </div>
          )}
          {flaggedCount > 0 && (
            <div className="bg-amber-100 border border-amber-300 dark:bg-amber-900/20 dark:border-amber-700/50 rounded-lg px-3 py-2">
              <p className="text-xs text-amber-800 dark:text-amber-400">
                ⚠ {flaggedCount} lot{flaggedCount !== 1 ? "s have" : " has"} far more photos than the others — often a
                sign the next lot&apos;s barcode photo didn&apos;t scan and two lots ran together. They&apos;re
                highlighted below.
              </p>
            </div>
          )}
          {preGroup.length > 0 && (
            <div className="bg-yellow-100 border border-yellow-300 dark:bg-yellow-900/20 dark:border-yellow-700/50 rounded-lg px-3 py-2">
              <p className="text-xs text-yellow-800 dark:text-yellow-400 font-medium mb-2">
                {preGroup.length} photo{preGroup.length !== 1 ? "s" : ""} came before the first barcode and won&apos;t
                be uploaded — if one of these is a barcode label that didn&apos;t scan, that lot&apos;s photos are here
                too:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {preGroup.map((p, j) => (
                  <Thumb key={j} url={thumbUrls.current.get(p) ?? ""} name={p.name} />
                ))}
              </div>
            </div>
          )}

          {unmatchedGroups.length > 0 && (
            <div className="bg-yellow-100 border border-yellow-300 dark:bg-yellow-900/20 dark:border-yellow-700/50 rounded-lg px-3 py-2">
              <p className="text-xs text-yellow-800 dark:text-yellow-400 font-medium">
                {mode === "filename"
                  ? "IDs not matched to any lot in this auction:"
                  : "Barcodes detected but not found in this auction:"}
              </p>
              <p className="text-xs text-yellow-700 dark:text-yellow-600 font-mono">{unmatchedGroups.map(g => g.label).join(", ")}</p>
            </div>
          )}
          {emptyGroups.length > 0 && (
            <div className="bg-gray-900/50 border border-gray-700 rounded-lg px-3 py-2">
              <p className="text-xs text-gray-600 dark:text-gray-500">
                Lots matched but no photos found: <span className="font-mono">{emptyGroups.map(g => g.label).join(", ")}</span>
              </p>
            </div>
          )}

          {groups.filter(g => g.photos.length > 0 || !g.lotId).length > 0 && (
            <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
              {groups.map((g, i) => (g.photos.length > 0 || !g.lotId) ? renderGroupCard(g, i) : null)}
            </div>
          )}

          {error && <p className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3">
            <button onClick={reset}
              className="px-5 py-2.5 rounded-lg border border-gray-700 text-gray-600 dark:text-gray-400 text-sm hover:border-gray-500 transition-colors">
              ← Back
            </button>
            <button onClick={handleUpload} disabled={matchedGroups.length === 0}
              className="flex-1 py-2.5 bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-50 text-black font-semibold rounded-lg text-sm transition-colors">
              Upload {totalPhotos} photo{totalPhotos !== 1 ? "s" : ""} to {matchedGroups.length} lot{matchedGroups.length !== 1 ? "s" : ""}
            </button>
          </div>
        </div>
      )}

      {/* ── Uploading ── */}
      {phase === "uploading" && (
        <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl px-6 py-10 flex flex-col items-center gap-4">
          <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">Uploading photos…</p>
          <div className="w-full bg-gray-800 rounded-full h-3">
            <div className="bg-[#2AB4A6] h-3 rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress.total > 0 ? (uploadProgress.done / uploadProgress.total) * 100 : 0}%` }} />
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-500">{uploadProgress.done} / {uploadProgress.total} photos</p>
        </div>
      )}

      {/* ── Done ── */}
      {phase === "done" && (
        <div className="space-y-4">
          {uploadedCount === 0 ? (
            <div className="bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-700/50 rounded-xl px-6 py-8 flex flex-col items-center gap-2">
              <span className="text-4xl">✗</span>
              <p className="text-sm font-semibold text-red-700 dark:text-red-400">Upload failed — no photos were uploaded</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                All {uploadProgress.total} photo{uploadProgress.total !== 1 ? "s" : ""} failed — the reasons are listed below.
              </p>
            </div>
          ) : (
            <div className="bg-[#2AB4A6]/10 border border-[#2AB4A6]/30 rounded-xl px-6 py-8 flex flex-col items-center gap-2">
              <span className="text-4xl">{skipped.length > 0 ? "⚠" : "✓"}</span>
              <p className="text-sm font-semibold text-[#2AB4A6]">
                {skipped.length > 0 ? "Upload finished with problems" : "Upload complete"}
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {uploadedCount} of {uploadProgress.total} photo{uploadProgress.total !== 1 ? "s" : ""} uploaded
                to {okLotCount} lot{okLotCount !== 1 ? "s" : ""}
                {skipped.length > 0 ? ` — ${skipped.length} failed (listed below)` : ""}
              </p>
            </div>
          )}
          {skipped.length > 0 && (
            <div className="bg-yellow-100 border border-yellow-300 dark:bg-yellow-900/20 dark:border-yellow-700/50 rounded-lg px-3 py-2">
              <p className="text-xs text-yellow-800 dark:text-yellow-400 font-medium mb-1">
                {skipped.length} photo{skipped.length !== 1 ? "s" : ""} failed:
              </p>
              <ul className="space-y-0.5">
                {skipped.map((s, i) => (
                  <li key={i} className="text-xs text-yellow-700 dark:text-yellow-500 font-mono">{s}</li>
                ))}
              </ul>
            </div>
          )}
          <button onClick={reset}
            className="w-full py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm hover:border-gray-500 transition-colors">
            Upload more photos
          </button>
        </div>
      )}
    </div>
  )
}
