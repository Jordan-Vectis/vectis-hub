import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const maxDuration = 60

// POST /api/auction-ai/autofix-flag
// Takes a lot's key points + current description + the AI flag note (which
// describes a likely error and what's probably correct) and returns a corrected
// description that applies ONLY that fix. Used by the Cataloguing → Review tab
// "Auto-fix" button. The caller reviews the result before saving.
const PROMPT = `You are correcting a catalogue lot DESCRIPTION for a British auction house.

You are given:
- Key points: the cataloguer's raw notes.
- Description: the current catalogue description.
- Flag: an AI review note identifying a likely factual error (e.g. a wrong catalogue / set / model number or product name) and what is probably correct.

Rewrite the description so the flagged error is corrected — and ONLY that. Rules:
- Change only what the Flag identifies as wrong. Keep everything else identical: wording, structure, order, and line breaks.
- Keep the SAME format and the same lines/paragraphs. Join lines with newlines (\\n), never collapse them to spaces.
- British English throughout.
- Do NOT add a condition statement — condition is recorded separately and must not appear in the description.
- Do NOT invent facts or add new claims; only apply the correction the Flag describes.
- If the Flag is too vague to apply confidently, make the smallest sensible correction.

Respond with ONLY the corrected description text — no preamble, no quotes, no explanation.`

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const { keyPoints = "", description = "", flagNote = "", model: modelId = "gemini-2.0-flash" } = await req.json()
    if (!description?.trim() || !flagNote?.trim()) {
      return NextResponse.json({ error: "Missing description or flag note" }, { status: 400 })
    }

    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({ model: modelId, systemInstruction: PROMPT })

    const prompt = `Key points:\n${String(keyPoints).trim()}\n\nDescription:\n${String(description).trim()}\n\nFlag:\n${String(flagNote).trim()}`

    let result: any
    try {
      result = await model.generateContent(prompt)
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      if (/429|resource.?exhausted|quota|rate.?limit/i.test(msg)) throw new Error(`RATE_LIMITED: ${msg}`)
      throw e
    }

    const response = result.response
    if (response.promptFeedback?.blockReason) {
      return NextResponse.json({ error: `Blocked: ${response.promptFeedback.blockReason}` }, { status: 422 })
    }
    const finishReason = response.candidates?.[0]?.finishReason
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      return NextResponse.json({ error: `Could not complete (${finishReason})` }, { status: 422 })
    }

    const fixed = response.text().trim()
    if (!fixed) return NextResponse.json({ error: "Empty AI response" }, { status: 422 })

    return NextResponse.json({ description: fixed })
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error"
    return NextResponse.json({ error: msg }, { status: msg.startsWith("RATE_LIMITED:") ? 429 : 500 })
  }
}
