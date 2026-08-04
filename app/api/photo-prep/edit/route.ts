import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import sharp from "sharp"
import { getToolModel } from "@/lib/ai-models"
import { buildEditPrompt } from "@/lib/photo-edit-presets"

export const maxDuration = 120
export const runtime = "nodejs"

// POST /api/photo-prep/edit — edit ONE photo with Gemini's image model
// ("nano banana"). FormData: image, preset, aspect?, extra?
// Returns { image: <base64>, mimeType }.
//
// ⚠ Unlike the rest of Photo Prep, this DOES send the photo to Google. The tab
// says so plainly and it's on the Data & Compliance page. The local crop/
// exposure run is untouched and still never uploads anything.
//
// ⚠ Image editing is NOT the generateContent shape the other AI routes use —
// it's the /v1beta/interactions endpoint (image in, image out), which the
// installed @google/generative-ai SDK (0.24.x) doesn't cover. Hence the direct
// fetch rather than the SDK or lib/ai-provider (which is text-out only).
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions"

// A photo straight off a camera is far bigger than the model needs and makes
// the request slow and costly. 2048px on the long edge is plenty for a
// catalogue image and keeps the round trip sane.
const MAX_EDGE = 2048

// ⚠ Don't hard-code one path to the image. Google's image APIs have returned it
// as `output_image`, as an `inlineData` content part, and inside an `output`
// array, and the field names vary (data / bytesBase64Encoded, mime_type /
// mimeType). Walking the response for the first plausible base64 image is far
// more robust than guessing which shape today's endpoint uses — and it keeps
// working when they change it again.
function extractImage(node: unknown, depth = 0): { data: string; mimeType: string } | null {
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
function extractText(node: unknown, depth = 0): string {
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

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const dbUser = await prisma.user.findUnique({
      where:  { id: session.user.id },
      select: { role: true, allowedApps: true },
    })
    if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "PHOTO_PREP")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const form   = await req.formData()
    const file   = form.get("image")
    const preset = String(form.get("preset") ?? "").trim()
    const aspect = String(form.get("aspect") ?? "").trim()
    const extra  = String(form.get("extra") ?? "").trim()

    if (!(file instanceof File)) return NextResponse.json({ error: "No photo received" }, { status: 400 })

    const prompt = buildEditPrompt(preset, { aspect, extra })
    if (!prompt) return NextResponse.json({ error: `Unknown preset "${preset}"` }, { status: 400 })

    // Normalise first: apply EXIF rotation (or the model edits a sideways photo)
    // and shrink to a sensible size.
    const jpeg = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 92 })
      .toBuffer()

    const model = await getToolModel("photo_prep_edit")

    const res = await fetch(ENDPOINT, {
      method:  "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: [
          { type: "text",  text: prompt },
          { type: "image", mime_type: "image/jpeg", data: jpeg.toString("base64") },
        ],
      }),
    })

    const json = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = json?.error?.message ?? `Image model returned ${res.status}`
      // A quota/rate answer is worth saying plainly — it's the likely one.
      return NextResponse.json({ error: msg }, { status: res.status === 429 ? 429 : 502 })
    }

    const found = extractImage(json)
    if (!found) {
      // ⚠ Don't just say "no image" — say what DID come back, or this is
      // undebuggable from the outside. Image APIs move around: the payload has
      // been output_image, content parts and an output array at various times,
      // and the model can also answer with text (a refusal, or a description)
      // instead of a picture.
      const text  = extractText(json)
      const shape = Object.keys(json ?? {}).join(", ") || "empty response"
      return NextResponse.json({
        error: text
          ? `The model replied with words instead of a picture: "${text.slice(0, 300)}"`
          : `The model didn't return an image. The reply contained: ${shape}.`,
        debug: { keys: Object.keys(json ?? {}), sample: JSON.stringify(json).slice(0, 600) },
      }, { status: 502 })
    }

    return NextResponse.json({ image: found.data, mimeType: found.mimeType })
  } catch (e: any) {
    console.error("photo-prep/edit error:", e)
    return NextResponse.json({ error: e?.message ?? "Edit failed" }, { status: 500 })
  }
}
