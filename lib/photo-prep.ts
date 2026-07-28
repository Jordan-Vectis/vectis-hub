// Shared types and helpers for Photo Prep (/tools/photo-prep).
//
// The whole tool runs in the browser — photos are read straight off disk,
// processed in Web Workers, and written back out. Nothing is uploaded and
// nothing touches the server, which is what makes a 1000-photo batch
// practical: no upload wait, no body-size limit, no storage cost.

export type PhotoPrepSettings = {
  /** Percentage taken off EACH edge. 5 = 5% off left, right, top and bottom. */
  trimPct:       number
  /** Lift under-exposed frames. Correctly-exposed ones are left alone. */
  brighten:      boolean
  /** Mean luma (0–255) below which a photo counts as "dark". */
  darkThreshold: number
  /** Mean luma to lift a dark photo up to. */
  targetLuma:    number
  /** JPEG/WebP encode quality, 0–1. Ignored for PNG. */
  quality:       number
}

export const DEFAULT_SETTINGS: PhotoPrepSettings = {
  trimPct:       5,
  brighten:      true,
  darkThreshold: 110,
  targetLuma:    135,
  quality:       0.92,
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
