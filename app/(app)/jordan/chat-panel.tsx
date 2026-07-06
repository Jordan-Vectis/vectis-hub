"use client"

import { useEffect, useRef, useState } from "react"
import ModelPicker, { getJordanModel } from "./model-picker"

// Shared retro-terminal chat panel for the secret menu. History persists per
// browser in localStorage (per storageKey) so a refresh doesn't wipe the chat.
//
// Theming: colours read the CSS variables --jsys-acc / --jsys-dim / --jsys-glow
// with a GREEN fallback, so anything that doesn't set them (e.g. Cooking) stays
// green, while ASK AI's persona shell overrides them to recolour the whole panel.

// images (display) is the array of data URLs shown in the bubble; imgs is a
// lightweight fallback count kept when the heavy data URLs are stripped before
// persisting to localStorage (so a refresh doesn't blow the storage quota).
type Msg = { role: "user" | "model"; text: string; queries?: string[]; images?: string[]; imgs?: number }
// A pending attachment: url = data URL for preview, data = base64 (no prefix) + mime for the API.
type Attn = { url: string; mime: string; data: string }

const ACC = "var(--jsys-acc, #33ff66)"
const DIM = "var(--jsys-dim, #1f5c33)"
const GLOW = "var(--jsys-glow, #0a2214)"
const MAX_IMAGES = 6

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src })
}

// Read a file, downscale to <=1280px and re-encode as JPEG so the base64 payload
// stays small (phone photos are huge). Falls back to the raw file on any failure.
async function processImage(file: File): Promise<Attn> {
  const dataUrl: string = await new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("read failed")); r.readAsDataURL(file)
  })
  const toAttn = (url: string, fallbackMime: string): Attn => {
    const comma = url.indexOf(",")
    const meta = url.slice(0, comma)
    const mime = meta.slice(5, meta.indexOf(";") >= 0 ? meta.indexOf(";") : meta.length) || fallbackMime
    return { url, mime, data: url.slice(comma + 1) }
  }
  try {
    const img = await loadImage(dataUrl)
    let { width, height } = img
    const max = 1280
    if (Math.max(width, height) > max) {
      const s = max / Math.max(width, height)
      width = Math.round(width * s); height = Math.round(height * s)
    }
    const canvas = document.createElement("canvas")
    canvas.width = width; canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("no canvas context")
    ctx.drawImage(img, 0, 0, width, height)
    return toAttn(canvas.toDataURL("image/jpeg", 0.82), "image/jpeg")
  } catch {
    return toAttn(dataUrl, file.type || "image/jpeg")
  }
}

export default function ChatPanel({
  mode, storageKey, placeholder, intro, persona, thinkingLabel,
}: {
  mode: "chat" | "cooking"
  storageKey: string
  placeholder: string
  intro: string
  persona?: string
  thinkingLabel?: string
}) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState(false)
  const [attns, setAttns] = useState<Attn[]>([])
  const [attaching, setAttaching] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  async function addFiles(files: FileList | File[] | null) {
    if (!files || files.length === 0) return
    setError(null)
    const room = MAX_IMAGES - attns.length
    const picked = Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, Math.max(0, room))
    if (picked.length === 0) return
    setAttaching(true)
    try {
      const done = await Promise.all(picked.map(processImage))
      setAttns((cur) => [...cur, ...done].slice(0, MAX_IMAGES))
    } catch {
      setError("Couldn't read one of those images — try another.")
    } finally {
      setAttaching(false)
    }
  }
  function removeAttn(i: number) {
    setAttns((cur) => cur.filter((_, idx) => idx !== i))
  }

  useEffect(() => {
    // Restore the saved conversation after mount (deferred a tick — avoids a
    // hydration mismatch AND a synchronous setState inside the effect).
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      try {
        const saved = localStorage.getItem(storageKey)
        if (saved) setMessages(JSON.parse(saved))
      } catch {}
    })
    return () => { cancelled = true }
  }, [storageKey])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, busy])

  function persist(next: Msg[]) {
    setMessages(next)
    try {
      // Drop the heavy image data URLs before storing (keep only a count), so a
      // long chat with photos can't overflow the localStorage quota.
      const slim = next.slice(-60).map((m) => (m.images ? { ...m, images: undefined, imgs: m.images.length } : m))
      localStorage.setItem(storageKey, JSON.stringify(slim))
    } catch {}
  }

  async function send() {
    const message = input.trim()
    if ((!message && attns.length === 0) || busy) return
    setError(null)
    setInput("")
    const sending = attns
    setAttns([])
    const withUser: Msg[] = [...messages, { role: "user", text: message, images: sending.length ? sending.map((a) => a.url) : undefined }]
    persist(withUser)
    setBusy(true)
    try {
      const res = await fetch("/api/jordan/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message, history: messages, mode, model: getJordanModel(), search, personality: persona,
          images: sending.map((a) => ({ mime: a.mime, data: a.data })),
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || "That didn't work — try again.")
      persist([...withUser, { role: "model", text: j.reply ?? "", queries: Array.isArray(j.queries) ? j.queries : undefined }])
    } catch (e: any) {
      setError(e?.message ?? "That didn't work — try again.")
    } finally {
      setBusy(false)
    }
  }

  function clear() {
    persist([])
    setError(null)
  }

  return (
    <div className="jsys-chat flex flex-col h-full font-mono" style={{ color: ACC }}
      onDragOver={(e) => { e.preventDefault() }}
      onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer?.files ?? null) }}
    >
      {/* Scoped rules for states inline styles can't express (focus/placeholder/hover). */}
      <style>{`
        .jsys-chat .jsys-input { border-color: ${DIM}; color: ${ACC}; }
        .jsys-chat .jsys-input:focus { border-color: ${ACC}; }
        .jsys-chat .jsys-input::placeholder { color: ${DIM}; opacity: 1; }
        .jsys-chat .jsys-hoverglow:hover:not(:disabled) { background-color: ${GLOW}; }
      `}</style>

      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {messages.length === 0 && (
          <p className="text-sm opacity-60 whitespace-pre-wrap">{intro}</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className="text-sm leading-relaxed whitespace-pre-wrap break-words">
            {m.role === "user" ? (
              <div>
                {m.images && m.images.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    {m.images.map((src, k) => (
                      <img key={k} src={src} alt="attachment" className="h-20 w-20 object-cover rounded-lg border" style={{ borderColor: DIM }} />
                    ))}
                  </div>
                )}
                {!m.images && m.imgs ? <p className="text-[10px] opacity-50 mb-1">🖼 {m.imgs} image{m.imgs === 1 ? "" : "s"} attached</p> : null}
                {m.text && <p><span className="opacity-50 select-none">&gt; </span><span className="text-white">{m.text}</span></p>}
              </div>
            ) : (
              <>
                {m.queries && m.queries.length > 0 && (
                  <p className="text-[10px] opacity-50 mb-1">🔎 searched: {m.queries.join(" · ")}</p>
                )}
                <p>{m.text}</p>
              </>
            )}
          </div>
        ))}
        {busy && <p className="text-sm animate-pulse">{thinkingLabel ?? "THINKING…"}</p>}
        {error && <p className="text-sm text-red-400">✗ {error}</p>}
        <div ref={bottomRef} />
      </div>

      <div className="pt-3 mt-3 border-t" style={{ borderColor: DIM }}>
        {(attns.length > 0 || attaching) && (
          <div className="flex flex-wrap gap-2 mb-2">
            {attns.map((a, i) => (
              <div key={i} className="relative">
                <img src={a.url} alt="attachment" className="h-16 w-16 object-cover rounded-lg border" style={{ borderColor: DIM }} />
                <button onClick={() => removeAttn(i)} title="Remove"
                  className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-black border text-xs leading-none flex items-center justify-center"
                  style={{ borderColor: ACC, color: ACC }}>×</button>
              </div>
            ))}
            {attaching && (
              <div className="h-16 w-16 rounded-lg border flex items-center justify-center text-lg animate-pulse" style={{ borderColor: DIM }}>…</div>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }}
            onPaste={(e) => {
              const imgs = Array.from(e.clipboardData?.items ?? []).filter((it) => it.type.startsWith("image/")).map((it) => it.getAsFile()).filter((f): f is File => !!f)
              if (imgs.length) { e.preventDefault(); addFiles(imgs) }
            }}
            placeholder={placeholder}
            rows={2}
            className="jsys-input flex-1 bg-black border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none"
          />
          <div className="flex flex-col gap-1.5">
            <button onClick={send} disabled={busy || attaching || (!input.trim() && attns.length === 0)}
              className="jsys-hoverglow px-4 py-2 rounded-lg border text-sm font-bold disabled:opacity-30 transition-colors"
              style={{ borderColor: ACC }}>
              SEND
            </button>
            {messages.length > 0 && (
              <button onClick={clear} disabled={busy}
                className="px-4 py-1 rounded-lg border text-xs opacity-60 hover:opacity-100 disabled:opacity-20 transition-opacity"
                style={{ borderColor: DIM }}>
                CLEAR
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 mt-1.5 flex-wrap">
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <button
              onClick={() => fileInput.current?.click()}
              disabled={busy || attns.length >= MAX_IMAGES}
              className="text-[10px] uppercase tracking-widest px-2 py-1 rounded border transition-colors hover:opacity-100 disabled:opacity-30"
              style={{ borderColor: attns.length ? ACC : DIM, background: attns.length ? GLOW : "transparent", opacity: attns.length ? 1 : 0.6 }}
              title="Attach photo(s) — up to 6. You can also paste or drag them in."
            >
              🖼 IMAGE{attns.length ? ` [ ${attns.length} ]` : ""}
            </button>
            <button
              onClick={() => setSearch((s) => !s)}
              className="text-[10px] uppercase tracking-widest px-2 py-1 rounded border transition-colors hover:opacity-100"
              style={{ borderColor: search ? ACC : DIM, background: search ? GLOW : "transparent", opacity: search ? 1 : 0.6 }}
              title="Let the AI look things up on Google in real time (fixtures, prices, news)"
            >
              🔎 WEB SEARCH [ {search ? "ON" : "OFF"} ]
            </button>
            <p className="text-[10px] opacity-40 hidden sm:block">ENTER to send · paste / drag to attach</p>
          </div>
          <ModelPicker />
        </div>
        <input ref={fileInput} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => { addFiles(e.target.files); e.currentTarget.value = "" }} />
      </div>
    </div>
  )
}
