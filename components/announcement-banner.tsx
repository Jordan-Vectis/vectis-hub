"use client"

import { useEffect, useRef, useState } from "react"
import { io } from "socket.io-client"

const POLL_INTERVAL_MS = 60_000 // 60s — fallback safety net; instant updates come via Socket.IO
const STORAGE_KEY = "announcement_dismissed_at" // stores the updatedAt the user dismissed

type Announcement = { message: string; level: string; updatedAt: string }

const STYLES: Record<string, { bar: string; btn: string; icon: string }> = {
  info:    { bar: "bg-sky-500 text-gray-900",    btn: "bg-sky-600 hover:bg-sky-700 text-white",       icon: "ℹ️" },
  warning: { bar: "bg-amber-500 text-gray-900",  btn: "bg-amber-600 hover:bg-amber-700 text-white",   icon: "⚠️" },
  success: { bar: "bg-emerald-500 text-gray-900", btn: "bg-emerald-600 hover:bg-emerald-700 text-white", icon: "✅" },
}

// The bar is capped at two lines (line-clamp-2); anything longer is read in the
// popup rather than being allowed to grow. It renders inside the tablet
// cataloguing overlay too, where an uncapped banner shoves the lot list down.
export default function AnnouncementBanner() {
  const [current, setCurrent] = useState<Announcement | null>(null)
  const [showFull, setShowFull] = useState(false)
  const [clamped, setClamped] = useState(false)
  const msgRef = useRef<HTMLParagraphElement>(null)

  // "View full message" is only offered when the text genuinely doesn't fit, so
  // a one-line notice doesn't grow a pointless button. Measured rather than
  // guessed from length — the same message wraps differently on an iPad and a
  // desktop, so re-measure on resize/rotate.
  useEffect(() => {
    if (!current) return
    const measure = () => {
      const el = msgRef.current
      if (el) setClamped(el.scrollHeight > el.clientHeight + 1)
    }
    // queueMicrotask: the react-compiler lint rule bans a synchronous setState
    // inside an effect, and the paragraph needs a paint before it can measure.
    queueMicrotask(measure)
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [current])

  // Escape closes the popup — same as the shared error modal.
  useEffect(() => {
    if (!showFull) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowFull(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [showFull])

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
    setShowFull(false)
    setCurrent(null)
  }

  return (
    <>
      <div className={`sticky top-0 z-50 flex items-start gap-3 px-4 py-3 text-sm font-medium shadow-lg ${style.bar}`}>
        <span className="text-lg leading-none flex-shrink-0">{style.icon}</span>
        <p ref={msgRef} className="flex-1 whitespace-pre-wrap line-clamp-2">
          {current.message}
        </p>
        {clamped && (
          <button
            onClick={() => setShowFull(true)}
            className={`flex-shrink-0 rounded px-2 py-0.5 text-xs font-semibold transition-colors ${style.btn}`}
          >
            View full message
          </button>
        )}
        <button
          onClick={dismiss}
          className={`flex-shrink-0 ml-2 rounded px-2 py-0.5 text-xs font-semibold transition-colors ${style.btn}`}
        >
          Dismiss
        </button>
      </div>

      {/* z-10000 clears the tablet cataloguing overlay (zIndex 9999), which this
          banner renders inside — a lower value would put the popup behind it. */}
      {showFull && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
          onClick={() => setShowFull(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-lg bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl flex flex-col max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <span className="text-xl leading-none flex-shrink-0">{style.icon}</span>
              <h2 className="flex-1 text-base font-semibold text-gray-900 dark:text-white">Announcement</h2>
            </div>

            {/* The message is the only thing that scrolls, so the buttons stay
                reachable however long it gets. */}
            <div className="overflow-auto px-5 py-4">
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                {current.message}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-800">
              <button
                onClick={() => setShowFull(false)}
                className="text-sm border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 px-4 py-2 rounded-lg transition-colors"
              >
                Close
              </button>
              <button
                onClick={dismiss}
                className="text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-lg transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
