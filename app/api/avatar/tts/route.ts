import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getToolModel } from "@/lib/ai-models"

// Text-to-speech for the AI Presenter's 3D mode. Calls Gemini's native TTS via
// REST (the installed @google/generative-ai SDK predates speechConfig, so no SDK)
// and returns raw PCM as base64 for the client to lip-sync against.
//
// The response mimeType from Gemini is "audio/l16; rate=24000; channels=1" —
// headerless 16-bit LE mono PCM. The client builds an AudioBuffer from it
// directly; no WAV wrapping needed.

const MAX_TEXT = 500

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: "GEMINI_API_KEY is not configured on this server" }, { status: 500 })
    }

    const body  = await req.json()
    const text  = String(body?.text ?? "").trim()
    const voice = String(body?.voice ?? "Charon").replace(/[^A-Za-z]/g, "") || "Charon"
    const style = String(body?.style ?? "").trim().slice(0, 200)
    if (!text) return NextResponse.json({ error: "No text" }, { status: 400 })
    if (text.length > MAX_TEXT) return NextResponse.json({ error: `Text too long (max ${MAX_TEXT} chars)` }, { status: 400 })

    const model = await getToolModel("avatar_tts")

    // The style instruction is understood, billed, but not spoken — it is how
    // Gemini TTS docs say to control accent/tone ("Say in a ... voice: ...")
    const prompt = style ? `${style} ${text}` : text

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
        }),
        // A hung Gemini connection must not wedge the presenter's speech queue
        signal: AbortSignal.timeout(30_000),
      },
    )

    if (!res.ok) {
      const errText = await res.text().catch(() => "")
      console.error("avatar-tts Gemini error:", res.status, errText.slice(0, 500))
      return NextResponse.json(
        { error: `TTS failed (HTTP ${res.status})${errText ? `: ${errText.slice(0, 200)}` : ""}` },
        { status: 502 },
      )
    }

    const json   = await res.json()
    const inline = json?.candidates?.[0]?.content?.parts?.[0]?.inlineData
    if (!inline?.data) {
      const block = json?.promptFeedback?.blockReason ?? json?.candidates?.[0]?.finishReason
      return NextResponse.json({ error: `TTS returned no audio${block ? ` (${block})` : ""}` }, { status: 502 })
    }

    const rate = parseInt(/rate=(\d+)/.exec(inline.mimeType ?? "")?.[1] ?? "24000", 10)
    return NextResponse.json({ audio: inline.data, sampleRate: rate, mimeType: inline.mimeType ?? "audio/l16" })
  } catch (e) {
    console.error("avatar-tts error:", e)
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 })
  }
}
