import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import sharp from "sharp"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getToolModel } from "@/lib/ai-models"
import { withGeminiRetry, friendlyGeminiError } from "@/lib/gemini-retry"

export const maxDuration = 60
export const runtime = "nodejs"

// POST /api/photo-prep/crop-box — ask Gemini where the product is in one photo.
//
// This is the FALLBACK only. Photo Prep crops locally in the browser using
// backdrop detection, which is faster, free and pixel-exact on a plain sweep.
// Photos the local pass isn't confident about (busy bench, props in shot, a
// low-contrast item) are sent here one at a time, on demand — never the whole
// batch, which would be hours of rate-limited calls for no benefit.
//
// FormData: image
// Returns:  { box: { x0, y0, x1, y1 } } normalised 0–1, or { box: null }.

const PROMPT = `This is a photograph taken for an auction catalogue. Identify the ITEM being sold.

Return STRICT JSON only:
{"box":[ymin,xmin,ymax,xmax],"found":true}

Rules:
- Coordinates are integers 0-1000, normalised to the image size.
- The box must tightly enclose the product being sold, INCLUDING its box or packaging if the item is boxed — a boxed model is sold as the boxed item.
- If several items are clearly part of the same lot, return ONE box enclosing all of them.
- EXCLUDE: the backdrop, the bench or table surface, hands, tools, price tags, auction labels and any stray objects that are not part of the lot.
- If you cannot identify a product, return {"found":false}.
Return nothing except the JSON.`

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

    const form = await req.formData()
    const file = form.get("image")
    if (!(file instanceof File)) return NextResponse.json({ error: "No photo received" }, { status: 400 })

    // Normalise before sending: EXIF rotation applied, and shrunk so a 24MP
    // original can't trip the request size limit. The box comes back normalised
    // 0–1000, so it maps onto the full-size original regardless of this resize.
    const original = Buffer.from(await file.arrayBuffer())
    let buffer = original
    let mime = file.type || "image/jpeg"
    try {
      buffer = Buffer.from(
        await sharp(original).rotate().resize({ width: 1400, withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer(),
      )
      mime = "image/jpeg"
    } catch { /* unreadable by sharp — send the original bytes */ }

    const modelId = await getToolModel("photo_prep_crop", form.get("model") as string | null)
    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({
      model: modelId,
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 256 },
    })

    const result = await withGeminiRetry(() => model.generateContent([
      { inlineData: { data: buffer.toString("base64"), mimeType: mime } },
      { text: PROMPT },
    ]))

    const response = result.response
    const block = response.promptFeedback?.blockReason
    if (block) return NextResponse.json({ error: `Blocked by Gemini: ${block}` }, { status: 422 })
    const finish = response.candidates?.[0]?.finishReason
    if (finish && finish !== "STOP" && finish !== "MAX_TOKENS") {
      return NextResponse.json({ error: `Blocked by Gemini (${finish})` }, { status: 422 })
    }

    let parsed: any
    try {
      parsed = JSON.parse(response.text().trim())
    } catch {
      return NextResponse.json({ error: "Couldn't read the AI's reply" }, { status: 422 })
    }

    if (parsed?.found === false || !Array.isArray(parsed?.box) || parsed.box.length !== 4) {
      return NextResponse.json({ box: null })
    }

    const [ymin, xmin, ymax, xmax] = parsed.box.map((n: any) => Number(n))
    if (![ymin, xmin, ymax, xmax].every(Number.isFinite)) return NextResponse.json({ box: null })

    // Same 0–1000 convention as the roster scanner. Normalise to 0–1 so the
    // worker can apply it to the full-resolution image directly.
    const clamp = (v: number) => Math.max(0, Math.min(1, v / 1000))
    const box = {
      x0: clamp(Math.min(xmin, xmax)),
      y0: clamp(Math.min(ymin, ymax)),
      x1: clamp(Math.max(xmin, xmax)),
      y1: clamp(Math.max(ymin, ymax)),
    }
    if (box.x1 - box.x0 < 0.02 || box.y1 - box.y0 < 0.02) return NextResponse.json({ box: null })

    return NextResponse.json({ box })
  } catch (e: any) {
    console.error("photo-prep/crop-box error:", e)
    const friendly = friendlyGeminiError(e)
    if (friendly) return NextResponse.json({ error: friendly.error }, { status: friendly.status })
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
