"use client"

import { useEffect, useRef, useState } from "react"
import ModelPicker, { getJordanModel } from "./model-picker"

// Shared retro-terminal chat panel for the secret menu. History persists per
// browser in localStorage (per storageKey) so a refresh doesn't wipe the chat.

type Msg = { role: "user" | "model"; text: string }
const GREEN = "#33ff66"

export default function ChatPanel({
  mode, storageKey, placeholder, intro,
}: { mode: "chat" | "cooking"; storageKey: string; placeholder: string; intro: string }) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

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
    try { localStorage.setItem(storageKey, JSON.stringify(next.slice(-60))) } catch {}
  }

  async function send() {
    const message = input.trim()
    if (!message || busy) return
    setError(null)
    setInput("")
    const withUser: Msg[] = [...messages, { role: "user", text: message }]
    persist(withUser)
    setBusy(true)
    try {
      const res = await fetch("/api/jordan/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history: messages, mode, model: getJordanModel() }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || "That didn't work — try again.")
      persist([...withUser, { role: "model", text: j.reply ?? "" }])
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
    <div className="flex flex-col h-full font-mono" style={{ color: GREEN }}>
      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {messages.length === 0 && (
          <p className="text-sm opacity-60 whitespace-pre-wrap">{intro}</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className="text-sm leading-relaxed whitespace-pre-wrap break-words">
            {m.role === "user" ? (
              <p><span className="opacity-50 select-none">&gt; </span><span className="text-white">{m.text}</span></p>
            ) : (
              <p>{m.text}</p>
            )}
          </div>
        ))}
        {busy && <p className="text-sm animate-pulse">THINKING…</p>}
        {error && <p className="text-sm text-red-400">✗ {error}</p>}
        <div ref={bottomRef} />
      </div>

      <div className="pt-3 mt-3 border-t border-[#1f5c33]">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder={placeholder}
            rows={2}
            className="flex-1 bg-black border border-[#1f5c33] rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[#33ff66] placeholder:text-[#1f5c33]"
            style={{ color: GREEN }}
          />
          <div className="flex flex-col gap-1.5">
            <button onClick={send} disabled={busy || !input.trim()}
              className="px-4 py-2 rounded-lg border border-[#33ff66] text-sm font-bold hover:bg-[#0a2214] disabled:opacity-30 transition-colors">
              SEND
            </button>
            {messages.length > 0 && (
              <button onClick={clear} disabled={busy}
                className="px-4 py-1 rounded-lg border border-[#1f5c33] text-xs opacity-60 hover:opacity-100 disabled:opacity-20 transition-opacity">
                CLEAR
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 mt-1.5">
          <p className="text-[10px] opacity-40">ENTER to send · SHIFT+ENTER for a new line</p>
          <ModelPicker />
        </div>
      </div>
    </div>
  )
}
