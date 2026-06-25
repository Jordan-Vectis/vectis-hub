import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { ANNOUNCEMENT_ID } from "@/lib/announcement-constants"

export const dynamic = "force-dynamic"

// The current app-wide announcement, or null when none is active. Read by the banner in
// the app layout (any signed-in user). Inactive content is never returned.
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ announcement: null })
    const a = await prisma.announcement.findUnique({ where: { id: ANNOUNCEMENT_ID } })
    if (!a || !a.active || !a.message.trim()) return NextResponse.json({ announcement: null })
    return NextResponse.json({
      announcement: { message: a.message, level: a.level, updatedAt: a.updatedAt.toISOString() },
    })
  } catch (e: any) {
    console.error("announcement GET error:", e)
    return NextResponse.json({ announcement: null })
  }
}
