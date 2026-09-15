import sharp from "sharp"
import { getObjectBuffer, objectExistsInR2, uploadBufferToR2 } from "@/lib/r2"
import { isHeicKey } from "@/lib/media"

// ⚠⚠ iPhones save photos as HEIC. Chrome and Edge on Windows can't display them — and the prebuilt
// sharp can't DECODE them either: it reads a HEIC's size, but its libheif has no HEVC decoder
// ("Support for this compression format has not been built in (11.6003)", measured 2026-09-15 on a
// customer's photo). Any "sharp converts HEIC to JPEG" code in this repo silently keeps the original.
//
// So a HEIC is decoded with heic-decode (libheif compiled to WebAssembly), shrunk and re-encoded as a
// JPEG by sharp, and the JPEG is kept in R2 BESIDE the original — the same key plus ".jpg". The
// original is never changed or deleted.
//
// Measured on a 24-megapixel iPhone photo: ~2.2 s to decode, ~1 s to encode, and the process grows by
// ~250 MB while decoding (WebAssembly memory is never handed back). So conversions run ONE AT A TIME
// on each server, and each photo converts once — after that its JPEG is found and used straight away.

export { isHeicKey }

export function jpegKeyFor(key: string): string {
  return `${key}.jpg`
}

/** Longest side of the kept JPEG — plenty to value from, about a sixth of the original's pixels. */
const MAX_EDGE = 2400

let queue: Promise<unknown> = Promise.resolve()
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.then(() => undefined, () => undefined)
  return run
}

/** Several requests for the same photo share one conversion. */
const inFlight = new Map<string, Promise<string>>()

/** The R2 key of a viewable JPEG copy of this HEIC, converting it first if there isn't one yet. */
export function ensureJpegCopy(key: string): Promise<string> {
  const pending = inFlight.get(key)
  if (pending) return pending

  const jpgKey = jpegKeyFor(key)
  const job = (async () => {
    if (await objectExistsInR2(jpgKey)) return jpgKey
    return oneAtATime(async () => {
      if (await objectExistsInR2(jpgKey)) return jpgKey // finished by another request while this one queued
      const { default: decode } = await import("heic-decode")
      const img = await decode({ buffer: await getObjectBuffer(key) })
      const jpeg = await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
        raw: { width: img.width, height: img.height, channels: 4 },
      })
        .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer()
      await uploadBufferToR2(jpeg, jpgKey, "image/jpeg")
      return jpgKey
    })
  })().finally(() => inFlight.delete(key))

  inFlight.set(key, job)
  return job
}

/** Convert a customer's HEIC photos in the background, straight after they send them, so staff
 *  opening the submission don't wait. Nothing waits on this; a failure is only logged, and the
 *  photo is simply converted when someone first views it instead. */
export function convertHeicsInBackground(keys: string[]): void {
  for (const key of keys) {
    if (!isHeicKey(key)) continue
    void ensureJpegCopy(key).catch(err => console.error("[heic] background conversion failed:", key, err))
  }
}
