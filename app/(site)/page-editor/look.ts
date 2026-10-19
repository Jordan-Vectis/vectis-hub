// Shared look-and-feel for the page editor's blocks — the site's colours, the size and width
// choices, and the small helpers every block uses. Pure: safe on the server and in the editor.
//
// The colours are the ones site.css measures off vectis.co.uk (2026-10-14): navy for everything
// interactive, red only for the small caption lines, magenta only for the banner button, warm grey
// bands between white sections. Blocks reach them through the --pe-* variables below, so the same
// block reads on a light and a dark background.

export const BRAND = {
  navy: "#2e328e",
  navyDark: "#22256f",
  red: "#ff0300",
  magenta: "#f102f2",
  orange: "#c27608",
  ink: "#212529",
  muted: "#6c757d",
  band: "#f6f4f4",
  line: "#e6e6e6",
  // The old names, kept as aliases of the new palette so a saved page or an import that still
  // uses them draws in the current colours rather than the retired ones.
  blue: "#2e328e",
  deep: "#22256f",
  teal: "#2e328e",
} as const

// The swatches every colour field offers first; any other colour can be picked or typed.
export const SWATCHES: { hex: string; name: string }[] = [
  { hex: "#ffffff", name: "White" },
  { hex: BRAND.band, name: "Light grey (band)" },
  { hex: BRAND.line, name: "Hairline grey" },
  { hex: BRAND.muted, name: "Grey" },
  { hex: BRAND.ink, name: "Ink" },
  { hex: "#000000", name: "Black" },
  { hex: BRAND.navy, name: "Vectis navy" },
  { hex: BRAND.navyDark, name: "Dark navy" },
  { hex: BRAND.red, name: "Vectis red" },
  { hex: BRAND.magenta, name: "Magenta" },
  { hex: BRAND.orange, name: "Orange" },
]

export const HEX = /^#[0-9a-f]{6}$/i
export const colourOr = (v: unknown, dflt = "") => (typeof v === "string" && HEX.test(v.trim()) ? v.trim().toLowerCase() : dflt)

/** True for a colour dark enough that words on it should be light. */
export function isDark(hex: string): boolean {
  if (!HEX.test(hex)) return false
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  // Relative luminance (sRGB), the WCAG way — under ~0.4 reads as a dark background.
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) < 0.4
}

// Words on a light or a dark background. Blocks read these CSS variables for their default
// colours, so a heading dropped into a navy section turns white without anyone choosing it.
// --pe-rule is the short bar under a title and the quote's bar: navy on white, white on navy.
export const TONE_VARS = {
  light: { "--pe-heading": "#000000", "--pe-text": BRAND.ink, "--pe-muted": BRAND.muted, "--pe-kicker": BRAND.red, "--pe-link": BRAND.navy, "--pe-line": BRAND.line, "--pe-rule": BRAND.navy },
  dark: { "--pe-heading": "#ffffff", "--pe-text": "#e5e7eb", "--pe-muted": "#d1d5db", "--pe-kicker": "#ffb3b2", "--pe-link": "#ffffff", "--pe-line": "rgba(255,255,255,0.18)", "--pe-rule": "#ffffff" },
} as const

// ── Choices shared by several blocks (Tailwind needs every class written out in full) ──

export const WIDTH_OPTIONS = [
  { label: "Full width (edge to edge)", value: "full" },
  { label: "Wide", value: "wide" },
  { label: "Standard", value: "standard" },
  { label: "Text (easy reading)", value: "text" },
  { label: "Narrow", value: "narrow" },
]
// The same measures as site.css's vs-container (1320px) and vs-container-wide (1600px), with the
// site's 20px / 32px gutters — written out rather than using the classes, because those set
// padding as a shorthand and would wipe the block's own vertical padding.
export const WIDTH_CLASS: Record<string, string> = {
  full: "w-full px-5 sm:px-8",
  wide: "w-full max-w-[1600px] mx-auto px-5 sm:px-8",
  standard: "w-full max-w-[1320px] mx-auto px-5 sm:px-8",
  text: "w-full max-w-[900px] mx-auto px-5 sm:px-8",
  narrow: "w-full max-w-[680px] mx-auto px-5 sm:px-8",
}

export const PADDING_OPTIONS = [
  { label: "None", value: "none" },
  { label: "Small", value: "small" },
  { label: "Medium", value: "medium" },
  { label: "Large", value: "large" },
  { label: "Extra large", value: "xl" },
]
// "Medium" is the site's own section rhythm (vs-section: 48px, 64px from lg).
export const PADDING_Y: Record<string, string> = { none: "py-0", small: "py-6", medium: "py-12 lg:py-16", large: "py-16 lg:py-24", xl: "py-24 lg:py-32" }
export const PADDING_ALL: Record<string, string> = { none: "p-0", small: "p-4", medium: "p-6 sm:p-8", large: "p-8 sm:p-10", xl: "p-10 sm:p-14" }

export const ALIGN_OPTIONS = [
  { label: "Left", value: "left" },
  { label: "Centre", value: "center" },
  { label: "Right", value: "right" },
]
export const TEXT_ALIGN: Record<string, string> = { left: "text-left", center: "text-center", right: "text-right" }
export const FLEX_JUSTIFY: Record<string, string> = { left: "justify-start", center: "justify-center", right: "justify-end" }
export const SELF_ALIGN: Record<string, string> = { left: "mr-auto", center: "mx-auto", right: "ml-auto" }

export const YES_NO = [
  { label: "Yes", value: true },
  { label: "No", value: false },
]

// ── Pictures ────────────────────────────────────────────────────────────────
// A picture value is either a web address (https://…, or a site path starting "/") or the key of
// a file in the Hub's storage ("site-pages/…", "news-photos/…"), which is shown through
// /api/website/picture — that signs a fresh address on every request, so a saved page never
// holds an address that expires.
export function pictureSrc(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : ""
  if (!s) return null
  if (/^https?:\/\//i.test(s) || s.startsWith("/")) return s
  return `/api/website/picture?key=${encodeURIComponent(s)}`
}

// ── Links ───────────────────────────────────────────────────────────────────
export type LinkKind = "internal" | "anchor" | "external" | "none"
export function linkKind(href: unknown): LinkKind {
  const h = typeof href === "string" ? href.trim() : ""
  if (!h) return "none"
  if (h.startsWith("#")) return "anchor"
  if (h.startsWith("/") && !h.startsWith("//")) return "internal"
  if (/^(https?:|mailto:|tel:)/i.test(h)) return "external"
  return "none"
}

// ── Videos ──────────────────────────────────────────────────────────────────
/** A YouTube or Vimeo address as its player address, an .mp4 as itself, or null. */
export function videoEmbed(url: unknown): { kind: "iframe" | "file"; src: string } | null {
  const u = typeof url === "string" ? url.trim() : ""
  if (!u) return null
  const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/)
  if (yt) return { kind: "iframe", src: `https://www.youtube.com/embed/${yt[1]}` }
  const vm = u.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  if (vm) return { kind: "iframe", src: `https://player.vimeo.com/video/${vm[1]}` }
  if (/^https?:\/\/.+\.(mp4|webm)(\?|$)/i.test(u)) return { kind: "file", src: u }
  return null
}

// ── HTML typed by an admin (the HTML block) ─────────────────────────────────
// Only admins can edit pages, and the site is behind the login, but scripts and inline handlers
// are still removed: a page must never be able to run code in a visitor's browser.
export function safeHtml(html: unknown): string {
  return String(html ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<(?:object|embed|form|input|button|textarea|select|link|meta|base)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)\s*=\s*("|')\s*(?:javascript|vbscript|data):[^"']*\2/gi, "")
}

/** Lines of a textarea as a clean list (blank lines dropped). */
export const lines = (v: unknown) => String(v ?? "").split(/\r?\n/).map(s => s.trim()).filter(Boolean)
