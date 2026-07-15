"use client"

import { useEffect, useState } from "react"

// Admin-only banner: appears whenever a deploy has brought database migrations
// that haven't been run on this environment yet, and disappears the moment they
// are run. The API decides "pending" by comparing a hash of the migration list
// against what was last run, so nobody has to remember or be reminded.
export default function MigrationBanner() {
  const [pending, setPending] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function check() {
    try {
      const res = await fetch("/api/admin/run-migrations", { cache: "no-store" })
      const data = await res.json()
      setPending(Boolean(data?.pending))
    } catch {
      /* leave whatever is currently shown */
    }
  }

  useEffect(() => { check() }, [])

  async function run() {
    setRunning(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/run-migrations", { method: "POST" })
      const data = await res.json()
      if (data?.ok) {
        setPending(false)
      } else {
        setError(data?.errors?.[0] ?? data?.error ?? "Something went wrong — check Admin → Run Migrations.")
      }
    } catch (e: any) {
      setError(e?.message ?? "Could not reach the server.")
    } finally {
      setRunning(false)
    }
  }

  if (!pending) return null

  return (
    <div className="sticky top-0 z-50 flex items-start gap-3 px-4 py-3 text-sm font-medium shadow-lg bg-amber-500 text-gray-900">
      <span className="text-lg leading-none flex-shrink-0">🛠️</span>
      <div className="flex-1">
        <p>This update needs a database change before its new features will work.</p>
        {error && <p className="mt-1 text-xs font-normal text-red-900">{error}</p>}
      </div>
      <button
        onClick={run}
        disabled={running}
        className="flex-shrink-0 ml-2 rounded px-2.5 py-1 text-xs font-semibold bg-amber-700 hover:bg-amber-800 text-white transition-colors disabled:opacity-60"
      >
        {running ? "Running…" : "Run it now"}
      </button>
    </div>
  )
}
