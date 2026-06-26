// Single source of truth for auction types: value, human label, and a fun little emoji
// used next to the type in the cataloguing auction lists (desktop + tablet).
export const AUCTION_TYPES = [
  { value: "GENERAL",  label: "General",   emoji: "🎁" },
  { value: "DIECAST",  label: "Diecast",   emoji: "🚗" },
  { value: "TRAINS",   label: "Trains",    emoji: "🚂" },
  { value: "VINYL",    label: "Vinyl",     emoji: "🎵" },
  { value: "TV_FILM",  label: "TV & Film", emoji: "🎬" },
  { value: "MATCHBOX", label: "Matchbox",  emoji: "🏎️" },
  { value: "COMICS",   label: "Comics",    emoji: "💥" },
  { value: "BEARS",    label: "Bears",     emoji: "🧸" },
  { value: "DOLLS",    label: "Dolls",     emoji: "🪆" },
] as const

const TYPE_MAP = Object.fromEntries(AUCTION_TYPES.map(t => [t.value, t]))

export function auctionTypeEmoji(value: string | null | undefined): string {
  return (value && TYPE_MAP[value]?.emoji) || "🏷"
}

export function auctionTypeLabel(value: string | null | undefined): string {
  return (value && TYPE_MAP[value]?.label) || value || "—"
}
