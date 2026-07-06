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
