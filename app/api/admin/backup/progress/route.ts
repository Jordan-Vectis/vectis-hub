import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { backupProgress } from "@/lib/backup-engine"

export const dynamic = "force-dynamic"

// GET /api/admin/backup/progress — how the running (or last) backup is going: which table, its
// place in the run, rows and bytes so far. Polled by /admin/backup once a second while one runs.
export async function GET() {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    return NextResponse.json(backupProgress())
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
