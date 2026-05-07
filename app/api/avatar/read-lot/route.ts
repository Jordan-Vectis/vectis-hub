import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const { imageBase64 } = await req.json()
    if (!imageBase64) return NextResponse.json({ error: "No image provided" }, { status: 400 })

    // Call Gemini v1 REST API directly — the 0.x SDK is pinned to v1beta which
    // doesn't support newer models for multimodal requests
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                inline_data: {
                  mime_type: "image/jpeg",
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
            ],
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 100 },
        }),
      },
    )

    if (!res.ok) {
      const errText = await res.text()
      return NextResponse.json({ error: errText }, { status: res.status })
    }

    const json = await res.json()
    const text = (json.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim()

    // Strip markdown code fences if present
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
