import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// PUT /api/admin/users/[id]/settings
// Updates individual user settings (showScanTimer, etc.)

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const { id } = await params
    const body = await req.json()

    const data: Record<string, unknown> = {}
    if (typeof body.showScanTimer === "boolean") data.showScanTimer = body.showScanTimer
    if (typeof body.timerYellowMins === "number") data.timerYellowMins = Math.max(1, body.timerYellowMins)
    if (typeof body.timerRedMins    === "number") data.timerRedMins    = Math.max(1, body.timerRedMins)

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No valid fields provided" }, { status: 400 })
    }

    await prisma.user.update({ where: { id }, data })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("user settings PUT error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
