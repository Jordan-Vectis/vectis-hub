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
    return (
      <button
        onClick={() => setSelectedId(job.id)}
        className={`${card} border-l-4 ${isEmail ? "border-l-blue-500" : "border-l-emerald-500"} w-full text-left p-4 transition-shadow hover:shadow-md dark:hover:shadow-black/40 ${job.hasNewReply ? "ring-2 ring-amber-400/60" : ""}`}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-gray-900 dark:text-white text-sm break-words flex items-start gap-1.5">
            <span className="flex-shrink-0" title={isEmail ? "From mailbox" : "Added manually"}>{isEmail ? "✉️" : "✏️"}</span>
            <span>{job.title}</span>
          </p>
          {job.hasNewReply && <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">reply</span>}
        </div>
        {job.body && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2 break-words">{job.body}</p>}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-2 text-xs text-gray-400">
          {job.fromName && <span>{job.fromName}</span>}
          {job.fromName && <span>·</span>}
          <span>{job.date}</span>
          {replyCount > 0 && <><span>·</span><span>{replyCount} repl{replyCount === 1 ? "y" : "ies"}</span></>}
        </div>
        {job.assignedToName && (
          <div className="mt-2">
            <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full">👤 {job.assignedToName}</span>
          </div>
        )}
      </button>
    )
  }

  function Column({ label, dot, head, list }: { label: string; dot: string; head: string; list: Job[] }) {
    return (
      <div className="rounded-2xl bg-gray-100/70 dark:bg-white/[0.02] border border-gray-200 dark:border-gray-800 p-3 flex flex-col min-h-[calc(100vh-13rem)]">
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dot}`} />
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
        <Column label="New · Mailbox" dot="bg-blue-500"    head="text-blue-600 dark:text-blue-400"     list={inStatus("NEW").filter((j) => j.source === "EMAIL")} />
        <Column label="New · Manual"  dot="bg-emerald-500" head="text-emerald-600 dark:text-emerald-400" list={inStatus("NEW").filter((j) => j.source === "MANUAL")} />
        <Column label="In Progress"   dot="bg-amber-500"   head="text-amber-600 dark:text-amber-400"   list={inStatus("IN_PROGRESS")} />
        <Column label="Waiting"       dot="bg-purple-500"  head="text-purple-600 dark:text-purple-400" list={inStatus("WAITING")} />
        <Column label="Done"          dot="bg-green-500"   head="text-green-600 dark:text-green-400"   list={inStatus("DONE")} />
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
