import sharp from "sharp"
import { getObjectBuffer, objectExistsInR2, uploadBufferToR2 } from "@/lib/r2"
import { isHeicKey, isRawKey, isVideoKey, jpegCopyKey, needsJpegCopy } from "@/lib/media"
import { ensureVideoCopy } from "@/lib/video-convert"

// ⚠⚠ Images a browser can't show by itself, which customers send all the time (Jordan, 2026-09-15:
// "our customers are nightmares for sending all sorts of random file types"):
//   • iPhone HEIC/HEIF — Chrome and Edge on Windows can't display them, and the prebuilt sharp can't
//     DECODE them either: it reads a HEIC's size, but its libheif has no HEVC decoder ("Support for this
//     compression format has not been built in (11.6003)", measured on a customer's photo). Any "sharp
//     converts HEIC to JPEG" code in this repo silently keeps the original. heic-decode (libheif
//     compiled to WebAssembly) decodes them instead.
//   • TIFF — scanners. Safari shows them; Chrome and Edge don't. sharp reads them.
//   • Camera RAW (DNG, CR2, NEF, ARW…) — nothing here reads the sensor data, but almost every RAW carries
//     the camera's own JPEG preview, often full size, and that is what gets shown.
// Each gets a JPEG copy (upright, at most 2400px) kept in R2 BESIDE the original — the same key plus
// ".jpg". The original is never changed or deleted.
//
// Measured on a 24-megapixel iPhone photo: ~2.2 s to decode, ~1 s to encode, and the process grows by
// ~250 MB while decoding (WebAssembly memory is never handed back). So conversions run ONE AT A TIME
// on each server, and each image converts once — after that its copy is found and used straight away.
// Videos are lib/video-convert.ts.

const MAX_EDGE = 2400

let queue: Promise<unknown> = Promise.resolve()
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.then(() => undefined, () => undefined)
  return run
}

/** Several requests for the same image share one conversion. */
const inFlight = new Map<string, Promise<string>>()

/** Any image this module understands, as an upright JPEG no bigger than MAX_EDGE. `name` decides how
 *  it's read (by its extension). Throws when the file can't be read. */
export async function imageToJpeg(input: Buffer, name: string): Promise<Buffer> {
  let image: sharp.Sharp
  if (isHeicKey(name) && looksLikeHeif(input)) {
    const { default: decode } = await import("heic-decode")
    const img = await decode({ buffer: input }) // libheif applies the photo's own rotation
    image = sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
      raw: { width: img.width, height: img.height, channels: 4 },
    })
  } else if (isRawKey(name)) {
    image = await rawPreview(input)
  } else {
    image = sharp(input, { page: 0 }).rotate() // TIFF (first page of a multi-page scan) and anything else sharp reads
  }
  return image
    .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer()
}

/** A HEIF container ("ftyp" box with a HEIC brand). A JPEG merely named .heic goes to sharp instead. */
function looksLikeHeif(buf: Buffer): boolean {
  if (buf.length < 12 || buf.toString("latin1", 4, 8) !== "ftyp") return false
  return ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(buf.toString("latin1", 8, 12))
}

/** The camera's own preview inside a RAW file, turned the way the camera recorded it. */
async function rawPreview(raw: Buffer): Promise<sharp.Sharp> {
  const preview = await largestEmbeddedJpeg(raw)
  if (!preview) {
    // No JPEG preview inside — some DNGs keep an ordinary picture as their first TIFF page instead.
    const meta = await sharp(raw, { page: 0 }).metadata().catch(() => null)
    if ((meta?.width ?? 0) >= 300) return sharp(raw, { page: 0 }).rotate()
    throw new Error("No viewable preview inside this camera RAW file")
  }
  const own = await sharp(preview).metadata()
  if ((own.orientation ?? 1) > 1) return sharp(preview).rotate()
  // Most previews carry no orientation of their own; TIFF-based RAWs keep it in their header.
  const outer = await sharp(raw).metadata().catch(() => null)
  const turn = ({ 3: 180, 6: 90, 8: 270 } as Record<number, number>)[outer?.orientation ?? 1]
  return turn ? sharp(preview).rotate(turn) : sharp(preview)
}

const SOI = Buffer.from([0xff, 0xd8, 0xff])

/** The biggest ordinary JPEG inside a camera RAW file — nearly every RAW format carries the camera's
 *  preview, often full size. Exported for testing. */
export async function largestEmbeddedJpeg(raw: Buffer): Promise<Buffer | null> {
  const found: { start: number; end: number }[] = []
  for (let i = raw.indexOf(SOI); i >= 0; ) {
    const end = jpegEnd(raw, i)
    if (end > 0) found.push({ start: i, end })
    i = raw.indexOf(SOI, end > 0 ? end : i + 2)
  }
  found.sort((a, b) => (b.end - b.start) - (a.end - a.start))
  for (const f of found.slice(0, 6)) {
    const jpeg = raw.subarray(f.start, f.end)
    try {
      const meta = await sharp(jpeg).metadata()
      if ((meta.width ?? 0) >= 300) return Buffer.from(jpeg)
    } catch {
      /* not a readable JPEG after all — try the next one */
    }
  }
  return null
}

/** Where the JPEG starting at `start` ends (exclusive), or -1 if it isn't an ordinary baseline or
 *  progressive JPEG. It walks the segment headers, so a thumbnail tucked inside the preview's EXIF
 *  can't be mistaken for the preview's end. */
function jpegEnd(buf: Buffer, start: number): number {
  let p = start + 2
  let frame = false
  while (p + 3 < buf.length) {
    if (buf[p] !== 0xff) return -1
    const marker = buf[p + 1]
    if (marker === 0xff) { p += 1; continue } // fill byte
    if (marker === 0xd9) return p + 2 // end of image
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue }
    const len = buf.readUInt16BE(p + 2)
    if (len < 2 || p + 2 + len > buf.length) return -1
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) frame = true
    // Lossless, hierarchical and arithmetic-coded frames: some RAWs keep the sensor data this way.
    // Not a picture, and sharp can't read it.
    else if (marker >= 0xc3 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return -1
    p += 2 + len
    if (marker === 0xda) {
      if (!frame) return -1
      // The compressed scan: run on to the next real marker (0xFF followed by anything but a stuffed
      // zero, a restart marker or another 0xFF).
      while (p + 1 < buf.length && !(buf[p] === 0xff && buf[p + 1] !== 0x00 && buf[p + 1] !== 0xff && (buf[p + 1] < 0xd0 || buf[p + 1] > 0xd7))) p++
    }
  }
  return -1
}

/** The R2 key of a viewable JPEG copy of this image, making it first if there isn't one yet. */
export function ensureJpegCopy(key: string): Promise<string> {
  const pending = inFlight.get(key)
  if (pending) return pending

  const copyKey = jpegCopyKey(key)
  const job = (async () => {
    if (await objectExistsInR2(copyKey)) return copyKey
    return oneAtATime(async () => {
      if (await objectExistsInR2(copyKey)) return copyKey // finished by another request while this one queued
      const jpeg = await imageToJpeg(await getObjectBuffer(key), key)
      await uploadBufferToR2(jpeg, copyKey, "image/jpeg")
      return copyKey
    })
  })().finally(() => inFlight.delete(key))

  inFlight.set(key, job)
  return job
}

/** For uploads the server stores itself (First Aid, Induction): an image a browser can't show is
 *  stored as a JPEG instead — there's nothing in the original those screens need. Anything else comes
 *  back as it was. */
export async function normaliseImageUpload(buf: Buffer, name: string, type: string): Promise<{ buf: Buffer; name: string; type: string }> {
  const t = (type || "").toLowerCase()
  const readAs = needsJpegCopy(name) ? name
    : t === "image/heic" || t === "image/heif" ? `${name}.heic`
    : t === "image/tiff" ? `${name}.tif`
    : null
  if (!readAs) return { buf, name, type }
  const jpeg = await oneAtATime(() => imageToJpeg(buf, readAs))
  return { buf: jpeg, name: `${name.replace(/\.[^.]*$/, "") || "photo"}.jpg`, type: "image/jpeg" }
}

/** Straight after a customer sends files: make the JPEG copies of images a browser can't show, and
 *  check (and if need be convert) videos — in the background, so staff opening the submission don't
 *  wait. Nothing waits on this; a failure is only logged, and the file is dealt with when someone
 *  first views it instead. */
export function convertInBackground(keys: string[]): void {
  for (const key of keys) {
    if (needsJpegCopy(key)) void ensureJpegCopy(key).catch(err => console.error("[media] image conversion failed:", key, err))
    else if (isVideoKey(key)) void ensureVideoCopy(key).catch(err => console.error("[media] video check failed:", key, err))
  }
}
