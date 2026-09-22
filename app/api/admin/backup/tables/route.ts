import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { BIG_TABLES, backupable, describeTables } from "@/lib/backup-engine"

export const dynamic = "force-dynamic"

// GET /api/admin/backup/tables — every table a backup would copy, with the planner's row
// estimate, for the "choose tables" list on /admin/backup. Read from the database itself, so a
// new table appears here the day it is created.
export async function GET() {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const tables = backupable(await describeTables()).map(t => ({ name: t.name, estRows: t.estRows, big: BIG_TABLES.includes(t.name), columns: t.columns.length }))
    return NextResponse.json({ tables })
  } catch (e: any) {
    console.error("[admin/backup/tables] error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
