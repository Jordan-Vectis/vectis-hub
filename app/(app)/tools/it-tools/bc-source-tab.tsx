"use client"

import { useCallback, useEffect, useRef, useState } from "react"

// IT Tools → BC Source — the Evo-soft AL source for our Business Central,
// browsable in the app with plain-English guides and an "ask the code" chat.
//
// The source arrives as a zip of the Source folder (admin-only upload) and
// lives in the DB — deliberately NOT in the git repo (vendor code stays out of
// GitHub). Guides + chat run on Gemini via the bc_source_* AI model slots.

type ExtSummary = { name: string; files: number; bytes: number; guide: boolean; guideEdited: boolean }
type FileMeta   = { id: string; path: string; name: string; kind: string; size: number }
type FullFile   = FileMeta & { extension: string; content: string }
type Guide      = { extension: string; content: string; model: string | null; generatedBy: string | null; edited: boolean; generatedAt: string }
type SearchHit  = { id: string; extension: string; path: string; name: string; kind: string; hits: { line: number; text: string }[]; more: number }
// `failed` marks a message that is an error notice rather than a real answer —
// those are shown but deliberately kept OUT of the history sent back up.
type ChatMsg    = { role: "user" | "model"; text: string; failed?: boolean; sources?: { id: string; path: string; extension: string }[] }

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const BTN  = "px-3 py-2 text-sm font-medium rounded-lg border transition-colors"
const CARD = "bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 rounded-xl"

export default function BcSourceTab() {
  const [view, setView] = useState<"browse" | "search" | "ask">("browse")

  // Library state
  const [exts, setExts]           = useState<ExtSummary[]>([])
  const [uploadedAt, setUploadedAt] = useState<string | null>(null)
  const [canUpload, setCanUpload] = useState(false)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)

  // Browse state
  const [extFilter, setExtFilter] = useState("")
  const [selExt, setSelExt]       = useState<string | null>(null)
  const [files, setFiles]         = useState<FileMeta[]>([])
  const [file, setFile]           = useState<FullFile | null>(null)
  const [guide, setGuide]         = useState<Guide | null>(null)
  const [guideBusy, setGuideBusy] = useState(false)
  const [editingGuide, setEditingGuide] = useState(false)
  const [guideDraft, setGuideDraft]     = useState("")
  const [extView, setExtView]     = useState<"guide" | "files">("guide")

  // Upload state
  const [uploading, setUploading] = useState(false)
  const zipInputRef = useRef<HTMLInputElement>(null)

  const loadLibrary = useCallback(() => {
    setLoading(true)
    fetch("/api/it-tools/bc-source/files")
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return }
        setExts(d.extensions ?? [])
        setUploadedAt(d.uploadedAt ?? null)
        setCanUpload(!!d.canUpload)
      })
      .catch(e => setError(e?.message ?? "Couldn't load"))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadLibrary() }, [loadLibrary])

  function openExtension(name: string) {
    setSelExt(name)
    setFile(null)
    setFiles([])
    setGuide(null)
    setEditingGuide(false)
    setView("browse")
    fetch(`/api/it-tools/bc-source/files?extension=${encodeURIComponent(name)}`)
      .then(r => r.json()).then(d => setFiles(d.files ?? [])).catch(() => {})
    fetch(`/api/it-tools/bc-source/guide?extension=${encodeURIComponent(name)}`)
      .then(r => r.json()).then(d => {
        setGuide(d.guide ?? null)
        setExtView(d.guide ? "guide" : "files")
      }).catch(() => setExtView("files"))
  }

  function openFileById(id: string, extension?: string) {
    setView("browse")
    if (extension && extension !== selExt) openExtension(extension)
    fetch(`/api/it-tools/bc-source/files?fileId=${encodeURIComponent(id)}`)
      .then(r => r.json()).then(d => { if (d.file) { setFile(d.file); setExtView("files") } })
      .catch(() => {})
  }

  function handleZip(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ""
    if (!f) return
    setError(null)
    setUploading(true)
    const fd = new FormData()
    fd.append("zip", f)
    fetch("/api/it-tools/bc-source/upload", { method: "POST", body: fd })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return }
        setSelExt(null); setFile(null)
        loadLibrary()
      })
      .catch(err => setError(err?.message ?? "Upload failed"))
      .finally(() => setUploading(false))
  }

  function generateGuide() {
    if (!selExt) return
    if (guide && !confirm(guide.edited
      ? "This guide has been hand-edited — regenerating will overwrite those edits. Continue?"
      : "Regenerate this guide from the source? The current one will be replaced.")) return
    setGuideBusy(true)
    setError(null)
    fetch("/api/it-tools/bc-source/guide", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extension: selExt }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return }
        setGuide(d.guide)
        setExtView("guide")
        setExts(prev => prev.map(x => x.name === selExt ? { ...x, guide: true, guideEdited: false } : x))
      })
      .catch(e => setError(e?.message ?? "Couldn't generate"))
      .finally(() => setGuideBusy(false))
  }

  function saveGuideEdit() {
    if (!selExt) return
    fetch("/api/it-tools/bc-source/guide", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extension: selExt, content: guideDraft }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return }
        setGuide(d.guide)
        setEditingGuide(false)
        setExts(prev => prev.map(x => x.name === selExt ? { ...x, guideEdited: true } : x))
      })
      .catch(e => setError(e?.message ?? "Couldn't save"))
  }

  const shownExts = exts.filter(x => x.name.toLowerCase().includes(extFilter.toLowerCase()))
  const hasSource = exts.length > 0

  return (
    <div className="space-y-4">

      {/* Header: status + sub-views + upload */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1">
          {([["browse", "📁 Browse"], ["search", "🔎 Search the code"], ["ask", "💬 Ask the code"]] as const).map(([v, label]) => (
            <button key={v} onClick={() => setView(v)}
              className={`${BTN} ${view === v
                ? "border-cyan-500 text-cyan-600 dark:text-cyan-400 bg-cyan-500/10"
                : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-400"}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3">
          {hasSource && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {exts.length} extensions · {exts.reduce((s, x) => s + x.files, 0).toLocaleString()} files
              {uploadedAt && ` · uploaded ${new Date(uploadedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
            </span>
          )}
          {canUpload && (
            <>
              <input ref={zipInputRef} type="file" accept=".zip" onChange={handleZip} className="hidden" />
              <button onClick={() => zipInputRef.current?.click()} disabled={uploading}
                className={`${BTN} border-cyan-600/60 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/10 disabled:opacity-50`}>
                {uploading ? "Uploading…" : hasSource ? "⬆ Replace source (zip)" : "⬆ Upload source (zip)"}
              </button>
            </>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500 py-8 text-center">Loading…</p>
      ) : !hasSource ? (
        <div className={`${CARD} p-10 text-center`}>
          <p className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-1">No BC source uploaded yet</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-lg mx-auto">
            Zip the <span className="font-mono">Source</span> folder (right-click → Compress to zip) and upload it here.
            {!canUpload && " An admin needs to do the upload."}
          </p>
        </div>
      ) : view === "search" ? (
        <SearchView onOpenFile={openFileById} />
      ) : view === "ask" ? (
        <AskView onOpenFile={openFileById} />
      ) : (
        /* ── Browse ── */
        <div className="flex gap-4 items-start">

          {/* Extension list */}
          <div className={`${CARD} w-72 shrink-0 overflow-hidden`}>
            <div className="p-2 border-b border-gray-200 dark:border-gray-700">
              <input value={extFilter} onChange={e => setExtFilter(e.target.value)} placeholder="Filter extensions…"
                className="w-full bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:border-cyan-500" />
            </div>
            <div className="max-h-[65vh] overflow-y-auto">
              {shownExts.map(x => (
                <button key={x.name} onClick={() => openExtension(x.name)}
                  className={`w-full text-left px-3 py-2 border-b border-gray-100 dark:border-gray-800 last:border-0 transition-colors ${
                    selExt === x.name ? "bg-cyan-500/10" : "hover:bg-gray-50 dark:hover:bg-[#2C2C2E]"}`}>
                  <span className={`block text-sm truncate ${selExt === x.name ? "text-cyan-600 dark:text-cyan-400 font-semibold" : "text-gray-700 dark:text-gray-300"}`}>
                    {x.name}
                  </span>
                  <span className="block text-[11px] text-gray-500">
                    {x.files} files · {fmtBytes(x.bytes)}{x.guide && <span> · 📖 guide{x.guideEdited ? " (edited)" : ""}</span>}
                  </span>
                </button>
              ))}
              {shownExts.length === 0 && <p className="text-xs text-gray-500 p-3">No extension matches.</p>}
            </div>
          </div>

          {/* Extension detail */}
          <div className="flex-1 min-w-0 space-y-3">
            {!selExt ? (
              <div className={`${CARD} p-10 text-center text-sm text-gray-500 dark:text-gray-400`}>
                Pick an extension on the left — each folder of the BC source is one extension.
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-bold text-gray-900 dark:text-white">{selExt}</h3>
                  <div className="flex gap-1 ml-auto">
                    <button onClick={() => setExtView("guide")}
                      className={`${BTN} !py-1.5 ${extView === "guide" ? "border-cyan-500 text-cyan-600 dark:text-cyan-400 bg-cyan-500/10" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400"}`}>
                      📖 Guide
                    </button>
                    <button onClick={() => setExtView("files")}
                      className={`${BTN} !py-1.5 ${extView === "files" ? "border-cyan-500 text-cyan-600 dark:text-cyan-400 bg-cyan-500/10" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400"}`}>
                      📄 Files ({files.length})
                    </button>
                  </div>
                </div>

                {extView === "guide" ? (
                  <div className={`${CARD} p-4 space-y-3`}>
                    {guide && !editingGuide && (
                      <>
                        <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500">
                          <span>
                            {guide.edited ? "Hand-edited" : `Generated ${new Date(guide.generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
                            {guide.generatedBy && ` by ${guide.generatedBy}`}
                          </span>
                          <span className="ml-auto flex gap-2">
                            <button onClick={() => { setGuideDraft(guide.content); setEditingGuide(true) }}
                              className="text-cyan-600 dark:text-cyan-400 hover:underline">✎ Edit</button>
                            <button onClick={generateGuide} disabled={guideBusy}
                              className="text-cyan-600 dark:text-cyan-400 hover:underline disabled:opacity-50">
                              {guideBusy ? "Regenerating…" : "✨ Regenerate"}
                            </button>
                          </span>
                        </div>
                        <div className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">{guide.content}</div>
                      </>
                    )}
                    {guide && editingGuide && (
                      <>
                        <textarea value={guideDraft} onChange={e => setGuideDraft(e.target.value)} rows={24}
                          className="w-full bg-gray-50 dark:bg-[#141416] border border-gray-300 dark:border-gray-700 rounded-lg p-3 text-sm text-gray-800 dark:text-gray-200 font-mono focus:outline-none focus:border-cyan-500" />
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => setEditingGuide(false)} className={`${BTN} border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400`}>Cancel</button>
                          <button onClick={saveGuideEdit} className={`${BTN} border-cyan-600 bg-cyan-600 !text-white`}>Save guide</button>
                        </div>
                      </>
                    )}
                    {!guide && (
                      <div className="text-center py-6">
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                          No guide yet for this extension. Generate a plain-English walkthrough of what it does, its screens, data and workflows — written from the actual source.
                        </p>
                        <button onClick={generateGuide} disabled={guideBusy}
                          className={`${BTN} border-cyan-600 bg-cyan-600 !text-white disabled:opacity-50`}>
                          {guideBusy ? "Reading the source… (can take a minute)" : "✨ Generate guide"}
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <FilesView files={files} file={file} onOpen={id => openFileById(id)} onClose={() => setFile(null)} />
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Files list + viewer ──────────────────────────────────────────────────────

function FilesView({ files, file, onOpen, onClose }: {
  files: FileMeta[]
  file: FullFile | null
  onOpen: (id: string) => void
  onClose: () => void
}) {
  // Group by kind (Table / Page / Codeunit / …) — mirrors how the src folders
  // are laid out, and how you actually think about an extension.
  const groups = new Map<string, FileMeta[]>()
  for (const f of files) {
    if (!groups.has(f.kind)) groups.set(f.kind, [])
    groups.get(f.kind)!.push(f)
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))

  return (
    <div className="flex gap-4 items-start">
      <div className={`${CARD} w-80 shrink-0 max-h-[65vh] overflow-y-auto`}>
        {ordered.map(([kind, list]) => (
          <div key={kind}>
            <p className="px-3 pt-2 pb-1 text-[11px] font-semibold text-gray-500 uppercase tracking-wider sticky top-0 bg-white dark:bg-[#1C1C1E]">{kind} ({list.length})</p>
            {list.map(f => (
              <button key={f.id} onClick={() => onOpen(f.id)}
                className={`w-full text-left px-3 py-1.5 text-xs font-mono truncate transition-colors ${
                  file?.id === f.id ? "text-cyan-600 dark:text-cyan-400 bg-cyan-500/10" : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-[#2C2C2E]"}`}>
                {f.name}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="flex-1 min-w-0">
        {file ? (
          <div className={`${CARD} overflow-hidden`}>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#141416]">
              <span className="font-mono text-xs text-gray-700 dark:text-gray-300 truncate">{file.path}</span>
              <span className="text-[11px] text-gray-500 shrink-0">{fmtBytes(file.size)}</span>
              <button onClick={onClose} className="ml-auto text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">✕ Close</button>
            </div>
            {/* Wide code scrolls inside its own box, never the page */}
            <pre className="text-xs leading-relaxed text-gray-800 dark:text-gray-200 p-4 overflow-x-auto max-h-[62vh] overflow-y-auto whitespace-pre">{file.content}</pre>
          </div>
        ) : (
          <div className={`${CARD} p-10 text-center text-sm text-gray-500 dark:text-gray-400`}>Pick a file to read it.</div>
        )}
      </div>
    </div>
  )
}

// ─── Search across all files ──────────────────────────────────────────────────

function SearchView({ onOpenFile }: { onOpenFile: (id: string, extension?: string) => void }) {
  const [q, setQ] = useState("")
  const [results, setResults] = useState<SearchHit[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function run() {
    const query = q.trim()
    if (query.length < 2) return
    setBusy(true)
    setErr(null)
    fetch(`/api/it-tools/bc-source/search?q=${encodeURIComponent(query)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setErr(d.error); return }
        setResults(d.results ?? [])
        setTruncated(!!d.truncated)
      })
      .catch(e => setErr(e?.message ?? "Search failed"))
      .finally(() => setBusy(false))
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") run() }}
          placeholder="Search the whole source — a field name, page caption, 'Transfer/Copy', EVA_SalesAllocation…"
          className="flex-1 bg-white dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-cyan-500" />
        <button onClick={run} disabled={busy || q.trim().length < 2}
          className={`${BTN} border-cyan-600 bg-cyan-600 !text-white disabled:opacity-50`}>
          {busy ? "Searching…" : "Search"}
        </button>
      </div>
      {err && <p className="text-sm text-red-500">{err}</p>}
      {results !== null && (
        <p className="text-xs text-gray-500">
          {results.length === 0 ? "Nothing matches." : `${results.length} file${results.length === 1 ? "" : "s"} match${results.length === 1 ? "es" : ""}${truncated ? " (more exist — narrow the search)" : ""}.`}
        </p>
      )}
      <div className="space-y-2">
        {(results ?? []).map(r => (
          <button key={r.id} onClick={() => onOpenFile(r.id, r.extension)}
            className={`${CARD} w-full text-left p-3 hover:border-cyan-500/60 transition-colors`}>
            <p className="text-xs font-mono text-cyan-600 dark:text-cyan-400 truncate">{r.path}</p>
            <div className="mt-1 space-y-0.5">
              {r.hits.map(h => (
                <p key={h.line} className="text-xs font-mono text-gray-600 dark:text-gray-400 truncate">
                  <span className="text-gray-400 dark:text-gray-600 select-none">{h.line}: </span>{h.text}
                </p>
              ))}
              {r.more > 0 && <p className="text-[11px] text-gray-500">…and {r.more} more line{r.more === 1 ? "" : "s"}</p>}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Ask the code ─────────────────────────────────────────────────────────────

function AskView({ onOpenFile }: { onOpenFile: (id: string, extension?: string) => void }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }) }, [msgs])

  function send() {
    const q = input.trim()
    if (!q || busy) return
    setInput("")
    // ⚠ Only real, non-empty turns go back as history. An error notice or a
    // blank reply sent back up gets the whole request rejected by Gemini
    // ("parts[0].data: required oneof field 'data' must have one initialized
    // field"), which permanently breaks every later question in the thread.
    const history = msgs
      .filter(m => !m.failed && m.text.trim().length > 0)
      .map(m => ({ role: m.role, text: m.text }))
    // Files the last answer was built from. A follow-up ("and how do I…") is
    // nearly always about the same objects, but its wording on its own rarely
    // retrieves them — so hand them back to be included again.
    const pinnedIds = [...msgs].reverse().find(m => m.role === "model" && m.sources?.length)?.sources?.map(s => s.id) ?? []
    setMsgs(prev => [...prev, { role: "user", text: q }])
    setBusy(true)
    fetch("/api/it-tools/bc-source/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q, history, pinnedIds }),
    })
      .then(r => r.json())
      .then(d => {
        const answer = typeof d.answer === "string" ? d.answer.trim() : ""
        setMsgs(prev => [...prev, d.error || !answer
          ? { role: "model", text: `⚠ ${d.error ?? "No answer came back — try asking again."}`, failed: true }
          : { role: "model", text: answer, sources: d.sources }])
      })
      .catch(e => setMsgs(prev => [...prev, { role: "model", text: `⚠ ${e?.message ?? "Failed"}`, failed: true }]))
      .finally(() => setBusy(false))
  }

  return (
    <div className={`${CARD} flex flex-col h-[70vh]`}>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {msgs.length === 0 && (
          <div className="text-center text-sm text-gray-500 dark:text-gray-400 pt-10 space-y-2">
            <p className="font-semibold">Ask how anything in BC works — answered from the actual source code.</p>
            <p className="text-xs">e.g. &ldquo;What does Recreate Auction Line do on the transfer dialog?&rdquo; · &ldquo;How does the tote scanner decide which receipt to use?&rdquo; · &ldquo;What happens when a lot is marked as collected?&rdquo;</p>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
              m.role === "user"
                ? "bg-cyan-600 text-white"
                : "bg-gray-100 dark:bg-[#2C2C2E] text-gray-800 dark:text-gray-200"}`}>
              {m.text}
              {m.sources && m.sources.length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-300/40 dark:border-gray-600/40 flex flex-wrap gap-1">
                  {m.sources.slice(0, 8).map(s => (
                    <button key={s.id} onClick={() => onOpenFile(s.id, s.extension)}
                      title={s.path}
                      className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/10 hover:bg-black/20 dark:hover:bg-white/20 transition-colors truncate max-w-[240px]">
                      {s.path.split("/").pop()}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <p className="text-xs text-gray-500 animate-pulse">Reading the source…</p>}
        <div ref={endRef} />
      </div>
      <div className="border-t border-gray-200 dark:border-gray-700 p-3 flex gap-2">
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") send() }}
          placeholder="How does… ?"
          className="flex-1 bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-cyan-500" />
        <button onClick={send} disabled={busy || !input.trim()}
          className={`${BTN} border-cyan-600 bg-cyan-600 !text-white disabled:opacity-50`}>
          Ask
        </button>
      </div>
    </div>
  )
}
