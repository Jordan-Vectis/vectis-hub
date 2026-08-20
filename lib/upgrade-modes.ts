// The AI Upgrade transformation modes — the ONE list, shown by the standalone
// AI Upgrade tab, the pipeline's inline "Enhance with AI Upgrade" step, and the
// overnight queue form. Keys must match MODE_INSTRUCTIONS in
// app/api/auction-ai/upgrade/route.ts, which holds the actual instruction text.
//
// ⚠ Client-imported: keep this plain data, nothing server-only.

export const UPGRADE_MODES: { key: string; label: string; desc: string }[] = [
  { key: "shorten",          label: "Shorten",                desc: "Remove padding, tighten verbose descriptions" },
  { key: "expand",           label: "Add more detail",        desc: "Expand sparse descriptions with useful context" },
  { key: "seo",              label: "Improve SEO",            desc: "Weave in buyer search terms naturally, without changing facts" },
  { key: "humanise",         label: "Humanise",               desc: "Remove AI-robotic phrasing, make it read naturally" },
  { key: "grammar",          label: "Fix grammar",            desc: "Spelling, punctuation and sentence structure" },
  { key: "format",           label: "Standardise format",     desc: "Consistent bullets, capitalisation and spacing" },
  { key: "condition",        label: "Expand condition notes", desc: "More specific about defects and completeness" },
  { key: "remove_condition", label: "Remove conditions",      desc: "Strip any condition/grading statement (condition is set separately by a human)" },
  { key: "no_hyperbole",     label: "Remove hyperbole",       desc: "Strip vague positives and sales-speak" },
  { key: "auction_language", label: "Auction language",       desc: "Reinforce lot/catalogue-appropriate terminology" },
  { key: "brand_first",      label: "Brand first",            desc: "Move the brand/maker name to the very start of the description" },
  { key: "brand_caps",       label: "Fix brand capitalisation", desc: "Marvel not marvel, DC not Dc — brand, character and title names only. Wording, codes and sizes untouched" },
  { key: "dolls_bears_fix",  label: "🧸 Dolls & Bears check",  desc: "Fix the recurring Dolls/Bears errors: no \"x three\", spell out \"limited edition\", drop \"plumo means…\" notes, don't repeat the name or guess the animal type, tidy phrasing (facts unchanged)" },
]

export const UPGRADE_MODE_LABEL: Record<string, string> = Object.fromEntries(
  UPGRADE_MODES.map(m => [m.key, m.label])
)
