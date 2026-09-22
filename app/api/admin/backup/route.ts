import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { backupProgress, deleteBackup, listBackups, startBackup, type BackupScope } from "@/lib/backup-engine"

export const dynamic = "force-dynamic"

async function admin() {
  const session = await auth()
  return session && session.user.role === "ADMIN" ? session : null
}

// GET /api/admin/backup — every backup in this environment's folder, newest first, plus the
// state of any run in progress.
export async function GET() {
  try {
    if (!(await admin())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    return NextResponse.json({ entries: await listBackups(), progress: backupProgress() })
  } catch (e: any) {
    console.error("[admin/backup] GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

// DELETE /api/admin/backup  { key } — one backup: a folder (every file in it) or an old single file.
export async function DELETE(req: NextRequest) {
  try {
    if (!(await admin())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const { key } = await req.json().catch(() => ({})) as { key?: unknown }
    if (!key || typeof key !== "string") return NextResponse.json({ error: "Say which backup." }, { status: 400 })
    await deleteBackup(key)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("[admin/backup] DELETE error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

// POST /api/admin/backup  { scope: "all" | "quick" | string[] } — starts a backup and returns at
// once (202); the page follows it on GET /api/admin/backup/progress. ⚠ Not awaited on purpose:
// a full copy takes minutes and Railway's proxy would cut the request off part-way.
export async function POST(req: NextRequest) {
  try {
    const session = await admin()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const body = await req.json().catch(() => ({})) as { scope?: unknown }
    let scope: BackupScope = "all"
    if (body.scope === "quick") scope = "quick"
    else if (Array.isArray(body.scope)) {
      scope = body.scope.filter((s): s is string => typeof s === "string" && /^[A-Za-z0-9_]+$/.test(s))
      if (!scope.length) return NextResponse.json({ error: "Tick at least one table." }, { status: 400 })
    }
    const by = session.user.name || session.user.email || "an admin"
    const r = startBackup({ by, scope })
    if (!r.started) return NextResponse.json({ error: r.reason }, { status: 409 })
    return NextResponse.json({ started: true, progress: backupProgress() }, { status: 202 })
  } catch (e: any) {
    console.error("[admin/backup] POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
