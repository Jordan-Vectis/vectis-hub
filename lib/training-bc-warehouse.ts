// The BC Warehouse course — the deck and the practice scenarios.
//
// ⚠ EVERY CLAIM BELOW WAS READ OFF app/(app)/tools/bc-warehouse/page.tsx AND THE ROUTES IT CALLS.
// Where a screen's own wording is quoted it is quoted exactly. Do not add a "fact" here from
// memory or from the tool's Guide tab — see the next warning.
//
// ⚠ DO NOT COPY THE TOOL'S OWN GUIDE TAB. app/(app)/tools/bc-warehouse/guide-tab.tsx and
// lib/bc-warehouse-guide.ts were written on 2026-07-02 and the tool has moved on. At least three
// of its statements are contradicted by the code today, the worst being what the Search tab
// shows in its default mode.

import type { SeedSlide, SeedExercise } from "@/lib/training-seed"

// ─── The deck ────────────────────────────────────────────────────────────────
// Twelve tabs, so this is longer than the Admin Centre course — but one slide per screen, and
// the detail stays in the presenter notes.

export const BC_WAREHOUSE_SLIDES: SeedSlide[] = [
  {
    layout: "TITLE",
    title: "BC Warehouse",
    subtitle: "Where our stock is, and what needs pulling off the shelves",
    notes: "Twelve tabs. Everyone needs the first half; Data Sync and DB Explorer are IT's. About 20 minutes, then the practice tasks.",
  },
  {
    layout: "STATEMENT",
    title: "It's two tools wearing one coat",
    subtitle: "Most screens read a COPY of Business Central. Three go to BC live.",
    notes: "The sentence that explains nearly every odd thing in here. The copy lives in our own database and only changes when a sync runs. The three live ones — Location History, Collections Due, Unsold Items — go straight to BC using your own Microsoft sign-in.",
  },
  {
    title: "Getting in",
    graphic: "STEPS",
    body: `- It opens on a menu of cards — pick the section you want
- Blue bar at the top? Press Sign in with Microsoft — it's a one-off
- Round ? button, bottom right, opens the guide for whichever section you're on
- Grey bar along the bottom tells you how fresh the data is`,
    tryHref: "/tools/bc-warehouse",
    tryLabel: "Open BC Warehouse",
    notes: "The Microsoft sign-in is only needed for the three live tabs, so people don't notice it is missing until Collections Due fails on them. The home cards can be dragged into your own order with ⠿ Reorder — that order is saved per device, so rearranging on the office PC does not change the iPad.",
  },

  // ── Finding things ──
  {
    layout: "TITLE",
    title: "Finding things",
    subtitle: "Search, and the heatmap",
  },
  {
    title: "Search by Location",
    body: `Two modes.

Specific search — the exact thing. A full location like A2A1, a barcode, or a tote number.

Whole aisle — everything in an aisle. Type A2.

Capitals don't matter, it fixes them for you.`,
    tryHref: "/tools/bc-warehouse",
    tryLabel: "Try it now",
    notes: "Specific search needs the FULL location code — typing just A2 there finds nothing. You get a totes table and an items table, both with column filters and a 🖨 PDF button that prints exactly the rows you are looking at.",
  },
  {
    layout: "STATEMENT",
    title: "A2 means A2 — not A20",
    subtitle: "Whole aisle is precise on purpose",
    body: "Aisle A2 brings back A2A1 and A2B2, and leaves A20 and A22 alone. The bit after the aisle has to be a letter.",
    notes: "⚠ Worth flagging now because Collections Due and Unsold Items do the OPPOSITE — they match on any prefix. Same-looking box, different rule. Covered again on that slide.",
  },
  {
    layout: "STATEMENT",
    title: "⚠ A barcode search won't tell you where it is",
    subtitle: "The Location column only appears in Whole aisle mode",
    body: "Specific search gives you the sale, the lot number, the tote and the customer. For where it physically is, search the aisle, or use the heatmap.",
    notes: "The tool's own Guide says otherwise. The Guide is out of date — the code is the authority. This is the single most likely thing to make somebody think the tool is broken.",
  },
  {
    title: "Location Heatmap",
    body: `The racking drawn as it really is — bay letters along the bottom, shelf numbers up the left, shelf 1 at the bottom.

Each square shows how many items and totes are on it. A small dot means there's a tote there.

Click a square and the panel on the right lists exactly what's on that shelf.`,
    notes: "Good for putaway — finding space at a glance. There is a colour key on screen (Empty, 1–2, 3–5, 6–9, 10+, Has tote), filters for aisle and auction, and a chip counting unlocated items.",
  },

  // ── The reports ──
  {
    layout: "TITLE",
    title: "The reports",
    subtitle: "Four screens that produce a list to walk the floor with",
  },
  {
    title: "Sale Checklist",
    body: `Before a sale: can we actually find every lot?

Type the sale code, open the card, and it counts them — located, missing, total.

Press Missing, then 🖨 PDF, and you've got the list to go and look for.`,
    tryHref: "/tools/bc-warehouse",
    tryLabel: "Try it now",
    notes: "It searches auction CODES AND NAMES only — typing a barcode returns nothing. Rows with no location are tinted red and read \"Missing\". Only one sale card opens at a time. Every column heading is a filter, and the PDF prints exactly the rows currently shown, in the order shown.",
  },
  {
    title: "Collections Due",
    body: `“Items in the chosen aisles that have a collection docket — typically due to be shipped but not yet collected.”

Type the aisles you want to walk, comma separated — A39, A40, A41 — and print the list.`,
    notes: "The aisle boxes here match on PREFIX: A39 catches A39A1, A39B5, A39C3 and so on. That is not the same rule as Search by Location's Whole aisle, which requires a letter next.",
  },
  {
    title: "Unsold Items",
    body: `“Items in the chosen aisles where Hammer Price = 0 — i.e. passed at auction or not yet sold.”

Same workflow as Collections Due, and the results are grouped by customer.`,
    notes: "Same aisle-prefix boxes. Grouping by customer is the difference that matters on the floor — you pull one vendor's unsold stock together.",
  },
  {
    layout: "STATEMENT",
    title: "⚠ The two printouts don't behave the same",
    subtitle: "Collections Due asks BC again. Unsold Items prints what's on screen.",
    body: "So a Collections Due PDF can differ from the table you were just looking at, if something changed in between. The Unsold Items PDF cannot.",
    notes: "Verified in the code: Collections Due's PDF is a fresh GET that re-queries Business Central; Unsold Items POSTs the rows already loaded. Nobody would guess this from the screen, and it is exactly the sort of thing that gets blamed on the tool being wrong.",
  },
  {
    title: "Tote Report",
    body: `“Totes on active shelf locations, by category and location.”

How many totes are on active shelves, how many categories they cover, and which category is the biggest.`,
    notes: "Active shelves only — bench, query, archive and totes with no location are deliberately left out, and the screen says so. Useful for a stock-shape question rather than for finding one thing.",
  },
  {
    title: "Location Barcode Sheet",
    body: `Type the location codes you want and it builds a printable sheet of scannable labels, with a direction arrow on each row.

An occasional job, but it's a warehouse job — not IT's.`,
    notes: "It is the one screen that touches neither BC nor the cache; it just posts your typed codes off to build the PDF.",
  },

  // ── Location History ──
  {
    layout: "TITLE",
    title: "Location History",
    subtitle: "Where has this been, and who moved it?",
  },
  {
    title: "How to use it",
    graphic: "STEPS",
    body: `- Pick 🗂 Tote number or 🔖 Barcode
- Type the code and press Look up
- Read the top row — it's the most recent move, highlighted
- Its “To” is where the thing should be now`,
    notes: "You get the BC Item Key, how many movements were found, then From / To / Changed by / Date / Time, newest first. Changed by shows a real name where the initials are recognised — there is a built-in list of about 60 staff codes, so an unfamiliar set of initials means somebody is missing from it. \"No location changes found in the BC change log\" is a normal answer, not an error.",
  },
  {
    layout: "STATEMENT",
    title: "⚠ Look a TOTE up, not a barcode, where you can",
    subtitle: "A barcode lookup takes the first match it finds",
    body: "Barcodes get re-used between sales, so a barcode can hand you a different item's movement history with no warning at all. A tote number can't.",
    notes: "This is a deliberate behaviour in the code, not a bug to report. It is also why the Admin Centre course teaches that a barcode belongs to a sale rather than to an item — same underlying fact, two different tools.",
  },
  {
    title: "🔍 Check Similar Changes",
    body: `The button underneath the history, and the reason this screen is worth knowing.

It takes the most recent move and asks: what else moved within five minutes either side of it?

If a tote was mis-scanned onto the wrong shelf, everything that went with it shows up together — items and totes, with who moved them. You can print the list.`,
    notes: "Five minutes before and after the newest movement, deliberately — using the whole history would span weeks on an old item. It queries BC live, so it can take a few seconds and shows a progress bar. This is the tool for \"a whole shelf has gone walkabout\".",
  },

  // ── Freshness and IT ──
  {
    title: "How fresh is any of this?",
    body: `The grey bar at the bottom shows the last sync and has a Sync now link.

It tops itself up when you open the tool, so it's usually fine.

But it shows a time with no date — a sync from three days ago looks exactly like one from ten minutes ago.`,
    notes: "The Data Sync tab is the honest version: a card per source showing real ages like \"5m ago\", \"3d ago\" or \"never\". Receipt Lines, Auction Lines, Change Log and Totes can be re-synced or fully re-pulled; Active Totes and All Receipt Totes are sync-only; Items in DB is just a row count with no age at all.",
  },
  {
    layout: "STATEMENT",
    title: "DB Explorer is IT's, and it can delete the cache",
    subtitle: "Look if you like — don't clear anything",
    body: "It shows the raw stored data. It also has a Clear BC-synced cache tool that makes you type DELETE, and that is exactly as serious as it sounds.",
    notes: "Clearing the cache does not touch Business Central — it empties our copy, and everything else in the tool goes blank until a full re-sync finishes. If somebody needs data cleared, it is an IT job.",
  },
  {
    layout: "STATEMENT",
    title: "Empty doesn't always mean empty",
    subtitle: "Check the mode, the spelling and the sync before you believe it",
    body: "Nothing found, a stale copy, and a list cut short can all look identical on screen.",
  },
  {
    layout: "TITLE",
    title: "Now you try",
    subtitle: "Real stock from our own system — and it marks itself",
  },
]

// ─── The practice ────────────────────────────────────────────────────────────
// ⚠ Every live task picks a REAL Business Central record from the synced copy and derives the
// answer from it, so it can never ask about something that has gone.
//
// ⚠ Only asks for things the SEARCH BY LOCATION items table actually shows — Unique ID, Barcode,
// Description, Auction, Lot, Category, Tote / Bin. Nothing asks "where is it?" from a barcode,
// because that column is not in the default mode. Nothing is asked about Location History,
// Collections Due or Unsold Items either: those three query BC live and nothing they put on
// screen is in our database, so no answer could be marked.

export const BC_WAREHOUSE_EXERCISES: SeedExercise[] = [
  {
    title: "Live, or a copy?",
    kind: "CHOICE",
    brief: "You search a barcode on Search by Location and the result looks out of date. What are you actually looking at?",
    params: {
      options: [
        "A copy of Business Central held in our own database, which only changes when a sync runs",
        "Business Central itself, live, so it cannot be out of date",
        "The Hub's cataloguing records rather than BC",
        "A cached copy in your browser — refreshing the page fixes it",
      ],
      correct: 0,
    },
    explain: "Most of BC Warehouse reads a copy. It tops itself up when you open the tool, but it is still a snapshot. Only Location History, Collections Due and Unsold Items go to BC live — which is why those three need the Microsoft sign-in.",
  },
  {
    title: "Which sale is it in?",
    kind: "BC_SALE",
    params: { mode: "PICK" },
    brief: "Search by Location, specific search, barcode {{q}}. Which sale does Business Central have it in?",
    hint: "It's the Auction column in the Items table.",
    explain: "This is BC's own sale code for the item. If it looks like a holding pen rather than a sale, that is BC's parking, not a mistake.",
  },
  {
    title: "The lot number",
    kind: "BC_LOT_NO",
    params: { mode: "PICK" },
    brief: "Same search — barcode {{q}}. What lot number does it have?",
    hint: "The Lot column, next to the auction.",
    explain: "The lot number only exists in Business Central — the Hub has none at all. This is the number a customer will quote at you.",
  },
  {
    title: "Which box is it in?",
    kind: "BC_TOTE",
    params: { mode: "PICK" },
    brief: "Still on barcode {{q}} — which tote is it in?",
    hint: "The Tote / Bin column.",
    explain: "Tote is the one to carry into Location History. Look a tote up there rather than a barcode: barcodes are re-used between sales, so a barcode lookup can show you a different item's history entirely.",
  },
  {
    title: "A2 or A20?",
    kind: "CHOICE",
    brief: "On Search by Location you pick Whole aisle and type A2. Which shelves come back?",
    params: {
      options: [
        "A2A1 and A2B2 — but not A20 or A22",
        "Everything starting with A2, including A20 and A22",
        "Only the exact location A2",
        "Every aisle beginning with A",
      ],
      correct: 0,
    },
    explain: "Whole aisle needs a letter after the aisle. ⚠ Collections Due and Unsold Items are the opposite — their aisle boxes match any prefix, so A39 there catches A39A1, A39B5 and anything else starting A39. Same-looking box, different rule.",
  },
  {
    title: "Which report?",
    kind: "CHOICE",
    brief: "You've been asked for a pick list of everything in aisles A50–A52 that didn't sell. Which screen?",
    params: {
      options: [
        "Unsold Items — hammer price of zero, in the aisles you name, grouped by customer",
        "Collections Due — it lists everything waiting in those aisles",
        "Sale Checklist — filter it to Missing",
        "Search by Location, Whole aisle, then filter the table",
      ],
      correct: 0,
    },
    explain: "Unsold Items is exactly that report: hammer price = 0, filtered to the aisles you type, grouped by customer so you pull one vendor's stock together. Collections Due is the opposite end — things with a collection docket, waiting to be shipped.",
  },
  {
    title: "The printout doesn't match",
    kind: "CHOICE",
    brief: "You print the Collections Due PDF and it doesn't quite match the table you were looking at. What's happened?",
    params: {
      options: [
        "That PDF asks Business Central again, so it can pick up changes made since you loaded the table",
        "The PDF is capped and quietly drops rows",
        "The PDF prints every aisle, ignoring your filter",
        "Nothing — they can never differ",
      ],
      correct: 0,
    },
    explain: "Collections Due builds its PDF from a fresh query to BC. Unsold Items does the opposite — it sends the rows already on your screen, so that printout always matches exactly. Worth knowing which one you are holding.",
  },
  {
    title: "A shelf has gone walkabout",
    kind: "CHOICE",
    brief: "A tote has turned up on completely the wrong shelf and you suspect a mis-scan took others with it. What finds the rest?",
    params: {
      options: [
        "Location History → look the tote up → 🔍 Check Similar Changes",
        "The Location Heatmap — click the shelf and read its contents",
        "Search by Location, Whole aisle, on the wrong aisle",
        "Tote Report, filtered by location",
      ],
      correct: 0,
    },
    explain: "Check Similar Changes takes the most recent movement and shows everything else that moved within five minutes either side of it — items and totes, with who moved them, printable. That is the shape of a mis-scan, and no other screen finds it.",
  },
]
