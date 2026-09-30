// The rules every cataloguer-mistake flag prompt shares.
//
// ⚠ Flag guidance is currently spread across FOUR prompts — the Batch route, the Re-check
// Cataloguer Flags route, lib/key-points-instruction.ts and lib/double-check-instruction.ts.
// Anything added here goes into all four, so a rule cannot end up applying on one stage and
// not another. Add new shared flag rules HERE rather than editing one prompt.

// ⚠⚠ MEASUREMENTS. Jordan, 2026-08-17: bears lots were producing "loads of flags" because a
// recorded size differed from the manufacturer's published specification — which is exactly
// what you expect when the item is re-measured in hand and may have been cut down or modified.
// The arithmetic half of this is ALSO enforced in code (lib/measurement-check.ts) rather than
// trusted to the model; this text stops most of them being generated at all.
export const MEASUREMENT_FLAG_RULE = `NEVER FLAG A SIZE FOR DISAGREEING WITH THE MANUFACTURER. A measurement in the key points is the cataloguer's OWN measurement of THIS item, taken with it in hand. Items are re-measured precisely because one can have been cut down, re-stuffed, restored, trimmed or otherwise modified, so a size that differs from the manufacturer's published specification, the standard size for that model, a retail listing, or anything you recall is EXPECTED and is NOT a mistake. Do not flag it, do not mention the published size, and do not "correct" it.
The ONLY measurement worth flagging is one that contradicts ITSELF — where the two units given cannot both be true, e.g. "10 inches / 100cm" (10 inches is about 25cm). One inch is 2.54cm; allow generous rounding, and only flag a pair that is out by a fifth or more.`

// ⚠⚠ NAMES. Jordan, 2026-09-30: "loads of lots" had "Hornby Dublin" in the key points for
// Hornby Dublo, and nothing flagged it — the wizard's spell check passes any dictionary word,
// the batch prompt's flag rules talked only about NUMBERS, the re-check prompt said "do not flag
// wording preferences", and the Key Points stage faithfully restores the cataloguer's exact
// wording. So a real word swapped in for the right one (a tablet's autocorrect, most likely)
// sailed through every stage. The key points STAY authoritative — the flag is for a person.
export const NAME_FLAG_RULE = `WRONG NAMES ARE MISTAKES, NOT WORDING. A maker, range, series, character or model NAME in the key points that does not exist for that maker is a hard factual error, exactly like a wrong catalogue number — and it is the commonest kind, because a tablet's autocorrect swaps the right word for a real dictionary word: "Hornby Dublin" for "Hornby Dublo" (the Hornby OO range), "Corgi Toys" is real but "Corgi Tots" is not. Read every name AS a name: did that maker actually make a range or product called that? If you are highly confident it did not, and a range of that maker with a very similar spelling plainly was meant, FLAG it — give the name as written, the name you believe was meant, and why. Keep the cataloguer's spelling in the description regardless. Do NOT flag a name that is merely unfamiliar to you, a real but unusual variant, or a sub-range you cannot rule out — only a name you are confident does not exist for that maker.`

/** Appended to a prompt that already has its own flag section. */
export const FLAG_RULES_BLOCK = `\n${MEASUREMENT_FLAG_RULE}\n${NAME_FLAG_RULE}\n`
