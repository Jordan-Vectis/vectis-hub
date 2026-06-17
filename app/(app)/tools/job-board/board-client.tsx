"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { createITJob, updateITJobStatus, deleteITJob, syncITMailboxNow } from "@/lib/actions/it-jobs"

type Job = {
  id: string
  title: string
  body: string
  fromName: string | null
  fromEmail: string | null
  status: string
  source: string
  webLink: string | null
  date: string
}

const COLUMNS: { key: string; label: string; dot: string; head: string }[] = [
  { key: "NEW",         label: "New",         dot: "bg-blue-500",   head: "text-blue-600 dark:text-blue-400" },
  { key: "IN_PROGRESS", label: "In Progress", dot: "bg-amber-500",  head: "text-amber-600 dark:text-amber-400" },
  { key: "WAITING",     label: "Waiting",     dot: "bg-purple-500", head: "text-purple-600 dark:text-purple-400" },
  { key: "DONE",        label: "Done",        dot: "bg-green-500",  head: "text-green-600 dark:text-green-400" },
]

export default function BoardClient({
  jobs,
  configured,
  connected,
  connectedBy,
  lastSync,
  mbConnected,
  mbError,
}: {
  jobs: Job[]
  configured: boolean
  connected: boolean
  connectedBy: string | null
  lastSync: string | null
  mbConnected: boolean
  mbError: string | null
}) {
  const [isPending, startTransition] = useTransition()
  const [showAdd, setShowAdd] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  function moveJob(id: string, status: string) {
    startTransition(async () => { await updateITJobStatus(id, status) })
  }
  function removeJob(id: string) {
    if (!confirm("Delete this job?")) return
    startTransition(async () => { await deleteITJob(id) })
  }
  function syncNow() {
    setSyncMsg(null)
    startTransition(async () => {
      const r = await syncITMailboxNow()
      setSyncMsg(r.ok ? `Synced — ${r.created} new job${r.created !== 1 ? "s" : ""}.` : `Error: ${r.error}`)
    })
  }

  const card = "bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800"

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Job Board</h1>
          <p className="text-base text-gray-500 mt-1">IT jobs from the IT@vectis.co.uk inbox, plus anything added by hand.</p>
        </div>
        <button
          onClick={() => setShowAdd((s) => !s)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-base font-semibold px-6 py-3 rounded-xl transition-colors"
        >
          + Add job
        </button>
      </div>

      {/* Banners */}
      {mbConnected && (
        <div className="mb-4 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700/40 px-4 py-3 text-green-800 dark:text-green-300 text-sm">
          Mailbox connected. New emails will appear here automatically.
        </div>
      )}
      {mbError && (
        <div className="mb-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/40 px-4 py-3 text-red-800 dark:text-red-300 text-sm break-words">
          Mailbox error: {mbError}
        </div>
      )}

      {/* Mailbox connection bar */}
      <div className={`${card} p-4 mb-5 flex items-center justify-between gap-4 flex-wrap`}>
        <div className="flex items-center gap-3">
          <span className={`w-2.5 h-2.5 rounded-full ${connected ? "bg-green-500" : "bg-gray-400"}`} />
          <div>
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              {connected ? "IT mailbox connected" : "IT mailbox not connected"}
            </p>
            <p className="text-xs text-gray-400">
              {!configured
                ? "Graph credentials not set on the server yet."
                : connected
                  ? `Connected by ${connectedBy ?? "—"}${lastSync ? ` · last checked ${lastSync}` : ""}`
                  : "Connect once to start pulling emails in automatically."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {connected && (
            <button
              onClick={syncNow}
              disabled={isPending}
              className="text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
            >
              {isPending ? "Working…" : "Sync now"}
            </button>
          )}
          <a
            href="/api/it-mailbox/auth"
            className="text-sm bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded-xl transition-colors"
          >
            {connected ? "Reconnect" : "Connect IT mailbox"}
          </a>
        </div>
      </div>
      {syncMsg && <p className="text-sm text-gray-500 mb-4">{syncMsg}</p>}

      {/* Add job form */}
      {showAdd && (
        <form action={createITJob} className={`${card} p-5 mb-5 space-y-3`}>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Add a job</h2>
          <input
            name="title"
            required
            placeholder="Job title *"
            className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <textarea
            name="body"
            rows={3}
            placeholder="Details (optional)"
            className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input name="fromName" placeholder="Requested by (optional)" className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <input name="fromEmail" type="email" placeholder="Their email (optional)" className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex gap-3">
            <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white text-base font-semibold px-6 py-3 rounded-xl transition-colors">Add job</button>
            <button type="button" onClick={() => setShowAdd(false)} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 font-semibold px-4 py-3 text-base">Cancel</button>
          </div>
        </form>
      )}

      {/* Board */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map((col) => {
          const colJobs = jobs.filter((j) => j.status === col.key)
          return (
            <div key={col.key} className="flex-shrink-0 w-80">
              <div className="flex items-center justify-between mb-3 px-1">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${col.dot}`} />
                  <span className={`text-sm font-bold uppercase tracking-wide ${col.head}`}>{col.label}</span>
                </div>
                <span className="text-sm font-semibold text-gray-400">{colJobs.length}</span>
              </div>
              <div className="space-y-2">
                {colJobs.map((job) => (
                  <div key={job.id} className={`${card} p-4`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-gray-900 dark:text-white text-sm break-words">{job.title}</p>
                      <button
                        onClick={() => removeJob(job.id)}
                        disabled={isPending}
                        className="text-gray-300 hover:text-red-500 text-sm flex-shrink-0"
                        aria-label="Delete job"
                      >
                        ✕
                      </button>
                    </div>
                    {job.body && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-4 break-words">{job.body}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-2 text-xs text-gray-400">
                      {job.fromName && <span>{job.fromName}</span>}
                      {job.fromName && <span>·</span>}
                      <span>{job.date}</span>
                      <span>·</span>
                      <span className={job.source === "EMAIL" ? "text-blue-500" : "text-gray-400"}>
                        {job.source === "EMAIL" ? "email" : "manual"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <select
                        value={job.status}
                        disabled={isPending}
                        onChange={(e) => moveJob(job.id, e.target.value)}
                        className="flex-1 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {COLUMNS.map((c) => (
                          <option key={c.key} value={c.key}>{c.label}</option>
                        ))}
                      </select>
                      {job.webLink && (
                        <a
                          href={job.webLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                        >
                          Open email
                        </a>
                      )}
                    </div>
                  </div>
                ))}
                {colJobs.length === 0 && (
                  <div className="text-xs text-gray-300 dark:text-gray-600 px-1 py-3">No jobs</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
