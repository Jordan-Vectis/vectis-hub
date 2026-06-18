"use client"

import { useState, useTransition } from "react"
import {
  updateITJobStatus, assignITJob, addITJobNote, clearITJobReplyFlag, deleteITJob, setITJobDueDate,
} from "@/lib/actions/it-jobs"

type JobImage = { id: string; filename: string; url: string }
type Message = { id: string; kind: string; authorName: string | null; body: string; bodyHtml: string | null; when: string; images: JobImage[] }
type Job = {
  id: string; title: string; body: string; bodyHtml: string | null
  fromName: string | null; fromEmail: string | null
  status: string; source: string; webLink: string | null
  assignedToId: string | null; assignedToName: string | null
  hasNewReply: boolean
  dueDate: string | null; dueLabel: string | null; dueStatus: string | null
  date: string; images: JobImage[]; messages: Message[]
}

// Render the email body: the real (sanitised) HTML on a white email-style panel
// when we have it, otherwise the plain text. HTML is sanitised server-side.
function EmailBody({ html, text }: { html: string | null; text: string }) {
  if (html) {
    return (
      <div
        className="bg-white text-gray-900 rounded-lg p-4 border border-gray-200 text-[15px] leading-relaxed break-words overflow-x-auto [&_img]:max-w-full [&_img]:h-auto [&_a]:text-blue-700 [&_a]:underline [&_table]:max-w-full [&_p]:my-1"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }
  return (
    <div className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">
      {text || <span className="text-gray-400">No content</span>}
    </div>
  )
}

function Thumbs({ images }: { images: JobImage[] }) {
  if (!images.length) return null
  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {images.map((img) => (
        <a key={img.id} href={img.url} target="_blank" rel="noopener noreferrer" title={img.filename} className="block">
          <img
            src={img.url}
            alt={img.filename}
            className="h-24 w-24 object-cover rounded-lg border border-gray-200 dark:border-gray-700 hover:opacity-80 transition-opacity"
          />
        </a>
      ))}
    </div>
  )
}

const STATUSES: [string, string][] = [
  ["NEW", "New"], ["IN_PROGRESS", "In Progress"], ["WAITING", "Waiting"], ["DONE", "Done"],
]

// Clean an address value that might be a JSON blob, "Name <email>", or plain.
function parseAddr(raw: string | null): { name: string | null; email: string | null } {
  if (!raw) return { name: null, email: null }
  const s = raw.trim()
  if (s.startsWith("{")) {
    try { const o = JSON.parse(s); return { name: o.name || o.Name || null, email: o.address || o.email || null } } catch {}
  }
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (m) return { name: m[1].trim() || null, email: m[2].trim() }
  if (s.includes("@")) return { name: null, email: s.replace(/[<>]/g, "").trim() }
  return { name: null, email: null }
}

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
  const [copied, setCopied] = useState(false)

  const addr = parseAddr(job.fromEmail)
  const requesterEmail = addr.email
  const requesterName  = (job.fromName && !job.fromName.trim().startsWith("{")) ? job.fromName : (addr.name ?? job.fromName)

  function copyEmail() {
    if (!requesterEmail) return
    navigator.clipboard.writeText(requesterEmail).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function emailCustomer() {
    if (!requesterEmail) return
    const subject = encodeURIComponent(`RE: ${job.title}`)
    // Outlook 365 web compose (business account) — not the desktop mail client
    window.open(`https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(requesterEmail)}&subject=${subject}`, "_blank")
  }

  const run = (fn: () => Promise<any>) => startTransition(async () => { await fn() })

  function postNote() {
    const text = note.trim()
    if (!text) return
    setNote("")
    run(() => addITJobNote(job.id, text))
  }

  // Customer correspondence (original email + their replies) lives in the email
  // thread; IT notes are internal-only and live in their own section.
  const replies = job.messages.filter((m) => m.kind === "REPLY")
  const notes   = job.messages.filter((m) => m.kind === "NOTE")

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-0 sm:p-6" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#1C1C1E] w-full max-w-5xl sm:rounded-2xl border border-gray-200 dark:border-gray-800 flex flex-col max-h-[100dvh] sm:max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-6 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white break-words">{job.title}</h2>
            <p className="text-sm text-gray-400 mt-1">
              {requesterName ?? "Manual job"} · {job.date} · {job.source === "EMAIL" ? "from mailbox" : "added manually"}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl leading-none flex-shrink-0" aria-label="Close">&times;</button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto">
          {/* New reply banner */}
          {job.hasNewReply && (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 px-4 py-3">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">📨 New customer reply on this job</p>
              <button onClick={() => run(() => clearITJobReplyFlag(job.id))} disabled={isPending} className="text-sm font-semibold text-amber-700 dark:text-amber-300 hover:underline">Mark as seen</button>
            </div>
          )}

          {/* Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Due date</label>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={job.dueDate ?? ""}
                  disabled={isPending}
                  onChange={(e) => run(() => setITJobDueDate(job.id, e.target.value || null))}
                  className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {job.dueDate && (
                  <button
                    type="button"
                    onClick={() => run(() => setITJobDueDate(job.id, null))}
                    disabled={isPending}
                    className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xl leading-none flex-shrink-0 px-1"
                    aria-label="Clear due date"
                    title="Clear due date"
                  >
                    &times;
                  </button>
                )}
              </div>
              {job.dueLabel && job.status !== "DONE" && (
                <p className={`text-xs font-semibold mt-1.5 ${job.dueStatus === "overdue" ? "text-red-600 dark:text-red-400" : job.dueStatus === "today" || job.dueStatus === "soon" ? "text-amber-600 dark:text-amber-400" : "text-gray-400"}`}>
                  📅 {job.dueLabel}
                </p>
              )}
            </div>
          </div>

          {/* Customer email */}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Customer email</p>
            {requesterEmail ? (
              <div className="flex items-center gap-2 flex-wrap">
                <code className="flex-1 min-w-0 text-sm text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-2.5 break-all">{requesterEmail}</code>
                <button
                  onClick={copyEmail}
                  className="text-sm bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2.5 rounded-xl transition-colors whitespace-nowrap"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
                <button
                  onClick={emailCustomer}
                  className="text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-semibold px-4 py-2.5 rounded-xl transition-colors whitespace-nowrap"
                >
                  Email
                </button>
              </div>
            ) : (
              <p className="text-sm text-gray-400">No email address</p>
            )}
          </div>

          {/* Customer email thread — original email + their replies (correspondence) */}
          <div>
            <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-2">Customer · email thread</p>
            <div className="space-y-3">
              <div className="rounded-xl bg-blue-50/60 dark:bg-blue-900/15 border border-blue-100 dark:border-blue-800/40 p-5 text-gray-800 dark:text-gray-200">
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <span className="text-xs font-bold text-blue-700 dark:text-blue-300">{requesterName ?? "Customer"} · original</span>
                  <span className="text-xs text-gray-400">{job.date}</span>
                </div>
                <EmailBody html={job.bodyHtml} text={job.body} />
                <Thumbs images={job.images} />
              </div>
              {replies.map((m) => (
                <div key={m.id} className="rounded-xl bg-blue-50/60 dark:bg-blue-900/15 border border-blue-100 dark:border-blue-800/40 p-5 text-gray-800 dark:text-gray-200">
                  <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                    <span className="text-xs font-bold text-blue-700 dark:text-blue-300">↩ {m.authorName ?? "Customer"} · reply</span>
                    <span className="text-xs text-gray-400">{m.when}</span>
                  </div>
                  <EmailBody html={m.bodyHtml} text={m.body} />
                  <Thumbs images={m.images} />
                </div>
              ))}
            </div>
          </div>

          {/* IT notes — internal only, never sent to the customer */}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
              IT notes <span className="font-normal normal-case text-gray-400">· internal — not sent to the customer</span>
            </p>
            <div className="space-y-3 mb-3">
              {notes.length === 0 && (
                <p className="text-sm text-gray-400">No notes yet — jot anything the IT team needs to remember here.</p>
              )}
              {notes.map((m) => (
                <div key={m.id} className="rounded-xl bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800/40 p-4 text-gray-800 dark:text-gray-200">
                  <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                    <span className="font-semibold text-sm text-amber-800 dark:text-amber-300">📝 {m.authorName ?? "IT"}</span>
                    <span className="text-xs text-gray-400">{m.when}</span>
                  </div>
                  <p className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">{m.body}</p>
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
