import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { specialDate, context, platform, modelId } = await req.json()

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 })

    const platformName = platform === "INSTAGRAM" ? "Instagram" : "Facebook"

    const prompt = `You are a social media manager for Vectis, the UK's largest toy and collectables auction house.

Write an engaging ${platformName} post for the following occasion or topic. The post should:
- Be exciting and relevant to toy and collectable collectors
- Feel authentic and enthusiastic, not corporate
- Include a clear call to action (visit our website, browse the auction, etc.)
- Be the right length for ${platformName} (Facebook: up to 3 short paragraphs, Instagram: punchy and visual)
- End with 8–12 highly relevant SEO-friendly hashtags on a new line
- British English spelling

Occasion / Topic: ${specialDate}
${context ? `Additional context: ${context}` : ""}

Write the post now (copy first, then hashtags on a new line starting with #):`

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: modelId ?? "gemini-2.5-flash-preview-04-17" })

    const result = await model.generateContent(prompt)

    if (result.response.promptFeedback?.blockReason) {
      return NextResponse.json({ error: `Blocked: ${result.response.promptFeedback.blockReason}` }, { status: 422 })
    }

    const text = result.response.text().trim()

    // Split copy from hashtags
    const hashtagIndex = text.lastIndexOf("\n#")
    const copy     = hashtagIndex > -1 ? text.slice(0, hashtagIndex).trim() : text
    const hashtags = hashtagIndex > -1 ? text.slice(hashtagIndex).trim()    : ""

    return NextResponse.json({ copy, hashtags })
  } catch (e: any) {
    console.error("social-posts generate error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
