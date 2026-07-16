"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { uploadLotPhoto, uploadLotLabelPhoto } from "@/lib/actions/catalogue"

interface Props {
  auctionId: string
  lots: { id: string; barcode: string | null; receiptUniqueId?: string | null }[]
  onUploaded: () => void
}

interface LotGroup {
  lotId:    string | null
  label:    string
  photos:   File[]
  labelPhoto?:      File      // the photo that started this group — shown in the review, never uploaded
  labelIndex?:      number    // index of the label photo in scanFiles (scan mode only)
  photoIndices?:    number[]  // scanFiles indices parallel to `photos` (scan mode only — drives the manual tools)
  needsCode?:       boolean   // a label with no code yet — the user must type it in the final review
  aiRead?:          boolean   // the barcode scanner missed this label; AI read the printed code
  edited?:          boolean   // the user marked/typed this label by hand
}

// One record per photo (scan mode). Scanner + AI results, plus the RESOLVED
// decision the grouping is built from. Kept as the source of truth so the
// discrepancy step and the final-review manual tools can re-flow the lots by
// editing decisions rather than rebuilding groups by hand.
interface PhotoInfo {
  scannerCode: string | null   // local barcode reader result (Vectis format), or null
  aiIsLabel:   boolean         // AI classified this photo as a barcode label
  aiCode:      string | null   // AI's guess at the printed code (Vectis format), or null
  aiAnswered:  boolean         // AI actually returned an answer for this photo
  unreadable:  boolean         // the browser couldn't decode the image (HEIC on Windows)
  // resolved:
  isLabel:     boolean         // final: this photo starts a lot
  code:        string | null   // final code for the label (may be user-typed); null = needs a code
  source:      "agree" | "scanner" | "ai" | "manual" | "none"
}

type DiscrepancyType = "mismatch" | "scanner-not-ai" | "ai-not-scanner"
interface Discrepancy {
  index:       number
  type:        DiscrepancyType
  scannerCode: string | null
  aiCode:      string | null
  resolved:    boolean
}

type Phase = "idle" | "scanning" | "discrepancies" | "preview" | "uploading" | "done"
type Mode  = "scan" | "filename"

// Reconcile one photo's scanner + AI reads into a starting decision, and say
// whether it is a discrepancy a human should look at. The SCANNER wins a code
// disagreement by default (Code 128 has a checksum; AI misreads printed text
// more often), but every genuine disagreement is surfaced for review.
function resolvePhoto(
  scannerCode: string | null, aiAnswered: boolean, aiIsLabel: boolean, aiCode: string | null,
): { isLabel: boolean; code: string | null; source: PhotoInfo["source"]; discrepancy: DiscrepancyType | null } {
  const s = scannerCode
  const a = aiCode
  if (s && a) {
    if (s.toLowerCase() === a.toLowerCase()) return { isLabel: true, code: s, source: "agree", discrepancy: null }
    return { isLabel: true, code: s, source: "scanner", discrepancy: "mismatch" }
  }
  if (s && !a) {
    // Scanner read a Vectis code. If AI actively says "item photo", that's a
    // conflict (a sticker in an item photo?) — default to keeping the label
    // (a Vectis code was decoded) but flag it. Otherwise they agree.
    if (aiAnswered && !aiIsLabel) return { isLabel: true, code: s, source: "scanner", discrepancy: "scanner-not-ai" }
    return { isLabel: true, code: s, source: "scanner", discrepancy: null }
  }
  if (!s && a) {
    // AI read a code the scanner missed — a real blurry label, or an AI
    // misread. Default to accepting it, but flag for review.
    return { isLabel: true, code: a, source: "ai", discrepancy: "ai-not-scanner" }
  }
  // Neither read a code.
  if (aiIsLabel) return { isLabel: true, code: null, source: "ai", discrepancy: null }  // unreadable label — a gap, not a conflict; typed in the final review
  return { isLabel: false, code: null, source: "none", discrepancy: null }
}

// Derive the lot groups from the per-photo decisions. A photo whose decision is
// isLabel starts a lot (its photo is the label, never uploaded); following
// non-label photos join it; photos before the first label go to preGroup.
function buildGroups(
  files: File[], infos: PhotoInfo[], lotMap: Map<string, string>,
): { groups: LotGroup[]; preGroup: File[] } {
  const groups: LotGroup[] = []
  const preGroup: File[] = []
  let current: LotGroup | null = null
  for (let i = 0; i < files.length; i++) {
    const info = infos[i]
    if (info.isLabel) {
      const code  = info.code
      const lotId = code ? (lotMap.get(code.toLowerCase().trim()) ?? null) : null
      current = {
        lotId,
        label: code ?? `Needs code — ${files[i].name}`,
        photos: [], photoIndices: [],
        labelPhoto: files[i], labelIndex: i,
        needsCode: !code,
        aiRead: info.source === "ai" && !!code,   // AI read a code the scanner missed (not the unread-label case)
        edited: info.source === "manual",
      }
      groups.push(current)
    } else if (current) {
      current.photos.push(files[i])
      current.photoIndices!.push(i)
    } else {
      preGroup.push(files[i])
    }
  }
  return { groups, preGroup }
}

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
  // Scan mode source of truth: the files and one decision per file. Groups are
  // DERIVED from these, so the discrepancy step and the manual "this is a
  // barcode" tool just edit decisions and re-flow.
  const [scanFiles, setScanFiles]   = useState<File[]>([])
  const [photoInfos, setPhotoInfos] = useState<PhotoInfo[]>([])
  const [discrepancies, setDiscrepancies] = useState<Discrepancy[]>([])
  const [markingIndex, setMarkingIndex] = useState<number | null>(null)  // photo the user is typing a code for
  const [markingCode, setMarkingCode]   = useState("")
  const [showAllLots, setShowAllLots]   = useState(false)     // final review: all lots vs only ones needing attention
  const [scanProgress, setScanProgress]     = useState({ done: 0, total: 0 })
  const [scanStage, setScanStage]           = useState<"local" | "ai">("local")  // scanning phase sub-stage
  const [aiProgress, setAiProgress]         = useState({ done: 0, total: 0 })
  const [aiFailed, setAiFailed]             = useState(false)   // AI check errored/skipped for some photos — those photos are scanner-only
  const [aiReadCount, setAiReadCount]       = useState(0)       // labels the scanner missed but AI read
  const [aiCheckedCount, setAiCheckedCount] = useState(0)       // photos that actually got an AI answer
  const [aiNote, setAiNote]                 = useState<string | null>(null)  // live status/error during the AI pass
  const [aiEta, setAiEta]                   = useState<string | null>(null)
  const [aiRetries, setAiRetries]           = useState(0)       // rate-limit / retry pauses ridden out during the run
  const [aiLog, setAiLog]                   = useState<{ t: number; msg: string }[]>([])  // live activity feed
  const [troubleSince, setTroubleSince]     = useState<number | null>(null)  // when AI trouble began (for the escalation panel)
  const troubleRef  = useRef<number | null>(null)               // same, readable inside the scan closures
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

  // Append a line to the AI activity feed (component-scope so the Skip button
  // and the scan closures can both call it).
  function logEvent(msg: string) {
    setAiLog(prev => [...prev, { t: Date.now(), msg }].slice(-14))
  }

  // ── Reset to idle ─────────────────────────────────────────────────────────────
  function reset() {
    revokeThumbs()
    setMode(null)
    setPhase("idle")
    setGroups([])
    setPreGroup([])
    setUnreadable(0)
    setScanFiles([])
    setPhotoInfos([])
    setDiscrepancies([])
    setMarkingIndex(null)
    setMarkingCode("")
    setShowAllLots(false)
    setScanStage("local")
    setAiProgress({ done: 0, total: 0 })
    setAiFailed(false)
    setAiReadCount(0)
    setAiCheckedCount(0)
    setAiNote(null)
    setAiEta(null)
    setAiRetries(0)
    setAiLog([])
    setTroubleSince(null)
    troubleRef.current = null
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
    setAiRetries(0)
    setAiLog([])
    setTroubleSince(null)
    troubleRef.current = null
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

        // zxing fallback — the ONLY reader on Windows/iPad (BarcodeDetector
        // isn't available there). Three contrast treatments (normal / contrast-
        // boost / hard black-and-white) with the proven Hybrid binarizer. The
        // contrast-boost pass (never wired into zxing before) is what rescues
        // faint silver labels the plain pass misses.
        // NB: keep ONE binarizer on this shared, STATEFUL reader — mixing in a
        // second binarizer type here corrupted its state and made it read
        // nothing at all (2026-07-15). Don't add another without a fresh reader.
        for (const targetW of [2000, 1200]) {
          for (const scanMode of ["normal", "contrast", "bw"] as const) {
            try {
              const luminance = new HTMLCanvasElementLuminanceSource(toCanvas(targetW, scanMode))
              const decoded   = zxing.decodeWithState(new BinaryBitmap(new HybridBinarizer(luminance))).getText().replace(/[^\x20-\x7E]/g, "").trim()
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
      const started = Date.now()
      // ETA baseline — reset after a rate-limit recovery so the estimate is
      // measured from ACTIVE processing time, not cumulative wall-clock that
      // includes minutes of cooldown (which made it read "about 800 min left").
      let etaBaseTime = started
      let etaBaseDone = 0

      // Trouble tracking for the escalation panel. Only NOTABLE, low-frequency
      // events are logged (not every batch) so the feed stays readable and
      // doesn't thrash re-renders on a 2000-photo run. logEvent is component-scope.
      const enterTrouble = () => {
        if (troubleRef.current === null) { troubleRef.current = Date.now(); setTroubleSince(troubleRef.current) }
      }
      const clearTrouble = () => {
        if (troubleRef.current !== null) {
          troubleRef.current = null; setTroubleSince(null)
          etaBaseTime = Date.now(); etaBaseDone = doneCount   // measure the ETA fresh from here
          logEvent("✓ Back to normal — carrying on")
        }
      }
      logEvent(`Started AI check of ${candidates.length} photos`)

      // Rate-limit gate shared by ALL workers. When one request is rate-limited
      // we push a cooldown that every worker waits behind, then they all carry
      // on — so a big run rides out a Gemini rate limit by itself instead of
      // hammering it and needing a human. rlLevel grows on each 429 (longer
      // waits, up to 5 min) and eases off after good responses.
      let rlLevel = 0
      let cooldownUntil = 0
      let retries = 0
      const rlBackoff = (level: number) => Math.min(30_000 * 2 ** (level - 1), 300_000)  // 30s→60s→…→5min

      async function waitForGate() {
        while (!skipAiRef.current && Date.now() < cooldownUntil) {
          const remain = cooldownUntil - Date.now()
          setAiNote(`⏳ AI is rate limited — pausing ${Math.ceil(remain / 1000)}s, then it carries on by itself. You don't need to wait here.`)
          await new Promise(r => setTimeout(r, Math.min(remain, 1000)))
        }
      }

      // Send one packed request, retrying transient failures (rate limits,
      // network, timeouts) FOR AS LONG AS IT TAKES so the run finishes on its
      // own. Only gives up THIS pack on a content block, or after many
      // non-rate-limit errors on the same pack (so one bad image can't loop for
      // ever) — never the whole run. A given-up pack's photos fall back to
      // barcode scanning; false = this pack got no AI answer.
      async function postPack(pack: { i: number; payload: Blob | File }[]): Promise<boolean> {
        let softFails = 0                 // consecutive non-rate-limit errors on THIS pack
        const POISON_CAP = 8
        while (!skipAiRef.current) {
          await waitForGate()
          if (skipAiRef.current) return false
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
              rlLevel = Math.max(0, rlLevel - 1)               // ease off after a good response
              clearTrouble()
              if (Date.now() >= cooldownUntil) setAiNote(null)
              return true
            }
            if (res.status === 422) {                          // content block — never succeeds
              setAiNote("AI wouldn't look at some photos — those fall back to barcode scanning.")
              logEvent("Some photos were refused by AI — barcode only for those")
              return false
            }
            if (res.status === 429) {                          // rate limited — back everyone off, keep going
              rlLevel += 1; retries += 1; setAiRetries(retries)
              const waitS = Math.ceil(rlBackoff(rlLevel) / 1000)
              cooldownUntil = Math.max(cooldownUntil, Date.now() + rlBackoff(rlLevel))
              enterTrouble(); setAiEta(null); logEvent(`⏳ Gemini is rate limiting us — pausing ${waitS}s, then carrying on`)
              continue                                         // no attempt cap — waits it out
            }
            // Other server error — retry this pack with a growing wait, up to a cap.
            softFails += 1; retries += 1; setAiRetries(retries)
            const why = data?.error ?? `HTTP ${res.status}`
            enterTrouble()
            if (softFails >= POISON_CAP) { setAiNote(`AI kept failing on some photos (${why}) — those fall back to barcode scanning; the rest carries on.`); logEvent(`A batch kept failing (${why}) — barcode only for those`); return false }
            setAiNote(`AI had a problem — trying again (${why})`)
            await new Promise(r => setTimeout(r, Math.min(softFails * 5000, 60_000)))
          } catch (e: any) {
            if (e?.name === "AbortError" && skipAiRef.current) return false
            softFails += 1; retries += 1; setAiRetries(retries)
            enterTrouble()
            if (softFails >= POISON_CAP) { setAiNote("AI couldn't be reached for some photos — those fall back to barcode scanning; the rest carries on."); logEvent("Couldn't reach AI for a batch — barcode only for those"); return false }
            setAiNote(e?.name === "AbortError" ? "An AI request took too long — trying again…" : "Couldn't reach the AI (network problem) — trying again…")
            await new Promise(r => setTimeout(r, Math.min(softFails * 5000, 60_000)))
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
          if (!ok) aiErrored = true   // this pack fell back to scanner-only; the run keeps going
        }
      }

      // Run several batches at once. The pass NEVER gives up on the rest of the
      // folder — postPack retries transient failures until they clear — so a
      // ~2000-photo run finishes unattended. Only a Skip stops it early.
      let next = 0
      async function worker() {
        while (next < batches.length && !skipAiRef.current) {
          const b = batches[next++]
          const before = doneCount
          await runBatch(b)
          doneCount += b.length
          setAiProgress({ done: doneCount, total: candidates.length })
          // Milestone every 500 photos (low-frequency feed entry).
          if (Math.floor(doneCount / 500) > Math.floor(before / 500)) {
            logEvent(`Checked ${Math.floor(doneCount / 500) * 500} of ${candidates.length} photos`)
          }
          // ETA only while things are flowing, from a fresh baseline with
          // enough samples — never during trouble (the countdown covers that),
          // so a rate-limit pause can't inflate it to a scary number.
          if (troubleRef.current === null && !skipAiRef.current && doneCount - etaBaseDone >= 16) {
            const perPhoto = (Date.now() - etaBaseTime) / (doneCount - etaBaseDone)
            const leftMs   = perPhoto * (candidates.length - doneCount)
            setAiEta(leftMs > 45_000 ? `about ${Math.ceil(leftMs / 60_000)} min remaining` : "nearly done")
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(AI_CONCURRENCY, batches.length) }, worker))

      if (skipAiRef.current) aiErrored = true
    }

    // One decision per photo, reconciling scanner + AI, collecting the
    // disagreements a human should settle before the lots are organised.
    const infos: PhotoInfo[] = []
    const discs: Discrepancy[] = []
    let unreadableCount = 0
    let aiRead = 0
    for (let i = 0; i < files.length; i++) {
      const d = decoded[i]
      if (d.unreadable) unreadableCount++
      const a = aiRes.get(i)
      const aiAnswered = !!a
      const aiIsLabel  = a?.label === true
      const aiCode     = a?.code ?? null
      const r = resolvePhoto(d.barcode, aiAnswered, aiIsLabel, aiCode)
      if (r.source === "ai" && aiCode) aiRead++
      infos.push({
        scannerCode: d.barcode, aiIsLabel, aiCode, aiAnswered, unreadable: d.unreadable,
        isLabel: r.isLabel, code: r.code, source: r.source,
      })
      if (r.discrepancy) discs.push({ index: i, type: r.discrepancy, scannerCode: d.barcode, aiCode, resolved: false })
    }

    if (!infos.some(x => x.isLabel)) {
      // Nothing that could start a lot. Say what the AI did — a total miss with
      // a WORKING AI check means the labels genuinely aren't there, a failed AI
      // check on HEIC files means "convert to JPEG".
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
    setScanFiles(files)
    setPhotoInfos(infos)
    const built = buildGroups(files, infos, lotMap)
    setGroups(built.groups)
    setPreGroup(built.preGroup)
    setUnreadable(unreadableCount)
    setAiFailed(aiErrored)
    setAiReadCount(aiRead)
    setAiCheckedCount(aiRes.size)
    setDiscrepancies(discs)
    // Settle the disagreements first, then the final review; skip straight to
    // review when scanner and AI agreed on everything.
    setPhase(discs.length > 0 ? "discrepancies" : "preview")
  }

  // ── Edit decisions → re-flow the lots (scan mode) ────────────────────────────
  // Every fix works the same way: change one photo's decision, then rebuild the
  // groups from the whole decision array so the following photos land correctly.
  function reflow(nextInfos: PhotoInfo[]) {
    setPhotoInfos(nextInfos)
    const built = buildGroups(scanFiles, nextInfos, lotMap)
    setGroups(built.groups)
    setPreGroup(built.preGroup)
  }
  function patchInfo(index: number, patch: Partial<PhotoInfo>) {
    reflow(photoInfos.map((x, i) => i === index ? { ...x, ...patch } : x))
  }

  // Settle one discrepancy: trust the scanner's code, trust AI's code, or say
  // it isn't a label at all (its photos then merge into the lot above).
  function resolveDiscrepancy(d: Discrepancy, choice: "scanner" | "ai" | "not-label") {
    const patch: Partial<PhotoInfo> =
      choice === "scanner" ? { isLabel: true,  code: d.scannerCode, source: "scanner" }
      : choice === "ai"    ? { isLabel: true,  code: d.aiCode,      source: "ai" }
      :                      { isLabel: false, code: null,          source: "none" }
    patchInfo(d.index, patch)
    setDiscrepancies(prev => prev.map(x => x.index === d.index ? { ...x, resolved: true } : x))
  }
  // What the current decision means for a discrepancy, so the buttons can show
  // which one is active.
  function discChoice(d: Discrepancy): "scanner" | "ai" | "not-label" {
    const info = photoInfos[d.index]
    if (!info?.isLabel) return "not-label"
    if (d.aiCode && info.code?.toLowerCase() === d.aiCode.toLowerCase()) return "ai"
    return "scanner"
  }

  // Final review: the user found a label the scan missed. Mark that photo as a
  // barcode with the typed code — a new lot starts there and the following
  // photos re-flow into it.
  function markPhotoAsBarcode(index: number, code: string) {
    const clean = code.replace(/[^\x20-\x7E]/g, "").trim().toUpperCase()
    if (!clean) return
    patchInfo(index, { isLabel: true, code: clean, source: "manual" })
    setMarkingIndex(null)
    setMarkingCode("")
  }
  // Fill in the code for a label AI saw but couldn't read.
  function setLabelCode(index: number, code: string) {
    const clean = code.replace(/[^\x20-\x7E]/g, "").trim().toUpperCase()
    if (!clean) return
    patchInfo(index, { isLabel: true, code: clean, source: "manual" })
    setMarkingIndex(null)
    setMarkingCode("")
  }
  // The user says a detected label isn't really one — drop it back into the lot
  // above (its own photo included, since it wasn't a label after all).
  function unmarkLabel(index: number) {
    patchInfo(index, { isLabel: false, code: null, source: "none" })
  }

  const isVectisCode = (s: string) =>
    /^[A-Za-z]\d{6,7}$/.test(s.trim()) || /^[A-Za-z]\d{4,7}-\d{1,6}$/.test(s.trim())

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
      // Keep the label photo that assigned these photos, so a grouping mistake
      // can be checked later in the lot viewer. Stored on its own column, never
      // in the lot's real photos. A failure here is not worth failing the lot
      // over — the photos are already safely saved.
      if (ok > 0 && group.labelPhoto) {
        try {
          const lfd = new FormData()
          lfd.set("photo", group.labelPhoto)
          await uploadLotLabelPhoto(group.lotId!, auctionId, lfd)
        } catch { /* ignore — the lot's photos matter, the label is a bonus */ }
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
  const unmatchedGroups = groups.filter(g => !g.lotId && !g.needsCode)   // has a code, but not a lot in this sale
  const needsCodeGroups = groups.filter(g => g.needsCode)                // a label with no code typed yet
  const emptyGroups     = groups.filter(g => g.lotId && g.photos.length === 0)
  const editedCount     = groups.filter(g => g.edited).length
  const totalPhotos     = matchedGroups.reduce((sum, g) => sum + g.photos.length, 0)
  const uploadedCount   = uploadProgress.done - skipped.length

  // Flag groups with far more photos than typical — the classic sign that the
  // next lot's label failed to scan and two lots ran together. LOWER median on
  // even counts so the merged-lot case can actually fire.
  const photoCounts   = groups.filter(g => g.photos.length > 0).map(g => g.photos.length).sort((a, b) => a - b)
  const median        = photoCounts.length ? photoCounts[Math.floor((photoCounts.length - 1) / 2)] : 0
  const flagThreshold = Math.max(6, median * 2)
  const isFlagged     = (g: LotGroup) => mode === "scan" && !!g.lotId && g.photos.length >= flagThreshold
  const flaggedCount  = groups.filter(isFlagged).length

  const needsAttention = (g: LotGroup) => !g.lotId || g.needsCode || isFlagged(g)
  const attentionCount = groups.filter(needsAttention).length + (preGroup.length > 0 ? 1 : 0)
  const resolvedCount  = discrepancies.filter(d => d.resolved).length

  function renderGroupCard(g: LotGroup, i: number) {
    const flagged  = isFlagged(g)
    const scanMode = g.labelIndex !== undefined   // manual tools only exist in scan mode
    return (
      <div key={`${g.label}-${i}`}
        className={`rounded-xl border px-4 py-3 ${
          g.needsCode
            ? "bg-orange-50 border-orange-400 dark:bg-orange-900/10 dark:border-orange-500/70"
            : !g.lotId
              ? "bg-yellow-50 border-yellow-400 dark:bg-yellow-900/10 dark:border-yellow-700/50"
              : flagged
                ? "bg-amber-50 border-amber-400 dark:bg-amber-900/10 dark:border-amber-500/70"
                : "bg-white dark:bg-[#1C1C1E] border-gray-300 dark:border-gray-700"
        }`}>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className={`font-mono text-sm ${
            g.needsCode ? "text-orange-700 dark:text-orange-400"
              : g.lotId ? "text-[#2AB4A6]" : "text-yellow-700 dark:text-yellow-400"
          }`}>{g.label}</span>
          <span className="text-xs text-gray-600 dark:text-gray-500">
            {g.photos.length} photo{g.photos.length !== 1 ? "s" : ""}
          </span>
          {g.needsCode && (
            <span className="text-xs bg-orange-200 text-orange-800 dark:bg-orange-900/40 dark:text-orange-400 rounded-full px-2 py-0.5">
              🔎 label found but not read — type the code
            </span>
          )}
          {!g.lotId && !g.needsCode && (
            <span className="text-xs bg-yellow-200 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-400 rounded-full px-2 py-0.5">
              not a lot in this sale — won&apos;t save
            </span>
          )}
          {g.aiRead && !g.edited && (
            <span className="text-xs bg-purple-200 text-purple-800 dark:bg-purple-900/40 dark:text-purple-400 rounded-full px-2 py-0.5">
              ✨ read by AI
            </span>
          )}
          {g.edited && (
            <span className="text-xs bg-blue-200 text-blue-800 dark:bg-blue-900/40 dark:text-blue-400 rounded-full px-2 py-0.5">
              ✎ you set this
            </span>
          )}
          {flagged && (
            <span className="text-xs bg-amber-200 text-amber-800 dark:bg-amber-900/40 dark:text-amber-400 rounded-full px-2 py-0.5">
              ⚠ a lot of photos — check none belong to the next lot
            </span>
          )}
          <span className="ml-auto flex gap-1.5">
            {g.needsCode && scanMode && (
              <button onClick={() => { setMarkingIndex(g.labelIndex!); setMarkingCode("") }}
                className="text-xs px-2 py-0.5 rounded-full bg-orange-500 hover:bg-orange-600 text-white transition-colors">
                🏷 Type the barcode
              </button>
            )}
            {/* Every scan-mode label can be dismissed — including a needsCode one
                that AI wrongly flagged (there'd be no code to type), which would
                otherwise orphan the photos below it with no way back. */}
            {scanMode && (
              <button onClick={() => unmarkLabel(g.labelIndex!)}
                className="text-xs px-2 py-0.5 rounded-full border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-gray-500 transition-colors">
                ✕ Not a label{g.needsCode ? " — merge into the lot above" : ""}
              </button>
            )}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {g.labelPhoto && (
            <div className="relative flex-shrink-0" title={`Barcode label — ${g.labelPhoto.name} (not saved)`}>
              <Thumb url={thumbUrls.current.get(g.labelPhoto) ?? ""} name={g.labelPhoto.name} />
              <span className="absolute -top-1 -left-1 text-[9px] leading-none bg-gray-700 text-white dark:bg-gray-200 dark:text-gray-900 rounded px-1 py-0.5">label</span>
            </div>
          )}
          {g.photos.map((p, j) => {
            const gi = g.photoIndices?.[j]
            return (
              <div key={j} className="relative flex-shrink-0 group/ph">
                <Thumb url={thumbUrls.current.get(p) ?? ""} name={p.name} />
                {scanMode && gi !== undefined && (
                  <button
                    onClick={() => { setMarkingIndex(gi); setMarkingCode("") }}
                    title="This photo is actually a barcode label"
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-purple-600 hover:bg-purple-500 text-white text-[10px] leading-none flex items-center justify-center opacity-0 group-hover/ph:opacity-100 focus:opacity-100 transition-opacity">
                    🏷
                  </button>
                )}
              </div>
            )
          })}
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
  const needsALook = attentionCount
  // Escalation panel shows when AI has been in trouble for over ~2 minutes.
  // The cooldown countdown re-renders every second, so this re-evaluates live.
  const troubleMins = troubleSince ? Math.floor((Date.now() - troubleSince) / 60_000) : 0
  const escalated   = troubleSince !== null && (Date.now() - troubleSince) > 120_000

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

                  {/* Escalation — only when AI has struggled for a couple of minutes */}
                  {escalated && (
                    <div className="mt-3 rounded-lg border border-red-300 dark:border-red-700/60 bg-red-100 dark:bg-red-900/20 px-3 py-2.5">
                      <p className="text-xs font-semibold text-red-800 dark:text-red-300">
                        AI has been struggling for {troubleMins} minute{troubleMins !== 1 ? "s" : ""}.
                      </p>
                      <p className="text-xs text-red-800 dark:text-red-300 mt-1">
                        It keeps trying on its own and will finish if the AI comes back — you can leave it running.
                        If Gemini looks to be having an outage and you&apos;d rather not wait, press
                        <strong> Skip</strong> below to finish this scan by barcode grouping only, then check the lots
                        carefully in the review before saving.
                      </p>
                    </div>
                  )}

                  <button
                    onClick={() => { skipAiRef.current = true; aiAbortsRef.current.forEach(c => c.abort()); logEvent("AI check skipped — grouping by barcode only") }}
                    className="mt-3 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-xs hover:border-gray-500 transition-colors">
                    Skip the AI check — group by barcode only
                  </button>

                  {/* Live activity feed */}
                  {aiLog.length > 0 && (
                    <div className="mt-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#141416] max-h-40 overflow-y-auto">
                      <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-500 px-3 pt-2 pb-1">Activity</p>
                      <ul className="px-3 pb-2 space-y-0.5">
                        {aiLog.slice().reverse().map((e, i) => (
                          <li key={aiLog.length - i} className="text-xs text-gray-600 dark:text-gray-400 flex gap-2">
                            <span className="text-gray-400 dark:text-gray-600 tabular-nums flex-shrink-0">
                              {new Date(e.t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                            </span>
                            <span>{e.msg}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">Waiting for the barcode read to finish…</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ Discrepancies — settle where the reader and AI disagree ══ */}
      {phase === "discrepancies" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Settle the disagreements</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
              The barcode reader and AI didn&apos;t agree on these photos. Pick the right answer for each — then the
              lots get organised. A sensible default is already chosen, so you can also just continue.
            </p>
          </div>

          <Notice tone="ai">
            {resolvedCount} of {discrepancies.length} settled. The reader has a checksum so it&apos;s usually right on
            a code; AI is better at spotting a photo that isn&apos;t a label at all.
          </Notice>

          <div className="space-y-2 max-h-[34rem] overflow-y-auto pr-1">
            {discrepancies.map(d => {
              const file   = scanFiles[d.index]
              const choice = discChoice(d)
              const Btn = ({ c, label }: { c: "scanner" | "ai" | "not-label"; label: React.ReactNode }) => (
                <button onClick={() => resolveDiscrepancy(d, c)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    choice === c
                      ? "bg-purple-600 text-white"
                      : "border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-purple-400"
                  }`}>
                  {label}
                </button>
              )
              return (
                <div key={d.index}
                  className={`rounded-xl border px-4 py-3 flex gap-4 ${
                    d.resolved
                      ? "bg-white dark:bg-[#1C1C1E] border-gray-200 dark:border-gray-800"
                      : "bg-purple-50 border-purple-300 dark:bg-purple-900/10 dark:border-purple-500/60"
                  }`}>
                  <div className="w-20 h-20 flex-shrink-0">
                    {file && <Thumb url={thumbUrls.current.get(file) ?? ""} name={file.name} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-700 dark:text-gray-300 mb-2">
                      {d.type === "mismatch" && <>The reader read <span className="font-mono text-gray-900 dark:text-white">{d.scannerCode}</span> but AI read <span className="font-mono text-gray-900 dark:text-white">{d.aiCode}</span>. Which code is on the label?</>}
                      {d.type === "scanner-not-ai" && <>The reader read <span className="font-mono text-gray-900 dark:text-white">{d.scannerCode}</span>, but AI thinks this is an item photo, not a barcode label.</>}
                      {d.type === "ai-not-scanner" && <>AI thinks this is a label reading <span className="font-mono text-gray-900 dark:text-white">{d.aiCode}</span>, but the barcode reader didn&apos;t find one.</>}
                    </p>
                    <div className="flex gap-1.5 flex-wrap">
                      {d.scannerCode && <Btn c="scanner" label={<>Reader — <span className="font-mono">{d.scannerCode}</span></>} />}
                      {d.aiCode      && <Btn c="ai"      label={<>AI — <span className="font-mono">{d.aiCode}</span></>} />}
                      <Btn c="not-label" label="Not a barcode label" />
                    </div>
                  </div>
                  {d.resolved && <span className="text-green-600 dark:text-green-400 text-lg flex-shrink-0">✓</span>}
                </div>
              )
            })}
          </div>

          <div className="flex gap-3 sticky bottom-0 bg-gray-50 dark:bg-[#141416] py-3 border-t border-gray-200 dark:border-gray-800">
            <button onClick={reset}
              className="px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm hover:border-gray-500 transition-colors">
              ← Start again
            </button>
            <button onClick={() => setPhase("preview")}
              className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-lg text-sm transition-colors">
              {resolvedCount < discrepancies.length
                ? `Continue — ${discrepancies.length - resolvedCount} left on the default`
                : "Continue to final review"} →
            </button>
          </div>
        </div>
      )}

      {/* ══ Final review — organised lots, fix any missed barcode, then save ══ */}
      {phase === "preview" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              {mode === "filename" ? "Check the filename matches" : "Final review"}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
              Nothing has been saved yet. Each lot shows its barcode label and its photos.
              {mode === "scan" && <> Missed a label? Hover a photo and press <span className="font-semibold">🏷</span> to set it — the photos re-flow into the right lot.</>}
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
              ✨ AI reviewed {aiCheckedCount} photo{aiCheckedCount !== 1 ? "s" : ""}
              {aiReadCount > 0 ? <>, reading {aiReadCount} label{aiReadCount !== 1 ? "s" : ""} the barcode reader missed</> : null}
              {editedCount > 0 ? <>. You set {editedCount} by hand</> : null}.
              {aiRetries > 0 ? <> It rode out {aiRetries} rate-limit/retry pause{aiRetries !== 1 ? "s" : ""} on its own along the way.</> : null}
            </Notice>
          )}
          {mode === "scan" && aiFailed && (
            <Notice tone="bad">
              ⚠ The AI check couldn&apos;t run for some photos (a problem with the AI, the network, or it was
              skipped). Those were grouped by barcode alone, so a missed label could have merged two lots. Check the
              lots below, or scan again.
            </Notice>
          )}
          {needsCodeGroups.length > 0 && (
            <Notice tone="warn">
              🔎 {needsCodeGroups.length} label{needsCodeGroups.length !== 1 ? "s" : ""} {needsCodeGroups.length !== 1 ? "were" : "was"} spotted
              but couldn&apos;t be read — the orange cards below. Press <span className="font-semibold">🏷 Type the barcode</span> on each to enter the code; until then those photos won&apos;t save.
            </Notice>
          )}
          {flaggedCount > 0 && (
            <Notice tone="warn">
              ⚠ {flaggedCount} lot{flaggedCount !== 1 ? "s have" : " has"} far more photos than the rest — often a sign
              a label didn&apos;t scan and two lots ran together. If so, hover the label photo and press 🏷 to split it.
            </Notice>
          )}
          {unreadable > 0 && (
            <Notice tone={aiFailed ? "warn" : "info"}>
              {aiFailed
                ? <>⚠ {unreadable} photo{unreadable !== 1 ? "s" : ""} couldn&apos;t be read on this device (usually
                  HEIC from an iPhone) and the AI check didn&apos;t cover them — convert them to JPEG and scan again.</>
                : <>ℹ {unreadable} photo{unreadable !== 1 ? "s" : ""} can&apos;t be previewed on this device (usually
                  HEIC from an iPhone). AI still checked them and they will still save — they just show as a
                  placeholder tile.</>}
            </Notice>
          )}
          {unmatchedGroups.length > 0 && (
            <Notice tone="warn">
              <p className="font-medium mb-1">
                {unmatchedGroups.length} label{unmatchedGroups.length !== 1 ? "s" : ""} {unmatchedGroups.length !== 1 ? "aren't" : "isn't"} a
                lot in this sale — their photos won&apos;t save:
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

          {/* Photos before the first label — recoverable if a label here was missed */}
          {preGroup.length > 0 && (
            <div className="rounded-lg px-3 py-2 border bg-amber-100 border-amber-300 dark:bg-amber-900/20 dark:border-amber-700/50">
              <p className="text-xs text-amber-800 dark:text-amber-300 font-medium mb-2">
                {preGroup.length} photo{preGroup.length !== 1 ? "s" : ""} came before the first label and won&apos;t save. If
                one of these is really a barcode, hover it and press 🏷.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {preGroup.map((p, j) => {
                  const gi = scanFiles.indexOf(p)
                  return (
                    <div key={j} className="relative flex-shrink-0 group/ph">
                      <Thumb url={thumbUrls.current.get(p) ?? ""} name={p.name} />
                      {mode === "scan" && gi >= 0 && (
                        <button onClick={() => { setMarkingIndex(gi); setMarkingCode("") }}
                          title="This photo is a barcode label"
                          className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-purple-600 hover:bg-purple-500 text-white text-[10px] leading-none flex items-center justify-center opacity-0 group-hover/ph:opacity-100 focus:opacity-100 transition-opacity">
                          🏷
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Lot list with a filter so a big sale doesn't render everything at once */}
          {groups.length > 0 && (
            <>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  {showAllLots ? `All ${groups.length} lots` : `${attentionCount} lot${attentionCount !== 1 ? "s" : ""} needing a look`}
                </p>
                <div className="flex gap-1">
                  <button onClick={() => setShowAllLots(false)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${!showAllLots ? "bg-purple-600 text-white" : "border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-500"}`}>
                    Needs attention ({attentionCount})
                  </button>
                  <button onClick={() => setShowAllLots(true)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${showAllLots ? "bg-purple-600 text-white" : "border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-500"}`}>
                    All lots ({groups.length})
                  </button>
                </div>
              </div>
              <div className="space-y-2 max-h-[34rem] overflow-y-auto pr-1">
                {groups.map((g, i) => (showAllLots || needsAttention(g)) ? renderGroupCard(g, i) : null)}
                {!showAllLots && attentionCount === 0 && (
                  <Notice tone="good">Everything looks right — nothing needs a second look. Switch to “All lots” to browse them, or save.</Notice>
                )}
              </div>
            </>
          )}

          {error && <Notice tone="bad">{error}</Notice>}

          <div className="flex gap-3 sticky bottom-0 bg-gray-50 dark:bg-[#141416] py-3 border-t border-gray-200 dark:border-gray-800">
            <button onClick={reset}
              className="px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm hover:border-gray-500 transition-colors">
              ← Start again
            </button>
            {discrepancies.length > 0 && (
              <button onClick={() => setPhase("discrepancies")}
                className="px-5 py-2.5 rounded-lg border border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-400 text-sm hover:border-purple-500 transition-colors">
                ← Disagreements
              </button>
            )}
            <button onClick={handleUpload} disabled={matchedGroups.length === 0}
              className="flex-1 py-2.5 bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-50 text-black font-semibold rounded-lg text-sm transition-colors">
              Save {totalPhotos} photo{totalPhotos !== 1 ? "s" : ""} to {matchedGroups.length} lot{matchedGroups.length !== 1 ? "s" : ""}
            </button>
          </div>

          {/* Mark-as-barcode modal — set or type a code for a photo */}
          {markingIndex !== null && scanFiles[markingIndex] && (
            <div onClick={() => setMarkingIndex(null)}
              className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
              <div onClick={e => e.stopPropagation()}
                className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl p-5 w-full max-w-sm">
                <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">What barcode is on this photo?</p>
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                  It becomes a lot label, and the photos after it (up to the next label) move into that lot.
                </p>
                <div className="flex justify-center mb-3">
                  <img src={thumbUrls.current.get(scanFiles[markingIndex]) ?? ""} alt=""
                    className="max-h-48 rounded-lg border border-gray-300 dark:border-gray-700 object-contain" />
                </div>
                <input
                  autoFocus
                  value={markingCode}
                  onChange={e => setMarkingCode(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && markingCode.trim()) markPhotoAsBarcode(markingIndex, markingCode) }}
                  placeholder="e.g. F066001 or R000016-413"
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                {markingCode.trim() && !isVectisCode(markingCode) && (
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-1.5">
                    That doesn&apos;t look like a Vectis barcode (e.g. F066001 or R000016-413) — you can still use it.
                  </p>
                )}
                <div className="flex gap-2 mt-4">
                  <button onClick={() => setMarkingIndex(null)}
                    className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm hover:border-gray-500 transition-colors">
                    Cancel
                  </button>
                  <button onClick={() => markPhotoAsBarcode(markingIndex, markingCode)} disabled={!markingCode.trim()}
                    className="flex-1 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-sm font-semibold transition-colors">
                    Set as barcode
                  </button>
                </div>
              </div>
            </div>
          )}
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

          {(unmatchedGroups.length > 0 || needsCodeGroups.length > 0 || preGroup.length > 0) && (
            <Notice tone="warn">
              <p className="font-medium mb-1">Still to sort out:</p>
              <ul className="space-y-0.5">
                {unmatchedGroups.length > 0 && (
                  <li>· {unmatchedGroups.length} label{unmatchedGroups.length !== 1 ? "s" : ""} not on any lot in this sale
                    (<span className="font-mono">{unmatchedGroups.slice(0, 6).map(g => g.label).join(", ")}{unmatchedGroups.length > 6 ? "…" : ""}</span>)</li>
                )}
                {needsCodeGroups.length > 0 && (
                  <li>· {needsCodeGroups.length} label{needsCodeGroups.length !== 1 ? "s" : ""} left without a code — those photos weren&apos;t saved</li>
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
