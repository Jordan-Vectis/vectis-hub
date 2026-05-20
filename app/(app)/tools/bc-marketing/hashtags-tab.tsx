"use client"

import { useState, useEffect } from "react"
import { HashtagBank } from "./types"

export default function HashtagsTab() {
  const [banks,   setBanks]   = useState<HashtagBank[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  // New bank form
  const [newCategory, setNewCategory] = useState("")
  const [newTags,     setNewTags]     = useState("")
  const [adding,      setAdding]      = useState(false)

  // Inline edit
  const [editing,    setEditing]    = useState<string | null>(null)
  const [editTags,   setEditTags]   = useState("")
  const [copiedId,   setCopiedId]   = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/marketing/hashtags")
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Failed to load"); return }
      setBanks(data.banks)
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  function parseTags(input: string): string[] {
    return input
      .split(/[\s,]+/)
      .map(t => t.trim())
      .filter(Boolean)
      .map(t => t.startsWith("#") ? t : "#" + t)
  }

  async function addBank() {
    if (!newCategory.trim()) return
    setAdding(true)
    try {
      const res = await fetch("/api/marketing/hashtags", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ category: newCategory, hashtags: parseTags(newTags) }),
      })
      const data = await res.json()
      if (res.ok) {
        setBanks(prev => [...prev, data.bank].sort((a, b) => a.category.localeCompare(b.category)))
        setNewCategory("")
        setNewTags("")
      }
    } finally {
      setAdding(false)
    }
  }

  async function saveEdit(id: string) {
    const res = await fetch(`/api/marketing/hashtags/${id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ hashtags: parseTags(editTags) }),
    })
    const data = await res.json()
    if (res.ok) {
      setBanks(prev => prev.map(b => b.id === id ? data.bank : b))
      setEditing(null)
    }
  }

  async function deleteBank(id: string, category: string) {
    if (!confirm(`Delete the "${category}" hashtag bank?`)) return
    const res = await fetch(`/api/marketing/hashtags/${id}`, { method: "DELETE" })
    if (res.ok) setBanks(prev => prev.filter(b => b.id !== id))
  }

  async function copyTags(id: string, tags: string[]) {
    await navigator.clipboard.writeText(tags.join(" "))
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Curated hashtag sets for social posts, organised by category. Click <strong>Copy</strong> to paste straight into a caption.
      </p>

      {/* Add new bank */}
      <div className="bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl p-5 space-y-3">
        <h2 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Add New Bank</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input value={newCategory} onChange={e => setNewCategory(e.target.value)}
            placeholder="Category (e.g. Star Wars)"
            className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:border-pink-500" />
          <input value={newTags} onChange={e => setNewTags(e.target.value)}
            placeholder="Tags — comma or space separated"
            className="sm:col-span-2 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:border-pink-500" />
        </div>
        <button onClick={addBank} disabled={adding || !newCategory.trim()}
          className="bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-gray-900 dark:text-white text-sm font-semibold px-4 py-2 rounded-lg">
          {adding ? "Adding…" : "Add Bank"}
        </button>
      </div>

      {error && <div className="bg-red-900/40 border border-red-700 rounded-xl px-4 py-3 text-red-700 dark:text-red-300 text-sm">{error}</div>}

      {loading && <p className="text-sm text-gray-600 dark:text-gray-500">Loading…</p>}

      {/* Banks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {banks.map(b => (
          <div key={b.id} className="bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900 dark:text-white">{b.category}</h3>
              <div className="flex gap-2">
                <button onClick={() => copyTags(b.id, b.hashtags)} className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-700 dark:text-gray-200 px-3 py-1 rounded-lg">
                  {copiedId === b.id ? "✓ Copied!" : "Copy"}
                </button>
                {editing === b.id ? (
                  <>
                    <button onClick={() => saveEdit(b.id)} className="text-xs bg-emerald-600 hover:bg-emerald-500 text-gray-900 dark:text-white px-3 py-1 rounded-lg">Save</button>
                    <button onClick={() => setEditing(null)} className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-700 dark:text-gray-200 px-3 py-1 rounded-lg">Cancel</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => { setEditing(b.id); setEditTags(b.hashtags.join(" ")) }} className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-700 dark:text-gray-200 px-3 py-1 rounded-lg">Edit</button>
                    <button onClick={() => deleteBank(b.id, b.category)} className="text-xs text-red-400 hover:text-red-300">Delete</button>
                  </>
                )}
              </div>
            </div>
            {editing === b.id ? (
              <textarea value={editTags} onChange={e => setEditTags(e.target.value)} rows={3}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-pink-500" />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {b.hashtags.length === 0 ? (
                  <p className="text-xs text-gray-600 dark:text-gray-500 italic">No tags yet — click Edit.</p>
                ) : (
                  b.hashtags.map(t => (
                    <span key={t} className="text-xs bg-gray-800 text-gray-600 dark:text-gray-300 px-2 py-1 rounded">{t}</span>
                  ))
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {!loading && banks.length === 0 && (
        <p className="text-center text-sm text-gray-600 dark:text-gray-500 py-8">No hashtag banks yet. Add one above.</p>
      )}
    </div>
  )
}
