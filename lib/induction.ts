// Facilities → Induction: shared types and constants.
//
// Plain module (no "use client") so the server page, the client editor and the presenter
// all read the same lists — a client-only copy is how symbol maps went blank on the public
// first aid page (see components/site-plan-view.tsx).

/**
 * A slide can pull data that already lives in the Hub instead of repeating it in typed text.
 * ⚠ This is the whole reason the deck moved into the app: the PowerPoint listed first aiders,
 * kit locations and defibrillator locations by hand, so it was wrong the moment someone left.
 * These four render from the First Aid / Site Plan records at presentation time.
 */
export const LIVE_BLOCKS = [
  { key: "NONE",         label: "None — just the text above" },
  { key: "FIRST_AIDERS", label: "🩹 First aiders (live from First Aid)" },
  { key: "KITS",         label: "🧰 First aid kits (live from First Aid)" },
  { key: "DEFIBS",       label: "⚡ Defibrillators (live from First Aid)" },
  { key: "SITE_PLAN",    label: "🗺️ Site plan with its pins (live)" },
] as const

export type LiveBlock = typeof LIVE_BLOCKS[number]["key"]

export function isLiveBlock(v: string): v is LiveBlock {
  return LIVE_BLOCKS.some(b => b.key === v)
}

export function liveBlockLabel(v: string): string {
  return LIVE_BLOCKS.find(b => b.key === v)?.label ?? v
}

/**
 * How a slide is laid out on the big screen. 21 slides in an identical layout is
 * what made the deck read like a document rather than a presentation.
 */
export const SLIDE_LAYOUTS = [
  { key: "CONTENT",   label: "Standard — title, then the content" },
  { key: "TITLE",     label: "Title slide — centred, extra large" },
  { key: "STATEMENT", label: "Statement — one point, centred, no bullets" },
] as const

export type SlideLayout = typeof SLIDE_LAYOUTS[number]["key"]

export function isSlideLayout(v: string): v is SlideLayout {
  return SLIDE_LAYOUTS.some(l => l.key === v)
}

/**
 * Slide bodies are plain text so anyone can edit them without markup:
 * a blank line starts a paragraph, a line beginning "- " is a bullet, and a
 * short line with no full stop at the end is a HEADING within the slide.
 *
 * ⚠ The heading rule matters more than it looks. Without it every line rendered
 * at the same weight, so on the fire-equipment slide "When to use one" was
 * indistinguishable from the paragraph beneath it — the deck looked like a wall
 * of bold text. "## " forces a heading if the guess ever gets it wrong.
 */
export type BodyBlock = { type: "p" | "li" | "h"; text: string }

const MAX_HEADING_CHARS = 70

export function parseSlideBody(body: string | null | undefined): BodyBlock[] {
  const out: BodyBlock[] = []
  for (const raw of (body ?? "").split("\n")) {
    const line = raw.trim()
    if (!line) continue
    if (/^#{1,3}\s+/.test(line)) { out.push({ type: "h", text: line.replace(/^#{1,3}\s+/, "").replace(/:$/, "") }); continue }
    if (/^[-*•]\s+/.test(line)) { out.push({ type: "li", text: line.replace(/^[-*•]\s+/, "") }); continue }
    // A sentence ends in punctuation; a heading does not. Length guards against a
    // fragment of prose that happens to have lost its full stop.
    if (line.length <= MAX_HEADING_CHARS && !/[.!?]$/.test(line)) {
      out.push({ type: "h", text: line.replace(/:$/, "") })
      continue
    }
    out.push({ type: "p", text: line })
  }
  return out
}

/**
 * Pulls the 11-character id out of any YouTube link so it can be embedded.
 * The deck's three videos are ordinary watch?v= links; youtu.be and /embed/ are
 * accepted too because that is what people paste. Returns null when it is not
 * YouTube — the slide then shows a plain link rather than an empty black box.
 */
export function youTubeId(url: string | null | undefined): string | null {
  if (!url) return null
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/)
  return m ? m[1] : null
}

/**
 * ⚠ `required` is stored per item, not looked up from the form later. Without it an unticked
 * line cannot be told apart from a line nobody had to tick — and the PDF was printing every
 * optional blank in red under "were NOT confirmed", which flags a perfectly good record as
 * defective. Older rows (written before this was stored) have it undefined, which is why the
 * PDF treats "not known" as optional rather than asserting something it cannot know.
 */
export type SignedItem = { label: string; detail?: string; ticked: boolean; required?: boolean }

/** Signature rows store `items` as JSON; it has been through the DB so nothing is guaranteed. */
export function parseSignedItems(value: unknown): SignedItem[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map(r => ({
      label:    String(r.label ?? ""),
      detail:   typeof r.detail === "string" && r.detail ? r.detail : undefined,
      ticked:   r.ticked === true,
      required: typeof r.required === "boolean" ? r.required : undefined,
    }))
    .filter(r => r.label)
}
