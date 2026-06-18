"use client"

import { useState, useTransition } from "react"
import { addSubmissionNote, deleteSubmissionNote } from "@/lib/actions/submissions"

type Note = { id: string; body: string; authorName: string; when: string }

export default function NotesSection({
  submissionId,
  notes,
}: {
  submissionId: string
  notes: Note[]
}) {
  const [text, setText] = useState("")
  const [isPending, startTransition] = useTransition()

  function add() {
    const t = text.trim()
    if (!t) return
    setText("")
    startTransition(async () => { await addSubmissionNote(submissionId, t) })
  }

  return (
    <div>
      <div className="space-y-3 mb-3">
        {notes.length === 0 && (
          <p className="text-sm text-gray-400">No notes yet — jot anything the team needs to know here.</p>
        )}
        {notes.map((n) => (
          <div key={n.id} className="rounded-xl bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800/40 p-3">
            <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
              <span className="font-semibold text-sm text-amber-800 dark:text-amber-300">📝 {n.authorName}</span>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400">{n.when}</span>
                <button
                  onClick={() => { if (confirm("Delete this note?")) startTransition(async () => { await deleteSubmissionNote(n.id, submissionId) }) }}
                  disabled={isPending}
                  className="text-xs text-red-500 hover:text-red-700 font-semibold"
                >
                  Delete
                </button>
              </div>
            </div>
            <p className="text-base text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words">{n.body}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="Add a note…"
          className="flex-1 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
        <button
          onClick={add}
          disabled={isPending || !text.trim()}
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 rounded-xl transition-colors disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  )
}
