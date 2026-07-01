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

// POST — bulk import. Upserts every instruction in the payload (add new,
// overwrite existing by key). Used by the Export/Import feature to sync
// instructions between environments (e.g. staging → production). Never deletes.
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const body = await req.json()
    const instructions = body?.instructions
    if (!instructions || typeof instructions !== "object" || Array.isArray(instructions))
      return NextResponse.json({ error: "Invalid file — expected { instructions: { name: text } }" }, { status: 400 })

    const entries = Object.entries(instructions)
      .filter(([k, v]) => typeof k === "string" && k.trim() && typeof v === "string")
      .map(([k, v]) => [k, v as string] as const)
    if (!entries.length)
      return NextResponse.json({ error: "No valid instructions found in the file" }, { status: 400 })

    await prisma.$transaction(
      entries.map(([key, instruction]) =>
        prisma.aiPreset.upsert({ where: { key }, update: { instruction }, create: { key, instruction } })
      )
    )
    return NextResponse.json({ imported: entries.length })
  } catch (e: any) {
    console.error("presets POST (import) error:", e)
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
