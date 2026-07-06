"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { cleanChampName, normaliseClass, normChampName } from "@/lib/mcoc"

// Server actions for the MCOC roster (secret menu). All jordan-only. Rows are
// keyed to Jordan's user id; a champ can exist at 6* and 7* separately.

async function ownerId(): Promise<string> {
  const session = await auth()
  if (!session || !(await isJordan())) throw new Error("Unauthorised")
  return session.user.id
}

const clampStars = (n: unknown) => (Number(n) === 6 ? 6 : 7)
const clampRank = (n: unknown) => Math.min(5, Math.max(1, Math.round(Number(n) || 1)))

export type ChampInput = { name: string; class?: string; stars?: number; rank?: number; bgsDeck?: boolean; imageKey?: string }

// Bulk add/update (upsert by name+stars). Used by the photo-scan confirm step
// (which also updates ranks + portraits on existing champs) and manual add.
export async function addChampions(list: ChampInput[]) {
  const owner = await ownerId()
  let added = 0, updated = 0
  for (const c of list) {
    const name = cleanChampName(c.name)
    if (!name) continue
    const stars = clampStars(c.stars)
    const rank = c.rank === undefined ? undefined : clampRank(c.rank)
    const cls = normaliseClass(c.class ?? "")
    const imageKey = typeof c.imageKey === "string" && c.imageKey ? c.imageKey : undefined
    const existing = await prisma.mcocChampion.findUnique({ where: { ownerId_name_stars: { ownerId: owner, name, stars } } })
    if (existing) {
      await prisma.mcocChampion.update({
        where: { id: existing.id },
        data: {
          ...(rank !== undefined ? { rank } : {}),
          ...(cls ? { class: cls } : {}),
          ...(imageKey ? { imageKey } : {}),
          ...(c.bgsDeck !== undefined ? { bgsDeck: c.bgsDeck } : {}),
        },
      })
      updated++
    } else {
      await prisma.mcocChampion.create({
        data: { ownerId: owner, name, class: cls, stars, rank: rank ?? 1, bgsDeck: c.bgsDeck === true, imageKey: imageKey ?? null },
      })
      added++
    }
  }
  return { added, updated }
}

export async function updateChampion(id: string, data: { rank?: number; stars?: number; class?: string; bgsDeck?: boolean }) {
  const owner = await ownerId()
  const row = await prisma.mcocChampion.findFirst({ where: { id, ownerId: owner } })
  if (!row) throw new Error("Not found")
  await prisma.mcocChampion.update({
    where: { id },
    data: {
      ...(data.rank !== undefined ? { rank: clampRank(data.rank) } : {}),
      ...(data.stars !== undefined ? { stars: clampStars(data.stars) } : {}),
      ...(data.class !== undefined ? { class: normaliseClass(data.class) } : {}),
      ...(data.bgsDeck !== undefined ? { bgsDeck: data.bgsDeck } : {}),
    },
  })
}

export async function deleteChampion(id: string) {
  const owner = await ownerId()
  await prisma.mcocChampion.deleteMany({ where: { id, ownerId: owner } })
}

export async function setBgsDeck(ids: string[], inDeck: boolean) {
  const owner = await ownerId()
  await prisma.mcocChampion.updateMany({ where: { id: { in: ids }, ownerId: owner }, data: { bgsDeck: inDeck } })
}

// Set the BGS deck to EXACTLY these roster-champ ids (the client resolves the
// deck-photo names against the roster and lets Jordan confirm, so we just apply
// the confirmed ids). `replace` clears every other champ's deck flag first.
export async function applyBgsDeck(ids: string[], replace: boolean) {
  const owner = await ownerId()
  if (replace) await prisma.mcocChampion.updateMany({ where: { ownerId: owner }, data: { bgsDeck: false } })
  if (ids.length) await prisma.mcocChampion.updateMany({ where: { id: { in: ids }, ownerId: owner }, data: { bgsDeck: true } })
}

// ── Personal counters ─────────────────────────────────────────────────────────
// Jordan's own counter picks per defender, stored on the Champion DB row in
// `myCounters` — a separate field from the AI-computed `counters`, so profile
// rebuilds ("Update meta") never touch them.

export async function addMyCounter(defenderName: string, counterName: string) {
  await ownerId() // gate only — the profile table is global
  const counter = cleanChampName(counterName)
  if (!counter) return { ok: false, error: "Name required" }
  const row = await prisma.mcocChampionProfile.findUnique({ where: { nameNorm: normChampName(defenderName) } })
  if (!row) return { ok: false, error: "Defender not in the Champion DB" }
  if (row.myCounters.some((c) => normChampName(c) === normChampName(counter))) return { ok: true }
  await prisma.mcocChampionProfile.update({
    where: { id: row.id },
    data: { myCounters: [...row.myCounters, counter].slice(0, 12) },
  })
  return { ok: true }
}

export async function removeMyCounter(defenderName: string, counterName: string) {
  await ownerId()
  const row = await prisma.mcocChampionProfile.findUnique({ where: { nameNorm: normChampName(defenderName) } })
  if (!row) return { ok: false, error: "Defender not in the Champion DB" }
  await prisma.mcocChampionProfile.update({
    where: { id: row.id },
    data: { myCounters: row.myCounters.filter((c) => normChampName(c) !== normChampName(counterName)) },
  })
  return { ok: true }
}
