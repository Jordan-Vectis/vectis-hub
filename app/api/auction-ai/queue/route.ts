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

    // The table arrives with the migrations, which are run by hand after the
    // deploy. Until then say so plainly — a raw Prisma error in the panel would
    // read as the queue being broken rather than not switched on yet.
    let items
    try {
      items = await prisma.pipelineQueueItem.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] })
    } catch (e: any) {
      if (e?.code === "P2021" || /does not exist in the current database/i.test(e?.message ?? "")) {
        return NextResponse.json({ runnerConfigured: false, notMigrated: true, items: [] })
      }
      throw e
    }

    // For AI Upgrade runs: how many rewrites exist, and how many are accepted —
    // that is what the morning check wants to know at a glance. Advisory only,
    // and the table arrives with the same migration batch as the kind column.
    const upgradeCounts: Record<string, { done: number; accepted: number }> = {}
    try {
      const ids = items.filter(i => (i as any).kind === "upgrade").map(i => i.id)
      if (ids.length > 0) {
        const rows = await prisma.upgradeLot.groupBy({
          by: ["queueId", "accepted"],
          where: { queueId: { in: ids }, status: "done" },
          _count: { _all: true },
        })
        for (const r of rows) {
          const c = upgradeCounts[r.queueId] ?? { done: 0, accepted: 0 }
          c.done += r._count._all
          if (r.accepted) c.accepted += r._count._all
          upgradeCounts[r.queueId] = c
        }
      }
    } catch { /* counts are a nicety — the list must not fail over them */ }

    return NextResponse.json({
      // Whether the background loop can actually run. Without CRON_SECRET the
      // queue would sit there filling up and never move, which must not look
      // like it's just being slow.
      runnerConfigured: !!process.env.CRON_SECRET,
      items: items.map((i) => ({
        id: i.id, code: i.code, position: i.position, status: i.status, stage: i.stage,
        done: i.done, total: i.total, skipped: i.skipped,
        kind: (i as any).kind ?? "pipeline", upgradeModes: (i as any).upgradeModes ?? "",
        preset: i.preset, model: i.model, fallbackModel: i.fallbackModel,
        grounded: i.grounded, autoApply: i.autoApply, onlyWithPhotos: i.onlyWithPhotos,
        skipHasDesc: i.skipHasDesc, kpRelaxed: i.kpRelaxed, fastMode: i.fastMode,
        retryAfter:  i.retryAfter?.toISOString()  ?? null,
        startedAt:   i.startedAt?.toISOString()   ?? null,
        finishedAt:  i.finishedAt?.toISOString()  ?? null,
        heartbeatAt: i.heartbeatAt?.toISOString() ?? null,
        lastMessage: i.lastMessage, logText: i.logText, addedBy: i.addedBy,
        upgradeDone:     upgradeCounts[i.id]?.done     ?? 0,
        upgradeAccepted: upgradeCounts[i.id]?.accepted ?? 0,
      })),
    })
  } catch (e: any) {
    console.error("auction-ai/queue error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
