"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { repairStrandedTimingLogs } from "@/lib/actions/catalogue"

// Admin button — re-homes cataloguing timing logs that were stranded in a source
// auction by the old transferLots bug, fixing the phantom report counts.
export default function RepairStrandedLogsButton() {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [result, setResult] = useState<string | null>(null)

  function run() {
    if (!confirm("Re-home stranded cataloguing timing-logs to the auction their lot now lives in?\n\nThis fixes the phantom report counts (e.g. logs left behind in X069 after a transfer). Safe and idempotent — you can run it any time.")) return
    setResult(null)
    start(async () => {
      try {
        const { count } = await repairStrandedTimingLogs()
        setResult(count === 0 ? "✓ Nothing to repair — no stranded logs found." : `✓ Re-homed ${count.toLocaleString()} stranded log${count === 1 ? "" : "s"} to the correct auction.`)
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
        {busy ? "Repairing…" : "🛠 Repair stranded logs"}
      </button>
      {result && <span className="text-sm text-gray-600 dark:text-gray-300">{result}</span>}
    </div>
  )
}
