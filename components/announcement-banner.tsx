"use client"

import { useEffect, useState } from "react"
import { io } from "socket.io-client"

const POLL_INTERVAL_MS = 60_000 // 60s — fallback safety net; instant updates come via Socket.IO
const STORAGE_KEY = "announcement_dismissed_at" // stores the updatedAt the user dismissed

type Announcement = { message: string; level: string; updatedAt: string }

const STYLES: Record<string, { bar: string; btn: string; icon: string }> = {
  info:    { bar: "bg-sky-500 text-gray-900",    btn: "bg-sky-600 hover:bg-sky-700 text-white",       icon: "ℹ️" },
  warning: { bar: "bg-amber-500 text-gray-900",  btn: "bg-amber-600 hover:bg-amber-700 text-white",   icon: "⚠️" },
  success: { bar: "bg-emerald-500 text-gray-900", btn: "bg-emerald-600 hover:bg-emerald-700 text-white", icon: "✅" },
}

export default function AnnouncementBanner() {
  const [current, setCurrent] = useState<Announcement | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch("/api/announcement", { cache: "no-store" })
        const data = await res.json()
        const a: Announcement | null = data?.announcement ?? null
        if (cancelled) return
        // Hide if the user already dismissed THIS version (keyed by updatedAt).
        const dismissedAt = localStorage.getItem(STORAGE_KEY)
        setCurrent(a && dismissedAt === a.updatedAt ? null : a)
      } catch {
        /* leave whatever is currently shown */
      }
    }

    load()
    const id = setInterval(load, POLL_INTERVAL_MS)

    // Instant delivery: the admin's save emits "announcement:changed" from the
    // server (see lib/actions/announcements.ts), so every open tab refetches
    // immediately rather than waiting up to 60s for the next poll.
    const socket = io({ path: "/socket.io" })
    socket.on("announcement:changed", () => load())

    return () => { cancelled = true; clearInterval(id); socket.disconnect() }
  }, [])

  if (!current) return null

  const style = STYLES[current.level] ?? STYLES.warning

  function dismiss() {
    if (current) localStorage.setItem(STORAGE_KEY, current.updatedAt)
    setCurrent(null)
  }

  return (
    <div className={`sticky top-0 z-50 flex items-start gap-3 px-4 py-3 text-sm font-medium shadow-lg ${style.bar}`}>
      <span className="text-lg leading-none flex-shrink-0">{style.icon}</span>
      <p className="flex-1 whitespace-pre-wrap">{current.message}</p>
      <button
        onClick={dismiss}
        className={`flex-shrink-0 ml-2 rounded px-2 py-0.5 text-xs font-semibold transition-colors ${style.btn}`}
      >
        Dismiss
      </button>
    </div>
  )
}
