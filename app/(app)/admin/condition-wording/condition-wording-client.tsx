"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { addWording, renameWording, deleteWording, moveWording } from "@/lib/actions/condition-wordings"

type Wording = { id: string; label: string }

export default function WordingsManager({ wordings }: { wordings: Wording[] }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [newLabel, setNewLabel] = useState("")

  const run = (fn: () => Promise<any>) =>
    start(async () => {
      try { await fn() } catch (e: any) { alert(e?.message ?? "Something went wrong") }
      router.refresh()
    })

  const input = "px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
  const arrow = "text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30 text-xs leading-none px-0.5"

  function add() {
    const l = newLabel.trim()
    if (!l) return
    setNewLabel("")
    run(() => addWording(l))
  }
  function rename(w: Wording) {
    const l = prompt("Rename wording", w.label)
    if (l == null || !l.trim() || l.trim() === w.label) return
    run(() => renameWording(w.id, l.trim()))
  }

  return (
    <div className="space-y-4">
      {/* Add wording */}
      <div className="flex items-center gap-2 flex-wrap">
        <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add() }}
          placeholder="New wording, e.g. Carded Back is" className={`${input} w-64`} />
        <button onClick={add} disabled={busy || !newLabel.trim()} className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40">+ Add wording</button>
        <span className="text-xs text-gray-400">{wordings.length} wordings</span>
      </div>
      <p className="text-xs text-gray-400">Tip: end the wording with &ldquo;is&rdquo; so it reads naturally before the grade — e.g. &ldquo;Blister Card is&rdquo; → &ldquo;Blister Card is Mint&rdquo;.</p>

      {wordings.length === 0 && <p className="text-sm text-gray-400">No wordings yet — add one above.</p>}

      <div className="space-y-2">
        {wordings.map((w, i) => (
          <div key={w.id} className="flex items-center gap-3 bg-white dark:bg-[#1C1C1E] rounded-xl border border-gray-200 dark:border-gray-800 px-3 py-2">
            <div className="flex flex-col">
              <button onClick={() => run(() => moveWording(w.id, "up"))} disabled={busy || i === 0} className={arrow} title="Move up">▲</button>
              <button onClick={() => run(() => moveWording(w.id, "down"))} disabled={busy || i === wordings.length - 1} className={arrow} title="Move down">▼</button>
            </div>
            <span className="font-medium text-gray-800 dark:text-gray-100">{w.label}</span>
            <span className="text-xs text-gray-400">{w.label} <span className="text-gray-500">Mint</span></span>
            <button onClick={() => rename(w)} disabled={busy} className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 ml-auto">✏ rename</button>
            <button onClick={() => { if (confirm(`Delete the wording "${w.label}"? Existing lots keep their condition text.`)) run(() => deleteWording(w.id)) }} disabled={busy} className="text-xs text-red-500 hover:text-red-400">Delete</button>
          </div>
        ))}
      </div>
    </div>
  )
}
