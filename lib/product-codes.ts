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
 * The DIGITS of every code-like number in a piece of text — used only to decide whether a
 * code is ALREADY KNOWN, never to decide that something IS a code.
 *
 * ⚠⚠ WHY THE ASYMMETRY. CODE_RE only sees a code when 2–4 letters butt against the
 * digits, so it reads "Set 65705" but is blind to "Skidoo 65705", "Outfit 65705",
 * "Set No. 65705", "Set #65705" and "Daisy, 65705". A cataloguer writes it any of those
 * ways. The stage then rewrites it tidily as "Set 65705" — which IS recognised — and the
 * guard concluded the AI had INVENTED a code that is plainly sitting in the key points,
 * threw away a good rewrite, and told the cataloguer to go and check it against the item
 * (measured 2026-08-19 on F109409, "wearing Skidoo Set 65705").
 *
 * So: STRICT about accusing (a bare number is still never treated as a code, because a
 * size, year or edition looks like one), GENEROUS about exonerating (if those digits
 * appear anywhere in what the stage was given, it did not invent them). Getting this wrong
 * in the accusing direction discards real work; getting it wrong in the exonerating
 * direction merely lets an edit through, which the human is reviewing anyway.
 */
function digitRuns(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of (text ?? "").matchAll(/\d{4,9}/g)) out.add(m[0])
  return out
}
/**
 * Compare what the stage was given against what it produced.
 * `sources` is everything it was allowed to draw on (key points + the original description).
 */
export function auditCodes(keyPoints: string, original: string, revised: string): CodeAudit {
  const allowed   = new Set([...codeSet(keyPoints), ...codeSet(original)])
  // Every code-like number the stage was allowed to see, however it was written.
  const seenDigits = new Set([...digitRuns(keyPoints), ...digitRuns(original)])
  const inRevised = codeSet(revised)
  const stated    = codeSet(keyPoints)
  return {
    // ⚠ Not invented if those digits were already in front of it — see digitRuns above.
    invented: findProductCodes(revised).filter(c => {
      if (allowed.has(c.normalised)) return false
      for (const d of digitRuns(c.asWritten)) if (seenDigits.has(d)) return false
      return true
    }),
    // Was in the description AND stated by the cataloguer, and the stage took it out.
    lost:     findProductCodes(original).filter(c => stated.has(c.normalised) && !inRevised.has(c.normalised)),
  }
}
