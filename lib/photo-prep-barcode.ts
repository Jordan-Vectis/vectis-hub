// Barcode-anchored cropping for Photo Prep.
//
// WHY THIS EXISTS. The normal crop asks "what differs from the backdrop?".
// On a lot photo that is the product. On a barcode-tag photo it is whatever
// happens to have colour — a real batch produced a crop containing nothing but
// a stray orange fragment at the frame edge, because a white tag on a white
// wall has no contrast at all and the fragment did. The tag, and the barcode
// on it, were thrown away entirely.
//
// So tag photos are anchored to the ONE thing that is identical in every shot:
// the printed barcode. Position, background and angle all vary; the sticker
// does not. A decoder finds it wherever it is and on whatever background,
// because scanning black bars on white regardless of surroundings is the entire
// job of a barcode.
//
// This is a local WebAssembly decoder, NOT a model — deterministic, offline,
// and ~10-30ms per photo against the ~150ms a photo already costs.

import type { PhotoPrepSettings } from "@/lib/photo-prep"

export type Corner = { x: number; y: number }

export type BarcodeHit = {
  /** The decoded value, e.g. "F098516". */
  text:        string
  /** Bounding box of the BARS ONLY, normalised 0–1. Not the card. */
  bars:        { x0: number; y0: number; x1: number; y1: number }
  /** Tag tilt in degrees. 180 means the tag was photographed upside down. */
  orientation: number
}

/**
 * Longest edge the image is downscaled to before decoding. Barcodes read fine
 * well below full resolution and this is the single biggest lever on speed —
 * decoding a 24MP frame directly is many times slower for no better result.
 */
const DECODE_MAX_EDGE = 1400

/**
 * Card size relative to the BARS, measured off real Vectis tags
 * (F098533: 1.6x / 7x, F098516: 1.5x / 6x). They are a standard printed tag,
 * so this holds — but it is the one ESTIMATED step in the chain, which is why
 * every crop is verified by re-reading afterwards rather than trusted.
 *
 * Vertically asymmetric on purpose: the bars sit high on the sticker with the
 * number printed underneath, so more room is needed below than above.
 */
const CARD = {
  sideways: 0.30,  // extra width each side, as a fraction of bar width
  above:    2.4,   // extra height above, as a multiple of bar height
  below:    3.6,   // extra height below — the printed number lives here
}

let modulePrepared = false

/**
 * Points the decoder at our own copy of the WASM.
 *
 * ⚠ zxing-wasm defaults to fetching from the jsDelivr CDN
 * (`https://fastly.jsdelivr.net/npm/zxing-wasm@…`). That would fail under the
 * app's CSP and add network latency to a run that is supposed to be entirely
 * local, so it is overridden to a file served from /public. The matcher in
 * proxy.ts excludes `.wasm` so this is not bounced to /login.
 */
async function prepare() {
  if (modulePrepared) return
  const { prepareZXingModule } = await import("zxing-wasm/reader")
  prepareZXingModule({
    overrides: { locateFile: (path: string) => (path.endsWith(".wasm") ? "/zxing_reader.wasm" : path) },
    fireImmediately: true,
  })
  modulePrepared = true
}

/**
 * Find the barcode in a photo, if there is one.
 *
 * Returning null is also the classifier: no barcode means it is a lot photo and
 * the existing crop (which works well) handles it untouched.
 */
export async function findBarcode(bitmap: ImageBitmap): Promise<BarcodeHit | null> {
  try {
    await prepare()
    const { readBarcodes } = await import("zxing-wasm/reader")

    // Downscale for the decode only. Coordinates come back in THIS space, so
    // they are normalised below before being applied to the full-size image.
    const scale = Math.min(1, DECODE_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!
    ctx.drawImage(bitmap, 0, 0, w, h)
    const imageData = ctx.getImageData(0, 0, w, h)

    const results = await readBarcodes(imageData, {
      // Tags are photographed at any angle, so rotation has to be tried.
      tryRotate:   true,
      tryInvert:   false,   // always dark-on-light; skipping halves the work
      tryHarder:   true,    // worth it — a missed barcode falls back to the bad crop
      tryDownscale: true,
      maxNumberOfSymbols: 1,
      // Restricting formats is a large speed win over scanning for everything.
      formats: ["Code128", "Code39", "ITF", "EAN-13", "DataBar"],
    } as any)

    const hit = (results ?? []).find((r: any) => r?.isValid !== false && r?.text)
    if (!hit) return null

    const p: any = hit.position ?? {}
    const pts: Corner[] = [p.topLeft, p.topRight, p.bottomRight, p.bottomLeft].filter(Boolean)
    if (pts.length < 2) return null

    const xs = pts.map(q => q.x), ys = pts.map(q => q.y)
    return {
      text: String(hit.text),
      bars: {
        x0: Math.min(...xs) / w, y0: Math.min(...ys) / h,
        x1: Math.max(...xs) / w, y1: Math.max(...ys) / h,
      },
      orientation: Number(hit.orientation ?? 0) || 0,
    }
  } catch {
    // A decoder failure must never cost the photo — fall through to the normal crop.
    return null
  }
}

/**
 * Expand the bar box out to the whole card.
 *
 * Applied in the ROTATED frame, so "above" and "below" mean above and below the
 * barcode as printed, not as photographed.
 */
export function cardFromBars(bars: BarcodeHit["bars"], marginPct: number) {
  const bw = bars.x1 - bars.x0
  const bh = bars.y1 - bars.y0
  const m = Math.max(0, marginPct) / 100

  const x0 = bars.x0 - bw * (CARD.sideways + m)
  const x1 = bars.x1 + bw * (CARD.sideways + m)
  const y0 = bars.y0 - bh * (CARD.above + m * 4)
  const y1 = bars.y1 + bh * (CARD.below + m * 4)

  return {
    x0: Math.max(0, Math.min(1, x0)),
    y0: Math.max(0, Math.min(1, y0)),
    x1: Math.max(0, Math.min(1, x1)),
    y1: Math.max(0, Math.min(1, y1)),
  }
}

/**
 * How far to rotate so the tag sits square, in degrees clockwise.
 *
 * The decoder reports the barcode's own orientation, and a 1D barcode has a
 * defined reading direction (its start and stop patterns differ), so an
 * upside-down tag comes back as 180 rather than 0. That means this handles
 * both a few degrees of tilt and a fully inverted tag.
 *
 * Returns 0 when the tag is already close enough to square to leave alone —
 * re-encoding a straight photo just to rotate it by half a degree is waste.
 */
export function rotationFor(hit: BarcodeHit, minDegrees: number): number {
  let deg = ((hit.orientation % 360) + 360) % 360
  if (deg > 180) deg -= 360          // fold to -180..180, so 350 becomes -10
  return Math.abs(deg) < minDegrees ? 0 : -deg
}

/**
 * Guard against a catastrophic crop.
 *
 * The stray-orange-fragment output kept well under 5% of the frame. Whatever
 * the cause, a crop that small is never right, and keeping the whole photo is
 * always recoverable where a destroyed one is not.
 */
export const MIN_CROP_AREA_FRACTION = 0.05

export function cropIsSane(box: { x0: number; y0: number; x1: number; y1: number }): boolean {
  const area = Math.max(0, box.x1 - box.x0) * Math.max(0, box.y1 - box.y0)
  return area >= MIN_CROP_AREA_FRACTION
}

export type TagSettings = Pick<PhotoPrepSettings, "quality">
