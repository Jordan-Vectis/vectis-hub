// Shared parse/build for a lot's condition string. Used by the Lot Wizard, the desktop
// auction-manager lot editor, and the tablet lot editor so the three never drift.
//
// Format: an item condition, optionally followed by a SEPARATE box/packaging sentence:
//   "Near Mint to Excellent"
//   "Near Mint to Excellent. Box is Good to Good Plus."
//   "Mint. Packaging is Fair."
//   "Good. Inner tray is Good."        (custom prefix)
//   "Box is Good."                     (box only, no item condition)

export const CONDITION_GRADES = ["Mint", "Near Mint", "Excellent", "Good Plus", "Good", "Fair", "Poor"]

// Built-in box/packaging wording presets. The live list is DB-managed at
// /admin/condition-wording (seeded from these); this stays the instant fallback and the
// set parseCondition recognises so a saved wording highlights its chip on re-edit.
export const DEFAULT_WORDINGS = ["Box is", "Packaging is", "Carded Back is", "Blister Card is"]

// A box wording is either a preset label (e.g. "Box is") or the literal "custom"
// (then boxCustomPrefix holds the free text). Dynamic, so this is just a string.
export type BoxPrefixMode = string

export interface ConditionParts {
  cond1: string
  cond2: string
  boxOn: boolean
  boxPrefixMode: BoxPrefixMode
  boxCustomPrefix: string
  boxCond1: string
  boxCond2: string
}

export const emptyCondition: ConditionParts = {
  cond1: "", cond2: "", boxOn: false, boxPrefixMode: "Box is", boxCustomPrefix: "", boxCond1: "", boxCond2: "",
}

// Sort a pair of grades best→worst the same way every editor does.
const byGrade = (a: string, b: string) => CONDITION_GRADES.indexOf(b) - CONDITION_GRADES.indexOf(a)
const gradeRange = (a: string, b: string) => [a, b].filter(Boolean).sort(byGrade).join(" to ")

// Longest-first so "Near Mint" wins over "Mint" and "Good Plus" over "Good".
const GRADE = "(?:Near Mint|Good Plus|Mint|Excellent|Good|Fair|Poor)"
// Whole string = optional prefix text + a trailing grade or "grade to grade", optional ".".
const BOX_RE = new RegExp(`^(.*?)\\s*(${GRADE}(?:\\s+to\\s+${GRADE})?)\\.?$`)

// ─── "Is the condition actually in the description?" ────────────────────────
// The Description Copier used to pop a blanket reminder every time it opened,
// which told nobody anything. These do the real check.

/** Loose text compare — collapse whitespace, drop trailing stops, ignore case. */
function norm(s: string): string {
  return (s ?? "").replace(/\s+/g, " ").replace(/\.\s*$/, "").trim().toLowerCase()
}

/** Does this text contain a condition GRADE at all?
 *  ⚠ Case-SENSITIVE on purpose. "Mint", "Good" and "Fair" are ordinary words —
 *  matching them case-insensitively would call "a good example of the type" a
 *  condition. Every grade written by buildCondition is capitalised, so requiring
 *  that is what separates a real grade from prose. */
export function containsConditionGrade(text: string): boolean {
  return new RegExp(`\\b${GRADE}\\b`).test(text ?? "")
}

export type ConditionCheck =
  | { state: "ok" }                       // the lot's condition is in the description
  | { state: "reworded" }                 // a grade is there, but not the recorded wording
  | { state: "missing" }                  // the description exists but omits the condition
  | { state: "no-description" }           // there is no description at all — a different job
  | { state: "only-in-description" }      // nothing recorded on the lot, but the description grades it
  | { state: "none-recorded" }            // nothing anywhere — it genuinely needs grading
  | { state: "unknown" }                  // we weren't given the lot's condition

/** Compare a lot's recorded condition against its description.
 *  `condition` undefined means the caller has no condition data (e.g. rows loaded
 *  from a spreadsheet), in which case all we can say is whether a grade appears. */
export function checkConditionInDescription(description: string, condition?: string | null): ConditionCheck {
  const desc = norm(description)
  const cond = norm(condition ?? "")

  if (condition === undefined) {
    return containsConditionGrade(description) ? { state: "ok" } : { state: "unknown" }
  }
  // ⚠ No description at all — a lot excluded from the AI, or simply not written yet. Saying
  // "the description has no condition in it" of a lot that has no description sends someone
  // to fix the wrong thing.
  if (!desc) return { state: "no-description" }

  // ⚠ An empty condition field used to return "none-recorded" WITHOUT looking at the
  // description, so a cataloguer who typed "Condition appears Good to Excellent." into the
  // description instead of using the grade dropdown was told the lot needed grading and that
  // there was "nothing to add here". The description is the thing the Copier cares about, and
  // it already had one. Only a lot with a condition NOWHERE genuinely needs grading.
  if (!cond) {
    return containsConditionGrade(description) ? { state: "only-in-description" } : { state: "none-recorded" }
  }
  if (desc.includes(cond)) return { state: "ok" }

  // Not verbatim. If every grade in the recorded condition appears in the
  // description, someone has written it in their own words — worth a look, but
  // not the same as forgetting it entirely.
  const grades = cond.match(new RegExp(GRADE, "gi")) ?? []
  const allGradesPresent = grades.length > 0 && grades.every(g => desc.includes(g.toLowerCase()))
  if (allGradesPresent) return { state: "reworded" }

  return containsConditionGrade(description) ? { state: "reworded" } : { state: "missing" }
}

// ─── The "Condition appears …" sentence in the description ──────────────────
// Add Conditions (bulk + the per-lot button) appends this sentence on its own line;
// Remove Conditions takes it out. ⚠ ONE shared rule for all three call sites.
//
// ⚠ Why these match ANY condition sentence rather than the exact current one
// (2026-08-20, Jordan: "we are now getting duplicate conditions and removing them
// only removes one"): the old check was `description.includes("Condition appears
// <current condition>.")`. The moment a lot was regraded after its sentence went in
// — a box condition added, a Locking Check suggestion accepted — the old sentence no
// longer matched, so Add appended a SECOND one and Remove only stripped the one for
// the current grade. Add now REPLACES whatever condition sentence is there, so a
// description carries exactly one, always the current one; Remove strips them all.
//
// A sentence is taken to run from "Condition appears" to the end of its line — that
// is where the tool always writes it (and a box condition has its own full stop in
// the middle, so "first full stop" would cut it short).
const CONDITION_SENTENCE_RE = /(?<![A-Za-z])[ \t]*\n?[ \t]*Condition appears [^\n]*/g

/** The sentence Add Conditions writes. No doubled full stop when the condition
 *  already ends in one ("Near Mint. Box is Good."). */
export function conditionSentence(condition: string): string {
  const c = (condition ?? "").trim()
  return c.endsWith(".") ? `Condition appears ${c}` : `Condition appears ${c}.`
}

/** Does the description carry a condition sentence at all (any wording)? */
export function hasConditionSentence(description: string | null | undefined): boolean {
  return new RegExp(CONDITION_SENTENCE_RE.source).test(description ?? "")
}

/** The description with every "Condition appears …" sentence removed, together
 *  with the new line or space that joined it. */
export function stripConditionSentences(description: string | null | undefined): string {
  return (description ?? "").replace(CONDITION_SENTENCE_RE, "").trim()
}

/** The condition sentence currently in a description — OUR wording only — or null. */
export function conditionSentenceIn(description: string | null | undefined): string | null {
  const m = (description ?? "").match(new RegExp(CONDITION_SENTENCE_RE.source))
  return m ? m[0].trim() : null
}

/** The description carrying exactly this sentence, on its own line at the end.
 *  Any sentence already there is replaced, never doubled. */
export function withConditionLine(description: string | null | undefined, sentence: string): string {
  const body = stripConditionSentences(description)
  return body ? `${body}\n${sentence}` : sentence
}

/** The description carrying exactly one condition sentence — the current one —
 *  on its own line at the end. Any earlier sentence is replaced, never doubled. */
export function withConditionSentence(description: string | null | undefined, condition: string): string {
  return withConditionLine(description, conditionSentence(condition))
}

// ─── Replacing a description must not take the condition line off the lot ────
//
// ⚠⚠ Measured on F114, 2026-09-01: **151 of 246 AI applies wiped the condition
// sentence** that Add Conditions had just put on. The AI is told never to write a
// condition (it is a human's judgement, recorded in its own field), so its text
// carries none — and every apply wrote it straight over the whole description
// field. Jordan saw that as "Add Conditions is glitchy, it randomly doesn't do all
// of them and I have to press it over and over": the button worked perfectly every
// time; the lots he had already done kept losing the line again as he applied more
// AI descriptions. The change log proved it — every lot in his four follow-up
// presses had been done by the first press and rewritten by `ai_apply` in between.
//
// Jordan's rule for this: "the condition always goes at the end and is phrased how
// the lot wizard does it; any wording relating to condition not from our wizard
// should never be affected." So only OUR sentence is carried over —
// CONDITION_SENTENCE_RE matches nothing else — and any other condition wording in
// either description is left exactly as the writer left it.
/**
 * `next` carrying the condition line the lot already had.
 *
 * ⚠ Never ADDS a line to a lot that did not have one: whether a lot's description
 * carries the sentence at all stays Add Conditions' decision.
 */
export function keepConditionLine(
  previous: string | null | undefined,
  condition: string | null | undefined,
  next: string,
): string {
  const had = conditionSentenceIn(previous)
  if (!had) return next
  // The condition FIELD is the record of truth, so a lot regraded since the line
  // went in comes back with its current grade. Falls back to the exact line that
  // was there when the field is blank — carrying it over unchanged can never
  // invent a grade.
  const cond = (condition ?? "").trim()
  return withConditionLine(next, cond ? conditionSentence(cond) : had)
}

export function buildCondition(p: ConditionParts): string {
  const item = gradeRange(p.cond1, p.cond2)
  const prefix = (p.boxPrefixMode === "custom" ? p.boxCustomPrefix.trim() : p.boxPrefixMode)
  const boxGrade = gradeRange(p.boxCond1, p.boxCond2)
  const box = p.boxOn && prefix && boxGrade ? `${prefix} ${boxGrade}` : ""
  if (item && box) return `${item}. ${box}.`
  if (box) return `${box}.`
  return item
}

export function parseCondition(raw: string | null | undefined): ConditionParts {
  const s = (raw ?? "").trim().replace(/\.\s*$/, "")
  if (!s) return { ...emptyCondition }

  let itemStr = s
  let boxStr = ""
  const sep = s.indexOf(". ")
  if (sep >= 0) {
    // "item. box." — only treat the tail as a box sentence if it has a prefix + grade,
    // otherwise the ". " is part of a legacy free-text condition and we keep it as item.
    const candidate = s.slice(sep + 2).trim()
    const m = BOX_RE.exec(candidate)
    if (m && m[1].trim()) { itemStr = s.slice(0, sep).trim(); boxStr = candidate }
  } else {
    // Box-only (no item condition) — recognise it when the whole string is "<wording> <grade>"
    // and the wording ends in "is" (the convention for every preset, built-in or custom). This
    // avoids mis-reading legacy free-text condition that happens to end in a grade word.
    const m = BOX_RE.exec(s)
    if (m && /\bis$/i.test(m[1].trim())) { itemStr = ""; boxStr = s }
  }

  const [c1 = "", c2 = ""] = itemStr.split(/\s+to\s+/i).map(x => x.trim())
  const parts: ConditionParts = { ...emptyCondition, cond1: c1, cond2: c2 }

  if (boxStr) {
    const m = BOX_RE.exec(boxStr)
    if (m) {
      const prefix = m[1].trim()
      const [b1 = "", b2 = ""] = m[2].split(/\s+to\s+/i).map(x => x.trim())
      parts.boxOn = true
      parts.boxCond1 = b1
      parts.boxCond2 = b2
      // Known preset → select its chip; anything else → the Custom field. (Wordings added
      // beyond the built-ins still round-trip correctly, they just show as Custom on re-edit.)
      if (DEFAULT_WORDINGS.includes(prefix)) parts.boxPrefixMode = prefix
      else { parts.boxPrefixMode = "custom"; parts.boxCustomPrefix = prefix }
    }
  }
  return parts
}
