import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getToolModel } from "@/lib/ai-models"

export const maxDuration = 60

const PROMPT = `You are checking a catalogue lot entry for potential cataloguer mistakes.

You will be given:
- Key points: the cataloguer's raw notes (catalogue numbers, condition, completeness, etc.)
- Description: the AI-generated catalogue description based on those key points

Your job is to check whether any key point contains a hard factual error — for example, a wrong catalogue number, set number, model number, or product name that conflicts with the description or that you are highly confident is incorrect.

IMPORTANT: Use Google Search to verify any catalogue number, set number, model number, or product code before flagging it. Do not rely on memory alone — always search first.

Do NOT flag:
- Style or wording preferences
- Vague estimates or condition descriptions
- Anything you are not highly confident about
- A set number, catalogue number, or product code simply because it is not in your training data — your knowledge has a cutoff date and products released in 2024 or later may not be known to you. Absence from your training data does NOT mean the product does not exist. Only flag a number if you have strong positive evidence it is wrong (e.g. it belongs to a completely different product, the number format is impossible for that brand, or it clearly contradicts something else in the entry).

If you are HIGHLY confident a key point contains an error (based on positive evidence, not absence of knowledge), respond with exactly:
FLAG: <which key point looks wrong, what you believe is correct, and why>

If everything looks correct, respond with exactly:
OK`

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const { keyPoints, description, model: modelId = "" } = await req.json()

    if (!keyPoints?.trim() || !description?.trim()) {
      return NextResponse.json({ flag: null })
    }

    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({
      model: await getToolModel("catalogue_flags", modelId),
      systemInstruction: PROMPT,
      tools: [{ googleSearch: {} } as any],
    })

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
