// House rules for every AI pass that WRITES description text — Batch, AI Upgrade, Double
// Check's corrected text and the Key Points stage's insertions. Appended to their prompts the
// way the batch route's English-only rule is, so no instruction (they are data, per sale) can
// talk a model out of them. One string each, used everywhere — a rule cannot apply on one stage
// and not another.

// ⚠⚠ Jordan, 2026-09-30: "the ai miscounts so many things … no exact number at all unless
// key-pointed." Models miscount stacked, overlapping and part-hidden items, and a wrong count in
// a catalogue description is a misdescription a bidder can hold the house to, whereas "a group
// of" is never wrong. So a number of items may only ever come from the cataloguer. Double Check's
// quantity flag stays as it is: it checks the CATALOGUER's count against the photos for a person
// and never changes the number (lib/double-check-instruction.ts).
export const QUANTITY_RULE =
  "QUANTITIES COME FROM THE CATALOGUER, NEVER FROM COUNTING. State an exact number of items ONLY " +
  "where that number is given in the key points — or, when rewriting or checking an existing " +
  "description, where it is already in the text you were given. NEVER count items in the photographs " +
  "and NEVER write a number you worked out yourself: where no count is given, say \"a group of\", " +
  "\"a quantity of\", \"a collection of\" or \"several\". This applies to every kind of item — wagons, " +
  "figures, boxes, cards, records, coins. A named set or pack is a product name, not a count (\"Set 2055\", " +
  "\"twin pack\", \"Gift Set 3\" stay as written), and a list of catalogue numbers followed by \"plus others\" " +
  "or \"and more\" is fine. This rule overrides any instruction that asks for a count or a quantity format."

// ⚠ Jordan, 2026-09-30: a Steiff trio's key points said "Classic Fellow black and tan Terrier",
// "Original Hare", "Cat 1901 grey striped Replica"; the bullets kept the capitals but the summary
// sentence came out "a 1935 Classic Fellow terrier, an Original hare and a Cat 1901 replica" —
// the model took the last word of each name for an ordinary noun once it was writing prose.
export const NAME_CASE_RULE =
  "NAMES KEEP THE CATALOGUER'S CAPITALS. A maker, range, model or product name in the key points is a " +
  "proper name: write it with exactly the capital letters the cataloguer used, EVERYWHERE it appears — " +
  "in a summary or opening sentence as much as in a list. \"Classic Fellow Terrier\", \"Original Hare\" and " +
  "\"Cat 1901 Replica\" stay exactly so; never lower-case a word the cataloguer capitalised inside a name " +
  "because it is also an ordinary word (terrier, hare, replica, bear, cat, wagon). Equally, do not add " +
  "capitals to words the cataloguer left in lower case (mohair, grey striped), and never change the case " +
  "of a catalogue number or code. A capital letter in a name is not a spelling error to correct."

/** Both rules, ready to append to a system instruction. */
export const DESCRIPTION_RULES = `${QUANTITY_RULE}\n\n${NAME_CASE_RULE}`
