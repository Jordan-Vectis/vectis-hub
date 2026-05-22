"use client"

import { useEffect, useRef, useState } from "react"

const POLL_INTERVAL_MS = 30_000 // 30 seconds

export default function DeployBanner() {
  const [show, setShow] = useState(false)
  const baselineRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchVersion(): Promise<string | null> {
      try {
        const res = await fetch("/api/version", { cache: "no-store" })
        const data = await res.json()
        return data?.v ?? null
      } catch {
        return null
      }
    }

    async function init() {
      const v = await fetchVersion()
      if (!cancelled) baselineRef.current = v
    }

    async function poll() {
      if (cancelled || !baselineRef.current) return
      const v = await fetchVersion()
      if (!cancelled && v && v !== baselineRef.current) {
        setShow(true)
      }
    }

    init()
    const id = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  if (!show) return null

  return (
    <div className="sticky top-0 z-50 flex items-start gap-3 bg-amber-500 px-4 py-3 text-sm font-medium text-gray-900 shadow-lg">
      <span className="text-lg leading-none flex-shrink-0">⚠️</span>
      <p className="flex-1">
        <span className="font-bold">The app was just updated.</span>{" "}
        Please check all your lots are fully saved before continuing — unsaved changes may have been lost during the update.
      </p>
      <button
        onClick={() => setShow(false)}
        className="flex-shrink-0 ml-2 rounded px-2 py-0.5 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white transition-colors"
      >
        Dismiss
      </button>
    </div>
  )
}
