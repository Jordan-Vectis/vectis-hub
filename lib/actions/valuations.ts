"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { SubmissionStatus } from "@/app/generated/prisma/enums"

export async function saveValuation(
  itemId: string,
  submissionId: string,
  estimatedValue: number,
  comments: string
) {
  const session = await auth()
  if (!session) throw new Error("Unauthorised")

  await prisma.valuation.upsert({
    where: { itemId },
    create: {
      itemId,
      estimatedValue,
      comments: comments || null,
      cataloguerId: session.user.id,
    },
    update: {
      estimatedValue,
      comments: comments || null,
    },
  })

  // Check if all items in the submission have valuations
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { items: { include: { valuation: true } } },
  })

  if (submission) {
    const allValued = submission.items.every((item) => item.valuation !== null)
    if (allValued) {
      await prisma.submission.update({
        where: { id: submissionId },
        data: { status: SubmissionStatus.VALUATION_COMPLETE },
      })
    }
  }

  revalidatePath(`/submissions/${submissionId}`)
}
