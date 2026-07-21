import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { evaluateIdleGate } from "@/lib/idle-gate"

// GET /api/catalogue/last-activity — the wizard's idle check calls this when a
// new lot starts. It returns the SERVER's working-hours idle decision (computed
// from the server clock + the database's save times, in Europe/London), so the
// on-screen popup fires on server time and can NOT be silenced by changing the
// phone's clock or timezone. `lastMs`/`serverNow` still let the client reconcile
// its local heartbeat and fall back to a server-anchored clock when needed.
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const [lastIdle, gate] = await Promise.all([
      prisma.idleLog.findFirst({
        where: { userId: session.user.id },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      evaluateIdleGate(session.user.id),
    ])

    const lastSaveMs = gate.since?.getTime() ?? 0
    const lastMs = Math.max(lastSaveMs, lastIdle?.createdAt.getTime() ?? 0)
    return NextResponse.json({
      lastMs,
      serverNow:    gate.nowMs,
      idleMs:       gate.idleMs,
      sinceMs:      lastSaveMs,
      shouldPrompt: gate.blocked,   // true only when the server would block the save
      thresholdMs:  gate.thresholdMs,
    })
  } catch (e: any) {
    console.error("catalogue/last-activity error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
