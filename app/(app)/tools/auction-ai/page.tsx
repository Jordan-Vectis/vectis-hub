"use client"

import { useState, useRef, useCallback, useEffect, useTransition } from "react"
import * as XLSX from "xlsx"
import { PRESETS } from "@/lib/auction-ai-presets"
import { DOUBLE_CHECK_INSTRUCTION } from "@/lib/double-check-instruction"
import { KEY_POINTS_INSTRUCTION } from "@/lib/key-points-instruction"
import { applyAiDescriptionOne } from "@/lib/actions/catalogue"
import { showError } from "@/lib/error-modal"
import { MacroTab } from "./macro-tab"

// ─── Show Instruction Toggle ──────────────────────────────────────────────────

function ShowInstructionToggle({ instruction, label = "instructions sent to Gemini" }: { instruction: string; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2">
      <button onClick={() => setOpen(o => !o)}
        className="text-xs text-gray-600 dark:text-gray-500 hover:text-gray-900 dark:hover:text-gray-300 transition-colors">
        {open ? `▲ Hide ${label}` : `▼ Show ${label}`}
      </button>
      {open && (
        <pre className="mt-2 text-xs text-gray-600 dark:text-gray-400 bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-lg p-3 whitespace-pre-wrap leading-relaxed font-mono">
          {instruction}
        </pre>
      )}
    </div>
  )
}

// ─── Toast system ─────────────────────────────────────────────────────────────

type ToastType = "error" | "warn" | "ok"
type ToastEvent = { message: string; type: ToastType }

function showToast(message: string, type: ToastType = "error") {
  window.dispatchEvent(new CustomEvent("vectis-toast", { detail: { message, type } }))
}

function ToastContainer() {
  const [toasts, setToasts] = useState<(ToastEvent & { id: number })[]>([])
  const next = useRef(0)

  useEffect(() => {
    function handler(e: Event) {
      const { message, type } = (e as CustomEvent<ToastEvent>).detail
      const id = next.current++
      setToasts(t => [...t, { message, type, id }])
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 6000)
    }
    window.addEventListener("vectis-toast", handler)
    return () => window.removeEventListener("vectis-toast", handler)
  }, [])

  if (!toasts.length) return null
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map(t => (
        <div key={t.id}
          className={`flex items-start gap-2 px-4 py-3 rounded-lg shadow-xl text-sm border animate-in slide-in-from-right-4 fade-in duration-200
            ${t.type === "error" ? "bg-red-950 border-red-700 text-red-200"
            : t.type === "warn"  ? "bg-yellow-950 border-yellow-700 text-yellow-200"
            :                      "bg-green-950 border-green-700 text-green-200"}`}>
          <span className="flex-shrink-0 mt-0.5">{t.type === "error" ? "✕" : t.type === "warn" ? "⚠" : "✓"}</span>
          <span className="flex-1 break-words">{t.message}</span>
          <button onClick={() => setToasts(ts => ts.filter(x => x.id !== t.id))}
            className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity ml-1">✕</button>
        </div>
      ))}
    </div>
  )
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "chat" | "batch" | "barcode" | "copier" | "runs" | "kpruns" | "instructions" | "kpcheck" | "macro" | "doublecheck" | "pipeline" | "upgrade"

type ChatMessage = {
  role: "user" | "model"
  text: string
  images?: string[]
}

type BatchResult = {
  lot: string
  description: string
  estimate: string
  status: string
  error?: string
}

function parseEstimate(est: string): { low: number; high: number } {
  const m = est.match(/£([\d,]+)\s*[–\-]\s*£?([\d,]+)/)
  if (!m) return { low: 0, high: 0 }
  return { low: parseInt(m[1].replace(/,/g, "")), high: parseInt(m[2].replace(/,/g, "")) }
}

function toDataURL(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result as string)
    r.onerror = rej
    r.readAsDataURL(file)
  })
}

// ─── Preset selector ─────────────────────────────────────────────────────────

function PresetSelector({ value, onChange, overrides, onEdit }: {
  value: string
  onChange: (v: string) => void
  overrides: Record<string, string>
  onEdit: () => void
}) {
  const builtInKeys = Object.keys(PRESETS)
  const customKeys  = Object.keys(overrides).filter(k => !PRESETS[k])
  const isEdited    = value !== "Custom (paste my own)" && builtInKeys.includes(value) && overrides[value] !== undefined && overrides[value] !== PRESETS[value]
  const isCustom    = customKeys.includes(value)

  return (
    <div className="mb-3">
      <label className="block text-xs text-gray-600 dark:text-gray-500 mb-1 uppercase tracking-wider">System Instruction Preset</label>
      <div className="flex gap-2">
        <select value={value} onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[#C8A96E]">
          <optgroup label="Built-in">
            {builtInKeys.map((k) => <option key={k}>{k}</option>)}
          </optgroup>
          {customKeys.length > 0 && (
            <optgroup label="My Instructions">
              {customKeys.map((k) => <option key={k}>{k}</option>)}
            </optgroup>
          )}
        </select>
        {value !== "Custom (paste my own)" && !isCustom && (
          <button onClick={onEdit}
            className={`px-3 py-1.5 text-xs rounded border transition-colors flex-shrink-0 ${isEdited ? "border-[#C8A96E] text-[#C8A96E] bg-gray-100 dark:bg-[#2C2C2E] hover:bg-[#3a3a2e]" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-[#2C2C2E] hover:border-gray-500"}`}>
            {isEdited ? "✎ Edited" : "✎ Edit"}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Preset editor modal ──────────────────────────────────────────────────────

function PresetEditorModal({ presetKey, initialText, onSave, onClose }: {
  presetKey: string
  initialText: string
  onSave: (text: string) => void
  onClose: () => void
}) {
  const isBuiltIn = PRESETS[presetKey] !== undefined
  const [draft, setDraft] = useState(initialText)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    await onSave(draft)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl p-5 w-full max-w-2xl max-h-[85vh] flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">{presetKey}</h3>
          <button onClick={onClose} className="text-gray-600 dark:text-gray-500 hover:text-gray-300 text-lg leading-none ml-4">✕</button>
        </div>
        {isBuiltIn && (
          <p className="text-xs text-amber-500/80 bg-amber-500/10 border border-amber-500/20 rounded px-3 py-2">
            This is a built-in preset. Changes apply to this session only — they reset on page reload. To make permanent changes, ask your developer.
          </p>
        )}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={18}
          className="w-full bg-gray-50 dark:bg-[#141416] border border-gray-300 dark:border-gray-700 rounded px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[#C8A96E] resize-none font-mono flex-1"
        />
        <div className="flex gap-2 justify-between">
          <button onClick={() => setDraft(PRESETS[presetKey] ?? "")}
            className="text-xs px-3 py-1.5 bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 rounded hover:border-gray-500 hover:text-gray-300 transition-colors">
            Reset to default
          </button>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="text-sm px-4 py-1.5 bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 rounded hover:border-gray-500 transition-colors">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="text-sm px-5 py-1.5 bg-[#C8A96E] hover:bg-[#d4b87a] text-black font-bold rounded transition-colors disabled:opacity-40">
              {saving ? "Saving…" : isBuiltIn ? "Apply to session" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Chat message renderer (markdown links + bold) ───────────────────────────

function renderInline(text: string): React.ReactNode[] {
  const regex = /(\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g
  const result: React.ReactNode[] = []
  let lastIndex = 0
  for (const match of text.matchAll(regex)) {
    if (match.index! > lastIndex) result.push(text.slice(lastIndex, match.index))
    if (match[0].startsWith("**")) {
      result.push(<strong key={match.index}>{match[2]}</strong>)
    } else {
      result.push(
        <a key={match.index} href={match[4]} target="_blank" rel="noopener noreferrer"
          className="text-blue-400 underline hover:text-blue-300 break-all">
          {match[3]}
        </a>
      )
    }
    lastIndex = match.index! + match[0].length
  }
  if (lastIndex < text.length) result.push(text.slice(lastIndex))
  return result
}

function renderMessageText(text: string) {
  return text.split("\n").flatMap((line, i, arr) => {
    const parts = renderInline(line)
    return i < arr.length - 1 ? [...parts, <br key={`br-${i}`} />] : parts
  })
}

// ─── Image drop zone ─────────────────────────────────────────────────────────

function ImageZone({ images, onAdd, onRemove, max = 6 }: {
  images: File[]; onAdd: (f: File[]) => void; onRemove: (i: number) => void; max?: number
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [previews, setPreviews] = useState<string[]>([])

  // Keep previews in sync with images prop — handles paste, drop, and click
  useEffect(() => {
    let cancelled = false
    if (images.length === 0) { setPreviews([]); return }
    Promise.all(images.map(toDataURL)).then(urls => {
      if (!cancelled) setPreviews(urls)
    })
    return () => { cancelled = true }
  }, [images])

  const add = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => f.type.startsWith("image/")).slice(0, max - images.length)
    if (!arr.length) return
    onAdd(arr)
  }, [images.length, max, onAdd])

  return (
    <div className="mb-3">
      <div onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files) }}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => ref.current?.click()}
        className="border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-[#C8A96E] rounded-lg p-4 text-center cursor-pointer transition-colors">
        <p className="text-gray-600 dark:text-gray-500 text-sm">Drop images here or click to select ({images.length}/{max})</p>
        <input ref={ref} type="file" multiple accept="image/*" className="hidden"
          onChange={(e) => e.target.files && add(e.target.files)} />
      </div>
      {previews.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {previews.map((src, i) => (
            <div key={i} className="relative group">
              <img src={src} className="w-16 h-16 object-cover rounded border border-gray-300 dark:border-gray-700" />
              <button onClick={() => { setPreviews(p => p.filter((_, j) => j !== i)); onRemove(i) }}
                className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full w-4 h-4 text-xs items-center justify-center hidden group-hover:flex">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Searchable autocomplete ──────────────────────────────────────────────────

function Autocomplete({ value, onChange, options, placeholder, accentColor = "#C8A96E" }: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder?: string
  accentColor?: string
}) {
  const [open, setOpen]       = useState(false)
  const [query, setQuery]     = useState(value)
  const containerRef          = useRef<HTMLDivElement>(null)

  const filtered = query.length < 1
    ? options.slice(0, 40)
    : options.filter(o => o.toLowerCase().includes(query.toLowerCase())).slice(0, 40)

  function select(opt: string) {
    onChange(opt)
    setQuery(opt)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex">
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); onChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          className="flex-1 bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-l px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none"
          style={{ borderColor: query ? accentColor + "66" : "" }}
        />
        <button type="button" onMouseDown={e => { e.preventDefault(); setOpen(o => !o) }}
          className="px-2 bg-gray-100 dark:bg-[#2C2C2E] border border-l-0 border-gray-300 dark:border-gray-700 rounded-r text-gray-600 dark:text-gray-500 text-xs">▼</button>
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-50 w-full bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded mt-0.5 max-h-48 overflow-y-auto shadow-xl">
          {filtered.map(opt => (
            <button key={opt} type="button" onMouseDown={() => select(opt)}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-[#3A3A3C] transition-colors">
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Chat Tab ─────────────────────────────────────────────────────────────────

function ChatTab({ model }: { model: string }) {
  const [preset, setPreset]      = useState(Object.keys(PRESETS)[1])
  const [custom, setCustom]      = useState("")
  const [images, setImages]      = useState<File[]>([])
  const [message, setMessage]    = useState("")
  const [history, setHistory]    = useState<ChatMessage[]>([])
  const [apiHistory, setApiHist] = useState<{ role: "user"|"model"; parts: { text: string }[] }[]>([])
  const [loading, setLoading]    = useState(false)
  const [error, setError]        = useState<string | null>(null)
  const [copied, setCopied]      = useState(false)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [editOpen, setEditOpen]   = useState(false)
  const [grounded, setGrounded]   = useState(true)
  const [lastSearchQueries, setLastSearchQueries] = useState<string[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch("/api/auction-ai/presets").then(r => r.json()).then(setOverrides).catch(() => {})
  }, [])

  const systemInstruction = preset === "Custom (paste my own)" ? custom : (overrides[preset] ?? PRESETS[preset])

  async function savePreset(text: string) {
    await fetch("/api/auction-ai/presets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: preset, instruction: text }),
    })
    setOverrides(prev => ({ ...prev, [preset]: text }))
    setEditOpen(false)
  }

  async function send() {
    if (!message.trim() && !images.length) return
    setLoading(true); setError(null)
    const imgUrls = await Promise.all(images.map(toDataURL))
    const userDisplay: ChatMessage = { role: "user", text: message, images: imgUrls }
    setHistory(h => [...h, userDisplay])

    try {
      const fd = new FormData()
      fd.append("message", message)
      fd.append("systemInstruction", systemInstruction)
      fd.append("history", JSON.stringify(apiHistory))
      fd.append("model", model)
      images.forEach(img => fd.append("images", img, img.name))

      const endpoint = grounded ? "/api/auction-ai/chat-grounded" : "/api/auction-ai/chat"
      const res  = await fetch(endpoint, { method: "POST", body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.statusText)

      setLastSearchQueries(json.searchQueries ?? [])
      setHistory(h => [...h, { role: "model", text: json.reply }])
      setApiHist(h => [
        ...h,
        { role: "user",  parts: [{ text: message }] },
        { role: "model", parts: [{ text: json.reply }] },
      ])
      setMessage(""); setImages([])
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100)
    } catch (e: any) {
      setError(e.message)
      setHistory(h => h.slice(0, -1))
    }
    setLoading(false)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Chat Window</h2>
        <label className={`flex items-center gap-2 cursor-pointer px-3 py-1.5 rounded-lg border transition-colors ${grounded ? "bg-blue-950/50 border-blue-600/60 text-blue-300" : "bg-gray-100 dark:bg-[#2C2C2E] border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-500"}`}>
          <input type="checkbox" checked={grounded} onChange={e => { setGrounded(e.target.checked); setLastSearchQueries([]) }}
            className="w-3.5 h-3.5 accent-blue-500" />
          <span className="text-xs font-medium">🔍 Google Search</span>
        </label>
      </div>
      {grounded && (
        <div className="mb-3 px-3 py-2 bg-blue-950/30 border border-blue-700/40 rounded-lg">
          <p className="text-xs text-blue-400">Google Search grounding is enabled — Gemini will search the web in real time to verify product codes and catalogue numbers instead of guessing from memory.</p>
          {lastSearchQueries.length > 0 && (
            <p className="text-xs text-blue-600 mt-1">Last searched: {lastSearchQueries.join(" · ")}</p>
          )}
        </div>
      )}
      <PresetSelector value={preset} onChange={setPreset} overrides={overrides} onEdit={() => setEditOpen(true)} />
      {editOpen && <PresetEditorModal presetKey={preset} initialText={overrides[preset] ?? PRESETS[preset]} onSave={savePreset} onClose={() => setEditOpen(false)} />}
      {preset === "Custom (paste my own)" && (
        <textarea value={custom} onChange={(e) => setCustom(e.target.value)}
          placeholder="Paste your system instruction here…" rows={3}
          className="w-full bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[#C8A96E] mb-3 resize-none" />
      )}

      <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50 dark:bg-[#141416] rounded-lg border border-gray-200 dark:border-gray-800 p-4 mb-3 space-y-3">
        {history.length === 0 && (
          <p className="text-gray-600 text-sm text-center py-10">Upload lot images and describe what you need — Gemini will generate a professional catalogue entry.</p>
        )}
        {history.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[82%] rounded-lg px-4 py-3 ${msg.role === "user" ? "bg-gray-100 dark:bg-[#2C2C2E] text-gray-700 dark:text-gray-200" : "bg-gray-50 dark:bg-[#1a1a1e] border border-[#C8A96E]/25 text-gray-800 dark:text-gray-100"}`}>
              {msg.images?.length ? (
                <div className="flex flex-wrap gap-1 mb-2">
                  {msg.images.map((src, j) => <img key={j} src={src} className="w-14 h-14 object-cover rounded" />)}
                </div>
              ) : null}
              <p className="text-sm leading-relaxed">{renderMessageText(msg.text)}</p>
              {msg.role === "model" && (
                <div className="mt-2 flex gap-3">
                  <button onClick={() => { navigator.clipboard.writeText(msg.text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
                    className="text-xs text-[#C8A96E] hover:underline">
                    {copied ? "✓ Copied" : "Copy"}
                  </button>
                  {i === history.length - 1 && (
                    <button onClick={() => { setMessage("Please justify your estimate — list each source you used with a direct link, the specific lot or listing you found, the price or estimate shown, and how you used it to arrive at your figure."); setTimeout(() => document.querySelector<HTMLTextAreaElement>("textarea")?.focus(), 50) }}
                      className="text-xs text-purple-400 hover:underline">
                      £ Justify price
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-50 dark:bg-[#1a1a1e] border border-[#C8A96E]/25 rounded-lg px-4 py-3 flex items-center gap-2">
              <span className="text-xs text-gray-600 dark:text-gray-500">Gemini is thinking</span>
              <span className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <span key={i} className="w-1.5 h-1.5 rounded-full bg-[#C8A96E] animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {loading && (
        <div className="h-0.5 w-full bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden mb-2">
          <div className="h-full bg-[#C8A96E] rounded-full animate-pulse" style={{ width: "100%", opacity: 0.7 }} />
        </div>
      )}
      {error && <p className="text-red-400 text-sm mb-2">{error}</p>}
      <ImageZone images={images} onAdd={f => setImages(i => [...i, ...f])} onRemove={idx => setImages(i => i.filter((_, j) => j !== idx))} max={6} />

      <div className="flex gap-2">
        <textarea value={message} onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }}
          onPaste={(e) => {
            const imageFiles = Array.from(e.clipboardData.items)
              .filter(item => item.type.startsWith("image/"))
              .map(item => item.getAsFile())
              .filter((f): f is File => f !== null)
            if (imageFiles.length > 0) {
              e.preventDefault()
              setImages(prev => [...prev, ...imageFiles].slice(0, 6))
            }
          }}
          placeholder="Describe the lot or ask a question… (Enter to send, paste images with Ctrl+V)"
          rows={2}
          className="flex-1 bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[#C8A96E] resize-none" />
        <div className="flex flex-col gap-1.5">
          <button onClick={send} disabled={loading || (!message.trim() && !images.length)}
            className="px-5 py-2 bg-[#C8A96E] hover:bg-[#d4b87a] text-black text-sm font-bold rounded transition-colors disabled:opacity-40">
            {loading ? "…" : "Send"}
          </button>
          <button onClick={() => { setHistory([]); setApiHist([]) }}
            className="px-5 py-1.5 bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-xs rounded hover:border-gray-500">
            Clear
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Batch Run Tab ────────────────────────────────────────────────────────────

function BatchTab({ model, fallbackModel }: { model: string; fallbackModel: string }) {
  const [preset,     setPreset]   = useState(Object.keys(PRESETS)[1])
  const [custom,     setCustom]   = useState("")
  const [lots,       setLots]     = useState<Record<string, File[]>>({})
  const [overrides,  setOverrides] = useState<Record<string, string>>({})
  const [editOpen,   setEditOpen]  = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [results,  setResults]  = useState<BatchResult[]>([])
  const [loading,  setLoading]  = useState(false)
  const [done,     setDone]     = useState(0)
  const [log,      setLog]      = useState<string[]>([])
  const logRef     = useRef<HTMLDivElement>(null)
  const folderRef  = useRef<HTMLInputElement>(null)
  const sortRef    = useRef<HTMLInputElement>(null)
  const cancelRef  = useRef(false)
  const pauseRef   = useRef(false)
  const [paused,       setPaused]       = useState(false)
  const [grounded,     setGrounded]     = useState(false)
  const [auctionCode,  setAuctionCode]  = useState("")
  const [savedLots,    setSavedLots]    = useState<Set<string>>(new Set())
  const [savedRunId,   setSavedRunId]   = useState<string | null>(null)
  const [runList,      setRunList]      = useState<{ id: string; code: string; _count: { lots: number } }[]>([])

  useEffect(() => {
    fetch("/api/auction-ai/presets").then(r => r.json()).then(setOverrides).catch(() => {})
    fetch("/api/auction-ai/runs").then(r => r.json()).then(setRunList).catch(() => {})
    // Pre-load auction code from cataloguing page "Upgrade with AI" button
    const raw = localStorage.getItem("batch_preload")
    if (raw) {
      try {
        const data = JSON.parse(raw)
        if (data.auctionCode) setAuctionCode(data.auctionCode)
      } catch {}
      localStorage.removeItem("batch_preload")
    }
  }, [])

  // When auction code changes, look up existing saved lots for that run
  useEffect(() => {
    const code = auctionCode.trim().toUpperCase()
    if (!code) { setSavedLots(new Set()); setSavedRunId(null); return }
    const match = runList.find(r => r.code === code)
    if (!match) { setSavedLots(new Set()); setSavedRunId(null); return }
    setSavedRunId(match.id)
    fetch(`/api/auction-ai/runs/${match.id}`)
      .then(r => r.json())
      .then((run: any) => {
        if (!run?.lots) return
        setSavedLots(new Set(run.lots.map((l: any) => l.lot)))
      })
      .catch(() => {})
  }, [auctionCode, runList])

  // When savedLots loads (existing run selected), auto-deselect any already-saved
  // lots from the current photo selection — works even if photos were loaded first
  useEffect(() => {
    if (savedLots.size === 0) return
    setSelected(s => {
      const next = new Set([...s].filter(n => !savedLots.has(n)))
      return next.size === s.size ? s : next // avoid re-render if nothing changed
    })
  }, [savedLots])

  const systemInstruction = preset === "Custom (paste my own)" ? custom : (overrides[preset] ?? PRESETS[preset])

  async function savePreset(text: string) {
    await fetch("/api/auction-ai/presets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: preset, instruction: text }),
    })
    setOverrides(prev => ({ ...prev, [preset]: text }))
    setEditOpen(false)
  }
  const lotNames           = Object.keys(lots).sort()
  const selectedNames      = lotNames.filter(n => selected.has(n))
  const total              = selectedNames.length

  function addLog(msg: string) {
    const ts = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    setLog(l => [...l, `[${ts}]  ${msg}`])
    setTimeout(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }), 50)
  }

  // Load pre-sorted subfolders
  function onFolderFiles(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files) return
    const map: Record<string, File[]> = {}
    for (const file of Array.from(e.target.files)) {
      const parts = ((file as any).webkitRelativePath as string | undefined)?.split("/") ?? [file.name]
      const lot = parts.length > 1 ? parts[parts.length - 2] : "Default"
      if (!file.type.startsWith("image/")) continue
      if (!map[lot]) map[lot] = []
      if (map[lot].length < 24) map[lot].push(file)
    }
    const names = Object.keys(map)
    const autoSkipped = names.filter(n => savedLots.has(n))
    setLots(map); setSelected(new Set(names.filter(n => !savedLots.has(n)))); setResults([]); setLog([])
    addLog(`Loaded ${names.length} lot folders  ·  ${Object.values(map).reduce((s,f)=>s+f.length,0)} images total${autoSkipped.length ? `  ·  ${autoSkipped.length} already saved (auto-deselected)` : ""}`)
  }

  // Sort flat folder by filename: everything before the first underscore = lot name
  // e.g. R00001_1.jpg → lot "R00001"  (matches Python app logic)
  function onSortFiles(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files) return
    const files = Array.from(e.target.files).filter(f => f.type.startsWith("image/"))
    if (!files.length) return
    setLog([]); setResults([])
    addLog(`Sorting ${files.length} images by filename…`)

    const map: Record<string, File[]> = {}
    let sorted = 0, skipped = 0

    for (const file of files) {
      const nameNoExt = file.name.replace(/\.[^.]+$/, "")
      const lot = nameNoExt.split("_")[0].trim()
      if (!lot) { skipped++; continue }
      sorted++
      if (!map[lot]) map[lot] = []
      if (map[lot].length < 24) map[lot].push(file)
    }

    const names = Object.keys(map).sort()
    const autoSkipped = names.filter(n => savedLots.has(n))
    setLots(map); setSelected(new Set(names.filter(n => !savedLots.has(n))))
    addLog(`Done — ${names.length} lots, ${sorted} images sorted, ${skipped} skipped${autoSkipped.length ? `  ·  ${autoSkipped.length} already saved (auto-deselected)` : ""}`)
  }

  function toggleLot(name: string) {
    setSelected(s => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n })
  }
  function selectAll()  { setSelected(new Set(lotNames)) }
  function selectNone() { setSelected(new Set()) }

  function cancel() {
    cancelRef.current = true
    pauseRef.current  = false
    setPaused(false)
  }

  function togglePause() {
    const next = !pauseRef.current
    pauseRef.current = next
    setPaused(next)
    addLog(next ? "⏸ Paused — will stop after current lot finishes" : "▶ Resuming…")
  }

  async function run() {
    if (!selectedNames.length) return
    cancelRef.current = false
    pauseRef.current  = false
    setPaused(false)
    setLoading(true); setResults([]); setDone(0)
    setLog([])
    addLog(`Starting batch run — ${selectedNames.length} lots  ·  Model: ${model}  ·  Instruction: ${preset}`)
    if (auctionCode.trim()) addLog(`💾 Saving to auction: ${auctionCode.trim().toUpperCase()}`)
    const all: BatchResult[] = []

    for (let i = 0; i < selectedNames.length; i++) {
      if (cancelRef.current) {
        addLog(`⛔ Cancelled after ${i} / ${selectedNames.length} lots`)
        break
      }
      const lot   = selectedNames[i]
      const files = lots[lot]
      setDone(i)
      if (savedLots.has(lot)) {
        addLog(`⏭ ${lot} — already saved, skipping`)
        all.push({ lot, description: "", estimate: "", status: "SKIPPED" })
        continue
      }
      addLog(`Processing ${i + 1} / ${selectedNames.length}  ·  ${lot}  (${files.length} image${files.length !== 1 ? "s" : ""})`)

      // Retry indefinitely until the lot succeeds or the user cancels.
      // Only abort early on content blocks — those won't succeed no matter how
      // many times you try. Everything else (rate limits, network errors, etc.)
      // keeps retrying with appropriate backoff.
      let lastError = ""
      let succeeded = false
      let attempt   = 0

      while (!cancelRef.current) {
        if (attempt > 0) {
          const isRateLimit = lastError.startsWith("RATE_LIMITED:")
          // Rate limits: 60s → 120s → 240s → 480s → … capped at 30 min (exponential backoff).
          // Other errors: 12s → 24s → 30s (capped — these are usually transient).
          const wait = isRateLimit
            ? Math.min(60000 * Math.pow(2, attempt - 1), 1800000)
            : Math.min(attempt * 12000, 30000)
          addLog(`↺ ${lot} — ${isRateLimit ? "rate limited, waiting" : "retrying in"} ${wait / 1000}s (attempt ${attempt + 1})…`)
          await new Promise(r => setTimeout(r, wait))
          if (cancelRef.current) break
        }
        attempt++
        try {
          // Alternate between primary and fallback on each retry so if one is
          // rate-limited the other gets a chance to pick it up
          const modelToUse = (attempt % 2 === 0 && fallbackModel) ? fallbackModel : model
          if (attempt > 1) addLog(`  ↳ trying ${modelToUse}`)
          const fd = new FormData()
          fd.append("systemInstruction", systemInstruction)
          fd.append("model", modelToUse)
          fd.append("grounded", grounded ? "true" : "false")
          files.forEach((f, j) => fd.append(`lot_${lot}_image_${j}`, f, f.name))

          const res  = await fetch("/api/auction-ai/batch", { method: "POST", body: fd })
          const json = await res.json()
          if (!res.ok) throw new Error(json.error ?? res.statusText)

          // Check the individual lot result — the HTTP response is always 200
          // even when Gemini fails a lot, so we must inspect the result status
          const r = json.results[0]
          if (!r || r.status !== "OK") {
            throw new Error(r?.error ?? "Gemini returned no result for this lot")
          }

          all.push(...json.results)

          // Save to DB if auction code provided
          if (auctionCode.trim()) {
            const saveRes = await fetch("/api/auction-ai/runs", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ code: auctionCode.trim().toUpperCase(), preset, lot: r.lot, description: r.description, estimate: r.estimate }),
            })
            if (!saveRes.ok) {
              const txt = await saveRes.text().catch(() => "")
              let errMsg = ""; try { errMsg = JSON.parse(txt).error ?? "" } catch { errMsg = txt }
              showError(`Save failed — Lot ${lot}`, `HTTP ${saveRes.status}`, errMsg || "No detail returned from server")
              addLog(`⚠ ${lot} — OK but save failed: ${errMsg || saveRes.status}`)
            } else {
              setSavedLots(s => new Set([...s, r.lot]))
              addLog(`✓ ${lot} — OK  ·  saved`)
            }
          } else {
            addLog(`✓ ${lot} — OK`)
          }
          succeeded = true
          break
        } catch (e: any) {
          lastError = e.message ?? String(e)
          // Content blocks will never succeed — skip immediately
          if (lastError.toLowerCase().includes("block") && !lastError.startsWith("RATE_LIMITED:")) {
            addLog(`✗ ${lot} — blocked by Gemini, skipping: ${lastError}`)
            break
          }
        }
      }

      if (!succeeded) {
        all.push({ lot, description: "", estimate: "", status: "FAILED", error: lastError })
        addLog(`✗ ${lot} — FAILED after ${attempt} attempt${attempt !== 1 ? "s" : ""}: ${lastError}`)
      }
      setResults([...all])

      // Wait while paused (poll every 500ms)
      if (pauseRef.current) {
        addLog(`⏸ Paused after ${lot} — click Resume to continue`)
        while (pauseRef.current && !cancelRef.current) {
          await new Promise(r => setTimeout(r, 500))
        }
        if (!cancelRef.current) addLog("▶ Resumed")
      }
    }

    if (!cancelRef.current) {
      setDone(selectedNames.length)
      const ok   = all.filter(r => r.status === "OK").length
      const fail = all.filter(r => r.status !== "OK").length
      addLog(`Run complete — ${ok} OK, ${fail} failed`)
    }
    setLoading(false)
  }

  function exportXlsx() {
    const now = new Date().toISOString()
    const rows = results.filter(r => r.status === "OK").map(r => {
      const { low, high } = parseEstimate(r.estimate)
      return { Folder: r.lot, Description: r.description, Estimate: r.estimate, "Estimate Low": low, "Estimate High": high, Status: r.status, Updated: now }
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    ws["!cols"] = [{ wch: 16 }, { wch: 70 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 26 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Descriptions")
    XLSX.writeFile(wb, "auction_ai_results.xlsx")
  }

  const pct = total ? Math.round((done / total) * 100) : 0

  // ── Post-run save state ───────────────────────────────────────────────────
  const [saveCode,    setSaveCode]    = useState("")
  const [saving,      setSaving]      = useState(false)
  const [saveErrors,  setSaveErrors]  = useState<{ lot: string; code: string; message: string }[]>([])
  const [savedCount,  setSavedCount]  = useState<number | null>(null)

  // Keep saveCode in sync with auctionCode field
  useEffect(() => { if (auctionCode) setSaveCode(auctionCode) }, [auctionCode])

  const unsavedOkResults = results.filter(r => r.status === "OK" && !savedLots.has(r.lot))

  async function saveToRun() {
    const code = saveCode.trim().toUpperCase()
    if (!code) {
      setSaveErrors([{ lot: "—", code: "SAVE-001", message: "No auction code entered" }])
      return
    }
    setSaving(true)
    setSaveErrors([])
    setSavedCount(null)

    const errors: typeof saveErrors = []
    let saved = 0

    for (const r of unsavedOkResults) {
      try {
        const res = await fetch("/api/auction-ai/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, preset, lot: r.lot, description: r.description, estimate: r.estimate }),
        })
        if (!res.ok) {
          let msg = `HTTP ${res.status}`
          try { const j = await res.json(); msg = j.error ?? msg } catch {}
          errors.push({ lot: r.lot, code: `SAVE-002`, message: msg })
        } else {
          saved++
          setSavedLots(s => new Set([...s, r.lot]))
        }
      } catch (e: any) {
        errors.push({ lot: r.lot, code: "SAVE-003", message: e.message ?? "Network error" })
      }
    }

    setSavedCount(saved)
    setSaveErrors(errors)
    setSaving(false)

    // Update run list so Saved Runs tab reflects new count
    fetch("/api/auction-ai/runs").then(r => r.json()).then(setRunList).catch(() => {})
  }

  return (
    <div className="flex flex-col h-full gap-3">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Batch Run</h2>

      <PresetSelector value={preset} onChange={setPreset} overrides={overrides} onEdit={() => setEditOpen(true)} />
      {editOpen && <PresetEditorModal presetKey={preset} initialText={overrides[preset] ?? PRESETS[preset]} onSave={savePreset} onClose={() => setEditOpen(false)} />}
      {preset === "Custom (paste my own)" && (
        <textarea value={custom} onChange={(e) => setCustom(e.target.value)}
          placeholder="Paste your system instruction here…" rows={3}
          className="w-full bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[#C8A96E] resize-none" />
      )}

      {/* ── Google Search grounding ── */}
      <label className={`flex items-center gap-2 cursor-pointer px-3 py-1.5 rounded-lg border transition-colors ${grounded ? "bg-blue-950/50 border-blue-600/60 text-blue-300" : "bg-gray-100 dark:bg-[#2C2C2E] border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-500"}`}>
        <input type="checkbox" checked={grounded} onChange={e => setGrounded(e.target.checked)}
          className="w-3.5 h-3.5 rounded accent-blue-500" />
        <span className="text-xs font-medium">🔍 Google Search</span>
        <span className="text-xs opacity-60">lets Gemini look up catalogue numbers in real time</span>
      </label>

      {/* ── Auction Code ── */}
      <div>
        <label className="block text-xs text-gray-600 dark:text-gray-500 mb-1 uppercase tracking-wider">
          Auction Code <span className="normal-case text-gray-600">(optional — saves results for later retrieval)</span>
        </label>
        <Autocomplete
          value={auctionCode}
          onChange={v => setAuctionCode(v.replace(/\s+\(\d+ lots\)$/, "").toUpperCase())}
          options={runList.map(r => `${r.code}  (${r._count.lots} lots)`)}
          placeholder="Select existing or type new code…"
        />
        {auctionCode && !runList.find(r => r.code === auctionCode.trim().toUpperCase()) && (
          <p className="text-xs text-gray-600 mt-1">New run — lots will be saved under this code</p>
        )}
        {savedLots.size > 0 && (
          <div className="mt-2 px-3 py-2 bg-amber-950/40 border border-amber-700/50 rounded-lg flex items-center gap-3">
            <span className="text-sm">⟳</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-amber-300">Resuming run — {savedLots.size} lot{savedLots.size !== 1 ? "s" : ""} already saved</p>
              <p className="text-xs text-amber-600 mt-0.5">Already-saved lots are deselected automatically. Upload your photos and only the missing ones will be processed.</p>
            </div>
            <button
              onClick={() => {
                const inBoth = [...savedLots].filter(l => selected.has(l))
                if (inBoth.length > 0) {
                  setSelected(s => new Set([...s].filter(l => !savedLots.has(l))))
                } else {
                  setSelected(s => new Set([...s, ...savedLots].filter(l => lotNames.includes(l))))
                }
              }}
              className="text-xs px-2.5 py-1 bg-gray-100 dark:bg-[#2C2C2E] border border-amber-600 text-amber-400 rounded hover:bg-amber-900/30 transition-colors whitespace-nowrap flex-shrink-0">
              ⏭ Skip Saved
            </button>
          </div>
        )}
      </div>

      {/* ── Step 1: Sort (optional) ── */}
      <div className="bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg p-3">
        <p className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider mb-2">Step 1 — Sort flat folder by filename (optional)</p>
        <div onClick={() => sortRef.current?.click()}
          className="border border-dashed border-gray-300 dark:border-gray-600 hover:border-green-500 rounded-lg px-4 py-3 text-center cursor-pointer transition-colors">
          <p className="text-gray-600 dark:text-gray-300 text-sm font-medium">▦ Sort images by filename (e.g. R00001_1.jpg)</p>
          <p className="text-gray-600 text-xs mt-0.5">Groups by the part before the first underscore — R00001_1.jpg → lot R00001</p>
          <input ref={sortRef} type="file" multiple accept="image/*" className="hidden" onChange={onSortFiles} />
        </div>
      </div>

      {/* ── Step 2: Load subfolders ── */}
      <div className="bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg p-3">
        <p className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider mb-2">Step 2 — Load lot subfolders</p>
        <div onClick={() => folderRef.current?.click()}
          className="border border-dashed border-gray-300 dark:border-gray-600 hover:border-[#C8A96E] rounded-lg px-4 py-3 text-center cursor-pointer transition-colors">
          <p className="text-gray-600 dark:text-gray-300 text-sm font-medium">📂 {lotNames.length > 0 ? `${lotNames.length} lots loaded — click to reload` : "Select folder"}</p>
          <p className="text-gray-600 text-xs mt-0.5">Each sub-folder = one lot (up to 24 images each)</p>
          <input ref={folderRef} type="file" multiple className="hidden" {...({ webkitdirectory: "" } as any)} onChange={onFolderFiles} />
        </div>
      </div>

      {/* ── Lot list ── */}
      {lotNames.length > 0 && (
        <div className="flex flex-col min-h-0" style={{ maxHeight: "220px" }}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-gray-600 dark:text-gray-400">
              <span className="text-[#C8A96E] font-semibold">{selected.size}</span>
              {" / "}{lotNames.length} lots selected
              {" · "}{Object.values(lots).reduce((s,f)=>s+f.length,0)} images
            </span>
            <div className="flex gap-1.5">
              <button onClick={selectAll}  className="text-xs px-2 py-0.5 bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 rounded hover:border-gray-500">All</button>
              <button onClick={selectNone} className="text-xs px-2 py-0.5 bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 rounded hover:border-gray-500">None</button>
              <button onClick={() => setSelected(s => { const n = new Set(s); results.filter(r => r.status === "OK").forEach(r => n.delete(r.lot)); return n })}
                className="text-xs px-2 py-0.5 bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 rounded hover:border-gray-500" title="Deselect lots that already have an OK result">Skip Done</button>
            </div>
          </div>
          <div className="overflow-y-auto rounded border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#141416] flex-1">
            {lotNames.map(name => {
              const checked  = selected.has(name)
              const imgCount = lots[name].length
              const result   = results.find(r => r.lot === name)
              return (
                <div key={name} onClick={() => !loading && toggleLot(name)}
                  className={`flex items-center gap-3 px-3 py-2 border-b border-gray-200 dark:border-gray-800 last:border-0 cursor-pointer transition-colors ${checked ? "hover:bg-gray-100 dark:hover:bg-[#2C2C2E]" : "opacity-40 hover:opacity-60"}`}>
                  <div className={`w-3.5 h-3.5 rounded flex-shrink-0 flex items-center justify-center border ${checked ? "bg-[#C8A96E] border-[#C8A96E]" : "border-gray-600"}`}>
                    {checked && <span className="text-black text-xs font-bold leading-none">✓</span>}
                  </div>
                  <span className="flex-1 text-xs text-gray-700 dark:text-gray-200 font-mono truncate">{name}</span>
                  <span className="text-xs text-gray-600 flex-shrink-0">{imgCount}img</span>
                  {result && <span className={`text-xs font-bold flex-shrink-0 ${result.status === "OK" ? "text-green-400" : "text-red-400"}`}>{result.status}</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Run log ── */}
      {log.length > 0 && (
        <div ref={logRef} className="overflow-y-auto rounded border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-[#0d0d0f] px-3 py-2 font-mono text-xs text-[#C8C8D0] flex-shrink-0" style={{ maxHeight: "160px" }}>
          {log.map((line, i) => (
            <p key={i} className={line.includes("✓") ? "text-green-400" : line.includes("✗") || line.includes("ERROR") ? "text-red-400" : line.includes("complete") || line.includes("complete") ? "text-[#C8A96E]" : ""}>{line}</p>
          ))}
        </div>
      )}

      {/* ── Progress bar ── */}
      {loading && (
        <div className="flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-semibold text-[#C8A96E]">{done} / {total} lots complete</span>
            <span className="text-xs text-gray-600 dark:text-gray-500">{pct}%</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2">
            <div className="bg-[#C8A96E] h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {/* ── Save to Run panel ── */}
      {unsavedOkResults.length > 0 && !loading && (
        <div className="flex-shrink-0 bg-blue-50 dark:bg-[#1a1a2e] border border-[#C8A96E]/40 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-[#C8A96E]">💾 Save {unsavedOkResults.length} lot{unsavedOkResults.length !== 1 ? "s" : ""} to a Run</p>
            {savedCount !== null && saveErrors.length === 0 && (
              <span className="text-xs text-green-400">✓ {savedCount} saved</span>
            )}
          </div>
          <div className="flex gap-2">
            <input
              value={saveCode}
              onChange={e => setSaveCode(e.target.value.toUpperCase())}
              placeholder="Auction code e.g. F051"
              className="flex-1 bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-600 rounded px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[#C8A96E] placeholder:text-gray-600 font-mono"
            />
            <button onClick={saveToRun} disabled={saving}
              className="px-4 py-1.5 bg-[#C8A96E] hover:bg-[#d4b87a] disabled:opacity-50 text-black text-sm font-bold rounded transition-colors whitespace-nowrap">
              {saving ? "Saving…" : "Save to Run"}
            </button>
          </div>
          {saveErrors.length > 0 && (
            <div className="space-y-1">
              {saveErrors.map((e, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-red-300 bg-red-950/60 border border-red-800 rounded px-3 py-1.5">
                  <span className="font-mono text-red-500 flex-shrink-0">[{e.code}]</span>
                  <span className="flex-shrink-0 text-gray-600 dark:text-gray-500">{e.lot}</span>
                  <span>{e.message}</span>
                </div>
              ))}
            </div>
          )}
          {savedCount !== null && savedCount > 0 && (
            <p className="text-xs text-green-400">
              ✓ {savedCount} lot{savedCount !== 1 ? "s" : ""} saved under <span className="font-mono text-[#C8A96E]">{saveCode}</span>
              {saveErrors.length > 0 && <span className="text-yellow-400 ml-2">· {saveErrors.length} failed — see errors above</span>}
            </p>
          )}
        </div>
      )}

      {/* ── Actions ── */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <button onClick={run} disabled={loading || !total}
          className="px-6 py-2 bg-[#C8A96E] hover:bg-[#d4b87a] text-black text-sm font-bold rounded transition-colors disabled:opacity-40">
          {loading ? `Running ${done} / ${total}…` : `Start Batch (${total} lots)`}
        </button>
        {loading && (
          <button onClick={togglePause}
            className={`px-4 py-2 border text-sm font-semibold rounded transition-colors ${paused ? "bg-green-900 hover:bg-green-800 border-green-700 text-green-300" : "bg-yellow-900 hover:bg-yellow-800 border-yellow-700 text-yellow-300"}`}>
            {paused ? "▶ Resume" : "⏸ Pause"}
          </button>
        )}
        {loading && (
          <button onClick={cancel}
            className="px-4 py-2 bg-red-900 hover:bg-red-800 border border-red-700 text-red-300 text-sm font-semibold rounded transition-colors">
            ✕ Cancel
          </button>
        )}
        {results.length > 0 && !loading && (
          <button onClick={exportXlsx}
            className="px-4 py-2 bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 hover:border-[#C8A96E] text-gray-600 dark:text-gray-300 text-sm rounded transition-colors">
            ⬇ Export to Excel
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Barcode Sorter Tab ───────────────────────────────────────────────────────

function BarcodeTab() {
  const [files, setFiles]     = useState<File[]>([])
  const [results, setResults] = useState<{ name: string; barcode: string; type: string; folder: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function scan() {
    if (!files.length) return
    setLoading(true); setError(null)
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser" as any)
      const reader = new (BrowserMultiFormatReader as any)()
      const out: typeof results = []

      for (const file of files) {
        const url = URL.createObjectURL(file)
        const img = new Image()
        img.src = url
        await new Promise((r) => { img.onload = r; img.onerror = r })
        let barcode = "—", folder = "_UNSORTED", type = "Unknown"
        try {
          const r   = await reader.decodeFromImageElement(img)
          barcode   = r.getText()
          const isC = /^C\d{6}/.test(barcode)
          const isL = /^L\d{6}/.test(barcode)
          type   = isC ? "Customer" : isL ? "Lot" : "Unknown"
          folder = isC ? `Customers/${barcode}` : isL ? `Lots/${barcode}` : "_UNSORTED"
        } catch { /* unreadable */ }
        URL.revokeObjectURL(url)
        out.push({ name: file.name, barcode, type, folder })
      }
      setResults(out)
    } catch (e: any) {
      setError("Barcode library failed to load. Run: npm install @zxing/browser  — " + e.message)
    }
    setLoading(false)
  }

  async function downloadZip() {
    const JSZip = (await import("jszip")).default
    const zip   = new JSZip()
    for (let i = 0; i < files.length; i++) {
      const buf = await files[i].arrayBuffer()
      zip.file(`${results[i].folder}/${files[i].name}`, buf)
    }
    const blob = await zip.generateAsync({ type: "blob" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = "sorted_barcodes.zip"
    a.click()
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Barcode Sorter</h2>
      <p className="text-gray-600 dark:text-gray-500 text-sm mb-4">Upload barcode header images — decodes each barcode and sorts files into customer or lot folders for download.</p>

      <div onClick={() => document.getElementById("bc-input")?.click()}
        className="border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-[#C8A96E] rounded-lg p-6 text-center cursor-pointer transition-colors mb-4">
        <p className="text-gray-600 dark:text-gray-400 text-sm">Click or drop barcode images here</p>
        <p className="text-gray-600 text-xs mt-1">{files.length} file{files.length !== 1 ? "s" : ""} selected</p>
        <input id="bc-input" type="file" multiple accept="image/*" className="hidden"
          onChange={(e) => { if (e.target.files) { setFiles(Array.from(e.target.files)); setResults([]) } }} />
      </div>

      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

      <button onClick={scan} disabled={loading || !files.length}
        className="mb-4 px-6 py-2 bg-[#C8A96E] hover:bg-[#d4b87a] text-black text-sm font-bold rounded transition-colors disabled:opacity-40">
        {loading ? "Scanning…" : "Scan Barcodes"}
      </button>

      {results.length > 0 && (
        <>
          <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-800 mb-3">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-[#141416] text-gray-600 dark:text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">File</th>
                  <th className="px-4 py-2 text-left">Barcode</th>
                  <th className="px-4 py-2 text-left">Type</th>
                  <th className="px-4 py-2 text-left">Folder</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {results.map((r, i) => (
                  <tr key={i} className="hover:bg-gray-50 dark:hover:bg-[#141416]">
                    <td className="px-4 py-2 text-gray-600 dark:text-gray-400 text-xs truncate max-w-[160px]">{r.name}</td>
                    <td className="px-4 py-2 text-[#C8A96E] font-mono text-xs">{r.barcode}</td>
                    <td className="px-4 py-2 text-gray-600 dark:text-gray-300 text-xs">{r.type}</td>
                    <td className="px-4 py-2 text-gray-600 dark:text-gray-500 text-xs">{r.folder}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={downloadZip}
            className="px-4 py-2 bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 hover:border-[#C8A96E] text-gray-600 dark:text-gray-300 text-sm rounded transition-colors">
            ⬇ Download Sorted ZIP
          </button>
        </>
      )}
    </div>
  )
}

// ─── Description Copier Tab ───────────────────────────────────────────────────

type SortBy = "uniqueId" | "barcode"

type CopierRow = { folder: string; description: string; estimate: string; uniqueId?: string; barcode?: string; imageUrls?: string[] }

function sortRows(rows: CopierRow[], sortBy: SortBy) {
  return [...rows].sort((a, b) => {
    if (sortBy === "uniqueId") {
      const fa = (a.uniqueId || a.folder).trim()
      const fb = (b.uniqueId || b.folder).trim()
      // R000016-413 → sort by receipt number (16) then line number (413)
      const m = (s: string) => s.match(/^[A-Za-z](\d+)-(\d+)$/)
      const ma = m(fa), mb = m(fb)
      if (ma && mb) {
        const diff = parseInt(ma[1], 10) - parseInt(mb[1], 10)
        return diff !== 0 ? diff : parseInt(ma[2], 10) - parseInt(mb[2], 10)
      }
      return fa.localeCompare(fb, undefined, { numeric: true, sensitivity: "base" })
    }
    // barcode
    const fa = (a.barcode || a.folder).trim()
    const fb = (b.barcode || b.folder).trim()
    return fa.localeCompare(fb, undefined, { numeric: true, sensitivity: "base" })
  })
}

function CopierTab() {
  const [rows, setRows]         = useState<CopierRow[]>([])
  const [sortBy, setSortBy]     = useState<SortBy>("uniqueId")
  const [idx, setIdx]           = useState(0)
  const [copiedType, setCopied] = useState<"desc" | "both" | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [jumpQuery, setJumpQuery] = useState("")
  const [jumpOpen, setJumpOpen]   = useState(false)
  const [thumbUrl, setThumbUrl]   = useState<string | null>(null)

  const sortedRows = sortRows(rows, sortBy)

  useEffect(() => {
    const preload = localStorage.getItem("copier_preload")
    if (preload) {
      try {
        const data = JSON.parse(preload)
        setRows(data.map((r: any) => ({
          folder:      String(r.Folder ?? ""),
          description: String(r.Description ?? ""),
          estimate:    String(r.Estimate ?? ""),
          uniqueId:    String(r["Receipt Unique ID"] ?? r.UniqueID ?? r["Unique ID"] ?? r.uniqueId ?? ""),
          barcode:     String(r.Barcode ?? r.barcode ?? ""),
          imageUrls:   Array.isArray(r.ImageUrls) ? r.ImageUrls : [],
        })))
        setIdx(0)
        localStorage.removeItem("copier_preload")
      } catch {}
    }
  }, [])

  // Fetch signed URL for the first image of the current row
  useEffect(() => {
    const key = row?.imageUrls?.[0]
    if (!key) { setThumbUrl(null); return }
    let cancelled = false
    fetch(`/api/catalogue/signed-url?key=${encodeURIComponent(key)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setThumbUrl(d.url ?? null) })
      .catch(() => { if (!cancelled) setThumbUrl(null) })
    return () => { cancelled = true }
  }, [sortedRows[idx]?.imageUrls?.[0]])

  function loadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const wb   = XLSX.read(ev.target?.result, { type: "binary" })
        const ws   = wb.Sheets[wb.SheetNames[0]]
        const data = XLSX.utils.sheet_to_json<any>(ws)
        setRows(data.map((r: any) => ({
          folder:      String(r.Folder ?? r.folder ?? r.Lot ?? ""),
          description: String(r.Description ?? r.description ?? ""),
          estimate:    String(r.Estimate ?? r.estimate ?? ""),
          uniqueId:    String(r["Receipt Unique ID"] ?? r.UniqueID ?? r["Unique ID"] ?? r.uniqueId ?? ""),
          barcode:     String(r.Barcode ?? r.barcode ?? ""),
        })))
        setIdx(0); setError(null); setJumpQuery("")
      } catch (e: any) { setError("Failed to read Excel: " + e.message) }
    }
    reader.readAsBinaryString(file)
  }

  const row = sortedRows[idx]

  function copyDesc() {
    if (!row) return
    navigator.clipboard.writeText(row.description || "Missing Photos")
    setCopied("desc"); setTimeout(() => setCopied(null), 1500)
  }

  function copyBoth() {
    if (!row) return
    const desc = row.description || "Missing Photos"
    navigator.clipboard.writeText(row.estimate ? `${desc}\n${row.estimate}` : desc)
    setCopied("both"); setTimeout(() => setCopied(null), 1500)
  }

  function jumpTo(i: number) {
    setIdx(i)
    setJumpQuery(rows[i]?.folder ?? "")
    setJumpOpen(false)
  }

  function rowLabel(r: CopierRow) {
    if (sortBy === "uniqueId") return r.uniqueId || r.folder
    return r.barcode || r.folder
  }

  const filteredJump = sortedRows
    .map((r, i) => ({ ...r, i }))
    .filter(r => rowLabel(r).toLowerCase().includes(jumpQuery.toLowerCase()))
    .slice(0, 50)

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Description Copier</h2>
      <label className="block mb-4">
        <span className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider mb-1 block">Load Excel results file</span>
        <input type="file" accept=".xlsx,.xls" onChange={loadFile}
          className="text-sm text-gray-600 dark:text-gray-400 file:mr-3 file:py-1.5 file:px-4 file:rounded file:border-0 file:bg-[#C8A96E] file:text-black file:text-sm file:font-bold hover:file:bg-[#d4b87a] cursor-pointer" />
      </label>

      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

      {rows.length > 0 && (
        <>
          {/* Sort selector */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider">Sort by:</span>
            {(["uniqueId", "barcode"] as SortBy[]).map(s => (
              <button key={s} onClick={() => { setSortBy(s); setIdx(0) }}
                className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
                  sortBy === s
                    ? "bg-[#C8A96E] border-[#C8A96E] text-black"
                    : "bg-gray-100 dark:bg-[#2C2C2E] border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-500"
                }`}>
                {s === "uniqueId" ? "Unique ID" : "Barcode"}
              </button>
            ))}
          </div>

          {/* Fixed-height panel so buttons never move */}
          <div className="flex flex-col gap-4" style={{ height: 540 }}>

            {/* Navigation row — pinned top */}
            <div className="flex items-center gap-3 flex-wrap shrink-0">
              <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}
                className="px-6 py-3 bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 rounded-lg text-base font-semibold disabled:opacity-40 hover:border-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">← Prev</button>
              <span className="text-sm text-gray-600 dark:text-gray-400 tabular-nums">{idx + 1} / {sortedRows.length}</span>
              <button onClick={() => setIdx(i => Math.min(sortedRows.length - 1, i + 1))} disabled={idx === sortedRows.length - 1}
                className="px-6 py-3 bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 rounded-lg text-base font-semibold disabled:opacity-40 hover:border-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">Next →</button>

              {/* Jump to lot */}
              <div className="relative ml-auto">
                <div className="flex items-center">
                  <span className="text-xs text-gray-600 dark:text-gray-500 mr-2 whitespace-nowrap">Jump to lot:</span>
                  <input
                    value={jumpQuery}
                    onChange={e => { setJumpQuery(e.target.value); setJumpOpen(true) }}
                    onFocus={() => setJumpOpen(true)}
                    onBlur={() => setTimeout(() => setJumpOpen(false), 150)}
                    placeholder="Search lot…"
                    className="w-36 bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[#C8A96E]"
                  />
                </div>
                {jumpOpen && filteredJump.length > 0 && (
                  <div className="absolute right-0 z-50 w-56 bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded mt-0.5 max-h-56 overflow-y-auto shadow-xl">
                    {filteredJump.map(r => (
                      <button key={r.i} onMouseDown={() => jumpTo(r.i)}
                        className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-gray-200 dark:hover:bg-[#3A3A3C] ${r.i === idx ? "text-[#C8A96E] font-semibold" : "text-gray-700 dark:text-gray-200"}`}>
                        {rowLabel(r) || `Row ${r.i + 1}`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Card — scrolls internally, never changes the outer height */}
            <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-[#141416] border border-gray-200 dark:border-gray-800 rounded-lg p-5">
              {row && (() => {
                const label = sortBy === "uniqueId" ? "Unique ID"
                            : sortBy === "barcode"   ? "Barcode"
                            : "Lot"
                const value = rowLabel(row)
                return (
                  <>
                    <div className="flex gap-4">
                      {/* Thumbnail */}
                      {thumbUrl && (
                        <a href={thumbUrl} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                          <img src={thumbUrl} alt="Lot" className="w-28 h-28 object-cover rounded-lg border border-gray-300 dark:border-gray-700 hover:opacity-90 transition-opacity" />
                        </a>
                      )}
                      {/* Text */}
                      <div className="min-w-0 flex-1">
                        {(row.uniqueId || row.barcode) && (
                          <p className="text-xs font-mono text-[#C8A96E] font-semibold mb-2 flex flex-wrap gap-x-4">
                            {row.uniqueId && <span><span className="text-gray-600 dark:text-gray-500 font-sans font-normal">Unique ID: </span>{row.uniqueId}</span>}
                            {row.barcode  && <span><span className="text-gray-600 dark:text-gray-500 font-sans font-normal">Barcode: </span>{row.barcode}</span>}
                          </p>
                        )}
                        {row.description
                          ? <p className="text-gray-700 dark:text-gray-200 text-sm leading-relaxed whitespace-pre-wrap">{row.description}</p>
                          : <p className="text-red-400 text-sm font-semibold italic">Missing Photos</p>
                        }
                        {row.estimate && <p className="text-[#C8A96E] text-sm font-semibold mt-2">{row.estimate}</p>}
                      </div>
                    </div>
                  </>
                )
              })()}
            </div>

            {/* Copy buttons — pinned bottom */}
            <div className="flex gap-4 shrink-0">
              <button onClick={copyDesc}
                className="flex-1 px-6 py-5 bg-gray-100 dark:bg-[#2C2C2E] border-2 border-[#C8A96E] hover:bg-[#C8A96E] hover:text-black text-[#C8A96E] text-lg font-bold rounded-xl transition-colors">
                {copiedType === "desc" ? "✓ Copied!" : "Copy Description"}
              </button>
              <button onClick={copyBoth}
                className="flex-1 px-6 py-5 bg-[#C8A96E] hover:bg-[#d4b87a] text-black text-lg font-bold rounded-xl transition-colors">
                {copiedType === "both" ? "✓ Copied!" : "Description + Estimate"}
              </button>
            </div>

          </div>
        </>
      )}
    </div>
  )
}

// ─── Saved Runs Tab ───────────────────────────────────────────────────────────

type RunSummary = { id: string; code: string; preset: string; updatedAt: string; _count: { lots: number } }
type RunLot     = { id: string; lot: string; description: string; estimate: string; createdAt: string; originalDescription?: string | null; keyPoints?: string | null; missing?: string | null; added?: string | null }
type RunDetail  = { id: string; code: string; preset: string; updatedAt: string; lots: RunLot[] }

function SavedRunsTab() {
  const [runs,          setRuns]          = useState<RunSummary[]>([])
  const [expanded,      setExpanded]      = useState<string | null>(null)
  const [detail,        setDetail]        = useState<RunDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [search,        setSearch]        = useState("")
  const [loading,       setLoading]       = useState(false)
  const [deleting,      setDeleting]      = useState<string | null>(null)
  const [applying,      setApplying]      = useState<string | boolean>(false) // lotId | "all" | false
  const [applyResult,   setApplyResult]   = useState<{ created: number; updated: number; auctionId: string } | null>(null)
  const [applyError,    setApplyError]    = useState<string | null>(null)

  useEffect(() => { loadRuns() }, [])

  async function loadRuns() {
    setLoading(true)
    const r = await fetch("/api/auction-ai/runs")
    const j = await r.json()
    // Only show batch runs (not KP Check runs)
    setRuns((j as RunSummary[]).filter(x => x.preset !== "Key Points Check"))
    setLoading(false)
  }

  async function expand(run: RunSummary) {
    if (expanded === run.id) { setExpanded(null); setDetail(null); setApplyResult(null); setApplyError(null); return }
    setExpanded(run.id)
    setDetail(null)
    setApplyResult(null)
    setApplyError(null)
    setLoadingDetail(true)
    try {
      const r = await fetch(`/api/auction-ai/runs/${run.id}`)
      setDetail(await r.json())
    } catch { /* swallow — spinner will just stop */ } finally {
      setLoadingDetail(false)
    }
  }

  async function deleteRun(id: string) {
    if (!confirm("Delete this auction run and all its lots?")) return
    setDeleting(id)
    await fetch("/api/auction-ai/runs", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) })
    setRuns(r => r.filter(x => x.id !== id))
    if (expanded === id) { setExpanded(null); setDetail(null); setApplyResult(null); setApplyError(null) }
    setDeleting(null)
  }

  async function deleteLot(lotId: string) {
    await fetch(`/api/auction-ai/runs/${lotId}`, { method: "DELETE" })
    setDetail(d => d ? { ...d, lots: d.lots.filter(l => l.id !== lotId) } : d)
    setRuns(r => r.map(x => x.id === detail?.id ? { ...x, _count: { lots: x._count.lots - 1 } } : x))
  }

  async function applyToAuction(runId: string) {
    if (!confirm("Apply all lots to the catalogue auction? Existing lots will have their description and AI estimate updated. New lots will be created.")) return
    setApplying("all")
    setApplyResult(null)
    setApplyError(null)
    try {
      const r = await fetch(`/api/auction-ai/runs/${runId}/apply`, { method: "POST" })
      const j = await r.json()
      if (!r.ok) { setApplyError(j.error ?? "Failed to apply"); return }
      setApplyResult(j)
    } catch (e: any) {
      setApplyError(e.message ?? "Network error")
    } finally {
      setApplying(false)
    }
  }

  async function applyOneLot(runId: string, lotId: string) {
    setApplying(lotId)
    setApplyResult(null)
    setApplyError(null)
    try {
      const r = await fetch(`/api/auction-ai/runs/${runId}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lotIds: [lotId] }),
      })
      const j = await r.json()
      if (!r.ok) { setApplyError(j.error ?? "Failed to apply"); return }
      setApplyResult(j)
    } catch (e: any) {
      setApplyError(e.message ?? "Network error")
    } finally {
      setApplying(false)
    }
  }

  function exportRun(run: RunDetail) {
    const rows = run.lots.map(l => {
      const { low, high } = parseEstimate(l.estimate)
      return { Folder: l.lot, Description: l.description, Estimate: l.estimate, "Estimate Low": low, "Estimate High": high, Status: "OK", Updated: new Date(l.createdAt).toISOString() }
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    ws["!cols"] = [{ wch: 16 }, { wch: 70 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 26 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, run.code)
    XLSX.writeFile(wb, `${run.code}.xlsx`)
  }

  const filtered = runs.filter(r => r.code.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Saved Runs</h2>
        <button onClick={loadRuns} className="text-xs text-gray-600 dark:text-gray-500 hover:text-gray-300 transition-colors">↻ Refresh</button>
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search auction code…"
        className="w-full bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[#C8A96E] placeholder:text-gray-600" />

      {loading && <p className="text-gray-600 dark:text-gray-500 text-sm">Loading…</p>}

      {!loading && filtered.length === 0 && (
        <p className="text-gray-600 text-sm">No saved runs yet. Enter an auction code on the Batch Run tab before running.</p>
      )}

      <div className="flex flex-col gap-2 overflow-y-auto flex-1">
        {filtered.map(run => (
          <div key={run.id} className="bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-200 dark:hover:bg-[#3A3A3C] transition-colors" onClick={() => expand(run)}>
              <span className="text-[#C8A96E] font-bold font-mono text-sm flex-1">{run.code}</span>
              <span className="text-xs text-gray-600 dark:text-gray-500">{run._count.lots} lots</span>
              <span className="text-xs text-gray-600">{new Date(run.updatedAt).toLocaleDateString("en-GB")}</span>
              <span className="text-xs text-gray-600 truncate max-w-[120px]">{run.preset}</span>
              <button onClick={e => { e.stopPropagation(); deleteRun(run.id) }} disabled={deleting === run.id}
                className="text-xs text-red-500 hover:text-red-400 transition-colors ml-1 flex-shrink-0">
                {deleting === run.id ? "…" : "Delete"}
              </button>
              <span className="text-gray-600 text-xs">{expanded === run.id ? "▲" : "▼"}</span>
            </div>

            {expanded === run.id && (
              <div className="border-t border-gray-300 dark:border-gray-700">
                {loadingDetail && (
                  <div className="px-4 py-4 text-xs text-gray-600 dark:text-gray-500 flex items-center gap-2">
                    <span className="animate-spin inline-block w-3 h-3 border border-gray-500 border-t-transparent rounded-full" />
                    Loading lots…
                  </div>
                )}

                {!loadingDetail && detail?.id === run.id && (
                  <>
                    <div className="flex items-center justify-between gap-2 px-4 py-2 bg-white dark:bg-[#1C1C1E] flex-wrap">
                      <span className="text-xs text-gray-600 dark:text-gray-500">{detail.lots.length} lots</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => exportRun(detail)}
                          className="text-xs px-3 py-1 bg-gray-100 dark:bg-[#2C2C2E] hover:bg-gray-200 dark:hover:bg-[#3A3A3C] border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded transition-colors">
                          ⬇ Export Excel
                        </button>
                        <button onClick={() => applyToAuction(run.id)} disabled={!!applying}
                          className="text-xs px-3 py-1 bg-[#C8A96E] hover:bg-[#d4b87a] disabled:opacity-50 text-black font-semibold rounded transition-colors">
                          {applying === "all" ? "Applying…" : "✓ Apply All to Auction"}
                        </button>
                      </div>
                    </div>

                    {applyResult && expanded === run.id && (
                      <div className="px-4 py-2 bg-green-950 border-t border-green-800 text-xs text-green-300 flex flex-wrap items-center gap-3">
                        {applyResult.updated > 0 && <span>✓ {applyResult.updated} lot{applyResult.updated !== 1 ? "s" : ""} updated</span>}
                        {applyResult.created > 0 && <span>✓ {applyResult.created} lot{applyResult.created !== 1 ? "s" : ""} created</span>}
                        {applyResult.updated === 0 && applyResult.created === 0 && <span>No matching lots found in auction</span>}
                        <a href={`/tools/cataloguing/auctions/${applyResult.auctionId}`} target="_blank" rel="noreferrer"
                          className="ml-auto text-blue-400 hover:text-blue-300 underline">
                          Open in Cataloguing →
                        </a>
                      </div>
                    )}

                    {applyError && expanded === run.id && (
                      <div className="px-4 py-2 bg-red-950 border-t border-red-800 text-xs text-red-300">
                        ✕ {applyError}
                      </div>
                    )}

                    <div className="max-h-96 overflow-y-auto">
                      {detail.lots.map(l => (
                        <div key={l.id} className="flex items-start gap-3 px-4 py-2.5 border-t border-gray-200 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-[#2C2C2E] group">
                          <span className="text-xs font-mono text-[#C8A96E] flex-shrink-0 w-20">{l.lot}</span>
                          <span className="text-xs text-gray-600 dark:text-gray-300 flex-1 line-clamp-2">{l.description}</span>
                          <span className="text-xs text-gray-600 dark:text-gray-500 flex-shrink-0 w-20 text-right">{l.estimate}</span>
                          <button
                            onClick={() => applyOneLot(run.id, l.id)}
                            disabled={!!applying}
                            className="text-xs px-2 py-0.5 rounded bg-[#C8A96E]/20 border border-[#C8A96E]/40 text-[#C8A96E] hover:bg-[#C8A96E]/40 disabled:opacity-40 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                            {applying === l.id ? "…" : "Apply"}
                          </button>
                          <button onClick={() => deleteLot(l.id)}
                            className="text-xs text-red-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">✕</button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── KP Check Runs Tab ────────────────────────────────────────────────────────

function KPRunsTab() {
  const [runs,     setRuns]     = useState<RunSummary[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [detail,   setDetail]   = useState<RunDetail | null>(null)
  const [search,   setSearch]   = useState("")
  const [loading,  setLoading]  = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [revised,  setRevised]  = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [applying, setApplying] = useState<string | null>(null)

  useEffect(() => { loadRuns() }, [])

  async function loadRuns() {
    setLoading(true)
    const r = await fetch("/api/auction-ai/runs")
    const j = await r.json()
    setRuns((j as RunSummary[]).filter(x => x.preset === "Key Points Check"))
    setLoading(false)
  }

  async function expand(run: RunSummary) {
    if (expanded === run.id) { setExpanded(null); setDetail(null); setRevised({}); setSelected({}); return }
    setExpanded(run.id)
    const r = await fetch(`/api/auction-ai/runs/${run.id}`)
    const d = await r.json() as RunDetail
    setDetail(d)
    const rev: Record<string, string>  = {}
    const sel: Record<string, boolean> = {}
    d.lots.forEach(l => { rev[l.id] = l.description; sel[l.id] = false })
    setRevised(rev)
    setSelected(sel)
  }

  async function deleteRun(id: string) {
    if (!confirm("Delete this KP run and all its lots?")) return
    setDeleting(id)
    await fetch("/api/auction-ai/runs", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) })
    setRuns(r => r.filter(x => x.id !== id))
    if (expanded === id) { setExpanded(null); setDetail(null) }
    setDeleting(null)
  }

  async function deleteLot(lotId: string) {
    await fetch(`/api/auction-ai/runs/${lotId}`, { method: "DELETE" })
    setDetail(d => d ? { ...d, lots: d.lots.filter(l => l.id !== lotId) } : d)
    setRuns(r => r.map(x => x.id === detail?.id ? { ...x, _count: { lots: x._count.lots - 1 } } : x))
  }

  async function applyLot(lotId: string, lotLabel: string, runCode: string) {
    const desc = revised[lotId]
    if (!desc) return
    setApplying(lotId)
    try {
      const code    = runCode.replace(/_KP$/i, "")
      const res     = await fetch(`/api/auction-ai/catalogue-lots?code=${encodeURIComponent(code)}`)
      if (!res.ok) throw new Error("Could not fetch catalogue lots")
      const data    = await res.json()
      const match   = data.lots?.find((l: { receiptUniqueId?: string; barcode?: string; id: string }) =>
        (l.receiptUniqueId && l.receiptUniqueId === lotLabel) || (l.barcode && l.barcode === lotLabel)
      )
      if (!match) throw new Error(`Lot ${lotLabel} not found in catalogue`)
      const runLot  = detail?.lots.find(l => l.id === lotId)
      const { low, high } = parseEstimate(runLot?.estimate ?? "")
      await applyAiDescriptionOne(data.auctionId, { id: match.id, description: desc, aiEstimateLow: low || null, aiEstimateHigh: high || null })
      showToast(`✓ Lot ${lotLabel} saved to catalogue`, "ok")
    } catch (e: any) {
      showError("Failed to apply to catalogue", e.message)
    } finally {
      setApplying(null)
    }
  }

  async function applySelected(runCode: string) {
    const toApply = detail?.lots.filter(l => selected[l.id]) ?? []
    if (!toApply.length) return
    setApplying("bulk")
    let ok = 0, fail = 0
    try {
      const code  = runCode.replace(/_KP$/i, "")
      const res   = await fetch(`/api/auction-ai/catalogue-lots?code=${encodeURIComponent(code)}`)
      if (!res.ok) throw new Error("Could not fetch catalogue lots")
      const data  = await res.json()
      for (const l of toApply) {
        const match = data.lots?.find((x: { receiptUniqueId?: string; barcode?: string; id: string }) =>
          (x.receiptUniqueId && x.receiptUniqueId === l.lot) || (x.barcode && x.barcode === l.lot)
        )
        if (!match) { fail++; continue }
        try {
          const { low, high } = parseEstimate(l.estimate ?? "")
          await applyAiDescriptionOne(data.auctionId, { id: match.id, description: revised[l.id] ?? l.description, aiEstimateLow: low || null, aiEstimateHigh: high || null })
          ok++
        } catch { fail++ }
      }
      if (fail) showError("Some lots failed to apply", `${ok} saved, ${fail} failed — check lot numbers match the catalogue.`)
      else showToast(`✓ ${ok} lots saved to catalogue`, "ok")
    } catch (e: any) {
      showError("Failed to apply lots", e.message)
    } finally {
      setApplying(null)
    }
  }

  const filtered    = runs.filter(r => r.code.toLowerCase().replace(/_kp$/i, "").includes(search.toLowerCase()))
  const allSelected = detail ? detail.lots.every(l => selected[l.id]) : false
  const selCount    = detail ? detail.lots.filter(l => selected[l.id]).length : 0

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">KP Check Runs</h2>
        <button onClick={loadRuns} className="text-xs text-gray-600 dark:text-gray-500 hover:text-gray-300 transition-colors">↻ Refresh</button>
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search auction code…"
        className="w-full bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[#C8A96E] placeholder:text-gray-600" />

      {loading && <p className="text-gray-600 dark:text-gray-500 text-sm">Loading…</p>}
      {!loading && filtered.length === 0 && (
        <p className="text-gray-600 text-sm">No KP Check runs saved yet. Run a Key Points Check and click Save run.</p>
      )}

      <div className="flex flex-col gap-2 overflow-y-auto flex-1">
        {filtered.map(run => {
          const isOpen = expanded === run.id && detail?.id === run.id
          return (
            <div key={run.id} className="bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg overflow-hidden">
              {/* header */}
              <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-200 dark:hover:bg-[#3A3A3C] transition-colors" onClick={() => expand(run)}>
                <span className="text-[#C8A96E] font-bold font-mono text-sm flex-1">{run.code.replace(/_KP$/i, "")}</span>
                <span className="text-xs text-gray-600 dark:text-gray-500">{run._count.lots} lots</span>
                <span className="text-xs text-gray-600">{new Date(run.updatedAt).toLocaleDateString("en-GB")}</span>
                <button onClick={e => { e.stopPropagation(); deleteRun(run.id) }} disabled={deleting === run.id}
                  className="text-xs text-red-500 hover:text-red-400 transition-colors ml-1 flex-shrink-0">
                  {deleting === run.id ? "…" : "Delete"}
                </button>
                <span className="text-gray-600 text-xs">{isOpen ? "▲" : "▼"}</span>
              </div>

              {/* expanded */}
              {isOpen && (
                <div className="border-t border-gray-300 dark:border-gray-700">
                  {/* toolbar */}
                  <div className="flex items-center gap-3 px-4 py-2 bg-white dark:bg-[#1C1C1E] flex-wrap">
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input type="checkbox" checked={allSelected}
                        onChange={() => setSelected(Object.fromEntries(detail.lots.map(l => [l.id, !allSelected])))}
                        className="w-3.5 h-3.5 accent-[#C8A96E]" />
                      <span className="text-xs text-gray-600 dark:text-gray-400">Select all</span>
                    </label>
                    <span className="text-xs text-gray-600">{detail.lots.length} lots</span>
                    <div className="flex-1" />
                    <button onClick={() => applySelected(run.code)}
                      disabled={selCount === 0 || applying === "bulk"}
                      className="text-xs px-3 py-1 bg-[#C8A96E] hover:bg-[#d4b87a] disabled:opacity-40 text-black font-semibold rounded transition-colors">
                      {applying === "bulk" ? "Saving…" : `Apply ${selCount > 0 ? selCount + " " : ""}selected`}
                    </button>
                  </div>

                  {/* lot cards */}
                  <div className="flex flex-col gap-3 p-4">
                    {detail.lots.map(l => (
                      <div key={l.id} className="rounded-lg overflow-hidden border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-[#2C2C2E]">
                        {/* header */}
                        <div className="flex items-center gap-3 px-3 py-2 border-b border-gray-300 dark:border-gray-700">
                          <input type="checkbox" checked={!!selected[l.id]}
                            onChange={e => setSelected(s => ({ ...s, [l.id]: e.target.checked }))}
                            className="w-3.5 h-3.5 rounded accent-[#C8A96E] flex-shrink-0" />
                          <span className="text-xs font-mono font-bold text-[#C8A96E]">Lot {l.lot}</span>
                          <div className="flex items-center gap-2 ml-auto">
                            <button onClick={() => applyLot(l.id, l.lot, run.code)}
                              disabled={applying === l.id || applying === "bulk"}
                              className="text-xs bg-[#C8A96E] hover:bg-[#b8944f] disabled:opacity-40 text-black font-semibold px-3 py-0.5 rounded transition-colors">
                              {applying === l.id ? "Saving…" : "Apply"}
                            </button>
                            <button onClick={() => navigator.clipboard.writeText(revised[l.id] ?? l.description)}
                              className="text-[10px] text-gray-600 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white border border-gray-300 dark:border-gray-700 hover:border-gray-500 px-2 py-0.5 rounded transition-colors">
                              Copy
                            </button>
                            <button onClick={() => deleteLot(l.id)}
                              className="text-[10px] text-red-700 hover:text-red-400 border border-red-900/40 hover:border-red-700/40 px-2 py-0.5 rounded transition-colors">✕</button>
                          </div>
                        </div>

                        {/* missing / added summary */}
                        {(l.missing || l.added) && (
                          <div className="flex gap-4 px-3 py-2 border-b border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E]">
                            {l.missing && (
                              <div className="flex-1">
                                <p className="text-[10px] text-red-400 uppercase tracking-wider mb-0.5">Was missing</p>
                                <p className="text-xs text-red-300">{l.missing}</p>
                              </div>
                            )}
                            {l.added && (
                              <div className="flex-1">
                                <p className="text-[10px] text-[#C8A96E] uppercase tracking-wider mb-0.5">What changed</p>
                                <p className="text-xs text-[#C8A96E]">{l.added}</p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* three columns: key points | before | after */}
                        <div className="grid grid-cols-3 divide-x divide-gray-300 dark:divide-gray-700">
                          <div className="px-3 py-2">
                            <p className="text-[10px] text-gray-600 dark:text-gray-500 uppercase tracking-wider mb-1.5">Key Points</p>
                            <pre className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">{l.keyPoints ?? "—"}</pre>
                          </div>
                          <div className="px-3 py-2">
                            <p className="text-[10px] text-gray-600 dark:text-gray-500 uppercase tracking-wider mb-1.5">Before</p>
                            <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-wrap">{l.originalDescription ?? "—"}</p>
                          </div>
                          <div className="px-3 py-2">
                            <p className="text-[10px] text-[#C8A96E] uppercase tracking-wider mb-1.5">
                              After (fixed) <span className="text-gray-600 normal-case ml-1">· editable</span>
                            </p>
                            <textarea
                              value={revised[l.id] ?? l.description}
                              onChange={e => setRevised(s => ({ ...s, [l.id]: e.target.value }))}
                              rows={8}
                              className="w-full text-xs text-gray-700 dark:text-gray-200 bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded p-2 leading-relaxed resize-y focus:outline-none focus:border-[#C8A96E]"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Instructions Tab ─────────────────────────────────────────────────────────

type CustomPreset = { key: string; instruction: string }

function InstructionsTab() {
  const [presets,  setPresets]  = useState<CustomPreset[]>([])
  const [loading,  setLoading]  = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [mode,     setMode]     = useState<"view" | "edit" | "new">("view")
  const [newName,  setNewName]  = useState("")
  const [draftText,setDraftText]= useState("")
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  const builtInKeys = Object.keys(PRESETS).filter(k => k !== "Custom (paste my own)")

  async function load() {
    setLoading(true)
    try {
      const data: Record<string, string> = await fetch("/api/auction-ai/presets").then(r => r.json())
      const dbKeys = new Set(Object.keys(data))

      // Seed any built-ins not yet saved to DB
      const toSeed = builtInKeys.filter(k => !dbKeys.has(k))
      await Promise.all(toSeed.map(k =>
        fetch("/api/auction-ai/presets", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: k, instruction: PRESETS[k] }),
        })
      ))

      // Build unified list: built-in order first, then any DB-only extras
      const merged: CustomPreset[] = [
        ...builtInKeys.map(k => ({ key: k, instruction: data[k] ?? PRESETS[k] })),
        ...Object.entries(data).filter(([k]) => !builtInKeys.includes(k)).map(([key, instruction]) => ({ key, instruction })),
      ]
      setPresets(merged)
    } catch { setError("Failed to load") }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openNew() {
    setSelected(null); setNewName(""); setDraftText(""); setMode("new"); setError(null)
  }

  function openView(key: string) {
    const p = presets.find(x => x.key === key)
    setSelected(key); setDraftText(p?.instruction ?? ""); setMode("view"); setError(null)
  }

  async function saveNew() {
    const name = newName.trim()
    if (!name) return
    if (presets.some(p => p.key === name)) { setError("Name already exists"); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch("/api/auction-ai/presets", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: name, instruction: draftText }),
      })
      if (!res.ok) throw new Error("Save failed")
      setPresets(p => [...p, { key: name, instruction: draftText }])
      setSelected(name); setMode("view"); setNewName("")
    } catch (e: any) { setError(e.message) }
    setSaving(false)
  }

  async function saveEdit() {
    if (!selected) return
    setSaving(true); setError(null)
    try {
      const res = await fetch("/api/auction-ai/presets", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: selected, instruction: draftText }),
      })
      if (!res.ok) throw new Error("Save failed")
      setPresets(p => p.map(x => x.key === selected ? { ...x, instruction: draftText } : x))
      setMode("view")
    } catch (e: any) { setError(e.message) }
    setSaving(false)
  }

  async function deletePreset(key: string) {
    if (!confirm(`Delete "${key}"?`)) return
    setSaving(true)
    try {
      const res = await fetch("/api/auction-ai/presets", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      })
      if (!res.ok) throw new Error("Delete failed")
      setPresets(p => p.filter(x => x.key !== key))
      setSelected(null); setMode("view")
    } catch (e: any) { setError(e.message) }
    setSaving(false)
  }

  const selectedPreset = presets.find(p => p.key === selected)

  return (
    <div className="flex gap-5 h-full" style={{ minHeight: 0 }}>

      {/* ── Left list ── */}
      <div className="w-64 flex-shrink-0 flex flex-col gap-2">
        <button onClick={openNew}
          className="w-full py-2 bg-[#C8A96E] hover:bg-[#d4b87a] text-black text-sm font-bold rounded transition-colors">
          + New Instruction
        </button>

        {loading ? (
          <p className="text-gray-600 dark:text-gray-500 text-xs px-1 mt-2">Loading…</p>
        ) : (
          <div className="space-y-0.5 mt-1">
            {presets.map(p => (
              <button key={p.key} onClick={() => openView(p.key)}
                className={`w-full text-left px-3 py-2 rounded text-sm transition-colors truncate ${
                  selected === p.key
                    ? "bg-[#C8A96E]/15 text-[#C8A96E] border border-[#C8A96E]/30"
                    : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#2C2C2E]"
                }`}>
                {p.key}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 bg-gray-50 dark:bg-[#141416] border border-gray-200 dark:border-gray-800 rounded-xl flex flex-col overflow-hidden">

        {/* New form */}
        {mode === "new" && (
          <div className="flex flex-col h-full p-5 gap-4">
            <h3 className="text-sm font-bold text-[#C8A96E]">New Instruction</h3>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Name (e.g. My Custom Preset)"
              className="bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[#C8A96E]"
            />
            <textarea
              value={draftText}
              onChange={e => setDraftText(e.target.value)}
              placeholder="Paste your system instruction here…"
              className="flex-1 bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[#C8A96E] resize-none font-mono"
            />
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setMode("view"); setSelected(null); setError(null) }}
                className="px-4 py-2 bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm rounded hover:border-gray-500 transition-colors">
                Cancel
              </button>
              <button onClick={saveNew} disabled={saving || !newName.trim()}
                className="px-5 py-2 bg-[#C8A96E] hover:bg-[#d4b87a] text-black text-sm font-bold rounded transition-colors disabled:opacity-40">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}

        {/* Edit form */}
        {mode === "edit" && selected && (
          <div className="flex flex-col h-full p-5 gap-4">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white truncate">{selected}</h3>
            <textarea
              value={draftText}
              onChange={e => setDraftText(e.target.value)}
              className="flex-1 bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[#C8A96E] resize-none font-mono"
            />
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setMode("view")}
                className="px-4 py-2 bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm rounded hover:border-gray-500 transition-colors">
                Cancel
              </button>
              <button onClick={saveEdit} disabled={saving}
                className="px-5 py-2 bg-[#C8A96E] hover:bg-[#d4b87a] text-black text-sm font-bold rounded transition-colors disabled:opacity-40">
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        )}

        {/* View */}
        {mode === "view" && selected && (
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white truncate">{selected}</h3>
              <div className="flex gap-2 flex-shrink-0 ml-3">
                <button onClick={() => { setDraftText(selectedPreset?.instruction ?? ""); setMode("edit"); setError(null) }}
                  className="px-4 py-1.5 text-sm border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 rounded hover:border-[#C8A96E] hover:text-[#C8A96E] transition-colors">
                  ✎ Edit
                </button>
                <button onClick={() => deletePreset(selected)} disabled={saving}
                  className="px-4 py-1.5 text-sm border border-red-900/60 text-red-500 rounded hover:bg-red-900/20 transition-colors disabled:opacity-40">
                  Delete
                </button>
              </div>
            </div>
            <pre className="flex-1 px-5 py-4 text-xs text-gray-600 dark:text-gray-400 font-mono whitespace-pre-wrap overflow-auto">
              {selectedPreset?.instruction ?? ""}
            </pre>
          </div>
        )}

        {/* Empty state */}
        {mode === "view" && !selected && (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <p className="text-gray-600 text-sm">Select an instruction from the list to view it,<br/>or create a new one.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Key Points Check Tab ────────────────────────────────────────────────────

const KP_SYSTEM_PROMPT = `You are a strict quality checker for auction house lot descriptions.

Your task — follow these steps exactly:
1. Read every key point the cataloguer recorded one by one.
2. For each key point, decide: is this specific fact clearly and directly stated as its own point in the existing description?
3. If ALL key points are present: return the description word-for-word unchanged.
4. If ANY key point is missing: insert that fact naturally into the existing description with the minimum change necessary — do NOT rewrite, restructure, condense or remove any existing content.

Critical rules:
- Every single key point MUST appear in the final description — missing even one is a failure.
- NEVER remove or shorten any existing detail from the description.
- NEVER rewrite from scratch — only insert what is missing.
- NEVER invent facts beyond what appears in the key points or the original description.
- The final description must be at least as long as the original.
- Partial word matches do NOT count. A key point is satisfied only if its specific meaning is explicitly stated. When in doubt, insert the key point — over-inclusion is always preferred over under-inclusion.
- Short key points (3 words or fewer) are always specific condition or completeness notes and must appear explicitly.

Responds as JSON: { "description": "...", "missing": "key points that were absent", "added": "one sentence on what was inserted" }`

function HowItWorksPanel() {
  const [open,        setOpen]        = useState(false)
  const [showPrompt,  setShowPrompt]  = useState(false)

  return (
    <div className="bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-[#1a1a1e] transition-colors">
        <span className="text-sm font-medium text-gray-600 dark:text-gray-300">ℹ How does this work?</span>
        <span className="text-gray-600 text-xs">{open ? "▲ Hide" : "▼ Show"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-300 dark:border-gray-700">
          <ol className="mt-3 space-y-2 text-sm text-gray-600 dark:text-gray-400 list-decimal list-inside">
            <li>You enter an auction code and click <span className="text-gray-900 dark:text-white font-medium">Load</span> — it pulls every lot that has both a cataloguer key points entry and a saved AI description from a previous Batch Run.</li>
            <li>You click <span className="text-gray-900 dark:text-white font-medium">Run Key Points Check</span> — each lot is sent to Gemini one at a time with its key points and AI description.</li>
            <li>Gemini reads both and checks whether every key point is mentioned in the description. If they're all there, it returns the description unchanged. If anything is missing or wrong, it rewrites just enough to include it.</li>
            <li>Lots marked <span className="text-[#C8A96E] font-medium">⚑ Fixed</span> had something missing — expand them to see what changed. Lots marked <span className="text-green-400 font-medium">✓ All included</span> were fine.</li>
            <li>Use <span className="text-gray-900 dark:text-white font-medium">Copy all descriptions</span> to copy everything out at once.</li>
          </ol>

          <div>
            <button onClick={() => setShowPrompt(p => !p)}
              className="text-xs text-gray-600 dark:text-gray-500 hover:text-gray-300 transition-colors">
              {showPrompt ? "▲ Hide system prompt" : "▼ Show exact instructions sent to Gemini"}
            </button>
            {showPrompt && (
              <pre className="mt-2 text-xs text-gray-600 dark:text-gray-400 bg-white dark:bg-[#1C1C1E] rounded-lg p-3 whitespace-pre-wrap leading-relaxed font-mono">
                {KP_SYSTEM_PROMPT}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

type KPLot = {
  id: string
  label: string
  keyPoints: string
  description: string
  revised?: string
  changed?: boolean
  missing?: string
  added?: string
  found?: string
  status?: "idle" | "checking" | "ok" | "fixed" | "error"
  accepted?: boolean
  selected?: boolean
}

function KeyPointsCheckTab({ model: globalModel, fallbackModel, onModelChange }: { model: string; fallbackModel: string; onModelChange: (m: string) => void }) {
  const [code,         setCode]         = useState("")
  const [auctionId,    setAuctionId]    = useState<string | null>(null)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [lots,         setLots]         = useState<KPLot[]>([])
  const [checking,     setChecking]     = useState(false)
  const [accepting,    setAccepting]    = useState(false)
  const [progress,     setProgress]     = useState<{ done: number; total: number; current?: string } | null>(null)
  const [expandedLot,  setExpandedLot]  = useState<string | null>(null)
  const [localModel,   setLocalModel]   = useState(globalModel)

  // Keep localModel in sync with sidebar dropdown changes
  useEffect(() => { setLocalModel(globalModel) }, [globalModel])
  const [modelList,    setModelList]    = useState<string[]>([globalModel])
  const [modelStatus,  setModelStatus]  = useState<Record<string, { ok: boolean; ms: number; error?: string } | "testing">>({})
  const [testingAll,   setTestingAll]   = useState(false)
  const [log,          setLog]          = useState<string[]>([])
  const [paused,       setPaused]       = useState(false)
  const [showResults,  setShowResults]  = useState(false)
  const [auctionList,  setAuctionList]  = useState<{ code: string; name: string; auctionDate: string | null }[]>([])
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const logRef      = useRef<HTMLDivElement>(null)
  const cancelRef   = useRef(false)
  const pauseRef    = useRef(false)
  const abortRef    = useRef<AbortController | null>(null)
  const codeInputRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch("/api/auction-ai/models")
      .then(r => r.json())
      .then(j => { if (j.models?.length) setModelList(j.models) })
      .catch(() => {})
    fetch("/api/auction-ai/auctions")
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setAuctionList(data) })
      .catch(() => {})
  }, [])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (codeInputRef.current && !codeInputRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  function addLog(msg: string) {
    const ts = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    setLog(l => [...l, `[${ts}]  ${msg}`])
    setTimeout(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }), 50)
  }

  async function testAllModels() {
    setTestingAll(true)
    const initial: Record<string, "testing"> = {}
    modelList.forEach(m => { initial[m] = "testing" })
    setModelStatus(initial)
    // Sequential with a 1s gap to avoid hammering the rate limit
    for (const m of modelList) {
      try {
        const res  = await fetch("/api/auction-ai/model-test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: m }) })
        const data = await res.json()
        setModelStatus(prev => ({ ...prev, [m]: data }))
      } catch (e: any) {
        setModelStatus(prev => ({ ...prev, [m]: { ok: false, ms: 0, error: e.message } }))
      }
      await new Promise(r => setTimeout(r, 1000))
    }
    setTestingAll(false)
  }

  function handleStop() {
    cancelRef.current = true
    pauseRef.current  = false
    setPaused(false)
    if (abortRef.current) {
      addLog("⛔ Stopped — showing results so far")
      abortRef.current.abort()
      abortRef.current = null
    }
  }

  function handlePause() {
    pauseRef.current = true
    setPaused(true)
    addLog("⏸ Paused — finishing current lot…")
  }

  function handleResume() {
    pauseRef.current = false
    setPaused(false)
    addLog("▶ Resumed")
  }

  async function acceptLot(lot: KPLot) {
    if (!auctionId || !lot.revised) return
    setLots(prev => prev.map(l => l.id === lot.id ? { ...l, accepted: true } : l))
    try {
      await applyAiDescriptionOne(auctionId, {
        id:          lot.id,
        description: lot.revised,
      })
    } catch (e: any) {
      setLots(prev => prev.map(l => l.id === lot.id ? { ...l, accepted: false } : l))
      setError(`Failed to save Lot ${lot.label}: ${e.message}`)
    }
  }

  async function acceptAll() {
    const toAccept = lots.filter(l => l.status === "fixed" && l.selected && !l.accepted && l.revised)
    if (!auctionId || toAccept.length === 0) return
    setAccepting(true)
    for (const lot of toAccept) {
      await acceptLot(lot)
    }
    setAccepting(false)
  }

  function toggleSelected(id: string) {
    setLots(prev => prev.map(l => l.id === id ? { ...l, selected: !l.selected } : l))
  }

  function toggleSelectAll() {
    const fixedLots = lots.filter(l => l.status === "fixed" && !l.accepted)
    const allSelected = fixedLots.every(l => l.selected)
    setLots(prev => prev.map(l => l.status === "fixed" && !l.accepted ? { ...l, selected: !allSelected } : l))
  }

  function updateRevised(id: string, text: string) {
    setLots(prev => prev.map(l => l.id === id ? { ...l, revised: text } : l))
  }

  async function handleLoad() {
    if (!code.trim()) return
    setLoading(true); setError(null); setLots([]); setAuctionId(null)
    try {
      // Load catalogue lots — key points + existing description directly from catalogue
      const catRes = await fetch(`/api/auction-ai/catalogue-lots?code=${encodeURIComponent(code.trim().toUpperCase())}`)
      if (!catRes.ok) throw new Error((await catRes.json()).error ?? "Catalogue not found")
      const catData = await catRes.json()
      setAuctionId(catData.auctionId ?? null)

      // Build lot list: needs both a key points entry and a description in the catalogue
      const merged: KPLot[] = catData.lots
        .filter((l: any) => l.keyPoints?.trim() && l.description?.trim())
        .map((l: any) => ({
          id:          l.id,
          label:       l.barcode || l.receiptUniqueId || l.id,
          keyPoints:   l.keyPoints,
          description: l.description,
          status:      "idle" as const,
        }))

      if (merged.length === 0) {
        const total    = catData.lots.length
        const hasKP    = catData.lots.filter((l: any) => l.keyPoints?.trim()).length
        const hasDesc  = catData.lots.filter((l: any) => l.description?.trim()).length
        throw new Error(
          total === 0
            ? `No lots found for "${code.toUpperCase()}".`
            : `No lots have both key points and a description yet. ${hasKP} lot${hasKP !== 1 ? "s" : ""} have key points, ${hasDesc} have a description. Add descriptions via the Batch Run tab or the cataloguing page first.`
        )
      }

      setLots(merged)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function runCheck(forceAll = false) {
    // Skip already-done lots unless forceAll is set (re-run all)
    const toCheck = lots.filter(l =>
      l.keyPoints && l.description &&
      (forceAll || (l.status !== "ok" && l.status !== "fixed"))
    )
    if (!toCheck.length || checking) return
    cancelRef.current = false
    pauseRef.current  = false
    setPaused(false)
    setShowResults(false)
    setChecking(true)
    setLog([])
    const resuming = !forceAll && lots.some(l => l.status === "ok" || l.status === "fixed")
    addLog(`── ${resuming ? "Resuming" : "Starting"} check: ${toCheck.length} lot${toCheck.length !== 1 ? "s" : ""} · model: ${localModel}`)

    // Reset only the lots being checked
    const toCheckIds = new Set(toCheck.map(l => l.id))
    setLots(prev => prev.map(l =>
      toCheckIds.has(l.id) ? { ...l, status: "idle" as const, revised: undefined, changed: undefined } : l
    ))

    let done = 0
    const runCode = code.trim().toUpperCase() + "_KP"

    try {
      for (let i = 0; i < toCheck.length; i++) {
        if (cancelRef.current) break
        const lot = toCheck[i]

        setLots(prev => prev.map(l => l.id === lot.id ? { ...l, status: "checking" as const } : l))
        addLog(`  · ${done + 1}/${toCheck.length} Lot ${lot.label} — sending to Gemini…`)
        setProgress({ done, total: toCheck.length, current: lot.label })

        // Retry loop — same rules as batch run
        let lastError = ""
        let succeeded = false
        let attempt   = 0

        while (!cancelRef.current) {
          if (attempt > 0) {
            const isRateLimit = lastError.startsWith("RATE_LIMITED:")
            const wait = isRateLimit
              ? Math.min(60000 * Math.pow(2, attempt - 1), 1800000)
              : Math.min(attempt * 12000, 30000)
            addLog(`↺ ${lot.label} — ${isRateLimit ? "rate limited, waiting" : "retrying in"} ${wait / 1000}s (attempt ${attempt + 1})…`)
            await new Promise(r => setTimeout(r, wait))
            if (cancelRef.current) break
          }
          attempt++

          try {
            const modelToUse = (attempt % 2 === 0 && fallbackModel) ? fallbackModel : localModel
            if (attempt > 1) addLog(`  ↳ ${lot.label} trying ${modelToUse}`)
            const t0  = Date.now()
            const res = await fetch("/api/auction-ai/key-points-check", {
              method:  "POST",
              headers: { "Content-Type": "application/json" },
              body:    JSON.stringify({ label: lot.label, keyPoints: lot.keyPoints, description: lot.description, model: modelToUse }),
            })
            const json = await res.json()
            if (json.error) throw new Error(json.error)

            const { revised, changed, missing, added, found } = json
            const ms      = Date.now() - t0
            const outcome = changed ? "⚑ fixed" : "✓ all included"
            addLog(`  ${outcome} — Lot ${lot.label} (${(ms / 1000).toFixed(1)}s)${missing ? ` · missing: ${missing}` : ""}`)

            setLots(prev => prev.map(l =>
              l.id === lot.id
                ? { ...l, revised, changed, missing, added, found, status: changed ? "fixed" : "ok", selected: changed ? true : undefined }
                : l
            ))

            // Auto-save to Saved Runs
            fetch("/api/auction-ai/runs", {
              method:  "POST",
              headers: { "Content-Type": "application/json" },
              body:    JSON.stringify({
                code:                runCode,
                preset:              "Key Points Check",
                lot:                 lot.label,
                description:         revised ?? lot.description,
                estimate:            "",
                originalDescription: lot.description,
                keyPoints:           lot.keyPoints,
                missing:             missing ?? null,
                added:               added   ?? null,
              }),
            }).catch(() => {/* silent — don't break the run for a save failure */})

            succeeded = true
            break
          } catch (e: any) {
            lastError = e.message ?? String(e)
            if (lastError.startsWith("BLOCKED:")) {
              addLog(`✗ ${lot.label} — blocked by Gemini, skipping: ${lastError}`)
              setLots(prev => prev.map(l => l.id === lot.id ? { ...l, status: "error" as const } : l))
              break
            }
          }
        }

        if (!succeeded && !cancelRef.current) {
          addLog(`✗ ${lot.label} — FAILED after ${attempt} attempt${attempt !== 1 ? "s" : ""}: ${lastError}`)
          setLots(prev => prev.map(l => l.id === lot.id ? { ...l, status: "error" as const } : l))
        }

        done++
        setProgress({ done, total: toCheck.length })

        // Pause support
        if (pauseRef.current) {
          addLog(`⏸ Paused after ${lot.label} — click Resume to continue`)
          while (pauseRef.current && !cancelRef.current) {
            await new Promise(r => setTimeout(r, 500))
          }
          if (!cancelRef.current) addLog("▶ Resumed")
        }
      }

      if (!cancelRef.current) addLog("── Complete")
    } catch (e: any) {
      if (!cancelRef.current) { addLog(`✗ Unexpected error: ${e.message}`); setError(e.message) }
    } finally {
      setChecking(false)
      setProgress(null)
      setShowResults(true)
    }
  }

  function copyAll() {
    const text = lots
      .filter(l => l.description)
      .map(l => `Lot ${l.label}:\n${l.revised ?? l.description}`)
      .join("\n\n---\n\n")
    navigator.clipboard.writeText(text)
  }

  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState("")

  async function saveRun() {
    const checked = lots.filter(l => (l.status === "ok" || l.status === "fixed") && l.description)
    if (!checked.length || !code.trim()) return
    setSaving(true)
    setSavedMsg("")
    const runCode = code.trim().toUpperCase() + "_KP"
    let failed = 0
    await Promise.all(checked.map(l =>
      fetch("/api/auction-ai/runs", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          code:                runCode,
          preset:              "Key Points Check",
          lot:                 l.label,
          description:         l.revised ?? l.description,
          estimate:            "",
          originalDescription: l.description,
          keyPoints:           l.keyPoints,
          missing:             l.missing  ?? null,
          added:               l.added    ?? null,
        }),
      }).then(async r => {
        if (!r.ok) {
          failed++
          const txt = await r.text().catch(() => "")
          let msg = ""
          try { msg = JSON.parse(txt).error ?? "" } catch { msg = txt }
          showError(`Save failed — Lot ${l.label}`, `HTTP ${r.status}`, msg || "No detail returned from server")
        }
      }).catch(e => { failed++; showError(`Save error — Lot ${l.label}`, e.message) })
    ))
    setSaving(false)
    setSavedMsg(failed ? `⚠ ${checked.length - failed} saved, ${failed} failed` : `✓ ${checked.length} lots saved`)
    setTimeout(() => setSavedMsg(""), 3000)
  }

  const checkedCount   = lots.filter(l => l.status === "ok" || l.status === "fixed").length
  const fixedCount     = lots.filter(l => l.status === "fixed").length
  const remainingCount = lots.filter(l => l.keyPoints && l.description && l.status !== "ok" && l.status !== "fixed").length
  const inp = "w-full bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-600 focus:outline-none focus:border-[#C8A96E]"

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">Key Points Checker</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Loads your cataloguer key points alongside the AI-generated descriptions and runs a second AI pass to
          verify every key point is included — fixing any that are missing.
        </p>
      </div>

      {/* How it works */}
      <HowItWorksPanel />

      {/* Model selector */}
      <div className="bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider">Model</p>
          <button onClick={testAllModels} disabled={testingAll}
            className="text-xs text-[#C8A96E] hover:text-[#b8944f] disabled:opacity-50 transition-colors">
            {testingAll ? "Testing…" : "⚡ Test all models"}
          </button>
        </div>
        <div className="border border-gray-300 dark:border-gray-700 rounded-lg overflow-hidden">
          {modelList.map(m => {
            const status = modelStatus[m]
            const isSelected = localModel === m
            return (
              <button key={m} onClick={() => { setLocalModel(m); onModelChange(m) }}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors border-b border-gray-200 dark:border-gray-800 last:border-0 ${isSelected ? "bg-[#C8A96E]/10" : "hover:bg-gray-50 dark:hover:bg-[#1a1a1e]"}`}>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isSelected ? "bg-[#C8A96E]" : "bg-gray-700"}`} />
                <span className={`text-sm flex-1 font-mono ${isSelected ? "text-[#C8A96E]" : "text-gray-600 dark:text-gray-400"}`}>{m}</span>
                {status === "testing" && <span className="text-xs text-gray-600 dark:text-gray-500 animate-pulse">testing…</span>}
                {status && status !== "testing" && (
                  status.ok
                    ? <span className={`text-xs font-medium ${status.ms < 5000 ? "text-green-400" : status.ms < 12000 ? "text-yellow-400" : "text-orange-400"}`}>✓ {(status.ms / 1000).toFixed(1)}s</span>
                    : <span className="text-xs text-red-400 truncate max-w-[200px]" title={status.error}>✗ {status.error?.match(/\[(\d{3}[^\]]*)\]/)?.[1] ?? "error"}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Load */}
      <div className="bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-xl p-4 space-y-3">
        <p className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider">Auction</p>
        <div className="flex gap-2">
          <div ref={codeInputRef} className="relative flex-1">
            <input
              value={code}
              onChange={e => { setCode(e.target.value.toUpperCase()); setDropdownOpen(true) }}
              onFocus={() => setDropdownOpen(true)}
              onKeyDown={e => {
                if (e.key === "Enter") { setDropdownOpen(false); handleLoad() }
                if (e.key === "Escape") setDropdownOpen(false)
              }}
              placeholder="Type or select an auction…"
              className={inp}
              autoComplete="off"
            />
            {dropdownOpen && (() => {
              const filtered = auctionList.filter(a =>
                !code.trim() || a.code.includes(code.trim()) || a.name?.toLowerCase().includes(code.toLowerCase())
              )
              return filtered.length > 0 ? (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-lg shadow-xl max-h-56 overflow-y-auto">
                  {filtered.map(a => (
                    <button key={a.code}
                      onMouseDown={e => { e.preventDefault(); setCode(a.code); setDropdownOpen(false) }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-[#2C2C2E] transition-colors border-b border-gray-200 dark:border-gray-800 last:border-0">
                      <span className="font-mono text-sm text-[#C8A96E] w-14 flex-shrink-0">{a.code}</span>
                      <span className="text-sm text-gray-600 dark:text-gray-300 truncate">{a.name}</span>
                      {a.auctionDate && (
                        <span className="text-xs text-gray-600 flex-shrink-0 ml-auto">
                          {new Date(a.auctionDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ) : null
            })()}
          </div>
          <button onClick={() => { setDropdownOpen(false); handleLoad() }} disabled={!code.trim() || loading}
            className="bg-[#C8A96E] hover:bg-[#b8944f] text-black text-sm font-semibold px-5 py-2 rounded disabled:opacity-40 transition-colors whitespace-nowrap">
            {loading ? "Loading…" : "Load"}
          </button>
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        {lots.length > 0 && (
          <p className="text-xs text-[#C8A96E]">
            ✓ {lots.length} lots loaded with key points and AI descriptions
          </p>
        )}
      </div>

      {/* Log panel — visible while checking */}
      {log.length > 0 && (
        <div ref={logRef} className="bg-gray-100 dark:bg-[#0d0d0f] border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-52 overflow-y-auto font-mono text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
          {log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}

      {/* Results table */}
      {lots.length > 0 && (
        <div className="bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-300 dark:border-gray-700 gap-3">
            <div className="flex items-center gap-3">
              <p className="text-sm font-medium text-gray-900 dark:text-white">{lots.length} lots</p>
              {checkedCount > 0 && (
                <span className="text-xs text-gray-600 dark:text-gray-400">
                  {checkedCount}/{lots.length} checked · <span className={fixedCount > 0 ? "text-[#C8A96E]" : "text-green-400"}>{fixedCount} fixed</span>
                </span>
              )}
            </div>
            <div className="flex gap-2 items-center">
              {checkedCount > 0 && !checking && (
                <>
                  <button onClick={copyAll}
                    className="text-xs border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white px-3 py-1.5 rounded transition-colors">
                    Copy all
                  </button>
                  {savedMsg
                    ? <span className="text-xs text-green-400">{savedMsg}</span>
                    : <button onClick={saveRun} disabled={saving}
                        className="text-xs border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white px-3 py-1.5 rounded transition-colors disabled:opacity-40">
                        {saving ? "Saving…" : "💾 Save run"}
                      </button>
                  }
                </>
              )}
              {checking && (
                <>
                  {paused
                    ? <button onClick={handleResume} className="text-xs text-green-400 hover:text-green-300 font-medium transition-colors">▶ Resume</button>
                    : <button onClick={handlePause}  className="text-xs text-yellow-500 hover:text-yellow-400 font-medium transition-colors">⏸ Pause</button>
                  }
                  <button onClick={handleStop} className="text-xs text-gray-600 dark:text-gray-500 hover:text-red-400 transition-colors">Stop & results</button>
                </>
              )}
              {/* Re-run all — only shown when everything is already done */}
              {!checking && checkedCount > 0 && remainingCount === 0 && (
                <button onClick={() => runCheck(true)}
                  className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors underline underline-offset-2">
                  Re-run all
                </button>
              )}
              <button onClick={() => runCheck()} disabled={checking || remainingCount === 0}
                className="bg-[#C8A96E] hover:bg-[#b8944f] text-black text-xs font-semibold px-4 py-1.5 rounded disabled:opacity-40 transition-colors whitespace-nowrap">
                {checking
                  ? `${paused ? "Paused" : "Checking"} ${progress?.done ?? 0}/${progress?.total ?? 0}${progress?.current ? ` · Lot ${progress.current}` : ""}`
                  : remainingCount === 0
                    ? "✓ All checked"
                    : checkedCount > 0
                      ? `▶ Resume (${remainingCount} remaining)`
                      : "▶ Run Key Points Check"}
              </button>
            </div>
          </div>

          {/* Results summary */}
          {showResults && checkedCount > 0 && (
            <div className="border-b border-gray-300 dark:border-gray-700 px-4 py-3 bg-white dark:bg-[#1C1C1E] space-y-3">
              <div className="flex gap-4">
                <div className="text-center">
                  <p className="text-lg font-bold text-gray-900 dark:text-white">{checkedCount}</p>
                  <p className="text-xs text-gray-600 dark:text-gray-500">Checked</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-green-400">{checkedCount - fixedCount - lots.filter(l => l.status === "error").length}</p>
                  <p className="text-xs text-gray-600 dark:text-gray-500">All good</p>
                </div>
                <div className="text-center">
                  <p className={`text-lg font-bold ${fixedCount > 0 ? "text-[#C8A96E]" : "text-gray-600"}`}>{fixedCount}</p>
                  <p className="text-xs text-gray-600 dark:text-gray-500">Fixed</p>
                </div>
                {lots.filter(l => l.status === "error").length > 0 && (
                  <div className="text-center">
                    <p className="text-lg font-bold text-red-400">{lots.filter(l => l.status === "error").length}</p>
                    <p className="text-xs text-gray-600 dark:text-gray-500">Errors</p>
                  </div>
                )}
              </div>
              {fixedCount > 0 && (() => {
                const pendingFixed = lots.filter(l => l.status === "fixed" && !l.accepted)
                const selectedCount = pendingFixed.filter(l => l.selected).length
                const allSelected = pendingFixed.length > 0 && pendingFixed.every(l => l.selected)
                return (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                        className="w-3.5 h-3.5 rounded accent-[#C8A96E]" />
                      <p className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider flex-1">
                        {pendingFixed.length} fixed · {selectedCount} selected
                      </p>
                      <button onClick={acceptAll} disabled={accepting || selectedCount === 0}
                        className="text-xs bg-[#C8A96E] hover:bg-[#b8944f] disabled:opacity-40 text-black font-semibold px-3 py-1 rounded transition-colors">
                        {accepting ? "Saving…" : `Apply ${selectedCount} selected`}
                      </button>
                    </div>

                    {lots.filter(l => l.status === "fixed").map(l => (
                      <div key={l.label} className={`rounded-lg overflow-hidden border transition-colors ${
                        l.accepted ? "border-green-700/50 bg-green-900/10"
                        : l.selected ? "border-[#C8A96E]/50 bg-gray-100 dark:bg-[#2C2C2E]"
                        : "border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-[#2C2C2E] opacity-60"
                      }`}>
                        {/* Lot header */}
                        <div className="flex items-center gap-3 px-3 py-2 border-b border-gray-300 dark:border-gray-700">
                          {!l.accepted && (
                            <input type="checkbox" checked={!!l.selected} onChange={() => toggleSelected(l.id)}
                              className="w-3.5 h-3.5 rounded accent-[#C8A96E] flex-shrink-0" />
                          )}
                          <span className="text-xs font-mono font-bold text-[#C8A96E]">Lot {l.label}</span>
                          <div className="flex items-center gap-2 ml-auto">
                            {l.accepted
                              ? <span className="text-xs text-green-400 font-medium">✓ Saved to catalogue</span>
                              : <button onClick={() => acceptLot(l)} disabled={!l.selected}
                                  className="text-xs bg-[#C8A96E] hover:bg-[#b8944f] disabled:opacity-40 text-black font-semibold px-3 py-0.5 rounded transition-colors">
                                  Apply
                                </button>
                            }
                            <button onClick={() => navigator.clipboard.writeText(l.revised ?? "")}
                              className="text-[10px] text-gray-600 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white border border-gray-300 dark:border-gray-700 hover:border-gray-500 px-2 py-0.5 rounded transition-colors">
                              Copy
                            </button>
                          </div>
                        </div>

                        {/* Missing / added summary */}
                        {(l.missing || l.added) && (
                          <div className="flex gap-4 px-3 py-2 border-b border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E]">
                            {l.missing && (
                              <div className="flex-1">
                                <p className="text-[10px] text-red-400 uppercase tracking-wider mb-0.5">Was missing</p>
                                <p className="text-xs text-red-300">{l.missing}</p>
                              </div>
                            )}
                            {l.added && (
                              <div className="flex-1">
                                <p className="text-[10px] text-[#C8A96E] uppercase tracking-wider mb-0.5">What changed</p>
                                <p className="text-xs text-[#C8A96E]">{l.added}</p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Evidence — what the AI matched for present key points */}
                        {l.found && (
                          <div className="px-3 py-2 border-b border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E]">
                            <p className="text-[10px] text-green-500 uppercase tracking-wider mb-0.5">Evidence (what the AI matched)</p>
                            <p className="text-xs text-green-400 leading-relaxed">{l.found}</p>
                          </div>
                        )}

                        {/* Three columns: key points | before | editable after */}
                        <div className="grid grid-cols-3 divide-x divide-gray-300 dark:divide-gray-700">
                          <div className="px-3 py-2">
                            <p className="text-[10px] text-gray-600 dark:text-gray-500 uppercase tracking-wider mb-1.5">Key Points</p>
                            <pre className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">{l.keyPoints}</pre>
                          </div>
                          <div className="px-3 py-2">
                            <p className="text-[10px] text-gray-600 dark:text-gray-500 uppercase tracking-wider mb-1.5">Before</p>
                            <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-wrap">{l.description}</p>
                          </div>
                          <div className="px-3 py-2">
                            <p className="text-[10px] text-[#C8A96E] uppercase tracking-wider mb-1.5">
                              After (fixed){!l.accepted && <span className="text-gray-600 normal-case ml-1">· editable</span>}
                            </p>
                            {l.accepted
                              ? <p className="text-xs text-gray-700 dark:text-gray-200 leading-relaxed whitespace-pre-wrap">{l.revised}</p>
                              : <textarea
                                  value={l.revised ?? ""}
                                  onChange={e => updateRevised(l.id, e.target.value)}
                                  rows={8}
                                  className="w-full text-xs text-gray-700 dark:text-gray-200 bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded p-2 leading-relaxed resize-y focus:outline-none focus:border-[#C8A96E]"
                                />
                            }
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
          )}

          {/* Lot rows */}
          <div className="divide-y divide-gray-200 dark:divide-gray-800 max-h-[65vh] overflow-y-auto">
            {lots.map(lot => {
              const isExpanded = expandedLot === lot.label
              return (
                <div key={lot.label} className="px-4 py-3">
                  {/* Row summary */}
                  <button
                    onClick={() => setExpandedLot(isExpanded ? null : lot.label)}
                    className="w-full flex items-center gap-3 text-left"
                  >
                    <span className="text-sm font-medium text-gray-900 dark:text-white w-14 shrink-0">Lot {lot.label}</span>
                    <span className="flex-1 text-xs text-gray-600 dark:text-gray-500 truncate">{lot.keyPoints.split("\n")[0]}</span>
                    {lot.status === "idle"     && <span className="text-xs text-gray-600">Not checked</span>}
                    {lot.status === "checking" && <span className="text-xs text-gray-600 dark:text-gray-500 animate-pulse">Checking…</span>}
                    {lot.status === "ok"       && <span className="text-xs text-green-400">✓ All included</span>}
                    {lot.status === "fixed"    && <span className="text-xs text-[#C8A96E]">⚑ Fixed</span>}
                    {lot.status === "error"    && <span className="text-xs text-red-400">Error</span>}
                    <span className="text-gray-600 text-xs ml-1">{isExpanded ? "▲" : "▼"}</span>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[10px] text-gray-600 dark:text-gray-500 uppercase tracking-wider mb-1.5">Key Points</p>
                        <pre className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap bg-white dark:bg-[#1C1C1E] rounded-lg p-3 font-sans leading-relaxed">{lot.keyPoints}</pre>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-600 dark:text-gray-500 uppercase tracking-wider mb-1.5">
                          {lot.status === "fixed" ? "Fixed Description" : "AI Description"}
                        </p>
                        <pre className={`text-xs whitespace-pre-wrap rounded-lg p-3 font-sans leading-relaxed ${
                          lot.status === "fixed"
                            ? "text-[#C8A96E] bg-white dark:bg-[#1C1C1E] border border-[#C8A96E]/25"
                            : "text-gray-600 dark:text-gray-300 bg-white dark:bg-[#1C1C1E]"
                        }`}>{lot.revised ?? lot.description}</pre>
                        {lot.status === "fixed" && (
                          <button onClick={() => navigator.clipboard.writeText(lot.revised ?? "")}
                            className="mt-1.5 text-[10px] text-gray-600 dark:text-gray-500 hover:text-gray-300 transition-colors">
                            Copy description
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Double Check Tab ─────────────────────────────────────────────────────────

type DCLot = {
  id:              string
  label:           string
  description:     string
  imageUrls?:      string[]
  verdict?:        "ok" | "issues"
  contradictions?: string
  unsupported?:    string
  revised?:        string
  accepted?:       boolean
  selected?:       boolean
  status?:         "idle" | "checking" | "ok" | "issues" | "error"
}

function DoubleCheckTab({ model: globalModel, fallbackModel, onModelChange }: { model: string; fallbackModel: string; onModelChange: (m: string) => void }) {
  const [code,        setCode]        = useState("")
  const [auctionId,   setAuctionId]   = useState<string | null>(null)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [lots,        setLots]        = useState<DCLot[]>([])
  const [checking,    setChecking]    = useState(false)
  const [progress,    setProgress]    = useState<{ done: number; total: number } | null>(null)
  const [expandedLot, setExpandedLot] = useState<string | null>(null)
  const [localModel,  setLocalModel]  = useState(globalModel)

  // Keep localModel in sync with sidebar dropdown changes
  useEffect(() => { setLocalModel(globalModel) }, [globalModel])
  const [modelList,   setModelList]   = useState<string[]>([globalModel])
  const [modelStatus, setModelStatus] = useState<Record<string, { ok: boolean; ms: number; error?: string } | "testing">>({})
  const [testingAll,  setTestingAll]  = useState(false)
  const [log,         setLog]         = useState<string[]>([])
  const [showResults, setShowResults] = useState(false)
  const [auctionList, setAuctionList] = useState<{ code: string; name: string }[]>([])
  const [paused,      setPaused]      = useState(false)
  const logRef    = useRef<HTMLDivElement>(null)
  const cancelRef = useRef(false)
  const pauseRef  = useRef(false)
  const abortRef  = useRef<AbortController | null>(null)

  useEffect(() => {
    fetch("/api/auction-ai/models").then(r => r.json()).then(j => { if (j.models?.length) setModelList(j.models) }).catch(() => {})
    fetch("/api/auction-ai/auctions").then(r => r.json()).then(d => { if (Array.isArray(d)) setAuctionList(d) }).catch(() => {})
  }, [])

  function addLog(msg: string) {
    const ts = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    setLog(l => [...l, `[${ts}]  ${msg}`])
    setTimeout(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }), 50)
  }

  async function testAllModels() {
    setTestingAll(true)
    const initial: Record<string, "testing"> = {}
    modelList.forEach(m => { initial[m] = "testing" })
    setModelStatus(initial)
    for (const m of modelList) {
      try {
        const res  = await fetch("/api/auction-ai/model-test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: m }) })
        const data = await res.json()
        setModelStatus(prev => ({ ...prev, [m]: data }))
      } catch (e: any) {
        setModelStatus(prev => ({ ...prev, [m]: { ok: false, ms: 0, error: e.message } }))
      }
      await new Promise(r => setTimeout(r, 1000))
    }
    setTestingAll(false)
  }

  async function handleLoad() {
    const upper = code.trim().toUpperCase()
    if (!upper) return
    setLoading(true); setError(null); setLots([]); setAuctionId(null); setShowResults(false); setLog([])
    try {
      const res = await fetch(`/api/auction-ai/catalogue-lots?code=${encodeURIComponent(upper)}`)
      if (!res.ok) throw new Error((await res.json()).error ?? "Catalogue not found")
      const data = await res.json()
      setAuctionId(data.auctionId ?? null)

      // Load all lots that have a description
      const loaded: DCLot[] = data.lots
        .filter((l: any) => l.description?.trim())
        .map((l: any) => ({
          id:          l.id,
          label:       l.barcode || l.receiptUniqueId || l.id,
          description: l.description,
          imageUrls:   l.imageUrls ?? [],
          status:      "idle" as const,
        }))

      if (loaded.length === 0) {
        throw new Error(`No lots with descriptions found for "${upper}". Add descriptions via the Batch Run tab or cataloguing page first.`)
      }
      setLots(loaded)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const [accepting, setAccepting] = useState(false)

  function handleStop() {
    cancelRef.current = true
    pauseRef.current  = false
    setPaused(false)
    addLog("⛔ Stopped")
  }

  function handlePause() {
    pauseRef.current = true
    setPaused(true)
    addLog("⏸ Paused — finishing current lot…")
  }

  function handleResume() {
    pauseRef.current = false
    setPaused(false)
    addLog("▶ Resumed")
  }

  function toggleSelected(id: string) {
    setLots(prev => prev.map(l => l.id === id ? { ...l, selected: !l.selected } : l))
  }

  function toggleSelectAll() {
    const fixedLots  = lots.filter(l => l.status === "issues" && l.revised && !l.accepted)
    const allSelected = fixedLots.every(l => l.selected)
    setLots(prev => prev.map(l =>
      l.status === "issues" && l.revised && !l.accepted ? { ...l, selected: !allSelected } : l
    ))
  }

  async function acceptLot(lot: DCLot) {
    if (!auctionId || !lot.revised) return
    setLots(prev => prev.map(l => l.id === lot.id ? { ...l, accepted: true } : l))
    try {
      await applyAiDescriptionOne(auctionId, { id: lot.id, description: lot.revised })
    } catch (e: any) {
      setLots(prev => prev.map(l => l.id === lot.id ? { ...l, accepted: false } : l))
      setError(`Failed to save Lot ${lot.label}: ${e.message}`)
    }
  }

  async function acceptAll() {
    const toAccept = lots.filter(l => l.status === "issues" && l.revised && !l.accepted && l.selected)
    if (!auctionId || !toAccept.length) return
    setAccepting(true)
    for (const lot of toAccept) await acceptLot(lot)
    setAccepting(false)
  }

  async function runCheck() {
    const allLots = lots.filter(l => l.description)
    if (!allLots.length || checking) return
    cancelRef.current = false
    pauseRef.current  = false
    setPaused(false)
    setShowResults(false)
    setChecking(true)
    setLog([])
    const withPhotos = allLots.filter(l => (l.imageUrls?.length ?? 0) > 0).length

    // Build working copy — keep existing verdicts, reset the rest to idle
    // Using a local array means every update is a full setLots([...working])
    // call, which React never batches away, fixing the React 18 batching bug
    // that caused only ~37% of results to appear for large auctions.
    const working: DCLot[] = allLots.map(l =>
      l.verdict ? l : { ...l, status: "idle" as const, contradictions: undefined, unsupported: undefined }
    )
    setLots([...working])

    const toRun = working.filter(l => !l.verdict)
    addLog(`── Starting double check: ${toRun.length} lots · ${withPhotos} with photos · model: ${localModel}`)

    let done = 0
    const total = allLots.length  // progress counts skipped + processed

    try {
      for (let i = 0; i < allLots.length; i++) {
        if (cancelRef.current) break

        const snap = allLots[i]
        const idx  = working.findIndex(l => l.id === snap.id)
        if (idx === -1) { done++; setProgress({ done, total }); continue }

        // Skip lots already checked in a previous run
        if (working[idx].verdict) {
          done++; setProgress({ done, total })
          continue
        }

        // Fetch and base64-encode images for this lot (up to 6)
        const urls = (snap.imageUrls ?? []).slice(0, 6)
        const images = (await Promise.all(
          urls.map(async (url) => {
            try {
              const r = await fetch(`/api/catalogue/photo-proxy?key=${encodeURIComponent(url)}`)
              if (!r.ok) return null
              const buf = await r.arrayBuffer()
              const data = btoa(String.fromCharCode(...new Uint8Array(buf)))
              const mimeType = r.headers.get("content-type") || "image/jpeg"
              return { data, mimeType }
            } catch { return null }
          })
        )).filter(Boolean) as { data: string; mimeType: string }[]

        working[idx] = { ...working[idx], status: "checking" }
        setLots([...working])
        addLog(`  · ${done + 1}/${total} ${snap.label} — checking…`)

        // Retry loop — same rules as batch run
        let lastError = ""
        let succeeded = false
        let attempt   = 0

        while (!cancelRef.current) {
          if (attempt > 0) {
            const isRateLimit = lastError.startsWith("RATE_LIMITED:")
            const wait = isRateLimit
              ? Math.min(60000 * Math.pow(2, attempt - 1), 1800000)
              : Math.min(attempt * 12000, 30000)
            addLog(`↺ ${snap.label} — ${isRateLimit ? "rate limited, waiting" : "retrying in"} ${wait / 1000}s (attempt ${attempt + 1})…`)
            await new Promise(r => setTimeout(r, wait))
            if (cancelRef.current) break
          }
          attempt++

          try {
            const modelToUse = (attempt % 2 === 0 && fallbackModel) ? fallbackModel : localModel
            if (attempt > 1) addLog(`  ↳ ${snap.label} trying ${modelToUse}`)
            const t0  = Date.now()
            const res = await fetch("/api/auction-ai/double-check", {
              method:  "POST",
              headers: { "Content-Type": "application/json" },
              body:    JSON.stringify({ label: snap.label, description: snap.description, images, model: modelToUse }),
            })
            const json = await res.json()
            if (json.error) throw new Error(json.error)

            const { verdict, contradictions, unsupported, revised } = json
            const ms = Date.now() - t0
            addLog(`  ${verdict === "ok" ? "✓ clean" : "⚑ issues"} — ${snap.label} (${(ms / 1000).toFixed(1)}s)`)
            working[idx] = { ...working[idx], verdict, contradictions, unsupported, revised: revised || undefined, status: verdict, selected: verdict === "issues" && !!revised ? true : undefined }
            setLots([...working])
            succeeded = true
            break
          } catch (e: any) {
            lastError = e.message ?? String(e)
            if (lastError.startsWith("BLOCKED:")) {
              addLog(`— ${snap.label} — blocked by Gemini, skipping`)
              working[idx] = { ...working[idx], status: "error" }
              setLots([...working])
              break
            }
          }
        }

        if (!succeeded && !cancelRef.current) {
          addLog(`— ${snap.label} — skipped (content blocked)`)
          working[idx] = { ...working[idx], status: "error" }
          setLots([...working])
        }

        done++
        setProgress({ done, total })

        if (pauseRef.current) {
          addLog(`⏸ Paused after ${snap.label} — click Resume to continue`)
          while (pauseRef.current && !cancelRef.current) await new Promise(r => setTimeout(r, 500))
          if (!cancelRef.current) addLog("▶ Resumed")
        }
      }

      if (!cancelRef.current) addLog("── Complete")
    } catch (e: any) {
      if (!cancelRef.current) addLog(`✗ Unexpected error: ${e.message}`)
    } finally {
      setChecking(false)
      setProgress(null)
      setShowResults(true)
    }
  }

  const issueCount = lots.filter(l => l.status === "issues").length
  const okCount    = lots.filter(l => l.status === "ok").length
  const errCount   = lots.filter(l => l.status === "error").length

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">Double Check</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Loads descriptions and photos from the catalogue and runs a second AI pass to spot factual errors,
          inconsistencies, or claims that look guessed — especially where photos are blurry or details aren't clearly visible.
        </p>
        <ShowInstructionToggle instruction={DOUBLE_CHECK_INSTRUCTION} />
      </div>

      {/* Model selector */}
      <div className="bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider">Model</p>
          <button onClick={testAllModels} disabled={testingAll}
            className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50 transition-colors">
            {testingAll ? "Testing…" : "⚡ Test all models"}
          </button>
        </div>
        <div className="border border-gray-300 dark:border-gray-700 rounded-lg overflow-hidden">
          {modelList.map(m => {
            const status     = modelStatus[m]
            const isSelected = localModel === m
            return (
              <button key={m} onClick={() => { setLocalModel(m); onModelChange(m) }}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors border-b border-gray-200 dark:border-gray-800 last:border-0 ${isSelected ? "bg-indigo-950/40" : "hover:bg-gray-50 dark:hover:bg-[#1a1a1e]"}`}>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isSelected ? "bg-indigo-400" : "bg-gray-700"}`} />
                <span className={`text-sm flex-1 font-mono ${isSelected ? "text-indigo-300" : "text-gray-600 dark:text-gray-400"}`}>{m}</span>
                {status === "testing" && <span className="text-xs text-gray-600 dark:text-gray-500 animate-pulse">testing…</span>}
                {status && status !== "testing" && (
                  status.ok
                    ? <span className={`text-xs font-medium ${status.ms < 5000 ? "text-green-400" : status.ms < 12000 ? "text-yellow-400" : "text-orange-400"}`}>✓ {(status.ms / 1000).toFixed(1)}s</span>
                    : <span className="text-xs text-red-400 truncate max-w-[200px]" title={status.error}>✗ {status.error?.match(/\[(\d{3}[^\]]*)\]/)?.[1] ?? "error"}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Load from catalogue */}
      <div className="bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-xl p-4 space-y-3">
        <p className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider">Auction</p>
        <div className="flex gap-2">
          <Autocomplete
            value={code}
            onChange={v => setCode(v.replace(/\s*—.*$/, "").trim().toUpperCase())}
            options={auctionList.map(a => `${a.code} — ${a.name}`)}
            placeholder="Enter auction code…"
          />
          <button onClick={handleLoad} disabled={!code.trim() || loading}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors flex-shrink-0">
            {loading ? "Loading…" : "Load"}
          </button>
        </div>
        {error && <p className="text-xs text-red-400 bg-red-950/30 rounded-lg px-3 py-2">{error}</p>}
        {lots.length > 0 && !checking && (
          <p className="text-xs text-gray-600 dark:text-gray-400">
            <span className="text-indigo-300 font-semibold">{lots.length}</span> lot{lots.length !== 1 ? "s" : ""} loaded
            {(() => { const n = lots.filter(l => (l.imageUrls?.length ?? 0) > 0).length; return n > 0 ? <> · <span className="text-indigo-300 font-semibold">{n}</span> with photos</> : <> · <span className="text-yellow-500">no photos</span></> })()}
          </p>
        )}
      </div>

      {/* Run */}
      {lots.length > 0 && (
        <div className="flex items-center gap-3">
          {!checking ? (
            <button onClick={runCheck}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm rounded-lg transition-colors">
              🔎 Run Double Check ({lots.length} lots)
            </button>
          ) : (
            <>
              {paused
                ? <button onClick={handleResume} className="px-5 py-2.5 bg-green-700 hover:bg-green-600 text-white font-semibold text-sm rounded-lg transition-colors">▶ Resume</button>
                : <button onClick={handlePause}  className="px-5 py-2.5 bg-yellow-700/60 hover:bg-yellow-700 border border-yellow-600 text-yellow-300 font-semibold text-sm rounded-lg transition-colors">⏸ Pause</button>
              }
              <button onClick={handleStop}
                className="px-5 py-2.5 bg-red-900/50 hover:bg-red-900/80 border border-red-700 text-red-300 font-semibold text-sm rounded-lg transition-colors">
                ⛔ Stop
              </button>
            </>
          )}
          {progress && (
            <div className="flex-1 flex items-center gap-3">
              <div className="flex-1 bg-gray-800 rounded-full h-2">
                <div className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
              </div>
              <span className="text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">{progress.done} / {progress.total}</span>
            </div>
          )}
        </div>
      )}

      {/* Log */}
      {log.length > 0 && (
        <div ref={logRef} className="bg-gray-100 dark:bg-[#0d0d0f] border border-gray-200 dark:border-gray-800 rounded-xl p-3 max-h-40 overflow-y-auto font-mono text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
          {log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}

      {/* Results */}
      {showResults && lots.some(l => l.status && l.status !== "idle") && (
        <div className="space-y-3">
          {(() => {
            const fixable    = lots.filter(l => l.status === "issues" && l.revised && !l.accepted)
            const selCount   = fixable.filter(l => l.selected).length
            const allSel     = fixable.length > 0 && fixable.every(l => l.selected)
            return (
              <div className="flex items-center gap-4 flex-wrap">
                {okCount > 0    && <span className="text-xs font-semibold text-green-400 bg-green-950/40 border border-green-800/50 rounded-full px-3 py-1">✓ {okCount} clean</span>}
                {issueCount > 0 && <span className="text-xs font-semibold text-red-400   bg-red-950/40   border border-red-800/50   rounded-full px-3 py-1">⚑ {issueCount} with issues</span>}
                {errCount > 0   && <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 bg-gray-800/40 border border-gray-300 dark:border-gray-700 rounded-full px-3 py-1">✗ {errCount} errors</span>}
                {auctionId && fixable.length > 0 && (
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-600 dark:text-gray-400 ml-auto">
                    <input type="checkbox" checked={allSel} onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-gray-600 accent-indigo-500" />
                    Select all fixable ({fixable.length})
                  </label>
                )}
                {auctionId && selCount > 0 && (
                  <button onClick={acceptAll} disabled={accepting}
                    className="text-xs font-semibold px-3 py-1 rounded-full bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white transition-colors">
                    {accepting ? "Applying…" : `✓ Accept ${selCount} selected fix${selCount !== 1 ? "es" : ""}`}
                  </button>
                )}
              </div>
            )
          })()}

          {[...lots]
            .sort((a, b) => {
              const rank = (s?: string) => s === "issues" ? 0 : s === "error" ? 1 : 2
              return rank(a.status) - rank(b.status)
            })
            .filter(l => l.status && l.status !== "idle" && l.status !== "checking")
            .map(lot => {
              const isExpanded = expandedLot === lot.label
              const hasIssues  = lot.status === "issues"
              return (
                <div key={lot.label}
                  className={`border rounded-xl overflow-hidden ${
                    lot.accepted ? "border-indigo-800/50 bg-indigo-950/20"
                    : hasIssues  ? "border-red-800/60 bg-red-950/20"
                    : lot.status === "error" ? "border-gray-700 bg-gray-900/30"
                    : "border-green-800/40 bg-green-950/10"
                  }`}>
                  <div className="flex items-center">
                    {hasIssues && lot.revised && !lot.accepted && (
                      <label className="flex items-center justify-center px-3 py-3 cursor-pointer" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={!!lot.selected} onChange={() => toggleSelected(lot.id)}
                          className="w-4 h-4 rounded border-gray-600 accent-indigo-500" />
                      </label>
                    )}
                    <button onClick={() => setExpandedLot(isExpanded ? null : lot.label)}
                      className={`flex-1 flex items-center gap-3 px-4 py-3 text-left ${hasIssues && lot.revised && !lot.accepted ? "pl-0" : ""}`}>
                      <span className={`text-base flex-shrink-0 ${lot.accepted ? "text-indigo-400" : hasIssues ? "text-red-400" : lot.status === "error" ? "text-gray-600 dark:text-gray-500" : "text-green-400"}`}>
                        {lot.accepted ? "✓" : hasIssues ? "⚑" : lot.status === "error" ? "✗" : "✓"}
                      </span>
                      <span className="font-mono text-sm text-gray-700 dark:text-gray-200 flex-1">{lot.label}</span>
                      {lot.accepted && <span className="text-xs text-indigo-400 font-medium">Fix applied</span>}
                      {hasIssues && !lot.accepted && lot.contradictions && (
                        <span className="text-xs text-red-400 truncate max-w-sm opacity-80">{lot.contradictions.slice(0, 80)}{lot.contradictions.length > 80 ? "…" : ""}</span>
                      )}
                      <span className="text-gray-600 text-xs flex-shrink-0">{isExpanded ? "▲" : "▼"}</span>
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-4 space-y-4">
                      {lot.contradictions && (
                        <div>
                          <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-1">Issues found</p>
                          <p className="text-sm text-red-200">{lot.contradictions}</p>
                        </div>
                      )}
                      {lot.unsupported && (
                        <div>
                          <p className="text-xs font-semibold text-yellow-400 uppercase tracking-wider mb-1">Unverifiable claims</p>
                          <p className="text-sm text-yellow-200">{lot.unsupported}</p>
                        </div>
                      )}
                      {lot.status === "error" && <p className="text-xs text-gray-600 dark:text-gray-500">Check failed — try running again</p>}

                      {/* Original description */}
                      <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
                        <p className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider mb-1">Original description</p>
                        <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-wrap">{lot.description}</p>
                      </div>

                      {/* Revised description + accept button */}
                      {hasIssues && lot.revised && (
                        <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
                          <p className="text-xs text-indigo-400 uppercase tracking-wider mb-1 font-semibold">Suggested fix</p>
                          <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-wrap mb-3">{lot.revised}</p>
                          {auctionId && (
                            lot.accepted
                              ? <span className="text-xs text-indigo-400 font-medium">✓ Fix applied to catalogue</span>
                              : <button onClick={() => acceptLot(lot)}
                                  className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-indigo-700 hover:bg-indigo-600 text-white transition-colors">
                                  ✓ Accept fix
                                </button>
                          )}
                        </div>
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

// ─── Pipeline Tab ────────────────────────────────────────────────────────────

type PipelineStage = "batch" | "doublecheck" | "kpcheck" | "complete"

type PLot = {
  id:          string
  label:       string
  keyPoints:   string
  imageUrls:   string[]
  currentDesc: string   // updated as stages complete so next stage uses latest
  // Stage 1
  batchStatus?: "ok" | "failed" | "skipped"
  estimate?:    string
  batchDesc?:   string   // original raw batch text, before DC/KP — for the DC before/after
  // Stage 2
  dcStatus?:       "ok" | "issues" | "error" | "skipped"
  contradictions?: string
  unsupported?:    string
  // Stage 3
  kpStatus?:  "ok" | "pending" | "fixed" | "error" | "skipped"
  kpMissing?: string
  kpAdded?:   string
  kpFound?:   string  // exact phrases the AI matched for each "present" key point
  kpRevised?: string  // proposed text waiting for approval
  appliedDesc?: string  // description currently on the catalogue lot (to detect un-applied work)
  // Per-stage debug — exactly what was sent to Gemini and what came back (this session only)
  debug?: {
    batch?: { prompt: string; response: string; imageCount: number }
    kp?:    { prompt: string; response: string }
    dc?:    { prompt: string; response: string; imageCount: number }
  }
}

function PipelineTab({ model: globalModel, fallbackModel }: { model: string; fallbackModel: string }) {
  const [code,        setCode]        = useState("")
  const [auctionId,   setAuctionId]   = useState<string | null>(null)
  const [lots,        setLots]        = useState<PLot[]>([])
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [running,     setRunning]     = useState(false)
  const [paused,      setPaused]      = useState(false)
  const [stage,       setStage]       = useState<PipelineStage>("batch")
  const [progress,    setProgress]    = useState<{ done: number; total: number } | null>(null)
  const [log,         setLog]         = useState<string[]>([])
  const [preset,      setPreset]      = useState(Object.keys(PRESETS)[1])
  const [overrides,   setOverrides]   = useState<Record<string, string>>({})
  const [editOpen,     setEditOpen]    = useState(false)
  const [auctionList, setAuctionList] = useState<{ code: string; name: string }[]>([])
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [grounded,     setGrounded]    = useState(false)
  const [accepting,    setAccepting]   = useState(false)
  const [photoLot,     setPhotoLot]    = useState<PLot | null>(null)
  const [debugLot,     setDebugLot]    = useState<PLot | null>(null)
  const [signedUrls,   setSignedUrls]  = useState<Record<string, string>>({})
  const codeRef  = useRef<HTMLDivElement>(null)
  const logRef   = useRef<HTMLDivElement>(null)
  const cancelRef = useRef(false)
  const pauseRef  = useRef(false)
  const localModel = globalModel

  const systemInstruction = overrides[preset] ?? PRESETS[preset] ?? ""

  useEffect(() => {
    fetch("/api/auction-ai/presets").then(r => r.json()).then(setOverrides).catch(() => {})
    fetch("/api/auction-ai/auctions").then(r => r.json()).then(d => { if (Array.isArray(d)) setAuctionList(d) }).catch(() => {})
    // Pre-load auction code from cataloguing "AI Upgrade" button
    const raw = localStorage.getItem("pipeline_preload")
    if (raw) {
      try {
        const data = JSON.parse(raw)
        if (data.auctionCode) setCode(data.auctionCode.toUpperCase())
      } catch {}
      localStorage.removeItem("pipeline_preload")
    }
  }, [])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (codeRef.current && !codeRef.current.contains(e.target as Node)) setDropdownOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  async function savePreset(text: string) {
    await fetch("/api/auction-ai/presets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: preset, instruction: text }),
    })
    setOverrides(prev => ({ ...prev, [preset]: text }))
    setEditOpen(false)
  }

  function addLog(msg: string) {
    const ts = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    setLog(l => [...l, `[${ts}]  ${msg}`])
    setTimeout(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }), 50)
  }

  async function saveLot(lotId: string, fields: Record<string, any>) {
    await fetch("/api/auction-ai/pipeline/lot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.trim().toUpperCase(), lotId, label: lots.find(l => l.id === lotId)?.label ?? "", ...fields }),
    }).catch(() => {/* silent */})
  }

  async function advanceStage(newStage: PipelineStage) {
    setStage(newStage)
    await fetch("/api/auction-ai/pipeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.trim().toUpperCase(), stage: newStage, model: localModel, preset }),
    }).catch(() => {})
  }

  async function handleLoad() {
    const upper = code.trim().toUpperCase()
    if (!upper) return
    setLoading(true); setError(null); setLots([]); setAuctionId(null); setLog([]); setStage("batch"); setProgress(null)
    try {
      // Load catalogue lots
      const catRes = await fetch(`/api/auction-ai/catalogue-lots?code=${encodeURIComponent(upper)}`)
      if (!catRes.ok) throw new Error((await catRes.json()).error ?? "Catalogue not found")
      const catData = await catRes.json()
      setAuctionId(catData.auctionId ?? null)

      // Load existing pipeline state
      const pipeRes = await fetch(`/api/auction-ai/pipeline?code=${encodeURIComponent(upper)}`)
      const pipeData = await pipeRes.json()
      const savedRun = pipeData.run
      const savedLots: Record<string, any> = {}
      if (savedRun) {
        setStage(savedRun.stage as PipelineStage)
        for (const sl of (savedRun.lots ?? [])) savedLots[sl.lotId] = sl
      }

      const mapped: PLot[] = catData.lots.map((l: any) => {
        const saved = savedLots[l.id]
        return {
          id:          l.id,
          label:       l.barcode || l.receiptUniqueId || l.id,
          keyPoints:   l.keyPoints ?? "",
          imageUrls:   l.imageUrls ?? [],
          currentDesc: saved?.description ?? l.description ?? "",
          batchStatus: saved?.batchStatus,
          estimate:    saved?.estimate,
          batchDesc:   saved?.batchDesc || undefined,
          dcStatus:    saved?.dcStatus,
          contradictions: saved?.contradictions,
          unsupported: saved?.unsupported,
          kpStatus:    saved?.kpStatus,
          kpMissing:   saved?.kpMissing,
          kpAdded:     saved?.kpAdded,
          // Best AI text available: KP-revised → post-DC pipeline desc → catalogue desc.
          // Use || not ?? — fields may be stored as "" (falsy) rather than null.
          kpRevised:   saved?.revised || saved?.description || l.description || undefined,
          appliedDesc: l.description ?? "",
        }
      })

      setLots(mapped)
      if (savedRun) {
        const needApply = mapped.filter(l => l.kpRevised && (l.kpRevised ?? "").trim() !== (l.appliedDesc ?? "").trim()).length
        addLog(`▶ Loaded saved pipeline — stage: ${savedRun.stage} · ${mapped.length} lots`)
        if (needApply > 0) addLog(`   ${needApply} lots have descriptions not yet on the catalogue — review below`)
      } else {
        addLog(`▶ Loaded ${mapped.length} lots — ready to start`)
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Retry helper — same rules as batch run ──────────────────────────────────
  // fn receives (attempt, wasRateLimit) so callers can choose fallback model
  // only when the previous failure was actually a rate limit — not for timeouts
  // or other transient errors where the primary model should be retried directly.
  async function withRetry<T>(
    label: string,
    fn: (attempt: number, wasRateLimit: boolean) => Promise<T>,
    isBlock: (err: string) => boolean,
  ): Promise<T | null> {
    let lastError    = ""
    let attempt      = 0
    let wasRateLimit = false
    while (!cancelRef.current) {
      if (attempt > 0) {
        const isRL = lastError.startsWith("RATE_LIMITED:")
        wasRateLimit = isRL
        const wait = isRL ? Math.min(60000 * Math.pow(2, attempt - 1), 1800000) : Math.min(attempt * 12000, 30000)
        addLog(`↺ ${label} — ${isRL ? "rate limited, waiting" : "retrying in"} ${wait / 1000}s (attempt ${attempt + 1})…`)
        await new Promise(r => setTimeout(r, wait))
        if (cancelRef.current) return null
      }
      attempt++
      try {
        return await fn(attempt, wasRateLimit)
      } catch (e: any) {
        lastError = e.message ?? String(e)
        wasRateLimit = false
        if (isBlock(lastError)) {
          addLog(`✗ ${label} — blocked, skipping: ${lastError}`)
          return null
        }
      }
    }
    return null
  }

  // ── Stage 1: Batch ──────────────────────────────────────────────────────────
  async function runBatchStage(currentLots: PLot[]): Promise<PLot[]> {
    const toRun = currentLots.filter(l => !l.batchStatus)
    addLog(`── Stage 1: Batch Run — ${toRun.length} to process`)
    let done = 0
    const updated = [...currentLots]

    for (const lot of toRun) {
      if (cancelRef.current) break
      const idx = updated.findIndex(l => l.id === lot.id)

      // Lots with no photos → skip
      if (lot.imageUrls.length === 0) {
        updated[idx] = { ...updated[idx], batchStatus: "skipped" }
        setLots([...updated])
        await saveLot(lot.id, { batchStatus: "skipped" })
        done++; setProgress({ done, total: toRun.length })
        continue
      }

      addLog(`  · ${done + 1}/${toRun.length} ${lot.label} — fetching images…`)

      const result = await withRetry(lot.label, async (attempt, wasRateLimit) => {
        // Only use fallback when the previous failure was a rate limit —
        // for timeouts and other errors always retry with the primary model
        const modelToUse = (wasRateLimit && fallbackModel) ? fallbackModel : localModel
        if (attempt > 1) addLog(`  ↳ ${lot.label} trying ${modelToUse}`)
        const fd = new FormData()
        fd.append("systemInstruction", systemInstruction)
        fd.append("model", modelToUse)
        fd.append("grounded", grounded ? "true" : "false")
        const urls = lot.imageUrls.slice(0, 24)
        let imgCount = 0
        for (const url of urls) {
          try {
            const r = await fetch(`/api/catalogue/photo-proxy?key=${encodeURIComponent(url)}`)
            if (!r.ok) continue
            const blob = await r.blob()
            const file = new File([blob], url.split("/").pop() || `img_${imgCount}.jpg`, { type: blob.type || "image/jpeg" })
            fd.append(`lot_${lot.label}_image_${imgCount}`, file, file.name)
            imgCount++
          } catch { /* skip failed image */ }
        }
        if (imgCount === 0) throw new Error("No images could be fetched")

        // Send key points as context so the batch route constrains output to them
        if (lot.keyPoints?.trim()) {
          fd.append(`lot_${lot.label}_context`, lot.keyPoints.trim())
          fd.append(`lot_${lot.label}_contextType`, "keyPoints")
        }

        const res  = await fetch("/api/auction-ai/batch", { method: "POST", body: fd })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? res.statusText)
        const r = json.results?.[0]
        if (!r || r.status !== "OK") throw new Error(r?.error ?? "No result from Gemini")
        return r
      }, err => err.toLowerCase().includes("block"))

      if (result) {
        const desc = result.description ?? ""
        const { low, high } = parseEstimate(result.estimate ?? "")
        updated[idx] = { ...updated[idx], batchStatus: "ok", currentDesc: desc, estimate: result.estimate ?? "", appliedDesc: desc, batchDesc: desc,
          debug: { ...updated[idx].debug, batch: result.debug } }
        setLots([...updated])
        addLog(`  ✓ ${lot.label} — OK`)
        // Apply the generated description + estimate straight to the catalogue lot
        if (auctionId && desc) {
          try {
            await applyAiDescriptionOne(auctionId, {
              id: lot.id,
              description: desc,
              ...(low > 0 && high > 0 ? { aiEstimateLow: low, aiEstimateHigh: high } : {}),
            })
          } catch { addLog(`  ⚠ ${lot.label} — saved to pipeline but failed to apply to catalogue`) }
        }
        // Save to pipeline + existing saved runs
        await saveLot(lot.id, { batchStatus: "ok", description: desc, batchDesc: desc, estimate: result.estimate ?? "" })
        fetch("/api/auction-ai/runs", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: code.trim().toUpperCase(), preset, lot: lot.label, description: desc, estimate: result.estimate ?? "" }),
        }).catch(() => {})
      } else if (!cancelRef.current) {
        updated[idx] = { ...updated[idx], batchStatus: "skipped" }
        setLots([...updated])
        await saveLot(lot.id, { batchStatus: "skipped" })
        addLog(`  — ${lot.label} — skipped (content blocked)`)
      }

      done++; setProgress({ done, total: toRun.length })

      if (pauseRef.current) {
        addLog(`⏸ Paused — click Resume to continue`)
        while (pauseRef.current && !cancelRef.current) await new Promise(r => setTimeout(r, 500))
        if (!cancelRef.current) addLog("▶ Resumed")
      }
    }
    return updated
  }

  // ── Stage 2: Double Check (auto-apply fixes) ────────────────────────────────
  async function runDoubleCheckStage(currentLots: PLot[], aid: string): Promise<PLot[]> {
    const toRun = currentLots.filter(l => !l.dcStatus && (l.batchStatus === "ok" || l.currentDesc))
    addLog(`── Stage 2: Double Check — ${toRun.length} to process`)
    let done = 0
    const updated = [...currentLots]

    for (const lot of toRun) {
      if (cancelRef.current) break
      const idx = updated.findIndex(l => l.id === lot.id)

      // No images → skip
      if (lot.imageUrls.length === 0 || !lot.currentDesc) {
        updated[idx] = { ...updated[idx], dcStatus: "skipped" }
        setLots([...updated])
        await saveLot(lot.id, { dcStatus: "skipped" })
        done++; setProgress({ done, total: toRun.length })
        continue
      }

      addLog(`  · ${done + 1}/${toRun.length} ${lot.label} — double checking…`)

      const result = await withRetry(lot.label, async (attempt, wasRateLimit) => {
        const modelToUse = (wasRateLimit && fallbackModel) ? fallbackModel : localModel
        if (attempt > 1) addLog(`  ↳ ${lot.label} trying ${modelToUse}`)
        // Fetch images
        const urls = lot.imageUrls.slice(0, 6)
        const images = (await Promise.all(urls.map(async url => {
          try {
            const r = await fetch(`/api/catalogue/photo-proxy?key=${encodeURIComponent(url)}`)
            if (!r.ok) return null
            const buf  = await r.arrayBuffer()
            const data = btoa(String.fromCharCode(...new Uint8Array(buf)))
            return { data, mimeType: r.headers.get("content-type") || "image/jpeg" }
          } catch { return null }
        }))).filter(Boolean) as { data: string; mimeType: string }[]

        const res  = await fetch("/api/auction-ai/double-check", {
          method: "POST", headers: { "Content-Type": "application/json" },
          // keyPoints sent so DC keeps cataloguer facts and only removes duplication
          body: JSON.stringify({ label: lot.label, description: lot.currentDesc, images, model: modelToUse, keyPoints: lot.keyPoints }),
        })
        const json = await res.json()
        if (json.error) throw new Error(json.error)
        return json
      }, err => err.startsWith("BLOCKED:"))

      if (result) {
        const { verdict, contradictions, unsupported, revised } = result

        // DC is now the LAST stage and the manual gate — hold its cleaned result for
        // Review & Apply rather than auto-applying. kpRevised drives the review UI.
        if (verdict === "issues" && revised) {
          updated[idx] = { ...updated[idx], dcStatus: verdict, contradictions, unsupported, kpRevised: revised, debug: { ...updated[idx].debug, dc: result.debug } }
          addLog(`  ⚑ ${lot.label} — DC cleaned up, ready for review`)
          await saveLot(lot.id, { dcStatus: verdict, contradictions, unsupported, revised })
        } else {
          updated[idx] = { ...updated[idx], dcStatus: verdict, contradictions, unsupported, debug: { ...updated[idx].debug, dc: result.debug } }
          addLog(`  ✓ ${lot.label} — clean`)
          await saveLot(lot.id, { dcStatus: verdict, contradictions, unsupported })
        }
        setLots([...updated])
      } else if (!cancelRef.current) {
        updated[idx] = { ...updated[idx], dcStatus: "skipped" }
        setLots([...updated])
        await saveLot(lot.id, { dcStatus: "skipped" })
        addLog(`  — ${lot.label} — skipped (content blocked)`)
      }

      done++; setProgress({ done, total: toRun.length })

      if (pauseRef.current) {
        addLog(`⏸ Paused — click Resume to continue`)
        while (pauseRef.current && !cancelRef.current) await new Promise(r => setTimeout(r, 500))
        if (!cancelRef.current) addLog("▶ Resumed")
      }
    }
    return updated
  }

  // ── Stage 3: Key Points Check (auto-apply) ──────────────────────────────────
  async function runKPStage(currentLots: PLot[], aid: string): Promise<PLot[]> {
    const toRun = currentLots.filter(l => !l.kpStatus && l.currentDesc && l.keyPoints)
    addLog(`── Stage 3: Key Points Check — ${toRun.length} to process`)
    let done = 0
    const updated = [...currentLots]

    for (const lot of toRun) {
      if (cancelRef.current) break
      const idx = updated.findIndex(l => l.id === lot.id)

      if (!lot.currentDesc || !lot.keyPoints) {
        updated[idx] = { ...updated[idx], kpStatus: "skipped" }
        setLots([...updated])
        await saveLot(lot.id, { kpStatus: "skipped" })
        done++; setProgress({ done, total: toRun.length })
        continue
      }

      addLog(`  · ${done + 1}/${toRun.length} ${lot.label} — checking key points…`)

      const result = await withRetry(lot.label, async (attempt, wasRateLimit) => {
        const modelToUse = (wasRateLimit && fallbackModel) ? fallbackModel : localModel
        if (attempt > 1) addLog(`  ↳ ${lot.label} trying ${modelToUse}`)
        const res  = await fetch("/api/auction-ai/key-points-check", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: lot.label, keyPoints: lot.keyPoints, description: lot.currentDesc, model: modelToUse }),
        })
        const json = await res.json()
        if (json.error) throw new Error(json.error)
        return json
      }, err => err.startsWith("BLOCKED:"))

      if (result) {
        const { revised, changed, missing, added, found } = result
        let newDesc = lot.currentDesc
        if (changed && revised) {
          // KP now runs BEFORE Double Check — auto-apply so DC sees the inserted points
          try {
            await applyAiDescriptionOne(aid, { id: lot.id, description: revised })
            newDesc = revised
            addLog(`  ⚑ ${lot.label} — key points inserted & applied`)
          } catch {
            addLog(`  ⚑ ${lot.label} — key points inserted but auto-apply failed`)
          }
          updated[idx] = { ...updated[idx], kpStatus: "fixed", kpMissing: missing, kpAdded: added, kpFound: found, currentDesc: newDesc, appliedDesc: newDesc, kpRevised: newDesc, debug: { ...updated[idx].debug, kp: result.debug } }
        } else {
          updated[idx] = { ...updated[idx], kpStatus: "ok", kpMissing: missing, kpFound: found, debug: { ...updated[idx].debug, kp: result.debug } }
          addLog(`  ✓ ${lot.label} — all key points present`)
        }
        setLots([...updated])
        await saveLot(lot.id, { kpStatus: updated[idx].kpStatus, kpMissing: missing, kpAdded: added, description: newDesc, revised: newDesc })
      } else if (!cancelRef.current) {
        updated[idx] = { ...updated[idx], kpStatus: "skipped" }
        setLots([...updated])
        await saveLot(lot.id, { kpStatus: "skipped" })
        addLog(`  — ${lot.label} — skipped (content blocked)`)
      }

      done++; setProgress({ done, total: toRun.length })

      if (pauseRef.current) {
        addLog(`⏸ Paused — click Resume to continue`)
        while (pauseRef.current && !cancelRef.current) await new Promise(r => setTimeout(r, 500))
        if (!cancelRef.current) addLog("▶ Resumed")
      }
    }
    return updated
  }

  // ── Main run ────────────────────────────────────────────────────────────────
  async function handleRun() {
    if (!lots.length || running || !auctionId) return
    cancelRef.current = false
    pauseRef.current  = false
    setPaused(false)
    setRunning(true)
    setError(null)

    // Save initial pipeline record
    await fetch("/api/auction-ai/pipeline", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.trim().toUpperCase(), stage, model: localModel, preset }),
    }).catch(() => {})

    try {
      let current = lots
      const aid   = auctionId

      // Stage 1 — Batch (skip if already done)
      if (stage === "batch") {
        current = await runBatchStage(current)
        if (cancelRef.current) return
        await advanceStage("kpcheck")
      }

      // Stage 2 — Key Points Check (auto-applies, feeds Double Check)
      if (stage === "batch" || stage === "kpcheck") {
        current = await runKPStage(current, aid)
        if (cancelRef.current) return
        await advanceStage("doublecheck")
      }

      // Stage 3 — Double Check (final manual Review & Apply gate)
      if (stage === "batch" || stage === "kpcheck" || stage === "doublecheck") {
        current = await runDoubleCheckStage(current, aid)
        if (cancelRef.current) return
        await advanceStage("complete")
      }

      if (!cancelRef.current) addLog("🎉 Pipeline complete!")
    } catch (e: any) {
      if (!cancelRef.current) { addLog(`✗ Unexpected error: ${e.message}`); setError(e.message) }
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  function handleStop() {
    cancelRef.current = true
    pauseRef.current  = false
    setPaused(false)
    addLog("⛔ Stopped")
  }

  function handlePause() {
    pauseRef.current = true
    setPaused(true)
    addLog("⏸ Paused — finishing current lot…")
  }

  function handleResume() {
    pauseRef.current = false
    setPaused(false)
    addLog("▶ Resumed")
  }

  async function handleReset() {
    if (!confirm("Reset pipeline for this auction? This clears all saved progress.")) return
    await fetch("/api/auction-ai/pipeline", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.trim().toUpperCase() }),
    }).catch(() => {})
    setStage("batch")
    setLots(prev => prev.map(l => ({
      ...l, batchStatus: undefined, estimate: undefined,
      dcStatus: undefined, contradictions: undefined, unsupported: undefined,
      kpStatus: undefined, kpMissing: undefined, kpAdded: undefined, kpRevised: undefined, appliedDesc: undefined,
    })))
    setLog([])
    setProgress(null)
    addLog("↺ Pipeline reset")
  }

  // ── Review & apply ──────────────────────────────────────────────────────────
  async function acceptKP(lot: PLot) {
    if (!auctionId || !lot.kpRevised) return
    const text = lot.kpRevised
    const prevApplied = lot.appliedDesc
    // Optimistically mark as applied — sets appliedDesc === kpRevised so it leaves the review list
    setLots(prev => prev.map(l => l.id === lot.id ? { ...l, kpStatus: "fixed", currentDesc: text, appliedDesc: text } : l))
    try {
      await applyAiDescriptionOne(auctionId, { id: lot.id, description: text })
      // Persist to pipeline DB so the applied text survives a reload
      await saveLot(lot.id, { kpStatus: "fixed", revised: text, description: text })
    } catch {
      setLots(prev => prev.map(l => l.id === lot.id ? { ...l, appliedDesc: prevApplied } : l))
    }
  }

  async function acceptAllKP() {
    const toApply = lots.filter(needsReview)
    if (!auctionId || toApply.length === 0) return
    setAccepting(true)
    for (const lot of toApply) await acceptKP(lot)
    setAccepting(false)
  }

  // ── Photo viewer ─────────────────────────────────────────────────────────────
  async function openPhotos(lot: PLot) {
    setPhotoLot(lot)
    const missing = lot.imageUrls.filter(k => !signedUrls[k])
    if (missing.length === 0) return
    const results = await Promise.all(
      missing.map(async key => {
        try {
          const res = await fetch(`/api/catalogue/signed-url?key=${encodeURIComponent(key)}`)
          const { url } = await res.json()
          return [key, url] as [string, string]
        } catch { return [key, ""] as [string, string] }
      })
    )
    setSignedUrls(prev => ({ ...prev, ...Object.fromEntries(results) }))
  }

  // ── Stage summary helpers ───────────────────────────────────────────────────
  function stageSummary(lots: PLot[], stage: "batch" | "dc" | "kp") {
    if (stage === "batch") {
      const ok      = lots.filter(l => l.batchStatus === "ok").length
      const skipped = lots.filter(l => l.batchStatus === "skipped").length
      return { ok, skipped, total: lots.length }
    }
    if (stage === "dc") {
      const ok      = lots.filter(l => l.dcStatus === "ok").length
      const issues  = lots.filter(l => l.dcStatus === "issues").length
      const skipped = lots.filter(l => l.dcStatus === "skipped").length
      return { ok, skipped, total: lots.length, issues }
    }
    // kp
    const ok      = lots.filter(l => l.kpStatus === "ok").length
    const fixed   = lots.filter(l => l.kpStatus === "fixed").length
    const pending = lots.filter(l => l.kpStatus === "pending").length
    const skipped = lots.filter(l => l.kpStatus === "skipped").length
    return { ok, skipped, total: lots.length, fixed, pending }
  }

  const batchSummary = stageSummary(lots, "batch")
  const dcSummary    = stageSummary(lots, "dc")
  const kpSummary    = stageSummary(lots, "kp")

  // A lot needs review/apply if it has AI-generated text that isn't yet on the catalogue lot,
  // or it was explicitly flagged pending by the KP stage.
  function needsReview(l: PLot): boolean {
    if (!l.kpRevised) return false
    if (l.kpStatus === "pending") return true
    return (l.kpRevised ?? "").trim() !== (l.appliedDesc ?? "").trim()
  }
  const reviewLots = lots.filter(needsReview)

  const stageOrder: PipelineStage[] = ["batch", "kpcheck", "doublecheck", "complete"]
  const stageIndex = stageOrder.indexOf(stage)

  const filtered = auctionList.filter(a => {
    const q = code.toLowerCase()
    return a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
  })

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">Auto Pipeline</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Runs Batch → Key Points → Double Check. Batch & Key Points auto-apply; Double Check holds its
          cleaned-up result for you to Review & Apply. Progress is saved — close the browser and resume any time.
        </p>
        <div className="mt-2 space-y-1">
          <p className="text-[11px] text-gray-600 dark:text-gray-500">Stage 1 (Batch) uses the Batch Preset selected below.</p>
          <ShowInstructionToggle instruction={KEY_POINTS_INSTRUCTION}   label="Stage 2 — Key Points instructions" />
          <ShowInstructionToggle instruction={DOUBLE_CHECK_INSTRUCTION} label="Stage 3 — Double Check instructions" />
        </div>
      </div>

      {/* Config */}
      <div className="bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-xl p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Auction code */}
          <div>
            <p className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider mb-1.5">Auction</p>
            <div ref={codeRef} className="relative">
              <input
                value={code}
                onChange={e => { setCode(e.target.value.toUpperCase()); setDropdownOpen(true) }}
                onFocus={() => setDropdownOpen(true)}
                placeholder="e.g. F073"
                className="w-full bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-[#C8A96E]"
              />
              {dropdownOpen && filtered.length > 0 && (
                <div className="absolute z-20 w-full mt-1 bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {filtered.slice(0, 20).map(a => (
                    <button key={a.code} onClick={() => { setCode(a.code); setDropdownOpen(false) }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300">
                      <span className="font-mono font-semibold mr-2">{a.code}</span>{a.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Preset */}
          <div>
            <p className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider mb-1.5">Batch Preset</p>
            <PresetSelector value={preset} onChange={setPreset} overrides={overrides} onEdit={() => setEditOpen(true)} />
            {editOpen && <PresetEditorModal presetKey={preset} initialText={overrides[preset] ?? PRESETS[preset]} onSave={savePreset} onClose={() => setEditOpen(false)} />}
          </div>
        </div>

        {/* Google Search grounding */}
        <label className={`flex items-center gap-2 cursor-pointer px-3 py-1.5 rounded-lg border transition-colors w-fit ${grounded ? "bg-blue-950/50 border-blue-600/60 text-blue-300" : "bg-gray-100 dark:bg-[#2C2C2E] border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-500"}`}>
          <input type="checkbox" checked={grounded} onChange={e => setGrounded(e.target.checked)}
            className="w-3.5 h-3.5 accent-blue-500" />
          <span className="text-xs font-medium">🔍 Google Search</span>
        </label>

        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={handleLoad} disabled={loading || !code.trim()}
            className="px-5 py-2 bg-[#C8A96E] hover:bg-[#b8945a] disabled:opacity-40 text-black font-semibold text-sm rounded-lg transition-colors">
            {loading ? "Loading…" : "Load Auction"}
          </button>
          {lots.length > 0 && !running && (
            <button onClick={handleReset}
              className="px-4 py-2 text-xs border border-gray-600 text-gray-600 dark:text-gray-400 hover:border-red-500 hover:text-red-400 rounded-lg transition-colors">
              ↺ Reset Progress
            </button>
          )}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      {/* Stage cards */}
      {lots.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {([
            { key: "batch",       label: "1. Batch Run",          s: batchSummary, stageVal: "batch" as const,       icon: "⚡" },
            { key: "kpcheck",     label: "2. Key Points Check",    s: kpSummary,    stageVal: "kpcheck" as const,     icon: "✓"  },
            { key: "doublecheck", label: "3. Double Check",        s: dcSummary,    stageVal: "doublecheck" as const, icon: "🔎" },
          ] as const).map(({ key, label, s, stageVal, icon }) => {
            const isActive   = stage === stageVal && running
            const isDone     = stageOrder.indexOf(stageVal) < stageIndex
            const isUpcoming = stageOrder.indexOf(stageVal) > stageIndex && !running
            const processed  = s.ok + s.skipped + ("issues" in s ? s.issues! : 0) + ("fixed" in s ? s.fixed! : 0)
            return (
              <div key={key} className={`rounded-xl border p-4 space-y-2 transition-colors ${
                isActive   ? "border-[#C8A96E]/60 bg-[#C8A96E]/10"
                : isDone   ? "border-green-700/50 bg-green-950/20"
                : isUpcoming ? "border-gray-700 bg-gray-900/20 opacity-50"
                : "border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#1C1C1E]"
              }`}>
                <div className="flex items-center gap-2">
                  <span>{icon}</span>
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">{label}</p>
                  {isDone    && <span className="ml-auto text-xs text-green-400">✓ Done</span>}
                  {isActive  && <span className="ml-auto text-xs text-[#C8A96E] animate-pulse">Running…</span>}
                </div>
                {processed > 0 && (
                  <div className="space-y-0.5 text-xs text-gray-600 dark:text-gray-500">
                    {s.ok > 0          && <p className="text-green-400">✓ {s.ok} OK{"fixed" in s && s.fixed! > 0 ? ` · ${s.fixed} accepted` : ""}</p>}
                    {"pending" in s && s.pending! > 0 && <p className="text-amber-400">⏳ {s.pending} awaiting review</p>}
                    {"issues" in s && s.issues! > 0 && <p className="text-yellow-400">⚑ {s.issues} cleaned — review below</p>}
                    {s.skipped > 0     && <p className="text-gray-500">— {s.skipped} skipped</p>}
                  </div>
                )}
                {isActive && progress && key === stage && (
                  <div className="w-full bg-gray-700 rounded-full h-1.5">
                    <div className="bg-[#C8A96E] h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Run / control buttons */}
      {lots.length > 0 && stage !== "complete" && (
        <div className="flex items-center gap-3 flex-wrap">
          {!running ? (
            <button onClick={handleRun} disabled={!auctionId}
              className="px-5 py-2.5 bg-[#C8A96E] hover:bg-[#b8945a] disabled:opacity-40 text-black font-semibold text-sm rounded-lg transition-colors">
              {stageIndex > 0 ? `▶ Resume Pipeline (from ${stage})` : "▶ Start Pipeline"}
            </button>
          ) : (
            <>
              {paused
                ? <button onClick={handleResume} className="px-5 py-2.5 bg-green-700 hover:bg-green-600 text-white font-semibold text-sm rounded-lg transition-colors">▶ Resume</button>
                : <button onClick={handlePause}  className="px-5 py-2.5 bg-yellow-700/60 hover:bg-yellow-700 border border-yellow-600 text-yellow-300 font-semibold text-sm rounded-lg transition-colors">⏸ Pause</button>
              }
              <button onClick={handleStop} className="px-5 py-2.5 bg-red-900/50 hover:bg-red-900/80 border border-red-700 text-red-300 font-semibold text-sm rounded-lg transition-colors">⛔ Stop</button>
            </>
          )}
          {progress && (
            <span className="text-xs text-gray-600 dark:text-gray-400">{progress.done} / {progress.total}</span>
          )}
        </div>
      )}

      {stage === "complete" && (
        reviewLots.length > 0 ? (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-950/30 border border-amber-600/50 text-amber-300 text-sm">
            <span className="text-xl">⏳</span>
            <span>{reviewLots.length} lots need reviewing & applying to the catalogue — see below</span>
          </div>
        ) : (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-green-950/30 border border-green-700/50 text-green-300 text-sm">
            <span className="text-xl">🎉</span>
            <span>Pipeline complete — all descriptions applied for <span className="font-mono font-bold">{code.trim().toUpperCase()}</span></span>
          </div>
        )
      )}

      {/* Log */}
      {log.length > 0 && (
        <div ref={logRef} className="bg-gray-100 dark:bg-[#0d0d0f] border border-gray-200 dark:border-gray-800 rounded-xl p-3 max-h-56 overflow-y-auto font-mono text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
          {log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}

      {/* Review & Apply section */}
      {reviewLots.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-amber-300">
              ✓ Review & Apply — {reviewLots.length} lots with descriptions to apply to the catalogue
            </h3>
            <button onClick={acceptAllKP} disabled={accepting}
              className="px-4 py-1.5 text-xs bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors">
              {accepting ? "Applying…" : `Apply All (${reviewLots.length})`}
            </button>
          </div>
          <div className="space-y-2">
            {reviewLots.map(lot => (
              <div key={lot.id} className="border border-amber-700/50 bg-amber-950/10 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-white">{lot.label}</span>
                    {lot.kpAdded && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-400 font-medium">KP added</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {lot.imageUrls.length > 0 && (
                      <button onClick={() => openPhotos(lot)}
                        className="px-3 py-1 text-xs border border-gray-600 text-gray-400 hover:border-gray-400 hover:text-white rounded-lg transition-colors">
                        📷 View Photo
                      </button>
                    )}
                    <button onClick={() => acceptKP(lot)}
                      className="px-3 py-1 text-xs bg-green-700 hover:bg-green-600 text-white font-semibold rounded-lg transition-colors">
                      Apply
                    </button>
                  </div>
                </div>

                {/* Key points */}
                {lot.keyPoints?.trim() && (
                  <div className="bg-black/20 rounded-lg px-3 py-2 border border-gray-700">
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Key Points</p>
                    <p className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed">{lot.keyPoints.trim()}</p>
                    {lot.kpAdded && (
                      <p className="text-xs text-amber-400 mt-1.5">➕ Added: {lot.kpAdded}</p>
                    )}
                    {lot.kpMissing && (
                      <p className="text-xs text-red-400 mt-0.5">⚠ Was missing: {lot.kpMissing}</p>
                    )}
                    {lot.kpFound && (
                      <div className="mt-1.5">
                        <p className="text-[10px] text-green-500 uppercase tracking-wider mb-0.5">Evidence matched</p>
                        <p className="text-xs text-green-400 leading-relaxed">{lot.kpFound}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Double Check findings */}
                {(lot.dcStatus === "issues" || lot.contradictions?.trim() || lot.unsupported?.trim()) && (
                  <div className="bg-black/20 rounded-lg px-3 py-2 border border-indigo-800/40">
                    <p className="text-[10px] uppercase tracking-wider text-indigo-400 mb-1">🔎 Double Check {lot.dcStatus === "issues" ? "— issues found & corrected" : "— clean"}</p>
                    {lot.contradictions?.trim() && (
                      <p className="text-xs text-red-300 leading-relaxed"><span className="text-red-400 font-medium">Contradictions: </span>{lot.contradictions.trim()}</p>
                    )}
                    {lot.unsupported?.trim() && (
                      <p className="text-xs text-amber-300 leading-relaxed mt-0.5"><span className="text-amber-400 font-medium">Unsupported: </span>{lot.unsupported.trim()}</p>
                    )}
                    {!lot.contradictions?.trim() && !lot.unsupported?.trim() && (
                      <p className="text-xs text-gray-400">No issues flagged.</p>
                    )}
                    {/* Before/after text — only available for runs where the raw batch text was preserved */}
                    {lot.batchDesc?.trim() && lot.batchDesc.trim() !== (lot.currentDesc ?? "").trim() && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2 pt-2 border-t border-indigo-900/40">
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Before DC (raw batch)</p>
                          <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap">{lot.batchDesc.trim()}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-indigo-400 mb-0.5">After DC</p>
                          <p className="text-xs text-gray-200 leading-relaxed whitespace-pre-wrap">{lot.currentDesc}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <p className="text-[10px] uppercase tracking-wider text-amber-400 mb-1">Description — edit before applying</p>
                  <textarea
                    value={lot.kpRevised ?? ""}
                    onChange={e => setLots(prev => prev.map(l => l.id === lot.id ? { ...l, kpRevised: e.target.value } : l))}
                    rows={8}
                    className="w-full text-xs bg-black/30 border border-amber-700/40 rounded-lg px-3 py-2 text-gray-200 leading-relaxed resize-y focus:outline-none focus:border-amber-500"
                  />
                  {(lot.appliedDesc ?? "").trim() && (lot.appliedDesc ?? "").trim() !== (lot.kpRevised ?? "").trim() && (
                    <details className="mt-2">
                      <summary className="text-[10px] uppercase tracking-wider text-gray-500 cursor-pointer">Currently on catalogue</summary>
                      <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap mt-1">{lot.appliedDesc}</p>
                    </details>
                  )}
                </div>
                <div className="flex justify-end">
                  <button onClick={() => setLots(prev => prev.map(l => l.id === lot.id ? { ...l, kpStatus: "skipped", kpRevised: undefined } : l))}
                    className="px-3 py-1 text-xs border border-gray-600 text-gray-500 hover:border-red-500 hover:text-red-400 rounded-lg transition-colors">
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results table — shown once any lot has results */}
      {lots.some(l => l.batchStatus || l.dcStatus || l.kpStatus) && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Results</h3>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-100 dark:bg-[#1a1a1c] border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-3 py-2 text-gray-500 dark:text-gray-400 font-medium w-32">Lot</th>
                  <th className="text-left px-3 py-2 text-gray-500 dark:text-gray-400 font-medium">⚡ Batch</th>
                  <th className="text-left px-3 py-2 text-gray-500 dark:text-gray-400 font-medium">🔎 Double Check</th>
                  <th className="text-left px-3 py-2 text-gray-500 dark:text-gray-400 font-medium">✓ Key Points</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {lots.map((lot, i) => {
                  const batchCell = !lot.batchStatus ? (
                    <span className="text-gray-500">—</span>
                  ) : lot.batchStatus === "ok" ? (
                    <span className="text-green-400">✓ Generated{lot.estimate ? ` · ${lot.estimate}` : ""}</span>
                  ) : (
                    <span className="text-gray-500">— Skipped</span>
                  )

                  const dcCell = !lot.dcStatus ? (
                    <span className="text-gray-500">—</span>
                  ) : lot.dcStatus === "ok" ? (
                    <span className="text-green-400">✓ Clean</span>
                  ) : lot.dcStatus === "issues" ? (
                    <span className="text-yellow-400">⚑ Fixed{lot.contradictions ? ` · ${lot.contradictions}` : ""}</span>
                  ) : (
                    <span className="text-gray-500">— Skipped</span>
                  )

                  const kpCell = !lot.kpStatus ? (
                    <span className="text-gray-500">—</span>
                  ) : lot.kpStatus === "ok" ? (
                    <span className="text-green-400">✓ All present</span>
                  ) : lot.kpStatus === "pending" ? (
                    <span className="text-amber-400">⏳ Review needed</span>
                  ) : lot.kpStatus === "fixed" ? (
                    <span className="text-green-400">✓ Accepted{lot.kpAdded ? ` · ${lot.kpAdded}` : ""}</span>
                  ) : (
                    <span className="text-gray-500">— Skipped</span>
                  )

                  return (
                    <tr key={lot.id}
                      className={`border-b border-gray-100 dark:border-gray-800 last:border-0 ${i % 2 === 0 ? "bg-white dark:bg-transparent" : "bg-gray-50 dark:bg-white/[0.02]"}`}>
                      <td className="px-3 py-2 font-mono text-gray-600 dark:text-gray-400 truncate max-w-[8rem]">{lot.label}</td>
                      <td className="px-3 py-2">{batchCell}</td>
                      <td className="px-3 py-2">{dcCell}</td>
                      <td className="px-3 py-2">{kpCell}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {lot.debug && (
                          <button onClick={() => setDebugLot(lot)}
                            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors mr-3">
                            🔍 AI log
                          </button>
                        )}
                        {lot.imageUrls.length > 0 && (
                          <button onClick={() => openPhotos(lot)}
                            className="text-xs text-gray-500 hover:text-gray-200 transition-colors">
                            📷 View Photo
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Photo viewer modal */}
      {photoLot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setPhotoLot(null)}>
          <div className="bg-[#1C1C1E] border border-gray-700 rounded-2xl p-5 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="font-mono font-semibold text-white">{photoLot.label}</span>
              <button onClick={() => setPhotoLot(null)} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
            </div>
            {photoLot.imageUrls.length === 0 ? (
              <p className="text-gray-500 text-sm">No photos</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {photoLot.imageUrls.map((key, i) => (
                  <div key={key} className="aspect-square rounded-xl overflow-hidden bg-[#2C2C2E] flex items-center justify-center">
                    {signedUrls[key] ? (
                      <img src={signedUrls[key]} alt={`Photo ${i + 1}`} className="w-full h-full object-contain" />
                    ) : (
                      <span className="text-gray-600 text-xs">Loading…</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Per-lot AI log — exactly what was sent to Gemini and what came back at each stage */}
      {debugLot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setDebugLot(null)}>
          <div className="bg-[#1C1C1E] border border-gray-700 rounded-2xl p-5 max-w-3xl w-full max-h-[90vh] overflow-y-auto space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between sticky top-0 bg-[#1C1C1E] pb-2">
              <span className="font-mono font-semibold text-white">🔍 AI log — {debugLot.label}</span>
              <button onClick={() => setDebugLot(null)} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
            </div>
            <p className="text-xs text-gray-500">Exact prompt sent and raw response received at each stage (this session only — not saved). The full system instruction for each stage is in the toggles at the top of the tab.</p>

            {([
              { key: "batch", title: "⚡ Stage 1 — Batch", d: debugLot.debug?.batch },
              { key: "kp",    title: "✓ Stage 2 — Key Points", d: debugLot.debug?.kp },
              { key: "dc",    title: "🔎 Stage 3 — Double Check", d: debugLot.debug?.dc },
            ] as const).map(({ key, title, d }) => (
              <div key={key} className="border border-gray-700 rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-[#141416] border-b border-gray-700 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-200">{title}</span>
                  {d && "imageCount" in d && <span className="text-[10px] text-gray-500">{d.imageCount} image{d.imageCount === 1 ? "" : "s"} sent</span>}
                </div>
                {!d ? (
                  <p className="px-3 py-2 text-xs text-gray-600 italic">Not run yet.</p>
                ) : (
                  <div className="divide-y divide-gray-800">
                    <div className="px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Sent (prompt)</p>
                      <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono leading-relaxed max-h-52 overflow-y-auto">{d.prompt}</pre>
                    </div>
                    <div className="px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Received (raw response)</p>
                      <pre className="text-xs text-green-300 whitespace-pre-wrap font-mono leading-relaxed max-h-52 overflow-y-auto">{d.response}</pre>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── AI Upgrade Tab ──────────────────────────────────────────────────────────

type UpgradeLot = {
  id:          string
  label:       string
  description: string
  selected:    boolean
  status:      "idle" | "running" | "done" | "skipped"
  revised?:    string
  accepted:    boolean
}

const UPGRADE_MODES = [
  { key: "shorten",          label: "Shorten",                desc: "Remove padding, tighten verbose descriptions" },
  { key: "expand",           label: "Add more detail",        desc: "Expand sparse descriptions with useful context" },
  { key: "humanise",         label: "Humanise",               desc: "Remove AI-robotic phrasing, make it read naturally" },
  { key: "grammar",          label: "Fix grammar",            desc: "Spelling, punctuation and sentence structure" },
  { key: "format",           label: "Standardise format",     desc: "Consistent bullets, capitalisation and spacing" },
  { key: "condition",        label: "Expand condition notes", desc: "More specific about defects and completeness" },
  { key: "no_hyperbole",     label: "Remove hyperbole",       desc: "Strip vague positives and sales-speak" },
  { key: "auction_language", label: "Auction language",       desc: "Reinforce lot/catalogue-appropriate terminology" },
]

function UpgradeTab({ model: globalModel, fallbackModel }: { model: string; fallbackModel: string }) {
  const [code,         setCode]         = useState("")
  const [auctionId,    setAuctionId]    = useState<string | null>(null)
  const [lots,         setLots]         = useState<UpgradeLot[]>([])
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [running,      setRunning]      = useState(false)
  const [paused,       setPaused]       = useState(false)
  const [progress,     setProgress]     = useState<{ done: number; total: number } | null>(null)
  const [log,          setLog]          = useState<string[]>([])
  const [modes,        setModes]        = useState<Set<string>>(new Set(["humanise", "grammar"]))
  const [auctionList,  setAuctionList]  = useState<{ code: string; name: string }[]>([])
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [showResults,  setShowResults]  = useState(false)
  const [accepting,    setAccepting]    = useState(false)
  const localModel  = globalModel
  const cancelRef   = useRef(false)
  const pauseRef    = useRef(false)
  const logRef      = useRef<HTMLDivElement>(null)
  const codeRef     = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch("/api/auction-ai/auctions").then(r => r.json()).then(d => { if (Array.isArray(d)) setAuctionList(d) }).catch(() => {})
  }, [])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (codeRef.current && !codeRef.current.contains(e.target as Node)) setDropdownOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  function addLog(msg: string) {
    const ts = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    setLog(l => [...l, `[${ts}]  ${msg}`])
    setTimeout(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }), 50)
  }

  function toggleMode(key: string) {
    setModes(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function handleLoad() {
    const upper = code.trim().toUpperCase()
    if (!upper) return
    setLoading(true); setError(null); setLots([]); setAuctionId(null); setLog([]); setProgress(null); setShowResults(false)
    try {
      const res = await fetch(`/api/auction-ai/catalogue-lots?code=${encodeURIComponent(upper)}`)
      if (!res.ok) throw new Error((await res.json()).error ?? "Catalogue not found")
      const data = await res.json()
      setAuctionId(data.auctionId ?? null)
      const loaded: UpgradeLot[] = data.lots
        .filter((l: any) => l.description?.trim())
        .map((l: any) => ({
          id:          l.id,
          label:       l.barcode || l.receiptUniqueId || l.id,
          description: l.description,
          selected:    true,
          status:      "idle" as const,
          accepted:    false,
        }))
      if (loaded.length === 0) throw new Error(`No lots with descriptions found for "${upper}".`)
      setLots(loaded)
      addLog(`✓ Loaded ${loaded.length} lots with descriptions`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleRun() {
    if (!auctionId || modes.size === 0) return
    cancelRef.current = false
    pauseRef.current  = false
    setRunning(true); setPaused(false); setShowResults(false)
    const toRun = lots.filter(l => l.selected && l.status === "idle")
    addLog(`── AI Upgrade — ${toRun.length} lots · modes: ${Array.from(modes).join(", ")}`)
    let done = 0
    const working = [...lots]

    for (const lot of toRun) {
      if (cancelRef.current) break
      while (pauseRef.current && !cancelRef.current) await new Promise(r => setTimeout(r, 500))
      if (cancelRef.current) break

      const idx = working.findIndex(l => l.id === lot.id)
      working[idx] = { ...working[idx], status: "running" }
      setLots([...working])
      addLog(`  · ${done + 1}/${toRun.length} ${lot.label}…`)

      let lastError = ""
      let attempt   = 0
      let succeeded = false

      while (!cancelRef.current) {
        if (attempt > 0) {
          const isRL = lastError.startsWith("RATE_LIMITED:")
          const wait = isRL ? Math.min(60000 * Math.pow(2, attempt - 1), 1800000) : Math.min(attempt * 12000, 30000)
          addLog(`↺ ${lot.label} — ${isRL ? "rate limited, waiting" : "retrying in"} ${wait / 1000}s (attempt ${attempt + 1})…`)
          await new Promise(r => setTimeout(r, wait))
          if (cancelRef.current) break
        }
        attempt++

        try {
          const modelToUse = (attempt % 2 === 0 && fallbackModel) ? fallbackModel : localModel
          if (attempt > 1) addLog(`  ↳ ${lot.label} trying ${modelToUse}`)

          const res  = await fetch("/api/auction-ai/upgrade", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ description: lot.description, modes: Array.from(modes), model: modelToUse }),
          })
          const json = await res.json()
          if (json.error) throw new Error(json.error)

          working[idx] = { ...working[idx], status: "done", revised: json.revised }
          setLots([...working])
          succeeded = true
          done++
          setProgress({ done, total: toRun.length })
          break
        } catch (e: any) {
          lastError = e.message ?? String(e)
          if (lastError.startsWith("BLOCKED:")) {
            working[idx] = { ...working[idx], status: "skipped" }
            setLots([...working])
            addLog(`✗ ${lot.label} — blocked, skipping`)
            done++; setProgress({ done, total: toRun.length })
            succeeded = true
            break
          }
        }
      }

      if (!succeeded) {
        working[idx] = { ...working[idx], status: "skipped" }
        setLots([...working])
        done++; setProgress({ done, total: toRun.length })
      }
    }

    setRunning(false)
    setShowResults(true)
    const doneCount = working.filter(l => l.status === "done").length
    addLog(`── Complete — ${doneCount} revised`)
  }

  async function acceptLot(lot: UpgradeLot) {
    if (!auctionId || !lot.revised) return
    const working = [...lots]
    const idx = working.findIndex(l => l.id === lot.id)
    working[idx] = { ...working[idx], accepted: true }
    setLots([...working])
    try {
      await applyAiDescriptionOne(auctionId, { id: lot.id, description: lot.revised })
    } catch (e: any) {
      const revert = [...lots]
      revert[idx] = { ...revert[idx], accepted: false }
      setLots([...revert])
      setError(`Failed to save ${lot.label}: ${e.message}`)
    }
  }

  async function acceptAll() {
    const toAccept = lots.filter(l => l.status === "done" && !l.accepted && l.revised)
    if (!auctionId || toAccept.length === 0) return
    setAccepting(true)
    for (const lot of toAccept) await acceptLot(lot)
    setAccepting(false)
  }

  const filtered = auctionList.filter(a => {
    const q = code.toLowerCase()
    return a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
  })

  const pendingCount  = lots.filter(l => l.status === "done" && !l.accepted).length
  const acceptedCount = lots.filter(l => l.accepted).length
  const conflictModes = modes.has("shorten") && modes.has("expand")

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">AI Upgrade</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Run mass description rewrites against an entire auction. Pick your transformation modes, run, then review the before/after and accept what you want.
        </p>
      </div>

      {/* Config */}
      <div className="bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-xl p-4 space-y-4">
        {/* Auction picker */}
        <div className="max-w-xs">
          <p className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider mb-1.5">Auction</p>
          <div ref={codeRef} className="relative">
            <input
              value={code}
              onChange={e => { setCode(e.target.value.toUpperCase()); setDropdownOpen(true) }}
              onFocus={() => setDropdownOpen(true)}
              placeholder="e.g. F073"
              disabled={running}
              className="w-full bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-[#C8A96E] disabled:opacity-50"
            />
            {dropdownOpen && filtered.length > 0 && (
              <div className="absolute z-20 w-full mt-1 bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {filtered.slice(0, 20).map(a => (
                  <button key={a.code} onClick={() => { setCode(a.code); setDropdownOpen(false) }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300">
                    <span className="font-mono font-semibold mr-2">{a.code}</span>{a.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Mode picker */}
        <div>
          <p className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider mb-2">Transformation Modes</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {UPGRADE_MODES.map(m => (
              <label key={m.key} title={m.desc}
                className={`flex items-start gap-2 cursor-pointer px-3 py-2 rounded-lg border transition-colors text-xs ${
                  modes.has(m.key)
                    ? "bg-[#C8A96E]/15 border-[#C8A96E]/60 text-[#C8A96E]"
                    : "bg-white dark:bg-[#1C1C1E] border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-500"
                }`}>
                <input type="checkbox" checked={modes.has(m.key)} onChange={() => toggleMode(m.key)}
                  className="mt-0.5 w-3.5 h-3.5 accent-[#C8A96E] shrink-0" />
                <div>
                  <div className="font-medium leading-tight">{m.label}</div>
                  <div className="text-[10px] opacity-60 mt-0.5 leading-tight">{m.desc}</div>
                </div>
              </label>
            ))}
          </div>
          {conflictModes && (
            <p className="text-xs text-amber-400 mt-2">⚠ Shorten and Add more detail are opposites — the AI will attempt both but results may vary.</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={handleLoad} disabled={loading || running || !code.trim()}
            className="px-5 py-2 bg-[#C8A96E] hover:bg-[#b8945a] disabled:opacity-40 text-black font-semibold text-sm rounded-lg transition-colors">
            {loading ? "Loading…" : "Load Auction"}
          </button>
          {lots.length > 0 && !running && (
            <button onClick={handleRun} disabled={modes.size === 0 || lots.filter(l => l.selected && l.status === "idle").length === 0}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold text-sm rounded-lg transition-colors">
              Run Upgrade ({lots.filter(l => l.selected && l.status === "idle").length} lots)
            </button>
          )}
          {running && (
            <>
              {!paused
                ? <button onClick={() => { pauseRef.current = true; setPaused(true); addLog("⏸ Paused — finishing current lot…") }}
                    className="px-4 py-2 text-xs border border-amber-600 text-amber-400 rounded-lg">⏸ Pause</button>
                : <button onClick={() => { pauseRef.current = false; setPaused(false); addLog("▶ Resumed") }}
                    className="px-4 py-2 text-xs border border-green-600 text-green-400 rounded-lg">▶ Resume</button>
              }
              <button onClick={() => { cancelRef.current = true }}
                className="px-4 py-2 text-xs border border-red-600 text-red-400 rounded-lg">⛔ Stop</button>
            </>
          )}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      {/* Lot list */}
      {lots.length > 0 && (
        <div className="bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider">
              {lots.length} lots loaded · {lots.filter(l => l.selected).length} selected
            </p>
            <div className="flex gap-2">
              <button onClick={() => setLots(prev => prev.map(l => ({ ...l, selected: true })))}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-white px-2 py-1 rounded border border-gray-600 hover:border-gray-400 transition-colors">
                Select all
              </button>
              <button onClick={() => setLots(prev => prev.map(l => ({ ...l, selected: false })))}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-white px-2 py-1 rounded border border-gray-600 hover:border-gray-400 transition-colors">
                Deselect all
              </button>
            </div>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5 max-h-36 overflow-y-auto pr-1">
            {lots.map(l => (
              <button key={l.id} onClick={() => !running && setLots(prev => prev.map(x => x.id === l.id ? { ...x, selected: !x.selected } : x))}
                className={`text-xs px-2 py-1.5 rounded border transition-colors font-mono ${
                  l.status === "done" && l.accepted  ? "border-green-600 bg-green-950/30 text-green-400"
                  : l.status === "done"              ? "border-indigo-600 bg-indigo-950/30 text-indigo-300"
                  : l.status === "running"           ? "border-[#C8A96E]/60 bg-[#C8A96E]/10 text-[#C8A96E] animate-pulse"
                  : l.status === "skipped"           ? "border-gray-600 bg-gray-900/20 text-gray-500"
                  : l.selected                       ? "border-gray-500 bg-gray-200 dark:bg-[#3C3C3E] text-gray-900 dark:text-white"
                  :                                    "border-gray-700 bg-transparent text-gray-600 opacity-50"
                }`}>
                {l.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Log */}
      {log.length > 0 && (
        <div ref={logRef} className="bg-black/40 border border-gray-700 rounded-xl p-4 font-mono text-xs text-gray-400 space-y-0.5 max-h-40 overflow-y-auto">
          {log.map((l, i) => <div key={i}>{l}</div>)}
          {progress && <div className="text-[#C8A96E]">Progress: {progress.done}/{progress.total}</div>}
        </div>
      )}

      {/* Results */}
      {showResults && lots.some(l => l.status === "done") && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">
              Review — {pendingCount} pending · {acceptedCount} accepted
            </p>
            {pendingCount > 0 && (
              <button onClick={acceptAll} disabled={accepting}
                className="px-4 py-2 text-sm bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors">
                {accepting ? "Accepting…" : `Accept All (${pendingCount})`}
              </button>
            )}
          </div>
          <div className="space-y-3">
            {lots.filter(l => l.status === "done" && l.revised).map(lot => (
              <div key={lot.id} className={`border rounded-xl p-4 space-y-3 transition-colors ${lot.accepted ? "border-green-700/50 bg-green-950/10" : "border-indigo-700/50 bg-indigo-950/10"}`}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-semibold text-white">{lot.label}</span>
                  {lot.accepted
                    ? <span className="text-xs text-green-400 font-medium">✓ Accepted</span>
                    : <button onClick={() => acceptLot(lot)}
                        className="px-3 py-1 text-xs bg-green-700 hover:bg-green-600 text-white font-semibold rounded-lg transition-colors">
                        Accept
                      </button>
                  }
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Before</p>
                    <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap">{lot.description}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-indigo-400 mb-1">After</p>
                    <p className="text-xs text-gray-200 leading-relaxed whitespace-pre-wrap">{lot.revised}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

type TabDef = { id: Tab; label: string; icon: string; accent?: string }

const TAB_GROUPS: { label: string; tabs: TabDef[] }[] = [
  {
    label: "Chat",
    tabs: [
      { id: "chat",         label: "Chat Window",        icon: "💬" },
    ],
  },
  {
    label: "Run",
    tabs: [
      { id: "batch",        label: "Batch Run",          icon: "⚡" },
      { id: "kpcheck",      label: "Key Points Check",   icon: "✓"  },
      { id: "doublecheck",  label: "Double Check",       icon: "🔎" },
      { id: "pipeline",     label: "Auto Pipeline",      icon: "🔄", accent: "#C8A96E" },
      { id: "upgrade",      label: "AI Upgrade",         icon: "✨", accent: "#6366f1" },
    ],
  },
  {
    label: "History",
    tabs: [
      { id: "runs",         label: "Saved Runs",         icon: "🗂" },
      { id: "kpruns",       label: "KP Check Runs",      icon: "📋" },
    ],
  },
  {
    label: "Tools",
    tabs: [
      { id: "copier",       label: "Description Copier", icon: "📄" },
      { id: "barcode",      label: "Barcode Sorter",     icon: "▦"  },
    ],
  },
  {
    label: "Reference",
    tabs: [
      { id: "instructions", label: "Instructions",       icon: "📝" },
      { id: "macro",        label: "Macro Downloader",   icon: "⌨️" },
    ],
  },
]

// Flat list for compatibility with allowedSections filtering
const TABS: TabDef[] = TAB_GROUPS.flatMap(g => g.tabs)

// ─── Main ─────────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = "gemini-3-flash-preview"

export default function AuctionAIPage() {
  const [tab,           setTab]           = useState<Tab>("chat")
  const [model,         setModel]         = useState(() => (typeof window !== "undefined" ? localStorage.getItem("ai_model") ?? DEFAULT_MODEL : DEFAULT_MODEL))
  const [fallbackModel, setFallbackModel] = useState(() => (typeof window !== "undefined" ? localStorage.getItem("ai_fallback_model") ?? "" : ""))
  const [modelList,     setModelList]     = useState<string[]>([DEFAULT_MODEL])
  const [allowedSections, setAllowedSections] = useState<string[] | null>(null)
  const [sectionsLoaded,  setSectionsLoaded]  = useState(false)

  useEffect(() => {
    fetch("/api/user/section-access/AUCTION_AI")
      .then(r => r.json())
      .then(({ allowed }: { allowed: string[] | null }) => {
        setAllowedSections(allowed)
        setSectionsLoaded(true)
        // If current tab is not allowed, switch to first allowed
        if (allowed && !allowed.includes(tab)) {
          setTab((allowed[0] as Tab) ?? "chat")
        }
      })
      .catch(() => setSectionsLoaded(true))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get("tab") as Tab | null
    if (t && TABS.some(x => x.id === t)) setTab(t)
  }, [])

  useEffect(() => {
    fetch("/api/auction-ai/models")
      .then(r => r.json())
      .then(j => { if (j.models?.length) setModelList(j.models) })
      .catch(() => {})
  }, [])

  return (
    <div className="flex h-[calc(100vh-48px)] bg-white dark:bg-[#1C1C1E] text-gray-900 dark:text-white overflow-hidden">
      <ToastContainer />

      <aside className="w-52 bg-gray-50 dark:bg-[#141416] border-r border-gray-200 dark:border-gray-800 flex flex-col flex-shrink-0">
        <div className="px-4 py-5 border-b border-gray-200 dark:border-gray-800">
          <p className="text-gray-900 dark:text-white font-bold text-base tracking-wide">AUCTION AI</p>
          <p className="text-[#C8A96E] text-xs mt-0.5 tracking-widest uppercase">Vectis</p>
        </div>
        <div className="flex-1 px-3 py-3 overflow-y-auto space-y-3">
          {TAB_GROUPS.map(group => {
            const visibleTabs = group.tabs.filter(t => !allowedSections || allowedSections.includes(t.id))
            if (visibleTabs.length === 0) return null
            return (
              <div key={group.label}>
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-600">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {visibleTabs.map(t => {
                    const accent = t.accent ?? "#C8A96E"
                    const active = tab === t.id
                    return (
                      <button key={t.id} onClick={() => setTab(t.id)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded text-sm font-medium transition-colors text-left"
                        style={{
                          background: active ? accent + "1a" : "",
                          color: active ? accent : "#9ca3af",
                          border: active ? `1px solid ${accent}4d` : "1px solid transparent",
                        }}>
                        <span className="text-base leading-none">{t.icon}</span>
                        <span className="truncate">{t.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 space-y-2.5">
          <div className="space-y-1">
            <p className="text-gray-600 text-xs uppercase tracking-wider">Model</p>
            <select value={model} onChange={e => { setModel(e.target.value); localStorage.setItem("ai_model", e.target.value) }}
              className="w-full bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-xs text-gray-600 dark:text-gray-300 focus:outline-none focus:border-[#C8A96E]">
              {modelList.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <p className="text-gray-600 text-xs uppercase tracking-wider">Fallback Model <span className="normal-case text-gray-700">(rate limit)</span></p>
            <select value={fallbackModel} onChange={e => { setFallbackModel(e.target.value); localStorage.setItem("ai_fallback_model", e.target.value) }}
              className="w-full bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-xs text-gray-600 dark:text-gray-300 focus:outline-none focus:border-[#C8A96E]">
              <option value="">— none —</option>
              {modelList.filter(m => m !== model).map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-6">
        <div className={tab === "chat"         ? "" : "hidden"}><ChatTab model={model} /></div>
        <div className={tab === "batch"        ? "" : "hidden"}><BatchTab model={model} fallbackModel={fallbackModel} /></div>
        <div className={tab === "runs"         ? "" : "hidden"}>{tab === "runs"   && <SavedRunsTab />}</div>
        <div className={tab === "kpruns"       ? "" : "hidden"}>{tab === "kpruns" && <KPRunsTab />}</div>
        <div className={tab === "barcode"      ? "" : "hidden"}><BarcodeTab /></div>
        <div className={tab === "copier"       ? "" : "hidden"}><CopierTab /></div>
        <div className={tab === "kpcheck"      ? "" : "hidden"}><KeyPointsCheckTab model={model} fallbackModel={fallbackModel} onModelChange={m => { setModel(m); localStorage.setItem("ai_model", m) }} /></div>
        <div className={tab === "doublecheck"  ? "" : "hidden"}>{tab === "doublecheck" && <DoubleCheckTab model={model} fallbackModel={fallbackModel} onModelChange={m => { setModel(m); localStorage.setItem("ai_model", m) }} />}</div>
        <div className={tab === "pipeline"     ? "" : "hidden"}>{tab === "pipeline" && <PipelineTab model={model} fallbackModel={fallbackModel} />}</div>
        <div className={tab === "upgrade"      ? "" : "hidden"}>{tab === "upgrade"   && <UpgradeTab model={model} fallbackModel={fallbackModel} />}</div>
        <div className={tab === "instructions" ? "" : "hidden"}><InstructionsTab /></div>
        <div className={tab === "macro"        ? "" : "hidden"}><MacroTab /></div>
      </main>
    </div>
  )
}

