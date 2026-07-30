// Shared types and helpers for Photo Prep (/tools/photo-prep).
//
// The whole tool runs in the browser — photos are read straight off disk,
// processed in Web Workers, and written back out. Nothing is uploaded and
// nothing touches the server, which is what makes a 1000-photo batch
// practical: no upload wait, no body-size limit, no storage cost.

export type CropMode =
  /** Local backdrop detection only. Fast, free, offline. */
  | "auto"
  /** Local detection, then Gemini re-crops only what it wasn't sure about. */
  | "assist"
  /** Every photo goes to Gemini. Slow and uses quota, but handles anything. */
  | "ai"

/** Where rotation is applied. Only tag photos have a provably correct answer. */
export type RotateMode = "off" | "tags"

export type PhotoPrepSettings = {
  cropMode:          CropMode
  /**
   * Find the barcode first and, when there is one, crop to the tag instead of
   * to "whatever differs from the backdrop". Off = every photo takes the
   * original path.
   */
  barcodeAware:      boolean
  /** Margin around the tag, as a share of the tag's size. Separate from lot photos. */
  tagMarginPct:      number
  rotateMode:        RotateMode
  /** Don't re-encode a photo to straighten it by less than this. */
  minRotateDeg:      number
  /**
   * Breathing space left around the detected product, as a share of the
   * product's own size. 5 = a margin one-twentieth of the item's width/height,
   * so a small item and a large one both get proportionate space.
   */
  marginPct:         number
  /**
   * How eagerly a pixel counts as product rather than backdrop (0–100).
   * Higher = tighter crop. Lower = more forgiving on low-contrast items.
   */
  sensitivity:       number
  /** Lift under-exposed shots. Correctly-exposed ones are left alone. */
  brighten:          boolean
  /**
   * Backdrop luma (0–255) below which the shot counts as underexposed.
   * Exposure is judged on the SWEEP, not the product — a navy box is
   * legitimately dark and must not be lifted, but a grey sweep means the
   * whole frame is under.
   */
  backdropThreshold: number
  /** Backdrop luma to lift an underexposed shot up to — i.e. the white point. */
  targetBackdrop:    number
  /** JPEG/WebP encode quality, 0–1. Ignored for PNG. */
  quality:           number
}

export const DEFAULT_SETTINGS: PhotoPrepSettings = {
  cropMode:          "auto",
  // OFF by default, deliberately. Turning this on by default put the barcode
  // path in front of every photo and it mis-classified boxed lots as tags,
  // ruining them. The lot-photo crop is the part that already works and must
  // stay the untouched default; tag handling is opted into for a tag batch.
  barcodeAware:      false,
  tagMarginPct:      8,
  rotateMode:        "tags",
  minRotateDeg:      2,
  marginPct:         5,
  // 85, set from measurement rather than taste. On mock auction shots a pale
  // inner tray sitting only ~27 units off a white sweep was clipped at 40, 55
  // and 70, and first came back in at 85 — with detected coverage rising 23%
  // -> 33% and scattered dust specks still correctly ignored. Erring
  // tight-but-inclusive is the safer failure: a slightly loose crop is a
  // nuisance, a clipped product is a reshoot.
  sensitivity:       85,
  brighten:          true,
  backdropThreshold: 225,
  targetBackdrop:    245,
  quality:           0.92,
}

/**
 * Below this, local detection isn't trusted and the photo is a candidate for
 * a second look from Gemini.
 */
export const AI_FALLBACK_CONFIDENCE = 0.5

/**
 * How many Gemini crop calls to have in flight at once.
 *
 * Kept low deliberately. The API is the bottleneck in AI mode — the local
 * worker step is milliseconds by comparison — and this codebase has a long
 * history of 429s when firing concurrent Gemini requests (see the Model Tester
 * and Batch Run rules). Four is enough to hide latency without tripping limits.
 */
export const AI_CONCURRENCY = 4

/** Attempts per photo before giving up and falling back to local detection. */
export const AI_MAX_ATTEMPTS = 3

/**
 * Ask Gemini for the product's bounding box in one photo.
 *
 * Returns null when the AI can't find a product or keeps failing — callers
 * fall back to local detection rather than dropping the photo, so a rate limit
 * degrades quality instead of losing work.
 */
export async function fetchAiBox(file: File, name: string): Promise<any | null> {
  for (let attempt = 1; attempt <= AI_MAX_ATTEMPTS; attempt++) {
    try {
      const fd = new FormData()
      fd.append("image", file, name)
      const res = await fetch("/api/photo-prep/crop-box", { method: "POST", body: fd })

      if (res.status === 429 || res.status === 503) {
        // Backs off 4s, 8s — short, because a 1000-photo run can't afford the
        // 30-minute waits the batch descriptions route uses.
        await new Promise(r => setTimeout(r, 4000 * attempt))
        continue
      }
      const json = await res.json()
      if (!res.ok) return null
      return json.box ?? null
    } catch {
      await new Promise(r => setTimeout(r, 1500 * attempt))
    }
  }
  return null
}

export const ACCEPTED_EXT = /\.(jpe?g|png|webp)$/i

// Re-encode in the same format as the input so the output filename — including
// its extension — matches the original exactly. The photo-upload flow parses
// the lot barcode out of the filename, so this must not drift.
export function mimeForName(name: string): string {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  if (ext === "png")  return "image/png"
  if (ext === "webp") return "image/webp"
  return "image/jpeg"
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

// Chromium exposes showDirectoryPicker, which lets us read a folder and write
// results straight back into another folder — the "download into a folder with
// the same filenames" behaviour, with no zip and flat memory use.
// Everything else falls back to a file picker + zip download.
export function hasFileSystemAccess(): boolean {
  return typeof window !== "undefined" && typeof (window as any).showDirectoryPicker === "function"
}

// How many workers to run at once. Leave a couple of cores for the browser
// itself so the page keeps painting while a big batch runs.
export function workerCount(): number {
  const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4
  return Math.max(2, Math.min(8, cores - 2))
}

/** A single image is given this long before it is written off as stuck. */
const TASK_TIMEOUT_MS = 120_000

/**
 * Wraps a Worker so every request gets a reply — or a failure — and never
 * simply hangs.
 *
 * Three things this exists to prevent, all of which stall a 1000-photo run:
 *  - Two requests in flight on one worker. With one-shot listeners the FIRST
 *    reply is handed to BOTH waiting promises, so the newer request silently
 *    receives the older result. Every reply carries its request id instead.
 *  - The worker script 404ing after a deploy, or the browser killing it under
 *    memory pressure. postMessage still succeeds but no reply ever comes, so
 *    without an error handler the batch waits forever.
 *  - A single pathological image wedging its worker. A timeout releases it.
 */
export function makeWorkerClient(url: string) {
  const worker = new Worker(url)
  const pending = new Map<number, (v: any) => void>()
  let seq = 0

  const settle = (rid: number, value: any) => {
    const resolve = pending.get(rid)
    if (!resolve) return
    pending.delete(rid)
    resolve(value)
  }
  const failAll = (error: string) => {
    for (const rid of [...pending.keys()]) settle(rid, { ok: false, error })
  }

  worker.onmessage      = (e: MessageEvent) => settle(e.data?.rid, e.data)
  worker.onerror        = (e: any) => failAll(e?.message || "Image worker crashed")
  worker.onmessageerror = () => failAll("Image worker sent an unreadable reply")

  return {
    worker,
    run(payload: any, transfer: Transferable[] = []): Promise<any> {
      const rid = ++seq
      return new Promise<any>((resolve) => {
        const timer = setTimeout(
          () => settle(rid, { ok: false, error: "Timed out — image too large or malformed" }),
          TASK_TIMEOUT_MS,
        )
        pending.set(rid, (v) => { clearTimeout(timer); resolve(v) })
        try {
          worker.postMessage({ ...payload, rid }, transfer)
        } catch (err: any) {
          settle(rid, { ok: false, error: err?.message ?? "Could not send image to worker" })
        }
      })
    },
    terminate() {
      failAll("Cancelled")
      worker.terminate()
    },
  }
}

export type WorkerClient = ReturnType<typeof makeWorkerClient>

/**
 * True when two directory handles point at the same folder.
 *
 * ⚠ Writing results into the SOURCE folder destroys the originals —
 * createWritable() truncates the file it opens, so the untouched photo is gone
 * with no undo. The tool's own "same filenames, saved to a folder" behaviour
 * makes picking the same folder the natural mistake, so it has to be blocked.
 */
export async function isSameFolder(a: any, b: any): Promise<boolean> {
  if (!a || !b) return false
  try { return await a.isSameEntry(b) } catch { return false }
}
