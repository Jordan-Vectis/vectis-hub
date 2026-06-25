import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { KEY_POINTS_INSTRUCTION } from "@/lib/key-points-instruction"

export const maxDuration = 60

const SYSTEM_INSTRUCTION = KEY_POINTS_INSTRUCTION

// Gemini occasionally returns JSON with an invalid escape — most commonly \' (a
// backslash before a single quote), which is NOT a legal JSON escape and makes
// JSON.parse throw. Repair the common mistakes and retry before giving up.
function parseModelJson(s: string): any | null {
  try { return JSON.parse(s) } catch {}
  try { return JSON.parse(s.replace(/\\'/g, "'")) } catch {}
  return null
}

// Last resort: pull the "description" value out of a malformed JSON string directly,
// so a parse failure can NEVER store the whole raw JSON blob as the lot description.
function extractDescription(s: string): string | null {
  const m = s.match(/"description"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  if (!m) return null
  return m[1]
    .replace(/\\n/g, "\n").replace(/\\t/g, "\t")
    .replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, "\\")
    .trim()
}

// POST /api/auction-ai/key-points-check
// Checks a single lot — label, keyPoints, description.
// Returns { revised, changed, missing, added } or { error }.
// Always returns HTTP 200 — inspect the body for errors.
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

  try {
    const { label, keyPoints, description, model } = await req.json() as {
      label:       string
      keyPoints:   string
      description: string
      model?:      string
    }
    if (!label || !keyPoints || !description) {
      return NextResponse.json({ error: "Missing label, keyPoints or description" }, { status: 400 })
    }

    const genAI = new GoogleGenerativeAI(apiKey)
    const ai = genAI.getGenerativeModel({
      model: model ?? "gemini-2.5-flash-preview-04-17",
      systemInstruction: SYSTEM_INSTRUCTION,
    })

    const prompt =
      `Lot: ${label}\n\n` +
      `Key points (all must appear in the description):\n${keyPoints}\n\n` +
      `Current description:\n${description}`

    const result   = await ai.generateContent(prompt)
    const response = result.response

    if (response.promptFeedback?.blockReason) {
      throw new Error(`BLOCKED: ${response.promptFeedback.blockReason}`)
    }
    const finishReason = response.candidates?.[0]?.finishReason
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      throw new Error(`BLOCKED: ${finishReason}`)
    }

    const rawResponse = response.text()
    const raw     = rawResponse.trim().replace(/^```json\s*/i, "").replace(/```$/, "")
    let revised   = description.trim()
    let missing   = ""
    let added     = ""
    let found     = ""

    const parsed = parseModelJson(raw)
    if (parsed && typeof parsed === "object") {
      revised = parsed.description?.trim() || revised
      missing = parsed.missing?.trim()     || ""
      added   = parsed.added?.trim()       || ""
      found   = parsed.found?.trim()       || ""
    } else {
      // Could not parse the JSON (e.g. an invalid \' escape from the model). Pull the
      // description out directly if we can; otherwise KEEP the original description.
      // Never write the raw JSON blob — that corrupted a lot (2026-06-25).
      const extracted = extractDescription(raw)
      if (extracted) revised = extracted
    }

    const changed = revised !== description.trim()
    return NextResponse.json({ revised, changed, missing, added, found,
      debug: { prompt, response: rawResponse } })
  } catch (e: any) {
    const msg: string = e.message ?? "Unknown error"
    if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
      return NextResponse.json({ error: `RATE_LIMITED: ${msg}` })
    }
    return NextResponse.json({ error: msg })
  }
}
