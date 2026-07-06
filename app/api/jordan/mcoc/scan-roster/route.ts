import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import sharp from "sharp"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getToolModel } from "@/lib/ai-models"
import { isJordan } from "@/lib/jordan-auth"
import { withGeminiRetry, isTransientGeminiError } from "@/lib/gemini-retry"
import { normaliseClass, cleanChampName } from "@/lib/mcoc"
import { uploadBufferToR2, getSignedImageUrl } from "@/lib/r2"

export const maxDuration = 120

// POST /api/jordan/mcoc/scan-roster — read a screenshot of an MCOC roster page.
// Returns each champion with its class, rank, and a PORTRAIT cropped from the
// screenshot (stored in R2). Used for both adding and updating the roster.
// FormData: image, model. Locked to jordan.orange.

const PROMPT = `You are reading a screenshot from Marvel Contest of Champions (MCOC) — a roster / champion grid. List EVERY champion portrait visible, in reading order.

For each champion give:
- name: its common name (e.g. "Hercules", "Kitty Pryde", "Serpent").
- class: Cosmic, Tech, Mutant, Skill, Science or Mystic if you can tell from the portrait border colour (Cosmic=blue, Tech=teal, Mutant=yellow, Skill=red, Science=green, Mystic=purple), else "".
- rank: the rank number shown on the portrait (the small number, usually 1–5), or null if not visible.
- box: the bounding box of JUST that champion's square portrait image, as [ymin, xmin, ymax, xmax] normalised to 0–1000 (integers). Be tight to the portrait art.

Return STRICT JSON only (no prose, no markdown fences):
{ "champions": [ { "name": string, "class": string, "rank": number|null, "box": [number,number,number,number] } ], "confident": boolean }

Do not invent champions you can't see. If it isn't an MCOC roster, set confident false and champions [].`

function clampRank(n: unknown): number | null {
  const r = Number(n)
  return Number.isFinite(r) && r >= 1 && r <= 5 ? Math.round(r) : null
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || !(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const form = await req.formData()
    const file = form.get("image")
    if (!(file instanceof File)) return NextResponse.json({ error: "No photo received" }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const imagePart = { inlineData: { data: buffer.toString("base64"), mimeType: file.type || "image/jpeg" } }

    const modelId = await getToolModel("jordan_fun", form.get("model") as string | null)
    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({ model: modelId, generationConfig: { responseMimeType: "application/json" } })

    const result = await withGeminiRetry(() => model.generateContent([imagePart, { text: PROMPT }]))
    const response = result.response
    const block = response.promptFeedback?.blockReason
    if (block) return NextResponse.json({ error: `Blocked by Gemini: ${block}` }, { status: 422 })
    const finish = response.candidates?.[0]?.finishReason
    if (finish && finish !== "STOP" && finish !== "MAX_TOKENS") {
      return NextResponse.json({ error: `Blocked by Gemini (${finish})` }, { status: 422 })
    }

    const raw = response.text().trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim()
    const parsed = JSON.parse(raw)
    const rows: any[] = Array.isArray(parsed?.champions) ? parsed.champions : []

    // Prepare the source image once for cropping. If sharp can't read it (e.g.
    // an odd format), we just return champions without portraits.
    let meta: { width?: number; height?: number } = {}
    let cropable = true
    try { meta = await sharp(buffer).metadata() } catch { cropable = false }
    const W = meta.width ?? 0, H = meta.height ?? 0

    const seen = new Set<string>()
    const champions: { name: string; class: string; rank: number | null; imageKey?: string; imageUrl?: string }[] = []

    for (const r of rows) {
      const name = cleanChampName(r?.name ?? "")
      if (!name) continue
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)

      const champ: { name: string; class: string; rank: number | null; imageKey?: string; imageUrl?: string } = {
        name, class: normaliseClass(r?.class ?? ""), rank: clampRank(r?.rank),
      }

      // Crop the portrait if we have a valid box and a readable image.
      const box = Array.isArray(r?.box) ? r.box.map((n: any) => Number(n)) : null
      if (cropable && W > 0 && H > 0 && box && box.length === 4 && box.every((n: number) => Number.isFinite(n))) {
        const [ymin, xmin, ymax, xmax] = box
        const left = Math.max(0, Math.floor((Math.min(xmin, xmax) / 1000) * W))
        const top = Math.max(0, Math.floor((Math.min(ymin, ymax) / 1000) * H))
        const width = Math.min(W - left, Math.ceil((Math.abs(xmax - xmin) / 1000) * W))
        const height = Math.min(H - top, Math.ceil((Math.abs(ymax - ymin) / 1000) * H))
        if (width > 8 && height > 8) {
          try {
            const png = await sharp(buffer).extract({ left, top, width, height }).resize(128, 128, { fit: "cover" }).png().toBuffer()
            const imgKey = `mcoc/${session.user.id}/${key.replace(/[^a-z0-9]+/g, "-")}-${Date.now()}.png`
            await uploadBufferToR2(png, imgKey, "image/png")
            champ.imageKey = imgKey
            champ.imageUrl = await getSignedImageUrl(imgKey)
          } catch { /* crop/upload failed — no portrait for this one */ }
        }
      }
      champions.push(champ)
    }

    return NextResponse.json({ champions, confident: parsed?.confident !== false && champions.length > 0 })
  } catch (e: any) {
    console.error("jordan/mcoc/scan-roster error:", e)
    if (isTransientGeminiError(e)) {
      return NextResponse.json({ error: "That model is overloaded right now — try again in a minute, or switch model." }, { status: 503 })
    }
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
