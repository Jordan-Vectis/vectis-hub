import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// POST — persist the whole Instructions layout in one declarative call. The
// client sends the complete desired arrangement after any drag / add / rename /
// delete, and the server makes the database match it:
//   { categoryOrder: string[], items: [{ key, category|null, sortOrder }] }
// - AiPresetCategory rows are replaced to exactly match categoryOrder (so a
//   category dropped from the list is deleted, a new one is created, order is
//   set by index). Renames are handled client-side: items move to the new name
//   and the old name simply isn't in categoryOrder, so it's dropped.
// - Each item's category + sortOrder is written. Items are the source of truth
//   for which category every instruction belongs to; a category with no items is
//   still kept because it's in categoryOrder (an empty header to drag into).
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const body = await req.json()
    const categoryOrder: unknown = body?.categoryOrder
    const items: unknown = body?.items
    if (!Array.isArray(categoryOrder) || !Array.isArray(items)) {
      return NextResponse.json({ error: "Invalid body — expected { categoryOrder, items }" }, { status: 400 })
    }

    const cats = categoryOrder
      .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
      .map((c) => c.trim())
    const catSet = new Set(cats)

    const rows = (items as any[])
      .filter((i) => i && typeof i.key === "string")
      .map((i) => ({
        key: i.key as string,
        // Only honour a category that exists in categoryOrder; anything else
        // falls back to Uncategorised so a stale category can't strand a lot.
        category: typeof i.category === "string" && catSet.has(i.category.trim()) ? i.category.trim() : null,
        sortOrder: Number.isFinite(i.sortOrder) ? Math.trunc(i.sortOrder) : 0,
      }))

    await prisma.$transaction([
      // Replace the header set with exactly what was sent, in order.
      prisma.aiPresetCategory.deleteMany({}),
      ...(cats.length
        ? [prisma.aiPresetCategory.createMany({ data: cats.map((name, i) => ({ name, sortOrder: i })) })]
        : []),
      // Apply each instruction's placement (skip unknown keys silently).
      ...rows.map((r) =>
        prisma.aiPreset.updateMany({ where: { key: r.key }, data: { category: r.category, sortOrder: r.sortOrder } })
      ),
    ])

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("preset-layout POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
