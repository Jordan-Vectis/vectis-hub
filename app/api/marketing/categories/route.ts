import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/marketing/categories
// Returns distinct non-null category values from WarehouseItem (sorted A-Z),
// plus the sub-categories that sit under each category so the UI can offer a
// dependent sub-category filter.

export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const [catRows, pairRows] = await Promise.all([
      prisma.warehouseItem.findMany({
        where:   { category: { not: null } },
        select:  { category: true },
        distinct: ["category"],
        orderBy: { category: "asc" },
      }),
      // Distinct (category, subcategory) pairs — drives the dependent dropdown.
      prisma.warehouseItem.findMany({
        where:    { subcategory: { not: null } },
        select:   { category: true, subcategory: true },
        distinct: ["category", "subcategory"],
        orderBy:  [{ category: "asc" }, { subcategory: "asc" }],
      }),
    ])

    const categories = catRows.map(r => r.category!).filter(Boolean)

    const subcategoriesByCategory: Record<string, string[]> = {}
    const allSet = new Set<string>()
    for (const r of pairRows) {
      const sub = r.subcategory?.trim()
      if (!sub) continue
      allSet.add(sub)
      const cat = r.category?.trim()
      if (cat) (subcategoriesByCategory[cat] ??= []).push(sub)
    }
    const allSubcategories = [...allSet].sort((a, b) => a.localeCompare(b))

    return NextResponse.json({ categories, subcategoriesByCategory, allSubcategories })
  } catch (e: any) {
    console.error("marketing/categories error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
