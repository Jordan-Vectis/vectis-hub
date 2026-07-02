import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { DOUBLE_CHECK_INSTRUCTION } from "@/lib/double-check-instruction"
import { parseModelJson, extractJsonField } from "@/lib/model-json"
import { getToolModel } from "@/lib/ai-models"

export const maxDuration = 60

// POST /api/auction-ai/double-check
// Checks a single lot — label, description, optional images.
// Returns { verdict, contradictions, unsupported } or { error }.
// Always returns HTTP 200 — inspect the body for errors.
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

  try {
    const { label, description, images, model, keyPoints } = await req.json() as {
      label:       string
      description: string
      images?:     { data: string; mimeType: string }[]
      model?:      string
      keyPoints?:  string
    }
    if (!label || !description) return NextResponse.json({ error: "Missing label or description" }, { status: 400 })

    const genAI = new GoogleGenerativeAI(apiKey)
    const ai = genAI.getGenerativeModel({
      model: await getToolModel("catalogue_doublecheck", model),
      systemInstruction: DOUBLE_CHECK_INSTRUCTION,
    })

    const imageParts = (images ?? []).map(img => ({
      inlineData: { data: img.data, mimeType: img.mimeType },
    }))

    // When key points are supplied (pipeline runs Double Check AFTER Key Points),
    // they are cataloguer-verified facts. Tell the model to KEEP them, and to focus
    // on removing any duplication/contradiction the key-point insertion may have caused.
    const kpBlock = keyPoints?.trim()
      ? `\n\nCATALOGUER KEY POINTS — verified facts recorded by a human. Every one of these MUST remain in the description exactly once. This includes any CONDITION words here (e.g. "Sealed Mint", "Mint", "Sealed") — those are NOT AI guesses, do NOT remove them; your condition-removal rule does NOT apply to anything in this list. Your only job is to remove DUPLICATION or contradiction where the same fact has been stated more than once. If a key point is missing from the description, ADD it back:\n${keyPoints.trim()}`
      : ""

    const textPart = { text: `Lot: ${label}\n\nDescription:\n${description}${kpBlock}` }
    const contents = imageParts.length > 0 ? [...imageParts, textPart] : [textPart]

    // Check for prompt block before calling .text()
    const result = await ai.generateContent(contents)
    const response = result.response

    if (response.promptFeedback?.blockReason) {
      throw new Error(`BLOCKED: ${response.promptFeedback.blockReason}`)
    }
    const finishReason = response.candidates?.[0]?.finishReason
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      throw new Error(`BLOCKED: ${finishReason}`)
    }

    const rawResponse = response.text()
    const raw = rawResponse.trim().replace(/^```json\s*/i, "").replace(/```$/, "")

    let contradictions = ""
    let unsupported    = ""
    let revised        = ""
    let verdict: "ok" | "issues" = "ok"

    const parsed = parseModelJson(raw)
    if (parsed && typeof parsed === "object") {
      contradictions = (parsed.contradictions ?? "").toString().trim()
      unsupported    = (parsed.unsupported ?? "").toString().trim()
      revised        = (parsed.revised ?? "").toString().trim()
      verdict        = contradictions || unsupported ? "issues" : "ok"
    } else {
      // Couldn't parse the JSON (e.g. an invalid \' escape from the model). Salvage the
      // revised description if we can; NEVER dump the raw JSON into the contradictions field.
      revised = extractJsonField(raw, "revised") ?? ""
      verdict = revised ? "issues" : "ok"
    }

    return NextResponse.json({ verdict, contradictions, unsupported, revised,
      debug: { prompt: textPart.text, response: rawResponse, imageCount: imageParts.length } })
  } catch (e: any) {
    const msg: string = e.message ?? "Unknown error"
    // Prefix rate limit errors so the client can apply the correct backoff
    if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
      return NextResponse.json({ error: `RATE_LIMITED: ${msg}` })
    }
    return NextResponse.json({ error: msg })
  }
}
