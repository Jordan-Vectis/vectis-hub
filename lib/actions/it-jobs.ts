"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { syncITMailbox } from "@/lib/it-mailbox"

const STATUSES = ["NEW", "IN_PROGRESS", "WAITING", "DONE"]

async function requireUser() {
  const session = await auth()
  if (!session) throw new Error("Unauthorised")
  return session
}

export async function createITJob(formData: FormData) {
  const session = await requireUser()
  const title = (formData.get("title") as string)?.trim()
  if (!title) throw new Error("Title required")

  await prisma.iTJob.create({
    data: {
      title,
      body:          (formData.get("body") as string)?.trim() || "",
      fromName:      (formData.get("fromName") as string)?.trim() || null,
      fromEmail:     (formData.get("fromEmail") as string)?.trim() || null,
      status:        "NEW",
      source:        "MANUAL",
      createdByName: session.user.name ?? session.user.email ?? null,
    },
  })
  revalidatePath("/tools/job-board")
}

export async function updateITJobStatus(id: string, status: string) {
  await requireUser()
  if (!STATUSES.includes(status)) throw new Error("Invalid status")
  await prisma.iTJob.update({ where: { id }, data: { status } })
  revalidatePath("/tools/job-board")
}

export async function deleteITJob(id: string) {
  await requireUser()
  await prisma.iTJob.delete({ where: { id } })
  revalidatePath("/tools/job-board")
}

export async function syncITMailboxNow() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") throw new Error("Unauthorised")
  const result = await syncITMailbox()
  revalidatePath("/tools/job-board")
  return result
}
