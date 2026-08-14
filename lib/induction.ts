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
 * Slide bodies are plain text so anyone can edit them without markup:
 * a blank line starts a paragraph, a line beginning "- " is a bullet.
 * Shared by the presenter, the preview in the editor and the print view.
 */
export type BodyBlock = { type: "p" | "li"; text: string }

export function parseSlideBody(body: string | null | undefined): BodyBlock[] {
  const out: BodyBlock[] = []
  for (const raw of (body ?? "").split("\n")) {
    const line = raw.trim()
    if (!line) continue
    if (/^[-*•]\s+/.test(line)) out.push({ type: "li", text: line.replace(/^[-*•]\s+/, "") })
    else out.push({ type: "p", text: line })
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

export type SignedItem = { label: string; ticked: boolean }

/** Signature rows store `items` as JSON; it has been through the DB so nothing is guaranteed. */
export function parseSignedItems(value: unknown): SignedItem[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map(r => ({ label: String(r.label ?? ""), ticked: r.ticked === true }))
    .filter(r => r.label)
}
