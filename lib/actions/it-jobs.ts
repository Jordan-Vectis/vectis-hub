"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { syncITMailbox } from "@/lib/it-mailbox"
import { deleteObjectsFromR2, uploadBufferToR2 } from "@/lib/r2"
import sharp from "sharp"

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
  // Pull the R2 keys first; deleting the job cascades the attachment rows away.
  const atts = await prisma.iTJobAttachment.findMany({ where: { jobId: id }, select: { r2Key: true } })
  await prisma.iTJob.delete({ where: { id } })
  if (atts.length) {
    try { await deleteObjectsFromR2(atts.map((a) => a.r2Key)) }
    catch (e) { console.error("deleteITJob: R2 cleanup failed", e) }
  }
  revalidatePath("/tools/job-board")
}

export async function setITStaff(userId: string, value: boolean) {
  await requireAdmin()
  await prisma.user.update({ where: { id: userId }, data: { isITStaff: value } })
  revalidatePath("/tools/job-board")
}

// Spin up a realistic sample job for testing the rendering (HTML body, an inline
// signature logo via cid, two screenshot attachments, a [image.jpeg] placeholder
// and a forwarded section) — no email/Make round-trip needed.
export async function createTestITJob() {
  await requireAdmin()
  const stamp = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })

  // Plain-text forwarded email — exercises placeholder-stripping, the quoted/
  // forwarded split, and the parsed "From/Sent/Subject" header box.
  const body = [
    "Hi IT,",
    "My laptop won't connect to the WiFi this morning — see the screenshots attached.",
    "[image0.jpeg]",
    "Thanks,\nTest Customer",
    "From: someone@example.com\nSent: 12 June 2026 09:00\nTo: IT\nSubject: Original request",
    "This is the earlier forwarded message in the thread.",
  ].join("\n\n")

  const job = await prisma.iTJob.create({
    data: {
      title:      `🧪 TEST email — ${stamp}`,
      body,
      fromName:   "Test Customer",
      fromEmail:  "test.customer@example.com",
      status:     "NEW",
      source:     "EMAIL",
      receivedAt: new Date(),
    },
    select: { id: true },
  })

  // Two screenshot attachments (no Content-ID => shown as thumbnails).
  const colours = [{ r: 70, g: 110, b: 190 }, { r: 200, g: 95, b: 95 }]
  for (let i = 0; i < colours.length; i++) {
    const photo = await sharp({ create: { width: 800, height: 600, channels: 3, background: colours[i] } }).jpeg().toBuffer()
    const key = `it-jobs/${job.id}/test-photo-${i}.jpg`
    await uploadBufferToR2(photo, key, "image/jpeg")
    await prisma.iTJobAttachment.create({
      data: { jobId: job.id, filename: `screenshot-${i + 1}.jpg`, mimeType: "image/jpeg", size: photo.length, r2Key: key, contentId: null },
    })
  }

  revalidatePath("/tools/job-board")
}

export async function syncITMailboxNow() {
  await requireAdmin()
  const result = await syncITMailbox()
  revalidatePath("/tools/job-board")
  return result
}
