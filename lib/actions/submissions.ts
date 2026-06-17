"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { SubmissionChannel, SubmissionStatus } from "@/app/generated/prisma/enums"

async function findOrCreateContact(name: string, email: string | null, phone: string | null) {
  // Try to find by email first, then by name
  let contact = email
    ? await prisma.contact.findFirst({ where: { email } })
    : await prisma.contact.findFirst({ where: { name } })

  if (!contact) {
    const contacts = await prisma.contact.findMany({ select: { id: true } })
    let maxNum = 0
    for (const c of contacts) {
      const num = parseInt(c.id.replace(/^\D+/, ""), 10)
      if (!isNaN(num) && num > maxNum) maxNum = num
    }
    const id = `c${String(maxNum + 1).padStart(5, "0")}`
    contact = await prisma.contact.create({
      data: { id, name, email: email || null, phone: phone || null },
    })
  }

  return contact
}

export async function createSubmission(formData: FormData) {
  const session = await auth()
  if (!session) throw new Error("Unauthorised")

  const customerName = formData.get("customerName") as string
  const customerEmail = formData.get("customerEmail") as string | null
  const customerPhone = formData.get("customerPhone") as string | null
  const channel = formData.get("channel") as SubmissionChannel
  const notes = formData.get("notes") as string | null
  const itemNames = formData.getAll("itemName") as string[]
  const itemDescriptions = formData.getAll("itemDescription") as string[]

  const contact = await findOrCreateContact(customerName, customerEmail, customerPhone)

  const submission = await prisma.submission.create({
    data: {
      channel,
      notes: notes || null,
      contactId: contact.id,
      createdById: session.user.id,
      items: {
        create: itemNames.map((name, i) => ({
          name,
          description: itemDescriptions[i] || null,
          imageUrls: formData.getAll(`item_${i}_imageKey`) as string[],
        })),
      },
    },
  })

  revalidatePath("/submissions")
  return { id: submission.id }
}

export async function setValuationSentTo(submissionId: string, name: string) {
  const session = await auth()
  if (!session) throw new Error("Unauthorised")

  await prisma.submission.update({
    where: { id: submissionId },
    data:  { valuationSentTo: name || null },
  })
  revalidatePath(`/submissions/${submissionId}`)
}

export async function setNeedsFollowUp(submissionId: string, value: boolean) {
  const session = await auth()
  if (!session) throw new Error("Unauthorised")

  await prisma.submission.update({
    where: { id: submissionId },
    data:  { needsFollowUp: value },
  })
  revalidatePath(`/submissions/${submissionId}`)
  revalidatePath("/follow-ups")
}

export async function generateValuationToken(submissionId: string) {
  const session = await auth()
  if (!session) throw new Error("Unauthorised")

  const token = crypto.randomUUID().replace(/-/g, "")
  await prisma.submission.update({
    where: { id: submissionId },
    data:  { valuationToken: token },
  })
  revalidatePath(`/submissions/${submissionId}`)
  return { token }
}

export async function generatePhotoUploadToken(submissionId: string) {
  const session = await auth()
  if (!session) throw new Error("Unauthorised")

  const token = crypto.randomUUID().replace(/-/g, "")
  await prisma.submission.update({
    where: { id: submissionId },
    data:  { photoUploadToken: token },
  })
  revalidatePath(`/submissions/${submissionId}`)
  return { token }
}

export async function logContact(
  submissionId: string,
  method: string,
  notes: string,
  outcome: string,
  isFollowUp: boolean = false
) {
  const session = await auth()
  if (!session) throw new Error("Unauthorised")

  await prisma.contactLog.create({
    data: {
      submissionId,
      method,
      notes,
      outcome,
      isFollowUp,
      userId: session.user.id,
    },
  })

  let newStatus: SubmissionStatus | undefined
  if (outcome === "approved") newStatus = SubmissionStatus.APPROVED
  else if (outcome === "declined") newStatus = SubmissionStatus.DECLINED
  else if (outcome === "follow_up") newStatus = SubmissionStatus.FOLLOW_UP

  if (newStatus) {
    await prisma.submission.update({
      where: { id: submissionId },
      data: { status: newStatus },
    })
  }

  if (isFollowUp) {
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        followUpCount: { increment: 1 },
        lastFollowUpAt: new Date(),
      },
    })
  }

  revalidatePath(`/submissions/${submissionId}`)
  revalidatePath("/follow-ups")
}

export async function sendFollowUp(submissionId: string) {
  const session = await auth()
  if (!session) throw new Error("Unauthorised")

  await prisma.submission.update({
    where: { id: submissionId },
    data: {
      followUpCount: { increment: 1 },
      lastFollowUpAt: new Date(),
    },
  })

  await prisma.contactLog.create({
    data: {
      submissionId,
      method: "email",
      notes: "Follow-up email sent",
      outcome: "follow_up",
      isFollowUp: true,
      userId: session.user.id,
    },
  })

  revalidatePath("/follow-ups")
  revalidatePath(`/submissions/${submissionId}`)
}

export async function updateSubmissionStatus(
  submissionId: string,
  status: SubmissionStatus
) {
  const session = await auth()
  if (!session) throw new Error("Unauthorised")

  await prisma.submission.update({
    where: { id: submissionId },
    data: { status },
  })

  revalidatePath(`/submissions/${submissionId}`)
  revalidatePath("/submissions")
}

export async function deleteSubmission(submissionId: string) {
  const session = await auth()
  if (!session) throw new Error("Unauthorised")
  if (session.user.role !== "ADMIN" && session.user.role !== "COLLECTIONS") {
    throw new Error("Unauthorised")
  }

  await prisma.submission.delete({ where: { id: submissionId } })

  revalidatePath("/submissions")
}
