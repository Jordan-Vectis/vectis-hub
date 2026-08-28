"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

// Admin-only "require re-sign" on /admin/terms — withdraws one person's acceptance so the
// blocking signing popup comes back for them the next time they open the Hub.
//
// ⚠ The confirm says the signature is KEPT, because "remove their signature" reads like "delete
// it" and an admin pressing this should know which of the two they are doing. The server copies
// it to TermsRevocation before deleting the live row; the page lists it under Withdrawn.
export default function RequireResignButton({ userId, userName }: { userId: string; userName: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function revoke() {
    if (busy) return
    if (!confirm(
      `Make ${userName || "this person"} sign the policy again?\n\n` +
      `Their acceptance is withdrawn and they get the signing popup next time they open the Hub.\n\n` +
      `The signature itself is kept on file under "Withdrawn" — it is not deleted.`
    )) return

    // Optional and deliberately after the confirm: a reason is worth having on the record, but
    // not worth blocking the action over.
    const reason = prompt("Why are they re-signing? (optional — kept with the withdrawn signature)", "") ?? ""

    setBusy(true)
    try {
      const res = await fetch("/api/admin/terms/revoke", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, reason }),
      })
      if (res.ok) router.refresh()
      else { const j = await res.json().catch(() => ({})); alert(j.error ?? "Could not withdraw the signature"); setBusy(false) }
    } catch { setBusy(false) }
  }

  return (
    <button onClick={revoke} disabled={busy}
      className="text-[11px] font-semibold text-amber-600 hover:text-amber-500 underline disabled:opacity-50">
      {busy ? "…" : "require re-sign"}
    </button>
  )
}
