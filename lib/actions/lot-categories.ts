"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

async function requireAdmin() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") throw new Error("Unauthorised")
}

function done() {
  revalidatePath("/admin/categories")
}

// ── Categories ───────────────────────────────────────────────────────────────
export async function addCategory(name: string) {
  await requireAdmin()
  const n = name.trim().slice(0, 80)
  if (!n) throw new Error("Name required")
  const existing = await prisma.lotCategory.findUnique({ where: { name: n } })
  if (existing) throw new Error("That category already exists")
  const max = await prisma.lotCategory.aggregate({ _max: { sortOrder: true } })
  await prisma.lotCategory.create({ data: { name: n, sortOrder: (max._max.sortOrder ?? -1) + 1 } })
  done()
}

export async function renameCategory(id: string, name: string) {
  await requireAdmin()
  const n = name.trim().slice(0, 80)
  if (!n) throw new Error("Name required")
  const clash = await prisma.lotCategory.findFirst({ where: { name: n, id: { not: id } } })
  if (clash) throw new Error("Another category already has that name")
  await prisma.lotCategory.update({ where: { id }, data: { name: n } })
  done()
}

export async function deleteCategory(id: string) {
  await requireAdmin()
  await prisma.lotCategory.delete({ where: { id } })   // cascades to subcategories
  done()
}

export async function moveCategory(id: string, dir: "up" | "down") {
  await requireAdmin()
  const cats = await prisma.lotCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, sortOrder: true } })
  const i = cats.findIndex((c) => c.id === id)
  const j = dir === "up" ? i - 1 : i + 1
  if (i < 0 || j < 0 || j >= cats.length) return
  await prisma.$transaction([
    prisma.lotCategory.update({ where: { id: cats[i].id }, data: { sortOrder: j } }),
    prisma.lotCategory.update({ where: { id: cats[j].id }, data: { sortOrder: i } }),
  ])
  // Normalise to be safe if sortOrders had ties.
  done()
}

// ── Subcategories ────────────────────────────────────────────────────────────
export async function addSubcategory(categoryId: string, name: string) {
  await requireAdmin()
  const n = name.trim().slice(0, 80)
  if (!n) throw new Error("Name required")
  const existing = await prisma.lotSubcategory.findFirst({ where: { categoryId, name: n } })
  if (existing) throw new Error("That subcategory already exists here")
  const max = await prisma.lotSubcategory.aggregate({ where: { categoryId }, _max: { sortOrder: true } })
  await prisma.lotSubcategory.create({ data: { categoryId, name: n, sortOrder: (max._max.sortOrder ?? -1) + 1 } })
  done()
}

export async function renameSubcategory(id: string, name: string) {
  await requireAdmin()
  const n = name.trim().slice(0, 80)
  if (!n) throw new Error("Name required")
  const sub = await prisma.lotSubcategory.findUnique({ where: { id }, select: { categoryId: true } })
  if (!sub) return
  const clash = await prisma.lotSubcategory.findFirst({ where: { categoryId: sub.categoryId, name: n, id: { not: id } } })
  if (clash) throw new Error("Another subcategory here already has that name")
  await prisma.lotSubcategory.update({ where: { id }, data: { name: n } })
  done()
}

export async function deleteSubcategory(id: string) {
  await requireAdmin()
  await prisma.lotSubcategory.delete({ where: { id } })
  done()
}

export async function moveSubcategory(id: string, dir: "up" | "down") {
  await requireAdmin()
  const sub = await prisma.lotSubcategory.findUnique({ where: { id }, select: { categoryId: true } })
  if (!sub) return
  const subs = await prisma.lotSubcategory.findMany({ where: { categoryId: sub.categoryId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true } })
  const i = subs.findIndex((s) => s.id === id)
  const j = dir === "up" ? i - 1 : i + 1
  if (i < 0 || j < 0 || j >= subs.length) return
  await prisma.$transaction([
    prisma.lotSubcategory.update({ where: { id: subs[i].id }, data: { sortOrder: j } }),
    prisma.lotSubcategory.update({ where: { id: subs[j].id }, data: { sortOrder: i } }),
  ])
  done()
}
