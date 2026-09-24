import { NextRequest } from "next/server"
import { backupProgress, startBackup } from "@/lib/backup-engine"

export const dynamic = "force-dynamic"

// GET /api/cron/db-backup — starts the nightly copy of EVERY table (lib/backup-engine.ts), called
// by server.js at midnight UTC with the CRON_SECRET, and answers at once.
//
// ⚠ Started, NOT awaited (2026-09-23). Node's fetch gives up waiting for a reply after 300 s, so
// awaiting a run of several minutes meant server.js logged "fetch failed" every night while the
// run carried on regardless — the log lied and the outcome was never written down. Now the job
// logs a line per table and its own summary, the page and the Status Centre read its state, and
// this route only says whether it started.
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization")
    if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json({ error: "Unauthorised" }, { status: 401 })
    }
    const r = startBackup({ by: "nightly", scope: "all" })
    if (!r.started) return Response.json({ started: false, error: r.reason }, { status: 409 })
    return Response.json({ started: true, progress: backupProgress() }, { status: 202 })
  } catch (e: any) {
    console.error("[cron/db-backup] error:", e)
    return Response.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
