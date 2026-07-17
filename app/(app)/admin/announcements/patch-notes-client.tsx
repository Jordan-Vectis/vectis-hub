"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { savePatchNote, deletePatchNote, pushPatchNote, unpublishPatchNote } from "@/lib/actions/patch-notes"

export type PatchNoteRow = {
  id: string
  title: string
  body: string
  published: boolean
  createdAt: string
  createdByName: string | null
  seenCount: number
}

// null = the notes loaded fine. Otherwise, why they didn't — a missing table is the
// expected pre-migration state and gets a "Run Migrations" hint; anything else is a
// real fault and must show the actual error, not send the admin to a button that
// won't help.
export type PatchNotesLoadState = { status: "no-table" } | { status: "error"; message: string } | null

const input =
  "w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"

const PLACEHOLDER = `- Fixed duplicate barcodes being saved in the lot wizard
- Smart scan now keeps going if the AI is rate limited
- Tablet cataloguing remembers your filters when you go back`

export default function PatchNotesManager({ notes, loadState }: { notes: PatchNoteRow[]; loadState: PatchNotesLoadState }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [editing, setEditing] = useState<string | null>(null)   // note id, or "new"
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  function openNew() {
    setEditing("new"); setTitle(""); setBody(""); setError(null); setSaved(null)
  }
  function openEdit(n: PatchNoteRow) {
    setEditing(n.id); setTitle(n.title); setBody(n.body); setError(null); setSaved(null)
  }
  function cancel() { setEditing(null); setError(null) }

  function save() {
    const wasLive = notes.find((n) => n.id === editing)?.published
    setError(null); setSaved(null)
    start(async () => {
      const res = await savePatchNote({ id: editing === "new" ? undefined : editing!, title, body })
      if (!res.ok) { setError(res.error ?? "Could not save."); return }
      setSaved(wasLive
        ? "Saved. This note is already live, but nobody who's read it will see it again unless you press Push."
        : "Saved as a draft — nobody sees it yet. Press Push when you're ready to send it out.")
      setEditing(null)
      router.refresh()
    })
  }

  function push(n: PatchNoteRow) {
    const label = n.title || "Untitled"
    const message = n.seenCount > 0
      ? `Push "${label}" to everyone?\n\n${n.seenCount} ${n.seenCount === 1 ? "person has" : "people have"} already read this note — pushing will show it to them again, along with everyone else.`
      : `Push "${label}" to everyone?\n\nAll staff will see it as a popup next time they load the app.`
    if (!confirm(message)) return
    setError(null); setSaved(null)
    start(async () => {
      const res = await pushPatchNote(n.id)
      if (!res.ok) { setError(res.error ?? "Could not push."); return }
      setSaved("Pushed — staff will see it next time they load the app.")
      router.refresh()
    })
  }

  function unpublish(n: PatchNoteRow) {
    if (!confirm(`Stop showing "${n.title || "Untitled"}"?\n\nAnyone who hasn't read it yet won't see it. It stays here as a draft.`)) return
    setError(null); setSaved(null)
    start(async () => {
      const res = await unpublishPatchNote(n.id)
      if (!res.ok) { setError(res.error ?? "Could not stop showing."); return }
      setSaved("Stopped — nobody new will see this note.")
      router.refresh()
    })
  }

  function remove(n: PatchNoteRow) {
    if (!confirm(`Delete "${n.title || "Untitled"}"? This can't be undone.`)) return
    setError(null); setSaved(null)
    start(async () => {
      const res = await deletePatchNote(n.id)
      if (!res.ok) { setError(res.error ?? "Could not delete."); return }
      setSaved("Patch note deleted.")
      router.refresh()
    })
  }

  if (loadState?.status === "no-table") {
    return (
      <div className="rounded-lg border border-amber-400/50 bg-amber-500/10 px-4 py-3">
        <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">Patch notes need a database migration</p>
        <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-1">
          The <code>PatchNote</code> table doesn&apos;t exist yet. Click <strong>Run Migrations</strong> (the admin banner at
          the top of the app), then reload this page. Nothing else in the app is affected in the meantime.
        </p>
      </div>
    )
  }

  if (loadState?.status === "error") {
    return (
      <div className="rounded-lg border border-red-400/50 bg-red-500/10 px-4 py-3">
        <p className="text-sm font-semibold text-red-600 dark:text-red-300">Couldn&apos;t load the patch notes</p>
        <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-1">
          {loadState.message} — this isn&apos;t a missing migration, so Run Migrations won&apos;t help. Try reloading; if it
          persists it&apos;s likely the database connection.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-lg">
          A short summary of fixes and changes, shown once as a popup to each person. Nothing is sent until you
          press <strong>Push</strong> — write it, save it, reread it, then push when you&apos;re ready. Staff read
          it, press <strong>Got it</strong>, and it&apos;s gone for them.
        </p>
        {editing !== "new" && (
          <button onClick={openNew} disabled={busy}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-semibold flex-shrink-0">
            + New patch note
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {saved && <p className="text-sm text-emerald-600 dark:text-emerald-400">{saved}</p>}

      {editing === "new" && <Editor {...{ title, setTitle, body, setBody, save, cancel, busy }} isNew />}

      {!notes.length && editing !== "new" && (
        <p className="text-sm text-gray-400 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg px-4 py-6 text-center">
          No patch notes yet. Write one when you next ship a batch of changes.
        </p>
      )}

      <div className="space-y-3">
        {notes.map((n) => (
          <div key={n.id} className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1C1C1E] p-4">
            {editing === n.id ? (
              <Editor {...{ title, setTitle, body, setBody, save, cancel, busy }} />
            ) : (
              <>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-gray-900 dark:text-white">{n.title || "Untitled"}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(n.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                      {n.createdByName ? ` · ${n.createdByName}` : ""}
                      {n.published ? ` · read by ${n.seenCount} ${n.seenCount === 1 ? "person" : "people"}` : ""}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full flex-shrink-0 ${n.published ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" : "bg-gray-200 dark:bg-gray-800 text-gray-500"}`}>
                    {n.published ? "● Pushed" : "Draft — not sent"}
                  </span>
                </div>
                {n.body && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 whitespace-pre-wrap line-clamp-4">{n.body}</p>
                )}
                <div className="flex gap-2 mt-3 flex-wrap items-center">
                  {/* Push is the deliberate step that sends the note out, so it's the
                      only filled button on the card — nothing else here reaches staff. */}
                  <button onClick={() => push(n)} disabled={busy}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold disabled:opacity-40">
                    {n.published ? "🚀 Push again" : "🚀 Push to everyone"}
                  </button>
                  <button onClick={() => openEdit(n)} disabled={busy}
                    className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-500 text-xs font-semibold disabled:opacity-40">
                    Edit
                  </button>
                  {n.published && (
                    <button onClick={() => unpublish(n)} disabled={busy}
                      className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-500 text-xs font-semibold disabled:opacity-40">
                      Stop showing
                    </button>
                  )}
                  <button onClick={() => remove(n)} disabled={busy}
                    className="px-3 py-1.5 rounded-lg border border-red-400 text-red-500 hover:bg-red-500/10 text-xs font-semibold disabled:opacity-40">
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function Editor({
  title, setTitle, body, setBody, save, cancel, busy, isNew,
}: {
  title: string; setTitle: (v: string) => void
  body: string; setBody: (v: string) => void
  save: () => void; cancel: () => void
  busy: boolean; isNew?: boolean
}) {
  return (
    <div className={`space-y-3 ${isNew ? "rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4" : ""}`}>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={input}
          placeholder="e.g. Cataloguing fixes — 16 July" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">What&apos;s changed</label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6}
          placeholder={PLACEHOLDER} className={`${input} resize-y font-mono text-xs`} />
        <p className="text-xs text-gray-400 mt-1">One change per line. Start a line with <code>-</code> for a bullet.</p>
      </div>
      <div className="flex gap-2 items-center flex-wrap">
        <button onClick={save} disabled={busy || (!title.trim() && !body.trim())}
          className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-semibold">
          {busy ? "Saving…" : "Save"}
        </button>
        <button onClick={cancel} disabled={busy}
          className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-sm font-semibold disabled:opacity-40">
          Cancel
        </button>
        <span className="text-xs text-gray-400">Saving doesn&apos;t send it — you push it when you&apos;re ready.</span>
      </div>
    </div>
  )
}
