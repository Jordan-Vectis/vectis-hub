import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const maxDuration = 60

const PROMPT = `You are checking a catalogue lot entry for potential cataloguer mistakes.

You will be given:
- Key points: the cataloguer's raw notes (catalogue numbers, condition, completeness, etc.)
- Description: the AI-generated catalogue description based on those key points

Your job is to check whether any key point contains a hard factual error — for example, a wrong catalogue number, set number, model number, or product name that conflicts with the description or that you are highly confident is incorrect based on your knowledge.

Do NOT flag:
- Style or wording preferences
- Vague estimates or condition descriptions
- Anything you are not highly confident about

If you are HIGHLY confident a key point contains an error, respond with exactly:
FLAG: <which key point looks wrong, what you believe is correct, and why>

If everything looks correct, respond with exactly:
OK`

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const { keyPoints, description, model: modelId = "gemini-2.0-flash" } = await req.json()

    if (!keyPoints?.trim() || !description?.trim()) {
      return NextResponse.json({ flag: null })
    }

    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({ model: modelId, systemInstruction: PROMPT })

    const prompt = `Key points:\n${keyPoints.trim()}\n\nDescription:\n${description.trim()}`

    let result: any
    try {
      result = await model.generateContent(prompt)
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      if (/429|resource.?exhausted|quota|rate.?limit/i.test(msg)) {
        throw new Error(`RATE_LIMITED: ${msg}`)
      }
      throw e
    }

    const response = result.response

    const promptBlock = response.promptFeedback?.blockReason
    if (promptBlock) return NextResponse.json({ flag: null })

    const finishReason = response.candidates?.[0]?.finishReason
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      return NextResponse.json({ flag: null })
    }

    const text = response.text().trim()
    const flagLine = text.split("\n").find((l: string) => l.toLowerCase().startsWith("flag:")) ?? ""
    const flag = flagLine ? flagLine.replace(/^flag:\s*/i, "").trim() : null

    return NextResponse.json({ flag })
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error"
    return NextResponse.json({ error: msg }, { status: msg.startsWith("RATE_LIMITED:") ? 429 : 500 })
  }
}
