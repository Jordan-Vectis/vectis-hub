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
// ⚠ Written to be SAID OUT LOUD to a room, not read off a page. Short slides, plain words, one
// idea each. The detail — the measured percentages, BC's field names, the exact holding-pen
// codes — lives in the presenter notes, where a trainer can reach for it if somebody asks. Put
// it on the slide and the slide stops being a slide.
//
// Everything asserted here was read off app/(app)/tools/lot-lookup/* and app/api/lot-lookup/*.
// People believe training material, which is what makes a wrong slide expensive.

export const ADMIN_CENTRE_SLIDES: SeedSlide[] = [
  // ── Part 1 · Why you would use it ──
  {
    layout: "TITLE",
    title: "The Admin Centre",
    subtitle: "Everything about a lot, on one screen",
    notes: "Ask the room where they look today when they need to know something about a lot. Almost everyone will say Business Central. That is the habit this course is here to break. About 30 slides, 20 minutes, then the practice tasks.",
  },
  {
    layout: "STATEMENT",
    title: "Business Central says Jack and Jordan catalogued everything",
    subtitle: "They didn't. They pushed it.",
    notes: "This is the slide the whole course hangs off. Ask for a show of hands: who has looked up a lot in BC and taken the cataloguer at face value?",
  },
  {
    title: "Why that happens",
    body: `The team catalogues in the Hub all week.

At the end, it all gets pushed over to Business Central in one go.

BC stamps that push onto every lot in the batch.

So it records who pressed the button, not who did the work.`,
    notes: "Be fair to BC — it is not broken. It is telling you what happened to the record. It was never told what happened to the item.",
  },
  {
    title: "Which means you can't trust",
    layout: "CARDS",
    body: `- Catalogued by — you get whoever ran the push
- Catalogued date — you get the day it was pushed
- Category — comes over the same way, and is often wrong`,
    notes: "These three are the ones people get caught by. If somebody quotes any of them off BC, ask where they got it.",
  },
  {
    layout: "STATEMENT",
    title: "The Hub knows who really did it",
    subtitle: "It was there at the time",
    body: "It records who was logged in, the moment they created the lot, and the category they picked.",
  },
  {
    title: "But BC still knows things the Hub doesn't",
    body: `Only Business Central knows
- The lot number your customer will quote at you
- Where the item is right now

Only the Hub knows
- Who really catalogued it, and when
- The real category
- Every change made since

The answer is never in one system.`,
    notes: "Not Hub good, BC bad. Each is right about different things. The skill is knowing which to ask.",
  },
  {
    layout: "STATEMENT",
    title: "So this tool joins them together",
    subtitle: "And the join is the bit you can't get anywhere else",
    body: "Who catalogued lot 247 in F088? BC has the lot number. The Hub has the name. Put them on one line and you have an answer that was in neither system.",
  },

  // ── Part 2 · What you would use it for ──
  {
    layout: "TITLE",
    title: "What you'd use it for",
    subtitle: "The questions that come up every week",
  },
  {
    layout: "CARDS",
    title: "Questions it answers",
    body: `- Who catalogued this lot?
- Which sale is it in?
- When is it going through?
- Where is the item right now?
- How much of this customer's stuff is done?
- Who catalogued the lots in this sale?`,
    tryHref: "/tools/lot-lookup",
    tryLabel: "Open the Admin Centre",
    notes: "Ask the room which of these they were asked in the last fortnight. Usually several hands go up for the first three.",
  },
  {
    layout: "CARDS",
    title: "Three tabs, three starting points",
    body: `- Find a customer's lots — start with a receipt, tote or customer
- Who catalogued this lot? — start with one barcode
- Who catalogued this sale? — start with a sale`,
    notes: "Pick the tab by what you are HOLDING. That is the simplest rule and it is nearly always right.",
  },
  {
    title: "The numbers you'll type",
    graphic: "STEPS",
    body: `- Receipt — R000009 — one delivery
- Tote — T001868 — one box
- Customer — C224652 — one person, everything they've sent
- Barcode — F066001 — one lot, in one sale
- Unique ID — R000016-413 — one lot, forever`,
    notes: "Write these five on the whiteboard and leave them up for the practice session. Almost every failed search is the right number in the wrong box.",
  },

  // ── Part 3 · How to use it ──
  {
    layout: "TITLE",
    title: "Tab 1 — Find a customer's lots",
    subtitle: "The one you'll use most",
  },
  {
    title: "How to use it",
    graphic: "STEPS",
    body: `- Pick receipt, tote or customer
- Type the number and press Search
- Read the totes — what they sent in
- Read the sales underneath — what it's become`,
    tryHref: "/tools/lot-lookup",
    tryLabel: "Try it now",
    notes: "On customer, you can also type part of their NAME. Handy when someone rings up and has no idea what their number is.",
  },
  {
    title: "What you get back",
    body: `Their totes first — how many, and how many are done.

Then their lots, grouped by sale. Each sale shows the date it's going through and how many lots are in it.

Open a sale and you get the lot number, what it is, the tote, who catalogued it, and where it's up to.`,
    notes: "The groups start closed on purpose — a regular customer's things can span a dozen sales. The question is usually WHICH sales before it is ever show me everything. Open them all is there when you want it.",
  },
  {
    layout: "STATEMENT",
    title: "This is the screen for “when is my stuff selling?”",
    subtitle: "Every sale block has its date on it",
    notes: "Probably the single most common customer question, and it is answered without opening anything.",
  },
  {
    layout: "TITLE",
    title: "Tab 2 — Who catalogued this lot?",
    subtitle: "One barcode in, one name out",
  },
  {
    title: "How to use it",
    graphic: "STEPS",
    body: `- Scan or type the barcode
- Read the big name at the top — that's your answer
- Underneath: the sale, the receipt, the tote, the customer
- Further down: what BC says, and everyone who's touched it`,
    tryHref: "/tools/lot-lookup",
    tryLabel: "Try it now",
    notes: "Deliberately huge type at the top. This tab answers one question and you should be able to read it across a desk.",
  },
  {
    title: "If it says “No name recorded”",
    body: `That's not a fault. Older lots and imported lots don't have one.

Look at everyone who's worked on the lot — the first name is usually your answer.`,
    notes: "Teach the fallback or people will read it as the tool being broken.",
  },
  {
    layout: "TITLE",
    title: "Tab 3 — Who catalogued this sale?",
    subtitle: "A whole sale at once",
  },
  {
    title: "How to use it",
    graphic: "STEPS",
    body: `- Pick the sale from the list
- Or type a lot number to jump straight to it
- Click a cataloguer's name to see just their lots
- Click it again to clear`,
    tryHref: "/tools/lot-lookup",
    tryLabel: "Try it now",
    notes: "This is the only place the lot number and the real cataloguer appear together — BC has one, the Hub has the other.",
  },
  {
    title: "Good for a quick check",
    body: `You get everyone who worked on the sale, with a count each.

One name on a big sale, or a dozen names on a small one, are both worth a second look.

It also flags lots BC has that we don't, and lots with no number yet.`,
    notes: "Useful before a sale goes live.",
  },

  // ── Part 4 · Names ──
  {
    layout: "TITLE",
    title: "About names",
    subtitle: "Why the same person looks different in each system",
  },
  {
    title: "In Business Central you'll see",
    layout: "CARDS",
    body: `- JC or JO or KS — a short code
- JACK.COLLINGS — a computer login
- Nothing at all — it's blank more often than not`,
    notes: "The short code is BC's own staff code. It is empty on tens of thousands of lines, which is why the login name is what usually identifies somebody.",
  },
  {
    title: "The Hub just shows the person",
    body: `Jack Collings. Jordan Orange. Keiran Southgate.

And it translates BC's codes for you, so you should almost never have to read one.

If you can still see a code, that person is missing from the list. Tell IT — it's a two-minute fix.`,
    notes: "The list comes from BC's User Setup. A new starter who has not been added shows as a tidied-up login instead of their name.",
  },
  {
    layout: "STATEMENT",
    title: "The two names disagreeing is normal",
    subtitle: "They're answering different questions",
    body: "The Hub tells you who catalogued it. BC tells you who pushed it. Quote the Hub.",
  },

  // ── Part 5 · Things that look wrong but aren't ──
  {
    layout: "TITLE",
    title: "Looks wrong, isn't",
    subtitle: "Four things that catch people out",
  },
  {
    layout: "STATEMENT",
    title: "A barcode belongs to a sale, not to an item",
    subtitle: "Put an item in a later sale and it gets a new one",
    body: "So if a barcode finds nothing, try the unique ID — that one never changes.",
  },
  {
    layout: "STATEMENT",
    title: "Searching a tote gives you the whole delivery",
    subtitle: "Not just that box",
    body: "Nothing tags a lot to a tote, so it shows everything on that tote's receipt. The screen says so every time.",
  },
  {
    title: "Odd sale codes like A995",
    body: `Those aren't sales. They're waiting rooms in Business Central.

The tool works out the real sale from the barcode instead, so you don't have to think about it.

The one to notice is “Needs looking at” — that means BC has the item in its problem pile, and it genuinely needs sorting.`,
    notes: "A995 is Temp F109 Bears, A999 is lost/missing/re-receipted. The barcode's first four characters name the real sale and agree with BC 94.6% of the time across 211,229 rows — every one of the 692 items sat in A995 carried an F109 barcode.",
  },
  {
    title: "When you find nothing",
    graphic: "STEPS",
    body: `- Check the number is in the right box
- Try the unique ID instead of the barcode
- Check it was catalogued in the Hub at all
- Ask when it was done — very new lots may not have synced yet`,
    notes: "Never let an empty result read as it doesn't exist. It nearly always means the wrong number.",
  },

  // ── Part 6 · Wrap ──
  {
    layout: "CARDS",
    title: "In short",
    body: `- Don't take lot information off Business Central
- The Hub knows who catalogued it, and when
- BC knows the lot number and where it is
- This tool puts both on one screen`,
  },
  {
    layout: "TITLE",
    title: "Now you try",
    subtitle: "Real lots from our own system — and it marks itself",
    notes: "Send them to the Practice tab. Every task picks a real lot each time it's opened, so people can come back as often as they like and never get the same question twice.",
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
