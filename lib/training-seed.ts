// The starting content for IT & Admin → Training.
//
// ⚠ Only ever written into a COMPLETELY EMPTY table, exactly like the induction deck: once an
// environment has been seeded, editing this file changes nothing there. Fix a lesson in the app.
//
// Two halves:
//   • MODULE_SEEDS — one course per panel, derived from the Hub's own cards, so every panel in
//     the app has somewhere for its training to go the moment anyone wants to write it.
//   • ADMIN_CENTRE_SLIDES / ADMIN_CENTRE_EXERCISES — the first course, written in full.

import { APP_CARD_DEFS } from "@/lib/app-cards"

export type SeedSlide = {
  title: string
  subtitle?: string
  body?: string
  layout?: "TITLE" | "CONTENT" | "CARDS" | "STATEMENT"
  graphic?: "NONE" | "STEPS" | "EXTINGUISHERS"
  tryHref?: string
  tryLabel?: string
  notes?: string
}

export type SeedExercise = {
  title: string
  brief: string
  panel?: string
  kind: string
  params?: Record<string, unknown>
  expected?: string
  hint?: string
  explain?: string
}

export type SeedModule = {
  key: string
  title: string
  icon: string
  blurb: string
  href: string | null
  appKey: string | null
  accent: string
}

// ─── One course per panel ────────────────────────────────────────────────────
// Read off APP_CARD_DEFS rather than typed out again: a new tool added to the Hub gets a
// training slot automatically, and nothing here can name a panel that no longer exists.
// The card's own colour carries over so a course looks like the thing it teaches.

const ACCENTS: Record<string, string> = {
  "border-green-500": "green", "border-blue-500": "blue", "border-amber-500": "amber",
  "border-teal-500": "teal", "border-indigo-500": "indigo", "border-red-500": "red",
  "border-slate-500": "slate", "border-cyan-500": "cyan", "border-rose-500": "rose",
  "border-yellow-500": "yellow", "border-violet-500": "violet", "border-emerald-500": "emerald",
  "border-purple-500": "purple", "border-orange-500": "orange", "border-pink-500": "pink",
  "border-sky-500": "sky", "border-lime-500": "lime", "border-fuchsia-500": "fuchsia",
}

// The Admin Centre comes first — it is the one that is written, and a course list whose first
// entry is empty teaches people the whole tool is empty.
const FIRST = ["LOT_LOOKUP"]

export const MODULE_SEEDS: SeedModule[] = APP_CARD_DEFS
  .filter(c => !c.comingSoon && c.key !== "TRAINING")
  .map(c => ({
    key:    c.key,
    title:  c.defaultLabel,
    icon:   c.icon,
    // The card's own description is already a one-line explanation of the panel, agreed and in
    // use on the Hub. Repeating it here by hand would only let the two drift apart.
    blurb:  c.defaultDescription,
    href:   c.href,
    appKey: c.appKey ?? null,
    accent: ACCENTS[c.border] ?? "indigo",
  }))
  .sort((a, b) => {
    const ai = FIRST.indexOf(a.key), bi = FIRST.indexOf(b.key)
    if (ai !== bi) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
    return a.title.localeCompare(b.title)
  })

// ─── The Admin Centre course ─────────────────────────────────────────────────
// Lives in its own file — it is the biggest single piece of content in here, and a course per
// panel means this file would otherwise become a directory's worth of prose in one module.
// Re-exported so callers keep one import.
export { ADMIN_CENTRE_SLIDES, ADMIN_CENTRE_EXERCISES } from "@/lib/training-admin-centre"
