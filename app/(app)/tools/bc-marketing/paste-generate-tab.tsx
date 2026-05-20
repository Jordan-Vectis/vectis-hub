"use client"

import { useState, useEffect } from "react"
import { CONTENT_TYPES, CONTENT_GROUPS, htmlToPlain } from "./types"

export default function PasteGenerateTab() {
  const [pasted,      setPasted]      = useState("")
  const [contextNote, setContextNote] = useState("")
  const [contentType, setContentType] = useState("sale_highlight")
  const [length,      setLength]      = useState<"short" | "medium" | "long" | "max">("medium")

  const [modelList, setModelList] = useState<string[]>(["gemini-2.5-flash-preview-04-17"])
  const [modelId,   setModelId]   = useState("gemini-2.5-flash-preview-04-17")
  const [savedDefault, setSavedDefault] = useState<string | null>(null)

  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [article, setArticle] = useState<string | null>(null)
  const [copied,  setCopied]  = useState<"plain" | "html" | null>(null)

  const [saveTitle, setSaveTitle] = useState("")
  const [savingMsg, setSavingMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/auction-ai/models").then(r => r.json()).then(d => {
      if (d.models?.length) {
        setModelList(d.models)
        const saved = typeof window !== "undefined" ? localStorage.getItem("bc_marketing_default_model") : null
        setSavedDefault(saved)
        setModelId(saved && d.models.includes(saved) ? saved : d.models[0])
      }
    }).catch(() => {})
  }, [])

  function setAsDefault() {
    localStorage.setItem("bc_marketing_default_model", modelId)
    setSavedDefault(modelId)
  }
  function clearDefault() {
    localStorage.removeItem("bc_marketing_default_model")
    setSavedDefault(null)
  }

  async function generate() {
    if (!pasted.trim()) return
    setLoading(true)
    setError(null)
    setArticle(null)
    try {
      const res = await fetch("/api/marketing/article-from-text", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ pastedContent: pasted, contentType, length, modelId, contextNote }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Failed to generate"); return }
      setArticle(data.article)
      const typeLabel = CONTENT_TYPES.find(t => t.value === contentType)?.label ?? "Untitled"
      setSaveTitle(`${typeLabel} (manual) — ${new Date().toLocaleDateString("en-GB")}`)
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }

  async function copyAs(mode: "plain" | "html") {
    if (!article) return
    const text = mode === "plain" ? htmlToPlain(article) : article
    await navigator.clipboard.writeText(text)
    setCopied(mode)
    setTimeout(() => setCopied(null), 2000)
  }

  async function saveDraft() {
    if (!article || !saveTitle.trim()) return
    setSavingMsg(null)
    try {
      const res = await fetch("/api/marketing/drafts", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          title:        saveTitle.trim(),
          contentType,
          content:      article,
          notes:        contextNote ? `Source: pasted text. Context: ${contextNote}` : "Source: pasted text.",
        }),
      })
      const data = await res.json()
      setSavingMsg(res.ok ? "✓ Saved to drafts" : (data.error ?? "Failed to save"))
      if (res.ok) setTimeout(() => setSavingMsg(null), 3000)
    } catch {
      setSavingMsg("Network error")
    }
  }

  const selectedType = CONTENT_TYPES.find(t => t.value === contentType)

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">

      {/* ── Intro ───────────────────────────────────────────────────────── */}
      <div className="bg-blue-950/30 border border-blue-900 rounded-xl p-4">
        <p className="text-sm text-blue-200">
          <strong>Paste &amp; Generate</strong> — copy lot listings or results straight from
          vectis.co.uk (or anywhere) and we'll write an article from the text. Useful when
          lots aren't in BC yet, when you're writing about archived results, or for one-off
          content. Same brand voice as the main generator.
        </p>
      </div>

      {/* ── Content type ────────────────────────────────────────────────── */}
      <div className="bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl p-5 space-y-4">
        <h2 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">What do you want to generate?</h2>
        <div className="space-y-3">
          {CONTENT_GROUPS.map(group => (
            <div key={group}>
              <p className="text-[10px] font-bold text-gray-600 dark:text-gray-500 uppercase tracking-wider mb-1.5">{group}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {CONTENT_TYPES.filter(t => t.group === group).map(t => (
                  <button
                    key={t.value}
                    onClick={() => setContentType(t.value)}
                    className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
                      contentType === t.value
                        ? "border-pink-500 bg-pink-900/30 text-pink-200"
                        : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:border-gray-500"
                    }`}
                  >
                    <div className="font-semibold">{t.label}</div>
                    <div className="text-[10px] text-gray-600 dark:text-gray-500 mt-0.5">{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Paste area ──────────────────────────────────────────────────── */}
      <div className="bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl p-5 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-2">Paste lot details</label>
          <textarea
            value={pasted}
            onChange={e => setPasted(e.target.value)}
            placeholder="Paste lot descriptions, prices, sale names — anything from the website. Plain text or HTML both work. The AI extracts what it needs."
            rows={14}
            className="w-full bg-white dark:bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-200 font-mono focus:outline-none focus:border-pink-500 resize-y"
          />
          <p className="text-[11px] text-gray-600 dark:text-gray-500 mt-1">{pasted.length.toLocaleString()} characters · max 200,000</p>
        </div>

        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Optional context for the AI</label>
          <input
            type="text"
            value={contextNote}
            onChange={e => setContextNote(e.target.value)}
            placeholder="e.g. 'These are highlights from our March 2026 Star Wars sale' or 'Vintage diecast spring auction preview'"
            className="w-full bg-white dark:bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:border-pink-500"
          />
        </div>

        <div className="flex items-center gap-3 flex-wrap pt-2">
          {/* Length selector */}
          <div className="flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-600 rounded-lg p-0.5">
            {(["short", "medium", "long", "max"] as const).map(l => (
              <button key={l} onClick={() => setLength(l)}
                className={`px-3 py-1.5 text-xs rounded transition-colors capitalize ${
                  length === l ? "bg-pink-600 text-gray-900 dark:text-white" : "text-gray-600 dark:text-gray-400 hover:text-white"
                }`}>{l}</button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <select value={modelId} onChange={e => setModelId(e.target.value)}
              className="bg-white dark:bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-pink-500">
              {modelList.map(m => <option key={m} value={m}>{m}{savedDefault === m ? " ★" : ""}</option>)}
            </select>
            {savedDefault === modelId ? (
              <button onClick={clearDefault} className="text-xs text-amber-400 hover:text-amber-300 px-2 py-1 rounded">★ Default · clear</button>
            ) : (
              <button onClick={setAsDefault} className="text-xs text-gray-600 dark:text-gray-400 hover:text-pink-400 px-2 py-1 rounded">Set as default</button>
            )}
          </div>

          <button onClick={generate} disabled={loading || !pasted.trim()}
            className="bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-gray-900 dark:text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors">
            {loading ? "Generating…" : `Generate ${selectedType?.label ?? ""}`}
          </button>
        </div>

        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded-xl px-4 py-3 text-red-700 dark:text-red-300 text-sm">{error}</div>
        )}
      </div>

      {/* ── Output ──────────────────────────────────────────────────────── */}
      {article && (
        <div className="bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-300 dark:border-gray-700 flex items-center justify-between gap-3 flex-wrap">
            <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">{selectedType?.label}</span>
            <div className="flex gap-2">
              <button onClick={() => copyAs("plain")} className="text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-3 py-1.5 rounded-lg">{copied === "plain" ? "✓ Copied!" : "Copy as Plain Text"}</button>
              <button onClick={() => copyAs("html")} className="text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-3 py-1.5 rounded-lg">{copied === "html" ? "✓ Copied!" : "Copy as HTML"}</button>
              <button onClick={generate} disabled={loading} className="text-xs bg-pink-700 hover:bg-pink-600 disabled:opacity-50 text-gray-900 dark:text-white px-3 py-1.5 rounded-lg">Regenerate</button>
            </div>
          </div>

          <div className="px-5 py-3 border-b border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800/40 flex items-center gap-3 flex-wrap">
            <input type="text" value={saveTitle} onChange={e => setSaveTitle(e.target.value)}
              placeholder="Title for saved draft"
              className="flex-1 min-w-[200px] bg-white dark:bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:border-pink-500" />
            <button onClick={saveDraft} disabled={!saveTitle.trim()}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-gray-900 dark:text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
              💾 Save to Drafts
            </button>
            {savingMsg && <span className="text-xs text-emerald-400">{savingMsg}</span>}
          </div>

          <div
            className="p-6 prose prose-invert prose-sm max-w-none text-gray-700 dark:text-gray-200 leading-relaxed
              [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-white [&_h1]:mb-3
              [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-white [&_h2]:mt-5 [&_h2]:mb-2
              [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-gray-200 [&_h3]:mt-4 [&_h3]:mb-1
              [&_p]:mb-4 [&_ul]:mb-4 [&_ol]:mb-4 [&_li]:mb-1 [&_strong]:text-white"
            dangerouslySetInnerHTML={{ __html: article }}
          />
        </div>
      )}
    </div>
  )
}
