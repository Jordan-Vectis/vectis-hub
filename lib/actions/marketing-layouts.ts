"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { SECTION_CATALOG } from "@/lib/ga"

async function requireAdmin() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") throw new Error("Unauthorised")
  return session
}

// Keep only valid catalog section ids, preserving order and dropping duplicates.
function cleanSections(sections: string[]): string[] {
  const valid = new Set(SECTION_CATALOG.map((s) => s.id))
  const seen = new Set<string>()
  return sections.filter((s) => valid.has(s) && !seen.has(s) && (seen.add(s), true))
}

export async function createMarketingLayout(name: string, sections: string[]) {
  await requireAdmin()
  const trimmed = name.trim()
  if (!trimmed) throw new Error("Name required")
  const count = await prisma.marketingLayout.count()
  const layout = await prisma.marketingLayout.create({
    data: { name: trimmed.slice(0, 80), sections: cleanSections(sections), isDefault: count === 0 },
  })
  revalidatePath("/tools/marketing-reports")
  return { id: layout.id }
}

export async function updateMarketingLayout(id: string, name: string, sections: string[]) {
  await requireAdmin()
  const trimmed = name.trim()
  if (!trimmed) throw new Error("Name required")
  await prisma.marketingLayout.update({
    where: { id },
    data: { name: trimmed.slice(0, 80), sections: cleanSections(sections) },
  })
  revalidatePath("/tools/marketing-reports")
}

export async function deleteMarketingLayout(id: string) {
  await requireAdmin()
  await prisma.marketingLayout.delete({ where: { id } })
  revalidatePath("/tools/marketing-reports")
}

export async function setDefaultMarketingLayout(id: string) {
  await requireAdmin()
  await prisma.$transaction([
    prisma.marketingLayout.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
    prisma.marketingLayout.update({ where: { id }, data: { isDefault: true } }),
  ])
  revalidatePath("/tools/marketing-reports")
}
