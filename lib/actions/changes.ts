"use server"

// Saved reports behind Admin → Patches & Changes.
// ⚠ Actions RETURN their errors (RULES: a thrown server action is redacted in a
// production build, so the user would see boilerplate instead of the reason).

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

const PATH = "/admin/changes"

export type ChangeResult = { ok: boolean; error?: string; id?: string }

async function requireAdmin() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") throw new Error("Unauthorised")
  return session
}

export async function saveChangeReport(input: {
  id?: string
  title: string
  body: string
  from: string
  to: string
  changeCount?: number
  model?: string
}): Promise<ChangeResult> {
  try {
    const session = await requireAdmin()
    const title = input.title.trim().slice(0, 200)
    const body  = input.body.trim()
    if (!title) return { ok: false, error: "Give the report a title." }
    if (!body)  return { ok: false, error: "The report is empty — generate or write it first." }

    const from = new Date(input.from)
    const to   = new Date(input.to)
    if (isNaN(from.getTime()) || isNaN(to.getTime())) return { ok: false, error: "That period isn't valid." }

    if (input.id) {
      await prisma.changeReport.update({ where: { id: input.id }, data: { title, body } })
      revalidatePath(PATH)
      return { ok: true, id: input.id }
    }

    const row = await prisma.changeReport.create({
      data: {
        title, body,
        periodFrom: from, periodTo: to,
        changeCount: input.changeCount ?? 0,
        model: input.model?.slice(0, 80) ?? null,
        createdBy: session.user.name ?? session.user.email ?? null,
      },
    })
    revalidatePath(PATH)
    return { ok: true, id: row.id }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not save the report" }
  }
}

export async function deleteChangeReport(id: string): Promise<ChangeResult> {
  try {
    await requireAdmin()
    await prisma.changeReport.delete({ where: { id } })
    revalidatePath(PATH)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not delete the report" }
  }
}
