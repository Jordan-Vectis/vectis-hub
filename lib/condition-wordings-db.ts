import { prisma } from "@/lib/prisma"
import { DEFAULT_WORDINGS } from "@/lib/condition"

// Seed the DB from the built-in wordings the first time (idempotent — no-op once populated).
export async function ensureWordingsSeeded() {
  const count = await prisma.conditionWording.count()
  if (count > 0) return
  let i = 0
  for (const label of DEFAULT_WORDINGS) {
    try {
      await prisma.conditionWording.create({ data: { label, sortOrder: i++ } })
    } catch { /* concurrent seed / already exists — ignore */ }
  }
}

export async function readWordings() {
  await ensureWordingsSeeded()
  return prisma.conditionWording.findMany({ orderBy: [{ sortOrder: "asc" }, { label: "asc" }] })
}

// Flat list of labels for the lot editors' wording picker + the read API.
export async function readWordingLabels(): Promise<string[]> {
  const rows = await readWordings()
  return rows.map((r) => r.label)
}
