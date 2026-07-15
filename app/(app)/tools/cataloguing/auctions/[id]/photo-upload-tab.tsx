"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
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
  labelPhoto?:      File      // the photo that started this group — shown in the preview, never uploaded
  aiRead?:          boolean   // the barcode scanner missed this label; AI read the printed code
  unreadableLabel?: boolean   // AI says this is a label photo but couldn't read the code
  aiVerdict?:       "confirmed" | "code-mismatch" | "not-a-label"  // AI's second opinion on a scanner-decoded label
  aiCode?:          string    // what AI read when it disagrees with the scanner
}

type Phase = "idle" | "scanning" | "preview" | "uploading" | "done"
type Mode  = "scan" | "filename"

// Per-lot outcome, shown live while uploading and on the results screen.
interface UploadResult {
  label:    string
  uploaded: number
  failed:   number
  errors:   string[]
}

// Photos per AI request, and how many requests run at once. A big sale is
// 1000+ photos, so these drive how long the AI review takes.
const BATCH_SIZE     = 8
const AI_CONCURRENCY = 3
// Consecutive failed requests (nothing succeeding in between) before we stop
// asking AI and fall back to barcode scanning for the rest.
const AI_GIVE_UP_AFTER = 4
const MODEL_LS_KEY   = "smart_scan_model"

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
  const [aiFailed, setAiFailed]             = useState(false)   // AI check errored/skipped for some photos — those photos are scanner-only
  const [aiReadCount, setAiReadCount]       = useState(0)       // labels the scanner missed but AI read
  const [aiCheckedCount, setAiCheckedCount] = useState(0)       // photos that actually got an AI answer
  const [aiNote, setAiNote]                 = useState<string | null>(null)  // live status/error during the AI pass
  const [aiEta, setAiEta]                   = useState<string | null>(null)
  const skipAiRef   = useRef(false)                             // user pressed "Skip AI check"
  // Every in-flight AI request — several run at once, so a single ref would
  // only ever let Skip abort the most recent one.
  const aiAbortsRef = useRef(new Set<AbortController>())

  // ── AI model picker ────────────────────────────────────────────────────────
  // Starts on the admin default for the catalogue_smart_scan slot (Admin → AI
  // Models) unless this user has saved their own choice here.
  const [modelList, setModelList] = useState<string[]>([])
  const [modelId, setModelId]     = useState("")
  const [savedDefault, setSavedDefault] = useState<string | null>(null)
  const aiModelRef = useRef("")
  useEffect(() => { aiModelRef.current = modelId }, [modelId])

  // Resolve the list and the admin default together, then pick once. Fetching
  // the default only when no saved choice exists left the dropdown blank (and
  // silently falling back server-side) whenever a saved model had since been
  // retired or disabled.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [listRes, defRes] = await Promise.allSettled([
        fetch("/api/auction-ai/models").then(r => r.json()),
        fetch("/api/ai-tool-model?slot=catalogue_smart_scan").then(r => r.json()),
      ])
      if (cancelled) return
      const models: string[] =
        listRes.status === "fulfilled" && Array.isArray(listRes.value?.models) ? listRes.value.models : []
      const adminDefault: string =
        defRes.status === "fulfilled" && typeof defRes.value?.model === "string" ? defRes.value.model : ""
      setModelList(models)

      const saved = typeof window !== "undefined" ? localStorage.getItem(MODEL_LS_KEY) : null
      setSavedDefault(saved)
      // This user's saved choice wins, but only while it is still an enabled
      // model; then the admin default; then whatever is available.
      const pick =
        saved && models.includes(saved) ? saved
        : adminDefault && (models.length === 0 || models.includes(adminDefault)) ? adminDefault
        : models[0] ?? ""
      setModelId(pick)
    })()
    return () => { cancelled = true }
  }, [])

  function setAsDefault() { localStorage.setItem(MODEL_LS_KEY, modelId); setSavedDefault(modelId) }
  function clearDefault() { localStorage.removeItem(MODEL_LS_KEY); setSavedDefault(null) }
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 })
  const [uploadingLabel, setUploadingLabel] = useState<string | null>(null)  // lot currently uploading
  const [uploadLog, setUploadLog]           = useState<UploadResult[]>([])   // fills in live while uploading
  const [uploadResults, setUploadResults]   = useState<UploadResult[]>([])   // final per-lot outcome
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
    setAiCheckedCount(0)
    setAiNote(null)
    setAiEta(null)
    setSkipped([])
    setOkLotCount(0)
    setUploadLog([])
    setUploadResults([])
    setUploadingLabel(null)
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
    setAiCheckedCount(0)
    setAiNote(null)
    setAiEta(null)
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

    // ── AI review pass — EVERY photo ─────────────────────────────────────────
    // After the barcode scan, Gemini reviews every single photo (Jordan's
    // requirement: this upload must not make mistakes). Per photo it answers:
    // label or item, and the printed code if legible. That gives:
    //  - a second opinion on every scanner-decoded label (misread codes and
    //    "a sticker on an item photo started a false group" both get flagged)
    //  - blurry labels the scanner missed get read anyway
    //  - a label AI can see but not read BREAKS the grouping instead of
    //    silently merging two lots
    // Unreadable-in-browser files (HEIC) are sent as originals — Gemini reads
    // HEIC. If the AI pass fails, grouping proceeds scanner-only + warns.
    const aiRes     = new Map<number, { label: boolean; code: string | null }>()
    let   aiErrored = false

    const candidates = files.map((_, i) => i)
    if (candidates.length > 0) {
      setScanStage("ai")
      setAiProgress({ done: 0, total: candidates.length })
      setAiNote(null)

      // Batch by INDEX up front (instant). Each batch prepares its own photos
      // just before sending them — preparing all of them first meant a folder
      // of 1000+ photos sat on "0 / 1093" for 25 minutes with no sign of life,
      // because every photo needs a full-resolution decode to downscale.
      const batches: number[][] = []
      for (let k = 0; k < candidates.length; k += BATCH_SIZE) batches.push(candidates.slice(k, k + BATCH_SIZE))

      let doneCount = 0
      let consecutiveFails = 0
      const started = Date.now()

      // Send one packed request. Returns false if it never succeeded.
      async function postPack(pack: { i: number; payload: Blob | File }[]): Promise<boolean> {
        // Several workers share the one status line, so only ever clear a
        // message we put there ourselves — otherwise one worker's success
        // wipes another's live "rate limited" warning.
        let myNote: string | null = null
        const note = (t: string) => { myNote = t; setAiNote(t) }
        const clearMyNote = () => { if (myNote) setAiNote(prev => (prev === myNote ? null : prev)) }

        for (let attempt = 0; attempt < 3 && !skipAiRef.current; attempt++) {
          const ctrl = new AbortController()
          aiAbortsRef.current.add(ctrl)
          const timer = setTimeout(() => ctrl.abort(), 150_000)  // route maxDuration is 120s
          try {
            const fd = new FormData()
            pack.forEach((it, j) => fd.append(`photo_${j}`, it.payload, files[it.i].name))
            const res  = await fetch("/api/catalogue/scan-photos", {
              method: "POST", body: fd, signal: ctrl.signal,
              headers: { "x-ai-model": aiModelRef.current || "" },
            })
            const data = await res.json().catch(() => null)
            if (res.ok && Array.isArray(data?.photos) && data.photos.length === pack.length) {
              data.photos.forEach((p: any, j: number) => {
                aiRes.set(pack[j].i, {
                  label: p?.label === true,
                  code:  typeof p?.code === "string" && p.code ? p.code : null,
                })
              })
              clearMyNote()
              return true
            }
            const why = data?.error ?? `HTTP ${res.status}`
            if (res.status === 422) { note("AI wouldn't look at some photos — those fall back to barcode scanning."); return false }
            note(res.status === 429
              ? "AI is busy (rate limited) — waiting and trying again…"
              : `AI had a problem — trying again (${why})`)
            if (attempt < 2) await new Promise(r => setTimeout(r, res.status === 429 ? (attempt + 1) * 15000 : 4000))
          } catch (e: any) {
            if (e?.name === "AbortError" && skipAiRef.current) return false
            note(e?.name === "AbortError" ? "An AI request took too long — trying again…" : "Couldn't reach the AI (network problem) — trying again…")
            if (attempt < 2 && !skipAiRef.current) await new Promise(r => setTimeout(r, 4000))
          } finally {
            clearTimeout(timer)
            aiAbortsRef.current.delete(ctrl)
          }
        }
        return false
      }

      async function runBatch(idxs: number[]): Promise<void> {
        // Prepare this batch's payloads only, one at a time. Downscaling needs
        // a full-resolution decode (~30MB of canvas for an 8MP photo), so with
        // AI_CONCURRENCY batches in flight this already means several at once —
        // preparing a whole batch in parallel on top of that risks running the
        // browser out of memory on a big sale.
        const items: { i: number; payload: Blob | File }[] = []
        for (const i of idxs) {
          if (skipAiRef.current) break
          if (files[i].size === 0) continue                       // glitched transfer / iCloud placeholder
          const blob = decoded[i].unreadable ? null : await toJpegBlob(files[i])
          const payload = blob ?? files[i]                        // HEIC original — Gemini reads it
          if (payload.size > 15_000_000) continue
          items.push({ i, payload })
        }
        if (items.length < idxs.length) aiErrored = true          // some photos couldn't be checked

        // Pack by real payload bytes — a batch of HEIC originals can be large.
        const packs: typeof items[] = []
        let cur: typeof items = []
        let curBytes = 0
        for (const it of items) {
          if (cur.length > 0 && curBytes + it.payload.size > 12_000_000) { packs.push(cur); cur = []; curBytes = 0 }
          cur.push(it); curBytes += it.payload.size
        }
        if (cur.length > 0) packs.push(cur)

        for (const pack of packs) {
          const ok = await postPack(pack)
          // Count CONSECUTIVE failures only, resetting on every success: an
          // absolute count would abandon AI review of a 1000-photo folder
          // after three unrelated blips spread across a long run.
          if (!ok) { aiErrored = true; consecutiveFails++ }
          else consecutiveFails = 0
        }
      }

      // Run several batches at once — 1000+ photos strictly one batch at a time
      // is far too slow. Workers stop early on Skip or a clear AI outage.
      let next = 0
      async function worker() {
        while (next < batches.length) {
          const b = batches[next++]
          // Give up only on a sustained outage (several failures in a row with
          // nothing succeeding in between), never on scattered blips.
          if (skipAiRef.current || consecutiveFails >= AI_GIVE_UP_AFTER) {
            aiErrored = true
          } else {
            await runBatch(b)
          }
          doneCount += b.length
          setAiProgress({ done: doneCount, total: candidates.length })
          if (doneCount >= 24 && !skipAiRef.current) {
            const perPhoto = (Date.now() - started) / doneCount
            const leftMs   = perPhoto * (candidates.length - doneCount)
            setAiEta(leftMs > 45_000 ? `about ${Math.ceil(leftMs / 60_000)} min remaining` : "nearly done")
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(AI_CONCURRENCY, batches.length) }, worker))

      if (consecutiveFails >= AI_GIVE_UP_AFTER) setAiNote("AI checking stopped after repeated failures — the rest was grouped by barcode scanning only.")
      if (skipAiRef.current) aiErrored = true
    }

    const result: LotGroup[] = []
    const pre: File[] = []
    let unreadableCount = 0
    let aiRead = 0
    let current: LotGroup | null = null

    for (let i = 0; i < files.length; i++) {
      const d = decoded[i]
      if (d.unreadable) unreadableCount++
      const a = aiRes.get(i)

      if (d.barcode) {
        // Scanner-decoded label — reconcile with AI's second opinion. On a
        // code disagreement the SCANNER wins (Code 128 has a checksum; AI
        // misreads printed text more often) but the group is flagged so the
        // user checks the label photo by eye.
        let aiVerdict: LotGroup["aiVerdict"]
        let aiCode: string | undefined
        if (a) {
          if (a.code && a.code.toLowerCase() !== d.barcode.toLowerCase()) { aiVerdict = "code-mismatch"; aiCode = a.code }
          else if (a.label || a.code) aiVerdict = "confirmed"
          else aiVerdict = "not-a-label"   // likely a sticker on an item photo that zxing decoded
        }
        const key = d.barcode.toLowerCase().trim()
        current = { lotId: lotMap.get(key) ?? null, label: d.barcode, photos: [], labelPhoto: files[i], aiVerdict, aiCode }
        result.push(current)
      } else if (a?.code) {
        // Scanner missed it; AI read the printed code.
        aiRead++
        const key = a.code.toLowerCase().trim()
        current = { lotId: lotMap.get(key) ?? null, label: a.code, photos: [], labelPhoto: files[i], aiRead: true }
        result.push(current)
      } else if (a?.label) {
        // AI is sure this is a label photo but couldn't read the code: break
        // the group here so the following photos can't pollute the previous
        // lot, and keep the label photo so the user can read it by eye.
        current = { lotId: null, label: `Unreadable label — ${files[i].name}`, photos: [], labelPhoto: files[i], unreadableLabel: true }
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
    setAiCheckedCount(aiRes.size)
    setPhase("preview")
  }

  // ── Upload (shared by both modes) ─────────────────────────────────────────────
  async function handleUpload() {
    const uploadable = groups.filter(g => g.lotId && g.photos.length > 0)
    if (uploadable.length === 0) { setError("No matched lots with photos to upload."); return }

    const total = uploadable.reduce((sum, g) => sum + g.photos.length, 0)
    setUploadProgress({ done: 0, total })
    setUploadLog([])
    setPhase("uploading")

    const failedList: string[] = []
    const perLot: UploadResult[] = []
    const okLotIds = new Set<string>()
    let done = 0

    for (const group of uploadable) {
      let ok = 0
      const errs: string[] = []
      setUploadingLabel(group.label)
      for (const photo of group.photos) {
        try {
          const fd = new FormData()
          fd.set("photo", photo)
          const res = await uploadLotPhoto(group.lotId!, auctionId, fd)
          if (res.ok) { ok++; okLotIds.add(group.lotId!) }
          else { errs.push(`${photo.name} — ${res.error}`); failedList.push(`${group.label}/${photo.name} — ${res.error}`) }
        } catch (e: any) {
          const msg = e?.message ?? "unknown error"
          errs.push(`${photo.name} — ${msg}`)
          failedList.push(`${group.label}/${photo.name} — ${msg}`)
        }
        done++
        setUploadProgress({ done, total })
      }
      const row: UploadResult = { label: group.label, uploaded: ok, failed: errs.length, errors: errs }
      perLot.push(row)
      setUploadLog(prev => [...prev, row])
    }

    setUploadingLabel(null)
    setSkipped(failedList)
    setUploadResults(perLot)
    setOkLotCount(okLotIds.size)
    setPhase("done")
    onUploaded()
  }

  const matchedGroups   = groups.filter(g => g.lotId && g.photos.length > 0)
  const unmatchedGroups = groups.filter(g => !g.lotId && !g.unreadableLabel)
  const unreadableLabelGroups = groups.filter(g => g.unreadableLabel)
  const emptyGroups     = groups.filter(g => g.lotId && g.photos.length === 0)
  const aiConfirmed     = groups.filter(g => g.aiVerdict === "confirmed").length
  const aiWarnings      = groups.filter(g => g.aiVerdict === "code-mismatch" || g.aiVerdict === "not-a-label").length
    + unreadableLabelGroups.length
  // A group with an AI warning must always render a card, even with 0 photos.
  const showCard        = (g: LotGroup) => g.photos.length > 0 || !g.lotId || (g.aiVerdict && g.aiVerdict !== "confirmed")
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

  // Manual recovery when a "label" wasn't really a label (AI false positive on
  // an unreadable-label group, or AI flagging a scanner-decoded sticker as an
  // item photo): dissolve the group back into the lot above — its photos AND
  // the not-really-a-label photo itself become that lot's photos.
  function dissolveGroup(gi: number) {
    const g = groups[gi]
    if (!g || !(g.unreadableLabel || g.aiVerdict === "not-a-label")) return
    const moved = [...(g.labelPhoto ? [g.labelPhoto] : []), ...g.photos]
    const next = groups.filter((_, k) => k !== gi)
    if (gi > 0) next[gi - 1] = { ...next[gi - 1], photos: [...next[gi - 1].photos, ...moved] }
    else setPreGroup(p => [...p, ...moved])
    setGroups(next)
  }

  function renderGroupCard(g: LotGroup, i: number) {
    const flagged = isFlagged(g)
    const dissolvable = g.unreadableLabel || g.aiVerdict === "not-a-label"
    return (
      <div key={`${g.label}-${i}`}
        className={`rounded-xl border px-4 py-3 ${
          g.aiVerdict === "code-mismatch"
            ? "bg-red-50 border-red-400 dark:bg-red-900/10 dark:border-red-500/70"
            : g.unreadableLabel || g.aiVerdict === "not-a-label"
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
          {g.aiVerdict === "confirmed" && (
            <span className="text-xs bg-green-200 text-green-800 dark:bg-green-900/40 dark:text-green-400 rounded-full px-2 py-0.5">
              ✓ AI confirmed
            </span>
          )}
          {g.aiVerdict === "code-mismatch" && (
            <span className="text-xs bg-red-200 text-red-800 dark:bg-red-900/40 dark:text-red-400 rounded-full px-2 py-0.5">
              ⚠ scanner read {g.label} but AI read {g.aiCode} — check the label photo
            </span>
          )}
          {g.aiVerdict === "not-a-label" && (
            <span className="text-xs bg-orange-200 text-orange-800 dark:bg-orange-900/40 dark:text-orange-400 rounded-full px-2 py-0.5">
              ⚠ AI thinks this &quot;label&quot; is an item photo — check it
            </span>
          )}
          {g.unreadableLabel && (
            <span className="text-xs bg-orange-200 text-orange-800 dark:bg-orange-900/40 dark:text-orange-400 rounded-full px-2 py-0.5">
              🔎 AI saw a label here it couldn&apos;t read — check the label photo by eye
            </span>
          )}
          {dissolvable && (
            <button
              onClick={() => dissolveGroup(i)}
              className="text-xs px-2 py-0.5 rounded-full border border-orange-400 dark:border-orange-500/70 text-orange-800 dark:text-orange-400 hover:bg-orange-200 dark:hover:bg-orange-900/40 transition-colors">
              ✕ Not a label — {i > 0 ? "move these photos to the lot above" : "discard grouping"}
            </button>
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
          {g.labelPhoto && (
            <div className="relative flex-shrink-0" title={`Label photo — ${g.labelPhoto.name} (not uploaded)`}>
              <Thumb url={thumbUrls.current.get(g.labelPhoto) ?? ""} name={g.labelPhoto.name} />
              <span className="absolute -top-1 -left-1 text-[9px] leading-none bg-gray-700 text-white dark:bg-gray-200 dark:text-gray-900 rounded px-1 py-0.5">label</span>
            </div>
          )}
          {g.photos.map((p, j) => (
            <Thumb key={j} url={thumbUrls.current.get(p) ?? ""} name={p.name} />
          ))}
        </div>
      </div>
    )
  }

  // ── Small presentational helpers ────────────────────────────────────────────
  const Stat = ({ label, value, tone = "plain", sub }: {
    label: string; value: React.ReactNode; tone?: "plain" | "good" | "warn" | "bad" | "ai"; sub?: string
  }) => (
    <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-3">
      <p className={`text-2xl font-bold ${
        tone === "good" ? "text-green-700 dark:text-green-400"
        : tone === "warn" ? "text-amber-700 dark:text-amber-400"
        : tone === "bad"  ? "text-red-700 dark:text-red-400"
        : tone === "ai"   ? "text-purple-700 dark:text-purple-400"
        : "text-gray-900 dark:text-white"
      }`}>{value}</p>
      <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )

  const Notice = ({ tone, children }: { tone: "info" | "ai" | "warn" | "bad" | "good"; children: React.ReactNode }) => (
    <div className={`rounded-lg px-3 py-2 border text-xs ${
      tone === "ai"   ? "bg-purple-100 border-purple-300 text-purple-800 dark:bg-purple-900/20 dark:border-purple-700/50 dark:text-purple-300"
      : tone === "warn" ? "bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-900/20 dark:border-amber-700/50 dark:text-amber-300"
      : tone === "bad"  ? "bg-red-100 border-red-300 text-red-800 dark:bg-red-900/20 dark:border-red-700/50 dark:text-red-300"
      : tone === "good" ? "bg-green-100 border-green-300 text-green-800 dark:bg-green-900/20 dark:border-green-700/50 dark:text-green-300"
      : "bg-gray-100 border-gray-300 text-gray-700 dark:bg-gray-800/50 dark:border-gray-700 dark:text-gray-300"
    }`}>{children}</div>
  )

  const stagePct = scanProgress.total > 0 ? (scanProgress.done / scanProgress.total) * 100 : 0
  const aiPct    = aiProgress.total   > 0 ? (aiProgress.done   / aiProgress.total)   * 100 : 0
  const upPct    = uploadProgress.total > 0 ? (uploadProgress.done / uploadProgress.total) * 100 : 0
  const needsALook = aiWarnings + flaggedCount + (preGroup.length > 0 ? 1 : 0)

  return (
    <div className="pb-6 max-w-5xl">

      {/* ══ Idle — choose how to match ══ */}
      {phase === "idle" && (
        <>
          <input ref={scanInputRef} type="file" multiple
            // @ts-ignore — folder picking is non-standard but supported everywhere we run
            webkitdirectory=""
            className="hidden"
            onChange={handleScanFiles}
          />
          <input ref={filenameInputRef} type="file" multiple accept="image/*"
            className="hidden"
            onChange={handleFilenameFiles}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Smart scan */}
            <button
              onClick={() => { setMode("scan"); scanInputRef.current?.click() }}
              className="group text-left rounded-xl border-2 border-purple-300 dark:border-purple-700/60 hover:border-purple-500 bg-purple-50/50 dark:bg-purple-900/10 p-6 transition-colors"
            >
              <div className="flex items-center gap-3 mb-3">
                <span className="text-3xl">📷</span>
                <div>
                  <p className="text-base font-bold text-gray-900 dark:text-white">Smart scan a folder</p>
                  <p className="text-xs text-purple-700 dark:text-purple-400 font-medium">Recommended — no renaming needed</p>
                </div>
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mb-3">
                Pick the folder straight off the camera. Photograph each lot&apos;s barcode label, then its
                photos, then the next label — the scan works out the rest.
              </p>
              <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                <li>✓ Reads the barcode on every label photo</li>
                <li>✓ AI double-checks <strong>every</strong> photo and flags anything odd</li>
                <li>✓ You see every photo grouped by lot before anything is saved</li>
              </ul>
              <span className="inline-block mt-4 text-sm font-semibold text-purple-700 dark:text-purple-400 group-hover:underline">
                Choose folder →
              </span>
            </button>

            {/* Filename */}
            <button
              onClick={() => { setMode("filename"); filenameInputRef.current?.click() }}
              className="group text-left rounded-xl border-2 border-gray-300 dark:border-gray-700 hover:border-[#2AB4A6] bg-white dark:bg-[#1C1C1E] p-6 transition-colors"
            >
              <div className="flex items-center gap-3 mb-3">
                <span className="text-3xl">📂</span>
                <div>
                  <p className="text-base font-bold text-gray-900 dark:text-white">Match by filename</p>
                  <p className="text-xs text-gray-600 dark:text-gray-400 font-medium">When photos are already named</p>
                </div>
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mb-3">
                Each photo&apos;s filename must be the lot&apos;s barcode or receipt ID. No barcode reading and
                no AI — the filename decides the lot.
              </p>
              <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                <li>✓ <span className="font-mono">F066001.jpg</span> → lot F066001</li>
                <li>✓ <span className="font-mono">F066001_2.jpg</span> → same lot, second photo</li>
                <li>✓ <span className="font-mono">R000016-413_1.jpg</span> → receipt ID works too</li>
              </ul>
              <span className="inline-block mt-4 text-sm font-semibold text-[#2AB4A6] group-hover:underline">
                Choose photos →
              </span>
            </button>
          </div>

          {/* Model picker */}
          <div className="mt-5 flex items-center gap-2 flex-wrap bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-3">
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">✨ AI model for smart scan:</span>
            <select value={modelId} onChange={e => setModelId(e.target.value)}
              className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 text-xs text-gray-900 dark:text-white focus:outline-none focus:border-purple-500">
              {modelList.length === 0 && <option value="">Loading…</option>}
              {modelList.map(m => <option key={m} value={m}>{m}{savedDefault === m ? " ★" : ""}</option>)}
            </select>
            {savedDefault === modelId && modelId ? (
              <button onClick={clearDefault} className="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-500 px-2 py-1 rounded">★ Your default · clear</button>
            ) : (
              <button onClick={setAsDefault} disabled={!modelId} className="text-xs text-gray-600 dark:text-gray-400 hover:text-purple-500 disabled:opacity-40 px-2 py-1 rounded">Set as my default</button>
            )}
            <span className="text-xs text-gray-600 dark:text-gray-400">Set for everyone in Admin → AI Models.</span>
          </div>

          {error && <div className="mt-3"><Notice tone="bad">{error}</Notice></div>}
        </>
      )}

      {/* ══ Scanning — two clear stages ══ */}
      {phase === "scanning" && (
        <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl p-6 max-w-2xl">
          {/* Stage 1 */}
          <div className="flex items-start gap-3 mb-5">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
              scanStage === "local" ? "bg-[#2AB4A6] text-white" : "bg-green-500 text-white"
            }`}>{scanStage === "local" ? "1" : "✓"}</span>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${scanStage === "local" ? "text-gray-900 dark:text-white" : "text-gray-600 dark:text-gray-400"}`}>
                Reading barcodes
              </p>
              {scanStage === "local" ? (
                <>
                  <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2 mt-2">
                    <div className="bg-[#2AB4A6] h-2 rounded-full transition-all duration-200" style={{ width: `${stagePct}%` }} />
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1.5">
                    {scanProgress.done} of {scanProgress.total} photos · looking for a lot label in each one
                  </p>
                </>
              ) : (
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{scanProgress.total} photos read</p>
              )}
            </div>
          </div>

          {/* Stage 2 */}
          <div className="flex items-start gap-3">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
              scanStage === "ai" ? "bg-purple-500 text-white" : "bg-gray-300 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
            }`}>2</span>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${scanStage === "ai" ? "text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-500"}`}>
                ✨ AI double-checking every photo
              </p>
              {scanStage === "ai" ? (
                <>
                  <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2 mt-2">
                    <div className="bg-purple-500 h-2 rounded-full transition-all duration-200" style={{ width: `${aiPct}%` }} />
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1.5">
                    {aiProgress.done} of {aiProgress.total} photos
                    {aiEta ? <> · {aiEta}</> : <> · checking {AI_CONCURRENCY * BATCH_SIZE} at a time</>}
                  </p>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    Catching labels the barcode reader missed, and anything that looks wrong.
                  </p>
                  {aiNote && <div className="mt-2"><Notice tone="warn">{aiNote}</Notice></div>}
                  <button
                    onClick={() => { skipAiRef.current = true; aiAbortsRef.current.forEach(c => c.abort()) }}
                    className="mt-3 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-xs hover:border-gray-500 transition-colors">
                    Skip the AI check — group by barcode only
                  </button>
                </>
              ) : (
                <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">Waiting for the barcode read to finish…</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ Preview — check before saving ══ */}
      {phase === "preview" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              {mode === "filename" ? "Check the filename matches" : "Check before saving"}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
              Nothing has been saved yet. Every photo below is shown under the lot it will be added to.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Lots matched" value={matchedGroups.length} tone="good" />
            <Stat label="Photos to save" value={totalPhotos} />
            <Stat label="Not in this sale" value={unmatchedGroups.length} tone={unmatchedGroups.length > 0 ? "warn" : "plain"} />
            <Stat label="Need a look" value={needsALook} tone={needsALook > 0 ? "warn" : "good"} />
          </div>

          {mode === "scan" && aiCheckedCount > 0 && (
            <Notice tone="ai">
              ✨ AI reviewed {aiCheckedCount} photo{aiCheckedCount !== 1 ? "s" : ""}: {aiConfirmed} label{aiConfirmed !== 1 ? "s" : ""} confirmed
              {aiReadCount > 0 ? <>, {aiReadCount} read by AI that the barcode reader missed</> : null}
              {aiWarnings > 0 ? <>, <strong>{aiWarnings} flagged below</strong></> : <>, nothing suspicious</>}.
            </Notice>
          )}
          {mode === "scan" && aiFailed && (
            <Notice tone="bad">
              ⚠ The AI check couldn&apos;t run for some photos (a problem with the AI, the network, or it was
              skipped). Those photos were grouped by barcode alone, so a missed label could have merged two lots.
              Check the groups below, or scan again.
            </Notice>
          )}
          {flaggedCount > 0 && (
            <Notice tone="warn">
              ⚠ {flaggedCount} lot{flaggedCount !== 1 ? "s have" : " has"} far more photos than the rest — often a
              sign a label didn&apos;t scan and two lots ran together. Highlighted below.
            </Notice>
          )}
          {unreadableLabelGroups.length > 0 && (
            <Notice tone="warn">
              🔎 AI spotted {unreadableLabelGroups.length} label{unreadableLabelGroups.length !== 1 ? "s" : ""} it
              couldn&apos;t read. Those photos are held separately below so they can&apos;t land on the wrong lot —
              read the code off the label photo yourself, or use &quot;Not a label&quot; if AI got it wrong.
            </Notice>
          )}
          {unreadable > 0 && (
            <Notice tone={aiFailed ? "warn" : "info"}>
              {aiFailed
                ? <>⚠ {unreadable} photo{unreadable !== 1 ? "s" : ""} couldn&apos;t be read on this device (usually
                  HEIC from an iPhone) and the AI check didn&apos;t cover them — convert them to JPEG and scan again.</>
                : <>ℹ {unreadable} photo{unreadable !== 1 ? "s" : ""} can&apos;t be previewed on this device (usually
                  HEIC from an iPhone). AI still checked them and they will still upload — they just show as a
                  placeholder tile.</>}
            </Notice>
          )}
          {preGroup.length > 0 && (
            <div className="rounded-lg px-3 py-2 border bg-amber-100 border-amber-300 dark:bg-amber-900/20 dark:border-amber-700/50">
              <p className="text-xs text-amber-800 dark:text-amber-300 font-medium mb-2">
                {preGroup.length} photo{preGroup.length !== 1 ? "s" : ""} came before the first label and won&apos;t be
                saved — if a label here didn&apos;t scan, its lot&apos;s photos are in this pile too:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {preGroup.map((p, j) => <Thumb key={j} url={thumbUrls.current.get(p) ?? ""} name={p.name} />)}
              </div>
            </div>
          )}
          {unmatchedGroups.length > 0 && (
            <Notice tone="warn">
              <p className="font-medium mb-1">
                {unmatchedGroups.length} label{unmatchedGroups.length !== 1 ? "s" : ""} {unmatchedGroups.length !== 1 ? "aren't" : "isn't"} on
                any lot in this sale — their photos won&apos;t be saved:
              </p>
              <p className="font-mono">{unmatchedGroups.map(g => g.label).join(", ")}</p>
              <p className="mt-1">Check you picked the right sale, and that these lots have been created.</p>
            </Notice>
          )}
          {emptyGroups.length > 0 && (
            <Notice tone="info">
              Matched but no photos followed the label: <span className="font-mono">{emptyGroups.map(g => g.label).join(", ")}</span>
            </Notice>
          )}

          {groups.filter(showCard).length > 0 && (
            <div className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">
              {groups.map((g, i) => showCard(g) ? renderGroupCard(g, i) : null)}
            </div>
          )}

          {error && <Notice tone="bad">{error}</Notice>}

          <div className="flex gap-3 sticky bottom-0 bg-gray-50 dark:bg-[#141416] py-3 border-t border-gray-200 dark:border-gray-800">
            <button onClick={reset}
              className="px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm hover:border-gray-500 transition-colors">
              ← Start again
            </button>
            <button onClick={handleUpload} disabled={matchedGroups.length === 0}
              className="flex-1 py-2.5 bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-50 text-black font-semibold rounded-lg text-sm transition-colors">
              Save {totalPhotos} photo{totalPhotos !== 1 ? "s" : ""} to {matchedGroups.length} lot{matchedGroups.length !== 1 ? "s" : ""}
            </button>
          </div>
        </div>
      )}

      {/* ══ Uploading — live per-lot feedback ══ */}
      {phase === "uploading" && (
        <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl p-6 max-w-2xl">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">Saving photos…</p>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 mb-3">
            {uploadingLabel ? <>Currently on <span className="font-mono">{uploadingLabel}</span></> : "Starting…"} — please leave this page open.
          </p>
          <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-3">
            <div className="bg-[#2AB4A6] h-3 rounded-full transition-all duration-300" style={{ width: `${upPct}%` }} />
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
            {uploadProgress.done} of {uploadProgress.total} photos
          </p>
          {uploadLog.length > 0 && (
            <div className="mt-4 max-h-48 overflow-y-auto space-y-1">
              {uploadLog.map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className={r.failed > 0 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}>
                    {r.failed > 0 ? "⚠" : "✓"}
                  </span>
                  <span className="font-mono text-gray-700 dark:text-gray-300">{r.label}</span>
                  <span className="text-gray-600 dark:text-gray-400">
                    {r.uploaded} saved{r.failed > 0 ? `, ${r.failed} failed` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══ Done — the results screen ══ */}
      {phase === "done" && (
        <div className="space-y-4">
          {uploadedCount === 0 ? (
            <div className="rounded-xl border bg-red-50 border-red-300 dark:bg-red-900/15 dark:border-red-700/60 px-6 py-6 text-center">
              <p className="text-4xl mb-1">✗</p>
              <p className="text-base font-bold text-red-800 dark:text-red-300">Nothing was saved</p>
              <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                All {uploadProgress.total} photo{uploadProgress.total !== 1 ? "s" : ""} failed. The reasons are listed below.
              </p>
            </div>
          ) : (
            <div className={`rounded-xl border px-6 py-6 text-center ${
              skipped.length > 0
                ? "bg-amber-50 border-amber-300 dark:bg-amber-900/15 dark:border-amber-700/60"
                : "bg-green-50 border-green-300 dark:bg-green-900/15 dark:border-green-700/60"
            }`}>
              <p className="text-4xl mb-1">{skipped.length > 0 ? "⚠" : "✓"}</p>
              <p className={`text-base font-bold ${skipped.length > 0 ? "text-amber-800 dark:text-amber-300" : "text-green-800 dark:text-green-300"}`}>
                {skipped.length > 0 ? "Finished, but some photos failed" : "All photos saved"}
              </p>
              <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                {uploadedCount} of {uploadProgress.total} photo{uploadProgress.total !== 1 ? "s" : ""} saved
                to {okLotCount} lot{okLotCount !== 1 ? "s" : ""}.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Photos saved" value={uploadedCount} tone={uploadedCount > 0 ? "good" : "bad"} />
            <Stat label="Lots updated" value={okLotCount} />
            <Stat label="Photos failed" value={skipped.length} tone={skipped.length > 0 ? "bad" : "plain"} />
            <Stat label="Not saved (unmatched)" value={unmatchedGroups.length} tone={unmatchedGroups.length > 0 ? "warn" : "plain"}
              sub={unmatchedGroups.length > 0 ? "labels not on a lot in this sale" : undefined} />
          </div>

          {uploadResults.length > 0 && (
            <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl overflow-hidden">
              <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#141416]">
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">Lot by lot</p>
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-gray-200 dark:divide-gray-800">
                {uploadResults.map((r, i) => (
                  <div key={i} className="px-4 py-2 flex items-center gap-3">
                    <span className={r.failed > 0 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}>
                      {r.failed > 0 ? "⚠" : "✓"}
                    </span>
                    <span className="font-mono text-xs text-gray-800 dark:text-gray-200 flex-1 truncate">{r.label}</span>
                    <span className="text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {r.uploaded} photo{r.uploaded !== 1 ? "s" : ""} saved
                      {r.failed > 0 ? <span className="text-red-600 dark:text-red-400"> · {r.failed} failed</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {skipped.length > 0 && (
            <div className="rounded-lg px-3 py-2 border bg-red-100 border-red-300 dark:bg-red-900/20 dark:border-red-700/50">
              <p className="text-xs text-red-800 dark:text-red-300 font-medium mb-1">Why photos failed:</p>
              <ul className="space-y-0.5 max-h-40 overflow-y-auto">
                {skipped.map((s, i) => (
                  <li key={i} className="text-xs text-red-700 dark:text-red-400 font-mono">{s}</li>
                ))}
              </ul>
            </div>
          )}

          {(unmatchedGroups.length > 0 || unreadableLabelGroups.length > 0 || preGroup.length > 0) && (
            <Notice tone="warn">
              <p className="font-medium mb-1">Still to sort out:</p>
              <ul className="space-y-0.5">
                {unmatchedGroups.length > 0 && (
                  <li>· {unmatchedGroups.length} label{unmatchedGroups.length !== 1 ? "s" : ""} not on any lot in this sale
                    (<span className="font-mono">{unmatchedGroups.slice(0, 6).map(g => g.label).join(", ")}{unmatchedGroups.length > 6 ? "…" : ""}</span>)</li>
                )}
                {unreadableLabelGroups.length > 0 && (
                  <li>· {unreadableLabelGroups.length} label{unreadableLabelGroups.length !== 1 ? "s" : ""} AI couldn&apos;t read — those photos weren&apos;t saved</li>
                )}
                {preGroup.length > 0 && (
                  <li>· {preGroup.length} photo{preGroup.length !== 1 ? "s" : ""} before the first label — not saved</li>
                )}
              </ul>
            </Notice>
          )}

          <div className="flex gap-3">
            <button onClick={reset}
              className="flex-1 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold transition-colors">
              📷 Upload more photos
            </button>
            <Link href="/tools/cataloguing/photography"
              className="px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm hover:border-gray-500 transition-colors flex items-center">
              Back to Photography
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
