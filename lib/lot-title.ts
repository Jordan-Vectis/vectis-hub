// How a lot title is derived from its description. ONE definition.
//
// ⚠ This used to live privately inside lib/actions/catalogue.ts, so the Locking Check wrote its
// own version from the rule in RULES.md — and got it wrong twice over: it kept the newlines and
// truncated at 83 instead of 82 + the ellipsis. The result was 634 of 635 lots reported as
// "title doesn't match the description" on a sale where every title was correct.
//
// Anything that generates OR verifies a title imports this. A second copy always drifts, and a
// checker that disagrees with the generator is worse than no checker.

/** Maximum title length INCLUDING the ellipsis (RULES.md). */
export const TITLE_MAX = 83

export function titleFromDescription(desc: string): string {
  // Newlines become spaces: a description is multi-line, a title is one line.
  const text = (desc ?? "").replace(/[\r\n]+/g, " ").trim()
  if (!text) return "Untitled"
  return text.length > TITLE_MAX ? text.slice(0, TITLE_MAX - 1) + "…" : text
}
