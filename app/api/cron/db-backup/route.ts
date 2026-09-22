import { NextRequest } from "next/server"
import { runBackupJob } from "@/lib/backup-engine"

export const maxDuration = 300
export const dynamic = "force-dynamic"

// GET /api/cron/db-backup — the nightly copy of EVERY table (lib/backup-engine.ts), called by
// server.js at midnight UTC with the CRON_SECRET. Awaited: this is a localhost call with no
// proxy in the way, so a run of several minutes is fine here. The manual button on
// /admin/backup starts the same job and polls it instead.
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization")
    if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json({ error: "Unauthorised" }, { status: 401 })
    }
    const m = await runBackupJob({ by: "nightly", scope: "all" })
    return Response.json({
      ok: m.complete, folder: `${m.env}/`, totalBytes: m.totalBytes, totalRows: m.totalRows,
      tables: m.tables.filter(t => t.ok).length, requested: m.requested, failed: m.failed, stopped: m.stopped, durationMs: m.durationMs,
    })
  } catch (e: any) {
    console.error("[cron/db-backup] error:", e)
    const busy = /already running/i.test(String(e?.message))
    return Response.json({ error: e?.message ?? "Unknown error" }, { status: busy ? 409 : 500 })
  }
}
