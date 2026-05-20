"use client"

import { useState, useEffect } from "react"
import { Draft, CONTENT_TYPES, htmlToPlain } from "./types"

const STATUSES = ["DRAFT", "APPROVED", "PUBLISHED"]

export default function DraftsTab() {
  const [drafts,    setDrafts]    = useState<Draft[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [selected,  setSelected]  = useState<Draft | null>(null)

  // Edit form state
  const [editTitle,        setEditTitle]        = useState("")
  const [editContent,      setEditContent]      = useState("")
  const [editStatus,       setEditStatus]       = useState("DRAFT")
  const [editPublishedUrl, setEditPublishedUrl] = useState("")
  const [editNotes,        setEditNotes]        = useState("")
  const [savingMsg,        setSavingMsg]        = useState<string | null>(null)
  const [copied,           setCopied]           = useState<"plain" | "html" | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/marketing/drafts")
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Failed to load"); return }
      setDrafts(data.drafts)
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function pick(d: Draft) {
    setSelected(d)
    setEditTitle(d.title)
    setEditContent(d.content)
    setEditStatus(d.status)
    setEditPublishedUrl(d.publishedUrl ?? "")
    setEditNotes(d.notes ?? "")
    setSavingMsg(null)
  }

  async function save() {
    if (!selected) return
    setSavingMsg(null)
    try {
      const res = await fetch(`/api/marketing/drafts/${selected.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          title:        editTitle,
          content:      editContent,
          status:       editStatus,
          publishedUrl: editPublishedUrl,
          notes:        editNotes,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setSavingMsg(data.error ?? "Failed to save"); return }
      setSavingMsg("✓ Saved")
      // refresh list + currently selected
      setDrafts(prev => prev.map(d => d.id === selected.id ? data.draft : d))
      setSelected(data.draft)
      setTimeout(() => setSavingMsg(null), 2000)
    } catch {
      setSavingMsg("Network error")
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this draft? This cannot be undone.")) return
    const res = await fetch(`/api/marketing/drafts/${id}`, { method: "DELETE" })
    if (res.ok) {
      setDrafts(prev => prev.filter(d => d.id !== id))
      if (selected?.id === id) setSelected(null)
    }
  }

  async function copyAs(mode: "plain" | "html") {
    if (!selected) return
    const text = mode === "plain" ? htmlToPlain(editContent) : editContent
    await navigator.clipboard.writeText(text)
    setCopied(mode)
    setTimeout(() => setCopied(null), 2000)
  }

  const statusColour = (s: string) =>
    s === "PUBLISHED" ? "bg-green-900/40 text-green-300 border-green-800" :
    s === "APPROVED"  ? "bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-800"   :
                        "bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-700"

  const typeLabel = (v: string) => CONTENT_TYPES.find(t => t.value === v)?.label ?? v

  return (
    <div className="flex-1 overflow-hidden flex">

      {/* ── List ─────────────────────────────────────────────────────────── */}
      <div className="w-80 border-r border-gray-200 dark:border-gray-800 overflow-y-auto bg-gray-950 shrink-0">
        <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-300">Saved Drafts</h2>
          <button onClick={load} className="text-xs text-gray-600 dark:text-gray-500 hover:text-pink-400">Refresh</button>
        </div>
        {loading && <p className="p-4 text-xs text-gray-600 dark:text-gray-500">Loading…</p>}
        {error && <p className="p-4 text-xs text-red-400">{error}</p>}
        {!loading && drafts.length === 0 && (
          <p className="p-4 text-xs text-gray-600 dark:text-gray-500">
            No drafts yet. Generate something on the Content tab and click <strong>Save to Drafts</strong>.
          </p>
        )}
        <div className="divide-y divide-gray-900">
          {drafts.map(d => (
            <button key={d.id} onClick={() => pick(d)}
              className={`w-full text-left px-4 py-3 hover:bg-gray-900 transition-colors ${selected?.id === d.id ? "bg-gray-900" : ""}`}>
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className={`text-[10px] px-2 py-0.5 rounded border ${statusColour(d.status)}`}>{d.status}</span>
                <span className="text-[10px] text-gray-600 dark:text-gray-500">{new Date(d.updatedAt).toLocaleDateString("en-GB")}</span>
              </div>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 line-clamp-1">{d.title}</p>
              <p className="text-xs text-gray-600 dark:text-gray-500">{typeLabel(d.contentType)} · {d.createdByName ?? "—"}</p>
            </button>
          ))}
        </div>
      </div>

      {/* ── Editor ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {!selected ? (
          <div className="h-full flex items-center justify-center text-gray-600 dark:text-gray-500 text-sm">
            Select a draft from the list to view or edit it.
          </div>
        ) : (
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <input value={editTitle} onChange={e => setEditTitle(e.target.value)}
                className="flex-1 min-w-[200px] bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-pink-500" />
              <select value={editStatus} onChange={e => setEditStatus(e.target.value)}
                className="bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-pink-500">
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <button onClick={save}
                className="bg-emerald-600 hover:bg-emerald-500 text-gray-900 dark:text-white text-sm font-semibold px-4 py-2 rounded-lg">Save</button>
              <button onClick={() => remove(selected.id)}
                className="bg-red-700 hover:bg-red-600 text-gray-900 dark:text-white text-sm font-semibold px-4 py-2 rounded-lg">Delete</button>
            </div>

            {savingMsg && <p className="text-xs text-emerald-400">{savingMsg}</p>}

            <div>
              <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Published URL (when live)</label>
              <input value={editPublishedUrl} onChange={e => setEditPublishedUrl(e.target.value)}
                placeholder="https://www.vectis.co.uk/news-stories/…"
                className="w-full bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:border-pink-500" />
            </div>

            <div>
              <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Notes</label>
              <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={2}
                placeholder="Internal notes — who reviewed, where it'll be posted, etc."
                className="w-full bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:border-pink-500" />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-600 dark:text-gray-500 mr-2">Type: <span className="text-gray-600 dark:text-gray-300">{typeLabel(selected.contentType)}</span></span>
              <button onClick={() => copyAs("plain")} className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-700 dark:text-gray-200 px-3 py-1.5 rounded-lg">{copied === "plain" ? "✓ Copied!" : "Copy Plain"}</button>
              <button onClick={() => copyAs("html")} className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-700 dark:text-gray-200 px-3 py-1.5 rounded-lg">{copied === "html" ? "✓ Copied!" : "Copy HTML"}</button>
            </div>

            <div>
              <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Content (HTML)</label>
              <textarea value={editContent} onChange={e => setEditContent(e.target.value)} rows={18}
                className="w-full bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-200 font-mono focus:outline-none focus:border-pink-500" />
            </div>

            <div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Preview</p>
              <div className="bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg p-5 prose prose-invert prose-sm max-w-none text-gray-700 dark:text-gray-200
                  [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-white [&_h1]:mb-3
                  [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-white [&_h2]:mt-5 [&_h2]:mb-2
                  [&_p]:mb-4 [&_ul]:mb-4 [&_li]:mb-1 [&_strong]:text-white"
                dangerouslySetInnerHTML={{ __html: editContent }} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
