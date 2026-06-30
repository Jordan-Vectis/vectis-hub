"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { removeOrphanedTimingLogs } from "@/lib/actions/catalogue"

// Admin-only — removes cataloguing timing logs whose lot no longer exists
// (the "deleted lot" phantom rows inflating the reports).
export default function CleanupOrphanLogsButton() {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [result, setResult] = useState<string | null>(null)

  function run() {
    if (!confirm("Remove cataloguing timing-logs whose lot no longer exists?\n\nThese are the “deleted lot” phantom rows inflating everyone's counts. Safe and idempotent.")) return
    setResult(null)
    start(async () => {
      try {
        const { count } = await removeOrphanedTimingLogs()
        setResult(count === 0 ? "✓ Nothing to clean up — no orphaned logs found." : `✓ Removed ${count.toLocaleString()} phantom log${count === 1 ? "" : "s"}.`)
        router.refresh()
      } catch (e: any) {
        setResult(e?.message ?? "Something went wrong")
      }
    })
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        onClick={run}
        disabled={busy}
        className="px-4 py-2 rounded-lg border border-amber-400 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 text-sm font-semibold disabled:opacity-40 transition-colors"
      >
        {busy ? "Cleaning…" : "🧹 Remove phantom logs"}
      </button>
      {result && <span className="text-sm text-gray-600 dark:text-gray-300">{result}</span>}
    </div>
  )
}
