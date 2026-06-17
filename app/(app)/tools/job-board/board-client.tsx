"use client"

import { useState, useTransition } from "react"
import { createITJob, setITStaff } from "@/lib/actions/it-jobs"
import JobDetailModal from "./job-detail-modal"

type Message = { id: string; kind: string; authorName: string | null; body: string; when: string }
type Job = {
  id: string; title: string; body: string
  fromName: string | null; fromEmail: string | null
  status: string; source: string; webLink: string | null
  assignedToId: string | null; assignedToName: string | null
  hasNewReply: boolean; date: string; messages: Message[]
}

const AVATAR_COLORS = [
  "bg-indigo-500", "bg-rose-500", "bg-amber-500", "bg-emerald-500",
  "bg-sky-500", "bg-purple-500", "bg-pink-500", "bg-teal-500",
]
function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}


export default function BoardClient({
  jobs,
  itStaff,
  allUsers,
  inboundUrl,
}: {
  jobs: Job[]
  itStaff: { id: string; name: string }[]
  allUsers: { id: string; name: string; isITStaff: boolean }[]
  inboundUrl: string | null
}) {
  const [isPending, startTransition] = useTransition()
  const [showAdd, setShowAdd] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [showStaff, setShowStaff] = useState(false)
  const [copied, setCopied] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected = jobs.find((j) => j.id === selectedId) ?? null

  function copyUrl() {
    if (!inboundUrl) return
    navigator.clipboard.writeText(inboundUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  const card = "bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800"

  function JobCard({ job }: { job: Job }) {
    const replyCount = job.messages.filter((m) => m.kind === "REPLY").length
    const isEmail = job.source === "EMAIL"
    const done = job.status === "DONE"
    const initials = (job.assignedToName ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("")
    return (
      <button
        onClick={() => setSelectedId(job.id)}
        className={`w-full text-left bg-white dark:bg-[#202125] rounded-xl border border-gray-200 dark:border-gray-700/60 border-l-4 ${isEmail ? "border-l-blue-500" : "border-l-emerald-500"} p-3.5 shadow-sm hover:shadow-md transition-shadow ${job.hasNewReply ? "ring-2 ring-amber-400/70" : ""}`}
      >
        {/* Title + completion circle */}
        <div className="flex items-start gap-2.5">
          <span className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center ${done ? "bg-green-500" : "border-2 border-gray-300 dark:border-gray-600"}`}>
            {done && <span className="text-white text-[9px] leading-none">✓</span>}
          </span>
          <p className="flex-1 min-w-0 font-medium text-sm text-gray-900 dark:text-gray-100 break-words">{job.title}</p>
          {job.hasNewReply && <span className="text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-1.5 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">reply</span>}
        </div>

        {job.body && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 ml-[26px] line-clamp-2 break-words">{job.body}</p>}

        {/* Source tag */}
        <div className="ml-[26px] mt-2">
          <span className={`inline-block text-[11px] px-2 py-0.5 rounded-md font-medium ${isEmail ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"}`}>
            {isEmail ? "✉ Email" : "✎ Manual"}
          </span>
        </div>

        {/* Footer: assignee avatar + date · reply count */}
        <div className="flex items-center justify-between mt-3 ml-[26px]">
          <div className="flex items-center gap-2 min-w-0">
            {initials ? (
              <span className={`w-6 h-6 rounded-full ${avatarColor(job.assignedToName ?? "")} text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0`} title={job.assignedToName ?? ""}>{initials}</span>
            ) : (
              <span className="w-6 h-6 rounded-full border border-dashed border-gray-300 dark:border-gray-600 flex-shrink-0" title="Unassigned" />
            )}
            <span className="text-xs text-gray-400 truncate">{job.date}</span>
          </div>
          {replyCount > 0 && (
            <span className="text-xs text-gray-400 flex items-center gap-1 flex-shrink-0">💬 {replyCount}</span>
          )}
        </div>
      </button>
    )
  }

  function Column({ label, icon, head, list }: { label: string; icon: string; head: string; list: Job[] }) {
    return (
      <div className="rounded-2xl bg-gray-100/70 dark:bg-black/20 border border-gray-200 dark:border-gray-800 p-3 flex flex-col min-h-[calc(100vh-13rem)]">
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base leading-none flex-shrink-0" aria-hidden>{icon}</span>
            <span className={`text-sm font-bold uppercase tracking-wide truncate ${head}`}>{label}</span>
          </div>
          <span className="text-sm font-semibold text-gray-400 flex-shrink-0">{list.length}</span>
        </div>
        <div className="space-y-2 flex-1">
          {list.map((job) => <JobCard key={job.id} job={job} />)}
          {list.length === 0 && <div className="text-xs text-gray-300 dark:text-gray-600 px-1 py-3">No jobs</div>}
        </div>
      </div>
    )
  }

  const inStatus = (s: string) => jobs.filter((j) => j.status === s)

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Job Board</h1>
          <p className="text-base text-gray-500 mt-1">IT jobs from the IT@vectis.co.uk inbox, plus anything added by hand.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setShowStaff(true)} className="bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-base font-semibold px-5 py-3 rounded-xl transition-colors">IT staff</button>
          <button onClick={() => setShowSetup((s) => !s)} className="bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-base font-semibold px-5 py-3 rounded-xl transition-colors">Email setup</button>
          <button onClick={() => setShowAdd((s) => !s)} className="bg-blue-600 hover:bg-blue-700 text-white text-base font-semibold px-6 py-3 rounded-xl transition-colors">+ Add job</button>
        </div>
      </div>

      {/* Email import setup */}
      {showSetup && (
        <div className={`${card} p-5 mb-5`}>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Email import setup</h2>
          {inboundUrl ? (
            <>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3 leading-relaxed">Forwarded IT mail is posted here by your email service. This is the webhook URL it sends to:</p>
              <div className="flex items-center gap-2 flex-wrap">
                <code className="flex-1 min-w-0 text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2.5 break-all">{inboundUrl}</code>
                <button onClick={copyUrl} className="text-sm bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2.5 rounded-xl transition-colors whitespace-nowrap">{copied ? "Copied!" : "Copy URL"}</button>
              </div>
              <p className="text-xs text-gray-400 mt-2">Treat this URL like a password.</p>
            </>
          ) : (
            <p className="text-sm text-amber-600 dark:text-amber-400">Email import isn&apos;t switched on — <code>IT_INBOUND_SECRET</code> needs setting on the server.</p>
          )}
        </div>
      )}

      {/* Add job form */}
      {showAdd && (
        <form action={createITJob} className={`${card} p-5 mb-5 space-y-3`}>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Add a job</h2>
          <input name="title" required placeholder="Job title *" className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <textarea name="body" rows={3} placeholder="Details (optional)" className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
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

      {/* Board — full-width kanban; New split into Mailbox / Manual lanes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        <Column label="New · Mailbox" icon="📥" head="text-blue-600 dark:text-blue-400"     list={inStatus("NEW").filter((j) => j.source === "EMAIL")} />
        <Column label="New · Manual"  icon="✏️" head="text-emerald-600 dark:text-emerald-400" list={inStatus("NEW").filter((j) => j.source === "MANUAL")} />
        <Column label="In Progress"   icon="🔧" head="text-amber-600 dark:text-amber-400"   list={inStatus("IN_PROGRESS")} />
        <Column label="Waiting"       icon="⏳" head="text-purple-600 dark:text-purple-400" list={inStatus("WAITING")} />
        <Column label="Done"          icon="✅" head="text-green-600 dark:text-green-400"   list={inStatus("DONE")} />
      </div>

      {/* Job detail modal */}
      {selected && (
        <JobDetailModal job={selected} itStaff={itStaff} onClose={() => setSelectedId(null)} />
      )}

      {/* Manage IT staff modal */}
      {showStaff && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={() => setShowStaff(false)}>
          <div className={`${card} w-full max-w-md p-6`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">IT staff</h2>
              <button onClick={() => setShowStaff(false)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl leading-none">&times;</button>
            </div>
            <p className="text-sm text-gray-500 mb-4">Tick who can be assigned jobs.</p>
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {allUsers.map((u) => (
                <label key={u.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                  <input
                    type="checkbox"
                    defaultChecked={u.isITStaff}
                    disabled={isPending}
                    onChange={(e) => startTransition(async () => { await setITStaff(u.id, e.target.checked) })}
                    className="w-5 h-5 accent-blue-600"
                  />
                  <span className="text-base text-gray-800 dark:text-gray-200">{u.name}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
