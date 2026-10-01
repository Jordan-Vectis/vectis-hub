import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { workerPresence, LOCAL_AI_ONLINE_MS } from "@/lib/local-ai"

// Is the office PC there? (lib/local-ai.ts) For the Instructions Testing tab's status pill.
// Says "database update waiting" rather than 500 when the tables are not there yet.
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    let worker: { id: string; name: string; lastSeenAt: Date | null; lastModel: string | null; lastInfo: string | null } | null = null
    let queued = 0, running = 0
    try {
      worker = await prisma.localAiWorker.findFirst({
        where: { disabledAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, lastSeenAt: true, lastModel: true, lastInfo: true },
      })
      const counts = await prisma.localAiJob.groupBy({ by: ["status"], _count: { _all: true }, where: { status: { in: ["QUEUED", "RUNNING"] } } })
      for (const c of counts) {
        if (c.status === "QUEUED")  queued  = c._count._all
        if (c.status === "RUNNING") running = c._count._all
      }
    } catch (e: any) {
      // P2021 = the table does not exist yet — the amber banner on /admin applies it.
      if (e?.code === "P2021" || /does not exist/i.test(String(e?.message))) {
        return NextResponse.json({ ready: false, reason: "database update waiting" })
      }
      throw e
    }

    return NextResponse.json({
      ready: true,
      hasToken: !!worker,
      presence: worker ? workerPresence(worker.lastSeenAt) : "never",
      onlineWindowMs: LOCAL_AI_ONLINE_MS,
      worker: worker ? { name: worker.name, lastSeenAt: worker.lastSeenAt, model: worker.lastModel, info: worker.lastInfo } : null,
      queued,
      running,
    })
  } catch (e: any) {
    console.error("local-ai/status GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
