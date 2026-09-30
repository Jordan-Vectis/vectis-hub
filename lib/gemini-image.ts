// Gemini's image model ("nano banana") — the bits every image-out route shares.
// Used by Photo Prep → 🎨 AI edit (app/api/photo-prep/edit) and → 💬 Image chat
// (app/api/photo-prep/create). Moved here from the edit route on 2026-09-29 so the
// two can't drift — a route file may only export its handlers.
//
// ⚠ Image output is NOT the generateContent shape the other AI routes use — it's
// the /v1beta/interactions endpoint, which the installed @google/generative-ai
// SDK (0.24.x) doesn't cover. Hence a direct fetch rather than the SDK or
// lib/ai-provider (which is text-out only).
export const IMAGE_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions"

// ⚠ Don't hard-code one path to the image. Google's image APIs have returned it
// as `output_image`, as an `inlineData` content part, and inside an `output`
// array, and the field names vary (data / bytesBase64Encoded, mime_type /
// mimeType). Walking the response for the first plausible base64 image is far
// more robust than guessing which shape today's endpoint uses — and it keeps
// working when they change it again.
export function extractImage(node: unknown, depth = 0): { data: string; mimeType: string } | null {
  if (!node || typeof node !== "object" || depth > 6) return null

  if (!Array.isArray(node)) {
    const o = node as Record<string, any>
    const data = o.data ?? o.bytesBase64Encoded ?? o.imageBytes ?? o.b64_json
    const mime = o.mime_type ?? o.mimeType ?? o.media_type
    // A base64 image is long; a short string here is an id or a label.
    if (typeof data === "string" && data.length > 512 && (!mime || String(mime).startsWith("image/"))) {
      return { data, mimeType: mime ? String(mime) : "image/png" }
    }
  }

  for (const value of Object.values(node as Record<string, unknown>)) {
    const hit = extractImage(value, depth + 1)
    if (hit) return hit
  }
  return null
}

/** Any text the model sent back instead — usually a refusal worth showing. */
export function extractText(node: unknown, depth = 0): string {
  if (!node || typeof node !== "object" || depth > 6) return ""
  if (!Array.isArray(node)) {
    const o = node as Record<string, any>
    if (typeof o.text === "string" && o.text.trim()) return o.text.trim()
  }
  for (const value of Object.values(node as Record<string, unknown>)) {
    const hit = extractText(value, depth + 1)
    if (hit) return hit
  }
  return ""
}
