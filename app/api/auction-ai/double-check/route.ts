import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const maxDuration = 60

const SYSTEM_INSTRUCTION = `You are a quality checker for auction house lot descriptions. You will be given a written description and, where available, one or more photos of the lot.

WHAT TO FLAG as contradictions:
- Internal inconsistencies (e.g. description says two conflicting things about the same item)
- Obviously incorrect facts (e.g. a well-known artist attributed to the wrong label, a model number that clearly does not match the described item)
- Statements that contradict each other within the same description
- Where photos are provided: details in the description that visibly contradict what can be seen in the photos (e.g. wrong colour, wrong label, wrong format)

WHAT TO FLAG as unsupported:
- Highly specific claims that are easy to get wrong and cannot be verified from the description alone (e.g. a precise catalogue number, a specific pressing year, a claimed "first pressing" with no evidence given)
- Claims that seem invented or hallucinated rather than observed (e.g. describing features not typically visible or not readable in the provided photos)
- Where photos are provided: specific details that cannot be confirmed from the photos — for example a catalogue number that is not clearly readable, a pressing year not visible, condition claims that the photo is too blurry or cropped to confirm

WHAT NOT TO FLAG:
- General descriptive language or style choices
- Reasonable estimates or condition grades
- Facts that are plausible and commonly known (e.g. well-known band names, standard formats)
- Absence of information — only flag what is present and wrong, not what is missing

If issues are found: also produce a corrected version of the description. Make the minimum change necessary — remove or soften only the specific problematic claims. Do NOT rewrite, restructure, or change anything that is not flagged.

If the description is fine, set verdict to "ok", leave contradictions and unsupported empty, and set revised to an empty string.

Respond with ONLY valid JSON — no markdown, no code fences:
{"contradictions":"<description of internal inconsistencies or obvious errors, or empty string>","unsupported":"<comma-separated list of specific unverifiable claims, or empty string>","verdict":"ok or issues","revised":"<corrected description if issues found, otherwise empty string>"}`

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
    const { label, description, images, model } = await req.json() as {
      label:       string
      description: string
      images?:     { data: string; mimeType: string }[]
      model?:      string
    }
    if (!label || !description) return NextResponse.json({ error: "Missing label or description" }, { status: 400 })

    const genAI = new GoogleGenerativeAI(apiKey)
    const ai = genAI.getGenerativeModel({
      model: model ?? "gemini-2.5-flash-preview-04-17",
      systemInstruction: SYSTEM_INSTRUCTION,
    })

    const imageParts = (images ?? []).map(img => ({
      inlineData: { data: img.data, mimeType: img.mimeType },
    }))
    const textPart = { text: `Lot: ${label}\n\nDescription:\n${description}` }
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
