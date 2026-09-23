import { prisma } from "@/lib/prisma"
import { r2 } from "@/lib/r2"
import { createNotification } from "@/lib/notifications"
import { R2MultipartWriter } from "@/lib/r2-multipart"
import {
  DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client,
} from "@aws-sdk/client-s3"
import type { Readable } from "node:stream"

// 💾 The database backup — every table, streamed, one file per table (2026-09-22).
//
// Jordan picked this from the review: "Nightly backup covers 42 of 151 tables and the restore
// screen can't restore the induction tables. A streamed per-table backup would cover everything,
// ArchiveLot included."
//
// Before: a hand-kept list of 42 tables, each read whole with findMany, the lot built into ONE
// JSON string and uploaded in one go. Node's largest string is ~0.5 GB, so the ABC archive
// (~1 GB as JSON) could never join it, and every new table was missed until someone remembered
// the list. The restore side had ITS OWN hand-kept map, with the induction tables in the backup
// but not in it.
//
// Now: the database describes itself (information_schema) — every table in `public` except
// Prisma's own bookkeeping and UNLOGGED scratch — and each one is read a page at a time and
// written straight to R2 as newline-delimited JSON (`tables/<Name>.jsonl`), with a manifest.json
// saying what was copied, how many rows, and what failed. Restore reads the same description,
// so it can put ANY table back — including ones that don't exist yet today — by generic
// INSERT … ON CONFLICT (primary key) DO UPDATE, casting each value to the column's real type.
//
// ⚠ Nothing here is ever held whole: not a table, not a file. Keep it that way.
// ⚠ A restore is UPSERT ONLY — rows made since the backup are left alone, and nothing is deleted.
// ⚠ The old single-file `backup-<ts>.json` copies are still listed and still restorable (their
//   table keys were camelCase plurals; legacyTableName() maps them onto the real table names).
// ⚠ One job at a time, held on globalThis like the Status Centre engine; a manual run is
//   started and polled (Railway's proxy would time out a request that took the whole run), the
//   nightly one is awaited by the cron route (localhost, no proxy).

// ── Where and how much ─────────────────────────────────────────────────────────

export const KEEP = 30
export const PAGE_ROWS = 5000
/** A page of rows that takes longer than this is abandoned and the table marked failed — a hung
 *  query must fail one table, never hold the whole night (2026-09-23: the first nightly never
 *  finished and nothing said why). */
const PAGE_TIMEOUT_MS = 120_000
/** Keep a page of rows under about this much text: a table whose rows carry big JSON (a run's
 *  results) would otherwise make a 5,000-row page of hundreds of MB. */
const PAGE_BYTES = 24_000_000
export const bucket = () => process.env.CLOUDFLARE_R2_BACKUP_BUCKET ?? ""
/** This environment's folder in the backup bucket — the same rule as before, `?? "unknown"` included. */
export const backupPrefix = () => `${process.env.RAILWAY_ENVIRONMENT_NAME ?? "unknown"}/`

/** The rebuildable copies that make a backup big — the ABC archive, the website's BC lots, the BC
 *  warehouse cache, the spelling list and the two logs. "Everything except the big copies" leaves
 *  these out for a quick manual copy. The nightly run never skips them. */
export const BIG_TABLES = ["ArchiveLot", "BcLotWeb", "WarehouseItem", "SearchWord", "CatalogueLotEvent", "StatusCheck"]
/** Prisma's own bookkeeping — restoring it would confuse `prisma migrate`. */
const NEVER = new Set(["_prisma_migrations"])

// ── The database describing itself ─────────────────────────────────────────────

export interface ColumnInfo { name: string; udt: string; dataType: string }
export interface TableInfo { name: string; columns: ColumnInfo[]; pk: string[]; estRows: number; unlogged: boolean }

/** Every base table in `public`, with its columns, primary key and the planner's row estimate. */
export async function describeTables(): Promise<TableInfo[]> {
  const [tables, columns, pks] = await Promise.all([
    prisma.$queryRawUnsafe<{ name: string; est: number; p: string }[]>(
      `SELECT c.relname AS name, GREATEST(c.reltuples, 0)::float8 AS est, c.relpersistence AS p
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`),
    prisma.$queryRawUnsafe<{ t: string; name: string; udt: string; dataType: string }[]>(
      `SELECT table_name AS t, column_name AS name, udt_name AS udt, data_type AS "dataType"
       FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`),
    prisma.$queryRawUnsafe<{ t: string; name: string }[]>(
      `SELECT tc.table_name AS t, kcu.column_name AS name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
       ORDER BY tc.table_name, kcu.ordinal_position`),
  ])
  const cols = new Map<string, ColumnInfo[]>()
  for (const c of columns) (cols.get(c.t) ?? cols.set(c.t, []).get(c.t)!).push({ name: c.name, udt: c.udt, dataType: c.dataType })
  const keys = new Map<string, string[]>()
  for (const k of pks) (keys.get(k.t) ?? keys.set(k.t, []).get(k.t)!).push(k.name)
  return tables
    .filter(t => !NEVER.has(t.name))
    .map(t => ({ name: t.name, columns: cols.get(t.name) ?? [], pk: keys.get(t.name) ?? [], estRows: Math.round(Number(t.est)), unlogged: t.p === "u" }))
}

/** The tables a backup copies: everything that isn't scratch. */
export const backupable = (all: TableInfo[]) => all.filter(t => !t.unlogged)

/** Parents before children, from the foreign keys — so a full restore never trips over a row
 *  whose parent hasn't been put back yet. A cycle (or a self-reference) is simply left in name
 *  order; the restore's second pass over failed rows covers that. */
export async function tableOrder(names: string[]): Promise<string[]> {
  const want = new Set(names)
  let edges: { child: string; parent: string }[] = []
  try {
    edges = await prisma.$queryRawUnsafe<{ child: string; parent: string }[]>(
      `SELECT DISTINCT tc.table_name AS child, ccu.table_name AS parent
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`)
  } catch { /* no order is still an order — the second pass covers it */ }
  const indeg = new Map<string, number>()
  const children = new Map<string, string[]>()
  for (const n of want) indeg.set(n, 0)
  for (const e of edges) {
    if (e.child === e.parent || !want.has(e.child) || !want.has(e.parent)) continue
    indeg.set(e.child, (indeg.get(e.child) ?? 0) + 1)
    ;(children.get(e.parent) ?? children.set(e.parent, []).get(e.parent)!).push(e.child)
  }
  const out: string[] = []
  const ready = [...want].filter(n => (indeg.get(n) ?? 0) === 0).sort()
  while (ready.length) {
    const n = ready.shift()!
    out.push(n)
    for (const c of (children.get(n) ?? []).sort()) {
      indeg.set(c, indeg.get(c)! - 1)
      if (indeg.get(c) === 0) ready.push(c)
    }
    ready.sort()
  }
  for (const n of [...want].sort()) if (!out.includes(n)) out.push(n)
  return out
}

// ── Reading rows a page at a time ──────────────────────────────────────────────

const q = (s: string) => `"${s.replace(/"/g, '""')}"`

/** One page query under a statement timeout — SET LOCAL needs a transaction, so it is one. */
async function timedPage(sql: string, ...params: unknown[]): Promise<Record<string, unknown>[]> {
  return prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${PAGE_TIMEOUT_MS}`)
    return tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params)
  }, { maxWait: 30_000, timeout: PAGE_TIMEOUT_MS + 15_000 })
}

/** Pages through a table. A single-column key walks by keyset (no OFFSET, so a million rows stay
 *  a million row reads); a composite key — six small tables — pages by OFFSET. The page size is
 *  asked for afresh each time, so a caller can shrink it when the rows turn out to be big. */
export async function* readRows(t: TableInfo, pageSize: number | (() => number) = PAGE_ROWS): AsyncGenerator<Record<string, unknown>[]> {
  const cols = t.columns.map(c => q(c.name)).join(", ")
  const size = () => Math.max(1, Math.floor(typeof pageSize === "function" ? pageSize() : pageSize))
  if (t.pk.length === 1) {
    const pk = q(t.pk[0])
    let last: unknown
    for (;;) {
      const page = size()
      const rows = last === undefined
        ? await timedPage(`SELECT ${cols} FROM ${q(t.name)} ORDER BY ${pk} LIMIT ${page}`)
        : await timedPage(`SELECT ${cols} FROM ${q(t.name)} WHERE ${pk} > $1 ORDER BY ${pk} LIMIT ${page}`, last)
      if (!rows.length) return
      yield rows
      if (rows.length < page) return
      last = rows[rows.length - 1][t.pk[0]]
    }
  }
  const order = (t.pk.length ? t.pk : t.columns.map(c => c.name)).map(q).join(", ")
  let off = 0
  for (;;) {
    const page = size()
    const rows = await timedPage(`SELECT ${cols} FROM ${q(t.name)} ORDER BY ${order} LIMIT ${page} OFFSET ${off}`)
    if (!rows.length) return
    yield rows
    if (rows.length < page) return
    off += rows.length
  }
}

/** A row as it goes into the file: bytes as base64, bigints as strings, dates as ISO (their own toJSON). */
function plainRow(row: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = {}
  for (const k of Object.keys(row)) {
    const v = row[k]
    o[k] = v instanceof Uint8Array ? Buffer.from(v).toString("base64") : typeof v === "bigint" ? v.toString() : v
  }
  return o
}

// ── The manifest ───────────────────────────────────────────────────────────────

export interface ManifestTable { name: string; rows: number; bytes: number; ok: boolean; error?: string }
export interface Manifest {
  version: 2
  env: string
  startedAt: string
  finishedAt: string
  by: string
  /** Every backupable table was asked for. */
  everything: boolean
  /** Someone pressed Stop. */
  stopped: boolean
  /** Every table asked for was copied without error. */
  complete: boolean
  requested: number
  tables: ManifestTable[]
  totalRows: number
  totalBytes: number
  failed: number
  durationMs: number
}

// ── The job ────────────────────────────────────────────────────────────────────

export interface BackupProgress {
  running: boolean
  startedAt: string | null
  by: string | null
  folder: string | null
  /** The table being copied now, its place in the run, and how it is going. */
  table: string | null
  tableIndex: number
  tableTotal: number
  tableRows: number
  tableEstRows: number
  /** Whole-run totals so far. */
  rows: number
  bytes: number
  stopping: boolean
  /** The last run's outcome, kept until the next run starts. */
  result: Manifest | null
  error: string | null
  finishedAt: string | null
}

type Job = BackupProgress & { stop: boolean }

function job(): Job {
  const g = globalThis as unknown as { _backupJob?: Job }
  return (g._backupJob ??= {
    running: false, startedAt: null, by: null, folder: null, table: null, tableIndex: 0, tableTotal: 0,
    tableRows: 0, tableEstRows: 0, rows: 0, bytes: 0, stopping: false, result: null, error: null, finishedAt: null, stop: false,
  })
}

export function backupProgress(): BackupProgress {
  const { stop: _stop, ...p } = job()
  return p
}

export function stopBackup(): boolean {
  const j = job()
  if (!j.running) return false
  j.stop = true
  j.stopping = true
  return true
}

export type BackupScope = "all" | "quick" | string[]

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
}

const errText = (e: unknown) => {
  const lines = String((e as Error)?.message ?? e).split("\n").map(l => l.trim()).filter(Boolean)
  return (lines[lines.length - 1] ?? "Unknown error").slice(0, 300)
}

/** Runs a backup and waits for it. Throws at once if one is already running or the store isn't set up. */
export async function runBackupJob(opts: { by: string; scope?: BackupScope }): Promise<Manifest> {
  const j = job()
  if (j.running) throw new Error("A backup is already running — wait for it to finish.")
  if (!bucket()) throw new Error("The backup store isn't set up on this environment (CLOUDFLARE_R2_BACKUP_BUCKET).")
  const started = new Date()
  Object.assign(j, {
    running: true, startedAt: started.toISOString(), by: opts.by, folder: null, table: null, tableIndex: 0, tableTotal: 0,
    tableRows: 0, tableEstRows: 0, rows: 0, bytes: 0, stopping: false, result: null, error: null, finishedAt: null, stop: false,
  } satisfies Partial<Job>)

  try {
    const all = backupable(await describeTables())
    const scope = opts.scope ?? "all"
    const chosen = scope === "all" ? all
      : scope === "quick" ? all.filter(t => !BIG_TABLES.includes(t.name))
      : all.filter(t => scope.includes(t.name))
    if (!chosen.length) throw new Error("No tables to copy.")
    const everything = chosen.length === all.length
    const folder = `${backupPrefix()}backup-${stamp(started)}${everything ? "" : "-partial"}/`
    j.folder = folder
    j.tableTotal = chosen.length

    const tables: ManifestTable[] = []
    let stopped = false
    console.log(`[db-backup] starting ${folder} — ${chosen.length} tables, by ${opts.by}`)
    for (let i = 0; i < chosen.length; i++) {
      const t = chosen[i]
      if (j.stop) { stopped = true; break }
      Object.assign(j, { table: t.name, tableIndex: i + 1, tableRows: 0, tableEstRows: t.estRows })
      const writer = new R2MultipartWriter(r2, bucket(), `${folder}tables/${t.name}.jsonl`, "application/x-ndjson")
      let rows = 0
      let page = PAGE_ROWS
      const t0 = Date.now()
      try {
        for await (const batch of readRows(t, () => page)) {
          if (j.stop) break
          const text = batch.map(r => JSON.stringify(plainRow(r))).join("\n") + "\n"
          await writer.write(text)
          // Size the next page by what this one weighed: big rows, smaller pages.
          page = Math.max(200, Math.min(PAGE_ROWS, Math.floor(PAGE_BYTES / Math.max(1, text.length / batch.length))))
          rows += batch.length
          j.tableRows = rows
          j.rows += batch.length
          j.bytes = tables.reduce((n, x) => n + x.bytes, 0) + writer.bytes
        }
        if (j.stop) {
          // ⚠ Half a table is not a table — thrown away, so nothing in the folder can mislead a restore.
          await writer.abort()
          tables.push({ name: t.name, rows, bytes: 0, ok: false, error: "Stopped before this table finished — not kept" })
          stopped = true
          break
        }
        const bytes = await writer.close()
        tables.push({ name: t.name, rows, bytes, ok: true })
        // ⚠ One line per table in the server log — the night the first run never finished, the
        // log had nothing between "starting" and silence.
        console.log(`[db-backup] ${t.name}: ${rows} rows, ${bytes} bytes, ${Math.round((Date.now() - t0) / 1000)} s`)
      } catch (e) {
        await writer.abort()
        tables.push({ name: t.name, rows, bytes: 0, ok: false, error: errText(e) })
        console.error(`[db-backup] ${t.name} failed after ${rows} rows:`, e)
      }
      j.bytes = tables.reduce((n, x) => n + x.bytes, 0)
    }

    const finished = new Date()
    const failed = tables.filter(t => !t.ok).length
    const manifest: Manifest = {
      version: 2, env: process.env.RAILWAY_ENVIRONMENT_NAME ?? "unknown",
      startedAt: started.toISOString(), finishedAt: finished.toISOString(), by: opts.by,
      everything, stopped, complete: !stopped && failed === 0 && tables.length === chosen.length,
      requested: chosen.length, tables,
      totalRows: tables.reduce((n, t) => n + (t.ok ? t.rows : 0), 0),
      totalBytes: tables.reduce((n, t) => n + t.bytes, 0),
      failed, durationMs: finished.getTime() - started.getTime(),
    }
    await r2.send(new PutObjectCommand({ Bucket: bucket(), Key: `${folder}manifest.json`, Body: JSON.stringify(manifest), ContentType: "application/json" }))
    manifestCache().set(folder, manifest)
    console.log(`[db-backup] ${folder}: ${tables.length - failed} of ${chosen.length} tables, ${manifest.totalRows} rows, ${manifest.totalBytes} bytes, ${Math.round(manifest.durationMs / 1000)} s${failed ? `, ${failed} FAILED` : ""}${stopped ? ", STOPPED" : ""}`)

    try { await prune() } catch (e) { console.warn("[db-backup] prune failed:", errText(e)) }

    // The nightly run has nobody watching it — a table that didn't copy is said out loud.
    if (opts.by === "nightly" && (failed || stopped)) {
      const names = tables.filter(t => !t.ok).map(t => t.name)
      await createNotification({
        kind: "status", level: "warning",
        title: `🟠 Last night's backup missed ${failed} table${failed === 1 ? "" : "s"}`,
        body: `Not copied: ${names.slice(0, 8).join(", ")}${names.length > 8 ? ` and ${names.length - 8} more` : ""}. The rest of the backup is there.`,
        href: "/admin/backup",
      })
    }

    Object.assign(j, { running: false, result: manifest, finishedAt: finished.toISOString(), table: null, stopping: false, stop: false })
    return manifest
  } catch (e) {
    Object.assign(j, { running: false, error: errText(e), finishedAt: new Date().toISOString(), table: null, stopping: false, stop: false })
    throw e
  }
}

/** Starts a backup and returns at once; watch it with backupProgress(). */
export function startBackup(opts: { by: string; scope?: BackupScope }): { started: boolean; reason?: string } {
  const j = job()
  if (j.running) return { started: false, reason: "A backup is already running — wait for it to finish." }
  if (!bucket()) return { started: false, reason: "The backup store isn't set up on this environment (CLOUDFLARE_R2_BACKUP_BUCKET)." }
  void runBackupJob(opts).catch(e => console.error("[db-backup] run failed:", e))
  return { started: true }
}

// ── What is in the store ───────────────────────────────────────────────────────

export interface BackupEntry {
  /** The folder (ends in "/") or, for an old single-file copy, the .json key. */
  key: string
  kind: "folder" | "legacy"
  /** When it finished (the manifest), or the file's LastModified. */
  at: string | null
  bytes: number
  partial: boolean
  stopped: boolean
  complete: boolean
  failed: number
  failedNames: string[]
  tables: number
  rows: number
  /** A folder with no manifest yet: being written now, or a run that died before it finished. */
  inProgress: boolean
}

function manifestCache(): Map<string, Manifest | null> {
  const g = globalThis as unknown as { _backupManifests?: Map<string, Manifest | null> }
  return (g._backupManifests ??= new Map())
}

async function bodyText(body: unknown): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(c))
  return Buffer.concat(chunks).toString("utf8")
}

/** A folder's manifest, cached for good once seen (a finished backup never changes). */
export async function readManifest(folder: string, client: S3Client = r2): Promise<Manifest | null> {
  const cache = manifestCache()
  if (cache.has(folder)) return cache.get(folder) ?? null
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket(), Key: `${folder}manifest.json` }))
    const m = JSON.parse(await bodyText(res.Body)) as Manifest
    cache.set(folder, m)
    return m
  } catch (e) {
    if ((e as { name?: string })?.name === "NoSuchKey" || (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404) return null
    throw e
  }
}

/** Every backup in this environment's folder, newest first. */
export async function listBackups(client: S3Client = r2): Promise<BackupEntry[]> {
  const prefix = backupPrefix()
  const folders: string[] = []
  const legacy: { key: string; size: number; at: string | null }[] = []
  let token: string | undefined
  do {
    const res = await client.send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, Delimiter: "/", ContinuationToken: token }))
    for (const p of res.CommonPrefixes ?? []) if (p.Prefix?.startsWith(`${prefix}backup-`)) folders.push(p.Prefix)
    for (const o of res.Contents ?? []) if (o.Key?.endsWith(".json")) legacy.push({ key: o.Key, size: o.Size ?? 0, at: o.LastModified?.toISOString() ?? null })
    token = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (token)

  const entries: BackupEntry[] = legacy.map(f => ({
    key: f.key, kind: "legacy", at: f.at, bytes: f.size, partial: f.key.includes("-partial"), stopped: false,
    complete: true, failed: 0, failedNames: [], tables: 0, rows: 0, inProgress: false,
  }))
  const running = job()
  for (const folder of folders) {
    const m = await readManifest(folder, client)
    if (m) {
      entries.push({
        key: folder, kind: "folder", at: m.finishedAt, bytes: m.totalBytes, partial: !m.everything, stopped: m.stopped,
        complete: m.complete, failed: m.failed, failedNames: m.tables.filter(t => !t.ok).map(t => t.name),
        tables: m.tables.filter(t => t.ok).length, rows: m.totalRows, inProgress: false,
      })
    } else {
      // No manifest: it is being written right now, or a run died before it could write one.
      const live = running.running && running.folder === folder
      entries.push({
        key: folder, kind: "folder", at: null, bytes: live ? running.bytes : 0, partial: folder.includes("-partial"), stopped: false,
        complete: false, failed: 0, failedNames: [], tables: live ? running.tableIndex - 1 : 0, rows: live ? running.rows : 0, inProgress: true,
      })
    }
  }
  // The name carries the timestamp, so name order is date order — the same rule the prune uses.
  return entries.sort((a, b) => (a.key < b.key ? 1 : -1))
}

async function deleteFolder(folder: string): Promise<number> {
  let token: string | undefined
  let n = 0
  do {
    const res = await r2.send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: folder, ContinuationToken: token }))
    const keys = (res.Contents ?? []).map(o => o.Key!).filter(Boolean)
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000)
      await r2.send(new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: batch.map(Key => ({ Key })), Quiet: true } }))
      n += batch.length
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (token)
  manifestCache().delete(folder)
  return n
}

export async function deleteBackup(key: string): Promise<void> {
  if (!key.startsWith(backupPrefix())) throw new Error("That backup belongs to another environment.")
  if (key.endsWith("/")) { await deleteFolder(key); return }
  await r2.send(new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: [{ Key: key }], Quiet: true } }))
}

/** Keeps the newest KEEP backups (old single files and folders alike) and removes the rest. */
export async function prune(): Promise<number> {
  const entries = await listBackups()
  const live = job()
  const doomed = entries.slice(KEEP).filter(e => !(e.inProgress && live.running && live.folder === e.key))
  for (const e of doomed) await deleteBackup(e.key)
  if (doomed.length) console.log(`[db-backup] pruned ${doomed.length} old backup(s)`)
  return doomed.length
}

// ── Reading a backup back ──────────────────────────────────────────────────────

/** The rows of one table file, one at a time, never the file whole. */
export async function* readJsonl(key: string): AsyncGenerator<Record<string, unknown>> {
  const res = await r2.send(new GetObjectCommand({ Bucket: bucket(), Key: key }))
  const body = res.Body as Readable
  let carry = ""
  for await (const chunk of body) {
    carry += Buffer.from(chunk as Uint8Array).toString("utf8")
    let nl: number
    while ((nl = carry.indexOf("\n")) >= 0) {
      const line = carry.slice(0, nl)
      carry = carry.slice(nl + 1)
      if (line.trim()) yield JSON.parse(line)
    }
  }
  if (carry.trim()) yield JSON.parse(carry)
}

/** An old single-file backup, parsed whole (they are tens of MB at most), keyed by REAL table name. */
export async function readLegacyDump(key: string, tables: TableInfo[]): Promise<{ tables: Record<string, Record<string, unknown>[]>; unknown: string[] }> {
  const res = await r2.send(new GetObjectCommand({ Bucket: bucket(), Key: key }))
  const dump = JSON.parse(await bodyText(res.Body)) as { tables?: Record<string, unknown[] | null> }
  const out: Record<string, Record<string, unknown>[]> = {}
  const unknown: string[] = []
  const names = tables.map(t => t.name)
  for (const [k, rows] of Object.entries(dump.tables ?? {})) {
    if (!Array.isArray(rows) || !rows.length) continue
    const real = legacyTableName(k, names)
    if (real) out[real] = rows as Record<string, unknown>[]
    else unknown.push(k)
  }
  return { tables: out, unknown }
}

/** "catalogueLots" → CatalogueLot, "bcTokens" → BCToken, "ticketCategories" → TicketCategory, "claudeMemory" → ClaudeMemory. */
export function legacyTableName(key: string, tables: string[]): string | null {
  const norm = (s: string) => {
    let x = s.toLowerCase().replace(/[^a-z]/g, "")
    if (x.endsWith("ies")) x = x.slice(0, -3) + "y"
    else if (x.endsWith("s") && !x.endsWith("ss")) x = x.slice(0, -1)
    return x
  }
  const want = norm(key)
  return tables.find(t => norm(t) === want) ?? null
}

// ── Putting rows back ──────────────────────────────────────────────────────────

/** The SQL that turns a parameter into the column's real type. Prisma sends every parameter as
 *  text-ish, so without the cast Postgres refuses ("column is of type jsonb but expression is of
 *  type text"). Arrays travel as a JSON array and are unpacked here; bytes travel as base64. */
function castFor(c: ColumnInfo, n: number): string {
  const p = `$${n}`
  if (c.udt.startsWith("_")) return `ARRAY(SELECT v::${scalarType({ ...c, udt: c.udt.slice(1) })} FROM jsonb_array_elements_text(${p}::jsonb) AS v)`
  if (c.udt === "bytea") return `decode(${p}::text, 'base64')`
  return `${p}::${scalarType(c)}`
}

function scalarType(c: ColumnInfo): string {
  switch (c.udt) {
    case "text": case "varchar": case "bpchar": case "citext": case "name": return "text"
    case "int2": case "int4": return "integer"
    case "int8": return "bigint"
    case "float4": case "float8": return "double precision"
    case "numeric": return "numeric"
    case "bool": return "boolean"
    case "timestamp": return "timestamp"
    case "timestamptz": return "timestamptz"
    case "date": return "date"
    case "time": return "time"
    case "jsonb": return "jsonb"
    case "json": return "json"
    case "uuid": return "uuid"
    default: return q(c.udt) // an enum, or anything else Postgres knows by that name
  }
}

/** The value as the cast above expects it. */
function valueFor(c: ColumnInfo, v: unknown): unknown {
  if (v === undefined || v === null) return null
  if (c.udt.startsWith("_")) return JSON.stringify(Array.isArray(v) ? v : [v])
  if (c.udt === "jsonb" || c.udt === "json") return JSON.stringify(v)
  if (c.udt === "bytea") {
    // The old backups wrote Buffers as {type:"Buffer",data:[…]} (JSON.stringify's own doing).
    const b = v as { type?: string; data?: number[] }
    if (b && typeof b === "object" && b.type === "Buffer" && Array.isArray(b.data)) return Buffer.from(b.data).toString("base64")
    return String(v)
  }
  if (typeof v === "object" && !(v instanceof Date)) return JSON.stringify(v)
  return v
}

export interface RestoreCounts {
  done: number
  failed: number
  errors: string[]
  skippedColumns: string[]
  /** The rows that failed (up to 5,000), so a caller can try them once more after the rest of the table is in. */
  retry: Record<string, unknown>[]
}

/** Upserts rows into one table, generically: INSERT … ON CONFLICT (primary key) DO UPDATE, every
 *  value cast to the column's type. A batch that fails is retried row by row so one bad row costs
 *  one row, not a batch. Columns the database no longer has are dropped (and named); columns the
 *  backup lacks are left as they are. */
export async function restoreRows(t: TableInfo, rows: Record<string, unknown>[], counts?: RestoreCounts): Promise<RestoreCounts> {
  const out: RestoreCounts = counts ?? { done: 0, failed: 0, errors: [], skippedColumns: [], retry: [] }
  if (!rows.length) return out
  if (!t.pk.length) throw new Error(`${t.name} has no primary key, so its rows can't be matched`)
  const present = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r)) present.add(k)
  const cols = t.columns.filter(c => present.has(c.name))
  for (const k of present) if (!t.columns.some(c => c.name === k) && !out.skippedColumns.includes(k)) out.skippedColumns.push(k)
  for (const k of t.pk) if (!present.has(k)) throw new Error(`the backup's ${t.name} rows have no "${k}" (part of the primary key)`)

  const pkSet = new Set(t.pk)
  const setList = cols.filter(c => !pkSet.has(c.name)).map(c => `${q(c.name)} = EXCLUDED.${q(c.name)}`)
  const conflict = `ON CONFLICT (${t.pk.map(q).join(", ")}) ${setList.length ? `DO UPDATE SET ${setList.join(", ")}` : "DO NOTHING"}`
  const per = Math.max(1, Math.min(500, Math.floor(30_000 / Math.max(1, cols.length))))

  const run = async (batch: Record<string, unknown>[]) => {
    const params: unknown[] = []
    const values = batch.map(r => `(${cols.map(c => { params.push(valueFor(c, r[c.name])); return castFor(c, params.length) }).join(", ")})`)
    const sql = `INSERT INTO ${q(t.name)} (${cols.map(c => q(c.name)).join(", ")}) VALUES ${values.join(", ")} ${conflict}`
    await prisma.$executeRawUnsafe(sql, ...params)
  }

  for (let i = 0; i < rows.length; i += per) {
    const batch = rows.slice(i, i + per)
    try {
      await run(batch)
      out.done += batch.length
    } catch {
      for (const r of batch) {
        try { await run([r]); out.done++ }
        catch (e) {
          out.failed++
          if (out.retry.length < 5000) out.retry.push(r)
          if (out.errors.length < 10) out.errors.push(`${t.name} ${t.pk.map(k => String(r[k] ?? "?")).join("/")}: ${errText(e)}`)
        }
      }
    }
  }
  return out
}

// ── Searching a backup ─────────────────────────────────────────────────────────

export interface SearchHit { table: string; record: Record<string, unknown>; matchedField: string; matchedValue: string }

/** Every table file up to `maxBytes` is streamed and each row's string fields are tested. Bigger
 *  files are skipped and named — a search is a lookup, not a reason to pull a gigabyte through. */
export async function searchBackup(key: string, term: string, opts: { maxBytes?: number; limit?: number } = {}): Promise<{ results: SearchHit[]; skipped: string[] }> {
  const needle = term.trim().toLowerCase()
  const maxBytes = opts.maxBytes ?? 64 * 1024 * 1024
  const limit = opts.limit ?? 200
  const results: SearchHit[] = []
  const skipped: string[] = []
  const test = (table: string, row: Record<string, unknown>) => {
    for (const [f, v] of Object.entries(row)) {
      if (typeof v === "string" && v.toLowerCase().includes(needle)) { results.push({ table, record: row, matchedField: f, matchedValue: v.slice(0, 300) }); return }
    }
  }
  if (!key.endsWith("/")) {
    const all = await describeTables()
    const { tables } = await readLegacyDump(key, all)
    for (const [table, rows] of Object.entries(tables)) {
      for (const r of rows) { if (results.length >= limit) break; test(table, r) }
    }
    return { results, skipped }
  }
  const m = await readManifest(key)
  if (!m) throw new Error("This backup has no manifest — it didn't finish.")
  for (const t of m.tables) {
    if (!t.ok || !t.rows) continue
    if (t.bytes > maxBytes) { skipped.push(t.name); continue }
    for await (const row of readJsonl(`${key}tables/${t.name}.jsonl`)) {
      if (results.length >= limit) break
      test(t.name, row)
    }
    if (results.length >= limit) break
  }
  return { results, skipped }
}

/** The rows of one table in a backup (either kind) that pass `keep`. */
export async function pickRows(key: string, table: string, keep: (row: Record<string, unknown>) => boolean, all: TableInfo[]): Promise<Record<string, unknown>[]> {
  if (!key.endsWith("/")) {
    const dump = await readLegacyDump(key, all)
    return (dump.tables[table] ?? []).filter(keep)
  }
  const m = await readManifest(key)
  const t = m?.tables.find(x => x.name === table && x.ok)
  if (!t) return []
  const out: Record<string, unknown>[] = []
  for await (const row of readJsonl(`${key}tables/${table}.jsonl`)) if (keep(row)) out.push(row)
  return out
}
