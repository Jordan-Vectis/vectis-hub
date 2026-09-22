import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { backupProgress, stopBackup } from "@/lib/backup-engine"

export const dynamic = "force-dynamic"

// POST /api/admin/backup/stop — asks the running backup to stop after the current page of rows.
// The tables already copied are kept and the manifest says it was stopped; the half-copied
// table is thrown away rather than left looking whole.
export async function POST() {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const stopping = stopBackup()
    return NextResponse.json({ ok: true, stopping, progress: backupProgress() })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
