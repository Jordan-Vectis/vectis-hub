import { NextRequest, NextResponse } from "next/server"
import { runQueueSlice } from "@/lib/pipeline-runner"

// POST /api/cron/pipeline-queue
// Called on a timer by server.js. Works the Auto Pipeline queue for one slice
// (about nine minutes) and hands back — the next tick carries straight on from
// where this one stopped, because all the progress is in the database.
//
// A tick is a no-op when a slice is already in flight (the runner checks the
// heartbeat), so overlapping timers can't double-run a sale.

export const maxDuration = 800

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
  }
  try {
    const result = await runQueueSlice()
    return NextResponse.json(result)
  } catch (e: any) {
    console.error("cron/pipeline-queue error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
