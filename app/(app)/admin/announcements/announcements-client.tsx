"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { setAnnouncement } from "@/lib/actions/announcements"
import { ANNOUNCEMENT_LEVELS } from "@/lib/announcement-constants"

type Initial = {
  message: string
  level: string
  active: boolean
  updatedAt: string | null
  updatedByName: string | null
}

const LEVEL_PREVIEW: Record<string, string> = {
  info:    "bg-sky-500 text-gray-900",
  warning: "bg-amber-500 text-gray-900",
  success: "bg-emerald-500 text-gray-900",
}
const LEVEL_ICON: Record<string, string> = { info: "ℹ️", warning: "⚠️", success: "✅" }

export default function AnnouncementsManager({ initial }: { initial: Initial }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [message, setMessage] = useState(initial.message)
  const [level, setLevel]     = useState(initial.level)
  const [active, setActive]   = useState(initial.active)
  const [saved, setSaved]     = useState<string | null>(null)

  function save(nextActive: boolean) {
    setSaved(null)
    start(async () => {
      try {
        await setAnnouncement({ message, level, active: nextActive })
        setActive(nextActive && message.trim().length > 0)
        setSaved(nextActive ? "Announcement is now live for everyone." : "Announcement turned off.")
        router.refresh()
      } catch (e: any) {
        alert(e?.message ?? "Something went wrong")
      }
    })
  }

  const input = "w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"

  return (
    <div className="space-y-4">
      {/* Live preview */}
      {message.trim() && (
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-500 mb-1">Preview {active ? "(live now)" : "(not shown until you turn it on)"}</p>
          <div className={`flex items-start gap-3 px-4 py-3 rounded-lg text-sm font-medium shadow ${LEVEL_PREVIEW[level] ?? LEVEL_PREVIEW.warning}`}>
            <span className="text-lg leading-none">{LEVEL_ICON[level] ?? "⚠️"}</span>
            <p className="flex-1 whitespace-pre-wrap">{message}</p>
            <span className="text-xs font-semibold rounded px-2 py-0.5 bg-black/15">Dismiss</span>
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Message</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3}
          placeholder="e.g. We've just updated the app — please make sure your lots are saved and refresh the page."
          className={`${input} resize-y`} />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Style</label>
        <div className="flex gap-2">
          {ANNOUNCEMENT_LEVELS.map((l) => (
            <button key={l} type="button" onClick={() => setLevel(l)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border capitalize transition-colors ${level === l ? "border-emerald-500 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-500"}`}>
              {LEVEL_ICON[l]} {l}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap pt-1">
        {active ? (
          <>
            <button onClick={() => save(true)} disabled={busy || !message.trim()} className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-semibold">
              {busy ? "Saving…" : "Update live announcement"}
            </button>
            <button onClick={() => save(false)} disabled={busy} className="px-4 py-2 rounded-lg border border-red-400 text-red-500 hover:bg-red-500/10 text-sm font-semibold disabled:opacity-40">
              Turn off
            </button>
          </>
        ) : (
          <button onClick={() => save(true)} disabled={busy || !message.trim()} className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-semibold">
            {busy ? "Saving…" : "Show to everyone"}
          </button>
        )}
        <span className={`text-xs px-2 py-1 rounded-full ${active ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" : "bg-gray-200 dark:bg-gray-800 text-gray-500"}`}>
          {active ? "● Live" : "Off"}
        </span>
      </div>

      {saved && <p className="text-sm text-emerald-600 dark:text-emerald-400">{saved}</p>}
      {initial.updatedAt && (
        <p className="text-xs text-gray-400">Last changed {new Date(initial.updatedAt).toLocaleString("en-GB")}{initial.updatedByName ? ` by ${initial.updatedByName}` : ""}.</p>
      )}
    </div>
  )
}
