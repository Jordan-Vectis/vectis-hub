"use client"

import { useState, useTransition } from "react"

export default function RunMigrationsButton() {
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function run() {
    setMsg(null)
    start(async () => {
      const res = await fetch("/api/admin/run-migrations", { method: "POST" })
      const data = await res.json()
      if (res.ok) setMsg("Done — all migrations applied.")
      else setMsg(data.error ?? "Failed")
    })
  }

  return (
    <div className="mt-8 pt-6 border-t border-gray-200 flex items-center gap-4">
      <button
        onClick={run}
        disabled={pending}
        className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-600 hover:border-gray-400 hover:text-gray-800 rounded-lg transition-colors disabled:opacity-50"
      >
        {pending ? "Running…" : "Run Migrations"}
      </button>
      {msg && <span className="text-sm text-gray-500">{msg}</span>}
    </div>
  )
}
