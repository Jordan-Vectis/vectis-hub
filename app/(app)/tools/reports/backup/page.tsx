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
    <div className="min-h-full flex flex-col">
      {/* ── Page header ── */}
      <div className="border-b border-gray-800 bg-[#1C1C1E] px-6 py-5">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
            <Link href="/hub" className="hover:text-gray-300 transition-colors">Hub</Link>
            <span>/</span>
            <Link href="/tools/reports" className="hover:text-gray-300 transition-colors">Reports</Link>
            <span>/</span>
            <span className="text-gray-300">Backup</span>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-white">Database Backup</h1>
              <p className="text-sm text-gray-400 mt-0.5">
                Daily JSON exports of the entire database, stored in Cloudflare R2.
                The last 30 backups are retained automatically.
              </p>
            </div>
            <button
              onClick={handleRunBackup}
              disabled={running}
              className="px-4 py-2 bg-[#2AB4A6] hover:bg-[#24a396] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {running ? "Running backup…" : "Run backup now"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 px-6 py-8">
        <div className="max-w-7xl mx-auto space-y-6">

          {/* Status banners */}
          {runResult && (
            <div className="bg-green-950/40 border border-green-800 rounded-xl px-5 py-3 text-sm text-green-300">
              {runResult}
            </div>
          )}
          {error && (
            <div className="bg-red-950/40 border border-red-800 rounded-xl px-5 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {/* Last backup card */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                label: "Last Backup",
                value: latest ? formatDate(latest.lastModified) : "No backups yet",
                accent: "border-l-[#2AB4A6]",
              },
              {
                label: "Last Backup Size",
                value: latest ? formatBytes(latest.sizeBytes) : "—",
                accent: "border-l-blue-500",
              },
              {
                label: "Total Backups",
                value: loading ? "…" : String(files.length),
                accent: "border-l-amber-500",
              },
            ].map(card => (
              <div
                key={card.label}
                className={`bg-[#1C1C1E] border border-gray-800 border-l-2 ${card.accent} rounded-xl px-5 py-4`}
              >
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">{card.label}</p>
                <p className="text-lg font-bold text-white tabular-nums">{card.value}</p>
              </div>
            ))}
          </div>

          {/* Schedule info */}
          <div className="bg-[#1C1C1E] border border-gray-800 rounded-xl px-5 py-4 text-sm text-gray-400">
            <span className="text-gray-200 font-semibold">Scheduled:</span> daily at 02:00 UTC via{" "}
            <code className="text-xs bg-white/10 px-1 py-0.5 rounded font-mono">/api/cron/db-backup</code>{" "}
            &mdash; authenticated with <code className="text-xs bg-white/10 px-1 py-0.5 rounded font-mono">CRON_SECRET</code>.
          </div>

          {/* File list */}
          <div>
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
              Stored Backups
            </h2>

            {loading && (
              <div className="bg-[#1C1C1E] border border-gray-800 rounded-xl p-10 text-center text-gray-500 text-sm">
                Loading…
              </div>
            )}

            {!loading && files.length === 0 && (
              <div className="bg-[#1C1C1E] border border-gray-800 rounded-xl p-16 text-center">
                <p className="text-lg font-semibold text-gray-300 mb-1">No backups yet</p>
                <p className="text-sm text-gray-500">Click &ldquo;Run backup now&rdquo; to create the first one.</p>
              </div>
            )}

            {!loading && files.length > 0 && (
              <div className="bg-[#1C1C1E] border border-gray-800 rounded-xl overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
                      <th className="text-left px-5 py-3">Filename</th>
                      <th className="text-right px-5 py-3">Size</th>
                      <th className="text-right px-5 py-3">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/60">
                    {files.map((f, i) => (
                      <tr
                        key={f.key}
                        className={`transition-colors ${
                          i === 0 ? "bg-white/[0.03]" : "hover:bg-white/[0.02]"
                        }`}
                      >
                        <td className="px-5 py-3.5 font-mono text-gray-300 text-xs">
                          {i === 0 && (
                            <span className="inline-block mr-2 px-1.5 py-0.5 bg-[#2AB4A6]/20 text-[#2AB4A6] text-[10px] rounded font-sans font-semibold uppercase tracking-wide">
                              Latest
                            </span>
                          )}
                          {f.key}
                        </td>
                        <td className="px-5 py-3.5 text-right text-gray-400 tabular-nums">
                          {formatBytes(f.sizeBytes)}
                        </td>
                        <td className="px-5 py-3.5 text-right text-gray-400 tabular-nums">
                          {formatDate(f.lastModified)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
