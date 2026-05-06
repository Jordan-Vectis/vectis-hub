import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/warehouse/sync/status
// Returns the last completed sync time for each source plus total item count.
export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const sources = ["receipt_lines", "auction_lines", "changelog", "totes", "totes-active"] as const

  const [logs, itemCount, toteCount] = await Promise.all([
    Promise.all(
      sources.map(source =>
        prisma.warehouseSyncLog.findFirst({
          where: { source, status: "complete" },
          orderBy: { completedAt: "desc" },
        })
      )
    ),
    prisma.warehouseItem.count(),
    prisma.warehouseTote.count(),
  ])

  const running = await prisma.warehouseSyncLog.findMany({
    where: { status: "running" },
    select: { source: true, startedAt: true },
  })

  return NextResponse.json({
    itemCount,
    toteCount,
    running: running.map(r => r.source),
    sources: Object.fromEntries(
      sources.map((source, i) => [
        source,
        logs[i]
          ? { completedAt: logs[i]!.completedAt, itemsProcessed: logs[i]!.itemsProcessed }
          : null,
      ])
    ),
  })
}
