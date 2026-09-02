"use client"

// ─── The top-bar Help box ────────────────────────────────────────────────────
//
// Jordan, 2026-09-02: "a Help box that when you click opens a chat box you can ask questions
// about the system in — so for example where do I go to do an overnight run."
//
// ⚠ It only ever knows about the parts of the Hub the person asking can open. That is done by
// filtering the context server-side in /api/help/ask — see lib/help-map.ts. Nothing here needs
// to know about permissions, and nothing here should try to.

import { useEffect, useRef, useState } from "react"
import Link from "next/link"

type Turn = {
  role: "user" | "model"
  text: string
  links?: { name: string; href: string }[]
  /** A question about a tool this person cannot open — shown as a refusal, not an answer. */
  blocked?: boolean
}

// ⚠ The suggested questions are FETCHED, never hardcoded. A fixed list here offered a
// cataloguer with only CATALOGUING "Where do I go to do an overnight run?" — a tool he cannot
// open (Jordan, 2026-09-02). They come from the same filtered set as the answers.

export default function HelpButton() {
  const [open, setOpen]       = useState(false)
  const [q, setQ]             = useState("")
  const [turns, setTurns]     = useState<Turn[]>([])
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [examples, setExamples] = useState<string[]>([])
  const panelRef  = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Click outside / Escape closes it. A help panel that traps you is worse than no help panel.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey) }
  }, [open])

  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  // Asked for once, the first time it is opened.
  useEffect(() => {
    if (!open || examples.length > 0) return
    fetch("/api/help/ask")
      .then(r => r.json())
      .then(d => setExamples(d.examples ?? []))
      .catch(() => { /* no suggestions is fine — the box still works */ })
  }, [open, examples.length])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }) }, [turns, busy])

  async function ask(question: string) {
    const text = question.trim()
    if (!text || busy) return
    setQ("")
    setError(null)
    const asked: Turn[] = [...turns, { role: "user", text }]
    setTurns(asked)
    setBusy(true)
    try {
      const res = await fetch("/api/help/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: text,
          history: asked.slice(0, -1).map(t => ({ role: t.role, text: t.text })),
        }),
      })
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      setTurns([...asked, { role: "model", text: data.answer ?? "", links: data.links ?? [], blocked: !!data.blocked }])
    } catch {
      // ⚠ Say something. A help box that goes quiet when it fails is the worst possible one.
      setError("Couldn't reach the server — try again in a moment.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Ask where to find things in the Hub"
        className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
          open ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800"
        }`}
      >
        <span aria-hidden>💬</span>
        Help
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[min(92vw,26rem)] rounded-xl border border-gray-700 bg-[#1C1C1E] shadow-2xl shadow-black/50 z-50 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">Help</p>
              <p className="text-[11px] text-gray-500">Ask where to find something in the Hub</p>
            </div>
            <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-white text-sm px-1">✕</button>
          </div>

          <div className="max-h-[22rem] overflow-y-auto px-4 py-3 space-y-3">
            {turns.length === 0 && !busy && examples.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">For example:</p>
                {examples.map(e => (
                  <button
                    key={e}
                    onClick={() => ask(e)}
                    className="block w-full text-left text-xs text-[#2AB4A6] hover:text-[#4fd3c5] bg-gray-800/50 hover:bg-gray-800 rounded-lg px-3 py-2 transition-colors"
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}

            {turns.map((t, i) => (
              t.role === "user" ? (
                <p key={i} className="text-xs text-gray-300 bg-gray-800 rounded-lg px-3 py-2 ml-6">{t.text}</p>
              ) : (
                <div key={i} className="space-y-2">
                  <p className={`text-sm whitespace-pre-wrap leading-relaxed ${t.blocked ? "text-amber-400" : "text-gray-200"}`}>
                    {t.blocked && <span className="mr-1" aria-hidden>🔒</span>}{t.text}
                  </p>
                  {t.links && t.links.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {t.links.map(l => (
                        <Link
                          key={l.href}
                          href={l.href}
                          onClick={() => setOpen(false)}
                          className="text-[11px] font-medium px-2 py-1 rounded-md border border-[#2AB4A6]/50 text-[#2AB4A6] hover:bg-[#2AB4A6]/10 transition-colors"
                        >
                          Go to {l.name} →
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )
            ))}

            {busy && <p className="text-xs text-gray-500">Looking…</p>}
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div ref={bottomRef} />
          </div>

          <form
            onSubmit={e => { e.preventDefault(); ask(q) }}
            className="border-t border-gray-800 p-3 flex items-center gap-2"
          >
            <input
              ref={inputRef}
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Ask a question…"
              className="flex-1 bg-[#2C2C2E] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#2AB4A6]"
            />
            <button
              type="submit"
              disabled={busy || !q.trim()}
              className="px-3 py-2 text-sm font-semibold rounded-lg bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-40 text-white transition-colors"
            >
              Ask
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
