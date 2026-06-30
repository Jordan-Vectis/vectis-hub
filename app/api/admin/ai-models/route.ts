import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { AI_TOOLS, invalidateToolModelCache } from "@/lib/ai-models"

export const maxDuration = 30

// GET /api/admin/ai-models
// Returns every tool slot (with its configured + effective model) and the list
// of enabled, text-capable Gemini models for the dropdowns.
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const apiKey = process.env.GEMINI_API_KEY
    const [rows, googleRes, disabledRows] = await Promise.all([
      prisma.toolModel.findMany({ select: { slot: true, modelId: true } }).catch(() => [] as { slot: string; modelId: string }[]),
      apiKey
        ? fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`).then((r) => r.json()).catch(() => ({}))
        : Promise.resolve({}),
      prisma.disabledModel.findMany({ select: { modelId: true } }).catch(() => [] as { modelId: string }[]),
    ])

    const disabled = new Set(disabledRows.map((d) => d.modelId))
    const models: string[] = ((googleRes as any).models ?? [])
      .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m: any) => String(m.name).replace("models/", ""))
      .filter((id: string) => !disabled.has(id))
      .sort()

    const config: Record<string, string> = Object.fromEntries(rows.map((r) => [r.slot, r.modelId]))
    const tools = AI_TOOLS.map((t) => ({
      slot: t.slot,
      label: t.label,
      group: t.group,
      default: t.default,
      configured: config[t.slot] ?? null,
      effective: config[t.slot] || t.default,
    }))

    return NextResponse.json({ tools, models })
  } catch (e: any) {
    console.error("admin/ai-models GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

// POST /api/admin/ai-models  { updates: [{ slot, modelId }] }  (modelId "" = revert to default)
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const body = await req.json()
    const updates: { slot: string; modelId: string }[] = Array.isArray(body?.updates)
      ? body.updates
      : body?.slot
        ? [{ slot: body.slot, modelId: body.modelId ?? "" }]
        : []

    const validSlots = new Set(AI_TOOLS.map((t) => t.slot))
    for (const u of updates) {
      if (!u || !validSlots.has(u.slot)) continue
      if (!u.modelId) {
        await prisma.toolModel.deleteMany({ where: { slot: u.slot } }) // blank = use the built-in default
      } else {
        await prisma.toolModel.upsert({
          where: { slot: u.slot },
          update: { modelId: u.modelId },
          create: { slot: u.slot, modelId: u.modelId },
        })
      }
    }
    invalidateToolModelCache()
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("admin/ai-models POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
