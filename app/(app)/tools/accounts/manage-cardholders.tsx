"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { createCardholder, renameCardholder, deleteCardholder } from "@/lib/actions/accounting"

type Cardholder = { id: string; name: string }

export default function ManageCardholders({ cardholders }: { cardholders: Cardholder[] }) {
  const router = useRouter()
  const [newName, setNewName] = useState("")
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [busy, start] = useTransition()

  function add() {
    const v = newName.trim()
    if (!v) return
    start(async () => { await createCardholder(v); setNewName(""); router.refresh() })
  }
  function saveRename(id: string) {
    const v = editName.trim()
    if (!v) { setEditId(null); return }
    start(async () => { await renameCardholder(id, v); setEditId(null); router.refresh() })
  }
  function remove(c: Cardholder) {
    if (!confirm(`Remove "${c.name}" from the list? Existing lines keep this name; it just won't be a choice going forward.`)) return
    start(async () => { await deleteCardholder(c.id); router.refresh() })
  }

  const input = "px-2 py-1 rounded-lg text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"

  return (
    <div>
      <div className="space-y-1.5 mb-3">
        {cardholders.length === 0 && <p className="text-sm text-gray-400">No cards yet — add one below.</p>}
        {cardholders.map((c) => (
          <div key={c.id} className="flex items-center gap-2">
            {editId === c.id ? (
              <>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveRename(c.id); if (e.key === "Escape") setEditId(null) }}
                  autoFocus
                  className={`${input} flex-1`}
                />
                <button onClick={() => saveRename(c.id)} disabled={busy} className="text-sm font-semibold text-emerald-600 hover:text-emerald-500">Save</button>
                <button onClick={() => setEditId(null)} className="text-sm text-gray-400 hover:text-gray-600">Cancel</button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm text-gray-700 dark:text-gray-200">{c.name}</span>
                <button onClick={() => { setEditId(c.id); setEditName(c.name) }} className="text-xs font-semibold text-gray-400 hover:text-emerald-500">Rename</button>
                <button onClick={() => remove(c)} disabled={busy} className="text-xs font-semibold text-gray-400 hover:text-red-500">Remove</button>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add() }}
          placeholder="Add a card / account…"
          className={`${input} flex-1`}
        />
        <button onClick={add} disabled={busy || !newName.trim()} className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-50 whitespace-nowrap">
          Add
        </button>
      </div>
    </div>
  )
}
