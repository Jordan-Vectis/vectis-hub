"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"

export const dynamic = "force-dynamic"

interface BackupFile {
  key: string
  sizeBytes: number
  lastModified: string | null
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

export default function BackupPage() {
  const [files, setFiles] = useState<BackupFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<string | null>(null)

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

  const latest = files[0] ?? null

  return (
    <div className="p-8 max-w-4xl space-y-6">

      {/* Header */}
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

      {/* Status banners */}
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

      {/* Stat cards */}
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

      {/* Schedule info */}
      <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 text-sm text-gray-500">
        <span className="text-gray-700 font-semibold">Scheduled:</span> daily at 02:00 UTC via{" "}
        <code className="text-xs bg-gray-100 px-1 py-0.5 rounded font-mono">/api/cron/db-backup</code>
        {" "}— authenticated with{" "}
        <code className="text-xs bg-gray-100 px-1 py-0.5 rounded font-mono">CRON_SECRET</code>.
      </div>

      {/* File list */}
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
    </div>
  )
}
