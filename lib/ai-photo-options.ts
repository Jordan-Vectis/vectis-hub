// Photo options for the AI description routes, and the token readout that proves what a
// run really cost. Added 2026-10-01 for the photo measurement in Instructions Testing.
//
// ⚠ THE FACT THAT SHAPES ALL OF THIS (Google's docs, ai.google.dev/gemini-api/docs/media-resolution):
// on Gemini 3 an image costs a FIXED number of tokens set by "media resolution", whatever its
// pixel size — 1,120 at the default ("high"), 560 at medium, 280 at low, 2,240 at ultra-high.
// So shrinking a 4,000px photo to 2,000px before sending changes the BYTES carried to Google
// (and the time), not the bill. Only the detail setting changes the bill — and lowering it is
// a quality trade-off that has to be measured on real lots, which is what the test tab is for.
// (Gemini 2.5 was different: 258 tokens per 768px tile, so size did matter there.)
//
// Both options are OPTIONAL. Every real run — the Auction AI tab, the overnight runner — sends
// neither, so nothing in production changes until someone decides it should.

import sharp from "sharp"

export type PhotoDetail = "high" | "medium" | "low"

/** Tokens Gemini 3 charges per image at each detail level (docs, 2026-10-01). */
export const GEMINI3_TOKENS_PER_PHOTO: Record<PhotoDetail, number> = { high: 1120, medium: 560, low: 280 }

export function parsePhotoDetail(v: unknown): PhotoDetail | null {
  const s = String(v ?? "").trim().toLowerCase()
  return s === "high" || s === "medium" || s === "low" ? s : null
}

/** The generationConfig fragment for a detail level — nothing at all when unset, so the request is byte-for-byte what it was. */
export function mediaResolutionConfig(detail: PhotoDetail | null): Record<string, string> {
  return detail ? { mediaResolution: `MEDIA_RESOLUTION_${detail.toUpperCase()}` } : {}
}

export const PHOTO_MAX_PX_MIN = 600
export const PHOTO_MAX_PX_MAX = 4096

/** A longest-edge limit in pixels, or null when absent / silly. */
export function parsePhotoMaxPx(v: unknown): number | null {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n >= PHOTO_MAX_PX_MIN && n <= PHOTO_MAX_PX_MAX ? n : null
}

const SHRINKABLE = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"])

/**
 * Shrink a photo so its longest edge is at most maxPx, as a JPEG. Anything sharp can't read
 * here (HEIC on the prebuilt binary, RAW, TIFF — see lib/media-convert.ts) goes through
 * untouched rather than failing the lot: the model reads those itself.
 */
export async function shrinkPhoto(buf: Buffer, mimeType: string, maxPx: number): Promise<{ buffer: Buffer; mimeType: string; shrunk: boolean; width?: number; height?: number }> {
  if (!SHRINKABLE.has((mimeType ?? "").toLowerCase())) return { buffer: buf, mimeType, shrunk: false }
  try {
    const out = await sharp(buf)
      .rotate()                                   // bake the EXIF orientation in — the model sees it the way up the camera did
      .resize({ width: maxPx, height: maxPx, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer({ resolveWithObject: true })
    return { buffer: out.data, mimeType: "image/jpeg", shrunk: true, width: out.info.width, height: out.info.height }
  } catch (e: any) {
    console.error("[ai-photo] could not shrink a photo, sending the original:", e?.message ?? e)
    return { buffer: buf, mimeType, shrunk: false }
  }
}

/** What Google says the call cost, split by what it was spent on. null = Google didn't say. */
export type AiUsage = {
  promptTokens:  number | null
  imageTokens:   number | null
  textTokens:    number | null
  outputTokens:  number | null
  thoughtTokens: number | null
  totalTokens:   number | null
}

export function usageFromResponse(response: any): AiUsage {
  const u = response?.usageMetadata ?? {}
  const byModality = (details: any[] | undefined, modality: string): number | null => {
    if (!Array.isArray(details)) return null
    const row = details.find(d => String(d?.modality ?? "").toUpperCase() === modality)
    return row && typeof row.tokenCount === "number" ? row.tokenCount : null
  }
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)
  return {
    promptTokens:  num(u.promptTokenCount),
    imageTokens:   byModality(u.promptTokensDetails, "IMAGE"),
    textTokens:    byModality(u.promptTokensDetails, "TEXT"),
    outputTokens:  num(u.candidatesTokenCount),
    thoughtTokens: num(u.thoughtsTokenCount),
    totalTokens:   num(u.totalTokenCount),
  }
}
