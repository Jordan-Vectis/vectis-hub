import { STATIC_BLOCKS } from "./blocks"
import { LIVE_DEFS, type LiveType } from "./live-defs"

// Helpers for building a page's starting blocks (seeds.ts) — pure.

export type BlockData = { type: string; props: Record<string, unknown> & { id: string } }
export type PageData = { root: { props: Record<string, unknown> }; content: BlockData[] }

let counter = 0
const newId = (type: string) => `${type}-${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 7)}`

/** A block with every setting at its default, then the ones given. */
export function block(type: keyof typeof STATIC_BLOCKS | LiveType, props: Record<string, unknown> = {}): BlockData {
  const defaults = (type in STATIC_BLOCKS
    ? (STATIC_BLOCKS as Record<string, { defaultProps?: Record<string, unknown> }>)[type].defaultProps
    : (LIVE_DEFS as Record<string, { defaultProps: Record<string, unknown> }>)[type]?.defaultProps) ?? {}
  return { type, props: { ...defaults, ...props, id: newId(type) } }
}

export function pageData(title: string, content: BlockData[], seo: { seoTitle?: string; seoDescription?: string } = {}): PageData {
  return { root: { props: { title, seoTitle: seo.seoTitle ?? "", seoDescription: seo.seoDescription ?? "", background: "#ffffff" } }, content }
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
export const para = (s: string) => `<p>${esc(s)}</p>`

// ── Collected HTML → blocks ─────────────────────────────────────────────────
// The department pages arrive from vectis.co.uk as HTML (headings, paragraphs, lists, a video, a
// picture, the GET STARTED link) wrapped in layers of <div>. Turned into editable blocks in the
// order they appear: headings → Heading, a video → Video, a picture → Picture, the valuations link
// → a Button to our own Sell with us page, and the words between → Text.

type HtmlOptions = {
  /** Where a picture's site path is really held — our R2 key when uploaded, else the site's address. */
  picture: (path: string) => string
  /** Site-relative links made absolute (the pages they point at are on vectis.co.uk). */
  site: string
  /** The copy's own H1 is kept as an H2 — the page header is the page's H1 (one per page, for search engines). */
  demoteH1?: boolean
  /** Buttons for a dark background (the side box). */
  dark?: boolean
}

// Words out of HTML — for headings and button labels, which are plain text (React escapes them, so
// an "&amp;" left in would show as "&amp;").
const ENTITIES: Record<string, string> = { amp: "&", nbsp: " ", quot: "\"", apos: "'", "#39": "'", "#039": "'", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", pound: "£", hellip: "…", lt: "<", gt: ">" }
const stripTags = (s: string) =>
  s.replace(/<[^>]+>/g, "").replace(/&(#?[a-z0-9]+);/gi, (m, e: string) => ENTITIES[e.toLowerCase()] ?? m).replace(/\s+/g, " ").trim()

function absolutise(html: string, site: string): string {
  return html
    .replace(/(src|href)="(?:\/)?(images\/)/gi, `$1="${site}$2`)
    .replace(/(href)="\/(?!\/)/gi, `$1="${site}`)
}

// Loose words sitting between paragraphs and lists (the site wraps them in bare <div>s) become paragraphs.
function wrapLoose(html: string): string {
  const out: string[] = []
  const re = /<(p|ul|ol|blockquote|table)\b[\s\S]*?<\/\1>/gi
  let last = 0
  for (const m of html.matchAll(re)) {
    const before = html.slice(last, m.index)
    if (stripTags(before)) out.push(`<p>${before.trim().replace(/^(<br\s*\/?>\s*)+|(<br\s*\/?>\s*)+$/gi, "")}</p>`)
    out.push(m[0])
    last = (m.index ?? 0) + m[0].length
  }
  const tail = html.slice(last)
  if (stripTags(tail)) out.push(`<p>${tail.trim().replace(/^(<br\s*\/?>\s*)+|(<br\s*\/?>\s*)+$/gi, "")}</p>`)
  return out.join("")
}

export function htmlToBlocks(html: string | null | undefined, o: HtmlOptions): BlockData[] {
  if (!html) return []
  // The <div> and <span> layers carry nothing now (the collector stripped their classes).
  const flat = absolutise(html, o.site).replace(/<\/?(?:div|span|section|article)\b[^>]*>/gi, "\n").replace(/\n{2,}/g, "\n")
  const out: BlockData[] = []
  let buffer = ""
  const flush = () => {
    const t = wrapLoose(buffer.trim())
    if (stripTags(t)) out.push(block("Text", { text: t, size: "m" }))
    buffer = ""
  }
  const token = /<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>|<iframe\b[^>]*\bsrc="([^"]+)"[^>]*>(?:\s*<\/iframe>)?|<img\b([^>]*)>|<a\b[^>]*href="([^"]*\/valuations[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
  let last = 0
  for (const m of flat.matchAll(token)) {
    buffer += flat.slice(last, m.index)
    last = (m.index ?? 0) + m[0].length
    if (m[1]) {
      flush()
      const level = Number(m[1])
      const words = stripTags(m[2])
      if (!words) continue
      const h = level === 1 && o.demoteH1 ? 2 : level
      out.push(block("Heading", { text: words, level: `h${Math.min(4, h)}`, size: level === 1 ? "l" : level === 2 ? "m" : "s" }))
    } else if (m[3]) {
      flush()
      out.push(block("Video", { url: m[3].replace(/&amp;/g, "&") }))
    } else if (m[4] !== undefined) {
      flush()
      const src = m[4].match(/\bsrc="([^"]+)"/i)?.[1]
      const alt = m[4].match(/\balt="([^"]*)"/i)?.[1] ?? ""
      if (src) out.push(block("Picture", { src: o.picture(src.replace(o.site, "")), alt }))
    } else if (m[5]) {
      flush()
      const label = stripTags(m[6] ?? "") || "Get started"
      out.push(block("Buttons", { buttons: [{ label, link: "/sell-with-us", style: o.dark ? "white" : "red", newTab: false }], size: "m" }))
    }
  }
  buffer += flat.slice(last)
  flush()
  return out
}
