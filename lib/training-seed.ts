// The starting content for IT & Admin → Training.
//
// ⚠ Only ever written into a COMPLETELY EMPTY table, exactly like the induction deck: once an
// environment has been seeded, editing this file changes nothing there. Fix a lesson in the app.
//
// Two halves:
//   • MODULE_SEEDS — one course per panel, derived from the Hub's own cards, so every panel in
//     the app has somewhere for its training to go the moment anyone wants to write it.
//   • ADMIN_CENTRE_SLIDES / ADMIN_CENTRE_EXERCISES — the first course, written in full.

import { APP_CARD_DEFS } from "@/lib/app-cards"

export type SeedSlide = {
  title: string
  subtitle?: string
  body?: string
  layout?: "TITLE" | "CONTENT" | "CARDS" | "STATEMENT"
  graphic?: "NONE" | "STEPS" | "EXTINGUISHERS"
  tryHref?: string
  tryLabel?: string
  notes?: string
}

export type SeedExercise = {
  title: string
  brief: string
  panel?: string
  kind: string
  params?: Record<string, unknown>
  expected?: string
  hint?: string
  explain?: string
}

export type SeedModule = {
  key: string
  title: string
  icon: string
  blurb: string
  href: string | null
  appKey: string | null
  accent: string
}

// ─── One course per panel ────────────────────────────────────────────────────
// Read off APP_CARD_DEFS rather than typed out again: a new tool added to the Hub gets a
// training slot automatically, and nothing here can name a panel that no longer exists.
// The card's own colour carries over so a course looks like the thing it teaches.

const ACCENTS: Record<string, string> = {
  "border-green-500": "green", "border-blue-500": "blue", "border-amber-500": "amber",
  "border-teal-500": "teal", "border-indigo-500": "indigo", "border-red-500": "red",
  "border-slate-500": "slate", "border-cyan-500": "cyan", "border-rose-500": "rose",
  "border-yellow-500": "yellow", "border-violet-500": "violet", "border-emerald-500": "emerald",
  "border-purple-500": "purple", "border-orange-500": "orange", "border-pink-500": "pink",
  "border-sky-500": "sky", "border-lime-500": "lime", "border-fuchsia-500": "fuchsia",
}

// The Admin Centre comes first — it is the one that is written, and a course list whose first
// entry is empty teaches people the whole tool is empty.
const FIRST = ["LOT_LOOKUP"]

export const MODULE_SEEDS: SeedModule[] = APP_CARD_DEFS
  .filter(c => !c.comingSoon && c.key !== "TRAINING")
  .map(c => ({
    key:    c.key,
    title:  c.defaultLabel,
    icon:   c.icon,
    // The card's own description is already a one-line explanation of the panel, agreed and in
    // use on the Hub. Repeating it here by hand would only let the two drift apart.
    blurb:  c.defaultDescription,
    href:   c.href,
    appKey: c.appKey ?? null,
    accent: ACCENTS[c.border] ?? "indigo",
  }))
  .sort((a, b) => {
    const ai = FIRST.indexOf(a.key), bi = FIRST.indexOf(b.key)
    if (ai !== bi) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
    return a.title.localeCompare(b.title)
  })

// ─── Admin Centre — the deck ─────────────────────────────────────────────────
// Everything asserted here was read off the code it describes (app/(app)/tools/lot-lookup and
// app/api/lot-lookup). ⚠ Do not add a "fact" to a lesson that the panel does not actually do —
// people believe training material, which is precisely what makes a wrong slide expensive.

export const ADMIN_CENTRE_SLIDES: SeedSlide[] = [
  {
    layout: "TITLE",
    title: "The Admin Centre",
    subtitle: "Finding any lot, in either system, in under a minute",
    notes: "Ask the room what they do now when a customer rings up asking where their items are. Most will say they ask a cataloguer. That is the habit this replaces.",
  },
  {
    layout: "STATEMENT",
    title: "The same item has two different numbers",
    subtitle: "That is the whole problem this tool solves",
    body: "A lot is catalogued in the Hub first and pushed to Business Central afterwards. One physical object ends up as F090447 in the Hub and R008414-7 in BC.",
    notes: "This is the sentence to make sure lands. Everything else follows from it.",
  },
  {
    title: "Why it exists",
    body: `Before this, answering "where are Mrs Palmer's items?" meant opening two systems and knowing which number to type into each.

- The Hub knows what was catalogued, by whom, and when
- Business Central knows the lot number and where it physically is
- Neither one, on its own, answers the question

The Admin Centre puts one row per physical item with both systems on it.`,
    notes: "Two separate panels were tried first and made the journey impossible to follow.",
  },
  {
    layout: "CARDS",
    title: "Three tabs, three questions",
    body: `Find a customer's lots — everything for one receipt, tote or customer
Who catalogued this lot? — scan one barcode, get one name
Who catalogued this sale? — a whole sale, listed by BC lot number`,
    tryHref: "/tools/lot-lookup",
    tryLabel: "Open the Admin Centre",
    notes: "Pick the tab by the question you were asked, not by the number you happen to be holding.",
  },
  {
    title: "Know your numbers",
    body: `Typing the right kind of number into the right box is most of the skill.

- Receipt — R000009 — everything booked in at once
- Tote — T001868 — one physical box
- Customer — C224652 — the vendor, everything they have ever sent
- Barcode — F066001 — one lot, in one sale
- Unique ID — R000016-413 — one lot, for its whole life

The first three go in tab 1. The last two go in tab 2.`,
    notes: "Worth writing the five formats on the whiteboard. Almost every failed search is the right number in the wrong box.",
  },
  {
    title: "Tab 1 — Find a customer's lots",
    graphic: "STEPS",
    body: `Choose receipt, tote or customer
Type or scan the number
Read the results, grouped by the sale they are in
Check the two right-hand columns — In Hub, In Business Central`,
    tryHref: "/tools/lot-lookup",
    tryLabel: "Try it now",
  },
  {
    title: "Reading the result",
    body: `Results are grouped by auction, because that is the question underneath the question — not "does this exist" but "when is it selling".

- The Hub's sale wins. If BC has the lot under a different sale, the row says so
- In Hub means it has been catalogued in the Hub
- In Business Central is matched on the BARCODE against the synced BC data

Why not the "added to BC" tick? Because it is a manual tick the cataloguers rarely make, so it read "no" for lots plainly sitting in BC.`,
    notes: "That last bullet is the one people query. It is a deliberate decision, not a bug.",
  },
  {
    title: "Tab 2 — Who catalogued this lot?",
    subtitle: "One question, one straight answer",
    body: `Scan or type a barcode and you get the person who entered the lot in the Hub, when they did it, and which sale it went into.

Underneath that: the cross-check against Business Central, and everyone who has touched the lot since.

A barcode can legitimately turn up in more than one sale, so this shows a LIST rather than assuming there is one answer.`,
    tryHref: "/tools/lot-lookup",
    tryLabel: "Try it now",
  },
  {
    layout: "STATEMENT",
    title: "Business Central's “catalogued by” is not the cataloguer",
    subtitle: "Trust the Hub's name, every time",
    body: "Lots are pushed to BC in bulk, so every lot in a sale carries whoever ran the import. The Hub records the person who actually typed the lot.",
    notes: "This is the single most common wrong answer people give. Spend a moment on it.",
  },
  {
    title: "Tab 3 — Who catalogued this sale?",
    body: `Pick a sale and you get every lot in it, in BC lot-number order, with the Hub's cataloguer against each one.

- The lot NUMBER only exists in Business Central
- The CATALOGUER only exists in the Hub
- The two are joined on the barcode and the unique ID

The sale list itself comes from BC, so every code offered is a code that actually has lots against it.`,
    tryHref: "/tools/lot-lookup",
    tryLabel: "Try it now",
  },
  {
    layout: "STATEMENT",
    title: "⚠ A barcode belongs to a sale, not to an item",
    subtitle: "Re-enter an item into a later sale and it gets a NEW barcode",
    body: "The unique ID (R000016-413) is the number that stays with the item for life. If a search by barcode comes back empty, try the unique ID before deciding the lot does not exist.",
  },
  {
    title: "When it finds nothing",
    graphic: "STEPS",
    body: `Check the number is in the right box — a tote number in the receipt field finds nothing
Try the unique ID instead of the barcode
Check it was catalogued in the Hub at all — a BC-only item shows on its own row
Ask when it was catalogued — a very recent lot may not have synced to BC yet`,
    notes: "Never let an empty result read as “it does not exist”. It usually means the wrong number.",
  },
  {
    title: "One thing it deliberately will not tell you",
    body: `There is no lot STATUS column anywhere in the Admin Centre, and that is on purpose.

It reads ENTERED on virtually every lot, so it tells an admin nothing while taking up space something useful could occupy. It was dropped from Manage Lots for the same reason.`,
    notes: "Asked about often enough to be worth heading off.",
  },
  {
    layout: "TITLE",
    title: "Now you try",
    subtitle: "The practice tasks use real lots from this system — and mark themselves",
  },
]

// ─── Admin Centre — the practice ─────────────────────────────────────────────
// ⚠ Every lookup task here is mode PICK. The server chooses a real lot or sale that exists
// RIGHT NOW and works the answer out from the same data the panel shows, so a task can never
// ask about a lot somebody has since deleted. See lib/training-check.ts.

export const ADMIN_CENTRE_EXERCISES: SeedExercise[] = [
  {
    title: "Which tab?",
    kind: "CHOICE",
    brief: "A customer rings up. She sent a load of items in on receipt R000009 and wants to know which sale they are in. Which tab do you open?",
    params: {
      options: [
        "Find a customer's lots",
        "Who catalogued this lot?",
        "Who catalogued this sale?",
      ],
      correct: 0,
    },
    explain: "A receipt number covers everything booked in at once, which is tab 1. Tab 2 wants one barcode; tab 3 wants a sale code.",
  },
  {
    title: "Who catalogued it?",
    kind: "WHO_CATALOGUED",
    panel: "who",
    params: { mode: "PICK" },
    brief: "Open “Who catalogued this lot?” and look up {{q}}. Who entered it in the Hub?",
    hint: "Type the number into tab 2 and read the big answer at the top. It is the Hub's name you want, not Business Central's.",
    explain: "The Hub records the person who actually typed the lot. Business Central shows whoever ran the bulk import, which is why the two often disagree.",
  },
  {
    title: "Which sale is it in?",
    kind: "LOT_SALE",
    panel: "who",
    params: { mode: "PICK" },
    brief: "Still on tab 2 — look up {{q}} and tell me the sale code it is in.",
    hint: "The sale is shown next to the cataloguer, as a code and a name — F090 — Diecast Sale. The code on its own is enough.",
    explain: "The Hub's sale is the one that counts: it is where the lot was catalogued. If BC has it somewhere else, the row says so.",
  },
  {
    title: "How many on the receipt?",
    kind: "LOT_COUNT",
    panel: "find",
    params: { mode: "PICK", type: "receipt", min: 2 },
    brief: "Switch to “Find a customer's lots”, search by receipt number for {{q}}, and tell me how many lots the Hub has against it.",
    hint: "Count the rows that say the lot is in the Hub. The results are grouped by sale, so check every group.",
    explain: "This is the everyday question — a customer asking how much of their consignment has been done.",
  },
  {
    title: "Whose items are they?",
    kind: "LOT_VENDOR",
    panel: "find",
    params: { mode: "PICK", type: "receipt" },
    brief: "Same tab. Look up receipt {{q}} and tell me the customer number the items belong to.",
    hint: "A customer number looks like C224652.",
    explain: "Going receipt → customer is how you get from “a box has turned up” to “whose box is it”, which is the first thing you need before you can ring anybody.",
  },
  {
    title: "Who did the most?",
    kind: "SALE_TOP",
    panel: "sale",
    params: { mode: "PICK", min: 2 },
    brief: "Open “Who catalogued this sale?”, load sale {{q}}, and tell me which cataloguer entered the most lots in it.",
    hint: "The tab lists the cataloguers with a count against each. You are after the biggest.",
    explain: "The lot numbers come from Business Central and the cataloguer names come from the Hub — this tab is the only place the two are joined up.",
  },
]
