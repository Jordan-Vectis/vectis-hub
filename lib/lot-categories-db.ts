import { prisma } from "@/lib/prisma"
import { DEFAULT_CATEGORY_MAP } from "@/lib/lot-categories"

// Seed the DB from the default map the first time (idempotent — no-op once populated).
export async function ensureCategoriesSeeded() {
  const count = await prisma.lotCategory.count()
  if (count > 0) return
  let i = 0
  for (const [name, subs] of Object.entries(DEFAULT_CATEGORY_MAP)) {
    try {
      await prisma.lotCategory.create({
        data: { name, sortOrder: i++, subcategories: { create: subs.map((s, j) => ({ name: s, sortOrder: j })) } },
      })
    } catch { /* concurrent seed / already exists — ignore */ }
  }
}

export async function readCategories() {
  await ensureCategoriesSeeded()
  return prisma.lotCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { subcategories: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
  })
}

// Simple { category: [subcategories] } map for the cataloguing dropdowns + API.
export async function readCategoryMap(): Promise<Record<string, string[]>> {
  const cats = await readCategories()
  const map: Record<string, string[]> = {}
  for (const c of cats) map[c.name] = c.subcategories.map((s) => s.name)
  return map
}
