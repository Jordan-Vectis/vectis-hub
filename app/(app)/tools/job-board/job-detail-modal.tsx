"use client"

import { useState, useTransition } from "react"
import {
  updateITJobStatus, assignITJob, addITJobNote, clearITJobReplyFlag, deleteITJob,
} from "@/lib/actions/it-jobs"

type Message = { id: string; kind: string; authorName: string | null; body: string; when: string }
type Job = {
  id: string; title: string; body: string
  fromName: string | null; fromEmail: string | null
  status: string; source: string; webLink: string | null
  assignedToId: string | null; assignedToName: string | null
  hasNewReply: boolean; date: string; messages: Message[]
}

const STATUSES: [string, string][] = [
  ["NEW", "New"], ["IN_PROGRESS", "In Progress"], ["WAITING", "Waiting"], ["DONE", "Done"],
]

export default function JobDetailModal({
  job,
  itStaff,
  onClose,
}: {
  job: Job
  itStaff: { id: string; name: string }[]
  onClose: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [note, setNote] = useState("")

  const run = (fn: () => Promise<any>) => startTransition(async () => { await fn() })

  function postNote() {
    const text = note.trim()
    if (!text) return
    setNote("")
    run(() => addITJobNote(job.id, text))
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start sm:items-center justify-center p-0 sm:p-6 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#1C1C1E] w-full max-w-3xl sm:rounded-2xl border border-gray-200 dark:border-gray-800 min-h-screen sm:min-h-0 sm:my-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-6 border-b border-gray-100 dark:border-gray-800">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white break-words">{job.title}</h2>
            <p className="text-sm text-gray-400 mt-1">
              {job.fromName ?? job.fromEmail ?? "Manual job"}{job.fromEmail && job.fromName ? ` · ${job.fromEmail}` : ""} · {job.date} · {job.source === "EMAIL" ? "from mailbox" : "added manually"}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl leading-none flex-shrink-0" aria-label="Close">&times;</button>
        </div>

        <div className="p-6 space-y-6">
          {/* New reply banner */}
          {job.hasNewReply && (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 px-4 py-3">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">📨 New customer reply on this job</p>
              <button onClick={() => run(() => clearITJobReplyFlag(job.id))} disabled={isPending} className="text-sm font-semibold text-amber-700 dark:text-amber-300 hover:underline">Mark as seen</button>
            </div>
          )}

          {/* Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Status</label>
              <select
                value={job.status}
                disabled={isPending}
                onChange={(e) => run(() => updateITJobStatus(job.id, e.target.value))}
                className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Assigned to</label>
              <select
                value={job.assignedToId ?? ""}
                disabled={isPending}
                onChange={(e) => run(() => assignITJob(job.id, e.target.value || null))}
                className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Unassigned —</option>
                {itStaff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                {itStaff.length === 0 && <option disabled>No IT staff set up yet</option>}
              </select>
            </div>
          </div>

          {/* Original message */}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Original message</p>
            <div className="rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 p-4 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words max-h-72 overflow-y-auto">
              {job.body || <span className="text-gray-400">No content</span>}
            </div>
          </div>

          {/* Conversation */}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Conversation</p>
            <div className="space-y-3 mb-3">
              {job.messages.length === 0 && (
                <p className="text-sm text-gray-400">No replies or notes yet.</p>
              )}
              {job.messages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-xl p-3 border ${
                    m.kind === "REPLY"
                      ? "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700/40"
                      : "bg-gray-50 dark:bg-gray-800/50 border-gray-100 dark:border-gray-800"
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
                    <span className={`font-semibold ${m.kind === "REPLY" ? "text-blue-600 dark:text-blue-400" : "text-gray-600 dark:text-gray-300"}`}>
                      {m.authorName ?? "Unknown"}
                    </span>
                    <span>·</span>
                    <span>{m.when}</span>
                    {m.kind === "REPLY" && <span className="bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 px-1.5 py-0.5 rounded text-xs">customer reply</span>}
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words">{m.body}</p>
                </div>
              ))}
            </div>

            {/* Add note */}
            <div className="flex gap-2">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Add an internal note for the IT team…"
                className="flex-1 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
              <button
                onClick={postNote}
                disabled={isPending || !note.trim()}
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 rounded-xl transition-colors disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>

          {/* Footer actions */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-800">
            {job.webLink ? (
              <a href={job.webLink} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Open original email ↗</a>
            ) : <span />}
            <button
              onClick={() => { if (confirm("Delete this job?")) { run(() => deleteITJob(job.id)); onClose() } }}
              disabled={isPending}
              className="text-sm text-red-500 hover:text-red-700 font-semibold"
            >
              Delete job
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
