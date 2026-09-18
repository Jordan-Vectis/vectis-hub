"use client"

import { useEffect, useState, type CSSProperties } from "react"
import ChatPanel from "../chat-panel"
import { PERSONAS, DEFAULT_PERSONA, PERSONA_KEY, getPersona } from "./personas"
import { useJsys } from "../jsys-style"
import { getJsysPalette } from "@/lib/jordan-theme"
import { JsysHeader } from "../jsys-style"

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
  // ⚠ A persona only WEARS its colours on the palettes that say so (skinsChat — the black-background ones). They were picked to sit on pure black —
  // CORTANA blue, HAL red, FUNNY green — and on a light or charcoal theme they would be unreadable
  // or clash with it. On any other style the persona still changes the voice and the intro, and
  // the panel keeps the theme's own colours (the chat panel falls back to --j-acc / --j-dim).
  const skinned = !!getJsysPalette(useJsys().palette).skinsChat
  const themeVars = (skinned ? {
    color: active.accent,
    "--jsys-acc": active.accent,
    "--jsys-dim": active.dim,
    "--jsys-glow": active.glow,
  } : {}) as CSSProperties

  return (
    <div className="h-full bg-(--j-bg) p-6 jsys-font flex flex-col" style={themeVars}>
      <div className="w-full flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between gap-3 mb-3 shrink-0 flex-wrap">
          <JsysHeader n="02" title="Ask AI" />
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
                style={skinned
                  ? { color: p.accent, borderColor: on ? p.accent : p.dim, background: on ? p.glow : "transparent", opacity: on ? 1 : 0.55 }
                  : { borderColor: on ? "var(--j-acc)" : "var(--j-dim)", background: on ? "var(--j-glow)" : "transparent", opacity: on ? 1 : 0.55 }}
              >
                {p.label}
              </button>
            )
          })}
        </div>

        <div className="flex-1 min-h-0 border rounded-xl p-4" style={{ borderColor: skinned ? active.dim : "var(--j-dim)" }}>
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
