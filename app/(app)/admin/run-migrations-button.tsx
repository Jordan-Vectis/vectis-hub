"use client"

import { useRef, useState } from "react"

// A tile in the Health & updates group on the Admin page. (The amber banner offers the same.)
export default function RunMigrationsButton({ colour }: { colour: string }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, setPending] = useState(false)
  const busy = useRef(false)

  async function run() {
    if (busy.current) return
    busy.current = true
    setPending(true)
    setMsg(null)
    try {
      const res = await fetch("/api/admin/run-migrations", { method: "POST" })
      const data = await res.json().catch(() => ({}))
      setMsg(res.ok ? { ok: true, text: "Done — all applied" } : { ok: false, text: data.error ?? `Failed (${res.status})` })
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? "Failed" })
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  return (
    <button onClick={run} disabled={pending}
      className="text-left bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 border-l-4 rounded-xl p-3 min-h-[76px] flex items-center gap-3 hover:shadow-md hover:-translate-y-0.5 transition-all disabled:opacity-60"
      style={{ borderLeftColor: colour }}>
      <span className="text-2xl shrink-0">🧱</span>
      <span className="min-w-0">
        <span className="block font-semibold text-sm text-gray-900 dark:text-gray-100">{pending ? "Running…" : "Run Migrations"}</span>
        <span className={`block text-xs truncate ${msg ? (msg.ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400") : "text-gray-500 dark:text-gray-400"}`}>
          {msg?.text ?? "Apply waiting database updates"}
        </span>
      </span>
    </button>
  )
}
