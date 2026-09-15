// Photos, videos and whatever else customers send in through a Submission's photo request link share
// one list of R2 keys (Item.imageUrls — the name predates videos, 2026-09-14). Nothing else records
// which is which, so the file extension decides, and the upload-url route makes sure every key ends in
// one. Safe to import from client components: no server-only imports here.

const VIDEO_RE = /\.(mp4|m4v|mov|webm|3gp|3g2|avi|mkv|ogv|wmv|mpe?g|mts|m2ts)$/i

// Images a browser can't show by itself (2026-09-15) — each gets a JPEG copy kept beside it in R2,
// see lib/media-convert.ts: iPhone HEIC/HEIF, scanner TIFF, and camera RAW.
const HEIC_RE = /\.(heic|heif)$/i
const TIFF_RE = /\.tiff?$/i
const RAW_RE  = /\.(dng|cr2|cr3|crw|nef|nrw|arw|srf|sr2|orf|rw2|raf|pef|srw|3fr|iiq|rwl|erf|kdc|dcr|mrw|x3f|mos)$/i

const bare = (key: string) => key.split("?")[0]

/** Is this R2 key (or file name) a video? Judged by its extension. */
export function isVideoKey(key: string): boolean {
  return VIDEO_RE.test(bare(key))
}

/** Same test on a signed URL — its path ends in the key. */
export function isVideoUrl(url: string): boolean {
  try {
    return VIDEO_RE.test(new URL(url).pathname)
  } catch {
    return isVideoKey(url)
  }
}

export function isHeicKey(key: string): boolean {
  return HEIC_RE.test(bare(key))
}

export function isRawKey(key: string): boolean {
  return RAW_RE.test(bare(key))
}

/** An image a browser can't show by itself — it is shown through its JPEG copy instead. */
export function needsJpegCopy(key: string): boolean {
  const k = bare(key)
  return HEIC_RE.test(k) || TIFF_RE.test(k) || RAW_RE.test(k)
}

/** Where such an image's JPEG copy is kept: beside the original, the same key plus ".jpg". */
export function jpegCopyKey(key: string): string {
  return `${key}.jpg`
}

/** Where a video's browser-playable copy is kept — made only when the original won't play. */
export function videoCopyKey(key: string): string {
  return `${key}.mp4`
}

/** A URL a browser can load such an image from: /api/media/view makes the JPEG copy the first time
 *  (lib/media-convert.ts) and then redirects to it. Needs a signed-in user. */
export function mediaViewUrl(key: string): string {
  return `/api/media/view?key=${encodeURIComponent(key)}`
}

/** Content type → the extension a key should end in, for files that arrive without one. */
const EXT_FOR_TYPE: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/pjpeg": "jpg", "image/png": "png", "image/gif": "gif",
  "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "image/heic-sequence": "heic",
  "image/heif-sequence": "heif", "image/bmp": "bmp", "image/tiff": "tif", "image/avif": "avif",
  "image/x-adobe-dng": "dng",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/x-m4v": "m4v", "video/webm": "webm",
  "video/3gpp": "3gp", "video/3gpp2": "3g2", "video/x-msvideo": "avi", "video/avi": "avi",
  "video/x-matroska": "mkv", "video/ogg": "ogv", "video/x-ms-wmv": "wmv", "video/mpeg": "mpg", "video/mp2t": "mts",
  "application/pdf": "pdf",
}

/** Extension → content type, for devices that send a blank or made-up type. */
const TYPE_FOR_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", jpe: "image/jpeg", jfif: "image/jpeg", png: "image/png",
  gif: "image/gif", webp: "image/webp", heic: "image/heic", heif: "image/heif", tif: "image/tiff",
  tiff: "image/tiff", bmp: "image/bmp", avif: "image/avif",
  dng: "image/x-adobe-dng", cr2: "image/x-canon-cr2", cr3: "image/x-canon-cr3", nef: "image/x-nikon-nef",
  arw: "image/x-sony-arw", orf: "image/x-olympus-orf", rw2: "image/x-panasonic-rw2", raf: "image/x-fuji-raf",
  pef: "image/x-pentax-pef", srw: "image/x-samsung-srw",
  mp4: "video/mp4", m4v: "video/x-m4v", mov: "video/quicktime", webm: "video/webm", "3gp": "video/3gpp",
  "3g2": "video/3gpp2", avi: "video/x-msvideo", mkv: "video/x-matroska", ogv: "video/ogg",
  wmv: "video/x-ms-wmv", mpg: "video/mpeg", mpeg: "video/mpeg", mts: "video/mp2t", m2ts: "video/mp2t",
  pdf: "application/pdf",
}

function extOf(name: string): string | null {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name)
  return m ? m[1].toLowerCase() : null
}

/** The type to store a customer's file under. An image or video type is kept; otherwise it is worked
 *  out from the name. Anything else a customer sends (a PDF, a Word document…) keeps its own type so it
 *  opens as itself — until 2026-09-15 it was stored as a JPEG and wouldn't open at all. A file with no
 *  type AND no extension is what older phones send for a photo, so that stays a JPEG. */
export function mediaContentType(rawType: string | null | undefined, filename: string): string {
  const t = (rawType ?? "").toLowerCase().trim()
  if (t.startsWith("image/") || t.startsWith("video/")) return t
  const ext = extOf(filename)
  if (ext && TYPE_FOR_EXT[ext]) return TYPE_FOR_EXT[ext]
  if (t && t !== "application/octet-stream" && /^[a-z]+\/[a-z0-9.+-]+$/.test(t)) return t
  return ext ? "application/octet-stream" : "image/jpeg"
}

/** A key-safe file name that always ends in an extension, so a video can be recognised later. */
export function mediaFileName(filename: string, contentType: string): string {
  const safe = (filename || "file").replace(/[^a-zA-Z0-9._-]/g, "_")
  const isVideo = contentType.startsWith("video/")
  if (isVideo ? isVideoKey(safe) : !!extOf(safe)) return safe
  return `${safe}.${EXT_FOR_TYPE[contentType] ?? (isVideo ? "mp4" : contentType.startsWith("image/") ? "jpg" : "bin")}`
}
