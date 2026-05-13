import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const maxDuration = 60

// POST /api/tickets/import/summarise
//
// Body: { title: string, description: string, fullThread: string }
// Returns: { resolution: string }
//
// Summarises the resolution from a full Zendesk thread. Called ONCE PER
// TICKET by the import page — sequential, easy to debug, no batching.

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Admin only" }, { status: 401 })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const { title, description, fullThread } = await req.json() as {
      title?:       string
      description?: string
      fullThread?:  string
    }

    const thread = (fullThread ?? "").trim()
    if (!thread) return NextResponse.json({ resolution: "" })

    // Cap the thread to keep prompts tight.
    const capped = thread.length > 8000 ? thread.slice(0, 8000) + "\n…(truncated)" : thread

    const prompt = `You are summarising an IT support ticket for the Vectis auction house knowledge base. Below is a full email thread between Vectis staff and "Auction Marketer Support".

Write a CONCISE plain-English summary of what was done to RESOLVE the issue, suitable for staff to read later when the same problem comes up. Focus on the fix / steps taken / outcome. Ignore pleasantries, "thank you for raising", repeated context.

Rules:
- Plain text, no markdown headers, no "Hi Jordan" style openers
- 2-6 sentences maximum
- If the thread shows no clear resolution (still pending, no answer given, conversation tailed off), reply with exactly: NO_RESOLUTION
- British English

TICKET TITLE: ${title ?? ""}

ORIGINAL PROBLEM: ${(description ?? "").slice(0, 1000)}

FULL THREAD (oldest first):
${capped}

RESOLUTION SUMMARY:`

    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({
      model: "gemini-2.5-flash-preview-04-17",
      generationConfig: { maxOutputTokens: 512 },
    })

    const result = await model.generateContent(prompt)
    const response = result.response
    if (response.promptFeedback?.blockReason) {
      return NextResponse.json({ resolution: "", warning: `Gemini blocked: ${response.promptFeedback.blockReason}` })
    }
    const finishReason = response.candidates?.[0]?.finishReason
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      return NextResponse.json({ resolution: "", warning: `Gemini stopped: ${finishReason}` })
    }

    let txt = response.text().trim()
    if (txt === "NO_RESOLUTION") txt = ""

    return NextResponse.json({ resolution: txt })
  } catch (e: any) {
    console.error("tickets/import/summarise error:", e)
    return NextResponse.json({ error: e?.message ?? "Summarise failed" }, { status: 500 })
  }
}
