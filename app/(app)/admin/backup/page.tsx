"use client"

import { useCallback, useEffect, useRef, useState } from "react"

// 💾 Admin → Database Backup — every table, one file each, and a restore that can put any of
// them back (2026-09-22, replacing the 42-table single-file copy). The engine and the reasons
// are in lib/backup-engine.ts.
//
// ⚠ RULES.md 7b: a backup or a restore takes minutes, so both show a number that moves — the
// table it is on, its place in the run, rows and bytes so far — and both have a Stop. A run is
// STARTED and then polled (Railway's proxy would cut off a request that lasted the whole run);
// a restore streams its progress the same way the old one did.

export const dynamic = "force-dynamic"

interface Entry {
  key: string; kind: "folder" | "legacy"; at: string | null; bytes: number
  partial: boolean; stopped: boolean; complete: boolean; failed: number; tables: number; rows: number; inProgress: boolean
}
interface ManifestTable { name: string; rows: number; bytes: number; ok: boolean; error?: string }
interface Manifest {
  startedAt: string; finishedAt: string; by: string; everything: boolean; stopped: boolean; complete: boolean
  requested: number; tables: ManifestTable[]; totalRows: number; totalBytes: number; failed: number; durationMs: number
}
interface Progress {
  running: boolean; startedAt: string | null; by: string | null; folder: string | null
  table: string | null; tableIndex: number; tableTotal: number; tableRows: number; tableEstRows: number
  rows: number; bytes: number; stopping: boolean; result: Manifest | null; error: string | null; finishedAt: string | null
}
interface TableRow { name: string; estRows: number; big: boolean; columns: number }
interface SearchHit { table: string; record: Record<string, unknown>; matchedField: string; matchedValue: string }
type Scope = "all" | "quick" | "pick"

const N = (n: number) => n.toLocaleString("en-GB")
function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
const F_WHEN = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
const fmtWhen = (iso: string | null) => (iso ? F_WHEN.format(new Date(iso)) : "—")
function fmtDur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m} min ${s % 60} s` : `${Math.floor(m / 60)} h ${m % 60} min`
}
/** The folder or file name without the environment prefix. */
const shortKey = (key: string) => key.replace(/^[^/]+\//, "").replace(/\/$/, "")

const CARD = "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl"
const INPUT = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
const LABEL = "block text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-1"
const BTN = "min-h-11 px-4 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
const BTN_BLUE = `${BTN} bg-blue-600 hover:bg-blue-500 text-white`
const BTN_RED = `${BTN} bg-red-600 hover:bg-red-500 text-white`
const BTN_AMBER = `${BTN} bg-amber-500 hover:bg-amber-400 text-white`
const BTN_GREY = `${BTN} border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700`
const OK_BOX = "rounded-lg border border-emerald-300 dark:border-emerald-700/60 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-sm text-emerald-900 dark:text-emerald-100"
const BAD_BOX = "rounded-lg border border-red-300 dark:border-red-700/70 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-900 dark:text-red-100"
const WARN_BOX = "rounded-lg border border-amber-300 dark:border-amber-600/60 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-900 dark:text-amber-100"
const NOTE_BOX = "rounded-lg border border-sky-300 dark:border-sky-700/60 bg-sky-50 dark:bg-sky-950/30 px-4 py-3 text-sm text-sky-950 dark:text-sky-100"

async function readJson(res: Response): Promise<any> {
  const j = await res.json().catch(() => null)
  if (res.status === 401) throw new Error("Your sign-in has run out — reload the page to sign in again.")
  if (!res.ok) throw new Error(j?.error ?? `The Hub's server answered with an error (${res.status}).`)
  return j
}

function whatIsIt(e: Entry): { label: string; cls: string } {
  if (e.inProgress) return { label: "Being written", cls: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300" }
  if (e.kind === "legacy") return { label: e.partial ? "Old style · partial" : "Old style", cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" }
  if (e.stopped) return { label: "Stopped part-way", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" }
  if (e.failed) return { label: `${e.failed} table${e.failed === 1 ? "" : "s"} failed`, cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" }
  if (e.partial) return { label: "Partial", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" }
  return { label: "Full", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" }
}

function RecordViewer({ record }: { record: Record<string, unknown> }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button" onClick={() => setOpen(v => !v)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline min-h-8">
        {open ? "Hide record" : "Show full record"}
      </button>
      {open && (
        <pre className="mt-2 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded p-2 overflow-x-auto max-w-md whitespace-pre-wrap break-all">
          {JSON.stringify(record, null, 2)}
        </pre>
      )}
    </div>
  )
}

export default function BackupPage() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [now, setNow] = useState(0)

  const load = useCallback(async () => {
    try {
      const j = await readJson(await fetch("/api/admin/backup", { cache: "no-store" }))
      setEntries(j.entries)
      setProgress(j.progress)
      setLoadError(null)
    } catch (e: any) {
      setLoadError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  // ── Following a running backup ────────────────────────────────────────────────
  const wasRunning = useRef(false)
  useEffect(() => {
    if (!progress?.running) {
      if (wasRunning.current) { wasRunning.current = false; void load() }
      return
    }
    wasRunning.current = true
    const id = setInterval(async () => {
      setNow(Date.now())
      try { setProgress(await readJson(await fetch("/api/admin/backup/progress", { cache: "no-store" }))) } catch { /* next tick */ }
    }, 1000)
    return () => clearInterval(id)
  }, [progress?.running, load])

  // ── Create ────────────────────────────────────────────────────────────────────
  const [scope, setScope] = useState<Scope>("all")
  const [tables, setTables] = useState<TableRow[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [runError, setRunError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const startingRef = useRef(false)

  useEffect(() => {
    if (scope !== "pick" || tables) return
    void (async () => {
      try {
        const j = await readJson(await fetch("/api/admin/backup/tables", { cache: "no-store" }))
        setTables(j.tables)
        setPicked(new Set((j.tables as TableRow[]).map(t => t.name)))
      } catch (e: any) { setRunError(e.message) }
    })()
  }, [scope, tables])

  async function runBackup() {
    if (startingRef.current) return
    startingRef.current = true
    setStarting(true)
    setRunError(null)
    try {
      const body = scope === "pick" ? { scope: [...picked] } : { scope }
      const j = await readJson(await fetch("/api/admin/backup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }))
      setProgress(j.progress)
      setNow(Date.now())
    } catch (e: any) {
      setRunError(e.message)
    } finally {
      startingRef.current = false
      setStarting(false)
    }
  }
  async function stopRun() {
    try { const j = await readJson(await fetch("/api/admin/backup/stop", { method: "POST" })); setProgress(j.progress) } catch (e: any) { setRunError(e.message) }
  }

  // ── Delete ────────────────────────────────────────────────────────────────────
  const [deleting, setDeleting] = useState<string | null>(null)
  async function remove(key: string) {
    if (!window.confirm(`Delete this backup?\n\n${shortKey(key)}`)) return
    setDeleting(key)
    try {
      await readJson(await fetch("/api/admin/backup", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) }))
      await load()
    } catch (e: any) { setLoadError(e.message) } finally { setDeleting(null) }
  }

  // ── Restore ───────────────────────────────────────────────────────────────────
  const [rKey, setRKey] = useState("")
  const [rManifest, setRManifest] = useState<{ tables: ManifestTable[]; unknown?: string[]; kind: string } | null>(null)
  const [rManifestError, setRManifestError] = useState<string | null>(null)
  const [rPicked, setRPicked] = useState<Set<string>>(new Set())
  const [rConfirm, setRConfirm] = useState("")
  const [restoring, setRestoring] = useState(false)
  const [rEvent, setREvent] = useState<any>(null)
  const [rDone, setRDone] = useState<any>(null)
  const [rError, setRError] = useState<string | null>(null)
  const rAbort = useRef<AbortController | null>(null)

  useEffect(() => {
    setRManifest(null); setRManifestError(null); setRDone(null); setRError(null); setREvent(null)
    if (!rKey) return
    void (async () => {
      try {
        const j = await readJson(await fetch(`/api/admin/backup/manifest?key=${encodeURIComponent(rKey)}`, { cache: "no-store" }))
        const list: ManifestTable[] = j.kind === "folder" ? j.manifest.tables : j.tables
        setRManifest({ kind: j.kind, tables: list, unknown: j.unknown })
        setRPicked(new Set(list.filter(t => t.ok).map(t => t.name)))
      } catch (e: any) { setRManifestError(e.message) }
    })()
  }, [rKey])

  async function restore() {
    if (!rKey || rConfirm !== "CONFIRM" || restoring) return
    setRestoring(true); setRDone(null); setRError(null); setREvent({ stage: "starting", message: "Starting…" })
    const ctl = new AbortController()
    rAbort.current = ctl
    try {
      const all = rManifest ? rManifest.tables.filter(t => t.ok).length : 0
      const body = rPicked.size === all ? { key: rKey } : { key: rKey, tables: [...rPicked] }
      const res = await fetch("/api/admin/restore/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal })
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? "The restore couldn't be started.")
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ""
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split("\n")
        buf = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          try {
            const ev = JSON.parse(line.slice(6))
            setREvent(ev)
            if (ev.stage === "complete" || ev.stage === "stopped") { setRDone(ev); setRConfirm("") }
            if (ev.stage === "error") setRError(ev.message)
          } catch { /* a torn line */ }
        }
      }
    } catch (e: any) {
      if (e?.name === "AbortError") setRDone({ stage: "stopped", message: "Stopped. Rows already put back stay put back; the Hub finishes the batch it had in hand." })
      else setRError(e.message)
    } finally {
      rAbort.current = null
      setRestoring(false)
    }
  }

  // ── Restore lots by barcode ───────────────────────────────────────────────────
  const [bKey, setBKey] = useState("")
  const [bCodes, setBCodes] = useState("")
  const [bBusy, setBBusy] = useState(false)
  const [bResult, setBResult] = useState<string | null>(null)
  const [bError, setBError] = useState<string | null>(null)
  const bList = bCodes.split(/[\n,\s]+/).map(b => b.trim()).filter(Boolean)
  async function restoreLots() {
    if (!bKey || !bList.length || bBusy) return
    setBBusy(true); setBResult(null); setBError(null)
    try {
      const j = await readJson(await fetch("/api/admin/restore", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: bKey, mode: "batch-by-field", tableName: "CatalogueLot", fieldName: "barcode", values: bList }),
      }))
      const bits = [`✓ Put back ${N(j.restored)} of ${N(j.total)} lot${j.total === 1 ? "" : "s"} found in the backup.`]
      if (j.missing?.length) bits.push(`Not in this backup: ${j.missing.slice(0, 20).join(", ")}${j.missing.length > 20 ? ` and ${j.missing.length - 20} more` : ""}.`)
      if (j.errors?.length) bits.push(`Errors: ${j.errors.join("; ")}`)
      setBResult(bits.join(" "))
    } catch (e: any) { setBError(e.message) } finally { setBBusy(false) }
  }

  // ── Record lookup ─────────────────────────────────────────────────────────────
  const [sKey, setSKey] = useState("")
  const [sTerm, setSTerm] = useState("")
  const [sBusy, setSBusy] = useState(false)
  const [sHits, setSHits] = useState<SearchHit[] | null>(null)
  const [sSkipped, setSSkipped] = useState<string[]>([])
  const [sError, setSError] = useState<string | null>(null)
  const [sRestoring, setSRestoring] = useState<string | null>(null)
  const [sMsg, setSMsg] = useState<Record<string, string>>({})
  const hitId = (h: SearchHit, i: number) => `${h.table}:${String(h.record.id ?? h.record.key ?? h.record.filename ?? i)}`
  async function search() {
    if (!sKey || !sTerm.trim() || sBusy) return
    setSBusy(true); setSHits(null); setSError(null); setSMsg({}); setSSkipped([])
    try {
      const j = await readJson(await fetch("/api/admin/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: sKey, mode: "search", search: sTerm }) }))
      setSHits(j.results); setSSkipped(j.skipped ?? [])
    } catch (e: any) { setSError(e.message) } finally { setSBusy(false) }
  }
  async function restoreOne(h: SearchHit, id: string) {
    setSRestoring(id)
    try {
      await readJson(await fetch("/api/admin/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: sKey, mode: "single", tableName: h.table, record: h.record }) }))
      setSMsg(p => ({ ...p, [id]: "Put back." }))
    } catch (e: any) { setSMsg(p => ({ ...p, [id]: `Error: ${e.message}` })) } finally { setSRestoring(null) }
  }

  // ── Derived ───────────────────────────────────────────────────────────────────
  const newestFull = entries.find(e => !e.partial && !e.inProgress && e.kind === "folder" && e.complete) ?? entries.find(e => !e.partial && !e.inProgress)
  const running = !!progress?.running
  const elapsed = progress?.startedAt ? (now || Date.now()) - Date.parse(progress.startedAt) : 0
  const pickable = entries.filter(e => !e.inProgress)
  const backupOption = (e: Entry) => `${fmtWhen(e.at)} — ${whatIsIt(e).label}${e.kind === "folder" ? ` · ${e.tables} tables` : ""} · ${fmtBytes(e.bytes)}`

  return (
    <div className="p-4 md:p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">💾 Database Backup</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Every table in the database, copied to Cloudflare R2 every night as one file per table. The newest 30 copies are kept.
          Photos and files aren&apos;t in it — they already live in R2.
        </p>
      </header>

      {loadError && <div className={BAD_BOX}>{loadError}</div>}

      {/* ── At a glance ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className={`${CARD} px-5 py-4`}>
          <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">Newest full backup</p>
          <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{loading ? "…" : newestFull ? fmtWhen(newestFull.at) : "None yet"}</p>
          {newestFull && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {fmtBytes(newestFull.bytes)}{newestFull.kind === "folder" ? ` · ${newestFull.tables} tables · ${N(newestFull.rows)} rows` : " · old single-file style"}
              {newestFull.failed ? <span className="text-amber-700 dark:text-amber-300"> · {newestFull.failed} failed</span> : null}
            </p>
          )}
        </div>
        <div className={`${CARD} px-5 py-4`}>
          <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">Copies kept</p>
          <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{loading ? "…" : `${entries.length} of 30`}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">The oldest is removed when a new one arrives</p>
        </div>
        <div className={`${CARD} px-5 py-4`}>
          <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">Runs</p>
          <p className="text-lg font-bold text-gray-900 dark:text-gray-100">Every night at midnight UTC</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">On production only — every table, every time. The Status Centre watches it.</p>
        </div>
      </div>

      {/* ── Create ── */}
      <section className={`${CARD} p-5 space-y-4`}>
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Make a backup now</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">The nightly run always copies everything. A manual copy can leave out the big rebuildable tables, or take just the ones you tick.</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-2">
          {([
            ["all", "Everything", "Every table — the same as the nightly copy. Takes a few minutes."],
            ["quick", "Everything except the big copies", "Leaves out the ABC archive, the website's BC lots, the BC warehouse cache, the spelling list and the two logs — all rebuildable. Under a minute."],
            ["pick", "Choose tables", "Tick the tables you want from the full list."],
          ] as [Scope, string, string][]).map(([v, label, blurb]) => (
            <label key={v} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${scope === v ? "bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700" : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700"}`}>
              <input type="radio" name="scope" checked={scope === v} onChange={() => setScope(v)} disabled={running} className="mt-1 accent-blue-600" />
              <span><span className="block text-sm font-semibold text-gray-800 dark:text-gray-200">{label}</span><span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">{blurb}</span></span>
            </label>
          ))}
        </div>
        {scope === "pick" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 dark:text-gray-400">{tables ? `${picked.size} of ${tables.length} tables ticked` : "Loading the table list…"}</span>
              {tables && (
                <span className="flex gap-3 text-xs">
                  <button type="button" onClick={() => setPicked(new Set(tables.map(t => t.name)))} className="text-blue-600 dark:text-blue-400 hover:underline min-h-8">Tick all</button>
                  <button type="button" onClick={() => setPicked(new Set())} className="text-gray-500 hover:underline min-h-8">Untick all</button>
                </span>
              )}
            </div>
            {tables && (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-1 max-h-96 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 p-2">
                {tables.map(t => (
                  <label key={t.name} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer text-sm">
                    <input type="checkbox" checked={picked.has(t.name)} onChange={e => setPicked(p => { const n = new Set(p); if (e.target.checked) n.add(t.name); else n.delete(t.name); return n })} className="accent-blue-600" />
                    <span className="font-mono text-xs text-gray-800 dark:text-gray-200 truncate">{t.name}</span>
                    <span className="ml-auto text-[11px] text-gray-400 whitespace-nowrap">~{N(t.estRows)}{t.big ? " · big" : ""}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {running ? (
            <button type="button" onClick={() => void stopRun()} disabled={progress?.stopping} className={BTN_GREY}>{progress?.stopping ? "Stopping…" : "■ Stop"}</button>
          ) : (
            <button type="button" onClick={() => void runBackup()} disabled={starting || (scope === "pick" && !picked.size)} className={BTN_BLUE}>
              {starting ? "Starting…" : scope === "all" ? "Run full backup" : scope === "quick" ? "Run backup without the big copies" : `Run backup (${picked.size} table${picked.size === 1 ? "" : "s"})`}
            </button>
          )}
          {runError && <span className="text-sm text-red-700 dark:text-red-400">{runError}</span>}
        </div>

        {progress?.running && (
          <div className={`${NOTE_BOX} space-y-1`} aria-live="polite">
            <p className="font-semibold">
              {progress.stopping ? "Stopping after this page of rows…" : `Copying table ${progress.tableIndex} of ${progress.tableTotal} — ${progress.table ?? "…"}`}
            </p>
            <p>
              {N(progress.tableRows)}{progress.tableEstRows > 0 ? ` of about ${N(progress.tableEstRows)}` : ""} rows of this table ·{" "}
              {N(progress.rows)} rows and {fmtBytes(progress.bytes)} so far · running {fmtDur(elapsed)}
              {progress.by && progress.by !== "nightly" ? ` · started by ${progress.by}` : progress.by === "nightly" ? " · the nightly run" : ""}
            </p>
          </div>
        )}
        {!progress?.running && progress?.result && (
          <div className={progress.result.failed || progress.result.stopped ? WARN_BOX : OK_BOX}>
            <p className="font-semibold">
              {progress.result.stopped ? "Stopped part-way: " : ""}
              Copied {N(progress.result.tables.filter(t => t.ok).length)} of {N(progress.result.requested)} tables, {N(progress.result.totalRows)} rows, {fmtBytes(progress.result.totalBytes)} in {fmtDur(progress.result.durationMs)}.
            </p>
            {progress.result.failed > 0 && (
              <p className="mt-1">Not copied: {progress.result.tables.filter(t => !t.ok).map(t => `${t.name} (${t.error ?? "failed"})`).join("; ")}</p>
            )}
          </div>
        )}
        {!progress?.running && progress?.error && <div className={BAD_BOX}>The backup failed: {progress.error}</div>}
      </section>

      {/* ── Stored ── */}
      <section>
        <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-3">Stored backups</h2>
        {loading ? (
          <div className={`${CARD} p-10 text-center text-gray-400 text-sm`}>Loading…</div>
        ) : entries.length === 0 ? (
          <div className={`${CARD} p-12 text-center`}>
            <p className="text-lg font-semibold text-gray-500 dark:text-gray-400">No backups yet</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Press Run full backup to make the first one.</p>
          </div>
        ) : (
          <div className={`${CARD} overflow-x-auto`}>
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  <th className="text-left px-4 py-3">When</th>
                  <th className="text-left px-4 py-3">What</th>
                  <th className="text-right px-4 py-3">Tables</th>
                  <th className="text-right px-4 py-3">Rows</th>
                  <th className="text-right px-4 py-3">Size</th>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {entries.map((e, i) => {
                  const w = whatIsIt(e)
                  return (
                    <tr key={e.key} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-4 py-3 text-gray-800 dark:text-gray-200">
                        {i === 0 && <span className="inline-block mr-2 px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-[10px] rounded font-semibold uppercase tracking-wide border border-blue-100 dark:border-blue-800">Newest</span>}
                        {e.inProgress ? "Now" : fmtWhen(e.at)}
                      </td>
                      <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${w.cls}`}>{w.label}</span></td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-gray-300">{e.kind === "folder" ? N(e.tables) : "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-gray-300">{e.kind === "folder" ? N(e.rows) : "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtBytes(e.bytes)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">{shortKey(e.key)}</td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" onClick={() => void remove(e.key)} disabled={deleting === e.key || (e.inProgress && running)} className="text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-40 min-h-8">
                          {deleting === e.key ? "Deleting…" : "Delete"}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Restore ── */}
      <section className={`${CARD} p-5 space-y-4`}>
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Restore tables from a backup</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Puts every row of the tables you tick back as it was in the backup. Rows made since are left alone, and nothing is deleted.
          </p>
        </div>
        <div>
          <label className={LABEL}>Backup</label>
          <select value={rKey} onChange={e => setRKey(e.target.value)} disabled={restoring} className={INPUT}>
            <option value="">— Choose a backup —</option>
            {pickable.map(e => <option key={e.key} value={e.key}>{backupOption(e)}</option>)}
          </select>
        </div>
        {rManifestError && <div className={BAD_BOX}>{rManifestError}</div>}
        {rManifest && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 dark:text-gray-400">{rPicked.size} of {rManifest.tables.filter(t => t.ok).length} tables ticked · {N(rManifest.tables.filter(t => rPicked.has(t.name)).reduce((n, t) => n + t.rows, 0))} rows</span>
              <span className="flex gap-3 text-xs">
                <button type="button" onClick={() => setRPicked(new Set(rManifest.tables.filter(t => t.ok).map(t => t.name)))} className="text-blue-600 dark:text-blue-400 hover:underline min-h-8">Tick all</button>
                <button type="button" onClick={() => setRPicked(new Set())} className="text-gray-500 hover:underline min-h-8">Untick all</button>
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-1 max-h-96 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 p-2">
              {rManifest.tables.map(t => (
                <label key={t.name} className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm ${t.ok ? "hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer" : "opacity-60"}`} title={t.error}>
                  <input type="checkbox" disabled={!t.ok || restoring} checked={t.ok && rPicked.has(t.name)} onChange={e => setRPicked(p => { const n = new Set(p); if (e.target.checked) n.add(t.name); else n.delete(t.name); return n })} className="accent-blue-600" />
                  <span className="font-mono text-xs text-gray-800 dark:text-gray-200 truncate">{t.name}</span>
                  <span className="ml-auto text-[11px] text-gray-400 whitespace-nowrap">{t.ok ? N(t.rows) : "not copied"}</span>
                </label>
              ))}
            </div>
            {rManifest.unknown?.length ? <p className="text-xs text-gray-500 dark:text-gray-400">In the file but not in this database, so left out: {rManifest.unknown.join(", ")}</p> : null}
          </div>
        )}
        <div className={WARN_BOX}>Rows in the backup overwrite the same rows in the database. Type CONFIRM to enable the button.</div>
        <div className="grid sm:grid-cols-[16rem_auto] gap-3 items-end">
          <div>
            <label className={LABEL}>Type CONFIRM</label>
            <input type="text" value={rConfirm} onChange={e => setRConfirm(e.target.value)} placeholder="CONFIRM" disabled={restoring} className={INPUT} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {restoring ? (
              <button type="button" onClick={() => rAbort.current?.abort()} className={BTN_GREY}>■ Stop</button>
            ) : (
              <button type="button" onClick={() => void restore()} disabled={!rKey || !rManifest || rConfirm !== "CONFIRM" || !rPicked.size} className={BTN_RED}>
                Restore {rPicked.size} table{rPicked.size === 1 ? "" : "s"}
              </button>
            )}
          </div>
        </div>
        {restoring && rEvent && (
          <div className={`${NOTE_BOX} space-y-2`} aria-live="polite">
            <p className="font-semibold">
              {rEvent.stage === "restoring"
                ? `Table ${rEvent.tableIndex} of ${rEvent.tableTotal} — ${rEvent.table}: ${N(rEvent.tableDone)} of ${N(rEvent.tableRows)} rows`
                : rEvent.message}
            </p>
            {rEvent.stage === "restoring" && (
              <>
                <p>{N(rEvent.rowsDone)} of {N(rEvent.rowsTotal)} rows overall ({rEvent.pct}%){rEvent.failed ? ` · ${N(rEvent.failed)} couldn't be put back` : ""}</p>
                <div className="w-full bg-white/60 dark:bg-black/30 rounded-full h-2.5 overflow-hidden"><div className="h-2.5 bg-blue-500 transition-all" style={{ width: `${rEvent.pct}%` }} /></div>
              </>
            )}
          </div>
        )}
        {rDone && (
          <div className={rDone.failed || rDone.stage === "stopped" ? WARN_BOX : OK_BOX}>
            <p className="font-semibold">{rDone.message}</p>
            {rDone.notes?.map((n: string, i: number) => <p key={i} className="mt-1">{n}</p>)}
            {rDone.skippedColumns?.length ? <p className="mt-1">Columns in the backup the database no longer has (left out): {rDone.skippedColumns.join(", ")}</p> : null}
            {rDone.errors?.length ? <ul className="mt-1 list-disc pl-5">{rDone.errors.map((e: string, i: number) => <li key={i} className="font-mono text-xs">{e}</li>)}</ul> : null}
          </div>
        )}
        {rError && <div className={BAD_BOX}>{rError}</div>}
      </section>

      {/* ── Lots by barcode ── */}
      <section className={`${CARD} border-amber-300 dark:border-amber-700 p-5 space-y-4`}>
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Restore lots by barcode</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Puts back just the catalogue lots you list, from the backup you choose. Nothing else is touched.</p>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className={LABEL}>Backup</label>
            <select value={bKey} onChange={e => { setBKey(e.target.value); setBResult(null); setBError(null) }} className={INPUT}>
              <option value="">— Choose a backup —</option>
              {pickable.map(e => <option key={e.key} value={e.key}>{backupOption(e)}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL}>Barcodes (one per line, or comma-separated)</label>
            <textarea value={bCodes} onChange={e => setBCodes(e.target.value)} rows={5} placeholder={"F082586\nF082587\nF082588"} className={`${INPUT} font-mono resize-none`} />
            <p className="text-xs text-gray-400 mt-1">{bList.length} barcode{bList.length === 1 ? "" : "s"}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void restoreLots()} disabled={bBusy || !bKey || !bList.length} className={BTN_AMBER}>{bBusy ? "Restoring…" : "Restore these lots"}</button>
          {bError && <span className="text-sm text-red-700 dark:text-red-400">{bError}</span>}
        </div>
        {bResult && <div className={OK_BOX}>{bResult}</div>}
      </section>

      {/* ── Lookup ── */}
      <section className={`${CARD} p-5 space-y-4`}>
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Find a record in a backup</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Searches every text field in every table of a backup for what you type, and can put a single row back. The very big tables are skipped and named.</p>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className={LABEL}>Backup</label>
            <select value={sKey} onChange={e => { setSKey(e.target.value); setSHits(null); setSError(null) }} className={INPUT}>
              <option value="">— Choose a backup —</option>
              {pickable.map(e => <option key={e.key} value={e.key}>{backupOption(e)}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL}>Search for</label>
            <input type="text" value={sTerm} onChange={e => setSTerm(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void search() }} placeholder="e.g. F082586, or an email address" className={INPUT} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void search()} disabled={sBusy || !sKey || !sTerm.trim()} className={BTN_BLUE}>{sBusy ? "Searching…" : "Search the backup"}</button>
          {sError && <span className="text-sm text-red-700 dark:text-red-400">{sError}</span>}
        </div>
        {sHits !== null && (
          <div className="space-y-2">
            {sSkipped.length > 0 && <p className="text-xs text-gray-500 dark:text-gray-400">Not searched (too big): {sSkipped.join(", ")}. Restore those by table above, or by barcode.</p>}
            {sHits.length === 0 ? (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-5 py-8 text-center">
                <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">Nothing found</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">No text field in any searched table contains &ldquo;{sTerm}&rdquo;.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
                <p className="text-xs text-gray-500 dark:text-gray-400 px-4 py-2">{sHits.length} result{sHits.length === 1 ? "" : "s"}{sHits.length >= 200 ? " — the first 200; narrow the search to see the rest" : ""}</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      <th className="text-left px-4 py-2">Table</th>
                      <th className="text-left px-4 py-2">Field</th>
                      <th className="text-left px-4 py-2">Value</th>
                      <th className="text-left px-4 py-2">Record</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {sHits.map((h, i) => {
                      const id = hitId(h, i)
                      const msg = sMsg[id]
                      return (
                        <tr key={id} className="align-top hover:bg-gray-50 dark:hover:bg-gray-800/50">
                          <td className="px-4 py-2 font-mono text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap">{h.table}</td>
                          <td className="px-4 py-2 font-mono text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap">{h.matchedField}</td>
                          <td className="px-4 py-2 text-xs text-gray-800 dark:text-gray-200 max-w-xs truncate" title={h.matchedValue}>{h.matchedValue}</td>
                          <td className="px-4 py-2"><RecordViewer record={h.record} /></td>
                          <td className="px-4 py-2 text-right whitespace-nowrap">
                            {msg ? <span className={`text-xs ${msg.startsWith("Error") ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>{msg}</span> : (
                              <button type="button" onClick={() => void restoreOne(h, id)} disabled={sRestoring === id} className="min-h-9 px-3 rounded-md bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-white text-xs font-semibold">
                                {sRestoring === id ? "Restoring…" : "Put this row back"}
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
