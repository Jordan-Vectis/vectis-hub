import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { backupPrefix, describeTables, legacyTableName, pickRows, restoreRows, searchBackup } from "@/lib/backup-engine"

export const maxDuration = 300
export const dynamic = "force-dynamic"

// POST /api/admin/restore — the small restores, all through lib/backup-engine.ts:
//   { key, mode: "search", search }                              — find rows in a backup by any text
//   { key, mode: "single", tableName, record }                    — put one row back
//   { key, mode: "batch-by-field", tableName, fieldName, values } — e.g. these lots, by barcode
// A whole backup, or whole tables, go through /api/admin/restore/stream so progress can be shown.
// ⚠ Every restore is an UPSERT on the primary key — nothing is deleted, rows made since are kept.
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const body = await req.json().catch(() => ({})) as {
      key?: unknown; mode?: unknown; search?: unknown; tableName?: unknown; record?: unknown; fieldName?: unknown; values?: unknown
    }
    const key = typeof body.key === "string" ? body.key : ""
    const mode = typeof body.mode === "string" ? body.mode : ""
    if (!key || !mode) return NextResponse.json({ error: "key and mode are required" }, { status: 400 })
    if (!key.startsWith(backupPrefix())) return NextResponse.json({ error: "That backup belongs to another environment." }, { status: 400 })

    if (mode === "search") {
      const term = typeof body.search === "string" ? body.search.trim() : ""
      if (!term) return NextResponse.json({ error: "Type something to search for." }, { status: 400 })
      const { results, skipped } = await searchBackup(key, term)
      return NextResponse.json({ results, skipped })
    }

    const all = await describeTables()
    const tableName = typeof body.tableName === "string" ? body.tableName : ""
    const t = all.find(x => x.name === tableName) ?? all.find(x => x.name === legacyTableName(tableName, all.map(a => a.name)))
    if (!t) return NextResponse.json({ error: `This database has no table called ${tableName || "(none given)"}.` }, { status: 404 })

    if (mode === "single") {
      if (!body.record || typeof body.record !== "object") return NextResponse.json({ error: "tableName and record are required" }, { status: 400 })
      const c = await restoreRows(t, [body.record as Record<string, unknown>])
      if (c.failed) return NextResponse.json({ error: c.errors[0] ?? "The row couldn't be put back." }, { status: 500 })
      return NextResponse.json({ ok: true, table: t.name, skippedColumns: c.skippedColumns })
    }

    if (mode === "batch-by-field") {
      const fieldName = typeof body.fieldName === "string" ? body.fieldName : ""
      const values = Array.isArray(body.values) ? body.values.map(v => String(v).trim().toLowerCase()).filter(Boolean) : []
      if (!fieldName || !values.length) return NextResponse.json({ error: "tableName, fieldName and values are required" }, { status: 400 })
      if (!t.columns.some(c => c.name === fieldName)) return NextResponse.json({ error: `${t.name} has no column called ${fieldName}.` }, { status: 400 })
      const want = new Set(values)
      const rows = await pickRows(key, t.name, r => want.has(String(r[fieldName] ?? "").toLowerCase()), all)
      if (!rows.length) return NextResponse.json({ ok: true, restored: 0, total: 0, message: "No matching records found in this backup", errors: [] })
      const c = await restoreRows(t, rows)
      const found = new Set(rows.map(r => String(r[fieldName] ?? "").toLowerCase()))
      const missing = values.filter(v => !found.has(v))
      return NextResponse.json({ ok: true, restored: c.done, total: rows.length, errors: c.errors, missing, skippedColumns: c.skippedColumns })
    }

    return NextResponse.json({ error: "Invalid mode" }, { status: 400 })
  } catch (e: any) {
    console.error("[admin/restore] POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
