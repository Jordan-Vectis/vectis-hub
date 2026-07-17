"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { forceReload } from "@/lib/actions/app-reload"

export default function ForceRefreshClient({
  lastRequestedAt, lastRequestedByName, tableMissing,
}: {
  lastRequestedAt: string | null
  lastRequestedByName: string | null
  tableMissing: boolean
}) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function push() {
    // The one guardrail. Jack chose an immediate forced reload over prompting
    // cataloguers, so the warning belongs here — at the moment it's triggered —
    // rather than being softened on the iPad side.
    if (!confirm(
      "Refresh everyone's screen now?\n\n" +
      "Every open tab and iPad reloads within seconds, with no warning to the person using it.\n\n" +
      "Anyone halfway through a lot will lose what they've typed AND any photos they've taken but not yet saved — they'd have to photograph the item again.\n\n" +
      "Best done when nobody is mid-lot."
    )) return

    setError(null)
    start(async () => {
      const res = await forceReload()
      if (!res.ok) { setError(res.error ?? "Could not push the refresh."); return }
      // No success message: this page reloads itself along with everyone else.
      router.refresh()
    })
  }

  if (tableMissing) {
    return (
      <div className="rounded-lg border border-amber-400/50 bg-amber-500/10 px-4 py-3">
        <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">Needs a database migration</p>
        <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-1">
          The <code>AppReload</code> table doesn&apos;t exist yet. Click <strong>Run Migrations</strong> on the Admin page,
          then reload this page. Nothing else in the app is affected in the meantime.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-red-400/40 bg-red-500/5 p-4">
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">This reloads everyone immediately</p>
        <ul className="text-xs text-gray-600 dark:text-gray-400 mt-2 space-y-1 list-disc pl-4">
          <li>Every signed-in tab and iPad reloads within a few seconds, onto the newly deployed version.</li>
          <li>Nobody is asked first — there is no prompt on their screen.</li>
          <li><strong>Anyone mid-lot loses their entry and any unsaved photos.</strong> Do it when the saleroom is quiet.</li>
          <li>It does not sign anyone out.</li>
        </ul>
      </div>

      <button onClick={push} disabled={busy}
        className="px-5 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-sm font-semibold">
        {busy ? "Refreshing everyone…" : "🔄 Refresh everyone's screen now"}
      </button>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {lastRequestedAt && (
        <p className="text-xs text-gray-400">
          Last refresh pushed {new Date(lastRequestedAt).toLocaleString("en-GB")}
          {lastRequestedByName ? ` by ${lastRequestedByName}` : ""}.
        </p>
      )}
    </div>
  )
}
