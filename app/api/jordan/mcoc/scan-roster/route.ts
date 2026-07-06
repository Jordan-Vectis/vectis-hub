import { NextRequest, NextResponse } from "next/server"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getToolModel } from "@/lib/ai-models"
import { isJordan } from "@/lib/jordan-auth"
import { withGeminiRetry, isTransientGeminiError } from "@/lib/gemini-retry"
import { normaliseClass, cleanChampName } from "@/lib/mcoc"

export const maxDuration = 90

// POST /api/jordan/mcoc/scan-roster — read a screenshot of an MCOC roster page
// and return the champions on it. FormData: image, model. Locked to jordan.orange.

const PROMPT = `You are reading a screenshot from Marvel Contest of Champions (MCOC) — a roster / champion grid. List EVERY champion visible.

For each champion return its name and (if you can tell from the portrait border colour or any class icon) its class: Cosmic, Tech, Mutant, Skill, Science or Mystic. Class border colours: Cosmic=blue, Tech=teal/cyan, Mutant=yellow, Skill=red, Science=green, Mystic=purple. If unsure of the class, use "".

Return STRICT JSON only (no prose, no markdown fences):
{
  "champions": [ { "name": string, "class": string } ],
  "confident": boolean
}

Use the champion's common name (e.g. "Hercules", "Kitty Pryde", "Serpent"). Do not invent champions you can't see. If it isn't an MCOC roster, set confident false and champions [].`

export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })

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
    const seen = new Set<string>()
    const champions = (Array.isArray(parsed?.champions) ? parsed.champions : [])
      .map((c: any) => ({ name: cleanChampName(c?.name ?? ""), class: normaliseClass(c?.class ?? "") }))
      .filter((c: { name: string }) => {
        const k = c.name.toLowerCase()
        if (!c.name || seen.has(k)) return false
        seen.add(k); return true
      })
      .slice(0, 120)

    return NextResponse.json({ champions, confident: parsed?.confident !== false && champions.length > 0 })
  } catch (e: any) {
    console.error("jordan/mcoc/scan-roster error:", e)
    if (isTransientGeminiError(e)) {
      return NextResponse.json({ error: "That model is overloaded right now — try again in a minute, or switch model." }, { status: 503 })
    }
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
