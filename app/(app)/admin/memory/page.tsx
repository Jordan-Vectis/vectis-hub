"use client"

import { useEffect, useState } from "react"

type Entry = { filename: string; content: string }

const TYPE_COLOURS: Record<string, string> = {
  user:      "bg-blue-100 text-blue-700",
  feedback:  "bg-amber-100 text-amber-700",
  project:   "bg-green-100 text-green-700",
  reference: "bg-purple-100 text-purple-700",
}

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { meta: {}, body: content.trim() }

  const meta: Record<string, string> = {}
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":")
    if (colon === -1) continue
    meta[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
  }

  return { meta, body: match[2].trim() }
}

function renderBody(body: string) {
  return body.split("\n").map((line, i) => {
    if (line.startsWith("# "))    return <h2 key={i} className="text-base font-bold text-gray-900 mt-4 mb-1">{line.slice(2)}</h2>
    if (line.startsWith("## "))   return <h3 key={i} className="text-sm font-semibold text-gray-800 mt-3 mb-1">{line.slice(3)}</h3>
    if (line.startsWith("### "))  return <h4 key={i} className="text-sm font-medium text-gray-700 mt-2 mb-0.5">{line.slice(4)}</h4>
    if (line.startsWith("- "))    return <p key={i} className="text-sm text-gray-700 leading-relaxed pl-3 before:content-['–'] before:mr-2 before:text-gray-400">{renderInline(line.slice(2))}</p>
    if (line.startsWith("**") && line.endsWith("**")) return <p key={i} className="text-sm font-semibold text-gray-800 mt-2">{line.slice(2, -2)}</p>
    if (line.trim() === "")       return <div key={i} className="h-2" />
    return <p key={i} className="text-sm text-gray-700 leading-relaxed">{renderInline(line)}</p>
  })
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>
      : part
  )
}

export default function MemoryPage() {
  const [entries, setEntries]         = useState<Entry[] | null>(null)
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const [open, setOpen]               = useState<string | null>(null)
  const [editing, setEditing]         = useState<string | null>(null)
  const [draft, setDraft]             = useState("")
  const [saving, setSaving]           = useState(false)
  const [loading, setLoading]         = useState(true)

  useEffect(() => {
    fetch("/api/admin/memory")
      .then(r => r.json())
      .then(data => {
        if (data.unavailable) { setUnavailable(data.reason); return }
        setEntries(data.entries ?? [])
      })
      .finally(() => setLoading(false))
  }, [])

  function startEdit(entry: Entry) {
    setDraft(entry.content)
    setEditing(entry.filename)
    setOpen(entry.filename)
  }

  function cancelEdit() {
    setEditing(null)
    setDraft("")
  }

  async function saveEdit(filename: string) {
    setSaving(true)
    try {
      const res = await fetch("/api/admin/memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, content: draft }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed")
      setEntries(prev => prev?.map(e => e.filename === filename ? { ...e, content: draft } : e) ?? null)
      setEditing(null)
      setDraft("")
    } catch (e: any) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Claude Memory</h1>
        <p className="text-sm text-gray-500 mt-1">
          What Claude remembers about you, this project, and how to work with you. Only available when running locally.
        </p>
      </div>

      {loading && <p className="text-sm text-gray-400">Loading…</p>}

      {unavailable && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-sm text-amber-800">
          {unavailable}
        </div>
      )}

      {entries && (
        <div className="flex flex-col gap-3">
          {entries.map(entry => {
            const isOpen    = open === entry.filename
            const isEditing = editing === entry.filename
            const content   = isEditing ? draft : entry.content
            const { meta, body } = parseFrontmatter(content)
            const typeClass = TYPE_COLOURS[meta.type ?? ""] ?? "bg-gray-100 text-gray-600"

            return (
              <div key={entry.filename} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                {/* Header */}
                <div className="flex items-start gap-2 px-5 py-4">
                  <button
                    onClick={() => { if (!isEditing) setOpen(isOpen ? null : entry.filename) }}
                    className="flex-1 flex items-start gap-4 text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900 text-sm">
                          {meta.name ?? entry.filename}
                        </span>
                        {meta.type && (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${typeClass}`}>
                            {meta.type}
                          </span>
                        )}
                        <span className="text-xs text-gray-400 font-mono">{entry.filename}</span>
                      </div>
                      {meta.description && (
                        <p className="text-xs text-gray-500 mt-0.5">{meta.description}</p>
                      )}
                    </div>
                    {!isEditing && (
                      <svg
                        className={`w-4 h-4 text-gray-400 mt-0.5 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    )}
                  </button>

                  {/* Edit / Save / Cancel buttons */}
                  {!isEditing ? (
                    <button
                      onClick={() => startEdit(entry)}
                      className="shrink-0 text-xs text-gray-400 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 transition-colors mt-0.5"
                    >
                      Edit
                    </button>
                  ) : (
                    <div className="flex gap-2 shrink-0 mt-0.5">
                      <button
                        onClick={() => saveEdit(entry.filename)}
                        disabled={saving}
                        className="text-xs font-medium text-white bg-slate-700 hover:bg-slate-800 disabled:opacity-50 px-3 py-1 rounded transition-colors"
                      >
                        {saving ? "Saving…" : "Save"}
                      </button>
                      <button
                        onClick={cancelEdit}
                        disabled={saving}
                        className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                {/* Body */}
                {isOpen && (
                  <div className="border-t border-gray-100 px-5 py-4">
                    {isEditing ? (
                      <textarea
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        className="w-full h-64 text-sm font-mono text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400 resize-y"
                        spellCheck={false}
                      />
                    ) : (
                      <div className="space-y-1">{renderBody(body)}</div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
