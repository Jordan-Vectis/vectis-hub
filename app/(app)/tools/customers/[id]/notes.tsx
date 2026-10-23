"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { addCustomerNote, deleteCustomerNote, setFollowUpDone } from "@/lib/actions/customer-notes"
import { NOTE_KINDS, NOTE_MAX, looksLikeBankDetails, type NoteKind } from "@/lib/customers/filters"

// Customers → Notes & calls: the composer and the list. The Hub's own CRM record on a person.

export type NoteDTO = { id: string; kind: string; text: string; followUpAt: string | null; followUpDone: boolean; byId: string | null; byName: string | null; createdAt: string }

const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" }) : null
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
const KIND_LABEL = Object.fromEntries(NOTE_KINDS.map(k => [k.key, k.label])) as Record<string, string>
const btn = "min-h-[44px] inline-flex items-center justify-center px-4 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm font-semibold text-gray-800 dark:text-gray-100 hover:border-indigo-400 disabled:opacity-50"

export function NoteComposer({ customerId, compact }: { customerId: string; compact?: boolean }) {
  const router = useRouter()
  const [kind, setKind] = useState<NoteKind>("note")
  const [text, setText] = useState("")
  const [followUp, setFollowUp] = useState("")
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const [pending, start] = useTransition()
  const bankWarning = text.length > 8 && looksLikeBankDetails(text)

  function save() {
    setError(""); setSaved(false)
    start(async () => {
      const r = await addCustomerNote(customerId, { kind, text, followUpAt: followUp || null })
      if (!r.ok) { setError(r.error ?? "Couldn't save."); return }
      setText(""); setFollowUp(""); setSaved(true)
      router.refresh()
    })
  }

  return (
    <form onSubmit={e => { e.preventDefault(); if (!pending) save() }} className="space-y-2">
      <label htmlFor={`note-${customerId}`} className="sr-only">Add a note</label>
      <textarea id={`note-${customerId}`} value={text} onChange={e => setText(e.target.value)} rows={compact ? 2 : 3} maxLength={NOTE_MAX}
        placeholder="Add a note, or log a call, email or visit… who said what, and when"
        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm" />
      <div className="flex flex-wrap gap-2 items-center">
        <fieldset className="flex gap-1">
          <legend className="sr-only">Kind</legend>
          {NOTE_KINDS.map(k => (
            <label key={k.key} className={`min-h-[36px] inline-flex items-center px-3 rounded-full border text-sm cursor-pointer ${kind === k.key ? "bg-indigo-600 border-indigo-600 text-white" : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200"}`}>
              <input type="radio" name={`kind-${customerId}`} className="sr-only" checked={kind === k.key} onChange={() => setKind(k.key)} />{k.label}
            </label>
          ))}
        </fieldset>
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 ml-auto">Follow up
          <input type="date" value={followUp} onChange={e => setFollowUp(e.target.value)} className="min-h-[36px] px-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm" aria-label="Follow-up date" />
        </label>
        <button type="submit" disabled={pending || !text.trim() || bankWarning} className="min-h-[44px] px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50">{pending ? "Saving…" : "Save"}</button>
      </div>
      {bankWarning && <p className="text-xs text-red-600 dark:text-red-400">That looks like bank or card details — they are never stored in the Hub.</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {saved && !error && <p className="text-xs text-green-700 dark:text-green-400">✓ Saved.</p>}
    </form>
  )
}

export function NotesList({ notes, meId, isAdmin, filter }: { notes: NoteDTO[]; meId: string; isAdmin: boolean; filter?: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [error, setError] = useState("")
  const shown = filter && filter !== "all" ? notes.filter(n => n.kind === filter) : notes

  async function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(id); setError("")
    const r = await fn()
    setBusy(null); setConfirm(null)
    if (!r.ok) setError(r.error ?? "Couldn't do that.")
    else router.refresh()
  }

  if (shown.length === 0) return <p className="text-sm text-gray-500 dark:text-gray-400">{notes.length === 0 ? "Nothing recorded yet." : "Nothing of that kind."}</p>
  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {shown.map(n => {
        const due = n.followUpAt && !n.followUpDone && new Date(n.followUpAt).getTime() < Date.now() + 86_400_000
        return (
          <div key={n.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
              <span className="font-bold text-gray-700 dark:text-gray-200">{KIND_LABEL[n.kind] ?? n.kind}</span>
              <span>{when(n.createdAt)}</span>
              {n.byName && <span>· {n.byName}</span>}
              {n.followUpAt && (
                <span className={`ml-auto inline-flex items-center gap-2 ${n.followUpDone ? "text-green-700 dark:text-green-400" : due ? "text-amber-600 dark:text-amber-400 font-semibold" : ""}`}>
                  {n.followUpDone ? "✓ Followed up" : `Follow up ${day(n.followUpAt)}`}
                  <button type="button" disabled={busy === n.id} onClick={() => run(n.id, () => setFollowUpDone(n.id, !n.followUpDone))}
                    className="min-h-[32px] px-2 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-indigo-400 disabled:opacity-50">
                    {n.followUpDone ? "Undo" : "Done"}
                  </button>
                </span>
              )}
            </div>
            <p className="mt-1.5 text-sm text-gray-900 dark:text-gray-100 whitespace-pre-line">{n.text}</p>
            {(isAdmin || n.byId === meId) && (
              <div className="mt-2 flex gap-2 justify-end">
                {confirm === n.id ? (
                  <>
                    <span className="text-xs text-gray-600 dark:text-gray-300 self-center">Delete this {KIND_LABEL[n.kind]?.toLowerCase() ?? "note"}?</span>
                    <button type="button" disabled={busy === n.id} onClick={() => run(n.id, () => deleteCustomerNote(n.id))} className="min-h-[36px] px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold disabled:opacity-50">Yes, delete</button>
                    <button type="button" onClick={() => setConfirm(null)} className="min-h-[36px] px-3 rounded-lg border border-gray-300 dark:border-gray-600 text-xs text-gray-700 dark:text-gray-200">Cancel</button>
                  </>
                ) : (
                  <button type="button" onClick={() => setConfirm(n.id)} className="min-h-[36px] px-3 rounded-lg text-xs text-gray-500 hover:text-red-600 dark:hover:text-red-400">Delete</button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function NotesFilter({ value }: { value: string }) {
  const router = useRouter()
  const opts = [{ key: "all", label: "All" }, ...NOTE_KINDS.map(k => ({ key: k.key, label: `${k.label}s` }))]
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
      {opts.map(o => (
        <button key={o.key} type="button" aria-pressed={value === o.key}
          onClick={() => { const u = new URL(window.location.href); u.searchParams.set("tab", "notes"); if (o.key === "all") u.searchParams.delete("kind"); else u.searchParams.set("kind", o.key); router.replace(u.pathname + u.search) }}
          className={`min-h-[36px] px-3 rounded-full border text-sm ${value === o.key ? "bg-indigo-600 border-indigo-600 text-white" : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200"}`}>{o.label}</button>
      ))}
    </div>
  )
}

export { btn as noteBtn }
