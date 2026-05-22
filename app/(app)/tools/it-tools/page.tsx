"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import ModelPingTester from "@/components/model-ping-tester"

const FALLBACK_MODEL = "gemini-3-flash-preview"

type Source = { kind: "article" | "ticket"; id: string; title: string; snippet: string }

type Template = {
  id:        string
  name:      string
  category:  string
  body:      string
  sortOrder: number
}

export default function ITToolsPage() {
  const [tab, setTab] = useState<"reply" | "templates">("reply")

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <Link href="/hub" className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-300">← Hub</Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-1">IT Tools</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Draft replies to customer emails using the knowledge base + past tickets, or copy from your library of pre-typed replies.
        </p>
      </div>

      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-6">
        {(["reply", "templates"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-sm font-medium px-4 py-2 -mb-px border-b-2 transition-colors ${
              tab === t
                ? "border-cyan-500 text-cyan-700"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 dark:text-gray-200"
            }`}
          >
            {t === "reply" ? "✍️ Draft Reply" : "📋 Templates"}
          </button>
        ))}
      </div>

      {tab === "reply"     ? <DraftReplyTab /> : null}
      {tab === "templates" ? <TemplatesTab />  : null}
    </div>
  )
}

// ─── Draft reply tab ──────────────────────────────────────────────────────────

function DraftReplyTab() {
  const [email, setEmail]       = useState("")
  const [notes, setNotes]       = useState("")
  const [reply, setReply]       = useState("")
  const [sources, setSources]   = useState<Source[]>([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState("")
  const [copied, setCopied]     = useState(false)
  const [modelList, setModelList]   = useState<string[]>([FALLBACK_MODEL])
  const [modelId, setModelId]       = useState(FALLBACK_MODEL)
  const [savedDefault, setSavedDef] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/auction-ai/models").then(r => r.json()).then(d => {
      if (d.models?.length) {
        setModelList(d.models)
        const saved = typeof window !== "undefined" ? localStorage.getItem("it_tools_default_model") : null
        setSavedDef(saved)
        if (saved && d.models.includes(saved))                   setModelId(saved)
        else if (d.models.includes(FALLBACK_MODEL))              setModelId(FALLBACK_MODEL)
        else                                                     setModelId(d.models[0])
      }
    }).catch(() => {})
  }, [])

  function setAsDefault() {
    localStorage.setItem("it_tools_default_model", modelId); setSavedDef(modelId)
  }
  function clearDefault() {
    localStorage.removeItem("it_tools_default_model"); setSavedDef(null)
  }

  async function draft() {
    if (!email.trim()) { setError("Paste the customer email first"); return }
    setError(""); setLoading(true); setReply(""); setSources([]); setCopied(false)
    try {
      const r = await fetch("/api/it-tools/draft-reply", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email, notes, modelId }),
      })
      const d = await r.json()
      if (!r.ok) { setError(d.error ?? "Draft failed"); return }
      setReply(d.reply ?? "")
      setSources(d.sources ?? [])
    } catch (e: any) {
      setError(e?.message ?? "Network error")
    } finally {
      setLoading(false)
    }
  }

  async function copyReply() {
    if (!reply) return
    await navigator.clipboard.writeText(reply)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">{error}</div>
      )}

      <label className="block">
        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Customer email</div>
        <textarea
          value={email}
          onChange={e => setEmail(e.target.value)}
          rows={10}
          placeholder="Paste the customer's email here…"
          className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 resize-y"
        />
      </label>

      <label className="block">
        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
          Extra context <span className="font-normal text-gray-400 dark:text-gray-500">(optional)</span>
        </div>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          placeholder="Anything the AI should know — e.g. 'customer is C218765', 'their account was suspended on the 3rd', etc."
          className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 resize-y"
        />
      </label>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={draft}
          disabled={loading || !email.trim()}
          className="bg-cyan-600 hover:bg-cyan-500 disabled:bg-cyan-400 text-white text-sm font-semibold px-5 py-2 rounded-lg"
        >
          {loading ? "Drafting…" : "✍️ Draft reply"}
        </button>
        <span className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          Model:
          <select
            value={modelId}
            onChange={e => setModelId(e.target.value)}
            className="border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-xs bg-white dark:bg-gray-900"
          >
            {modelList.map(m => <option key={m} value={m}>{m}{savedDefault === m ? " ★" : ""}</option>)}
          </select>
          {savedDefault === modelId ? (
            <button onClick={clearDefault} className="text-amber-600 hover:text-amber-700">★ Default · clear</button>
          ) : (
            <button onClick={setAsDefault} className="text-gray-500 dark:text-gray-400 hover:text-cyan-700">Set as default</button>
          )}
          <ModelPingTester
            models={modelList}
            current={modelId}
            onPick={setModelId}
          />
        </span>
      </div>

      {reply && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Drafted reply</div>
            <button
              onClick={copyReply}
              className="text-xs bg-cyan-600 hover:bg-cyan-500 text-white font-semibold px-3 py-1 rounded-md"
            >
              {copied ? "✓ Copied" : "📋 Copy"}
            </button>
          </div>
          <textarea
            value={reply}
            onChange={e => setReply(e.target.value)}
            rows={Math.max(8, reply.split("\n").length + 1)}
            className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 resize-y font-mono"
          />

          {sources.length > 0 && (
            <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1.5">Sources used</div>
              <ul className="space-y-1.5">
                {sources.map((s, i) => (
                  <li key={s.id} className="text-xs text-gray-700 dark:text-gray-300">
                    <span className="font-medium">{i + 1}. {s.title}</span>{" "}
                    <span className="text-gray-500 dark:text-gray-400">({s.kind === "article" ? "article" : "resolved ticket"})</span>
                    <div className="text-gray-500 dark:text-gray-400 mt-0.5">{s.snippet}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Templates tab ────────────────────────────────────────────────────────────

function TemplatesTab() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState("")
  const [editing, setEditing]     = useState<Template | "NEW" | null>(null)
  const [copiedId, setCopiedId]   = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch("/api/email-templates")
      const d = await r.json()
      setTemplates(d.templates ?? [])
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return templates
    return templates.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.body.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q)
    )
  }, [templates, search])

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, Template[]>()
    for (const t of visible) {
      const arr = map.get(t.category) ?? []
      arr.push(t)
      map.set(t.category, arr)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [visible])

  async function copy(t: Template) {
    await navigator.clipboard.writeText(t.body)
    setCopiedId(t.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search templates…"
          className="flex-1 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm"
        />
        <button
          onClick={() => setEditing("NEW")}
          className="bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold px-4 py-2 rounded-lg shrink-0"
        >
          + New template
        </button>
      </div>

      {loading ? (
        <div className="text-gray-500 dark:text-gray-400 text-sm">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="text-gray-500 dark:text-gray-400 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 text-center">
          No templates yet. Click &quot;New template&quot; to add your first reply.
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([cat, list]) => (
            <div key={cat}>
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-2">{cat}</div>
              <div className="space-y-2">
                {list.map(t => (
                  <div key={t.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{t.name}</h3>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => copy(t)}
                          className="bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold px-3 py-1 rounded-md"
                        >
                          {copiedId === t.id ? "✓ Copied" : "📋 Copy"}
                        </button>
                        <button
                          onClick={() => setEditing(t)}
                          className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white dark:text-white hover:underline"
                        >
                          Edit
                        </button>
                      </div>
                    </div>
                    <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans">{t.body}</pre>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <TemplateEditor
          template={editing === "NEW" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}

// ─── Template editor modal ────────────────────────────────────────────────────

function TemplateEditor({
  template,
  onClose,
  onSaved,
}: {
  template: Template | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName]         = useState(template?.name     ?? "")
  const [category, setCategory] = useState(template?.category ?? "GENERAL")
  const [body, setBody]         = useState(template?.body     ?? "")
  const [saving, setSaving]     = useState(false)

  async function save() {
    if (!name.trim() || !body.trim()) { alert("Name and body are required"); return }
    setSaving(true)
    try {
      const url    = template ? `/api/email-templates/${template.id}` : "/api/email-templates"
      const method = template ? "PATCH" : "POST"
      const r = await fetch(url, {
        method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, category, body }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        alert(d.error ?? "Save failed"); return
      }
      onSaved()
    } finally { setSaving(false) }
  }

  async function remove() {
    if (!template) return
    if (!confirm("Delete this template permanently?")) return
    setSaving(true)
    try {
      const r = await fetch(`/api/email-templates/${template.id}`, { method: "DELETE" })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        alert(d.error ?? "Delete failed"); return
      }
      onSaved()
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{template ? "Edit template" : "New template"}</h2>
        </div>
        <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
          <label className="block">
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Name</div>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2"
              autoFocus
              placeholder="e.g. Password reset instructions"
            />
          </label>
          <label className="block">
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Category</div>
            <input
              type="text"
              value={category}
              onChange={e => setCategory(e.target.value.toUpperCase().replace(/[^A-Z0-9]+/g, "_"))}
              className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 font-mono"
              placeholder="GENERAL"
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Templates are grouped by category in the list. Free-form text — use whatever buckets suit you (e.g. PAYMENTS, ACCOUNTS, AUCTION).
            </p>
          </label>
          <label className="block">
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Body</div>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={14}
              placeholder="The full reply text — exactly as you want it pasted into your email."
              className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 font-mono resize-y"
            />
          </label>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2">
          {template ? (
            <button onClick={remove} disabled={saving} className="text-sm text-red-600 hover:underline">Delete</button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} disabled={saving} className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white dark:text-white px-4 py-2 rounded-lg">Cancel</button>
            <button
              onClick={save}
              disabled={saving}
              className="bg-cyan-600 hover:bg-cyan-500 disabled:bg-cyan-400 text-white text-sm font-semibold px-4 py-2 rounded-lg"
            >
              {saving ? "Saving…" : "Save template"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
