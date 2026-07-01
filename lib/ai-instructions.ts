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

export type InstructionRow = { key: string; instruction: string; favourite: boolean }

// Defensive read: if the `favourite` column hasn't been migrated yet (code
// deploys before the Run Migrations button is clicked), fall back to a raw
// select of the existing columns so the Auction AI tools keep working —
// favourites simply stay off until the migration runs.
async function fetchRows(): Promise<InstructionRow[]> {
  try {
    return await prisma.aiPreset.findMany({ select: { key: true, instruction: true, favourite: true } })
  } catch {
    const raw = await prisma.$queryRaw<{ key: string; instruction: string }[]>`SELECT "key", "instruction" FROM "AiPreset"`
    return raw.map((r) => ({ ...r, favourite: false }))
  }
}

// Return every instruction as an ordered list: favourites first, then built-in
// keys (bootstrap order), then any user-created instructions (alphabetical).
// Seeds the starter defaults automatically only if the table is completely empty
// (a fresh environment) — never fills in individual keys, so a deleted
// instruction stays deleted.
export async function getAllInstructions(): Promise<InstructionRow[]> {
  let rows = await fetchRows()
  if (rows.length === 0) {
    await seedDefaults()
    rows = await fetchRows()
  }
  const byKey = new Map(rows.map((r) => [r.key, r]))
  const ordered: InstructionRow[] = []
  for (const k of Object.keys(PRESETS)) { const r = byKey.get(k); if (r) ordered.push(r) }
  for (const k of [...byKey.keys()].filter((k) => !(k in PRESETS)).sort()) ordered.push(byKey.get(k)!)
  // Favourites float to the top, preserving the relative order above (stable).
  return [...ordered.filter((r) => r.favourite), ...ordered.filter((r) => !r.favourite)]
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
