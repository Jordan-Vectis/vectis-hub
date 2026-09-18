"use client"

import { useEffect, useLayoutEffect, useState } from "react"
import Link from "next/link"
import {
  JSYS_ATTR, JSYS_DEFAULT_LOOK, JSYS_DEFAULT_PALETTE, JSYS_LOOKS, JSYS_LOOK_ATTR, JSYS_LOOK_KEY, JSYS_THEME_KEY,
  getJsysLook, getJsysPalette, palettesOf, resolveJsys, type JsysLook, type JsysPalette,
} from "@/lib/jordan-theme"

// JORDAN.SYS → LOOK & FEEL, the client half. The tables are lib/jordan-theme.ts; this file is how a
// look is chosen, remembered and applied, plus the two pieces of markup every /jordan page shares.
//
// ⚠ Applied by setting <html data-jsys-look="…" data-jsys="…"> — the shape rules in globals.css and
// the colour variables in the layout's <style> key off them, so every screen changes at once with no
// re-render of its own. A `jsys-theme` window event tells anything that needs to KNOW the choice
// (the Ask AI personas, the style button's label) that it changed.
//
// ⚠⚠ MARKUP THAT DIFFERS BY LOOK IS RENDERED TWICE AND ONE COPY IS HIDDEN BY CSS (`jsys-t` for the
// terminal, `jsys-m` for everything else — globals.css). Not a hook: the server renders before it
// knows the browser's choice, so a hook would paint the terminal version first and swap it after
// hydration — a flash of the wrong menu on every load. The attribute is on <html> before paint, so
// CSS gets it right from the first frame.

const EVENT = "jsys-theme"
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

export function readJsys(): { look: string; palette: string } {
  try {
    return resolveJsys(localStorage.getItem(JSYS_LOOK_KEY), localStorage.getItem(JSYS_THEME_KEY))
  } catch { return resolveJsys(JSYS_DEFAULT_LOOK, JSYS_DEFAULT_PALETTE) }
}

function setAttrs(look: string, palette: string) {
  const d = document.documentElement
  if (look === JSYS_DEFAULT_LOOK) d.removeAttribute(JSYS_LOOK_ATTR); else d.setAttribute(JSYS_LOOK_ATTR, look)
  if (palette === JSYS_DEFAULT_PALETTE) d.removeAttribute(JSYS_ATTR); else d.setAttribute(JSYS_ATTR, palette)
}

/** Change the look and/or the palette. A look on its own opens on its default palette — or the
 *  palette already saved for it, if the saved one belongs to it. */
export function applyJsys(next: { look?: string; palette?: string }) {
  const cur = readJsys()
  const r = resolveJsys(next.look ?? cur.look, next.palette ?? cur.palette)
  try {
    if (r.look === JSYS_DEFAULT_LOOK) localStorage.removeItem(JSYS_LOOK_KEY); else localStorage.setItem(JSYS_LOOK_KEY, r.look)
    if (r.palette === JSYS_DEFAULT_PALETTE) localStorage.removeItem(JSYS_THEME_KEY); else localStorage.setItem(JSYS_THEME_KEY, r.palette)
  } catch { /* storage blocked — it still switches for now */ }
  setAttrs(r.look, r.palette)
  window.dispatchEvent(new Event(EVENT))
}

/** The current choice, kept in step with the picker wherever it is pressed. Starts on the default
 *  (what the server rendered) and corrects itself before the first paint. */
export function useJsys(): { look: string; palette: string } {
  const [v, setV] = useState(() => resolveJsys(JSYS_DEFAULT_LOOK, JSYS_DEFAULT_PALETTE))
  useIsoLayoutEffect(() => {
    const sync = () => setV(readJsys())
    sync()
    window.addEventListener(EVENT, sync)
    return () => window.removeEventListener(EVENT, sync)
  }, [])
  return v
}

/** Re-applies the saved choice on mount. The layout's inline script does it before paint on a full
 *  load; this covers arriving at /jordan by a client-side navigation, where inline scripts do not
 *  run. Renders nothing. */
export function JsysThemeBoot() {
  useIsoLayoutEffect(() => { const r = readJsys(); setAttrs(r.look, r.palette) }, [])
  return null
}

// ── Shared markup ──────────────────────────────────────────────────────────────

/** Turns "MEAL PLANNER" into "Meal planner", leaving acronyms alone. */
function niceTitle(t: string): string {
  const KEEP = new Set(["AI", "MCOC", "CV", "BGS", "AW", "MOT"])
  return t.split(" ").map((w, i) => KEEP.has(w.toUpperCase()) ? w.toUpperCase() : i === 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()).join(" ")
}

/** The header of every sub-page: "08 · MEAL PLANNER / < JORDAN.SYS" on the terminal, "Meal planner /
 *  ← All tools" on the rest. Both are in the markup; CSS shows one. */
export function JsysHeader({ n, title }: { n: string; title: string }) {
  return (
    <>
      <h1 className="jsys-t text-lg font-bold tracking-widest">{n} · {title.toUpperCase()}</h1>
      <h1 className="jsys-m jsys-title text-xl font-bold">{niceTitle(title)}</h1>
      <span className="flex items-center gap-3">
        <JsysStyleButton />
        <Link href="/jordan" prefetch={false} className="jsys-t text-xs opacity-60 hover:opacity-100">&lt; JORDAN.SYS</Link>
        <Link href="/jordan" prefetch={false} className="jsys-m text-sm opacity-60 hover:opacity-100">← All tools</Link>
      </span>
    </>
  )
}

/** A small header control: shows the current look, and each press moves to the next one — so the
 *  look can be changed without going back to the menu (the full picker is there). */
export function JsysStyleButton() {
  const { look } = useJsys()
  const l = getJsysLook(look)
  const next = () => {
    const i = JSYS_LOOKS.findIndex(x => x.id === look)
    applyJsys({ look: JSYS_LOOKS[(i + 1) % JSYS_LOOKS.length].id })
  }
  return (
    <button
      type="button"
      onClick={next}
      title={`Look: ${l.label} — ${l.blurb}. Press for the next one; the full list is on the menu.`}
      className="text-xs opacity-60 hover:opacity-100 border border-(--j-dim) rounded px-2 py-1 transition-opacity"
    >
      <span className="jsys-t tracking-widest">STYLE: {l.label.toUpperCase()}</span>
      <span className="jsys-m">Style: {l.label}</span>
    </button>
  )
}

// ── The picker ─────────────────────────────────────────────────────────────────

/** A postcard of a look, drawn in its default palette so the SHAPE reads before it is pressed —
 *  rounded or chamfered, mono or serif, glow or paper. Design rule 3: the card is its own key. */
function Preview({ look, palette }: { look: JsysLook; palette: JsysPalette }) {
  const v = palette.vars
  const shape: React.CSSProperties =
    look.id === "halo"   ? { clipPath: "polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px)", boxShadow: `inset 0 0 0 1px ${v.acc}66, inset 0 0 16px -6px ${v.acc}` }
    : look.id === "modern" ? { borderRadius: 12, boxShadow: "0 8px 20px -10px rgba(0,0,0,.5)" }
    : look.id === "hub"    ? { borderRadius: 10, border: `1px solid ${v.dim}` }
    : look.id === "paper"  ? { borderRadius: 3, border: `1px solid ${v.dim}`, boxShadow: "0 1px 0 rgba(0,0,0,.05)" }
    : { borderRadius: 4, border: `1px solid ${v.dim}` }
  const btnShape: React.CSSProperties =
    look.id === "halo" ? { clipPath: "polygon(4px 0,100% 0,100% calc(100% - 4px),calc(100% - 4px) 100%,0 100%,0 4px)" }
    : look.id === "modern" ? { borderRadius: 999 }
    : look.id === "paper" ? { borderRadius: 2 }
    : { borderRadius: look.id === "hub" ? 6 : 3 }
  return (
    <div className="w-full h-[84px] p-2.5 overflow-hidden" style={{ background: v.bg, color: v.text, fontFamily: v.font }}>
      <div className="h-full p-2 flex flex-col justify-between" style={{ background: v.box, ...shape }}>
        <div className="text-[9px] font-bold truncate" style={{ letterSpacing: look.id === "terminal" || look.id === "halo" ? "0.15em" : "0.01em", color: look.id === "halo" ? v.acc : v.text }}>
          {look.id === "terminal" ? "08 · MEAL PLANNER" : look.id === "halo" ? "MEAL PLANNER" : "Meal planner"}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="flex-1 h-[6px] rounded-sm" style={{ background: v.dim, borderRadius: look.id === "paper" ? 0 : undefined, borderBottom: look.id === "paper" ? `1px solid ${v.dim}` : undefined, height: look.id === "paper" ? 1 : 6 }} />
          <div className="px-2 py-[3px] text-[8px] font-bold" style={{ background: v.acc, color: v.onAcc, ...btnShape }}>GO</div>
        </div>
      </div>
    </div>
  )
}

/** The full picker for the menu: one card per LOOK, then the palettes that look offers. */
export function JsysLookPicker() {
  const { look, palette } = useJsys()
  const pals = palettesOf(look)
  return (
    <div className="space-y-3 w-full">
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {JSYS_LOOKS.map(l => {
          const on = l.id === look
          const pal = getJsysPalette(pals.length && on ? palette : l.defaultPalette)
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => applyJsys({ look: l.id })}
              aria-pressed={on}
              title={l.blurb}
              className={`text-left rounded-lg border-2 overflow-hidden transition-all ${on ? "border-(--j-acc)" : "border-(--j-dim) opacity-80 hover:opacity-100"}`}
            >
              <Preview look={l} palette={pal} />
              <div className="px-3 py-2 bg-(--j-box)">
                <div className="font-bold text-sm"><span className="jsys-t tracking-widest">{on ? "✓ " : ""}{l.label.toUpperCase()}</span><span className="jsys-m">{on ? "✓ " : ""}{l.label}</span></div>
                <div className="text-[11px] opacity-60 leading-snug">{l.blurb}</div>
              </div>
            </button>
          )
        })}
      </div>
      {pals.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] tracking-widest opacity-60 mr-1"><span className="jsys-t">COLOURS</span><span className="jsys-m">Colours</span></span>
          {pals.map(p => {
            const on = p.id === palette
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => applyJsys({ palette: p.id })}
                aria-pressed={on}
                title={p.blurb}
                className="min-h-[44px] px-3 rounded-lg border-2 text-xs font-bold transition-all"
                style={{ background: p.vars.bg, color: p.vars.text, fontFamily: p.vars.font, borderColor: on ? p.vars.acc : p.vars.dim, opacity: on ? 1 : 0.75 }}
              >
                {on ? "✓ " : ""}{p.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
