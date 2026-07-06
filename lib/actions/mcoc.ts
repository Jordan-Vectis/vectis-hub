"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { cleanChampName, normaliseClass } from "@/lib/mcoc"

// Server actions for the MCOC roster (secret menu). All jordan-only. Rows are
// keyed to Jordan's user id; a champ can exist at 6* and 7* separately.

async function ownerId(): Promise<string> {
  const session = await auth()
  if (!session || !(await isJordan())) throw new Error("Unauthorised")
  return session.user.id
}

const clampStars = (n: unknown) => (Number(n) === 6 ? 6 : 7)
const clampRank = (n: unknown) => Math.min(5, Math.max(1, Math.round(Number(n) || 1)))

export type ChampInput = { name: string; class?: string; stars?: number; rank?: number; bgsDeck?: boolean }

// Bulk add/update (upsert by name+stars). Used by the photo-scan confirm step
// and manual add. Returns how many were added vs updated.
export async function addChampions(list: ChampInput[]) {
  const owner = await ownerId()
  let added = 0, updated = 0
  for (const c of list) {
    const name = cleanChampName(c.name)
    if (!name) continue
    const stars = clampStars(c.stars)
    const rank = clampRank(c.rank)
    const cls = normaliseClass(c.class ?? "")
    const existing = await prisma.mcocChampion.findUnique({ where: { ownerId_name_stars: { ownerId: owner, name, stars } } })
    if (existing) {
      await prisma.mcocChampion.update({
        where: { id: existing.id },
        data: { rank, ...(cls ? { class: cls } : {}), ...(c.bgsDeck !== undefined ? { bgsDeck: c.bgsDeck } : {}) },
      })
      updated++
    } else {
      await prisma.mcocChampion.create({
        data: { ownerId: owner, name, class: cls, stars, rank, bgsDeck: c.bgsDeck === true },
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

// Match a list of champion names (read from a BGS-deck screenshot) against the
// roster and flag the matches as bgsDeck. `replace` clears the current deck
// first (so re-uploading a deck photo just updates it). Returns how many
// roster champs were flagged and which scanned names weren't found in the
// roster (so the UI can tell Jordan to add those first).
const normName = (s: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
export async function setBgsDeckByNames(names: string[], replace: boolean) {
  const owner = await ownerId()
  const roster = await prisma.mcocChampion.findMany({ where: { ownerId: owner }, select: { id: true, name: true } })
  const wants = names.map(normName).filter(Boolean)
  const rosterNorms = roster.map((c) => normName(c.name))
  const hits = (rn: string) => wants.some((w) => w === rn || rn.includes(w) || w.includes(rn))

  const matchedIds = roster.filter((c) => hits(normName(c.name))).map((c) => c.id)
  if (replace) await prisma.mcocChampion.updateMany({ where: { ownerId: owner }, data: { bgsDeck: false } })
  if (matchedIds.length) await prisma.mcocChampion.updateMany({ where: { id: { in: matchedIds }, ownerId: owner }, data: { bgsDeck: true } })

  const unmatched = names.filter((nm) => {
    const w = normName(nm)
    return w && !rosterNorms.some((rn) => rn === w || rn.includes(w) || w.includes(rn))
  })
  return { matched: matchedIds.length, unmatched }
}
