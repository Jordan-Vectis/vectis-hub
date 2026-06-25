"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

async function requireAdmin() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") throw new Error("Unauthorised")
}

function done() {
  revalidatePath("/admin/condition-wording")
}

export async function addWording(label: string) {
  await requireAdmin()
  const l = label.trim().slice(0, 60)
  if (!l) throw new Error("Wording required")
  const existing = await prisma.conditionWording.findUnique({ where: { label: l } })
  if (existing) throw new Error("That wording already exists")
  const max = await prisma.conditionWording.aggregate({ _max: { sortOrder: true } })
  await prisma.conditionWording.create({ data: { label: l, sortOrder: (max._max.sortOrder ?? -1) + 1 } })
  done()
}

export async function renameWording(id: string, label: string) {
  await requireAdmin()
  const l = label.trim().slice(0, 60)
  if (!l) throw new Error("Wording required")
  const clash = await prisma.conditionWording.findFirst({ where: { label: l, id: { not: id } } })
  if (clash) throw new Error("Another wording already has that text")
  await prisma.conditionWording.update({ where: { id }, data: { label: l } })
  done()
}

export async function deleteWording(id: string) {
  await requireAdmin()
  await prisma.conditionWording.delete({ where: { id } })
  done()
}

export async function moveWording(id: string, dir: "up" | "down") {
  await requireAdmin()
  const rows = await prisma.conditionWording.findMany({ orderBy: [{ sortOrder: "asc" }, { label: "asc" }], select: { id: true } })
  const i = rows.findIndex((r) => r.id === id)
  const j = dir === "up" ? i - 1 : i + 1
  if (i < 0 || j < 0 || j >= rows.length) return
  await prisma.$transaction([
    prisma.conditionWording.update({ where: { id: rows[i].id }, data: { sortOrder: j } }),
    prisma.conditionWording.update({ where: { id: rows[j].id }, data: { sortOrder: i } }),
  ])
  done()
}
