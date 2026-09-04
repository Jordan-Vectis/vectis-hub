import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getAllInstructions, getPresetLayout } from "@/lib/ai-instructions"

// GET — instructions from the single-source AiPreset table (favourites first).
// Default: a { key: text } map (used by the run tabs — unchanged shape).
// ?full=1: the full ordered list [{ key, instruction, favourite, category, sortOrder }].
// ?layout=1: { instructions, categories } for the Instructions management tab.
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const params = new URL(req.url).searchParams
    if (params.get("layout")) return NextResponse.json(await getPresetLayout())
    const rows = await getAllInstructions()
    if (params.get("full")) return NextResponse.json(rows)
    const map: Record<string, string> = {}
    for (const r of rows) map[r.key] = r.instruction
    return NextResponse.json(map)
  } catch (e: any) {
    console.error("presets GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

// PATCH — toggle an instruction's favourite or archived flag (either, or both).
// Archiving takes it out of the Instructions list and every run dropdown; it is
// never a delete, and resolveInstruction still finds it by key (see the note
// there — a queued overnight sale depends on that).
export async function PATCH(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { key, favourite, archived } = await req.json()
    if (!key || (typeof favourite !== "boolean" && typeof archived !== "boolean"))
      return NextResponse.json({ error: "Invalid body" }, { status: 400 })

    const data: { favourite?: boolean; archived?: boolean } = {}
    if (typeof favourite === "boolean") data.favourite = favourite
    if (typeof archived  === "boolean") data.archived  = archived

    await prisma.aiPreset.update({ where: { key }, data })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("presets PATCH error:", e)
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

    // Favourites are only touched when the file carries a favourites list (v2+),
    // so importing an older file never clears favourite state.
    const hasFav = Array.isArray(body?.favourites)
    const favSet = new Set<string>(hasFav ? body.favourites.filter((k: any) => typeof k === "string") : [])

    // Same rule for archived (v4+): only touched when the file carries the list,
    // so importing an older export never un-archives everything here.
    const hasArchived = Array.isArray(body?.archived)
    const archivedSet = new Set<string>(hasArchived ? body.archived.filter((k: any) => typeof k === "string") : [])

    // Category layout (v3+). Applied only to the keys being imported, and never
    // deletes categories — new category names are appended after the existing
    // ones so an import can't scramble a layout that's already arranged here.
    const layout = body?.layout && typeof body.layout === "object" ? body.layout : null
    const layoutItems: Record<string, { category?: unknown; sortOrder?: unknown }> =
      layout?.items && typeof layout.items === "object" && !Array.isArray(layout.items) ? layout.items : {}
    const layoutCats: string[] = Array.isArray(layout?.categoryOrder)
      ? layout.categoryOrder.filter((c: any): c is string => typeof c === "string" && !!c.trim()).map((c: string) => c.trim())
      : []
    const placementOf = (key: string): { category: string | null; sortOrder: number } | null => {
      const it = layoutItems[key]
      if (!layout || !it || typeof it !== "object") return null
      const category = typeof it.category === "string" && it.category.trim() ? it.category.trim() : null
      const sortOrder = Number.isFinite(it.sortOrder) ? Math.trunc(it.sortOrder as number) : 0
      return { category, sortOrder }
    }

    await prisma.$transaction(async (tx) => {
      if (layoutCats.length) {
        try {
          const existing = await tx.aiPresetCategory.findMany({ orderBy: { sortOrder: "asc" } })
          const known = new Set(existing.map((c) => c.name))
          const missing = layoutCats.filter((c) => !known.has(c))
          if (missing.length) {
            await tx.aiPresetCategory.createMany({ data: missing.map((name, i) => ({ name, sortOrder: existing.length + i })) })
          }
        } catch { /* category table not migrated yet — instructions still import */ }
      }
      for (const [key, instruction] of entries) {
        const place = placementOf(key)
        const update: { instruction: string; favourite?: boolean; archived?: boolean; category?: string | null; sortOrder?: number } = { instruction }
        const create: { key: string; instruction: string; favourite?: boolean; archived?: boolean; category?: string | null; sortOrder?: number } = { key, instruction }
        if (hasFav) { update.favourite = favSet.has(key); create.favourite = favSet.has(key) }
        if (hasArchived) { update.archived = archivedSet.has(key); create.archived = archivedSet.has(key) }
        if (place) { update.category = place.category; update.sortOrder = place.sortOrder; create.category = place.category; create.sortOrder = place.sortOrder }
        try {
          await tx.aiPreset.upsert({ where: { key }, update, create })
        } catch {
          // Pre-migration environment (missing category/sortOrder/archived
          // columns): retry with just the text so the instruction still lands.
          delete update.category; delete update.sortOrder; delete update.archived
          delete create.category; delete create.sortOrder; delete create.archived
          await tx.aiPreset.upsert({ where: { key }, update, create })
        }
      }
    })
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
