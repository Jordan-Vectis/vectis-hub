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

// Return every instruction as an ordered { key: text } map. Built-in keys come
// first (in bootstrap order), then any user-created instructions (alphabetical).
// Seeds the starter defaults automatically only if the table is completely empty
// (a fresh environment) — never fills in individual keys, so a deleted
// instruction stays deleted.
export async function getAllInstructions(): Promise<Record<string, string>> {
  let rows = await prisma.aiPreset.findMany()
  if (rows.length === 0) {
    await seedDefaults()
    rows = await prisma.aiPreset.findMany()
  }
  const byKey = new Map(rows.map((r) => [r.key, r.instruction]))
  const out: Record<string, string> = {}
  for (const k of Object.keys(PRESETS)) if (byKey.has(k)) out[k] = byKey.get(k)!
  for (const k of [...byKey.keys()].filter((k) => !(k in PRESETS)).sort()) out[k] = byKey.get(k)!
  return out
}

// Resolve a single instruction by key from the database (the single source of
// truth), so a run always uses exactly the saved version. Seeds first if the
// table is empty (fresh environment). Throws if the key does not exist — callers
// surface that as a clean 400.
export async function resolveInstruction(key: string): Promise<string> {
  if (!key) return ""
  let row = await prisma.aiPreset.findUnique({ where: { key } })
  if (!row) {
    const count = await prisma.aiPreset.count()
    if (count === 0) {
      await seedDefaults()
      row = await prisma.aiPreset.findUnique({ where: { key } })
    }
  }
  if (!row) throw new Error(`Instruction "${key}" not found`)
  return row.instruction
}
