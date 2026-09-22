import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { backupPrefix, describeTables, readLegacyDump, readManifest } from "@/lib/backup-engine"

export const dynamic = "force-dynamic"

// GET /api/admin/backup/manifest?key=… — what one backup holds, table by table, for the restore
// picker. A folder answers from its manifest; an old single-file copy has to be read to be
// counted (they are tens of MB at most).
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const key = req.nextUrl.searchParams.get("key") ?? ""
    if (!key.startsWith(backupPrefix())) return NextResponse.json({ error: "That backup belongs to another environment." }, { status: 400 })
    if (key.endsWith("/")) {
      const m = await readManifest(key)
      if (!m) return NextResponse.json({ error: "This backup has no manifest — it is still being written, or the run died before it finished." }, { status: 404 })
      return NextResponse.json({ kind: "folder", manifest: m })
    }
    const dump = await readLegacyDump(key, await describeTables())
    return NextResponse.json({
      kind: "legacy",
      tables: Object.entries(dump.tables).map(([name, rows]) => ({ name, rows: rows.length, bytes: 0, ok: true })),
      unknown: dump.unknown,
    })
  } catch (e: any) {
    console.error("[admin/backup/manifest] error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
