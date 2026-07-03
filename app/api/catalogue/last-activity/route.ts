import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/catalogue/last-activity — when did the CURRENT user last do something
// in cataloguing, on ANY device? (latest lot save from CatalogueTimingLog, or
// latest answered idle prompt from IdleLog). The lot wizard's idle check calls
// this before showing the idle popup, so a save made on the desktop stops the
// iPad accusing the same person of hours of idle (localStorage heartbeats are
// per-device and can be stale).
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const [lastSave, lastIdle] = await Promise.all([
      prisma.catalogueTimingLog.findFirst({
        where: { userId: session.user.id },
        orderBy: { savedAt: "desc" },
        select: { savedAt: true },
      }),
      prisma.idleLog.findFirst({
        where: { userId: session.user.id },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ])

    const lastMs = Math.max(lastSave?.savedAt.getTime() ?? 0, lastIdle?.createdAt.getTime() ?? 0)
    return NextResponse.json({ lastMs })
  } catch (e: any) {
    console.error("catalogue/last-activity error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
