import { prisma } from "@/lib/prisma"
import { ANNOUNCEMENT_ID } from "@/lib/announcement-constants"

// Server-only read of the singleton announcement row. Imported by the admin page
// (server component) and the read API — never by client components.
export async function readAnnouncement() {
  return prisma.announcement.findUnique({ where: { id: ANNOUNCEMENT_ID } })
}
