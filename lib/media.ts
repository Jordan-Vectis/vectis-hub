// Photos AND videos that customers send in through a Submission's photo request link share one list
// of R2 keys (Item.imageUrls — the name predates videos, 2026-09-14). Nothing else records which is
// which, so the file extension decides, and the upload-url route makes sure every key ends in one.
// Safe to import from client components: no server-only imports here.

const VIDEO_RE = /\.(mp4|m4v|mov|webm|3gp|3g2|avi|mkv|ogv)$/i

/** Is this R2 key (or file name) a video? Judged by its extension. */
export function isVideoKey(key: string): boolean {
  return VIDEO_RE.test(key.split("?")[0])
}

/** Same test on a signed URL — its path ends in the key. */
export function isVideoUrl(url: string): boolean {
  try {
    return VIDEO_RE.test(new URL(url).pathname)
  } catch {
    return isVideoKey(url)
  }
}

/** Content type → the extension a key should end in, for files that arrive without one. */
const EXT_FOR_TYPE: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp",
  "image/heic": "heic", "image/heif": "heif", "image/bmp": "bmp", "image/tiff": "tif",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/x-m4v": "m4v", "video/webm": "webm",
  "video/3gpp": "3gp", "video/3gpp2": "3g2", "video/x-msvideo": "avi", "video/x-matroska": "mkv", "video/ogg": "ogv",
}

/** Extension → content type, for devices that send a video with a blank or made-up type. */
const VIDEO_TYPE_FOR_EXT: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/x-m4v", mov: "video/quicktime", webm: "video/webm",
  "3gp": "video/3gpp", "3g2": "video/3gpp2", avi: "video/x-msvideo", mkv: "video/x-matroska", ogv: "video/ogg",
}

function extOf(name: string): string | null {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name)
  return m ? m[1].toLowerCase() : null
}

/** The type to store a customer's file under: theirs when it is an image or video type, otherwise
 *  worked out from the name. Older phones send blank or non-standard types, and those were always
 *  treated as JPEG photos — which stays the fallback. */
export function mediaContentType(rawType: string | null | undefined, filename: string): string {
  const t = (rawType ?? "").toLowerCase().trim()
  if (t.startsWith("image/") || t.startsWith("video/")) return t
  const ext = extOf(filename)
  return (ext && VIDEO_TYPE_FOR_EXT[ext]) || "image/jpeg"
}

/** An iPhone photo (HEIC/HEIF) — Chrome and Edge on Windows can't show one. */
export function isHeicKey(key: string): boolean {
  return /\.(heic|heif)$/i.test(key.split("?")[0])
}

/** Where a browser can load a HEIC as a JPEG: /api/image/heic converts it once (lib/heic.ts) and
 *  redirects to the kept copy. Needs a signed-in user. */
export function heicViewUrl(key: string): string {
  return `/api/image/heic?key=${encodeURIComponent(key)}`
}

/** A key-safe file name that always ends in an extension, so a video can be recognised later. */
export function mediaFileName(filename: string, contentType: string): string {
  const safe = (filename || "file").replace(/[^a-zA-Z0-9._-]/g, "_")
  const isVideo = contentType.startsWith("video/")
  if (isVideo ? isVideoKey(safe) : !!extOf(safe)) return safe
  return `${safe}.${EXT_FOR_TYPE[contentType] ?? (isVideo ? "mp4" : "jpg")}`
}
