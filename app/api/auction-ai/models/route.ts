import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

  try {
    const [res, disabledRows] = await Promise.all([
      fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`),
      prisma.disabledModel.findMany({ select: { modelId: true } }).catch(() => []),
    ])
    const disabled = new Set(disabledRows.map((d: any) => d.modelId))
    const json = await res.json()
    const usable = (json.models ?? [])
      .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
      .filter((m: any) => !disabled.has(m.name.replace("models/", "")))

    const models = usable.map((m: any) => m.name.replace("models/", ""))

    // Authoritative per-model info from Google's own API — used to describe each
    // model in the selector. Keyed by the same id used in `models`.
    const details: Record<string, { displayName?: string; description?: string; inputTokenLimit?: number; outputTokenLimit?: number }> = {}
    for (const m of usable) {
      const id = m.name.replace("models/", "")
      details[id] = {
        displayName:     m.displayName,
        description:     m.description,
        inputTokenLimit:  m.inputTokenLimit,
        outputTokenLimit: m.outputTokenLimit,
      }
    }

    return NextResponse.json({ models, details })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
