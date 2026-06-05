import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { DOUBLE_CHECK_INSTRUCTION } from "@/lib/double-check-instruction"

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
      model: model ?? "gemini-2.5-flash-preview-04-17",
      systemInstruction: DOUBLE_CHECK_INSTRUCTION,
    })

    const imageParts = (images ?? []).map(img => ({
      inlineData: { data: img.data, mimeType: img.mimeType },
    }))

    // When key points are supplied (pipeline runs Double Check AFTER Key Points),
    // they are cataloguer-verified facts. Tell the model to KEEP them, and to focus
    // on removing any duplication/contradiction the key-point insertion may have caused.
    const kpBlock = keyPoints?.trim()
      ? `\n\nCATALOGUER KEY POINTS — these are verified facts that MUST remain in the description. Never flag or remove them, even if they read like unsupported claims or condition notes. Your job here is to keep every key point present exactly once and remove any DUPLICATION or contradiction where the same fact has been stated more than once:\n${keyPoints.trim()}`
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

    const raw = response.text().trim().replace(/^```json\s*/i, "").replace(/```$/, "")

    let contradictions = ""
    let unsupported    = ""
    let revised        = ""
    let verdict: "ok" | "issues" = "ok"

    try {
      const parsed   = JSON.parse(raw)
      contradictions = parsed.contradictions?.trim() || ""
      unsupported    = parsed.unsupported?.trim()    || ""
      revised        = parsed.revised?.trim()        || ""
      verdict        = contradictions || unsupported ? "issues" : "ok"
    } catch {
      contradictions = raw.slice(0, 200)
      verdict        = "issues"
    }

    return NextResponse.json({ verdict, contradictions, unsupported, revised })
  } catch (e: any) {
    const msg: string = e.message ?? "Unknown error"
    // Prefix rate limit errors so the client can apply the correct backoff
    if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
      return NextResponse.json({ error: `RATE_LIMITED: ${msg}` })
    }
    return NextResponse.json({ error: msg })
  }
}
