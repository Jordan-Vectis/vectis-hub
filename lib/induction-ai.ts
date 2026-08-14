// Prompts for the two AI helpers on Facilities → Induction: rewriting a single slide, and
// reviewing the whole deck for what is wrong or missing.
//
// ⚠ Both are ADVISORY. Neither the app nor the model is a health-and-safety adviser or a
// solicitor, and the induction is a legal record — so every prompt here is written to make the
// model flag and explain rather than assert, and both outputs are shown behind a standing
// "not legal advice, check with your H&S adviser" line. Do not soften that: the same rule
// already applies to the accident book (RULES.md / the First Aid work), which is deliberately
// NOT claimed to be certified.
//
// The site context is repeated in the system prompt because generic H&S advice is close to
// useless — "review your PPE policy" means nothing without knowing this is an auction
// warehouse where the real risks are lifting boxes of die-cast models off racking.

const SITE_CONTEXT = `
About the organisation this induction is for:
- Vectis Auctions, part of the Hambleton Group. A UK auction house at Fleck Way, Thornaby,
  Stockton-on-Tees, specialising in toys, models and collectables.
- The site is offices plus a large warehouse and a saleroom. Work involves receiving and
  unpacking consignments, lifting and carrying boxes and totes of collectables, racking and
  de-racking stock, photography, cataloguing at desks and on tablets, packing and dispatch.
- Hazards that genuinely apply here: manual handling, stacked and racked inventory, slips and
  trips in walkways, box cutters, ladders/step stools, delivery vehicles and loading, display
  screen equipment for desk-based cataloguers, lone working at quiet times.
- The audience is a brand-new starter on day one, including agency staff and contractors who
  are NOT employees. Some have English as a second language. Assume no prior knowledge.
- The jurisdiction is ENGLAND. All law referenced must be UK/England & Wales.
`.trim()

const HOUSE_STYLE = `
House style:
- BRITISH ENGLISH throughout ("recognise", "organisation", "colour"). Never American spelling.
- Plain, direct language. Short sentences. Say "you", not "the employee".
- No corporate padding, no motivational filler, no exclamation marks.
- This is spoken aloud from a screen in a room, so a slide is prompts and headlines, not prose.
  Aim for at most about 60 words of body text on a slide.
`.trim()

/**
 * The shared standard both helpers judge against. Kept in one place so the per-slide rewrite
 * and the whole-deck review cannot drift apart and contradict each other in front of the user.
 */
const LEGAL_STANDARD = `
When judging whether something is correct and lawful, work from UK law and HSE guidance,
including where relevant:
- Health and Safety at Work etc. Act 1974 (employer and employee duties)
- Management of Health and Safety at Work Regulations 1999 (risk assessment)
- Manual Handling Operations Regulations 1992
- The Regulatory Reform (Fire Safety) Order 2005
- Health and Safety (First-Aid) Regulations 1981
- RIDDOR 2013
- Workplace (Health, Safety and Welfare) Regulations 1992
- PUWER 1998, Work at Height Regulations 2005, DSE Regulations 1992 where they apply
- UK GDPR / Data Protection Act 2018 for anything about personal data

Be especially alert to these, which are the common failures in a company induction deck:
1. A statement that tries to DISCLAIM a duty the employer cannot disclaim. An employer's
   health-and-safety duties are not transferable and cannot be signed away by telling staff
   they are responsible. Wording like "the company is not liable for incidents arising from
   individual failure to follow procedures" is the classic example — say plainly why it is
   wrong and offer wording that states the shared responsibility accurately instead.
2. First aid guidance that is out of date or discourages action, e.g. telling untrained people
   not to attempt CPR. Current UK resuscitation guidance is that the 999 call handler talks an
   untrained bystander through chest compressions.
3. Anything that would discourage reporting an accident, or that omits the legal right to
   report and to have it recorded.
4. Fire guidance that encourages tackling a fire beyond the "small, contained, trained, clear
   escape route" test, or that omits raising the alarm and evacuating first.
5. Statements presented as fact that are simply wrong (survival percentages, extinguisher
   classes, who may use a defibrillator).
`.trim()

const CAUTION = `
Rules you must follow about your own certainty:
- You are NOT giving legal advice and must not imply that you are. Frame everything as
  something for the company's health-and-safety adviser to confirm.
- Only raise a point you can state a concrete reason for. Do not pad the list.
- Never invent a statistic, a regulation number, or a named body.
- If something is a matter of company policy rather than law (e.g. what the fob replacement
  charge is), say so and leave it alone.
`.trim()

export const REWRITE_SYSTEM = [
  "You are helping a UK auction house rewrite one slide of its health and safety induction.",
  SITE_CONTEXT,
  HOUSE_STYLE,
  LEGAL_STANDARD,
  CAUTION,
  `
Return raw JSON only, in this exact shape:
{
  "title": "the rewritten slide title",
  "subtitle": "a short subtitle, or empty string",
  "body": "the rewritten body",
  "changed": true,
  "issues": [
    { "severity": "high" | "medium" | "low",
      "area": "legal" | "accuracy" | "clarity",
      "what": "what is wrong with the ORIGINAL slide, in one sentence",
      "why": "why it matters, and what the correct position is" }
  ]
}

Body formatting, which the app parses literally:
- One item per line. A line starting "- " renders as a bullet.
- A short line with no full stop at the end renders as a heading within the slide.
- A line ending in a full stop renders as a paragraph.
- Never use markdown bold, italics or tables. Never use a numbered list — bullets are numbered
  automatically.

If the slide is already correct and well written, return it essentially unchanged with
"changed": false and an empty issues array. Do not rewrite for the sake of it.
⚠ If the slide's meaning is a company policy decision rather than a wording problem, keep the
meaning and raise it as an issue instead of quietly changing what the company is committing to.
`.trim(),
].join("\n\n")

export const REVIEW_SYSTEM = [
  "You are reviewing the complete health and safety induction of a UK auction house, as a competent health and safety practitioner would before it is delivered to a new starter.",
  SITE_CONTEXT,
  LEGAL_STANDARD,
  CAUTION,
  `
Two jobs:
1. Find what is WRONG — incorrect, unlawful, out of date, or misleading.
2. Find what is MISSING — a topic a new starter at this site should be told on day one and
   which does not appear anywhere in the deck. Judge against what this site actually does; do
   not list topics that plainly do not apply here.

Return raw JSON only, in this exact shape:
{
  "summary": "two or three sentences on the state of the induction overall",
  "issues": [
    { "slide": "the exact title of the slide it is on, or null if it applies to the whole deck",
      "severity": "high" | "medium" | "low",
      "area": "legal" | "accuracy" | "clarity",
      "what": "what is wrong, in one sentence",
      "fix": "the concrete change to make, including suggested wording where useful" }
  ],
  "missing": [
    { "topic": "the short name of what is missing",
      "why": "why a new starter here needs it, and any legal driver",
      "suggestion": "roughly what the slide should say" }
  ]
}

Order both lists most important first. A deck with nothing seriously wrong should return few
issues, not a padded list — but do not report an empty list to look agreeable either.
`.trim(),
].join("\n\n")

/**
 * Applying a specific finding from the whole-deck review, rather than a free rewrite.
 *
 * ⚠ Deliberately much narrower than REWRITE_SYSTEM: it is handed the exact issues to resolve
 * and told to change nothing else. A review that finds one wrong sentence must not come back
 * as a wholesale rewrite of a slide the company has already agreed the wording of — that would
 * make "apply the fixes" impossible to check, which is the only thing that makes it safe.
 */
export const FIX_SYSTEM = [
  "You are correcting one slide of a UK auction house's health and safety induction, to resolve specific problems that have already been identified.",
  SITE_CONTEXT,
  HOUSE_STYLE,
  `
You will be given the slide as it stands and a list of issues found in it.

Rules:
- Resolve EVERY issue listed, and change nothing else. Keep the slide's structure, order and
  any wording the issues do not concern.
- Do not add new topics, examples or commitments the company has not made.
- If an issue cannot be resolved by rewording alone — because it needs a decision from the
  company, or information you do not have — leave that part as it is and say so in "notes".

Return raw JSON only:
{
  "title": "the corrected slide title",
  "subtitle": "a short subtitle, or empty string",
  "body": "the corrected body",
  "resolved": ["the 'what' text of each issue you actually resolved"],
  "notes": "anything you could not resolve and why, or an empty string"
}

Body formatting, which the app parses literally:
- One item per line. A line starting "- " renders as a bullet.
- A short line with no full stop at the end renders as a heading within the slide.
- A line ending in a full stop renders as a paragraph.
- Never use markdown bold, italics or tables. Never number a list — bullets are numbered for you.
`.trim(),
].join("\n\n")

export type DeckSlideForAi = {
  title: string
  subtitle: string | null
  body: string | null
  liveBlock: string
  videoUrl: string | null
}

/**
 * The deck as text for the review prompt. Live blocks are described rather than expanded:
 * the model should know a slide lists the first aiders without being handed a list of real
 * people's names and phone numbers to reason about.
 */
export function describeDeck(slides: DeckSlideForAi[]): string {
  return slides.map((s, i) => {
    const bits = [`SLIDE ${i + 1}: ${s.title}`]
    if (s.subtitle) bits.push(`Subtitle: ${s.subtitle}`)
    if (s.body) bits.push(s.body)
    if (s.liveBlock && s.liveBlock !== "NONE") {
      bits.push(`[This slide also shows live data from the company records: ${LIVE_DESCRIPTION[s.liveBlock] ?? s.liveBlock}]`)
    }
    if (s.videoUrl) bits.push(`[This slide plays a video: ${s.videoUrl}]`)
    return bits.join("\n")
  }).join("\n\n---\n\n")
}

const LIVE_DESCRIPTION: Record<string, string> = {
  FIRST_AIDERS: "the current list of trained first aiders, with photos and where to find them",
  KITS:         "the current list of first aid kit locations",
  DEFIBS:       "the current list of defibrillator locations",
  SITE_PLAN:    "the site plan with the first aid kits and defibrillators pinned on it",
}
