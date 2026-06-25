"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { ANNOUNCEMENT_ID, ANNOUNCEMENT_LEVELS } from "@/lib/announcement-constants"

export async function setAnnouncement(input: { message: string; level: string; active: boolean }) {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") throw new Error("Unauthorised")

  const message = (input.message ?? "").trim().slice(0, 2000)
  const level = ANNOUNCEMENT_LEVELS.includes(input.level as any) ? input.level : "warning"
  // Can't publish an empty message.
  const active = !!input.active && message.length > 0
  const updatedByName = session.user.name ?? session.user.email ?? "Admin"

  await prisma.announcement.upsert({
    where:  { id: ANNOUNCEMENT_ID },
    update: { message, level, active, updatedByName },
    create: { id: ANNOUNCEMENT_ID, message, level, active, updatedByName },
  })
  revalidatePath("/admin/announcements")
}
