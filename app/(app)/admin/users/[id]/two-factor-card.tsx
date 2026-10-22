"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { setTwoFactorRequired, resetTwoFactor } from "@/lib/actions/two-factor-admin"

export type TwoFactorStatus =
  | { ready: false }
  | { ready: true; required: boolean; enabledAt: string | null; backupLeft: number; updatedByName: string | null }

export default function TwoFactorCard({ userId, isSelf, status }: { userId: string; isSelf: boolean; status: TwoFactorStatus }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [confirmReset, setConfirmReset] = useState(false)

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    if (busy) return
    setBusy(true); setError("")
    const r = await fn()
    setBusy(false); setConfirmReset(false)
    if (!r.ok) setError(r.error ?? "Something went wrong.")
    else router.refresh()
  }

  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mt-6">
      <h2 className="font-semibold text-gray-800 dark:text-gray-200 mb-1">Two-factor login</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        A code from an authenticator app on their phone as well as their password.
      </p>

      {!status.ready ? (
        <p className="text-sm text-amber-600 dark:text-amber-400">Two-factor needs Run Migrations before it can be switched on.</p>
      ) : (
        <div className="space-y-4">
          <label className="flex items-center gap-3 min-h-11 cursor-pointer">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={status.required}
              disabled={busy}
              onChange={e => run(() => setTwoFactorRequired(userId, e.target.checked))}
            />
            <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Require two-factor</span>
          </label>

          <p className="text-sm text-gray-600 dark:text-gray-300">
            {status.enabledAt
              ? `Set up on ${new Date(status.enabledAt).toLocaleDateString("en-GB")} · ${status.backupLeft} backup code${status.backupLeft === 1 ? "" : "s"} left`
              : status.required
                ? "Not set up yet — they'll be asked to set it up at their next sign-in."
                : "Not set up."}
            {status.updatedByName && <span className="text-gray-400 dark:text-gray-500"> · last changed by {status.updatedByName}</span>}
          </p>

          {status.required && isSelf && !status.enabledAt && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              This is your own account — keep another admin account without two-factor until you&apos;ve signed in with a code.
            </p>
          )}

          {status.enabledAt && (
            confirmReset ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-gray-700 dark:text-gray-300">Forget their phone and backup codes?</span>
                <button onClick={() => run(() => resetTwoFactor(userId))} disabled={busy}
                  className="min-h-11 px-4 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                  Yes, reset
                </button>
                <button onClick={() => setConfirmReset(false)} disabled={busy}
                  className="min-h-11 px-4 border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300 rounded-lg">
                  Cancel
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirmReset(true)} disabled={busy}
                className="min-h-11 px-4 border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">
                Reset two-factor (lost phone)
              </button>
            )
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400 mt-3">{error}</p>}
    </section>
  )
}
