// The Admin Centre course — the deck and the practice scenarios.
//
// ⚠ KEEP IT SHORT. Jack, 2026-08-19: "its a super simple tool". It is one page with five
// buttons, and a deck longer than the thing it teaches is a deck nobody sits through. If you
// are tempted to add a slide, put it in a presenter note instead.
//
// ⚠ THE PANEL IS ONE PAGE WITH FIVE BUTTONS, NOT THREE TABS. Jordan rebuilt it on 2026-08-18:
// "combine all the options on this page to be a single page… as simple and idiot proof as
// possible." An earlier version of this deck taught three tabs and was wrong. Everything here
// was read off app/(app)/tools/lot-lookup/* and app/api/lot-lookup/* — people believe training
// material, which is what makes a wrong slide expensive.

import type { SeedSlide, SeedExercise } from "@/lib/training-seed"

// ─── The deck ────────────────────────────────────────────────────────────────
// Said out loud to a room, not read off a page. The detail — measured percentages, BC's field
// names, the holding-pen codes — lives in the presenter notes, where a trainer can reach for it
// if somebody asks.

export const ADMIN_CENTRE_SLIDES: SeedSlide[] = [
  {
    layout: "TITLE",
    title: "The Admin Centre",
    subtitle: "Everything about a lot, on one screen",
    notes: "Ask the room where they look today when they need to know something about a lot. Almost everyone says Business Central. That is the habit this breaks. 13 slides, about 10 minutes, then let them loose on the practice tasks — that is where the learning actually happens.",
  },
  {
    layout: "STATEMENT",
    title: "Business Central says Jack and Jordan catalogued everything",
    subtitle: "They didn't. They pushed it.",
    notes: "The slide the whole thing hangs off. Show of hands: who has looked up a lot in BC and taken the cataloguer at face value? Jack: \"because we import the lots in they all say they are catalogued by me and Jordan.\"",
  },
  {
    title: "Why",
    body: `- The team catalogues in the Hub all week.
- At the end it's pushed to Business Central in one go.
- BC stamps that push onto every lot in the batch.
- So it records who pressed the button, not who did the work.`,
    notes: "Be fair to BC — it is not broken. It is telling you what happened to the record. It was never told what happened to the item.",
  },
  {
    layout: "CARDS",
    title: "So don't take these three off BC",
    body: `- Catalogued by — you get whoever ran the push
- Catalogued date — the day it was pushed
- Category — comes over the same way, often wrong`,
    notes: "Be precise: it is these three, not BC generally. Most of its other fields are well filled and reliable — the lot number and the location especially.",
  },
  {
    title: "Each system knows half the answer",
    body: `The Hub knows
- Who really catalogued it, and when
- The real category

Business Central knows
- The lot number your customer quotes
- Where the item is right now

This tool puts both on one line.`,
    notes: "Not Hub good, BC bad. Each is right about different things. That join is the bit you cannot get anywhere else.",
  },
  {
    title: "One page, five buttons",
    subtitle: "1 · What have you got?",
    layout: "CARDS",
    body: `- 🧾 Receipt number — one delivery
- 📦 Tote number — one box
- 👤 Customer number — everything they've sent
- 🔨 Sale and lot number — pick a sale, then a lot
- 🏷️ Barcode — one lot`,
    tryHref: "/tools/lot-lookup",
    tryLabel: "Open the Admin Centre",
    notes: "Press the button matching the number in your hand, fill in the one box, and the answer appears underneath on the same page. It used to be three tabs and you had to know which one answered your question — Jordan rebuilt it in August, \"as simple and idiot proof as possible\".",
  },
  {
    title: "The numbers",
    graphic: "STEPS",
    body: `- Receipt — R000009
- Tote — T001868
- Customer — C224652
- Barcode — F109400
- Unique ID — R009478-28`,
    notes: "Leave these on the whiteboard for the practice session — almost every failed search is the right number in the wrong box. Barcode and unique ID share the same button. Two shortcuts worth mentioning: you can type part of a customer's NAME instead of their number, and you can type a sale code by hand if it is too new to be in the dropdown.",
  },
  {
    title: "What you'd use it for",
    layout: "CARDS",
    body: `- “When is my item going through?” — search the customer, read the sale date
- A condition report lands — search the sale and lot number, get the real cataloguer
- Chasing one lot — sale plus lot number takes you straight to it
- Checking a sale — every cataloguer, with a count each`,
    notes: "⚠ Two traps to say out loud. First, the big date under a cataloguer's name and the column headed \"When\" are the CATALOGUING date — the sale date is on the sale block with the calendar icon. Second, the Condition Reports screen has a \"Catalogued by\" of its own, but that one comes from BC, so it is the push stamp again. The real name is here.",
  },
  {
    title: "Names look different in each system",
    body: `Business Central shows a code — JC, JO, KS — or a login like JACK.COLLINGS.

The Hub shows the person. It translates BC's codes for you.

If you can still see a code, that person's missing from the list. Tell IT.`,
    notes: "The list comes from BC's own User Setup export and holds 64 people. The two names disagreeing is normal — the Hub tells you who catalogued it, BC tells you who pushed it. Quote the Hub.",
  },
  {
    layout: "STATEMENT",
    title: "A barcode belongs to a sale, not to an item",
    subtitle: "Put an item in a later sale and it gets a new one",
    body: "If a barcode finds nothing, try the unique ID — that one never changes.",
  },
  {
    layout: "STATEMENT",
    title: "Searching a tote gives you the whole delivery",
    subtitle: "Not just that box",
    body: "Nothing tags a lot to a tote, so you get everything on that tote's receipt. The screen says so every time.",
    notes: "Other things that look wrong but aren't: odd codes like A995 are BC waiting rooms, not sales; blank dates usually mean nobody set one, because BC's placeholder dates like 2099 are hidden rather than shown as nonsense. \"Needs looking at\" is the one that matters — that is BC's problem pile.",
  },
  {
    title: "It won't show you the description",
    body: `Only the short title.

If you need the finished description, use Description Finder instead.`,
    notes: "Worth saying, because the column is headed \"Item\" and a blank title reads as \"No description yet\", which looks like it is showing you a description. Description Finder searches the full text by barcode, title or wording.",
  },
  {
    layout: "TITLE",
    title: "Now you try",
    subtitle: "Real lots from our own system — and it marks itself",
    notes: "This is the part that matters. Every task picks a real lot each time it is opened, so they can come back as often as they like and never get the same question twice.",
  },
]

// ─── The practice ────────────────────────────────────────────────────────────
// ⚠ Every lookup task is mode PICK: the server chooses a lot, receipt or sale that exists RIGHT
// NOW and derives the answer from the same tables the panel reads. So the same task asks a
// different question every time it is opened, and can never ask about something since deleted.
//
// Kept deliberately short. Eight tasks covering the things people actually do, not one per
// feature — a long list is one nobody finishes.

export const ADMIN_CENTRE_EXERCISES: SeedExercise[] = [
  {
    title: "Everyone catalogued by Jordan?",
    kind: "CHOICE",
    brief: "You look up eight lots from the same sale in Business Central. All eight say catalogued by Jordan, within minutes of each other. What are you looking at?",
    params: {
      options: [
        "The bulk push — Jordan ran it, so his name is on every lot in the batch",
        "Jordan did catalogue all eight; he's quick",
        "Seven are duplicates and should be deleted",
        "The sale was imported from a spreadsheet",
      ],
      correct: 0,
    },
    explain: "This is the whole reason the Admin Centre exists. Cataloguing happens in the Hub all week and is pushed to BC in bulk at the end, so BC records the push — the name, the date, and often the category. The repetition is the tell. Always take the cataloguer from the Hub.",
  },
  {
    title: "Who catalogued it?",
    kind: "WHO_CATALOGUED",
    panel: "code",
    params: { mode: "PICK" },
    brief: "A lot's come back with a query on it. Look up {{q}} and tell me who entered it in the Hub.",
    hint: "Press 🏷️ Barcode, type the number, and read the big name at the top.",
    explain: "That is the person who actually typed the lot. Business Central would have told you whoever ran the import.",
  },
  {
    title: "When's it going through?",
    kind: "LOT_SALE_DATE",
    panel: "code",
    params: { mode: "PICK" },
    brief: "A customer's on the phone asking when their items are going through. Look up {{q}} and give them the date of the sale it's assigned to.",
    hint: "Find the sale on the lot card — it's shown as a code, a name and a date, like F090 — Diecast Sale · 15 Aug 2026. The day and month are enough.",
    explain: "⚠ Don't read the big date under the cataloguer's name — that's when it was catalogued, not when it sells. The date you want is the one against the sale. And if a sale has no date set yet, say that to the customer rather than guessing.",
  },
  {
    title: "The other number",
    kind: "LOT_UNIQUE_ID",
    panel: "code",
    params: { mode: "PICK" },
    brief: "You've got the barcode {{q}} off a label. What's this lot's unique ID?",
    hint: "Same screen, on the lot card next to the barcode. A unique ID looks like R009478-28.",
    explain: "The barcode belongs to the sale and changes if the item goes into a later one. The unique ID stays with the item for life — so it's the one to search with when a barcode finds nothing.",
  },
  {
    title: "Where is it?",
    kind: "LOT_LOCATION",
    panel: "code",
    params: { mode: "PICK" },
    brief: "Somebody needs to physically find this item. Look up {{q}} and tell me the location Business Central has for it.",
    hint: "It's on the “What Business Central says” panel further down.",
    explain: "The clearest example of why this reads both systems: only BC knows which shelf it's on.",
  },
  // ⚠ There is deliberately NO "how many lots on this receipt?" task. The receipt search shows
  // one row per physical item across BOTH systems — Hub lots plus items Business Central has
  // that nobody has catalogued here yet — so "how many" has two defensible answers depending on
  // which rows you count, and the screen does not label which is which. A task with two right
  // answers teaches people the tool is unreliable. Same reason as F111: never ask a question the
  // screen cannot answer unambiguously.
  {
    title: "Who did the sale?",
    kind: "SALE_TOP",
    panel: "sale",
    params: { mode: "PICK", min: 2 },
    brief: "Load sale {{q}} and tell me which cataloguer entered the most lots in it.",
    hint: "Press 🔨 Sale and lot number, pick the sale, leave the lot box empty. Everyone's listed with a count.",
    explain: "The lot numbers come from BC and the names come from the Hub — this is the only place the two are joined up.",
  },
  {
    title: "Nothing found",
    kind: "CHOICE",
    brief: "You scan a barcode and get nothing back at all. What's the first thing to try?",
    params: {
      options: [
        "Search the unique ID instead — the barcode changes when an item moves to a later sale",
        "Report it as missing",
        "Wait for the next sync and try again",
        "Search the same barcode as a receipt number",
      ],
      correct: 0,
    },
    explain: "An empty result nearly always means the wrong number, not a missing lot.",
  },
]
