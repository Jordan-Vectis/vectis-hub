"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ALL_APPS } from "@/lib/apps"
import type { AppKey } from "@/lib/apps"

interface Props {
  userId: string
  userName: string
  currentApps: string[]
  userRole: string
}

export default function AppPermissionsButton({ userId, userName, currentApps, userRole }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>(currentApps)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function toggle(key: AppKey) {
    setSelected(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  function handleOpen() {
    setSelected(currentApps)
    setError(null)
    setOpen(true)
  }

  function handleSave() {
    setError(null)
    startTransition(async () => {
      const res = await fetch(`/api/admin/users/${userId}/apps`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowedApps: selected }),
      })
      if (!res.ok) { setError("Failed to save."); return }
      setOpen(false)
      router.refresh()
    })
  }

  if (userRole === "ADMIN") {
    return (
      <div className="flex flex-wrap gap-1">
        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">All apps</span>
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        {currentApps.length === 0 ? (
          <span className="text-xs text-gray-400 dark:text-gray-500 italic">No access</span>
        ) : (
          currentApps.map(k => {
            const app = ALL_APPS.find(a => a.key === k)
            return app ? (
              <span key={k} className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                {app.label}
              </span>
            ) : null
          })
        )}
        <button
          onClick={handleOpen}
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-700 dark:text-gray-300 transition-colors ml-1"
        >
          Edit ✎
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-1">App Access</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Select which apps <strong>{userName}</strong> can see and use.</p>

            <div className="flex flex-col gap-2 mb-5">
              {ALL_APPS.map(app => (
                <label key={app.key} className="flex items-center gap-3 cursor-pointer group">
                  <div
                    onClick={() => toggle(app.key)}
                    className={`w-5 h-5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors cursor-pointer ${
                      selected.includes(app.key)
                        ? "bg-blue-600 border-blue-600"
                        : "border-gray-300 dark:border-gray-600 group-hover:border-blue-400"
                    }`}
                  >
                    {selected.includes(app.key) && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                  <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:hover:text-white dark:group-hover:text-white dark:text-white">{app.label}</span>
                </label>
              ))}
            </div>

            {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

            <div className="flex gap-2 justify-end">
              <button onClick={() => setOpen(false)}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-gray-300 dark:border-gray-600 transition-colors">
                Cancel
              </button>
              <button onClick={handleSave} disabled={isPending}
                className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50">
                {isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
