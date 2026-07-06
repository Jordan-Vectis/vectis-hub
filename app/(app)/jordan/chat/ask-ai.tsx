"use client"

import { useEffect, useState, type CSSProperties } from "react"
import Link from "next/link"
import ChatPanel from "../chat-panel"
import { PERSONAS, DEFAULT_PERSONA, PERSONA_KEY, getPersona } from "./personas"

// 02 · ASK AI — the secret menu's general chat, with a selectable AI PERSONALITY.
// Switching persona re-skins the whole panel (accent / border / glow) AND swaps
// the system prompt server-side (route resolves it by the posted personality id).

export default function AskAi() {
  const [personaId, setPersonaId] = useState(DEFAULT_PERSONA)

  useEffect(() => {
    // Restore the saved persona a tick after mount (avoids a hydration mismatch
    // and a synchronous setState inside the effect).
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      try {
        const saved = localStorage.getItem(PERSONA_KEY)
        if (saved && PERSONAS.some((p) => p.id === saved)) setPersonaId(saved)
      } catch {}
    })
    return () => { cancelled = true }
  }, [])

  function choose(id: string) {
    setPersonaId(id)
    try { localStorage.setItem(PERSONA_KEY, id) } catch {}
  }

  const active = getPersona(personaId)
  const themeVars = {
    color: active.accent,
    "--jsys-acc": active.accent,
    "--jsys-dim": active.dim,
    "--jsys-glow": active.glow,
  } as CSSProperties

  return (
    <div className="h-full bg-black p-6 font-mono flex flex-col" style={themeVars}>
      <div className="max-w-3xl mx-auto w-full flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between gap-3 mb-3 shrink-0 flex-wrap">
          <h1 className="text-lg font-bold tracking-widest">02 · ASK AI</h1>
          <Link href="/jordan" prefetch={false} className="text-xs opacity-60 hover:opacity-100">&lt; JORDAN.SYS</Link>
        </div>

        {/* Personality selector — each chip wears its own colour so the scheme reads at a glance. */}
        <div className="flex items-center gap-2 mb-4 shrink-0 flex-wrap">
          <span className="text-[10px] uppercase tracking-widest opacity-40">Personality</span>
          {PERSONAS.map((p) => {
            const on = p.id === personaId
            return (
              <button
                key={p.id}
                onClick={() => choose(p.id)}
                className="px-2.5 py-1 rounded-lg text-[11px] font-bold border tracking-widest transition-all hover:opacity-100"
                style={{ color: p.accent, borderColor: on ? p.accent : p.dim, background: on ? p.glow : "transparent", opacity: on ? 1 : 0.55 }}
              >
                {p.label}
              </button>
            )
          })}
        </div>

        <div className="flex-1 min-h-0 border rounded-xl p-4" style={{ borderColor: active.dim }}>
          <ChatPanel
            mode="chat"
            persona={active.id}
            storageKey="jordan_chat_history"
            placeholder="Ask anything…"
            intro={active.intro}
            thinkingLabel={active.thinking}
          />
        </div>
      </div>
    </div>
  )
}
