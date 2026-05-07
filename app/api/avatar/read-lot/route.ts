import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const { imageBase64 } = await req.json()
    if (!imageBase64) return NextResponse.json({ error: "No image provided" }, { status: 400 })

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" })

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: imageBase64,
        },
      },
      {
        text: `This is a screenshot of a live online auction page. Extract ONLY:
- lotNumber: the current lot number shown (digits only, e.g. "558")
- askingBid: the asking bid or next bid amount (e.g. "£80")
- currentBid: the current bid amount (e.g. "£70")

Respond with ONLY valid JSON, no other text:
{"lotNumber":"558","currentBid":"£70","askingBid":"£80"}

If a field is not visible or unclear, use null for that field.`,
      },
    ])

    const text = result.response.text().trim()

    // Strip markdown code fences if Gemini wraps in ```json
    const cleaned = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim()

    try {
      return NextResponse.json(JSON.parse(cleaned))
    } catch {
      const match = cleaned.match(/\{[^}]+\}/)
      if (match) return NextResponse.json(JSON.parse(match[0]))
      return NextResponse.json({ lotNumber: null, currentBid: null, askingBid: null })
    }
  } catch (e: any) {
    console.error("read-lot error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
