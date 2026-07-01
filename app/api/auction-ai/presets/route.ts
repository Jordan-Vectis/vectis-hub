import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getAllInstructions } from "@/lib/ai-instructions"

// GET — every instruction as an ordered { key: text } map. The AiPreset table is
// the single source of truth; it is seeded from the starter defaults only if
// completely empty (fresh environment).
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const map = await getAllInstructions()
    return NextResponse.json(map)
  } catch (e: any) {
    console.error("presets GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

// PUT — create or update an instruction. This is the ONLY way an instruction is
// written, and it always persists to the database (no session-only edits).
export async function PUT(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { key, instruction } = await req.json()
    if (!key || typeof instruction !== "string")
      return NextResponse.json({ error: "Invalid body" }, { status: 400 })

    await prisma.aiPreset.upsert({
      where: { key },
      update: { instruction },
      create: { key, instruction },
    })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("presets PUT error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

// DELETE — permanently remove an instruction.
export async function DELETE(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { key } = await req.json()
    if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 })

    await prisma.aiPreset.deleteMany({ where: { key } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("presets DELETE error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
