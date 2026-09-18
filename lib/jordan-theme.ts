// JORDAN.SYS → LOOK & FEEL. The one table every /jordan screen takes its look from.
//
// Jordan, 2026-09-18: "the green and black retro is a little jarring to some people" — and, when
// offered recolours, "I was hoping for some better options not just a colour change … a retro
// option, a standard hub option and a modern option and whatever else you can come up with? Halo
// style option would be cool but you can keep the colour options already there."
//
// So there are two layers:
//   · a LOOK — the SHAPE of the thing: font, casing, rounded cards vs chamfered glowing panels vs
//     ruled paper, a tile-grid menu or the numbered terminal list. Five: TERMINAL (the original),
//     HUB (the rest of the Vectis Hub), MODERN (an app), HALO, PAPER. The shape rules live in
//     app/globals.css under "JORDAN.SYS looks", keyed off <html data-jsys-look="…">.
//   · a PALETTE — the colours, as CSS variables keyed off <html data-jsys="…">. TERMINAL keeps the
//     five colour options from the first pass; the other looks bring their own.
//
// Every /jordan screen reads the variables — `text-(--j-text)`, `border-(--j-dim)`, `bg-(--j-bg)` —
// and never a hex. This file is the only place the values live; change one here and every screen
// follows. ⚠ Plain TypeScript on purpose: no React, no "use client". app/(app)/jordan/layout.tsx
// (a server component) renders JSYS_PALETTE_CSS and the no-flash boot script; the picker, the hook
// and the shared header live in app/(app)/jordan/jsys-style.tsx.
//
// ⚠ `text` and `acc` are SEPARATE. On the terminal looks they are the same colour (the retro look is
// "everything green"), but a Hub or Modern look has neutral body text and a coloured accent — one
// variable for both would make every word violet.

export type JsysVars = {
  bg: string      // page and inputs                    (was bg-black)
  box: string     // panels                             (was #040f08)
  text: string    // body text                          (was #33ff66, the same as the accent)
  acc: string     // accent: active borders, go buttons (was #33ff66)
  accHi: string   // accent, hovered                    (was #5cff88)
  onAcc: string   // text on an accent-filled button    (was text-black)
  dim: string     // lines and placeholders             (was #1f5c33)
  dim2: string    // quieter lines inside a panel       (was #123d22)
  glow: string    // hover / active fill                (was #0a2214)
  hi: string      // emphasis text                      (was text-white)
  ok: string      // "fine" status green                (the garage's due-date colour)
  font: string
}

export type JsysLook = {
  id: string
  label: string
  blurb: string
  /** The palette a look opens on. Every palette names its look; the picker shows a look's own. */
  defaultPalette: string
}

export type JsysPalette = {
  id: string
  label: string
  blurb: string
  look: string
  /** The Ask AI personas wear their own colours (picked for pure black) only on these. */
  skinsChat?: boolean
  vars: JsysVars
  /** Values that apply while the Hub's own dark mode is on (<html class="dark">). Only the HUB look
   *  follows the Hub's switch; the rest are one colour set each. */
  darkVars?: Partial<JsysVars>
}

const MONO  = "var(--font-geist-mono), ui-monospace, Menlo, Consolas, monospace"
const SANS  = "var(--font-geist-sans), system-ui, Arial, sans-serif"
const HUB   = "var(--font-geist-sans), Arial, Helvetica, sans-serif"
const HALO  = "\"Bahnschrift\", \"Segoe UI Variable Display\", \"Roboto Condensed\", var(--font-geist-sans), sans-serif"
const PAPER = "\"Iowan Old Style\", \"Palatino Linotype\", \"Book Antiqua\", Georgia, serif"

// Order = order in the picker. TERMINAL is the original and stays the default.
export const JSYS_LOOKS: JsysLook[] = [
  { id: "terminal", label: "Retro",  blurb: "the original terminal — numbered menu, monospace, glow", defaultPalette: "retro" },
  { id: "hub",      label: "Hub",    blurb: "looks like the rest of the Vectis Hub, and follows its light/dark switch", defaultPalette: "hub" },
  { id: "modern",   label: "Modern", blurb: "an app — rounded cards, soft shadows, pill buttons, tile menu", defaultPalette: "modern-dark" },
  { id: "halo",     label: "Halo",   blurb: "chamfered panels, cyan glow, a grid in the dark", defaultPalette: "halo" },
  { id: "paper",    label: "Paper",  blurb: "cream, serif, ruled lines — the calmest of the lot", defaultPalette: "paper" },
]

export const JSYS_PALETTES: JsysPalette[] = [
  // ── Terminal: the five colour options from the first pass ──
  { id: "retro", label: "GREEN", blurb: "green phosphor on black, the original", look: "terminal", skinsChat: true,
    vars: { bg: "#000000", box: "#040f08", text: "#33ff66", acc: "#33ff66", accHi: "#5cff88", onAcc: "#000000", dim: "#1f5c33", dim2: "#123d22", glow: "#0a2214", hi: "#ffffff", ok: "#33ff66", font: MONO } },
  { id: "amber", label: "AMBER", blurb: "amber terminal on black", look: "terminal", skinsChat: true,
    vars: { bg: "#000000", box: "#0d0900", text: "#ffb000", acc: "#ffb000", accHi: "#ffc63a", onAcc: "#000000", dim: "#5c3d00", dim2: "#3d2a00", glow: "#201600", hi: "#ffffff", ok: "#ffb000", font: MONO } },
  { id: "ocean", label: "BLUE", blurb: "sky blue on deep navy", look: "terminal", skinsChat: true,
    vars: { bg: "#071019", box: "#0c1722", text: "#8fd3ff", acc: "#8fd3ff", accHi: "#b8e4ff", onAcc: "#051019", dim: "#1f4d6e", dim2: "#163a53", glow: "#0d2033", hi: "#ffffff", ok: "#4ade80", font: MONO } },
  { id: "clean", label: "WHITE", blurb: "soft white on charcoal, no glow", look: "terminal",
    vars: { bg: "#0f1115", box: "#161a21", text: "#e4e7ee", acc: "#e4e7ee", accHi: "#ffffff", onAcc: "#0f1115", dim: "#2e333d", dim2: "#232830", glow: "#1c2129", hi: "#ffffff", ok: "#4ade80", font: MONO } },
  { id: "light", label: "LIGHT", blurb: "dark text on white", look: "terminal",
    vars: { bg: "#ffffff", box: "#f4f5f7", text: "#1f2430", acc: "#1f2430", accHi: "#000000", onAcc: "#ffffff", dim: "#d3d7de", dim2: "#e3e6eb", glow: "#eceef2", hi: "#000000", ok: "#15803d", font: MONO } },

  // ── Hub: the Vectis Hub's own cards, greys and violet; dark values follow <html class="dark"> ──
  { id: "hub", label: "Hub", blurb: "the Hub's own colours, light or dark with the Hub's switch", look: "hub",
    vars:     { bg: "#f9fafb", box: "#ffffff", text: "#111827", acc: "#7c3aed", accHi: "#6d28d9", onAcc: "#ffffff", dim: "#d1d5db", dim2: "#e5e7eb", glow: "#f3f4f6", hi: "#000000", ok: "#16a34a", font: HUB },
    darkVars: { bg: "#0D0D0F", box: "#141416", text: "#e5e7eb", acc: "#8b5cf6", accHi: "#a78bfa", onAcc: "#ffffff", dim: "#2a2d33", dim2: "#1f2937", glow: "#1C1C1E", hi: "#ffffff", ok: "#4ade80" } },

  // ── Modern: an app ──
  { id: "modern-dark", label: "Dark", blurb: "near-black, blue accent", look: "modern",
    vars: { bg: "#0b0d12", box: "#151923", text: "#e6e9f0", acc: "#3b82f6", accHi: "#60a5fa", onAcc: "#ffffff", dim: "#262c3a", dim2: "#1c2130", glow: "#1b2030", hi: "#ffffff", ok: "#34d399", font: SANS } },
  { id: "modern-light", label: "Light", blurb: "white cards on a pale grey", look: "modern",
    vars: { bg: "#f3f4f8", box: "#ffffff", text: "#1b1f2a", acc: "#2563eb", accHi: "#1d4ed8", onAcc: "#ffffff", dim: "#d8dce6", dim2: "#e6e9f0", glow: "#eef1f7", hi: "#000000", ok: "#059669", font: SANS } },

  // ── Halo ──
  { id: "halo", label: "Halo", blurb: "cyan on midnight", look: "halo", skinsChat: true,
    vars: { bg: "#050b14", box: "#0a1524", text: "#cfe9ff", acc: "#5ec8ff", accHi: "#8fdcff", onAcc: "#041019", dim: "#17456a", dim2: "#0f2e48", glow: "#0c2238", hi: "#ffffff", ok: "#7ef0c0", font: HALO } },

  // ── Paper ──
  { id: "paper", label: "Paper", blurb: "ink on cream", look: "paper",
    vars: { bg: "#f6f1e6", box: "#fbf8f1", text: "#2b2620", acc: "#8b3a2a", accHi: "#6f2d21", onAcc: "#fbf8f1", dim: "#d8cfbd", dim2: "#e6dfcf", glow: "#efe8d9", hi: "#000000", ok: "#3f7d4e", font: PAPER } },
]

export const JSYS_DEFAULT_LOOK = "terminal"
export const JSYS_DEFAULT_PALETTE = "retro"
/** localStorage — per browser, like the CRT switch and the Hub's own light/dark.
 *  ⚠ `jordan_theme` kept its name from the first pass, so a palette saved then still counts. */
export const JSYS_LOOK_KEY = "jordan_look"
export const JSYS_THEME_KEY = "jordan_theme"
/** The attributes on <html> everything keys off. Absent = the default. */
export const JSYS_LOOK_ATTR = "data-jsys-look"
export const JSYS_ATTR = "data-jsys"

export function getJsysLook(id: string | null | undefined): JsysLook {
  return JSYS_LOOKS.find(l => l.id === id) ?? JSYS_LOOKS[0]
}
export function getJsysPalette(id: string | null | undefined): JsysPalette {
  return JSYS_PALETTES.find(p => p.id === id) ?? JSYS_PALETTES[0]
}
export function palettesOf(lookId: string): JsysPalette[] {
  return JSYS_PALETTES.filter(p => p.look === lookId)
}
/** A (look, palette) pair that agrees with itself: a palette from another look falls back to the
 *  look's own default. */
export function resolveJsys(look: string | null | undefined, palette: string | null | undefined): { look: string; palette: string } {
  const l = getJsysLook(look)
  const p = JSYS_PALETTES.find(x => x.id === palette && x.look === l.id) ?? getJsysPalette(l.defaultPalette)
  return { look: l.id, palette: p.id }
}

function block(v: Partial<JsysVars>): string {
  const m: [keyof JsysVars, string][] = [
    ["bg", "--j-bg"], ["box", "--j-box"], ["text", "--j-text"], ["acc", "--j-acc"], ["accHi", "--j-acc-hi"], ["onAcc", "--j-on-acc"],
    ["dim", "--j-dim"], ["dim2", "--j-dim2"], ["glow", "--j-glow"], ["hi", "--j-hi"], ["ok", "--j-ok"], ["font", "--j-font"],
  ]
  return m.filter(([k]) => v[k] != null).map(([k, name]) => `${name}:${v[k]}`).join(";")
}

/** The variables for every palette. The default sits on :root so a screen is never without values;
 *  the others key off <html data-jsys="…">, and a palette with dark values adds a rule for the Hub's
 *  own dark class. Rendered once by the /jordan layout. */
export const JSYS_PALETTE_CSS = [
  `:root{${block(getJsysPalette(JSYS_DEFAULT_PALETTE).vars)}}`,
  ...JSYS_PALETTES.filter(p => p.id !== JSYS_DEFAULT_PALETTE).map(p => `html[${JSYS_ATTR}="${p.id}"]{${block(p.vars)}}`),
  ...JSYS_PALETTES.filter(p => p.darkVars).map(p => `html.dark[${JSYS_ATTR}="${p.id}"]{${block(p.darkVars!)}}`),
].join("\n")

/** Runs before the /jordan content paints, so a saved look never flashes the terminal first. Inlined
 *  by the layout as a plain <script>; kept to what an old iPad's Safari can run. */
export const JSYS_BOOT_SCRIPT =
  `(function(){try{var d=document.documentElement;` +
  `var L=${JSON.stringify(JSYS_LOOKS.map(l => l.id))},P=${JSON.stringify(JSYS_PALETTES.map(p => [p.id, p.look]))};` +
  `var l=localStorage.getItem(${JSON.stringify(JSYS_LOOK_KEY)}),p=localStorage.getItem(${JSON.stringify(JSYS_THEME_KEY)});` +
  `if(L.indexOf(l)<0)l=${JSON.stringify(JSYS_DEFAULT_LOOK)};` +
  `var ok=false;for(var i=0;i<P.length;i++)if(P[i][0]===p&&P[i][1]===l)ok=true;` +
  `if(!ok){p=${JSON.stringify(JSYS_DEFAULT_PALETTE)};for(var j=0;j<P.length;j++)if(P[j][1]===l){p=P[j][0];break}}` +
  `if(l===${JSON.stringify(JSYS_DEFAULT_LOOK)})d.removeAttribute(${JSON.stringify(JSYS_LOOK_ATTR)});else d.setAttribute(${JSON.stringify(JSYS_LOOK_ATTR)},l);` +
  `if(p===${JSON.stringify(JSYS_DEFAULT_PALETTE)})d.removeAttribute(${JSON.stringify(JSYS_ATTR)});else d.setAttribute(${JSON.stringify(JSYS_ATTR)},p);` +
  `}catch(e){}})();`
