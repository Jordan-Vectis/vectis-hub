"use client"

import { useEffect } from "react"
import { maybeReloadForSkew, willReloadForSkew } from "@/lib/skew-reload"

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // Actions dispatched through a transition (useActionState — the login form)
  // reject into this boundary. Direct awaits in click handlers don't; those are
  // caught by components/skew-reload.tsx, which shares the reload guard.
  const reloading = willReloadForSkew(error)

  useEffect(() => { maybeReloadForSkew(error) }, [error])

  // Render nothing over the reload. If the loop guard declined it, fall through
  // to the error card — a skew miss that survives a reload must not be a blank
  // screen the user can't get out of.
  if (reloading) return null

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50 dark:bg-gray-950">
      <div className="w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">
          Something went wrong
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1.5 leading-relaxed">
          This page hit an unexpected error. Try again — if it keeps happening, send
          the reference below to IT.
        </p>

        {error.digest && (
          <p className="mt-4 text-xs font-mono text-gray-500 dark:text-gray-500 bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-2">
            Reference: {error.digest}
          </p>
        )}

        <div className="flex gap-2 mt-5">
          <button
            onClick={reset}
            className="text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="text-sm border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 px-4 py-2 rounded-lg transition-colors"
          >
            Reload the page
          </button>
        </div>
      </div>
    </div>
  )
}
