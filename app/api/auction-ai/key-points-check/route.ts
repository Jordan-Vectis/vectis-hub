import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const maxDuration = 60

const SYSTEM_INSTRUCTION = `You are a strict quality checker for auction house lot descriptions.

Your task — follow these steps exactly:
1. Read the description in full.
2. Go through EVERY key point one by one, in order. For each key point ask yourself: does the description contain a sentence or phrase that explicitly states this exact fact? Write out your verdict for each point before moving on.
3. A key point is ONLY present if its precise meaning is clearly and explicitly stated as its own point. Do NOT infer, assume, or accept vague references.
4. If ALL key points are present: return the description word-for-word unchanged.
5. If ANY key point is missing or only partially covered: insert it directly into the description with the minimum change necessary.

Critical rules:
- Every single key point MUST appear in the final description — missing even one is a failure.
- NEVER remove or shorten any existing detail from the description.
- NEVER rewrite from scratch — only insert what is missing.
- NEVER invent facts beyond what appears in the key points or the original description.
- The final description must be at least as long as the original.
- **Partial word matches do NOT count.** A key point is satisfied only if its specific meaning is explicitly stated. Example: "Perforated card" means the card has been hole-punched — this is NOT satisfied by "perforated header card" or "the header card" unless the fact it is hole-punched is explicitly noted as a condition. When in doubt, insert the key point.
- Short key points (3 words or fewer) are always specific condition or completeness notes. They must appear explicitly — never assume they are implied by longer phrases.
- **Longer descriptions are not more likely to contain a key point.** Do not assume a fact is present just because the description is detailed. Check the exact wording.
- If a key point looks similar to something in the description but is not an exact semantic match, treat it as MISSING and insert it.

Respond with ONLY valid JSON — no markdown, no code fences:
{"description":"<the full final description>","missing":"<comma-separated list of key points that were absent from the original, or empty string if none>","added":"<one sentence describing what was inserted, or empty string if nothing changed>","found":"<for each key point you judged to be PRESENT in the original, write: KeyPoint → 'exact quoted phrase from the description that satisfied it'. Separate entries with a semicolon. If nothing was present leave empty string.>"}`

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

    const raw     = response.text().trim().replace(/^```json\s*/i, "").replace(/```$/, "")
    let revised   = description.trim()
    let missing   = ""
    let added     = ""
    let found     = ""

    try {
      const parsed = JSON.parse(raw)
      revised = parsed.description?.trim() || revised
      missing = parsed.missing?.trim()     || ""
      added   = parsed.added?.trim()       || ""
      found   = parsed.found?.trim()       || ""
    } catch {
      revised = raw
    }

    const changed = revised !== description.trim()
    return NextResponse.json({ revised, changed, missing, added, found })
  } catch (e: any) {
    const msg: string = e.message ?? "Unknown error"
    if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
      return NextResponse.json({ error: `RATE_LIMITED: ${msg}` })
    }
    return NextResponse.json({ error: msg })
  }
}
