// Where did each fact come from, and is that object really what the description calls it?
//
// 2026-10-01, a trio of Sindy dolls: the third holds a microphone, and the AI wrote "holding a
// silver baton with a loose white feather (cap absent)". It had recognised the 1979 Majorette
// outfit from memory, memory says a majorette carries a baton and wears a cap, and at the size
// the model sees a photo the microphone was a few dozen pixels — so knowledge filled in what the
// eyes could not resolve. Nothing in the pipeline could catch that, because the claim was
// confident and the photo was "consulted".
//
// Two things now exist, both ADVISORY — neither ever changes a description:
//  1. The Batch route asks the model to end with an "ASSUMED:" line naming every statement that
//     came from its own knowledge rather than the key points or something clearly visible
//     (lib/batch-prompt.ts). Those land in `assumed` here.
//  2. Double Check lists every object the description names and says, per object, whether the
//     photos show it IS that thing — sure / unsure / no — with a few words on what it can see
//     (lib/double-check-instruction.ts). Those land in `objects`.
// The Review tab shows both in amber on the lot, counts the lots that need a look, and a person
// ticks a lot as checked. A new run replaces the row and clears the tick.
//
// ⚠ Migration-safe on purpose: the table is new and every caller is a hot path (the overnight
// runner, the pipeline tab). If the table is not there yet, record() says so once in the log and
// returns false; load() returns an empty map. Nothing else about a run is affected.

import { prisma } from "@/lib/prisma"

export type ObjectVerdict = "sure" | "unsure" | "no"
export type ObjectCheck   = { object: string; verdict: ObjectVerdict; note: string }

export type LotAiCheck = {
  lotId:     string
  assumed:   string[]
  objects:   ObjectCheck[]
  model:     string | null
  source:    string | null
  checkedBy: string | null
  checkedAt: Date | null
  updatedAt: Date
}

/** "ASSUMED: 1979 Majorette uniform | cap absent | silver baton" → the list. "none" → []. */
export function parseAssumed(line: string): string[] {
  const body = (line ?? "").replace(/^assumed:\s*/i, "").trim()
  if (!body || /^(none|nothing|n\/a|-)\.?$/i.test(body)) return []
  return body
    .split(/\s*\|\s*|\s*;\s*/)
    .map(s => s.replace(/^[-•*]\s*/, "").trim())
    .filter(s => s && !/^(none|nothing)\.?$/i.test(s))
    .slice(0, 40)
    .map(s => s.slice(0, 300))
}

/** Whatever the model put in "objects", made safe: a list of {object, verdict, note}. */
export function normaliseObjects(v: unknown): ObjectCheck[] {
  if (!Array.isArray(v)) return []
  const out: ObjectCheck[] = []
  for (const row of v) {
    if (!row || typeof row !== "object") continue
    const object = String((row as any).object ?? "").trim().slice(0, 200)
    if (!object) continue
    const raw = String((row as any).verdict ?? "").trim().toLowerCase()
    const verdict: ObjectVerdict = raw === "no" ? "no" : raw === "unsure" || raw === "uncertain" || raw === "maybe" ? "unsure" : "sure"
    out.push({ object, verdict, note: String((row as any).note ?? "").trim().slice(0, 300) })
    if (out.length >= 40) break
  }
  return out
}

/** Does this lot want a person's eyes? Anything assumed, or any object not "sure", and nobody has ticked it. */
export function needsALook(c: { assumed: string[]; objects: ObjectCheck[]; checkedAt: Date | string | null } | null | undefined): boolean {
  if (!c || c.checkedAt) return false
  return c.assumed.length > 0 || c.objects.some(o => o.verdict !== "sure")
}

const isMissingTable = (e: any) => e?.code === "P2021" || /does not exist/i.test(String(e?.message ?? ""))
let warnedMissing = false

/**
 * Record what a run learned about a lot. `assumed` replaces the list (a new description, a new
 * list); `objects` replaces the look-again; either clears a person's tick, because what they
 * ticked is no longer what is there. Returns false, never throws, when it could not.
 */
export async function recordLotAiCheck(lotId: string, patch: { assumed?: string[]; objects?: ObjectCheck[]; model?: string | null; source?: string }): Promise<boolean> {
  try {
    const data: Record<string, unknown> = {}
    if (patch.assumed) { data.assumed = patch.assumed.slice(0, 40).map(s => String(s).slice(0, 300)); data.checkedAt = null; data.checkedBy = null }
    if (patch.objects) { data.objects = normaliseObjects(patch.objects); data.checkedAt = null; data.checkedBy = null }
    if (patch.model)   data.model  = String(patch.model).slice(0, 120)
    if (patch.source)  data.source = patch.source
    if (!Object.keys(data).length) return true
    await prisma.catalogueLotAiCheck.upsert({
      where:  { lotId },
      create: { lotId, assumed: (data.assumed as string[]) ?? [], objects: (data.objects as any) ?? [], model: (data.model as string) ?? null, source: (data.source as string) ?? null },
      update: data as any,
      select: { id: true },
    })
    return true
  } catch (e: any) {
    if (isMissingTable(e)) {
      if (!warnedMissing) { console.warn("[lot-ai-check] CatalogueLotAiCheck is not in the database yet — Run Migrations; AI checks are not being kept until then"); warnedMissing = true }
      return false
    }
    console.error("[lot-ai-check] could not record:", e?.message ?? e)
    return false
  }
}

/** The checks for a set of lots, keyed by lot id. Empty when the table is not there yet. */
export async function loadLotAiChecks(lotIds: string[]): Promise<Map<string, LotAiCheck>> {
  const out = new Map<string, LotAiCheck>()
  if (!lotIds.length) return out
  try {
    const rows = await prisma.catalogueLotAiCheck.findMany({
      where: { lotId: { in: lotIds } },
      select: { lotId: true, assumed: true, objects: true, model: true, source: true, checkedBy: true, checkedAt: true, updatedAt: true },
    })
    for (const r of rows) out.set(r.lotId, { ...r, objects: normaliseObjects(r.objects) })
  } catch (e: any) {
    if (!isMissingTable(e)) console.error("[lot-ai-check] could not load:", e?.message ?? e)
  }
  return out
}

/** A person has looked. */
export async function markLotAiCheckSeen(lotId: string, by: string): Promise<boolean> {
  try {
    await prisma.catalogueLotAiCheck.update({ where: { lotId }, data: { checkedAt: new Date(), checkedBy: by.slice(0, 120) }, select: { id: true } })
    return true
  } catch (e: any) {
    if (!isMissingTable(e) && e?.code !== "P2025") console.error("[lot-ai-check] could not mark seen:", e?.message ?? e)
    return false
  }
}
