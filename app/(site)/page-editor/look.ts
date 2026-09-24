// Shared look-and-feel for the page editor's blocks — the site's colours, the size and width
// choices, and the small helpers every block uses. Pure: safe on the server and in the editor.

export const BRAND = {
  blue: "#32348a",
  navy: "#1e1f5e",
  deep: "#12134a",
  red: "#db0606",
  teal: "#2ab4a6",
} as const

// The swatches every colour field offers first; any other colour can be picked or typed.
export const SWATCHES: { hex: string; name: string }[] = [
  { hex: "#ffffff", name: "White" },
  { hex: "#f9fafb", name: "Off-white" },
  { hex: "#f3f4f6", name: "Light grey" },
  { hex: "#6b7280", name: "Grey" },
  { hex: "#1f2937", name: "Charcoal" },
  { hex: "#000000", name: "Black" },
  { hex: BRAND.blue, name: "Vectis blue" },
  { hex: BRAND.navy, name: "Navy" },
  { hex: BRAND.deep, name: "Deep blue" },
  { hex: BRAND.red, name: "Vectis red" },
  { hex: BRAND.teal, name: "Teal" },
  { hex: "#f5c518", name: "Gold" },
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
export const TONE_VARS = {
  light: { "--pe-heading": BRAND.blue, "--pe-text": "#1f2937", "--pe-muted": "#6b7280", "--pe-kicker": BRAND.red, "--pe-link": BRAND.blue, "--pe-line": "#e5e7eb" },
  dark: { "--pe-heading": "#ffffff", "--pe-text": "#e5e7eb", "--pe-muted": "#d1d5db", "--pe-kicker": "#ff4d4d", "--pe-link": "#ffffff", "--pe-line": "rgba(255,255,255,0.18)" },
} as const

// ── Choices shared by several blocks (Tailwind needs every class written out in full) ──

export const WIDTH_OPTIONS = [
  { label: "Full width (edge to edge)", value: "full" },
  { label: "Wide", value: "wide" },
  { label: "Standard", value: "standard" },
  { label: "Text (easy reading)", value: "text" },
  { label: "Narrow", value: "narrow" },
]
export const WIDTH_CLASS: Record<string, string> = {
  full: "w-full px-4 sm:px-6",
  wide: "w-full max-w-[1800px] mx-auto px-4 sm:px-6 xl:px-10",
  standard: "w-full max-w-7xl mx-auto px-4 sm:px-6",
  text: "w-full max-w-4xl mx-auto px-4 sm:px-6",
  narrow: "w-full max-w-2xl mx-auto px-4 sm:px-6",
}

export const PADDING_OPTIONS = [
  { label: "None", value: "none" },
  { label: "Small", value: "small" },
  { label: "Medium", value: "medium" },
  { label: "Large", value: "large" },
  { label: "Extra large", value: "xl" },
]
export const PADDING_Y: Record<string, string> = { none: "py-0", small: "py-6", medium: "py-10", large: "py-16", xl: "py-24" }
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
