"use client"

import { useEffect, useState } from "react"
import { JSYS_ATTR, JSYS_DEFAULT_THEME, JSYS_THEMES, JSYS_THEME_KEY, getJsysTheme } from "@/lib/jordan-theme"

// JORDAN.SYS → LOOK & FEEL, the client half. The palette table is lib/jordan-theme.ts; this file is
// how a theme is chosen, remembered and applied.
//
// ⚠ Applied by setting <html data-jsys="…"> — the CSS variables in the layout's <style> key off it,
// so every /jordan screen recolours at once with no re-render of its own. A `jsys-theme` window
// event tells anything that needs to KNOW the theme (the Ask AI personas only wear their own
// colours on RETRO) that it changed.

const EVENT = "jsys-theme"

export function readJsysTheme(): string {
  try {
    const t = localStorage.getItem(JSYS_THEME_KEY)
    return JSYS_THEMES.some(x => x.id === t) ? (t as string) : JSYS_DEFAULT_THEME
  } catch { return JSYS_DEFAULT_THEME }
}

export function applyJsysTheme(id: string) {
  const t = getJsysTheme(id)
  try {
    if (t.id === JSYS_DEFAULT_THEME) localStorage.removeItem(JSYS_THEME_KEY)
    else localStorage.setItem(JSYS_THEME_KEY, t.id)
  } catch { /* storage blocked — it still switches for now */ }
  if (t.id === JSYS_DEFAULT_THEME) document.documentElement.removeAttribute(JSYS_ATTR)
  else document.documentElement.setAttribute(JSYS_ATTR, t.id)
  window.dispatchEvent(new Event(EVENT))
}

/** The current theme id, kept in step with the picker wherever it is pressed. */
export function useJsysTheme(): string {
  const [id, setId] = useState(JSYS_DEFAULT_THEME)
  useEffect(() => {
    const sync = () => setId(readJsysTheme())
    // A tick after mount, like the persona restore — avoids a hydration mismatch.
    queueMicrotask(sync)
    window.addEventListener(EVENT, sync)
    return () => window.removeEventListener(EVENT, sync)
  }, [])
  return id
}

/** Re-applies the saved theme on mount. The layout's inline script does it before paint on a full
 *  load; this covers arriving at /jordan by a client-side navigation, where inline scripts do not
 *  run. Renders nothing. */
export function JsysThemeBoot() {
  useEffect(() => {
    const id = readJsysTheme()
    if (id === JSYS_DEFAULT_THEME) document.documentElement.removeAttribute(JSYS_ATTR)
    else document.documentElement.setAttribute(JSYS_ATTR, id)
  }, [])
  return null
}

/** The full picker — one chip per theme, each wearing its own colours so the choice reads at a
 *  glance (design rule 3: a colour that means something needs a key, and here the chip IS the key). */
export function JsysStyleChips() {
  const current = useJsysTheme()
  return (
    <div className="flex flex-wrap items-center gap-2">
      {JSYS_THEMES.map(t => {
        const on = t.id === current
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => applyJsysTheme(t.id)}
            title={t.blurb}
            aria-pressed={on}
            className="min-h-[44px] px-3 rounded-lg border-2 text-xs font-bold tracking-widest transition-all"
            style={{
              background: t.vars.bg, color: t.vars.acc, fontFamily: t.vars.font,
              borderColor: on ? t.vars.acc : t.vars.dim,
              opacity: on ? 1 : 0.75,
            }}
          >
            {on ? "✓ " : ""}{t.label}
          </button>
        )
      })}
    </div>
  )
}

/** A small header control for the sub-pages: shows the current style, and each press moves to the
 *  next one — so a style can be changed without going back to the menu. */
export function JsysStyleButton() {
  const current = useJsysTheme()
  const t = getJsysTheme(current)
  const next = () => {
    const i = JSYS_THEMES.findIndex(x => x.id === current)
    applyJsysTheme(JSYS_THEMES[(i + 1) % JSYS_THEMES.length].id)
  }
  return (
    <button
      type="button"
      onClick={next}
      title={`Style: ${t.label} — ${t.blurb}. Press for the next one; the full list is on the JORDAN.SYS menu.`}
      className="text-xs opacity-60 hover:opacity-100 border border-(--j-dim) rounded px-2 py-1 tracking-widest transition-opacity"
    >
      STYLE: {t.label}
    </button>
  )
}
