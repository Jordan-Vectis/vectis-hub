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

/** Appended to a prompt that already has its own flag section. */
export const FLAG_RULES_BLOCK = `\n${MEASUREMENT_FLAG_RULE}\n`
