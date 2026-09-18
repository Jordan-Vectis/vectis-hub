import { NextRequest, NextResponse } from "next/server"
import { startQueueSlice } from "@/lib/pipeline-runner"

// POST /api/cron/pipeline-queue
// Called every 30 s by server.js. Starts a slice of the Auto Pipeline queue (about nine minutes of
// work) if one isn't already running, and ANSWERS AT ONCE — the slice carries on in the
// background and logs its own outcome.
//
// ⚠⚠ Do not go back to awaiting the slice here (changed 2026-09-18). A nine-minute wait over
// server.js's localhost fetch hit Node's 300 s headers timeout on every slice — a "fetch failed"
// line each time, ~48 in one night, reading like an outage — and the give-up released the tick
// guard while the slice ran on, which is how a second slice could start on the same sale. The
// guard that matters now is the in-process lock in lib/pipeline-runner.ts (startQueueSlice).

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
  }
  try {
    return NextResponse.json(startQueueSlice())
  } catch (e: any) {
    console.error("cron/pipeline-queue error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
