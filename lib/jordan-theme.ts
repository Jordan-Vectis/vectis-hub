// JORDAN.SYS → LOOK & FEEL. The one table every /jordan screen is coloured from.
//
// Jordan, 2026-09-18: "Can I have some UI options … the green and black retro is a little jarring to
// some people." Every /jordan page used to hardcode the same five hex colours (#33ff66 accent,
// #1f5c33 lines, #0a2214 hover fill, #040f08 boxes, black) in its Tailwind classes. They are now CSS
// variables — `text-(--j-acc)`, `border-(--j-dim)`, `bg-(--j-bg)` and so on — and THIS file is the
// only place the values live. Change a colour here and every screen follows.
//
// ⚠ Plain TypeScript on purpose — no React, no "use client". app/(app)/jordan/layout.tsx (a server
// component) turns JSYS_THEMES into a <style> block and a no-flash boot script; the picker and the
// hook live in app/(app)/jordan/jsys-style.tsx.
//
// ⚠ The accent IS the text colour, as it always was (the retro look is "everything green"). A theme
// that wants calm therefore makes the accent a soft text colour, not a bright highlight — and `hi`
// is the brighter emphasis colour that used to be a hardcoded text-white.

export type JsysTheme = {
  id: string
  label: string
  blurb: string
  vars: {
    bg: string      // page and inputs                (was bg-black)
    box: string     // panels                         (was #040f08)
    acc: string     // text AND accent                (was #33ff66)
    accHi: string   // accent, hovered                (was #5cff88)
    onAcc: string   // text on an accent-filled button (was text-black)
    dim: string     // lines and placeholders         (was #1f5c33)
    dim2: string    // quieter lines inside a panel   (was #123d22)
    glow: string    // hover / active fill            (was #0a2214)
    hi: string      // emphasis text                  (was text-white)
    ok: string      // "fine" status green            (the garage's due-date colour)
    font: string
  }
}

const MONO = "var(--font-geist-mono), ui-monospace, Menlo, Consolas, monospace"
const SANS = "var(--font-geist-sans), system-ui, Arial, sans-serif"

// Order = order in the picker. RETRO is the original and stays the default.
export const JSYS_THEMES: JsysTheme[] = [
  {
    id: "retro", label: "RETRO", blurb: "green phosphor on black, the original",
    vars: { bg: "#000000", box: "#040f08", acc: "#33ff66", accHi: "#5cff88", onAcc: "#000000", dim: "#1f5c33", dim2: "#123d22", glow: "#0a2214", hi: "#ffffff", ok: "#33ff66", font: MONO },
  },
  {
    id: "clean", label: "CLEAN", blurb: "soft white on charcoal, no glow",
    vars: { bg: "#0f1115", box: "#161a21", acc: "#e4e7ee", accHi: "#ffffff", onAcc: "#0f1115", dim: "#2e333d", dim2: "#232830", glow: "#1c2129", hi: "#ffffff", ok: "#4ade80", font: SANS },
  },
  {
    id: "light", label: "LIGHT", blurb: "dark text on white, like paper",
    vars: { bg: "#ffffff", box: "#f4f5f7", acc: "#1f2430", accHi: "#000000", onAcc: "#ffffff", dim: "#d3d7de", dim2: "#e3e6eb", glow: "#eceef2", hi: "#000000", ok: "#15803d", font: SANS },
  },
  {
    id: "amber", label: "AMBER", blurb: "amber terminal on black",
    vars: { bg: "#000000", box: "#0d0900", acc: "#ffb000", accHi: "#ffc63a", onAcc: "#000000", dim: "#5c3d00", dim2: "#3d2a00", glow: "#201600", hi: "#ffffff", ok: "#ffb000", font: MONO },
  },
  {
    id: "ocean", label: "OCEAN", blurb: "sky blue on deep navy",
    vars: { bg: "#071019", box: "#0c1722", acc: "#8fd3ff", accHi: "#b8e4ff", onAcc: "#051019", dim: "#1f4d6e", dim2: "#163a53", glow: "#0d2033", hi: "#ffffff", ok: "#4ade80", font: SANS },
  },
]

export const JSYS_DEFAULT_THEME = "retro"
/** localStorage — per browser, like the CRT switch and the Hub's own light/dark. */
export const JSYS_THEME_KEY = "jordan_theme"
/** The attribute on <html> the variables key off. */
export const JSYS_ATTR = "data-jsys"

export function getJsysTheme(id: string | null | undefined): JsysTheme {
  return JSYS_THEMES.find(t => t.id === id) ?? JSYS_THEMES[0]
}

function block(t: JsysTheme): string {
  const v = t.vars
  return [
    `--j-bg:${v.bg}`, `--j-box:${v.box}`, `--j-acc:${v.acc}`, `--j-acc-hi:${v.accHi}`, `--j-on-acc:${v.onAcc}`,
    `--j-dim:${v.dim}`, `--j-dim2:${v.dim2}`, `--j-glow:${v.glow}`, `--j-hi:${v.hi}`, `--j-ok:${v.ok}`, `--j-font:${v.font}`,
  ].join(";")
}

/** The variables for every theme. The default sits on :root so a screen is never without values;
 *  the others key off <html data-jsys="…">. Rendered once by the /jordan layout. */
export const JSYS_THEME_CSS = [
  `:root{${block(getJsysTheme(JSYS_DEFAULT_THEME))}}`,
  ...JSYS_THEMES.filter(t => t.id !== JSYS_DEFAULT_THEME).map(t => `html[${JSYS_ATTR}="${t.id}"]{${block(t)}}`),
  // The rest of the page (the Hub's shell around /jordan) should not lose its own dark scrollbars etc.
].join("\n")

/** Runs before the /jordan content paints, so a saved theme never flashes green first. Inlined by
 *  the layout as a plain <script>; kept to what an old iPad's Safari can run. */
export const JSYS_BOOT_SCRIPT =
  `(function(){try{var t=localStorage.getItem(${JSON.stringify(JSYS_THEME_KEY)});` +
  `var ok=${JSON.stringify(JSYS_THEMES.map(t => t.id))};` +
  `if(t&&ok.indexOf(t)>=0&&t!==${JSON.stringify(JSYS_DEFAULT_THEME)})document.documentElement.setAttribute(${JSON.stringify(JSYS_ATTR)},t);` +
  `else document.documentElement.removeAttribute(${JSON.stringify(JSYS_ATTR)});}catch(e){}})();`
