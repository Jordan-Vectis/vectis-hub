import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export const maxDuration = 30

// GET /api/auction-ai/model-config
// Returns every text-capable Gemini model with its details and enabled state.
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const [googleRes, disabledRows] = await Promise.all([
      fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`).then(r => r.json()),
      prisma.disabledModel.findMany({ select: { modelId: true } }),
    ])
    const disabled = new Set(disabledRows.map(d => d.modelId))

    const models = (googleRes.models ?? [])
      .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m: any) => {
        const id = m.name.replace("models/", "")
        return {
          id,
          displayName:      m.displayName,
          description:      m.description,
          inputTokenLimit:  m.inputTokenLimit,
          outputTokenLimit: m.outputTokenLimit,
          enabled:          !disabled.has(id),
        }
      })

    return NextResponse.json({ models })
  } catch (e: any) {
    console.error("auction-ai/model-config GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

// POST /api/auction-ai/model-config  { modelId, enabled }
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { modelId, enabled } = await req.json()
    if (!modelId || typeof enabled !== "boolean") {
      return NextResponse.json({ error: "modelId and enabled required" }, { status: 400 })
    }

    if (enabled) {
      await prisma.disabledModel.deleteMany({ where: { modelId } })
    } else {
      await prisma.disabledModel.upsert({
        where:  { modelId },
        update: {},
        create: { modelId },
      })
    }
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("auction-ai/model-config POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
