"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toggleReportExcludedUser } from "@/lib/actions/reports"

// Admin-only. Hides a whole cataloguer from the reports, or restores one.
// Report-only — nothing is deleted, so it can always be put back.
export default function ExcludeUserButton({ userId, name, excluded }: {
  userId: string
  name: string
  excluded: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function toggle() {
    if (!excluded && !confirm(
      `Hide ${name} from the reports?\n\nThey'll be left out of the league table, the charts and the team averages. ` +
      `Nothing is deleted — you can restore them from the bottom of this page.`,
    )) return

    setError(null)
    start(async () => {
      const res = await toggleReportExcludedUser(userId)
      if (!res.ok) { setError(res.error ?? "Something went wrong"); return }
      router.refresh()
    })
  }

  return (
    <>
      <button
        onClick={toggle}
        disabled={pending}
        title={excluded ? `Put ${name} back into the reports` : `Hide ${name} from the reports`}
        className={`text-xs font-semibold whitespace-nowrap disabled:opacity-50 transition-colors ${
          excluded
            ? "text-[#2AB4A6] hover:underline"
            : "text-gray-400 dark:text-gray-600 hover:text-red-500"
        }`}
      >
        {pending ? "…" : excluded ? "↺ Restore" : "✕ Hide"}
      </button>
      {error && <span className="block text-[11px] text-red-500 mt-0.5">{error}</span>}
    </>
  )
}
