import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { auctionId, idleStartedAt, idleDurationMs, reason, toteNumbers, notes } = await req.json()

    if (!auctionId || !idleStartedAt || !idleDurationMs || !reason) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const log = await prisma.idleLog.create({
      data: {
        userId:        session.user.id,
        userName:      session.user.name ?? session.user.email ?? "Unknown",
        auctionId,
        idleStartedAt: new Date(idleStartedAt),
        idleDurationMs,
        reason,
        toteNumbers:   toteNumbers || null,
        notes:         notes || null,
      },
    })

    return NextResponse.json({ id: log.id })
  } catch (e: any) {
    console.error("idle-log error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
