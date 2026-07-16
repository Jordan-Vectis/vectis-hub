"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function ClearLogButton() {
  const router = useRouter()
  const [busy, setBusy]       = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function clear() {
    setBusy(true)
    setError(null)
    try {
      const res  = await fetch("/api/admin/access-log", { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "Failed to clear the log")
      setConfirm(false)
      router.refresh()
    } catch (e: any) {
      setError(e?.message ?? "Failed to clear the log")
    } finally {
      setBusy(false)
    }
  }

  if (!confirm) {
    return (
      <div className="text-right">
        <button
          onClick={() => setConfirm(true)}
          className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm border border-gray-700"
        >
          Clear log
        </button>
        {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
      </div>
    )
  }

  return (
    <div className="text-right">
      <p className="text-gray-400 text-xs mb-1.5">Delete every entry? This cannot be undone.</p>
      <div className="flex gap-2 justify-end">
        <button
          onClick={() => setConfirm(false)}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm border border-gray-700 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={clear}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm disabled:opacity-50"
        >
          {busy ? "Clearing…" : "Yes, clear it"}
        </button>
      </div>
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  )
}
