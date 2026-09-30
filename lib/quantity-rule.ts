// The one quantity rule for every AI pass that WRITES description text — Batch, AI Upgrade and
// Double Check's corrected text. Appended to their prompts the way the batch route's English-only
// rule is, so no instruction (they are data, per sale) can talk a model into counting.
//
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
