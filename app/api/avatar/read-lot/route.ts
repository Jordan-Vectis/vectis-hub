import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"

// Cache the working model name for the lifetime of the server process
let cachedModel: string | null = null

async function findWorkingModel(apiKey: string): Promise<string> {
  if (cachedModel) return cachedModel

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}&pageSize=50`,
  )
  if (!res.ok) throw new Error(`ListModels failed: ${res.status}`)

  const data = await res.json()
  const models: { name: string; supportedGenerationMethods?: string[] }[] = data.models ?? []

  // Pick the first flash/pro model that supports generateContent
  const preferred = ["flash", "pro"]
  for (const pref of preferred) {
    const found = models.find(
      (m) =>
        m.name.toLowerCase().includes(pref) &&
        m.supportedGenerationMethods?.includes("generateContent"),
    )
    if (found) {
      cachedModel = found.name.replace("models/", "")
      console.log("read-lot: using model", cachedModel)
      return cachedModel
    }
  }

  throw new Error(`No suitable model found. Available: ${models.map((m) => m.name).join(", ")}`)
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const { imageBase64 } = await req.json()
    if (!imageBase64) return NextResponse.json({ error: "No image provided" }, { status: 400 })

    const modelId = await findWorkingModel(apiKey)

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${modelId}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: "image/jpeg", data: imageBase64 } },
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
      // Clear cache so next request re-discovers the model
      cachedModel = null
      const errText = await res.text()
      return NextResponse.json({ error: errText }, { status: res.status })
    }

    const json = await res.json()
    const text = (json.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim()

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
