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
async function requireAdmin() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") throw new Error("Unauthorised")
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

export async function assignITJob(id: string, userId: string | null) {
  await requireUser()
  let assignedToId: string | null = null
  let assignedToName: string | null = null
  if (userId) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } })
    if (u) { assignedToId = u.id; assignedToName = u.name }
  }
  await prisma.iTJob.update({ where: { id }, data: { assignedToId, assignedToName } })
  revalidatePath("/tools/job-board")
}

export async function addITJobNote(jobId: string, body: string) {
  const session = await requireUser()
  const text = body?.trim()
  if (!text) throw new Error("Empty note")
  await prisma.iTJobMessage.create({
    data: {
      jobId,
      kind:       "NOTE",
      authorName: session.user.name ?? session.user.email ?? "Unknown",
      body:       text,
    },
  })
  await prisma.iTJob.update({ where: { id: jobId }, data: { updatedAt: new Date() } })
  revalidatePath("/tools/job-board")
}

export async function setITJobDueDate(id: string, dueDate: string | null) {
  await requireUser()
  // dueDate arrives as a "YYYY-MM-DD" string from the date input (or null to clear).
  // Stored at midnight UTC so the date-only comparison on the board stays stable.
  let value: Date | null = null
  if (dueDate) {
    const d = new Date(`${dueDate}T00:00:00.000Z`)
    if (isNaN(d.getTime())) throw new Error("Invalid date")
    value = d
  }
  await prisma.iTJob.update({ where: { id }, data: { dueDate: value } })
  revalidatePath("/tools/job-board")
}

export async function clearITJobReplyFlag(id: string) {
  await requireUser()
  await prisma.iTJob.update({ where: { id }, data: { hasNewReply: false } })
  revalidatePath("/tools/job-board")
}

export async function deleteITJob(id: string) {
  await requireUser()
  await prisma.iTJob.delete({ where: { id } })
  revalidatePath("/tools/job-board")
}

export async function setITStaff(userId: string, value: boolean) {
  await requireAdmin()
  await prisma.user.update({ where: { id: userId }, data: { isITStaff: value } })
  revalidatePath("/tools/job-board")
}

export async function syncITMailboxNow() {
  await requireAdmin()
  const result = await syncITMailbox()
  revalidatePath("/tools/job-board")
  return result
}
