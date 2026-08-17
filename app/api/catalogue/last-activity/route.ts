import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { evaluateIdleGate } from "@/lib/idle-gate"

// GET /api/catalogue/last-activity — the wizard's idle check calls this when a
// new lot starts. It returns the SERVER's working-hours idle decision (computed
// from the server clock + the database's save times, in Europe/London), so the
// on-screen popup fires on server time and can NOT be silenced by changing the
// phone's clock or timezone. `lastMs`/`serverNow` still let the client reconcile
// its local heartbeat and fall back to a server-anchored clock when needed.
//
// ⚠⚠ ?event=lot-start ALSO STAMPS THE LOT-START MARKER. Only checkIdleOnLotStart may pass it
// — that call happens on the first keystroke of a new barcode, which is genuinely the moment
// the lot begins. The other caller (confirmIdleWithServer, used mid-lot and at save) must NOT,
// or the marker would creep forward all through the lot and erase the very gap it exists to
// measure. The time written is the SERVER's, never anything the device sent.
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    if (req.nextUrl.searchParams.get("event") === "lot-start") {
      try {
        const startedAt = new Date()
        await prisma.cataloguerLotStart.upsert({
          where:  { userId: session.user.id },
          create: { userId: session.user.id, startedAt },
          update: { startedAt },
        })
      } catch { /* table not migrated yet — the gate falls back to measuring to now */ }
    }

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
