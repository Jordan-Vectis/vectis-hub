"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

// Admin-only "Mark signed" button on /admin/terms — accepts the policy on behalf of a
// user who genuinely can't sign (they've been told to see a manager).
export default function MarkSignedButton({ userId, userName }: { userId: string; userName: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function mark() {
    if (busy) return
    if (!confirm(`Mark ${userName} as having accepted the policy on their behalf?\n\nOnly do this if they are genuinely unable to sign — it records that you accepted it for them.`)) return
    setBusy(true)
    try {
      const res = await fetch("/api/admin/terms/mark", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }),
      })
      if (res.ok) router.refresh()
      else { const j = await res.json().catch(() => ({})); alert(j.error ?? "Could not mark as signed"); setBusy(false) }
    } catch { setBusy(false) }
  }

  return (
    <button onClick={mark} disabled={busy}
      className="ml-1 text-[11px] font-semibold text-emerald-600 hover:text-emerald-500 underline disabled:opacity-50">
      {busy ? "…" : "mark signed"}
    </button>
  )
}
