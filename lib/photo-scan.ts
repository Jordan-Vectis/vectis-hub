// Reading barcode labels out of a folder of photos, and grouping those photos into lots.
//
// ⚠ BROWSER ONLY — it uses document/Image/canvas and lazily imports the zxing WASM reader.
// Import it from client components only; never from a server component or a route.
//
// This is the shared engine behind BOTH uploaders:
//   • the sale's own Upload Photos tab (auctions/[id]/photo-upload-tab.tsx), which knows its
//     lots up front, and
//   • Photography → Upload Photos (photography/upload), which knows no sale at all and asks
//     the server which sale each code belongs to.
// It lived privately inside the first of those until the second was built. A second copy
// would drift, and the two screens would then disagree about where a photo belongs — which
// is the one mistake that silently puts a photo on the wrong lot.

// uploadLotPhoto stores every photo at lot-photos/{auctionId}/{lotId}/{Date.now()}-{safeName},
// where safeName is the original filename with anything outside [A-Za-z0-9._-] replaced by "_".
// The original name is therefore recoverable from the stored key, which is what lets the
// "skip photos already on the lot" tickbox work with no schema change and no extra lookups.
// Compare on the basename only — an endsWith() test on the whole key would match
// "IMG_1.jpg" against a stored "X-IMG_1.jpg".
export const safeName    = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_")
export const nameFromKey = (key: string)  => (key.split("/").pop() ?? "").replace(/^\d+-/, "")

export const DEDUPE_LS_KEY = "photo_upload_skip_duplicates"
export const MODEL_LS_KEY  = "smart_scan_model"

// Photos per AI request, and how many requests run at once. A big sale is
// 1000+ photos, so these drive how long the AI review takes.
export const BATCH_SIZE     = 8
export const AI_CONCURRENCY = 3

export interface LotGroup {
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
export interface PhotoInfo {
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

export type DiscrepancyType = "mismatch" | "scanner-not-ai" | "ai-not-scanner"
export interface Discrepancy {
  index:       number
  type:        DiscrepancyType
  scannerCode: string | null
  aiCode:      string | null
  resolved:    boolean
}

// Per-lot outcome, shown live while uploading and on the results screen.
export interface UploadResult {
  label:    string
  uploaded: number
  failed:   number
  already:  number   // skipped — this filename is already on the lot
  errors:   string[]
}

// Reconcile one photo's scanner + AI reads into a starting decision, and say
// whether it is a discrepancy a human should look at. The SCANNER wins a code
// disagreement by default (Code 128 has a checksum; AI misreads printed text
// more often), but every genuine disagreement is surfaced for review.
export function resolvePhoto(
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
//
// ⚠ lotMap is code → lotId, lower-cased. The sale's tab builds it from that sale's lots;
// the global uploader builds it from the server's answer for the codes actually found. A
// code with no entry gives lotId null — an unmatched group, never a wrong one.
export function buildGroups(
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

// ── Filename barcode / unique-ID parser ───────────────────────────────────────
// Strips the extension then removes any trailing _N suffix so that:
//   "F066001.jpg"      → "F066001"
//   "F066001_2.jpg"    → "F066001"
//   "R000016-413_1.jpg"→ "R000016-413"
export function parseBarcode(filename: string): string {
  const noExt = filename.replace(/\.[^.]+$/, "")  // strip extension
  return noExt.replace(/_\d+$/, "")               // strip trailing _N suffix
}

// Order-preserving concurrency pool: results land at their item's index no
// matter which worker finishes first, so the sequential grouping stays correct.
export async function mapPool<T, R>(
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

export function loadImgElement(file: File): Promise<HTMLImageElement> {
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
export async function toJpegBlob(file: File, maxW = 1000): Promise<Blob | null> {
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

// ── Barcode reader: zxing-cpp (WASM) ──────────────────────────────────────────
// Far stronger than the pure-JS @zxing/library at photographed / skewed / soft
// labels (it does its own robust localisation, rotation and downscaling on the
// whole file). Its 1.1MB module is self-hosted from /public (not a CDN),
// configured once and loaded lazily on first use.
let zxWasmConfigured = false
// Reads are SERIALISED (one at a time) via a promise chain — the WASM module has
// one shared linear memory, so letting the concurrent scan workers call it at
// once could race and hand back a WRONG code (the worst possible bug here).
let zxChain: Promise<unknown> = Promise.resolve()
function serialiseZx<T>(fn: () => Promise<T>): Promise<T> {
  const next = zxChain.then(fn, fn)
  zxChain = next.then(() => {}, () => {})
  return next
}
// If the engine ever stalls (wasm fetch/instantiate wedged), a serialised queue
// would wait on it FOREVER and the whole unattended scan would hang. So a read
// gets a hard time limit, and a stall switches the reader OFF for the rest of
// the run — every remaining photo then just has no scanner code and AI reads
// them. Never let one stuck read hold up a 2000-photo folder.
const ZX_READ_TIMEOUT_MS = 30_000   // a normal read is well under a second
let zxReaderStalled = false
export function resetZxReader() { zxReaderStalled = false }
export function isZxReaderStalled() { return zxReaderStalled }

export function isVectisCodeStr(s: string): boolean {
  const t = s.replace(/[^\x20-\x7E]/g, "").trim()
  return /^[A-Za-z]\d{6,7}$/.test(t) || /^[A-Za-z]\d{4,7}-\d{1,6}$/.test(t)
}

export async function readVectisWithZxingCpp(file: File): Promise<string | null> {
  if (zxReaderStalled) return null
  const mod = await import("zxing-wasm/reader")
  if (!zxWasmConfigured) {
    mod.prepareZXingModule({
      overrides: { locateFile: (p: string, prefix: string) => (p.endsWith(".wasm") ? "/zxing_reader.wasm" : prefix + p) },
      fireImmediately: false,
    })
    zxWasmConfigured = true
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const results = await serialiseZx(() => Promise.race([
    mod.readBarcodes(file, { tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true }),
    new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("zx-timeout")), ZX_READ_TIMEOUT_MS) }),
  ]).finally(() => clearTimeout(timer))).catch((e: any) => {
    // A timeout means the engine is wedged — don't queue every other photo
    // behind it, and don't start a second read that could race the stuck one.
    if (e?.message === "zx-timeout") zxReaderStalled = true
    return [] as any[]
  })
  for (const r of results as any[]) {
    const t = (r?.text ?? "").replace(/[^\x20-\x7E]/g, "").trim().toUpperCase()
    if (isVectisCodeStr(t)) return t
  }
  return null
}
