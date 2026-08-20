import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/auction-ai/upgrade-run?id=<queue item id>
// One overnight AI Upgrade run: the queue row plus every rewrite it produced,
// for the morning before/after review. Read-only — accepting goes through the
// acceptUpgradeLot server action so the write is logged like any other.

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const id = req.nextUrl.searchParams.get("id") ?? ""
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

    let item
    try {
      item = await prisma.pipelineQueueItem.findUnique({ where: { id } })
    } catch (e: any) {
      if (e?.code === "P2021" || e?.code === "P2022" || /does not exist in the current database/i.test(e?.message ?? "")) {
        return NextResponse.json({ notMigrated: true, item: null, lots: [] })
      }
      throw e
    }
    if (!item) return NextResponse.json({ item: null, lots: [] })

    const lots = await prisma.upgradeLot.findMany({
      where: { queueId: id },
      orderBy: { label: "asc" },
      select: { id: true, lotId: true, label: true, original: true, revised: true, status: true, accepted: true },
    })

    return NextResponse.json({
      item: {
        id: item.id, code: item.code, status: item.status, stage: item.stage,
        kind: (item as any).kind ?? "pipeline", upgradeModes: (item as any).upgradeModes ?? "",
        done: item.done, total: item.total, skipped: item.skipped,
        model: item.model, fallbackModel: item.fallbackModel,
        retryAfter:  item.retryAfter?.toISOString()  ?? null,
        startedAt:   item.startedAt?.toISOString()   ?? null,
        finishedAt:  item.finishedAt?.toISOString()  ?? null,
        lastMessage: item.lastMessage, logText: item.logText, addedBy: item.addedBy,
      },
      lots,
    })
  } catch (e: any) {
    console.error("auction-ai/upgrade-run error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
