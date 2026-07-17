"use client"

import { useEffect, useState } from "react"

type Note = { id: string; title: string; body: string; createdAt: string }

// Shows each user any published patch notes they haven't read, one at a time, with a
// Next button and a final "Got it". Clicking through records a PatchNoteSeen row per
// user (not localStorage — the cataloguing iPads are shared, so a browser-level dismiss
// would hide the note from everyone who logs in after the first person).
//
// Deliberately quieter than TermsGate: no signature, nothing recorded beyond "seen",
// and it never blocks the app on failure — patch notes are informational.
export default function PatchNotesPopup() {
  const [notes, setNotes] = useState<Note[]>([])
  const [index, setIndex] = useState(0)
  const [closing, setClosing] = useState(false)

  // Fetched once on mount. No poll or socket, unlike the announcement banner: a patch
  // note isn't urgent, so catching it on the next page load is soon enough.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/patch-notes", { cache: "no-store" })
        const data = await res.json()
        if (!cancelled && Array.isArray(data?.notes)) setNotes(data.notes)
      } catch {
        /* patch notes are a nicety — stay silent and show nothing */
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (closing || !notes.length) return null

  const note = notes[index]
  const isLast = index === notes.length - 1

  async function finish() {
    // Hide immediately: the click is the acknowledgement, and making someone wait on a
    // round trip to dismiss a changelog would be worse than a "seen" row that failed to
    // save (which only costs them seeing it once more).
    setClosing(true)
    try {
      await fetch("/api/patch-notes/seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: notes.map((n) => n.id) }),
      })
    } catch {
      /* they'll see it again next load — acceptable */
    }
  }

  return (
    <div className="fixed inset-0 z-[190] bg-black/70 flex items-center justify-center p-3 sm:p-6">
      <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800 w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
              ✨ What&apos;s new
            </span>
            {notes.length > 1 && (
              <span className="text-xs font-medium text-gray-400">{index + 1} of {notes.length}</span>
            )}
          </div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mt-2">{note.title || "Update"}</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {new Date(note.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1">
          <NoteBody body={note.body} />
        </div>

        <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between gap-3">
          <div className="flex gap-1.5">
            {notes.length > 1 && notes.map((n, i) => (
              <span key={n.id} className={`h-1.5 w-1.5 rounded-full ${i === index ? "bg-emerald-500" : "bg-gray-300 dark:bg-gray-700"}`} />
            ))}
          </div>
          <button
            type="button"
            onClick={() => (isLast ? finish() : setIndex(index + 1))}
            className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold"
          >
            {isLast ? "Got it ✓" : "Next →"}
          </button>
        </div>
      </div>
    </div>
  )
}

// Renders the note body without pulling in a markdown dependency: blank lines space
// things out, and a leading -, • or * becomes a bullet. Anything else is a paragraph.
function NoteBody({ body }: { body: string }) {
  const lines = body.split("\n")

  return (
    <div className="space-y-1.5 text-sm text-gray-700 dark:text-gray-300">
      {lines.map((raw, i) => {
        const line = raw.trim()
        if (!line) return <div key={i} className="h-2" />
        const bullet = /^[-•*]\s+/.test(line)
        if (bullet) {
          return (
            <div key={i} className="flex gap-2 leading-relaxed">
              <span className="text-emerald-500 flex-shrink-0">•</span>
              <span>{line.replace(/^[-•*]\s+/, "")}</span>
            </div>
          )
        }
        return <p key={i} className="leading-relaxed">{line}</p>
      })}
    </div>
  )
}
