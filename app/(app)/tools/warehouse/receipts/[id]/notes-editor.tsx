"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { updateReceipt } from "@/lib/actions/goods-in"
import { ErrorBox, btn, btnGo, input } from "../../_components/ui"

// The receipt's notes — for staff, not printed on the receipt. Saved with updateReceipt.

export default function NotesEditor({ receiptId, notes }: { receiptId: string; notes: string | null }) {
  const router = useRouter()
  // What we just saved stands in for the page's copy until the page's fresh copy arrives.
  const [mine, setMine] = useState<{ was: string; now: string } | null>(null)
  const saved = mine && mine.was === (notes ?? "") ? mine.now : (notes ?? "")
  // The text being typed, and the saved text it started from. When the page's copy changes
  // underneath (a void reason was added, someone else saved), an untouched box follows it.
  const [draft, setDraft] = useState<{ base: string; text: string }>({ base: saved, text: saved })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  const text = draft.base === saved || draft.text !== draft.base ? draft.text : saved
  const dirty = text.trim() !== saved.trim()

  const save = async () => {
    setSaving(true)
    setError(null)
    setJustSaved(false)
    const res = await updateReceipt(receiptId, { notes: text })
    setSaving(false)
    if (!res.ok) { setError(res.error); return }
    setMine({ was: notes ?? "", now: text.trim() })
    setDraft({ base: text.trim(), text: text.trim() })
    setJustSaved(true)
    router.refresh()
  }

  return (
    <div className="space-y-2">
      <label htmlFor="receipt-notes" className="sr-only">Notes</label>
      <textarea
        id="receipt-notes"
        className={`${input} min-h-28`}
        rows={4}
        maxLength={4000}
        value={text}
        onChange={e => { setDraft({ base: saved, text: e.target.value }); setJustSaved(false) }}
        placeholder="Anything the team should know — e.g. customer coming back Friday with two more boxes."
      />
      {error && <ErrorBox onDismiss={() => setError(null)}>{error}</ErrorBox>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnGo} disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save notes"}</button>
        {dirty && !saving && <button type="button" className={btn} onClick={() => { setDraft({ base: saved, text: saved }); setError(null) }}>Undo changes</button>}
        {justSaved && !dirty && <span role="status" className="text-sm text-emerald-700 dark:text-emerald-300">✓ Notes saved</span>}
        {!dirty && !justSaved && <span className="text-xs text-gray-500 dark:text-gray-400">Staff only — not printed on the receipt.</span>}
      </div>
    </div>
  )
}
