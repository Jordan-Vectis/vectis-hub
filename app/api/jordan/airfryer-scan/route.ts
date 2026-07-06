import { NextRequest, NextResponse } from "next/server"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getToolModel } from "@/lib/ai-models"
import { isJordan } from "@/lib/jordan-auth"
import { withGeminiRetry, isTransientGeminiError } from "@/lib/gemini-retry"

export const maxDuration = 60

// POST /api/jordan/airfryer-scan — photo of the AIR FRYER (its control panel /
// dial / mode buttons) → the mode names + model printed on it, to fill in the
// "My air fryer" profile. FormData: image. Locked to jordan.orange.

const PROMPT = `You are reading a photo of an AIR FRYER (or its control panel / dial / preset buttons). Extract the exact COOKING MODE / PRESET names printed on it, and the model name if visible.

Return STRICT JSON only (no prose, no markdown):
{
  "model": string,     // brand + model as printed (e.g. "Ninja Foodi Max"), or "" if not visible
  "modes": string[],   // the exact mode/preset names shown (e.g. ["Air Fry","Max Crisp","Roast","Bake","Reheat","Dehydrate"]); [] if none legible
  "confident": boolean // false if it's not clearly an air fryer / you can't read the modes
}

Only include modes you can actually read on the appliance — do not invent typical ones. Keep each mode name exactly as printed (short).`

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

    const promptBlock = response.promptFeedback?.blockReason
    if (promptBlock) return NextResponse.json({ error: `Blocked by Gemini: ${promptBlock}` }, { status: 422 })
    const finishReason = response.candidates?.[0]?.finishReason
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      return NextResponse.json({ error: `Blocked by Gemini (${finishReason})` }, { status: 422 })
    }

    const raw = response.text().trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim()
    const parsed = JSON.parse(raw)
    const modes = Array.isArray(parsed?.modes)
      ? parsed.modes.filter((m: unknown) => typeof m === "string" && m.trim()).map((m: string) => m.trim().slice(0, 40)).slice(0, 24)
      : []
    return NextResponse.json({
      model:     typeof parsed?.model === "string" ? parsed.model.slice(0, 120) : "",
      modes,
      confident: parsed?.confident !== false && modes.length > 0,
    })
  } catch (e: any) {
    console.error("jordan/airfryer-scan error:", e)
    if (isTransientGeminiError(e)) {
      return NextResponse.json({ error: "That model is overloaded right now — try again in a minute, or switch model." }, { status: 503 })
    }
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
