// Product codes in a lot's key points and description — Charlie Bears CB252575,
// Steiff white tags, LEGO set numbers and so on.
//
// ⚠ Why this exists: the Key Points stage is TEXT-ONLY (its route sends no images), and its
// job is to put the cataloguer's facts back into the description — it may only ever insert
// what is already in the key points. So a product code appearing in its OUTPUT that is in
// neither the key points nor the description it was given cannot have been observed; it came
// from the model's training data. On F109109 it replaced the cataloguer's CB252575 with
// CB104670 and justified it as "the tags in the photo clearly identify it as…" — photos it
// does not have. That is a provable invariant, not a judgement call, which is why it is
// enforced here in code rather than asked for in the prompt (which already forbids it).

/** Two to four letters then four or more digits, with an optional space and an optional
 *  letter suffix: CB252575, CB 252575, 670442A. Deliberately NOT bare numbers — a size, a
 *  year and an edition number all look like those, and a false positive here would block a
 *  legitimate edit. */
const CODE_RE = /\b([A-Za-z]{2,4})\s?(\d{4,9}[A-Za-z]?)\b/g

// ⚠ "LE 2500" is a limited edition size, not a product code, and it is in almost every bears
// key point. Read as a code it made a second entry look "lost", which turned an unambiguous
// one-for-one substitution into an ambiguous one and threw away a repairable edit.
const NOT_A_CODE_PREFIX = new Set(["LE", "NO", "LOT", "EST", "REF"])

export type FoundCode = { normalised: string; asWritten: string }

/** Every product code in a piece of text, keyed by a normalised form so "CB 252575" and
 *  "CB252575" are recognised as the same code. */
export function findProductCodes(text: string): FoundCode[] {
  const out: FoundCode[] = []
  const seen = new Set<string>()
  for (const m of (text ?? "").matchAll(CODE_RE)) {
    if (NOT_A_CODE_PREFIX.has(m[1].toUpperCase())) continue
    const normalised = `${m[1]}${m[2]}`.toUpperCase()
    if (seen.has(normalised)) continue
    seen.add(normalised)
    out.push({ normalised, asWritten: m[0] })
  }
  return out
}

export function codeSet(text: string): Set<string> {
  return new Set(findProductCodes(text).map(c => c.normalised))
}

export type CodeAudit = {
  /** In the revised text but in neither the key points nor the original description. */
  invented: FoundCode[]
  /**
   * ⚠ REMOVED, not merely absent: it was in the description this stage was given, and is
   * gone from what it returned. A key-point code the description never carried is simply a
   * missing fact — the stage's ordinary business — and counting those made a clean
   * one-for-one substitution look ambiguous.
   */
  lost: FoundCode[]
}

/**
 * Compare what the stage was given against what it produced.
 * `sources` is everything it was allowed to draw on (key points + the original description).
 */
export function auditCodes(keyPoints: string, original: string, revised: string): CodeAudit {
  const allowed   = new Set([...codeSet(keyPoints), ...codeSet(original)])
  const inRevised = codeSet(revised)
  const stated    = codeSet(keyPoints)
  return {
    invented: findProductCodes(revised).filter(c => !allowed.has(c.normalised)),
    // Was in the description AND stated by the cataloguer, and the stage took it out.
    lost:     findProductCodes(original).filter(c => stated.has(c.normalised) && !inRevised.has(c.normalised)),
  }
}
