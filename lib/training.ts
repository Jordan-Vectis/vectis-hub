// IT & Admin → Training: shared types and constants.
//
// Plain module (no "use client") so the server pages, the client editor and the presenter all
// read the same lists — a client-only copy is how symbol maps went blank on the public first
// aid page (see components/site-plan-view.tsx).
//
// The slide body parser, layouts and graphics are deliberately the INDUCTION ones rather than
// a second copy: a training deck and an induction deck are the same object, and two parsers
// would drift the first time either was fixed.

export { parseSlideBody, youTubeId, SLIDE_LAYOUTS, SLIDE_GRAPHICS, isSlideLayout, isSlideGraphic } from "@/lib/induction"
export type { BodyBlock, SlideLayout, SlideGraphic } from "@/lib/induction"

/**
 * What a "now you do it" task asks, and how it is marked.
 *
 * ⚠ Everything except FREE_TEXT and CHOICE is marked from the LIVE database at the moment the
 * trainee answers. That is the whole point: a task with a barcode typed into it is wrong the
 * day that lot is deleted, and a training pack nobody trusts is worse than none. See
 * `pickFor` in lib/training-check.ts for how a real example is chosen each time.
 */
export const EXERCISE_KINDS = [
  // ── One lot in, one fact out — the 🏷️ Barcode button ──
  { key: "WHO_CATALOGUED",   label: "Who catalogued this lot?",            blurb: "Picks a real lot; the answer is its Hub cataloguer.",           live: true,  panel: "code" },
  { key: "WHEN_CATALOGUED",  label: "When was this lot catalogued?",       blurb: "Picks a real lot; the answer is the date it was entered.",      live: true,  panel: "code" },
  { key: "LOT_SALE",         label: "Which sale is this lot in?",          blurb: "Picks a real lot; the answer is its sale code.",                live: true,  panel: "code" },
  { key: "LOT_SALE_DATE",    label: "When is this lot going through?",     blurb: "Picks a lot in a dated sale; the answer is that sale's DATE.",  live: true,  panel: "code" },
  { key: "LOT_UNIQUE_ID",    label: "What is this lot's unique ID?",       blurb: "Barcode in, unique ID out — teaches the two identifiers.",      live: true,  panel: "code" },
  { key: "LOT_RECEIPT",      label: "Which receipt did this lot come in on?", blurb: "Picks a real lot; the answer is its receipt number.",        live: true,  panel: "code" },
  { key: "LOT_TOTE",         label: "Which tote was this lot made from?",  blurb: "Picks a real lot; the answer is the tote on the lot card.",     live: true,  panel: "code" },
  { key: "LOT_LOCATION",     label: "Where is this lot physically?",       blurb: "Picks a lot BC has a location for; the answer is that location.", live: true, panel: "code" },
  { key: "BC_NAME",          label: "Who is this BC code / username?",     blurb: "Picks a real BC record; the answer is the person behind the code.", live: true, panel: "code" },
  // ── A receipt, tote or customer in ──
  { key: "LOT_COUNT",        label: "How many lots on this receipt / tote / customer?", blurb: "⚠ Counts HUB lots only; the screen also lists BC-only rows, so it has two answers.", live: true, panel: "receipt" },
  { key: "LOT_VENDOR",       label: "Whose lots are these?",               blurb: "Picks a real receipt; the answer is the customer number.",      live: true,  panel: "receipt" },
  { key: "VENDOR_SALE_COUNT",label: "How many sales is this customer in?", blurb: "Picks a customer with lots in several sales; answer is how many.", live: true, panel: "receipt" },
  // ── A whole sale — the 🔨 Sale and lot number button ──
  { key: "SALE_TOP",         label: "Who catalogued the most in this sale?", blurb: "Picks a real sale; the answer is the top cataloguer.",        live: true,  panel: "sale" },
  { key: "SALE_COUNT",       label: "How many lots are in this sale?",     blurb: "⚠ Counts the HUB's lots; the sale screen counts BC's. Use with care.", live: true, panel: "sale" },
  { key: "SALE_CATALOGUERS", label: "How many people catalogued this sale?", blurb: "⚠ Counts the HUB's cataloguers; the sale screen lists only those BC also has.", live: true, panel: "sale" },
  // ── Judgement, not lookup ──
  { key: "CHOICE",           label: "Multiple choice",                     blurb: "For the bits that are judgement — which button, which number, what a warning means.", live: false, panel: null },
  { key: "FREE_TEXT",        label: "Typed answer (fixed)",                blurb: "⚠ Goes stale. Only for answers that cannot change.",            live: false, panel: null },
] as const

export type ExerciseKind = typeof EXERCISE_KINDS[number]["key"]

export function isExerciseKind(v: string): v is ExerciseKind {
  return EXERCISE_KINDS.some(k => k.key === v)
}

export function exerciseKindLabel(v: string): string {
  return EXERCISE_KINDS.find(k => k.key === v)?.label ?? v
}

export function isLiveKind(v: string): boolean {
  return EXERCISE_KINDS.find(k => k.key === v)?.live === true
}

/**
 * The Admin Centre's five search options — the buttons under "1 · What have you got?".
 *
 * ⚠ These are MODES on one page, not tabs. Jordan rebuilt the panel on 2026-08-18 ("combine all
 * the options… a single page… as simple and idiot proof as possible"), so an exercise's `panel`
 * is now a HINT telling the trainee which button to press, not a choice of which screen to open
 * beside them. Keys match `Mode` in app/(app)/tools/lot-lookup/lookup-client.tsx.
 */
export const ADMIN_CENTRE_PANELS = [
  { key: "receipt", icon: "🧾", label: "Receipt number" },
  { key: "tote",    icon: "📦", label: "Tote number" },
  { key: "vendor",  icon: "👤", label: "Customer number" },
  { key: "sale",    icon: "🔨", label: "Sale and lot number" },
  { key: "code",    icon: "🏷️", label: "Barcode" },
] as const

export function panelLabel(key: string | null | undefined): string {
  const p = ADMIN_CENTRE_PANELS.find(x => x.key === key)
  return p ? `${p.icon} ${p.label}` : ""
}

/** What a lookup exercise searches by — mirrors the Admin Centre's own three modes. */
export const LOOKUP_TYPES = ["receipt", "tote", "vendor"] as const
export type LookupType = typeof LOOKUP_TYPES[number]

export const LOOKUP_TYPE_LABELS: Record<string, string> = {
  receipt: "receipt number", tote: "tote number", vendor: "customer number",
}

/**
 * An exercise's stored `params`. It has been through JSONB, so nothing is guaranteed.
 * `mode` is the important one — PICK means "choose a real example from the live data when
 * this is served", FIXED means "use q exactly as typed".
 */
export type ExerciseParams = {
  mode?: "PICK" | "FIXED"
  q?: string
  type?: LookupType
  min?: number          // PICK only — ignore examples smaller than this, so "how many lots" isn't always 1
  options?: string[]    // CHOICE
  correct?: number      // CHOICE — index into options
}

export function parseParams(value: unknown): ExerciseParams {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const r = value as Record<string, unknown>
  const type = typeof r.type === "string" && (LOOKUP_TYPES as readonly string[]).includes(r.type)
    ? (r.type as LookupType) : undefined
  return {
    mode:    r.mode === "FIXED" ? "FIXED" : r.mode === "PICK" ? "PICK" : undefined,
    q:       typeof r.q === "string" ? r.q : undefined,
    type,
    min:     typeof r.min === "number" && isFinite(r.min) ? r.min : undefined,
    options: Array.isArray(r.options) ? r.options.filter((o): o is string => typeof o === "string") : undefined,
    correct: typeof r.correct === "number" ? r.correct : undefined,
  }
}

/** "Find receipt {{q}}" → "Find receipt R000009". Anything unfilled is left visible, not blanked. */
export function fillBrief(brief: string, subject: string): string {
  return brief.replace(/\{\{\s*q\s*\}\}/g, subject || "{{q}}")
}

// ─── Marking ─────────────────────────────────────────────────────────────────

/**
 * Loose enough that a right answer typed by a human is accepted, strict enough that a wrong
 * one is not. Case, punctuation, and the double spaces people leave after a paste all go.
 */
export function normalise(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

/**
 * ⚠ Names are matched on SURNAME, not on the whole string. "Annabell Fenby", "annabell",
 * "Fenby" and "A Fenby" are all the same person to someone reading a screen, and marking three
 * of those wrong teaches people the tool is broken rather than teaching them the tool.
 */
export function nameMatches(answer: string, correct: string): boolean {
  const a = normalise(answer)
  const c = normalise(correct)
  if (!a || !c) return false
  if (a === c) return true
  const parts = c.split(" ").filter(p => p.length > 2)
  if (!parts.length) return false
  const surname = parts[parts.length - 1]
  // The surname on its own is enough; a first name on its own is not — several people share one.
  if (a === surname) return true
  return parts.every(p => a.includes(p))
}

/** Numbers may be typed as "12", "12 lots", or "about 12". Only the digits matter. */
export function numberMatches(answer: string, correct: number): boolean {
  const m = answer.match(/-?\d+/)
  return m ? Number(m[0]) === correct : false
}

const MONTHS = ["january", "february", "march", "april", "may", "june",
                "july", "august", "september", "october", "november", "december"]

/**
 * Dates, typed by a human reading "3 August 2026" off a screen. Accepts the day with the month
 * named or numbered, in either order, and the ISO form — "3 Aug", "3 August 2026", "03/08/2026",
 * "2026-08-03". ⚠ Deliberately does NOT require the year: the screen shows one date and the
 * trainee is copying it, so demanding a year only marks careful people wrong.
 */
export function dateMatches(answer: string, iso: string | Date): boolean {
  const d = iso instanceof Date ? iso : new Date(iso)
  if (isNaN(d.getTime())) return false
  // Europe/London, to agree with what the panel printed.
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "numeric", year: "numeric", timeZone: "Europe/London",
  }).formatToParts(d)
  const day   = Number(parts.find(p => p.type === "day")?.value ?? 0)
  const month = Number(parts.find(p => p.type === "month")?.value ?? 0)
  if (!day || !month) return false

  const a = answer.toLowerCase()
  const nums = (a.match(/\d+/g) ?? []).map(Number)
  const hasDay = nums.includes(day)
  if (!hasDay) return false
  const monthName = MONTHS[month - 1]
  // "aug" is enough; "au" is not — three letters is the shortest unambiguous month.
  const namedMonth = a.includes(monthName) || a.includes(monthName.slice(0, 3))
  return namedMonth || nums.includes(month)
}

/** Codes: F090, f090, "F090 — Diecast", "sale F090" all mean the same sale. */
export function codeMatches(answer: string, correct: string): boolean {
  const a = normalise(answer).replace(/\s+/g, "")
  const c = normalise(correct).replace(/\s+/g, "")
  if (!a || !c) return false
  return a === c || a.includes(c)
}
