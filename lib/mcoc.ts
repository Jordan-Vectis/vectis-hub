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

// ── Champion profile vocabularies (for the Champion DB) ──────────────────────
// Fixed lists so AI-computed profiles stay consistent and matchable. IMMUNITIES
// = damage/effect types a champ can't be affected by (matters vs a defender
// that deals them). TAGS = counter-relevant capabilities a champ PROVIDES.

export const MCOC_IMMUNITIES = [
  "Bleed", "Poison", "Incinerate", "Coldsnap", "Frostbite", "Shock",
  "Degeneration", "Armor Break", "Stun", "Fatigue", "Power Drain", "Power Lock",
  "Nullify", "Regeneration Block",
] as const

export const MCOC_TAGS = [
  "Ability Accuracy Reduction", "Nullify", "Stagger", "Fate Seal",
  "Power Control", "Power Drain", "Power Lock", "Power Steal",
  "Heal Block", "Heal Reversal",
  "Incinerate", "Shock", "Bleed", "Poison", "Coldsnap", "Degeneration",
  "True Damage", "True Strike", "True Accuracy",
  "Armor Break", "Unstoppable", "Unblockable",
  "Evade", "Auto-Block", "Miss / Evade Counter",
  "Prowess", "Precision", "Cruelty", "Power Gain",
  "Regeneration", "Life Steal", "Purify / Cleanse",
  "Immunity Bypass", "Non-Contact / Ranged", "Buff Control", "Debuff Heavy",
  "Prevent Revive", "Degen on Contact",
] as const

// Normalise a class string the AI or a human typed to one of the six (or "").
export function normaliseClass(raw: string): string {
  const s = (raw ?? "").trim().toLowerCase()
  return MCOC_CLASSES.find((c) => c.toLowerCase() === s) ?? ""
}

export function cleanChampName(raw: string): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 60)
}

// Normalise a champ name for matching: lowercase, strip everything but letters
// and digits (so "Kitty Pryde" == "kitty pryde", "Ægon" ~ "aegon"-ish handled by
// callers). Deliberately NOT fuzzy — matching is exact on this normalised form
// to avoid the wrong-champ matches loose "contains" matching caused.
export function normChampName(raw: string): string {
  return (raw ?? "")
    .toLowerCase()
    .replace(/æ/g, "ae").replace(/ø/g, "o")
    .replace(/[^a-z0-9]/g, "")
}
