// The BC Warehouse course — the deck and the practice scenarios.
//
// ⚠ KEEP IT SHORT, same as the Admin Centre course. The tool has twelve tabs but only four
// matter day to day, and a deck that walks all twelve is a deck nobody sits through.
//
// ⚠ DO NOT COPY THE TOOL'S OWN GUIDE TAB. app/(app)/tools/bc-warehouse/guide-tab.tsx was written
// on 2026-07-02 and the tool has moved on — parts of it are now contradicted by the code,
// notably what the Search tab shows in its default mode. Everything here was read off
// app/(app)/tools/bc-warehouse/page.tsx and the routes it calls.

import type { SeedSlide, SeedExercise } from "@/lib/training-seed"

// ─── The deck ────────────────────────────────────────────────────────────────

export const BC_WAREHOUSE_SLIDES: SeedSlide[] = [
  {
    layout: "TITLE",
    title: "BC Warehouse",
    subtitle: "Where our stock is, and what needs pulling off the shelves",
    notes: "Twelve tabs, but four do the day-to-day work. 12 slides, about 10 minutes, then the practice tasks.",
  },
  {
    layout: "STATEMENT",
    title: "It's two tools wearing one coat",
    subtitle: "Most screens read a COPY of Business Central. Three go to BC live.",
    notes: "This is the sentence that explains nearly every odd thing in the tool. The copy lives in our own database and only changes when a sync runs. The three live tabs — Location History, Collections Due, Unsold Items — go straight to BC using your own Microsoft sign-in.",
  },
  {
    layout: "CARDS",
    title: "What you'd use it for",
    body: `- Find an item — where is barcode F066001?
- See a shelf — what's sat on A2A1?
- Before a sale — which lots have no location recorded?
- Pick lists — print what's due for collection, or unsold`,
    tryHref: "/tools/bc-warehouse",
    tryLabel: "Open BC Warehouse",
    notes: "Ask which of these they did last week. Search and Sale Checklist will come up most.",
  },
  {
    title: "Getting in",
    graphic: "STEPS",
    body: `- It opens on a menu of cards — pick the section you want
- Blue bar at the top? Press Sign in with Microsoft — it's a one-off
- Round ? button, bottom right, explains whichever section you're on
- Grey bar along the bottom tells you how fresh the data is`,
    notes: "The Microsoft sign-in is only needed for the three live tabs. Everything else works without it, which is why people don't notice until Collections Due fails on them.",
  },
  {
    layout: "TITLE",
    title: "Search by Location",
    subtitle: "The one you'll use most",
  },
  {
    title: "Two ways to search",
    body: `Specific search — the exact thing. A full location like A2A1, a barcode, or a tote number.

Whole aisle — everything in an aisle. Type A2.

Capitals don't matter, it fixes them for you.`,
    tryHref: "/tools/bc-warehouse",
    tryLabel: "Try it now",
    notes: "Specific search needs the FULL location code — typing just A2 there finds nothing, which is the commonest confusion between the two modes.",
  },
  {
    layout: "STATEMENT",
    title: "A2 means A2 — not A20",
    subtitle: "Whole aisle is precise on purpose",
    body: "Searching aisle A2 brings back A2A1 and A2B2, and leaves A20 and A22 alone.",
  },
  {
    layout: "STATEMENT",
    title: "⚠ Searching a barcode won't tell you where it is",
    subtitle: "Specific search has no Location column",
    body: "It gives you the sale, the lot number, the tote and the customer. For where it physically is, search the aisle or use the heatmap.",
    notes: "The tool's own written guide says otherwise. The guide is out of date — the code is the authority here. This is the single most likely thing to make somebody think the tool is broken.",
  },
  {
    title: "Sale Checklist",
    body: `Before a sale: which lots can we actually find?

Type the sale code, open the card, and it counts them — located, missing, total.

Press Missing, then 🖨 PDF, and you've got the list to go and look for.`,
    tryHref: "/tools/bc-warehouse",
    tryLabel: "Try it now",
    notes: "It searches auction codes and names only — typing a barcode there returns nothing. Only one sale card opens at a time.",
  },
  {
    title: "Location History",
    body: `Where has this tote been, and who moved it?

Pick tote or barcode, type the code, press Look up. Newest move is highlighted at the top — that's where it should be now.`,
    notes: "⚠ Two things. It needs the Microsoft sign-in. And on a BARCODE lookup it takes the first match it finds — barcodes are re-used between sales, so you can be shown a different item's history with no warning. Tote numbers don't have that problem, so prefer them.",
  },
  {
    title: "How fresh is any of this?",
    body: `The grey bar at the bottom shows the last sync, and has a Sync now link.

It tops itself up when you open the tool, so it's usually fine.

But it shows a time with no date — so a sync from three days ago looks exactly like one from ten minutes ago.`,
    notes: "The Data Sync tab is the honest version — it shows each source separately as \"5m ago\", \"3d ago\" or \"never\". If something looks wrong, check there before believing the bottom bar.",
  },
  {
    layout: "STATEMENT",
    title: "Empty doesn't always mean empty",
    subtitle: "Check the mode, the spelling and the sync before you believe it",
    body: "Nothing found, a stale copy, and a long list cut short can all look the same on screen.",
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
// Description, Auction, Lot, Category, Tote, Bin. Nothing here asks "where is it?" from a
// barcode, because that column is not in the default mode.

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
    explain: "Worth knowing this is BC's own sale code for the item. If it looks like a holding pen rather than a sale, that is BC's parking, not a mistake.",
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
    hint: "The Tote column.",
    explain: "Tote is the reliable one to follow. If you then want its history, look the TOTE up on Location History rather than the barcode — barcodes get re-used between sales, so a barcode lookup can show you a different item entirely.",
  },
  {
    title: "A2 or A20?",
    kind: "CHOICE",
    brief: "You search Whole aisle for A2. Which shelves come back?",
    params: {
      options: [
        "A2A1 and A2B2 — but not A20 or A22",
        "Everything starting with A2, including A20 and A22",
        "Only the exact location A2",
        "Every aisle beginning with A",
      ],
      correct: 0,
    },
    explain: "Whole aisle is deliberately precise — the bit after the aisle has to be a letter. And remember specific search is the opposite: it needs the full code, so A2 on its own finds nothing there.",
  },
  {
    title: "Nothing came back",
    kind: "CHOICE",
    brief: "A shelf you know has stock on it shows nothing. What's worth checking first?",
    params: {
      options: [
        "The mode and the sync — specific search needs the full code, and the copy may be stale",
        "Nothing — if it's empty on screen, the shelf is empty",
        "Whether the item has been sold",
        "Whether you're signed in to Microsoft",
      ],
      correct: 0,
    },
    explain: "Empty results, a stale copy and a truncated list all look the same. Check you used the right mode, then look at the Data Sync tab, which shows each source's real age instead of just a time.",
  },
]
