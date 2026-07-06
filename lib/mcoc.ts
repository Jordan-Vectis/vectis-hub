// Shared MCOC constants for the secret-menu roster + counter tools.

export const MCOC_CLASSES = ["Cosmic", "Tech", "Mutant", "Skill", "Science", "Mystic"] as const
export type McocClass = (typeof MCOC_CLASSES)[number]

// Class accent colours (roughly the in-game class colours).
export const CLASS_COLOUR: Record<string, string> = {
  cosmic: "#3fb7ff", tech: "#4be0d0", mutant: "#ffd23f",
  skill: "#ff5a5a", science: "#4bff6a", mystic: "#c77dff",
}

export function classColour(cls: string): string {
  return CLASS_COLOUR[(cls ?? "").toLowerCase()] ?? "#33ff66"
}

// Normalise a class string the AI or a human typed to one of the six (or "").
export function normaliseClass(raw: string): string {
  const s = (raw ?? "").trim().toLowerCase()
  return MCOC_CLASSES.find((c) => c.toLowerCase() === s) ?? ""
}

export function cleanChampName(raw: string): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 60)
}
