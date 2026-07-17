"use client"

import { useState, useTransition, useMemo } from "react"
import { useRouter } from "next/navigation"
import { forceReload, forceReloadUser } from "@/lib/actions/app-reload"

type UserRow = { id: string; name: string; role: string; lastRefreshedAt: string | null }

export default function ForceRefreshClient({
  lastRequestedAt, lastRequestedByName, tableMissing, users,
}: {
  lastRequestedAt: string | null
  lastRequestedByName: string | null
  tableMissing: boolean
  users: UserRow[]
}) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)   // which user's button is working
  const [filter, setFilter] = useState("")

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? users.filter((u) => u.name.toLowerCase().includes(q) || u.role.toLowerCase().includes(q)) : users
  }, [users, filter])

  function pushEveryone() {
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

  function pushUser(u: UserRow) {
    if (!confirm(
      `Refresh ${u.name}'s screen now?\n\n` +
      `Every device they're signed in on reloads within seconds, with no warning.\n\n` +
      `If they're mid-lot they lose what they've typed and any unsaved photos.`
    )) return

    setError(null); setPendingId(u.id)
    start(async () => {
      const res = await forceReloadUser(u.id)
      setPendingId(null)
      if (!res.ok) { setError(res.error ?? "Could not refresh that user."); return }
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
    <div className="space-y-6">
      {/* ── Everyone ── */}
      <div className="space-y-3">
        <div className="rounded-lg border border-red-400/40 bg-red-500/5 p-4">
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">This reloads everyone immediately</p>
          <ul className="text-xs text-gray-600 dark:text-gray-400 mt-2 space-y-1 list-disc pl-4">
            <li>Every signed-in tab and iPad reloads within a few seconds, onto the newly deployed version.</li>
            <li>Nobody is asked first — there is no prompt on their screen.</li>
            <li><strong>Anyone mid-lot loses their entry and any unsaved photos.</strong> Do it when the saleroom is quiet.</li>
            <li>It does not sign anyone out.</li>
          </ul>
        </div>

        <button onClick={pushEveryone} disabled={busy}
          className="px-5 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-sm font-semibold">
          {busy && !pendingId ? "Refreshing everyone…" : "🔄 Refresh everyone's screen now"}
        </button>

        {lastRequestedAt && (
          <p className="text-xs text-gray-400">
            Last refresh pushed {new Date(lastRequestedAt).toLocaleString("en-GB")}
            {lastRequestedByName ? ` by ${lastRequestedByName}` : ""}.
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* ── One person ── */}
      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Or refresh one person</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Reloads just their devices — handy for testing an update on one iPad, or clearing a stuck screen for one person.
            Same consequence: if they&apos;re mid-lot, they lose it.
          </p>
        </div>

        {users.length > 8 && (
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search by name or role…"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500" />
        )}

        <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-200 dark:divide-gray-800">
          {shown.length === 0 && (
            <p className="text-sm text-gray-400 px-4 py-6 text-center">No users match &ldquo;{filter}&rdquo;.</p>
          )}
          {shown.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="text-sm text-gray-800 dark:text-gray-200 truncate">{u.name}</p>
                <p className="text-xs text-gray-400">
                  {u.role}
                  {u.lastRefreshedAt ? ` · last refreshed ${new Date(u.lastRefreshedAt).toLocaleString("en-GB")}` : ""}
                </p>
              </div>
              <button onClick={() => pushUser(u)} disabled={busy}
                className="flex-shrink-0 px-3 py-1.5 rounded-lg border border-red-400 text-red-500 hover:bg-red-500/10 disabled:opacity-40 text-xs font-semibold">
                {pendingId === u.id ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
