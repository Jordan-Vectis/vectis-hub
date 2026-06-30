"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import ModelPingTester from "@/components/model-ping-tester"

const FALLBACK_MODEL = "gemini-3-flash-preview"

// ─── Types ────────────────────────────────────────────────────────────────────

type Article = {
  id:            string
  title:         string
  body:          string
  tags:          string[]
  category:      string
  createdByName: string
  updatedByName: string | null
  createdAt:     string
  updatedAt:     string
}

type Source = {
  kind:    "article" | "ticket"
  id:      string
  title:   string
  snippet: string
}

type ChatTurn = {
  role:    "user" | "assistant"
  text:    string
  sources?: Source[]
}

const CATEGORIES = ["GENERAL", "HARDWARE", "SOFTWARE", "NETWORK", "APP", "HOW_TO"] as const
const CATEGORY_LABEL: Record<string, string> = {
  GENERAL:  "General",
  HARDWARE: "Hardware",
  SOFTWARE: "Software",
  NETWORK:  "Network",
  APP:      "App",
  HOW_TO:   "How-to",
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ITHelpPage() {
  const [tab, setTab] = useState<"ask" | "articles">("ask")

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <Link href="/hub" className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-300">← Hub</Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-1">IT Help</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Ask the chatbot for solutions to common IT problems, or browse and edit the knowledge base.
        </p>
      </div>

      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-6">
        {(["ask", "articles"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-sm font-medium px-4 py-2 -mb-px border-b-2 transition-colors ${
              tab === t
                ? "border-yellow-500 text-yellow-700"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 dark:text-gray-200"
            }`}
          >
            {t === "ask" ? "💡 Ask" : "📚 Knowledge Base"}
          </button>
        ))}
      </div>

      {tab === "ask"      ? <AskTab />      : null}
      {tab === "articles" ? <ArticlesTab /> : null}
    </div>
  )
}

// ─── Ask tab ──────────────────────────────────────────────────────────────────

function AskTab() {
  const [question, setQuestion]     = useState("")
  const [turns, setTurns]           = useState<ChatTurn[]>([])
  const [loading, setLoading]       = useState(false)
  const [modelList, setModelList]   = useState<string[]>([FALLBACK_MODEL])
  const [modelId, setModelId]       = useState(FALLBACK_MODEL)
  const [savedDefault, setSavedDef] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/auction-ai/models").then(r => r.json()).then(d => {
      if (d.models?.length) {
        setModelList(d.models)
        const saved = typeof window !== "undefined" ? localStorage.getItem("it_help_default_model") : null
        setSavedDef(saved)
        // Pick saved → fallback → first in list
        if (saved && d.models.includes(saved))                   setModelId(saved)
        else if (d.models.includes(FALLBACK_MODEL))              setModelId(FALLBACK_MODEL)
        else                                                     setModelId(d.models[0])
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem("it_help_default_model")) return
    fetch("/api/ai-tool-model?slot=it_help").then(r => r.json()).then(j => { if (j?.model) setModelId(j.model) }).catch(() => {})
  }, [])

  function setAsDefault() {
    localStorage.setItem("it_help_default_model", modelId)
    setSavedDef(modelId)
  }
  function clearDefault() {
    localStorage.removeItem("it_help_default_model")
    setSavedDef(null)
  }

  async function ask() {
    const q = question.trim()
    if (!q || loading) return
    setQuestion("")
    setTurns(prev => [...prev, { role: "user", text: q }])
    setLoading(true)
    try {
      const r = await fetch("/api/it-help/ask", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ question: q, modelId }),
      })
      const d = await r.json()
      if (!r.ok) {
        setTurns(prev => [...prev, { role: "assistant", text: `Error: ${d.error ?? "Ask failed"}` }])
      } else {
        setTurns(prev => [...prev, { role: "assistant", text: d.answer, sources: d.sources ?? [] }])
      }
    } catch (e: any) {
      setTurns(prev => [...prev, { role: "assistant", text: `Network error: ${e.message ?? e}` }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 min-h-[300px] flex flex-col gap-4 mb-3">
        {turns.length === 0 && !loading && (
          <p className="text-sm text-gray-500 dark:text-gray-400 italic">
            Ask something like &quot;printer in packing room isn&apos;t working&quot; or &quot;how do I reset my password&quot;.
          </p>
        )}
        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
              t.role === "user"
                ? "bg-yellow-600 text-white"
                : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white"
            }`}>
              {t.text}
              {t.sources && t.sources.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-300 dark:border-gray-600/40">
                  <div className="text-xs font-semibold uppercase mb-1.5 opacity-70">Sources</div>
                  <ul className="space-y-1.5">
                    {t.sources.map((s, j) => (
                      <li key={s.id} className="text-xs">
                        <span className="font-medium">{j + 1}. {s.title}</span>{" "}
                        <span className="opacity-60">({s.kind === "article" ? "article" : "resolved ticket"})</span>
                        <div className="opacity-70 mt-0.5">{s.snippet}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400 italic">Searching…</div>
          </div>
        )}
      </div>

      <form
        onSubmit={e => { e.preventDefault(); ask() }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="Ask a question…"
          disabled={loading}
          className="flex-1 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2.5 text-sm focus:border-yellow-400 outline-none"
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="bg-yellow-600 hover:bg-yellow-500 disabled:bg-yellow-400 text-white text-sm font-semibold px-5 py-2.5 rounded-lg"
        >
          Ask
        </button>
      </form>

      {/* Model picker */}
      <div className="mt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span>Model:</span>
        <select
          value={modelId}
          onChange={e => setModelId(e.target.value)}
          className="border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-xs bg-white dark:bg-gray-900"
        >
          {modelList.map(m => (
            <option key={m} value={m}>{m}{savedDefault === m ? " ★" : ""}</option>
          ))}
        </select>
        {savedDefault === modelId ? (
          <button
            onClick={clearDefault}
            title="Clear default — will use the recommended model next time"
            className="text-amber-600 hover:text-amber-700"
          >
            ★ Default · clear
          </button>
        ) : (
          <button
            onClick={setAsDefault}
            title="Use this model whenever you open IT Help"
            className="text-gray-500 dark:text-gray-400 hover:text-yellow-700"
          >
            Set as default
          </button>
        )}
        <ModelPingTester
          models={modelList}
          current={modelId}
          onPick={setModelId}
        />
      </div>
    </div>
  )
}

// ─── Articles tab ─────────────────────────────────────────────────────────────

function ArticlesTab() {
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState("")
  const [editing, setEditing]   = useState<Article | "NEW" | null>(null)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch("/api/knowledge")
      const d = await r.json()
      setArticles(d.articles ?? [])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return articles
    return articles.filter(a =>
      a.title.toLowerCase().includes(q) ||
      a.body.toLowerCase().includes(q)  ||
      a.tags.some(t => t.toLowerCase().includes(q))
    )
  }, [articles, search])

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search articles…"
          className="flex-1 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm"
        />
        <button
          onClick={() => setEditing("NEW")}
          className="bg-yellow-600 hover:bg-yellow-500 text-white text-sm font-semibold px-4 py-2 rounded-lg shrink-0"
        >
          + New article
        </button>
      </div>

      {loading ? (
        <div className="text-gray-500 dark:text-gray-400 text-sm">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="text-gray-500 dark:text-gray-400 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 text-center">
          No articles yet. Click &quot;New article&quot; to write the first one.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map(a => (
            <button
              key={a.id}
              onClick={() => setEditing(a)}
              className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-gray-900 dark:text-white text-sm">{a.title}</span>
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
                  {CATEGORY_LABEL[a.category] ?? a.category}
                </span>
                {a.tags.slice(0, 4).map(t => (
                  <span key={t} className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">#{t}</span>
                ))}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{a.body.slice(0, 180)}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Updated {new Date(a.updatedAt).toLocaleDateString("en-GB")} by {a.updatedByName ?? a.createdByName}
              </p>
            </button>
          ))}
        </div>
      )}

      {editing && (
        <ArticleEditor
          article={editing === "NEW" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}

// ─── Article editor modal ─────────────────────────────────────────────────────

function ArticleEditor({
  article,
  onClose,
  onSaved,
}: {
  article: Article | null
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle]       = useState(article?.title    ?? "")
  const [body, setBody]         = useState(article?.body     ?? "")
  const [category, setCategory] = useState(article?.category ?? "GENERAL")
  const [tagsCsv, setTagsCsv]   = useState((article?.tags ?? []).join(", "))
  const [saving, setSaving]     = useState(false)

  async function save() {
    if (!title.trim() || !body.trim()) {
      alert("Title and body are required")
      return
    }
    setSaving(true)
    try {
      const tags = tagsCsv.split(",").map(t => t.trim()).filter(Boolean)
      const url    = article ? `/api/knowledge/${article.id}` : "/api/knowledge"
      const method = article ? "PATCH" : "POST"
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ title, body, category, tags }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        alert(d.error ?? "Save failed")
        return
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!article) return
    if (!confirm("Delete this article permanently?")) return
    setSaving(true)
    try {
      const r = await fetch(`/api/knowledge/${article.id}`, { method: "DELETE" })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        alert(d.error ?? "Delete failed")
        return
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">
            {article ? "Edit article" : "New article"}
          </h2>
        </div>
        <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
          <label className="block">
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Title</div>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2"
              autoFocus
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Category</div>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-md px-2 py-2"
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
            </label>
            <label className="block">
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                Tags <span className="font-normal text-gray-400 dark:text-gray-500">(comma-separated)</span>
              </div>
              <input
                type="text"
                value={tagsCsv}
                onChange={e => setTagsCsv(e.target.value)}
                placeholder="e.g. printer, packing, brother"
                className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2"
              />
            </label>
          </div>
          <label className="block">
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Body</div>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={14}
              placeholder="Write the solution / how-to here. Plain text or markdown."
              className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 font-mono resize-y"
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              The chatbot searches across title, tags and body when answering questions.
            </p>
          </label>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2">
          {article ? (
            <button onClick={remove} disabled={saving} className="text-sm text-red-600 hover:underline">
              Delete
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} disabled={saving} className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white dark:text-white px-4 py-2 rounded-lg">
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="bg-yellow-600 hover:bg-yellow-500 disabled:bg-yellow-400 text-white text-sm font-semibold px-4 py-2 rounded-lg"
            >
              {saving ? "Saving…" : "Save article"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
