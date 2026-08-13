import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/auction-ai/queue
// The Auto Pipeline queue, in running order. Polled by the queue panel so the
// morning check is just "open the tab" — the work itself happens on the server.

export async function GET(_req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const items = await prisma.pipelineQueueItem.findMany({
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    })

    return NextResponse.json({
      // Whether the background loop can actually run. Without CRON_SECRET the
      // queue would sit there filling up and never move, which must not look
      // like it's just being slow.
      runnerConfigured: !!process.env.CRON_SECRET,
      items: items.map((i) => ({
        id: i.id, code: i.code, position: i.position, status: i.status, stage: i.stage,
        done: i.done, total: i.total, skipped: i.skipped,
        preset: i.preset, model: i.model, fallbackModel: i.fallbackModel,
        grounded: i.grounded, autoApply: i.autoApply, onlyWithPhotos: i.onlyWithPhotos,
        skipHasDesc: i.skipHasDesc, kpRelaxed: i.kpRelaxed,
        retryAfter:  i.retryAfter?.toISOString()  ?? null,
        startedAt:   i.startedAt?.toISOString()   ?? null,
        finishedAt:  i.finishedAt?.toISOString()  ?? null,
        heartbeatAt: i.heartbeatAt?.toISOString() ?? null,
        lastMessage: i.lastMessage, logText: i.logText, addedBy: i.addedBy,
      })),
    })
  } catch (e: any) {
    console.error("auction-ai/queue error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
