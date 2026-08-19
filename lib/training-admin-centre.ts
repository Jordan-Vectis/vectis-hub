// The Admin Centre course — the deck and the practice scenarios.
//
// ⚠ EVERYTHING ASSERTED HERE WAS READ OFF THE CODE IT DESCRIBES: app/(app)/tools/lot-lookup/*
// and app/api/lot-lookup/*. People believe training material, which is exactly what makes a
// wrong slide expensive — a lesson that describes a column the panel no longer has teaches
// somebody to distrust their own eyes. If the panel changes, change the slide.
//
// The numbers quoted on the holding-pen and barcode-prefix slides are the measurements recorded
// in the route's own comments (production, 2026-08-18). They are there because "trust the
// barcode over BC's field" sounds like a workaround until you know it is right 94.6% of the
// time and the exceptions are all waiting rooms.

import type { SeedSlide, SeedExercise } from "@/lib/training-seed"

// ─── The deck ────────────────────────────────────────────────────────────────
// Structured in six parts. A deck that is 25 slides of the same layout reads as a document,
// so the section markers are TITLE slides and the points that must land are STATEMENTs.

export const ADMIN_CENTRE_SLIDES: SeedSlide[] = [
  // ── Part 1 · Why this exists ──
  {
    layout: "TITLE",
    title: "The Admin Centre",
    subtitle: "Because the lot information in Business Central is not what you think it is",
    notes: "Open by asking the room where they look today when they need to know something about a lot. Almost everyone says Business Central. That is the habit this course is here to break. Around 38 slides — budget 25 minutes, then move to the practice tasks.",
  },
  {
    layout: "STATEMENT",
    title: "Business Central says Jack and Jordan catalogued everything",
    subtitle: "They did not. They pushed it.",
    body: "Lots are entered in the Hub all week by the whole team, then pushed across to Business Central in bulk at the end. BC stamps that push onto every lot in the batch — so it records whoever pressed the button, not whoever did the work.",
    notes: "This is the slide the whole course hangs off. Ask who in the room has ever looked up a lot in BC and taken the cataloguer at face value. Nearly everyone will have.",
  },
  {
    title: "What else the push gets wrong",
    body: `The cataloguer is the obvious one, but it is not the only field that arrives as a side effect of the push rather than as a fact about the lot.

- Catalogued by — whoever ran the push, on every lot in the batch
- Catalogued date — when it was pushed, not when it was catalogued
- Categories — routinely wrong for the same reason

None of this is Business Central misbehaving. It is simply what a bulk push looks like from the inside. BC is recording exactly what happened to it.`,
    notes: "Worth being fair to BC here — it is not broken, it is answering a different question. It knows what happened to the record, not what happened to the item.",
  },
  {
    layout: "STATEMENT",
    title: "The Hub knows who actually did it",
    subtitle: "Because it was there at the time",
    body: "The Hub records the person who was logged in when the lot was created, the moment they created it, and the category they chose. That is the truth of it — and it is why the Hub always wins.",
  },
  {
    title: "But Business Central is not useless",
    body: `Two things genuinely only exist there, and both matter to somebody on the phone.

Business Central alone knows
- The lot number the customer will quote at you
- Where the item physically is

The Hub alone knows
- Who really catalogued it, when, and into which sale
- The real category
- Every change anyone has made since

So the answer is never in one system. It never was.`,
    notes: "The point to make: this is not Hub good, BC bad. Each is authoritative about different things, and the skill is knowing which.",
  },
  {
    layout: "STATEMENT",
    title: "The bridge is where the new information comes from",
    subtitle: "Not a third system — a join",
    body: "Which of our cataloguers entered lot 247 in F088? Business Central has the lot number and a cataloguer that just says Jordan. The Hub has the real cataloguer and no lot number. Joined on the barcode, it is one line on one screen — and that line existed in neither system before.",
    notes: "This is the slide that explains why the tool exists at all. It is not a nicer window onto BC — the join itself creates information that was in neither system. Everything from here is how to use it.",
  },
  {
    layout: "CARDS",
    title: "Three tabs, three questions",
    body: `Find a customer's lots — everything for one receipt, tote or customer
Who catalogued this lot? — one barcode in, one name out
Who catalogued this sale? — a whole sale, in lot-number order`,
    tryHref: "/tools/lot-lookup",
    tryLabel: "Open the Admin Centre",
    notes: "Pick the tab by the QUESTION you were asked, not by the number you happen to be holding. That is the single most common mistake.",
  },

  // ── Part 2 · The numbers ──
  {
    layout: "TITLE",
    title: "First, the numbers",
    subtitle: "Almost every failed search is the right number in the wrong box",
  },
  {
    title: "Know your five numbers",
    body: `Receipt — R000009 — everything booked in at once
Tote — T001868 — one physical box
Customer — C224652 — the vendor; everything they have ever sent
Barcode — F066001 — one lot, in one sale
Unique ID — R000016-413 — one lot, for its whole life

The first three go in tab 1. The last two go in tab 2.`,
    graphic: "STEPS",
    notes: "Write the five formats on the whiteboard and leave them up for the practice session.",
  },
  {
    layout: "STATEMENT",
    title: "A barcode belongs to a SALE. A unique ID belongs to the ITEM.",
    subtitle: "Re-enter an item into a later sale and it gets a brand new barcode",
    body: "So if a search by barcode comes back empty, try the unique ID before deciding the lot does not exist. The unique ID is the number that never changes.",
    notes: "This is the one that catches people out weeks later. Say it twice.",
  },

  // ── Part 3 · Tab 1 ──
  {
    layout: "TITLE",
    title: "Tab 1 — Find a customer's lots",
    subtitle: "The one you will use most",
  },
  {
    title: "Running the search",
    graphic: "STEPS",
    body: `Choose what you are searching by — receipt, tote or customer
Type or scan the number and press Search
Read the totes panel — what they physically sent in
Then read the sale blocks underneath — what it has become`,
    tryHref: "/tools/lot-lookup",
    tryLabel: "Try it now",
    notes: "On customer search, you can also type part of a customer's NAME and it will look them up in Business Central. Useful when someone rings up and has no idea what their number is.",
  },
  {
    title: "The totes panel",
    subtitle: "What the customer actually sent in, before any of it became lots",
    body: `Straight from Business Central's own tote screen, and shown first for that reason.

- Tote, when it was created, its category and sub-category
- Catalogued, or Not yet — per tote
- The header counts them: how many totes, how many done, how many still to do

A busy customer can have hundreds of totes — 341 on one measured account — so the table scrolls inside itself rather than pushing the sales off the screen.`,
    notes: "For a customer asking how far along their consignment is, this panel alone often answers it.",
  },
  {
    title: "The sale blocks",
    body: `Underneath the totes, the lots are grouped by the sale they are in.

- Blocks start COLLAPSED. The question is usually which sales their things are in, before it is ever show me every lot
- A search that finds exactly one sale opens itself
- Open them all is there when you do want everything
- The line above says how many sales, how many items, and that it is as of the last warehouse sync`,
    notes: "A customer's lots can span a dozen sales and hundreds of rows. Collapsed by default was a deliberate decision, not an oversight.",
  },
  {
    title: "Reading a lot row",
    body: `Five columns, and each answers a question somebody actually asks.

- Lot — the number the customer will quote at you, or Not numbered yet
- Item — the barcode or unique ID, and what the thing is
- Tote — which box it came out of
- Catalogued by — the person
- Where it is up to — Catalogued, Waiting to be catalogued, or Needs looking at, plus where it physically is`,
    notes: "Nothing on the row says which SYSTEM it came from. That is deliberate — an admin with a customer on the phone needs the answer, not our plumbing.",
  },
  {
    layout: "STATEMENT",
    title: "⚠ “Needs looking at” means the lot is in BC's problem pile",
    subtitle: "A999 — Lost / Missing / Re-Receipted, and lots with BC issues",
    body: "It is not a warning about the search. It is the tool telling you this item genuinely needs somebody to sort it out.",
    notes: "If a customer's row shows this, it is worth flagging rather than reading out the location and moving on.",
  },
  {
    title: "Why a sale code can look wrong",
    body: `Business Central's auction code is not always an auction. The A9-hundreds are holding pens.

- A995 — Temp F109 Bears
- A992 — Temp F110 Dolls and bears day 2
- A996 — Temp F119 Trains
- A998 — Unsold Mover
- A999 — the problem pile

Left alone, those put a sale on screen called A995 dated 1 January 2099, which means nothing to anybody.`,
    notes: "This is why the tool does not simply print what BC says.",
  },
  {
    title: "So the barcode decides",
    subtitle: "F109034 is an F109 lot, whatever BC has filed it under",
    body: `The first four characters of a barcode name the sale, and that beats BC's own field whenever the field is a holding pen.

Measured across the 211,229 BC rows that carry a real auction code, the barcode agrees 199,901 times — 94.6%. And every one of the 692 items parked in A995 carries an F109 barcode, which is the sale they were really for.

The order the tool uses
- Our sale, if the Hub has the lot
- Otherwise the sale the barcode names, if we hold that sale
- Otherwise BC's code, but only when it is a real sale rather than a waiting room`,
    notes: "Nobody needs to memorise this. They need to know that a sale shown here is trustworthy even when BC's own screen disagrees.",
  },
  {
    title: "Two messages worth understanding",
    body: `Records left out
Business Central files some barcodes under more than one receipt, so a BC row whose barcode belongs to a lot on a DIFFERENT receipt is dropped. On one measured tote, 93 of 142 rows belonged to another customer entirely. The count is always reported, never silently swallowed.

Showing the first 500
The search caps at 500 rows each side. Narrow it — a receipt rather than the whole customer.`,
    notes: "Design rule 7 in the house rules: never let nothing happened look like success. Both of these exist so a partial answer never reads as a complete one.",
  },
  {
    layout: "STATEMENT",
    title: "⚠ Searching by tote gives you the whole RECEIPT",
    subtitle: "Lots are not individually tagged with a tote in either system",
    body: "So a tote search bridges tote → receipt → lots, and may include other totes booked in at the same time. The panel says so on screen every time.",
  },

  // ── Part 4 · Tab 2 ──
  {
    layout: "TITLE",
    title: "Tab 2 — Who catalogued this lot?",
    subtitle: "One question, one straight answer",
  },
  {
    title: "The big answer",
    body: `Scan or type a barcode — F066001 — and the name fills the top of the screen, with the day and the time underneath.

Below it, the lot itself: the sale, the barcode, the unique ID, the receipt, the tote it was made from, and the customer. Then the photo count, whether it reached Business Central, and its category.`,
    tryHref: "/tools/lot-lookup",
    tryLabel: "Try it now",
    notes: "Deliberately enormous type. This tab answers one question and the answer should be readable across a desk.",
  },
  {
    layout: "STATEMENT",
    title: "Business Central's “catalogued by” is the push stamp",
    subtitle: "If it says Jack or Jordan, that is the button, not the work",
    body: "Every lot in a pushed batch carries whoever ran it. Look up ten lots from one sale in BC and you will get the same name ten times — which should tell you it is not answering the question you asked.",
    notes: "Callback to the second slide. The tell is the repetition: a real cataloguer list for a sale has several names on it with different counts.",
  },

  // ── Names — the bit that confuses everybody ──
  {
    layout: "TITLE",
    title: "A word about names",
    subtitle: "The same person looks completely different in each system",
    notes: "This section exists because people open BC, see JC or JACK.COLLINGS, and think they are looking at something other than a person.",
  },
  {
    title: "How the Hub stores a name",
    subtitle: "It just stores the person",
    body: `When somebody catalogues a lot in the Hub, it records whoever was logged in — as their actual name.

- Jack Collings
- Jordan Orange
- Keiran Southgate

That is what you see on the lot card, in the sale list, and in the change history. No translation, no codes.`,
    notes: "Worth saying plainly: if a lot was made in the Hub, the name on screen is simply the person who made it.",
  },
  {
    title: "How Business Central stores a name",
    subtitle: "Three different fields, and rarely the obvious one",
    body: `Business Central does not store a name at all. It stores one of three things.

- Catalogued by — a short code. JC, JO, KS. And it is BLANK on tens of thousands of lines
- Catalogued by user — a Windows username, in capitals. JACK.COLLINGS
- Created by — also a Windows username, and the one that is almost always filled in

Measured on 200 catalogued lines whose code was blank: the username was filled on 98 of them, and created-by on all 200.`,
    notes: "So on a BC screen the honest answer to who did this is frequently a two-letter code, or a shouty username, or nothing at all.",
  },
  {
    title: "So the Hub translates them for you",
    graphic: "STEPS",
    body: `Try the short code against BC's own User Setup list — JC is Jack Collings, JO is Jordan Orange, KS is Keiran Southgate
If there is no code, match the username to the same person by their email — JACK.COLLINGS is jack.collings@vectis.co.uk, so it is Jack Collings
If they are not on the list at all, tidy the username up — JAKE.KENYON becomes Jake Kenyon
And if the lot exists in the Hub, none of that happens — the Hub's own name wins outright`,
    notes: "The point to land: you should almost never have to read a code. If you are looking at one, it is because that person is not on the list.",
  },
  {
    layout: "STATEMENT",
    title: "A code you can still see means somebody is missing from the list",
    subtitle: "Tell IT — it is a two-minute fix",
    body: "The list of codes comes from Business Central's User Setup. A new starter who has not been added shows up as a tidied username, or as bare initials. That is worth reporting, not working around.",
  },
  {
    title: "Putting it together",
    body: `The same lot, seen two ways.

Made in the Hub
Catalogued by reads Jack Collings, because Jack typed it. Business Central may well show JO against the very same lot — that is Jordan, who ran the import.

Only in Business Central
There is no Hub name to use, so the tool resolves whatever BC recorded: the code first, then the username, then a tidy-up. You get a person's name either way.

Which is why the two can disagree and neither is broken. The Hub answers who catalogued it. BC answers who pushed it across.`,
    notes: "If people take one thing from this section, it is that a disagreement between the two names is normal and expected.",
  },
  {
    title: "When it says “No name recorded”",
    body: `That is not a fault. It happens with older lots, and with lots created by an import rather than by a person.

What to do
- Look at Everyone who has worked on this lot — the first person listed usually is the answer
- Open the full change history for who touched what, and when
- Check what Business Central says, as a cross-reference`,
    notes: "Teach the fallback, or people will read No name recorded as the tool being broken.",
  },
  {
    title: "The cross-check, and the audit trail",
    body: `What Business Central says
From the last warehouse sync. It can disagree with the Hub, and that on its own is not a problem — it usually just means the sync has not caught up.

Everyone who has worked on this lot
Every person who has touched it, with how many changes each has made.

Full change history
Field by field: who changed what, from what, to what, and when.

And because a barcode can legitimately appear in more than one sale, this tab returns a LIST rather than pretending there is one answer.`,
  },

  // ── Part 5 · Tab 3 ──
  {
    layout: "TITLE",
    title: "Tab 3 — Who catalogued this sale?",
    subtitle: "The only place the lot number and the cataloguer appear together",
  },
  {
    title: "Why this tab has to exist",
    body: `The lot NUMBER only lives in Business Central. The CATALOGUER only lives in the Hub. This tab reads each from the system that actually knows it and joins them on the barcode and unique ID.

- Pick the sale from the dropdown — straight from BC, newest first, with its lot count
- Or type a code, for a sale so new the list has not caught up
- Then search a lot number: typing 247 lands on lot 247, not on 1247 and 2470 as well
- One exact match gives you the big answer instead of a one-row table`,
    tryHref: "/tools/lot-lookup",
    tryLabel: "Try it now",
  },
  {
    title: "Reading the sale",
    body: `Who catalogued this sale lists everyone with a count against each name. Click a name and the table filters to just their lots.

The table itself is lot number, item, catalogued by, when, and location.

It also tells you what is missing — lots Business Central has that the Hub does not, and lots with no number yet.`,
    notes: "Useful for a spot check before a sale goes live: the names with counts show at a glance whether one person did all of it.",
  },

  // ── Part 6 · Traps and habits ──
  {
    layout: "TITLE",
    title: "Before you start",
    subtitle: "The four things worth remembering",
  },
  {
    title: "When it finds nothing",
    graphic: "STEPS",
    body: `Check the number is in the right box — a tote number in the receipt field finds nothing
Try the unique ID instead of the barcode, because the barcode changes between sales
Check it was catalogued in the Hub at all — a BC-only item appears on its own row
Ask when it was catalogued — a very recent lot may not have synced yet`,
    notes: "Never let an empty result read as it does not exist. It nearly always means the wrong number was typed.",
  },
  {
    title: "One thing it will not tell you",
    body: `There is no lot STATUS column anywhere in the Admin Centre, on purpose.

It reads ENTERED on virtually every lot, so it tells an admin nothing while occupying space something useful could use. It was dropped from Manage Lots for exactly the same reason.

Where it is up to on tab 1 is the useful version of that question — and it comes from real signals, not the status field.`,
    notes: "Asked about often enough to be worth heading off.",
  },
  {
    layout: "TITLE",
    title: "Now you try",
    subtitle: "The practice tasks are set on real lots from this system, and mark themselves",
    notes: "Send them to the Practice tab. Tasks are randomised, so people can come back to it as many times as they like and never get the same set twice.",
  },
]

// ─── The practice scenarios ──────────────────────────────────────────────────
// ⚠ Every lookup task is mode PICK. The server chooses a lot, receipt, customer or sale that
// exists RIGHT NOW and derives the answer from the same tables the panel reads, so the same
// task gives a different question every time it is opened and can never ask about something
// that has since been deleted. That is what makes this worth coming back to.
//
// Ordered roughly by difficulty, and mixed: a judgement question between the lookups keeps it
// from becoming a typing exercise.

export const ADMIN_CENTRE_EXERCISES: SeedExercise[] = [
  {
    title: "Which tab?",
    kind: "CHOICE",
    brief: "A customer rings up. She sent a load of things in on receipt R000009 and wants to know which sale they are in. Which tab do you open?",
    params: {
      options: [
        "Find a customer's lots",
        "Who catalogued this lot?",
        "Who catalogued this sale?",
      ],
      correct: 0,
    },
    explain: "A receipt covers everything booked in at once, which is tab 1. Tab 2 wants a single barcode; tab 3 wants a sale code.",
  },
  {
    title: "Who catalogued it?",
    kind: "WHO_CATALOGUED",
    panel: "who",
    params: { mode: "PICK" },
    brief: "A lot has come back with a query on the description. Open “Who catalogued this lot?”, look up {{q}}, and tell me who entered it in the Hub.",
    hint: "Type the number into tab 2 and read the big name at the top. It is the Hub's name you want, not Business Central's.",
    explain: "The Hub records the person who actually typed the lot. Business Central shows whoever ran the bulk import, which is why the two so often disagree.",
  },
  {
    title: "The two identifiers",
    kind: "LOT_UNIQUE_ID",
    panel: "who",
    params: { mode: "PICK" },
    brief: "You have the barcode {{q}} off a physical label. Look it up and tell me the lot's unique ID.",
    hint: "It is on the lot card, next to the barcode. A unique ID looks like R000016-413.",
    explain: "The barcode belongs to the sale and changes if the item is re-entered later. The unique ID stays with the item for life — which is why it is the one to search with when a barcode finds nothing.",
  },
  {
    title: "Everyone catalogued by Jordan?",
    kind: "CHOICE",
    brief: "You look up eight lots from the same sale in Business Central. All eight say they were catalogued by Jordan, on the same day, within a few minutes of each other. What are you actually looking at?",
    params: {
      options: [
        "The bulk push — Jordan ran it, so his name and that timestamp are on every lot in the batch",
        "Jordan did catalogue all eight; he is simply very quick",
        "Seven of the records are duplicates and should be deleted",
        "The sale was imported from a spreadsheet rather than catalogued at all",
      ],
      correct: 0,
    },
    explain: "This is the single reason the Admin Centre exists. Lots are entered in the Hub all week by the whole team and pushed to BC in bulk at the end, so BC records the push, not the work — the name, the timestamp, and often the category too. The repetition is the tell: a real cataloguer list has several names with different counts. Always take the cataloguer from the Hub.",
  },
  {
    title: "Reading a BC code",
    kind: "CHOICE",
    brief: "You are looking at a Business Central row and the catalogued-by field just says “JC”. What are you looking at?",
    params: {
      options: [
        "A person — the short code Business Central uses for a member of staff",
        "A job code for the type of cataloguing that was done",
        "The category the lot was filed under",
        "An error — the field should hold a full name",
      ],
      correct: 0,
    },
    explain: "Business Central stores a short code rather than a name: JC is Jack Collings, JO is Jordan Orange, KS is Keiran Southgate. The Admin Centre translates it for you using BC's own User Setup list — so if you can still see a bare code anywhere, that person is missing from the list and IT should be told.",
  },
  {
    title: "Reading a Windows username",
    kind: "CHOICE",
    brief: "A Business Central record shows “ANNABELL.FENBY” where you expected a name. What is that, and why is it there rather than a code?",
    params: {
      options: [
        "A Windows username — Business Central's short code is blank on tens of thousands of lines, so it falls back to this",
        "A customer account reference",
        "A corrupted record that needs re-importing",
        "The name of the import batch the lot came over in",
      ],
      correct: 0,
    },
    explain: "Three fields can hold the person: a short code, a catalogued-by username, and a created-by username. The code is blank far more often than not — measured on 200 lines with a blank code, created-by was filled on all 200 — so the username is what actually identifies the person most of the time.",
  },
  {
    title: "Who does BC think did it?",
    kind: "BC_NAME",
    panel: "who",
    params: { mode: "PICK" },
    brief: "Look up {{q}} and read the “What Business Central says” panel. Which person has Business Central recorded against it?",
    hint: "The Admin Centre has already turned BC's code or username into a name for you — you are reading it off the BC panel, not working it out.",
    explain: "Remember what this name means: on a lot that came from the Hub it is usually whoever ran the import, not the cataloguer. It is a cross-reference, not the answer to who catalogued this.",
  },
  {
    title: "The two names disagree",
    kind: "CHOICE",
    brief: "A lot's Hub record says Keiran Southgate. Business Central shows JO against the very same lot. What has happened?",
    params: {
      options: [
        "Nothing wrong — Keiran catalogued it, and Jordan ran the import that pushed it to BC",
        "The lot has been catalogued twice by two different people",
        "The Hub name is wrong and should be corrected to match BC",
        "The barcode has been reused, so the two systems hold different items",
      ],
      correct: 0,
    },
    explain: "Lots go to Business Central in bulk, so every lot in that batch carries whoever ran it. The two names answering different questions is normal — the Hub answers who catalogued it, BC answers who pushed it across. Always quote the Hub's name.",
  },
  {
    title: "The wrong category",
    kind: "CHOICE",
    brief: "A colleague says a lot is filed under the wrong category, and shows you Business Central to prove it. Where should you check before agreeing with them?",
    params: {
      options: [
        "The Hub — the category the cataloguer actually chose is there; BC's arrives with the bulk push and is routinely wrong",
        "Nowhere — Business Central is the system of record for categories",
        "The tote's category on tab 1, which overrides the lot's",
        "The sale's own settings, which set the category for every lot in it",
      ],
      correct: 0,
    },
    explain: "Same root cause as the cataloguer name. The push writes what it writes across the whole batch, so a category read off BC is not evidence of a cataloguing mistake. Check what the Hub holds first — that is what the person with the item in their hands actually chose.",
  },
  {
    title: "Which sale is it in?",
    kind: "LOT_SALE",
    panel: "who",
    params: { mode: "PICK" },
    brief: "A customer wants to know when their item is selling. Look up {{q}} and tell me the sale code it is in.",
    hint: "The sale is shown on the lot card as a code and a name — F090 — Diecast Sale. The code on its own is enough.",
    explain: "The Hub's sale is the one that counts: it is where the lot was catalogued. If BC has it filed somewhere else, the tool has already worked out which to believe.",
  },
  {
    title: "When was it done?",
    kind: "WHEN_CATALOGUED",
    panel: "who",
    params: { mode: "PICK" },
    brief: "Somebody is querying how long a consignment has been sitting. Look up {{q}} and tell me the date it was catalogued.",
    hint: "It is directly under the cataloguer's name — “on Monday 3 August 2026 at 14:32”. The day and month are enough.",
    explain: "Catalogued-on is the Hub's own timestamp, written when the lot was created. It is the honest answer to how long something has been waiting.",
  },
  {
    title: "Where did it come from?",
    kind: "LOT_RECEIPT",
    panel: "who",
    params: { mode: "PICK" },
    brief: "Look up {{q}} and tell me which receipt the item was booked in on.",
    hint: "On the lot card, alongside the barcode and unique ID. A receipt looks like R000009.",
    explain: "Going lot → receipt is how you get from one item back to the whole consignment it arrived with — then tab 1 on that receipt shows you the rest of it.",
  },
  {
    title: "Which box was it in?",
    kind: "LOT_TOTE",
    panel: "who",
    params: { mode: "PICK" },
    brief: "Look up {{q}} and tell me which tote the lot was made from.",
    hint: "The lot card calls it “Made from tote”. A tote number looks like T001868.",
    explain: "Worth knowing this is the tote the cataloguer recorded on the lot. Lots are not individually tagged with a tote in either system, which is why a tote SEARCH on tab 1 gives you the whole receipt rather than just that box.",
  },
  {
    title: "What does that warning mean?",
    kind: "CHOICE",
    brief: "You look up a customer's receipt and one of the rows says “⚠ Needs looking at” instead of a normal status. What has the tool told you?",
    params: {
      options: [
        "The item is in Business Central's problem pile — A999, lost, missing or re-receipted",
        "The search returned too many rows and some were left out",
        "The lot has not been catalogued yet",
        "Business Central and the Hub disagree about the sale",
      ],
      correct: 0,
    },
    explain: "A999 is BC's pile for lost, missing, re-receipted and otherwise broken records. It is a real problem with that item, not a problem with your search — worth flagging rather than reading the location out to the customer.",
  },
  {
    title: "Where is it?",
    kind: "LOT_LOCATION",
    panel: "who",
    params: { mode: "PICK" },
    brief: "Somebody needs to physically put their hands on this item. Look up {{q}} and tell me the location Business Central has for it.",
    hint: "It is on the “What Business Central says” panel. The Hub does not track where things physically are — only BC does.",
    explain: "This is the clearest example of why the tool reads both systems. The Hub can tell you who catalogued it and which sale it is in; only Business Central knows which shelf it is on.",
  },
  {
    title: "Which number is which?",
    kind: "CHOICE",
    brief: "A note on your desk says R000016-413. Which box does that number go in?",
    params: {
      options: [
        "Tab 2 — it is a unique ID, which identifies one lot for its whole life",
        "Tab 1, receipt — anything starting with R is a receipt number",
        "Tab 1, tote — it is a tote reference",
        "Tab 3 — it is a sale code",
      ],
      correct: 0,
    },
    explain: "A receipt is R000009 — letter and digits. A unique ID is a receipt number, a dash, and the line number: R000016-413. The dash is the tell. It goes in tab 2 alongside the barcode.",
  },
  {
    title: "What the barcode tells you",
    kind: "CHOICE",
    brief: "A lot's barcode is F109034, but Business Central has it filed under auction code A995. Which sale is it really for?",
    params: {
      options: [
        "F109 — the barcode names the sale, and A995 is a holding pen called Temp F109 Bears",
        "A995 — Business Central's own field is always the authority",
        "Neither; the lot needs re-cataloguing before it can go in a sale",
        "Both, because the lot has been entered into two different sales",
      ],
      correct: 0,
    },
    explain: "The A9-hundreds are holding pens, not auctions. The first four characters of a barcode name the sale and agree with BC's field 94.6% of the time across 211,229 rows — and every one of the 692 items parked in A995 carried an F109 barcode. The Admin Centre has already worked this out for you.",
  },
  {
    title: "How many on the receipt?",
    kind: "LOT_COUNT",
    panel: "find",
    params: { mode: "PICK", type: "receipt", min: 2 },
    brief: "A customer wants to know how much of their consignment has been done. Search by receipt number for {{q}} and tell me how many lots the Hub has against it.",
    hint: "The results are grouped by sale and the blocks start collapsed — open them all, or add up the counts in the block headers.",
    explain: "The everyday question. Note the grouping does the harder half of the job for you: it also tells you WHICH sales the work went into.",
  },
  {
    title: "Whose items are they?",
    kind: "LOT_VENDOR",
    panel: "find",
    params: { mode: "PICK", type: "receipt" },
    brief: "A tote has turned up on the floor with receipt {{q}} on it and nothing else. Look it up and tell me the customer number the items belong to.",
    hint: "A customer number looks like C224652.",
    explain: "Receipt → customer is how you get from “a box has appeared” to “whose box is it”, which is the first thing you need before you can ring anybody.",
  },
  {
    title: "Spread across the sales",
    kind: "VENDOR_SALE_COUNT",
    panel: "find",
    params: { mode: "PICK", min: 2 },
    brief: "Customer {{q}} is on the phone asking where all their things are. Search by customer number and tell me how many different sales their lots are spread across.",
    hint: "Search by customer number, then count the sale blocks. The line above them tells you as well.",
    explain: "This is exactly why the results are grouped by sale rather than listed flat — a regular vendor's items routinely span a dozen sales, and “which sales” is nearly always the real question.",
  },
  {
    title: "The tote trap",
    kind: "CHOICE",
    brief: "You search by tote number T001868 and get back 60 lots. The customer insists that tote only had about 20 things in it. Who is right?",
    params: {
      options: [
        "The customer may well be — a tote search shows everything on that tote's RECEIPT",
        "The tool is right; the customer has miscounted",
        "The extra 40 lots are duplicates and should be deleted",
        "The tote has been merged with another one in Business Central",
      ],
      correct: 0,
    },
    explain: "Lots are not individually tagged with a tote in either system, so the search bridges tote → receipt → lots. Other totes booked in on the same receipt come along with it. The panel says so on screen every time you search by tote.",
  },
  {
    title: "Who did the most?",
    kind: "SALE_TOP",
    panel: "sale",
    params: { mode: "PICK", min: 2 },
    brief: "Open “Who catalogued this sale?”, load sale {{q}}, and tell me which cataloguer entered the most lots in it.",
    hint: "The tab lists everyone who worked on the sale with a count against each name. You want the biggest.",
    explain: "The lot numbers come from Business Central and the names come from the Hub — this tab is the only place in either system the two are joined up.",
  },
  {
    title: "How big is the sale?",
    kind: "SALE_COUNT",
    panel: "sale",
    params: { mode: "PICK", min: 2 },
    brief: "Load sale {{q}} and tell me how many lots the Hub holds for it.",
    hint: "Load the sale and read the count. Click a cataloguer's name to filter, and click it again to clear.",
    explain: "Worth knowing this is the HUB's count. The tab also flags lots Business Central has that the Hub does not, which is the gap worth chasing before a sale goes live.",
  },
  {
    title: "How many hands?",
    kind: "SALE_CATALOGUERS",
    panel: "sale",
    params: { mode: "PICK", min: 2 },
    brief: "Still on sale {{q}} — how many different people catalogued lots in it?",
    hint: "Count the names in the “Who catalogued this sale” list.",
    explain: "A quick spot check before a sale goes live. One name on a large sale, or a dozen names on a small one, are both worth a second look.",
  },
  {
    title: "Nothing found",
    kind: "CHOICE",
    brief: "You scan a barcode into tab 2 and get nothing at all back. What is the first thing to try?",
    params: {
      options: [
        "Search the unique ID instead — the barcode changes when an item is re-entered into a later sale",
        "Report it as missing straight away",
        "Search the same barcode on tab 1",
        "Wait for the next warehouse sync and try again",
      ],
      correct: 0,
    },
    explain: "The barcode belongs to a sale; the unique ID belongs to the item for life. An empty result nearly always means the wrong number, not a missing lot.",
  },
]
