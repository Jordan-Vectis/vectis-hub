import { NextRequest } from "next/server"
import { auth } from "@/auth"
import {
  backupPrefix, describeTables, readJsonl, readLegacyDump, readManifest, restoreRows, tableOrder, type RestoreCounts,
} from "@/lib/backup-engine"

export const maxDuration = 300
export const dynamic = "force-dynamic"

const BATCH = 2000

// POST /api/admin/restore/stream  { key, tables?: string[] }
//
// Puts a whole backup — or the tables named — back, as a stream of progress events (SSE), one
// per batch of rows, so the page shows a count that moves and a Stop that works (RULES.md 7b).
// Parents before children (tableOrder), rows that failed on a missing parent are tried once more
// at the end of their table, and nothing is ever deleted. Closing the page aborts the request,
// which stops the loop after the batch in hand.
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") return Response.json({ error: "Unauthorised" }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { key?: unknown; tables?: unknown }
  const key = typeof body.key === "string" ? body.key : ""
  if (!key) return Response.json({ error: "key is required" }, { status: 400 })
  if (!key.startsWith(backupPrefix())) return Response.json({ error: "That backup belongs to another environment." }, { status: 400 })
  const want = Array.isArray(body.tables) ? new Set(body.tables.filter((s): s is string => typeof s === "string")) : null

  const enc = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (d: object) => { try { controller.enqueue(enc.encode(`data: ${JSON.stringify(d)}\n\n`)) } catch { /* the page has gone */ } }
      try {
        const all = await describeTables()
        const byName = new Map(all.map(t => [t.name, t]))
        const notes: string[] = []
        let plan: { name: string; rows: number }[]
        let legacy: Record<string, Record<string, unknown>[]> | null = null

        if (key.endsWith("/")) {
          const m = await readManifest(key)
          if (!m) throw new Error("This backup has no manifest — it didn't finish, so it can't be restored whole.")
          plan = m.tables.filter(t => t.ok && (!want || want.has(t.name))).map(t => ({ name: t.name, rows: t.rows }))
        } else {
          send({ stage: "downloading", message: "Reading the backup file…" })
          const dump = await readLegacyDump(key, all)
          legacy = dump.tables
          plan = Object.entries(dump.tables).filter(([n]) => !want || want.has(n)).map(([n, rows]) => ({ name: n, rows: rows.length }))
          if (dump.unknown.length) notes.push(`Left out — this database has no such tables: ${dump.unknown.join(", ")}.`)
        }
        const gone = plan.filter(p => !byName.has(p.name)).map(p => p.name)
        if (gone.length) notes.push(`Left out — tables the database no longer has: ${gone.join(", ")}.`)
        plan = plan.filter(p => byName.has(p.name))
        const order = await tableOrder(plan.map(p => p.name))
        plan.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))

        const rowsTotal = plan.reduce((n, p) => n + p.rows, 0)
        let rowsBefore = 0
        let failedBefore = 0
        const counts: Record<string, { done: number; failed: number }> = {}
        const errors: string[] = []
        const skippedColumns: string[] = []
        send({ stage: "starting", message: `Restoring ${plan.length} table${plan.length === 1 ? "" : "s"}, ${rowsTotal.toLocaleString("en-GB")} rows…`, tableTotal: plan.length, rowsTotal, notes })

        for (let i = 0; i < plan.length; i++) {
          if (req.signal.aborted) break
          const p = plan[i]
          const t = byName.get(p.name)!
          const c: RestoreCounts = { done: 0, failed: 0, errors: [], skippedColumns: [], retry: [] }
          const tick = () => send({
            stage: "restoring", table: p.name, tableIndex: i + 1, tableTotal: plan.length,
            tableRows: p.rows, tableDone: c.done + c.failed,
            rowsDone: rowsBefore + c.done + c.failed, rowsTotal, failed: failedBefore + c.failed,
            pct: rowsTotal ? Math.round(((rowsBefore + c.done + c.failed) / rowsTotal) * 100) : 100,
          })
          tick()
          try {
            if (legacy) {
              const rows = legacy[p.name] ?? []
              for (let j = 0; j < rows.length && !req.signal.aborted; j += BATCH) { await restoreRows(t, rows.slice(j, j + BATCH), c); tick() }
            } else {
              let batch: Record<string, unknown>[] = []
              for await (const row of readJsonl(`${key}tables/${p.name}.jsonl`)) {
                if (req.signal.aborted) break
                batch.push(row)
                if (batch.length >= BATCH) { await restoreRows(t, batch, c); batch = []; tick() }
              }
              if (batch.length && !req.signal.aborted) { await restoreRows(t, batch, c); tick() }
            }
            // Second pass: a row refused because its parent came later (a self-reference, or a
            // cycle between tables) goes in now that everything else of the table is there.
            if (c.retry.length && !req.signal.aborted) {
              const again: RestoreCounts = { done: 0, failed: 0, errors: [], skippedColumns: [], retry: [] }
              await restoreRows(t, c.retry, again)
              c.done += again.done
              c.failed -= again.done
              c.retry = []
              if (again.done) c.errors = again.errors
              tick()
            }
          } catch (e: any) {
            c.errors.unshift(`${p.name}: ${String(e?.message ?? e).split("\n").pop()?.slice(0, 300)}`)
            c.failed = Math.max(c.failed, p.rows - c.done)
          }
          counts[p.name] = { done: c.done, failed: c.failed }
          for (const err of c.errors) if (errors.length < 30) errors.push(err)
          for (const s of c.skippedColumns) { const line = `${p.name}.${s}`; if (!skippedColumns.includes(line)) skippedColumns.push(line) }
          rowsBefore += c.done + c.failed
          failedBefore += c.failed
        }

        const done = Object.values(counts).reduce((n, c) => n + c.done, 0)
        const failed = Object.values(counts).reduce((n, c) => n + c.failed, 0)
        const tablesDone = Object.keys(counts).length
        if (req.signal.aborted) {
          send({ stage: "stopped", message: `Stopped after ${tablesDone} of ${plan.length} tables — ${done.toLocaleString("en-GB")} rows put back, ${failed.toLocaleString("en-GB")} couldn't be. What was restored stays restored.`, counts, errors, skippedColumns, notes })
        } else {
          send({
            stage: "complete",
            message: `Restored ${done.toLocaleString("en-GB")} rows across ${tablesDone} table${tablesDone === 1 ? "" : "s"}${failed ? ` — ${failed.toLocaleString("en-GB")} row${failed === 1 ? "" : "s"} couldn't be put back` : ""}.`,
            pct: 100, counts, done, failed, errors, skippedColumns, notes,
          })
        }
      } catch (e: any) {
        send({ stage: "error", message: String(e?.message ?? e).split("\n").pop()?.slice(0, 400) ?? "Unknown error" })
      } finally {
        try { controller.close() } catch { /* already closed */ }
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Railway's proxy must not buffer the stream
    },
  })
}
