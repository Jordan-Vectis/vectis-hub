"use client"

import { useEffect, useState, useCallback } from "react"

export const dynamic = "force-dynamic"

interface BackupFile {
  key: string
  sizeBytes: number
  lastModified: string | null
}

interface SearchResult {
  table: string
  record: any
  matchedField: string
  matchedValue: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

/** Extract a readable date from a backup key like staging/backup-2026-05-15-120000.json */
function keyToDate(key: string): string {
  const match = key.match(/backup-(\d{4}-\d{2}-\d{2}-\d{6})/)
  if (!match) return key
  const [datePart, timePart] = [match[1].slice(0, 10), match[1].slice(11)]
  const hh = timePart.slice(0, 2)
  const mm = timePart.slice(2, 4)
  const ss = timePart.slice(4, 6)
  return `${datePart} at ${hh}:${mm}:${ss} UTC`
}

// ── Collapsible JSON viewer ────────────────────────────────────────────────────
function RecordViewer({ record }: { record: any }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className="text-xs text-blue-600 hover:underline"
      >
        {open ? "Hide record" : "Show full record"}
      </button>
      {open && (
        <pre className="mt-2 text-xs bg-gray-50 border border-gray-200 rounded p-2 overflow-x-auto max-w-xs whitespace-pre-wrap break-all">
          {JSON.stringify(record, null, 2)}
        </pre>
      )}
    </div>
  )
}

export default function BackupPage() {
  const [files, setFiles] = useState<BackupFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<string | null>(null)

  // ── Full restore state ───────────────────────────────────────────────────────
  const [restoreKey, setRestoreKey] = useState("")
  const [restoreConfirm, setRestoreConfirm] = useState("")
  const [restoring, setRestoring] = useState(false)
  const [restoreResult, setRestoreResult] = useState<string | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [restorePct, setRestorePct] = useState(0)
  const [restoreMessage, setRestoreMessage] = useState("")

  // ── Record lookup state ─────────────────────────────────────────────────────
  const [lookupKey, setLookupKey] = useState("")
  const [lookupSearch, setLookupSearch] = useState("")
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [restoringRecord, setRestoringRecord] = useState<string | null>(null) // record id being restored
  const [recordRestoreMsg, setRecordRestoreMsg] = useState<Record<string, string>>({})

  const fetchFiles = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/backup")
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to load backups")
      setFiles(data.files)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchFiles()
  }, [fetchFiles])

  async function handleRunBackup() {
    setRunning(true)
    setRunResult(null)
    setError(null)
    try {
      const res = await fetch("/api/admin/backup", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Backup failed")
      setRunResult(
        `Backup complete: ${data.filename} (${formatBytes(data.sizeBytes)})${
          data.deleted > 0 ? `, ${data.deleted} old backup(s) pruned` : ""
        }`
      )
      await fetchFiles()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setRunning(false)
    }
  }

  async function handleFullRestore() {
    if (!restoreKey || restoreConfirm !== "CONFIRM") return
    setRestoring(true)
    setRestoreResult(null)
    setRestoreError(null)
    setRestorePct(0)
    setRestoreMessage("Starting restore…")
    try {
      const res = await fetch("/api/admin/restore/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: restoreKey }),
      })
      if (!res.ok || !res.body) throw new Error("Failed to start restore stream")

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          try {
            const event = JSON.parse(line.slice(6))
            setRestorePct(event.pct ?? 0)
            setRestoreMessage(event.message ?? "")
            if (event.stage === "complete") {
              setRestoreResult(event.message)
              setRestoreConfirm("")
            }
            if (event.stage === "error") {
              setRestoreError(event.message)
            }
          } catch {}
        }
      }
    } catch (e: any) {
      setRestoreError(e.message)
    } finally {
      setRestoring(false)
    }
  }

  async function handleSearch() {
    if (!lookupKey || !lookupSearch.trim()) return
    setSearching(true)
    setSearchResults(null)
    setSearchError(null)
    setRecordRestoreMsg({})
    try {
      const res = await fetch("/api/admin/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: lookupKey, mode: "search", search: lookupSearch }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Search failed")
      setSearchResults(data.results)
    } catch (e: any) {
      setSearchError(e.message)
    } finally {
      setSearching(false)
    }
  }

  async function handleRestoreRecord(result: SearchResult) {
    const recordId = result.record?.id ?? result.record?.key ?? result.record?.filename ?? JSON.stringify(result.record).slice(0, 40)
    setRestoringRecord(recordId)
    try {
      const res = await fetch("/api/admin/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: lookupKey, mode: "single", tableName: result.table, record: result.record }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Restore failed")
      setRecordRestoreMsg(prev => ({ ...prev, [recordId]: "Record restored." }))
    } catch (e: any) {
      setRecordRestoreMsg(prev => ({ ...prev, [recordId]: `Error: ${e.message}` }))
    } finally {
      setRestoringRecord(null)
    }
  }

  const latest = files[0] ?? null

  return (
    <div className="p-8 max-w-4xl space-y-8">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Database Backup</h1>
          <p className="text-sm text-gray-500 mt-1">
            Daily JSON exports of the entire database, stored in Cloudflare R2.
            The last 30 backups are retained automatically.
          </p>
        </div>
        <button
          onClick={handleRunBackup}
          disabled={running}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {running ? "Running backup…" : "Run backup now"}
        </button>
      </div>

      {/* ── Status banners ──────────────────────────────────────────────────── */}
      {runResult && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-3 text-sm text-green-700">
          {runResult}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Stat cards ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: "Last Backup",      value: latest ? formatDate(latest.lastModified) : "No backups yet" },
          { label: "Last Backup Size", value: latest ? formatBytes(latest.sizeBytes) : "—" },
          { label: "Total Backups",    value: loading ? "…" : String(files.length) },
        ].map(card => (
          <div key={card.label} className="bg-white border border-gray-200 rounded-xl px-5 py-4">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">{card.label}</p>
            <p className="text-lg font-bold text-slate-800">{card.value}</p>
          </div>
        ))}
      </div>

      {/* ── Schedule info ───────────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 text-sm text-gray-500">
        <span className="text-gray-700 font-semibold">Scheduled:</span> daily at midnight UTC via{" "}
        <code className="text-xs bg-gray-100 px-1 py-0.5 rounded font-mono">/api/cron/db-backup</code>
        {" "}— authenticated with{" "}
        <code className="text-xs bg-gray-100 px-1 py-0.5 rounded font-mono">CRON_SECRET</code>.
      </div>

      {/* ── File list ───────────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-3">Stored Backups</h2>

        {loading && (
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-400 text-sm">
            Loading…
          </div>
        )}

        {!loading && files.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-16 text-center">
            <p className="text-lg font-semibold text-gray-500 mb-1">No backups yet</p>
            <p className="text-sm text-gray-400">Click &ldquo;Run backup now&rdquo; to create the first one.</p>
          </div>
        )}

        {!loading && files.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-400 uppercase tracking-wider">
                  <th className="text-left px-5 py-3">Filename</th>
                  <th className="text-right px-5 py-3">Size</th>
                  <th className="text-right px-5 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {files.map((f, i) => (
                  <tr key={f.key} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3.5 font-mono text-gray-600 text-xs">
                      {i === 0 && (
                        <span className="inline-block mr-2 px-1.5 py-0.5 bg-blue-50 text-blue-600 text-[10px] rounded font-sans font-semibold uppercase tracking-wide border border-blue-100">
                          Latest
                        </span>
                      )}
                      {f.key}
                    </td>
                    <td className="px-5 py-3.5 text-right text-gray-500 tabular-nums">{formatBytes(f.sizeBytes)}</td>
                    <td className="px-5 py-3.5 text-right text-gray-500 tabular-nums">{formatDate(f.lastModified)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          Full Restore
      ════════════════════════════════════════════════════════════════════════ */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
        <div>
          <h2 className="text-base font-bold text-gray-900">Full Restore</h2>
          <p className="text-sm text-gray-500 mt-1">
            Upsert every record from a backup file into the current database. Records created
            after the backup date will not be affected.
          </p>
        </div>

        {/* Backup selector */}
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
            Backup file
          </label>
          <select
            value={restoreKey}
            onChange={e => { setRestoreKey(e.target.value); setRestoreResult(null); setRestoreError(null) }}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— Select a backup —</option>
            {files.map(f => (
              <option key={f.key} value={f.key}>
                {keyToDate(f.key)} — {formatBytes(f.sizeBytes)}
              </option>
            ))}
          </select>
          {restoreKey && (
            <p className="text-xs text-gray-400 font-mono mt-1">{restoreKey}</p>
          )}
        </div>

        {/* Warning */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          This will overwrite existing records with data from the selected backup. Records created after the backup date will not be affected.
        </div>

        {/* Confirmation input */}
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
            Type CONFIRM to enable restore
          </label>
          <input
            type="text"
            value={restoreConfirm}
            onChange={e => setRestoreConfirm(e.target.value)}
            placeholder="CONFIRM"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Restore button */}
        <button
          onClick={handleFullRestore}
          disabled={restoring || !restoreKey || restoreConfirm !== "CONFIRM"}
          className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {restoring ? "Restoring…" : "Restore from backup"}
        </button>

        {/* Progress bar */}
        {restoring && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-gray-500">
              <span>{restoreMessage}</span>
              <span className="font-mono font-semibold">{restorePct}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className="h-3 rounded-full bg-blue-500 transition-all duration-300"
                style={{ width: `${restorePct}%` }}
              />
            </div>
          </div>
        )}

        {restoreResult && (
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">
            {restoreResult}
          </div>
        )}
        {restoreError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            {restoreError}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          Record Lookup
      ════════════════════════════════════════════════════════════════════════ */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
        <div>
          <h2 className="text-base font-bold text-gray-900">Record Lookup</h2>
          <p className="text-sm text-gray-500 mt-1">
            Search across all tables in a backup file for any record containing a specific value.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {/* Backup selector */}
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Backup file
            </label>
            <select
              value={lookupKey}
              onChange={e => { setLookupKey(e.target.value); setSearchResults(null); setSearchError(null) }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Select a backup —</option>
              {files.map(f => (
                <option key={f.key} value={f.key}>
                  {keyToDate(f.key)} — {formatBytes(f.sizeBytes)}
                </option>
              ))}
            </select>
          </div>

          {/* Search term */}
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Search term
            </label>
            <input
              type="text"
              value={lookupSearch}
              onChange={e => setLookupSearch(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleSearch() }}
              placeholder="e.g. john@example.com"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <button
          onClick={handleSearch}
          disabled={searching || !lookupKey || !lookupSearch.trim()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {searching ? "Searching…" : "Search backup"}
        </button>

        {searchError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            {searchError}
          </div>
        )}

        {searchResults !== null && (
          <div>
            {searchResults.length === 0 ? (
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-5 py-8 text-center">
                <p className="text-sm font-semibold text-gray-500">No records found</p>
                <p className="text-xs text-gray-400 mt-1">No string field in any table matched &ldquo;{lookupSearch}&rdquo;.</p>
              </div>
            ) : (
              <div>
                <p className="text-xs text-gray-400 mb-3">{searchResults.length} result(s) found</p>
                <div className="border border-gray-200 rounded-xl overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-400 uppercase tracking-wider">
                        <th className="text-left px-4 py-3">Table</th>
                        <th className="text-left px-4 py-3">Field matched</th>
                        <th className="text-left px-4 py-3">Value</th>
                        <th className="text-left px-4 py-3">Full record</th>
                        <th className="px-4 py-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {searchResults.map((result, i) => {
                        const recordId = result.record?.id ?? result.record?.key ?? result.record?.filename ?? String(i)
                        const msg = recordRestoreMsg[recordId]
                        return (
                          <tr key={i} className="hover:bg-gray-50 transition-colors align-top">
                            <td className="px-4 py-3 font-mono text-xs text-gray-600 whitespace-nowrap">{result.table}</td>
                            <td className="px-4 py-3 font-mono text-xs text-gray-600 whitespace-nowrap">{result.matchedField}</td>
                            <td className="px-4 py-3 text-xs text-gray-800 max-w-xs truncate" title={result.matchedValue}>
                              {result.matchedValue}
                            </td>
                            <td className="px-4 py-3">
                              <RecordViewer record={result.record} />
                            </td>
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              {msg ? (
                                <span className={`text-xs ${msg.startsWith("Error") ? "text-red-600" : "text-green-600"}`}>{msg}</span>
                              ) : (
                                <button
                                  onClick={() => handleRestoreRecord(result)}
                                  disabled={restoringRecord === recordId}
                                  className="px-3 py-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-md transition-colors"
                                >
                                  {restoringRecord === recordId ? "Restoring…" : "Restore this record"}
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
