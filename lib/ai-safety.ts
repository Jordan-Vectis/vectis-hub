// One place for how sensitive Gemini's safety filters are on our cataloguing calls.
//
// Why: we photograph published comics, toys and film collectables. Comic covers
// carry violence and scantily-clad characters as a matter of course, and the
// default thresholds can refuse a perfectly ordinary lot (Jordan, 2026-08-28:
// "some of the images in the comics are like girls half dressed"). The item is
// legally on sale in the saleroom; the description of it should not be refused.
//
// ⚠⚠ THIS DOES NOT AFFECT RECITATION. The four categories below are the only
// ones with a threshold. RECITATION — Gemini refusing because the answer would
// reproduce copyrighted material — is a separate finish reason with no setting
// to relax, and it is what every comics block measured on 2026-08-28 actually
// was. Do not reach for this file to "fix" a recitation block; it will do
// nothing. The fix for that is to stop asking for the text that trips it.
//
// ⚠ BLOCK_ONLY_HIGH, not BLOCK_NONE, on purpose: it clears the routine trips a
// comic cover causes while still refusing material Gemini is confident about.
// BLOCK_NONE is also not accepted for every category on every model/account, so
// it can fail the whole call rather than relax it. If a real lot still gets
// refused on one of these four, that is the conversation to have — with the
// category from the block message in hand (lib/ai-provider.ts safetyDetail()).

export const GEMINI_SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
] as any
