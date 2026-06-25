"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { syncConditionMailbox } from "@/lib/condition-mailbox"

const STATUSES = ["NEW", "IN_PROGRESS", "DONE"]
const PATH = "/tools/condition-reports"

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

// Create a condition report by hand (e.g. a phoned-in request).
export async function createConditionReport(formData: FormData) {
  const session = await requireUser()
  const subject = (formData.get("subject") as string)?.trim()
  if (!subject) throw new Error("Subject required")

  const auctionId = (formData.get("auctionId") as string)?.trim() || null
  let auctionDate: Date | null = null
  let auctionLabel: string | null = (formData.get("auctionLabel") as string)?.trim() || null

  // If linked to a real auction, pull its date/name so grouping stays consistent.
  if (auctionId) {
    const a = await prisma.catalogueAuction.findUnique({ where: { id: auctionId }, select: { auctionDate: true, name: true } })
    if (a) { auctionDate = a.auctionDate; auctionLabel = auctionLabel ?? a.name }
  }

  await prisma.conditionReport.create({
    data: {
      subject,
      body:          (formData.get("body") as string)?.trim() || "",
      fromName:      (formData.get("fromName") as string)?.trim() || null,
      fromEmail:     (formData.get("fromEmail") as string)?.trim() || null,
      lotNumber:     (formData.get("lotNumber") as string)?.trim() || null,
      auctionId,
      auctionLabel,
      auctionDate,
      status:        "NEW",
      source:        "MANUAL",
      createdByName: session.user.name ?? session.user.email ?? null,
    },
  })
  revalidatePath(PATH)
}

export async function updateConditionReportStatus(id: string, status: string) {
  await requireUser()
  if (!STATUSES.includes(status)) throw new Error("Invalid status")
  await prisma.conditionReport.update({ where: { id }, data: { status } })
  revalidatePath(PATH)
}

// Tick / un-tick a report as done.
export async function setConditionReportDone(id: string, done: boolean) {
  await requireUser()
  await prisma.conditionReport.update({ where: { id }, data: { status: done ? "DONE" : "NEW" } })
  revalidatePath(PATH)
}

export async function assignConditionReport(id: string, userId: string | null) {
  await requireUser()
  let assignedToId: string | null = null
  let assignedToName: string | null = null
  if (userId) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } })
    if (u) { assignedToId = u.id; assignedToName = u.name }
  }
  await prisma.conditionReport.update({ where: { id }, data: { assignedToId, assignedToName } })
  revalidatePath(PATH)
}

// Edit the captured details: lot number, linked auction and sale date.
export async function updateConditionReportDetails(
  id: string,
  details: { lotNumber?: string | null; auctionId?: string | null; auctionDate?: string | null },
) {
  await requireUser()

  const data: { lotNumber?: string | null; auctionId?: string | null; auctionLabel?: string | null; auctionDate?: Date | null } = {}

  if (details.lotNumber !== undefined) {
    data.lotNumber = details.lotNumber?.trim() || null
  }

  if (details.auctionId !== undefined) {
    const auctionId = details.auctionId?.trim() || null
    data.auctionId = auctionId
    if (auctionId) {
      // Linking to a real auction sets the label + date from that auction.
      const a = await prisma.catalogueAuction.findUnique({ where: { id: auctionId }, select: { name: true, auctionDate: true } })
      if (a) { data.auctionLabel = a.name; data.auctionDate = a.auctionDate }
    }
  }

  // An explicit date overrides (e.g. when there is no linked auction).
  if (details.auctionDate !== undefined) {
    const d = details.auctionDate?.trim()
    if (d) {
      const parsed = new Date(`${d}T00:00:00.000Z`)
      if (isNaN(parsed.getTime())) throw new Error("Invalid date")
      data.auctionDate = parsed
    } else {
      data.auctionDate = null
    }
  }

  await prisma.conditionReport.update({ where: { id }, data })
  revalidatePath(PATH)
}

export async function deleteConditionReport(id: string) {
  await requireUser()
  await prisma.conditionReport.delete({ where: { id } })
  revalidatePath(PATH)
}

export async function syncConditionMailboxNow() {
  await requireAdmin()
  const result = await syncConditionMailbox()
  revalidatePath(PATH)
  return result
}
