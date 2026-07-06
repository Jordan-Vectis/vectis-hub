import { NextRequest, NextResponse } from "next/server"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getToolModel } from "@/lib/ai-models"
import { isJordan } from "@/lib/jordan-auth"

export const maxDuration = 120

// POST /api/jordan/chat — the secret menu's two AI chats.
// Body: { message: string, history: [{role:"user"|"model", text:string}], mode: "chat" | "cooking" }
// Locked to jordan.orange; everyone else gets a 404 as if the route doesn't exist.

const PROMPTS: Record<string, string> = {
  chat: `You are the resident AI of JORDAN.SYS — Jordan's personal secret menu hidden inside the Vectis Hub (he's the IT manager at Vectis, an auction house in Thornaby). This is his off-duty corner: day-to-day questions, silly hypotheticals, settling debates, random curiosity, life admin — anything goes.

Be a great conversational companion: witty, warm, direct, up for nonsense but genuinely useful when the question is real. British English always. Keep replies conversational and reasonably short by default — a couple of paragraphs at most unless he clearly wants depth. Never corporate, never lecture-y, no bullet-point essays unless asked.`,

  cooking: `You are Jordan's personal cooking expert inside his secret menu. You give confident, practical home-cooking advice: recipes, techniques, substitutions, timings, "what do I do with what's in the fridge", and especially AIR FRYER cooking — you know basket-style air fryers inside out.

Always use UK terms and measures: grams, ml, °C (say if fan/conventional for ovens). Be food-safety conscious where it matters (chicken 75°C internal, pork, rice reheating) without being preachy. Give timings and temperatures as concrete numbers. Keep answers practical and tight — steps and numbers over prose. British English.`,
}

export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const body = await req.json()
    const message = typeof body?.message === "string" ? body.message.trim() : ""
    const mode: string = body?.mode === "cooking" ? "cooking" : "chat"
    if (!message) return NextResponse.json({ error: "Message required" }, { status: 400 })

    // Client history is [{role, text}] — convert to Gemini's shape, capped to
    // the last 30 turns so the context can't grow without bound.
    const rawHistory: { role?: string; text?: string }[] = Array.isArray(body?.history) ? body.history : []
    const history = rawHistory
      .filter((m) => (m?.role === "user" || m?.role === "model") && typeof m?.text === "string" && m.text)
      .slice(-30)
      .map((m) => ({ role: m.role as "user" | "model", parts: [{ text: m.text as string }] }))

    const modelId = await getToolModel("jordan_fun")
    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({ model: modelId, systemInstruction: PROMPTS[mode] })

    const chat = model.startChat({ history })
    const result = await chat.sendMessage(message)
    const response = result.response

    const promptBlock = response.promptFeedback?.blockReason
    if (promptBlock) {
      return NextResponse.json({ error: `Blocked by Gemini: ${promptBlock}` }, { status: 422 })
    }
    const finishReason = response.candidates?.[0]?.finishReason
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      return NextResponse.json({ error: `Blocked by Gemini (${finishReason})` }, { status: 422 })
    }

    return NextResponse.json({ reply: response.text() })
  } catch (e: any) {
    console.error("jordan/chat error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
