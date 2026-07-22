import { prisma } from "@/lib/prisma"
import { PRESETS } from "@/lib/auction-ai-presets"

// ─── Auction AI instructions — single source of truth ─────────────────────────
//
// The AiPreset database table is the ONE true home for every Auction AI
// instruction. It is viewed and edited on the Auction AI → Instructions page,
// and every run resolves its instruction from here by key.
//
// The PRESETS constant (lib/auction-ai-presets.ts) is ONLY used to seed a
// brand-new, empty database once. After the first seed the database always
// wins and the code defaults are never consulted again — so what you see and
// edit on the Instructions page is always exactly what runs. This removes the
// old "code copy vs database copy" split that silently drifted.

// One-time bootstrap: copy every starter default into an empty AiPreset table.
// upsert (not create) makes it safe against concurrent callers.
async function seedDefaults(): Promise<void> {
  await prisma.$transaction(
    Object.entries(PRESETS).map(([key, instruction]) =>
      prisma.aiPreset.upsert({ where: { key }, update: {}, create: { key, instruction } })
    )
  )
}

export type InstructionRow = { key: string; instruction: string; favourite: boolean; category: string | null; sortOrder: number }
export type CategoryRow = { name: string; sortOrder: number }

// Defensive read: if the `favourite` / `category` / `sortOrder` columns haven't
// been migrated yet (code deploys before the Run Migrations button is clicked),
// fall back to a raw select of the existing columns so the Auction AI tools keep
// working — favourites/categories simply stay off until the migration runs.
async function fetchRows(): Promise<InstructionRow[]> {
  try {
    const rows = await prisma.aiPreset.findMany({ select: { key: true, instruction: true, favourite: true, category: true, sortOrder: true } })
    return rows.map((r) => ({ ...r, category: r.category ?? null, sortOrder: r.sortOrder ?? 0 }))
  } catch {
    try {
      const raw = await prisma.$queryRaw<{ key: string; instruction: string; favourite: boolean }[]>`SELECT "key", "instruction", "favourite" FROM "AiPreset"`
      return raw.map((r) => ({ ...r, category: null, sortOrder: 0 }))
    } catch {
      const raw = await prisma.$queryRaw<{ key: string; instruction: string }[]>`SELECT "key", "instruction" FROM "AiPreset"`
      return raw.map((r) => ({ ...r, favourite: false, category: null, sortOrder: 0 }))
    }
  }
}

async function fetchCategories(): Promise<CategoryRow[]> {
  try {
    return await prisma.aiPresetCategory.findMany({ orderBy: { sortOrder: "asc" } })
  } catch {
    return []
  }
}

// Order rows: favourites first (in category order), then by category order, then
// by each instruction's sortOrder, then key — so instructions in the same
// category sit together and the run-tab dropdowns cluster the same way the
// Instructions list is arranged.
function orderRows(rows: InstructionRow[], cats: CategoryRow[]): InstructionRow[] {
  const catRank = new Map(cats.map((c, i) => [c.name, i]))
  const rank = (r: InstructionRow) => (r.category != null && catRank.has(r.category) ? catRank.get(r.category)! : Number.MAX_SAFE_INTEGER)
  const cmp = (a: InstructionRow, b: InstructionRow) =>
    rank(a) - rank(b) ||
    (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
    a.key.localeCompare(b.key)
  const sorted = [...rows].sort(cmp)
  // Favourites float to the very top, keeping their relative (category) order.
  return [...sorted.filter((r) => r.favourite), ...sorted.filter((r) => !r.favourite)]
}

// Return every instruction as an ordered list (favourites first, then grouped by
// category). Seeds the starter defaults automatically only if the table is
// completely empty (a fresh environment) — never fills in individual keys, so a
// deleted instruction stays deleted.
export async function getAllInstructions(): Promise<InstructionRow[]> {
  let rows = await fetchRows()
  if (rows.length === 0) {
    await seedDefaults()
    rows = await fetchRows()
  }
  return orderRows(rows, await fetchCategories())
}

// Full layout for the Instructions management tab: every instruction (with its
// category + order) plus the persisted list of category headers (including empty
// ones). Categories in use but not yet in the header table are appended so
// nothing is ever hidden.
export async function getPresetLayout(): Promise<{ instructions: InstructionRow[]; categories: CategoryRow[] }> {
  let rows = await fetchRows()
  if (rows.length === 0) {
    await seedDefaults()
    rows = await fetchRows()
  }
  const cats = await fetchCategories()
  const known = new Set(cats.map((c) => c.name))
  const extras = [...new Set(rows.map((r) => r.category).filter((c): c is string => !!c && !known.has(c)))].sort()
  const categories = [...cats, ...extras.map((name, i) => ({ name, sortOrder: cats.length + i }))]
  return { instructions: orderRows(rows, categories), categories }
}

// Resolve a single instruction by key from the database (the single source of
// truth), so a run always uses exactly the saved version. Selects only the
// instruction text (never the favourite column) so it is safe before the
// migration. Seeds first if the table is empty. Throws if the key is missing.
export async function resolveInstruction(key: string): Promise<string> {
  if (!key) return ""
  let row = await prisma.aiPreset.findUnique({ where: { key }, select: { instruction: true } })
  if (!row) {
    const count = await prisma.aiPreset.count()
    if (count === 0) {
      await seedDefaults()
      row = await prisma.aiPreset.findUnique({ where: { key }, select: { instruction: true } })
    }
  }
  if (!row) throw new Error(`Instruction "${key}" not found`)
  return row.instruction
}
