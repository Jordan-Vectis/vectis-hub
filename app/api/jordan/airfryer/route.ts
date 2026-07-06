import { NextRequest, NextResponse } from "next/server"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getToolModel } from "@/lib/ai-models"
import { isJordan } from "@/lib/jordan-auth"
import { withGeminiRetry, isTransientGeminiError } from "@/lib/gemini-retry"

export const maxDuration = 60

// POST /api/jordan/airfryer — photo of food in, air-fryer settings out.
// FormData: image (one file), plus optional appliance profile:
//   applianceNotes (string), applianceModes (JSON array of mode names).
// When modes are given, the AI must recommend ONE of them by name.
// Locked to jordan.orange (404 otherwise).

function buildPrompt(applianceNotes: string, modes: string[]): string {
  const hasModes = modes.length > 0
  const applianceBlock = (applianceNotes || hasModes)
    ? `\nTHE USER'S SPECIFIC AIR FRYER:${applianceNotes ? `\n- Model / notes: ${applianceNotes}` : ""}${
        hasModes ? `\n- Available cooking modes (recommend EXACTLY ONE of these by its exact name): ${modes.join(", ")}` : ""}\nTailor the temperature, time and (if modes are listed) the mode to THIS appliance. A more powerful fryer or a "max crisp"-type mode may need a slightly lower temp or shorter time.\n`
    : ""
  return `You are an air-fryer expert. Look at the photo and work out what the food is, then give the best settings.
${applianceBlock}
Pay attention to the food's STATE — frozen vs chilled vs raw vs already-cooked-being-reheated changes everything. If the packaging is visible, read it. If several foods are visible, pick the main one and mention the others in notes.

Return STRICT JSON only (no prose, no markdown):
{
  "food": string,        // what it is, short (e.g. "Frozen breaded chicken goujons")
  "state": string,       // "frozen" | "chilled" | "raw" | "reheating" | "unsure"
  "mode": string,        // ${hasModes ? "the EXACT name of the best mode from the user's list above" : 'the cooking mode to use (e.g. "Air Fry"), or "" if not applicable'}
  "tempC": number,       // air fryer temperature in °C
  "time": string,        // minutes, as a range where sensible (e.g. "12–15")
  "preheat": boolean,    // worth preheating for this food?
  "shake": string,       // when to shake/flip (e.g. "Shake halfway") or "" if not needed
  "safety": string,      // internal-temp/food-safety note if it matters (chicken/pork/rice), else ""
  "notes": string,       // one or two practical tips (spacing, oil spray, crispiness), else ""
  "confident": boolean   // false if you can't really tell what the food is
}

If you truly cannot identify any food in the photo, set food to what you CAN see, confident to false, and give your best generic guidance in notes.`
}

export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const form = await req.formData()
    const file = form.get("image")
    if (!(file instanceof File)) return NextResponse.json({ error: "No photo received" }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const imagePart = {
      inlineData: { data: buffer.toString("base64"), mimeType: file.type || "image/jpeg" },
    }

    // Optional appliance profile (from the "My air fryer" panel).
    const applianceNotes = ((form.get("applianceNotes") as string) ?? "").trim().slice(0, 300)
    let applianceModes: string[] = []
    try {
      const rawModes = JSON.parse((form.get("applianceModes") as string) ?? "[]")
      if (Array.isArray(rawModes)) applianceModes = rawModes.filter((m) => typeof m === "string" && m.trim()).map((m) => m.trim().slice(0, 40)).slice(0, 24)
    } catch { /* ignore malformed modes */ }

    const modelId = await getToolModel("jordan_fun", form.get("model") as string | null)
    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({
      model: modelId,
      generationConfig: { responseMimeType: "application/json" },
    })

    // 503/overloaded is transient — retry quietly before surfacing anything.
    const result = await withGeminiRetry(() => model.generateContent([imagePart, { text: buildPrompt(applianceNotes, applianceModes) }]))
    const response = result.response

    const promptBlock = response.promptFeedback?.blockReason
    if (promptBlock) {
      return NextResponse.json({ error: `Blocked by Gemini: ${promptBlock}` }, { status: 422 })
    }
    const finishReason = response.candidates?.[0]?.finishReason
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      return NextResponse.json({ error: `Blocked by Gemini (${finishReason})` }, { status: 422 })
    }

    const raw = response.text().trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim()
    const parsed = JSON.parse(raw)
    return NextResponse.json({
      food:      typeof parsed?.food === "string" ? parsed.food : "Unknown",
      state:     typeof parsed?.state === "string" ? parsed.state : "unsure",
      mode:      typeof parsed?.mode === "string" ? parsed.mode : "",
      tempC:     Number.isFinite(Number(parsed?.tempC)) ? Number(parsed.tempC) : 180,
      time:      typeof parsed?.time === "string" ? parsed.time : String(parsed?.time ?? "?"),
      preheat:   parsed?.preheat === true,
      shake:     typeof parsed?.shake === "string" ? parsed.shake : "",
      safety:    typeof parsed?.safety === "string" ? parsed.safety : "",
      notes:     typeof parsed?.notes === "string" ? parsed.notes : "",
      confident: parsed?.confident !== false,
    })
  } catch (e: any) {
    console.error("jordan/airfryer error:", e)
    if (isTransientGeminiError(e)) {
      return NextResponse.json({ error: "That model is overloaded right now — try again in a minute, or switch model." }, { status: 503 })
    }
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
