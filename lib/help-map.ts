// ─── "Where do I go to…" — the map behind the top-bar Help box ───────────────
//
// Jordan, 2026-09-02: a Help box in the top bar you can ask "where do I go to do an overnight
// run", answering ONLY about the parts of the Hub the person asking may actually open.
//
// ⚠⚠ PERMISSIONS ARE ENFORCED BY FILTERING THE CONTEXT, NOT BY ASKING THE MODEL TO KEEP A
// SECRET. `allowedDestinations()` drops everything the person cannot reach before the question
// is ever sent, so a model that ignores every instruction still cannot mention Accounts to
// someone without Accounts. Never "fix" a leak here by adding a line to the prompt.
//
// Where the knowledge comes from (Jordan's choice over hand-written help pages):
//   1. APP_CARD_DEFS   — the Hub cards: label, description, href, which app permission gates it.
//   2. APP_SECTIONS    — the per-app sidebar sections a role can be restricted to.
//   3. DESTINATIONS    — below: the tabs and pages that matter but appear in neither, because
//                        the answer to most real questions is a TAB, not an app.
//
// ⚠ (3) is hand-written and is the part that can go stale. Keep entries short, keep the `app`
// key honest (it is what gates them), and add one whenever a screen worth finding is built.
// `assertHelpMap()` catches a bad app key at build time; it cannot check that a route exists.

import { APP_CARD_DEFS } from "@/lib/app-cards"
import { ALL_APPS, APP_SECTIONS, hasAppAccess, getAllowedSections, type AppKey } from "@/lib/apps"

export type Destination = {
  /** What it is called on screen — say it back to the user in these words. */
  name: string
  /** A question a person would actually type to find this. Used for the suggestions in the
   *  panel, which are drawn from what THIS person can open — never a hardcoded list. */
  ask?: string
  /** Where it is. A path so the answer can link straight to it. */
  href: string
  /** The app permission that gates it. Undefined = everyone signed in can reach it. */
  app?: AppKey
  /** The section key within that app, when the app has per-section permissions. */
  section?: string
  /** Admins only — for a screen that checks the ADMIN role itself inside an app everyone can open. */
  adminOnly?: boolean
  /** One line: what you actually DO there. This is what makes an answer useful. */
  what: string
  /** Extra words someone might ask with, that are not in the name. */
  also?: string[]
}

// ⚠ Ordered roughly by how often someone needs to find it, because the model sees this list
// in order and the earlier entries carry more weight when two could answer the same question.
export const DESTINATIONS: Destination[] = [
  // ── Auction AI ──────────────────────────────────────────────────────────────
  {
    ask: "How do I run the AI on a sale?",
    name: "Auction AI → Auto Pipeline", href: "/tools/auction-ai?tab=pipeline", app: "AUCTION_AI",
    what: "Runs a whole sale through the AI in three stages — Batch Run writes the descriptions, Key Points Check puts every key point back in, Double Check reads them over. Start it here and leave the tab open, or queue it to run overnight with nothing open.",
    also: ["overnight run", "run a sale through ai", "describe a sale", "pipeline", "auto apply"],
  },
  {
    name: "Auction AI → Auto Pipeline → the overnight queue", href: "/tools/auction-ai/overnight", app: "AUCTION_AI",
    what: "Queue several sales, each with its own instruction, model and settings, and they work through the night on the server with nothing left open. The morning report for each run lives here too.",
    also: ["overnight", "queue a sale", "run it tonight", "leave it running", "morning report"],
  },
  {
    name: "Auction AI → Batch Run", href: "/tools/auction-ai?tab=batch", app: "AUCTION_AI",
    what: "Describe a set of photos in one go without running the whole pipeline.",
    also: ["descriptions from photos"],
  },
  {
    name: "Auction AI → AI Upgrade", href: "/tools/auction-ai?tab=upgrade", app: "AUCTION_AI",
    what: "Rewrite descriptions that already exist — shorten, expand, humanise, fix grammar, improve SEO and so on.",
    also: ["rewrite descriptions", "tidy up wording"],
  },
  {
    name: "Auction AI → Description Copier", href: "/tools/auction-ai?tab=copier", app: "AUCTION_AI",
    what: "Steps through a sale one lot at a time with a Copy button, for typing descriptions into Business Central. The import macro drives this screen.",
    also: ["copy into bc", "macro", "paste into business central"],
  },
  {
    name: "Auction AI → Instructions", href: "/tools/auction-ai?tab=instructions", app: "AUCTION_AI",
    what: "The saved AI instructions every run uses. Edit, add, favourite, and export or import them between staging and production.",
    also: ["prompts", "change what the ai writes", "presets"],
  },
  {
    name: "Auction AI → Instructions Testing", href: "/tools/auction-ai?tab=instrtest", app: "AUCTION_AI",
    what: "Try an instruction change on 5–10 hand-picked lots before using it on a real sale. It only previews — it never writes anything to the catalogue.",
    also: ["test a prompt", "try wording"],
  },

  // ── Cataloguing ─────────────────────────────────────────────────────────────
  {
    name: "Cataloguing → Auction Manager", href: "/tools/cataloguing/auctions", app: "CATALOGUING", section: "AUCTION_MANAGER",
    what: "The list of sales. Open one to reach its lots, and every per-sale tab below.",
    also: ["sales list", "auctions", "open a sale"],
  },
  {
    name: "A sale → Manage Lots", href: "/tools/cataloguing/auctions", app: "CATALOGUING", section: "AUCTION_MANAGER",
    what: "Every lot in a sale, with filters and the mass actions — add or remove the condition line, clear descriptions, generate titles, set starting bids, change vendor, mark added to BC, delete.",
    also: ["bulk", "mass change", "add conditions", "starting bids", "delete lots"],
  },
  {
    ask: "How do I check the descriptions?",
    name: "A sale → Review", href: "/tools/cataloguing/auctions", app: "CATALOGUING", section: "AUCTION_MANAGER",
    what: "Read the descriptions against the key points. Shows what needs attention, what only needs a wording check, and anything the AI flagged as a possible cataloguer mistake.",
    also: ["check descriptions", "key points missing", "ai flagged", "mistakes"],
  },
  {
    ask: "How do I check a sale is ready?",
    name: "A sale → Locking Check", href: "/tools/cataloguing/auctions", app: "CATALOGUING", section: "AUCTION_MANAGER",
    what: "The last check before a sale goes to BC and the website — blocking problems first, then the ones worth a look.",
    also: ["final check", "before publishing", "ready to lock"],
  },
  {
    name: "A sale → Push to BC", href: "/tools/cataloguing/auctions", app: "CATALOGUING", section: "AUCTION_MANAGER",
    what: "Builds the copy-and-paste sheet that puts descriptions, estimates and categories into Business Central, matched by unique ID.",
    also: ["send to business central", "export to bc"],
  },
  {
    name: "A sale → BC Match & Import", href: "/tools/cataloguing/auctions", app: "CATALOGUING", section: "AUCTION_MANAGER",
    what: "Upload BC's Lines export and it writes BC's own unique IDs onto our lots, matched by barcode. This is the only thing that fills in a lot's unique ID.",
    also: ["unique ids blank", "match bc", "import ids"],
  },
  {
    ask: "How do I make the import sheet?",
    name: "Cataloguing → End of Day → BC", href: "/tools/cataloguing/end-of-day", app: "CATALOGUING", section: "END_OF_DAY",
    what: "Builds tonight's import sheet: every lot not yet in BC, grouped by tote, in the exact format the overnight macro reads. Run Data Sync first.",
    also: ["overnight sheet", "import sheet", "end of day", "tote sheet"],
  },
  {
    ask: "How do I add a lot?",
    name: "Cataloguing → Tablet Cataloguing", href: "/tools/cataloguing/tablet/auctions", app: "CATALOGUING", section: "TABLET_CATALOGUING",
    what: "The tablet-shaped version of cataloguing, for entering lots on the shared iPads in the warehouse.",
    also: ["ipad", "tablet", "add lots on the floor"],
  },
  {
    ask: "Where do I add photos?",
    name: "Cataloguing → Photography", href: "/tools/cataloguing/photography", app: "CATALOGUING", section: "PHOTOGRAPHY",
    what: "Upload photos to a sale's lots, matched by the barcode label in the picture or by the filename.",
    also: ["upload photos", "add photos", "photos to a sale", "add pictures", "photograph", "smart scan"],
  },
  {
    name: "Cataloguing → Lotting Up", href: "/tools/cataloguing/lotting-up", app: "CATALOGUING", section: "LOTTING_UP",
    what: "Work out how to split a bench of items into lots, with pricing from our own sold archive.",
    also: ["split into lots", "group items"],
  },
  {
    ask: "How do I price something?",
    name: "Cataloguing → Item Valuations", href: "/tools/cataloguing/research", app: "CATALOGUING", section: "RESEARCH",
    what: "Price an item from photos, using what we have actually sold.",
    also: ["what is it worth", "valuation", "research"],
  },

  // ── Business Central ────────────────────────────────────────────────────────
  {
    ask: "How do I refresh BC?",
    name: "BC Warehouse → Data Sync", href: "/tools/bc-warehouse", app: "BC_WAREHOUSE",
    what: "Pulls the latest data down from Business Central. Anything in the Hub that says 'in BC' is answered from this, so run it before the checks that depend on it.",
    also: ["sync bc", "refresh bc", "out of date", "not showing in bc"],
  },
  {
    name: "BC Warehouse", href: "/tools/bc-warehouse", app: "BC_WAREHOUSE",
    what: "Where things are in the building according to BC — location heatmap, sale checklist, search by location, location history, tote data, collections due, unsold items.",
    // "uncollected lots" is also Accounts → Paid, not collected's keyword, ON PURPOSE: a tie never
    // blocks, so a BC Warehouse user asking for the uncollected lots (Collections Due) isn't refused
    // with Accounts. See that entry.
    also: ["where is a lot", "location", "tote", "find an item", "uncollected lots"],
  },
  {
    ask: "Where is a customer's item?",
    name: "Admin Centre", href: "/tools/lot-lookup", app: "ADMIN_CENTRE",
    what: "Answers 'where is this customer's item?' — search by receipt, tote, customer, sale or barcode and see the whole journey in one row.",
    also: ["customer ringing", "where is their item", "look up a receipt", "who catalogued it"],
  },
  {
    name: "BC Reports", href: "/tools/bc-reports", app: "BC_REPORTS",
    what: "Cataloguing, packing and shipping reports built from Business Central data.",
    also: ["reports from bc", "packing report", "shipping"],
  },
  {
    name: "Marketing Tools", href: "/tools/bc-marketing", app: "BC_MARKETING",
    what: "Write marketing content from sale data — social posts, web descriptions, email lists, images.",
    also: ["social media", "marketing content", "newsletter"],
  },
  // The Hub's own customer database (2026-10-20), copied nightly from BC. Its own permission.
  // ⚠ Keywords stay specific ("customer database", "seller number") so a Goods In or CRM user asking
  // about their own customer screens isn't refused with this one.
  {
    name: "Customers", href: "/tools/customers", app: "CUSTOMERS",
    what: "The customer database — everyone who sells or buys with Vectis, one record per person with one customer number (C…), copied from Business Central every night. Search by name, email, postcode, phone or number; filter down the side (sellers, buyers, lots in a current sale, paid not collected, follow-ups due, blocked, no email) and tap a row to preview the person. Open someone for their receipts, totes, lots, buyer settings, ID checks, seller terms, website account, and the Hub's own notes and calls with follow-up dates. The Data check tab lists likely duplicates and missing details.",
    also: ["customer database", "customer number", "seller number", "buyer number", "customer s details", "customer s address", "customer s email", "duplicate customers", "bc customers", "bc contacts", "customer notes", "log a call with a customer", "customer follow up", "what has a customer consigned", "customer s receipts", "customer s totes", "customer s lots"],
  },

  // ── Goods In ────────────────────────────────────────────────────────────────
  // The Hub's own check-in (2026-10-15). Gated on WAREHOUSE, the same as its Hub card. Within it,
  // some things are for managers or admins only; the help box can only gate on the app, so each
  // `what` line says who can change what, and the pages themselves refuse the rest.
  // ⚠⚠ No bare everyday words in these names or `also` lists — "find", "move", "receipts",
  // "bench", "settings", "tote", "vendor numbers". `blockedDestination()` refuses any question that
  // matches a tool the asker cannot open better than anything they can, and a name part counts the
  // moment it appears as a word: "Goods In → Find" would have told a cataloguer asking "where do I
  // find the photos?" that Goods In isn't part of their Hub. Every phrase here is one only someone
  // asking about Goods In would type. Lotting Up talks about "a bench of items", BC Warehouse
  // answers "tote" and "where is a lot", and Packing (open to everyone) owns "labels" and parcels —
  // don't steal those. Write keywords without hyphens: matchScore reads "check-in" in a question as
  // "check in", so a hyphenated keyword never matches.
  {
    ask: "How do I book a customer's goods in?",
    name: "Goods In → Book in", href: "/tools/warehouse/check-in", app: "WAREHOUSE",
    what: "Book a customer's goods in at the counter, in three steps — Customer, What they've brought, Check & book in. Find the customer in the customer database (or add them), then list their goods as totes and pallets grouped by category, not item by item — \"5x boxes of comics\" is one tote. Each tote and pallet gets its number as soon as its row is added, so its barcode label can be printed right there on the goods step (Print labels prints every one not printed yet; each row has its own Print / Reprint). The customer's usual commission, fees and reserve are used automatically, and any special arrangement agreed with them is shown on the last step; change the terms for one receipt there, or for good on the customer's Fees & agreement tab. Press Book in, then print or email the receipt. A check-in left part-way is kept as \"not booked in yet\" — carry on with it from Check in, the Receipts list, the Goods In dashboard or the customer's page, or throw it away.",
    also: ["book in", "booking in", "book goods in", "goods in", "check in goods", "checking goods in", "new receipt", "tote labels", "pallet labels", "customer bringing in", "print tote labels at check in", "tote number at check in", "unfinished check in", "carry on checking in", "check in not booked in", "not booked in yet", "throw away a check in"],
  },
  // The warehouse database (2026-10-23). ⚠ Named "Tote list", never "Warehouse" or "Stock": a BC
  // Warehouse user asking about "the warehouse" must not be refused with Goods In.
  {
    name: "Goods In → Tote list", href: "/tools/warehouse/totes", app: "WAREHOUSE",
    what: "Every tote and pallet the Hub holds in one list — the Hub's own and Business Central's, copied in nightly. Search by number, receipt, customer, category, description or location; filter by status, tote or pallet, booked in the Hub or BC, location, location kind, receipt, booked dates and label not printed; sort any column; export exactly what's filtered as a CSV. Edit a tote's category, description or status in place — a BC tote only once the Hub has taken over the warehouse records.",
    also: ["list of totes", "every tote", "all the totes", "filter totes", "tote database", "export totes", "totes csv", "which totes are in storage", "totes not put away", "tote labels not printed", "bc totes in goods in"],
  },
  {
    ask: "How do I reprint or email a receipt?",
    name: "Goods In → Receipt list", href: "/tools/warehouse/receipts", app: "WAREHOUSE",
    what: "Every Goods In receipt, newest first. Open one to reprint it, email it to the customer, print its tote and pallet labels again, or add another tote or pallet to it. Only a manager can void one. A check-in that hasn't been booked in yet is marked \"Not booked in yet\" — open it to carry on checking in or throw it away; its labels can be printed, but the receipt itself can't be printed or emailed until it is booked in.",
    also: ["reprint a receipt", "reprint the receipt", "print a receipt", "email a receipt", "email the receipt", "send the receipt", "lost their receipt", "reprint tote labels", "void a receipt", "add a tote to a receipt"],
  },
  // A customer's Fees & agreement tab (2026-10-16). ⚠ Named "Fees & agreement", never "Customers" or
  // "Customer page": a CRM user without Goods In asking "where are the customers?" must not be
  // refused with Goods In. No `ask`, so the Goods In suggestions stay as they were. The single fee
  // names ("lotting fee", "photography fee") are left out on purpose — Lotting Up and Photography
  // would lose a cataloguer's question to this. Every keyword is about a Goods In customer's terms;
  // apostrophes become spaces in matchScore, hence "customer s".
  {
    name: "Goods In → Fees & agreement", href: "/tools/warehouse/customers", app: "WAREHOUSE",
    what: "Each Goods In customer's page has a Fees & agreement tab — open Goods In → Customers, pick the customer, then Fees & agreement. Set their usual commission, lotting, photography and unsold fees and their usual reserve (leave one blank for the standard one); record the day they signed Vectis's vendor terms (the terms themselves can be read there too); and write down any special arrangement agreed with them, in plain words. Set it once: Check in uses it automatically and never asks, the special arrangement is shown at check-in and printed on their receipts (a receipt keeps the arrangement as it was when it was booked). Anyone in Goods In can change it, and the tab says who changed it last.",
    also: [
      "fees and agreement", "customer commission", "customer s commission", "commission for a customer", "change their commission",
      "vendor commission", "usual commission", "customer fees", "customer s fees", "vendor fees", "standard fees", "usual fees",
      "usual reserve", "reserve percentage", "vendor terms", "signed the vendor terms", "signed vendor terms", "terms signed",
      "special arrangement", "special arrangements", "special agreement", "customer agreement", "vendor agreement",
    ],
  },
  {
    ask: "How do I move a tote to a new location?",
    name: "Goods In → Scan to move", href: "/tools/warehouse/move", app: "WAREHOUSE",
    what: "Scan a tote, pallet or lot barcode, then the label of the location it is going to, and the move is recorded with your name and the time. Moving a tote to a bench marks it as being catalogued; a finished lot is moved onto its shelf the same way.",
    also: ["put away", "putting away", "move a tote", "move a pallet", "move a lot to a shelf", "put a lot on a shelf", "shelve a lot", "take a tote to a bench", "scan a location"],
  },
  // The handheld scanner screen and the Vectis Scanner app (2026-10-16). ⚠ Named "Handheld scanner",
  // never plain "Scanner": a name part scores the moment it appears as a word, so "Goods In →
  // Scanner" would refuse a cataloguer whose tablet "scanner isn't working" with Goods In. Every
  // keyword names the handheld or its app. No `ask`, so the Goods In suggestions stay as they were.
  {
    name: "Goods In → Handheld scanner", href: "/scan", app: "WAREHOUSE",
    what: "A phone-sized Goods In screen for the warehouse's handheld scanners, at /scan — in any browser with a scanner set to keyboard output, or in the Vectis Scanner app on the Newland scanners, which opens the same screen and takes each scan straight from the scanner. Put away / Move (scan the tote, pallet or lot, then the location; or scan a location first and everything scanned after goes there until Done), Find (what a code is and where it is now — needs Wi-Fi) and Check a location. Scans made with no Wi-Fi are kept on the scanner and sent in order when it reconnects: each is applied once even if it is sent twice, stamped with the time it was scanned, and one whose item someone else has moved since isn't applied — it says who moved it, where and when. A scan that fails (refused, overtaken by someone else's move, one that didn't go through, or one scanned while the pop-up is already open) holds the screen with a pop-up until you tap \"I've seen it — carry on\" — nothing scanned while it is open is used, so scan those again afterwards — and each failure you acknowledge is recorded in Goods In → Reports. The top of the screen shows who is signed in; on a shared scanner use Switch user (the waiting scans are sent first). Until an admin has pressed Run Migrations for it, scans wait on the scanner rather than being sent. The app is built by GitHub and its install file comes from there.",
    also: [
      "handheld scanner", "handheld scanners", "the handheld", "scanner app", "vectis scanner", "vectis scanner app",
      "newland scanner app", "install the scanner app", "update the scanner app", "scanner apk", "goods in scanner",
      "scan offline", "scanning offline", "scans waiting to send", "scans not sent", "send the waiting scans",
      "switch user on the scanner", "scanner switch user", "stale scan",
      // The failed-scan pop-up (2026-10-21). Each names the handheld — a cataloguer's "my scan failed"
      // on the tablet must never be refused with Goods In. (The button's words "I've seen it — carry
      // on" aren't a keyword: "i ve seen it" is everyday, and the dash breaks the phrase match.)
      "failed scan on the handheld", "handheld failed scan", "handheld failed scans", "handheld pop up",
      "pop up on the handheld",
    ],
  },
  // Scanner sign-in cards (2026-10-16). Every keyword names the scanner or the card — never bare
  // "sign in", "qr code" or "card", which other parts of the Hub (and their users) ask about.
  {
    name: "Goods In → Scanner sign-in cards", href: "/tools/warehouse/scanner-cards", app: "WAREHOUSE",
    what: "Print a sign-in card for the handheld scanner: scanning its QR code on the scanner signs you in with no typing, and on a shared scanner the next person scans theirs to switch. A card holds no password and signs in to the scanner only, never the rest of the Hub. A Warehouse manager can print one for anyone with Warehouse access. Lost one? Cancel it here and it stops working at once. Until an admin has pressed Run Migrations for it, sign in with your username and password.",
    also: [
      "scanner sign in card", "scanner sign in cards", "scanner card", "scanner cards", "scanner login card",
      "print my scanner card", "print a scanner card", "lost my scanner card", "cancel a scanner card",
      "qr code for the scanner", "scanner qr code", "sign in to the scanner", "log in to the scanner",
    ],
  },
  {
    name: "Goods In → Benches", href: "/tools/warehouse/bench", app: "WAREHOUSE",
    what: "What is at each cataloguing bench right now — the totes and pallets waiting to be made into lots, and whose they are.",
    also: ["at the benches", "on the benches", "waiting to be catalogued", "totes waiting", "bench list"],
  },
  // ⚠ Code lookup carries BC Warehouse's own four words ("tote", "location", "where is a lot",
  // "find an item") and Admin Centre's "look up a receipt" ON PURPOSE, so it scores the same as
  // them on those. A tie never blocks (blockedDestination needs strictly more), so a Goods In clerk
  // asking "where is tote T030001?" isn't refused with "BC Warehouse isn't part of your Hub", and a
  // BC Warehouse or Admin Centre user asking the same isn't refused with Goods In. Someone with
  // neither is still refused naming BC Warehouse / Admin Centre (they come first), as before. Its
  // name avoids "find", "look", "receipt" and "tote" as words, any one of which would tip a tie.
  {
    ask: "How do I find where a tote is?",
    name: "Goods In → Code lookup", href: "/tools/warehouse/find", app: "WAREHOUSE",
    what: "Scan or type any Goods In code — a tote, pallet, lot barcode, receipt, location or vendor number — to see what it is, whose it is and where it is now, with every move it has made. For a tote it lists the lots made from it and the shelf each one is on.",
    also: ["tote", "location", "where is a lot", "find an item", "look up a receipt", "goods in tote", "goods in pallet", "goods in receipt", "goods in lot", "lots made from a tote", "lots from this tote", "scan any code"],
  },
  {
    name: "Goods In → Locations & labels", href: "/tools/warehouse/locations", app: "WAREHOUSE",
    what: "Every storage location, cataloguing bench and shelf Goods In can put things in. Filter the list by kind, aisle, bay, shelf, what is there now and when each was last used (or not used); sort by last used or date added; see how many totes, pallets and lots are at each; export the list, or everything at the ticked locations, to a spreadsheet; and print barcode labels. Tick locations (shift-click for a run, or scan their labels) and move everything at them to one other location in one go. Open a location to see what is there and its recent moves, move everything at it elsewhere, export what is there, or check the shelf by scanning what is really on it. Managers add one location, a whole range (an aisle's bays and shelves, benches, cabinet shelves) or a pasted list (a saved CSV works), switch locations off or on, change their kind or give them their usual names many at a time, replace a location's code with a new one, and remove them — a location that was never used is deleted, one used before is switched off so its history stays, and one with goods still there is refused until they are moved out.",
    also: [
      "location labels", "location label", "add a location", "new location", "shelf labels", "bench labels",
      "remove a location", "delete a location", "remove locations", "delete locations", "switch off a location",
      "switch a location off", "add a range of locations", "add a whole aisle", "paste a list of locations",
      "move everything out of a location", "empty a location", "goods in locations",
      // matchScore turns punctuation into spaces, so these are written without apostrophes.
      "check a location", "stock check a location", "check what is at a location", "empty an aisle", "clear an aisle",
      "export what is at a location", "replace a location code", "change a location code", "rename locations",
    ],
  },
  {
    name: "Goods In → Number series & email", href: "/tools/warehouse/settings", app: "WAREHOUSE",
    what: "Where the receipt, tote, pallet and (optional) vendor number series carry on from, and the connection to the mailbox receipts are emailed from. Only a Warehouse admin can change them.",
    also: ["number series", "starting number", "next receipt number", "receipt numbering", "tote numbering", "vendor numbering", "connect the mailbox", "email setup", "receipt emails"],
  },
  // ⚠ Named "Movement record", not "History" / "Movement history": BC Warehouse has a Location
  // History tab, and a BC Warehouse user asking for a tote's "movement history" must not be refused
  // with Goods In. The keywords all say "goods in" for the same reason; the `what` line is what lets
  // the answer point a Goods In user here for "who moved tote T030001?".
  {
    name: "Goods In → Movement record", href: "/tools/warehouse/history", app: "WAREHOUSE",
    what: "Every move of a Goods In tote, pallet or lot — from where to where, who moved it and when — filterable by item, location and day. The page is called History in the Goods In menu.",
    also: ["goods in history", "goods in moves", "goods in movements", "goods in movement history", "moved in goods in"],
  },
  // Goods In → Reports, the warehouse's per-person figures (2026-10-20). ⚠ Named "Output by person",
  // never "Reports" or "Warehouse reports": a name part scores the moment it appears as a word, so a
  // BC Reports or Cataloguing Reports user asking "where are the reports?" would be refused with
  // Goods In. For the same reason there is no bare "warehouse report(s)" or "warehouse tracking"
  // keyword — a BC Warehouse user asking for "the warehouse report" on unsold items, or "warehouse
  // tracking" of where an item is, must not be refused with Goods In. Every keyword names Goods In,
  // the handheld, or the warehouse's PEOPLE with what is counted; never bare "reports", "scans",
  // "performance" or "per cataloguer" (Cataloguing Reports owns those two). No `ask`, so the Goods In
  // suggestions stay as they were. The `what` line says the menu calls it Reports, so the answer can
  // point a Goods In user to the right word.
  {
    name: "Goods In → Output by person", href: "/tools/warehouse/reports", app: "WAREHOUSE",
    what: "How much each person in Goods In has done over a period (today, yesterday, the last 7, 30 or 90 days, 6 months, a year, or any From/To) — handheld scans (with how many were refused, overtaken by someone else's move, or sent late after being made with no Wi-Fi), moves (put away, taken to a bench, lots shelved, moved in bulk), check-ins with the totes and pallets booked, and the failed scans each person acknowledged on the handheld's pop-up (which barcode, what went wrong, when it was scanned and when they acknowledged it), per day, with each person's first and last time on a day and their busiest hour. Charts, a table that sorts by any column, a CSV export, and a page per person with their day-by-day figures, the hours they work and their latest activity. Warehouse managers and admins see everyone; everyone else sees only their own numbers. The page is called Reports in the Goods In menu. UK days and times.",
    also: [
      "goods in reports", "goods in report", "goods in output", "goods in tracking", "goods in scans per person",
      "warehouse user tracking", "warehouse staff tracking", "warehouse staff output", "warehouse output per person",
      "what warehouse are doing per user", "what the warehouse staff are doing",
      "how many scans each", "scans per person", "scans per day", "handheld scans per person", "handheld scans per day",
      "moves per person", "put away per person", "check ins per person",
      "failed scans acknowledged", "acknowledged failed scans", "who acknowledged a failed scan",
    ],
  },

  // ── Accounts ────────────────────────────────────────────────────────────────
  // Paid, not collected (2026-10-22). ACCOUNTS + adminOnly: a non-admin granted Accounts only ever
  // reaches Simple mode, and the panel's page sends them there, so the help box mustn't offer it.
  // ⚠ Named "Paid, not collected (Accounts)", NOT "Accounts → Paid, not collected": a name part scores
  // the moment it appears as a word, so with "Accounts" as a part every question mentioning accounts
  // ("how do I add receipts in accounts?") would score 3 against this admin-only entry, and a
  // Simple-mode user would be refused with it about their own screens. As one part it never matches,
  // and the token "accounts" alone scores 1. Every keyword names paying AND not collecting, or
  // uncollected buyers — never bare "collection", "storage" or "invoice". "uncollected lots" is shared
  // with BC Warehouse (Collections Due) on purpose, so neither side is refused with the other's.
  // No `ask`, so the suggestions stay as they were. Apostrophes are spaces in matchScore ("haven t").
  // Refunds (2026-10-26) — admin-only like Paid, not collected. Keywords all name a refund, a return
  // or a payout, never bare "damaged" or "missing" (a cataloguer's condition questions must not match).
  {
    name: "Refunds (Accounts)", href: "/tools/refunds", app: "ACCOUNTS", adminOnly: true,
    what: "💷 Refunds (admins only, its own tile in Admin & Operations): every refund, part-refund and return request — from the public refund form customers fill in on the website (it replaces the Microsoft Form), vendor payouts added by staff, and the old SharePoint refund log imported once. Each has a reference (RF0042), who sent it, buyer or vendor, the sale, lots and auction date, why (damaged in transit, missing parts, described incorrectly, lost…), what they wrote and their photos. Work it through: being looked at, waiting for the item back, agreed to pay, paid, declined or closed; who is dealing with it; refund, return or payout; the lots filled from BC with the refund worked out (a % of hammer + 27% commission, % of hammer only, or a set amount, plus postage); the accounts ref code; paid; and Complete for accounts. Filter, search and export the list.",
    also: [
      "refunds", "refund requests", "refund log", "refund form", "part refund", "partial refund", "return request", "returns log",
      "customer refund", "buyer refund", "vendor payout", "payout to vendor", "refund complete for accounts", "damaged in transit refund",
    ],
  },
  {
    name: "Paid, not collected (Accounts)", href: "/tools/accounts/uncollected", app: "ACCOUNTS", adminOnly: true,
    what: "Accounts → 📦 Paid, not collected (admins only): the buyers who have paid for their lots but haven't collected them. Filled automatically from BC every morning at 08:30 — a lot sold to them, on an invoice BC shows as paid in full, still not collected 28 days (4 weeks) after it was paid, one case per invoice, marked From BC — and 🔄 Check BC now runs the same check straight away with your own BC sign-in (it only reads BC, and Stop stops it part-way, keeping what it saved); the line at the top says when BC was last checked and what it found. A case from BC shows 'Paid by' (the day BC settled the invoice) and lists its lots live from BC with where BC has each one now, and closes itself when BC shows them collected (ticked, or scanned to a location like COLLECTED or SHIPPED; a lot at MISSING or QUERY isn't charged and the case says to check it). Tiles show the open cases, lots and money waiting, the longest wait and the chases due; filter by status and by how long they've waited, search by name, buyer number, sale or invoice, and export the list. Add a buyer by hand too, then open any case to change its details, log a call, email, letter or note with the next chase date, set the date storage charges start from, and move it on — waiting, been in touch, collection or delivery arranged, storage charges apply, collected (which closes it), or closed another way (with a reason).",
    also: [
      "paid not collected", "paid but not collected", "paid and not collected", "paid but uncollected",
      "paid not collecting", "paid but not collecting", "paid and not collecting", "paid but haven t collected",
      "uncollected lots", "uncollected paid lots", "paid uncollected lots", "uncollected buyers", "uncollected purchases",
      "buyers not collecting", "buyers who haven t collected", "chase uncollected buyers", "chasing uncollected buyers",
      "storage charges for uncollected lots",
      "paid over 4 weeks not collected", "paid 4 weeks ago not collected", "check bc for uncollected buyers",
    ],
  },

  // ── Reports & people ────────────────────────────────────────────────────────
  {
    ask: "How many lots have we done?",
    name: "Cataloguing Reports", href: "/tools/reports", app: "REPORTS",
    what: "How much each cataloguer has done over a period, with charts and printable PDFs.",
    also: ["performance", "how many lots", "per cataloguer", "league table"],
  },
  {
    name: "Cataloguing Reports → Activity", href: "/tools/reports/activity", app: "REPORTS",
    what: "Time accounted for during cataloguing, and the reasons people gave for gaps.",
    also: ["time", "breaks", "unaccounted"],
  },
  {
    name: "Marketing Reports", href: "/tools/marketing-reports", app: "MARKETING_REPORTS",
    what: "Website analytics — visitors, sources, pages, devices, countries — plus the saved Business Plan.",
    also: ["google analytics", "website traffic", "business plan"],
  },
  {
    name: "Manager Portal", href: "/tools/manager-portal", app: "MANAGER_PORTAL",
    what: "Sale progress and projected finish dates, and which departments cover which sales.",
    also: ["will we finish in time", "progress", "departments"],
  },
  {
    name: "Sale Statistics", href: "/tools/sale-statistics", app: "SALE_STATISTICS",
    what: "How a sale performed.",
    also: ["results", "how did it sell"],
  },

  // ── Operations ──────────────────────────────────────────────────────────────
  // ⚠ These three have NO `app` on purpose: their Hub cards are `allUsers: true`, so everyone
  // signed in can already open them. A destination's gate must match its card — gating one of
  // these behind an app key hid it from people who can plainly see it on their home page, which
  // is how the first version of this map was wrong (caught by the permission test, 2026-09-02).
  {
    ask: "How do I post a parcel?",
    name: "Packing / Dispatch", href: "/tools/packing",
    what: "Royal Mail dispatch — book parcels, print labels, and the packers' barcode sheet.",
    also: ["post", "royal mail", "dispatch", "labels"],
  },
  {
    ask: "How do I watch a live sale?",
    name: "Auction Monitor", href: "/tools/auction-monitor",
    what: "Watch a live sale as it runs, with push alerts on the rules you set.",
    also: ["live sale", "watch the auction", "alerts"],
  },
  {
    ask: "Who do I tell about a broken printer?",
    name: "IT Help", href: "/tools/it-help",
    what: "The IT knowledge base and its own AI chat, for computer and equipment problems rather than 'where do I go' questions.",
    also: ["printer", "password", "broken", "it problem"],
  },
  // ── IT Tools ────────────────────────────────────────────────────────────────
  {
    ask: "How do I record my screen?",
    name: "IT Tools → Screen Recorder", href: "/tools/it-tools?tab=recorder",
    what: "Record any screen, window or tab from the browser and keep the video in the Hub — for showing a fault, recording an Auto Clerk test, or a walk-through of the website. Computer only; the iPads can't do it.",
    also: ["screen recording", "record the screen", "screen capture", "video of my screen", "record a test", "recordings"],
  },
  {
    ask: "How do I take a screenshot?",
    name: "IT Tools → Screenshots", href: "/tools/it-tools?tab=screenshots",
    what: "A snipping tool that keeps the picture in the Hub: capture a screen, paste one in with Ctrl+V or upload it, crop it, draw arrows, boxes, numbers, ticks and text on it, then save it, copy it into an email, or download it.",
    also: ["snip", "snipping tool", "screen grab", "screenshot", "annotate", "mark up a screenshot", "draw on a screenshot", "highlight a screenshot"],
  },
  {
    ask: "Where do I download the free Photoshop or Word alternatives?",
    name: "IT Tools → Craft Apps", href: "/tools/it-tools?tab=craft-apps",
    what: "Installers for the Craft App Suite — free, open-source stand-ins for Photoshop, Illustrator, Premiere, Lightroom, Acrobat, After Effects, InDesign, Figma, Word, PowerPoint, Excel, AutoCAD and Pro Tools — plus the ArtCraft Launcher and the Vectis build of ArtCraft. Kept in the Hub's own storage, so they stay available whatever happens to the projects online.",
    also: ["craft apps", "photocraft", "wordcraft", "gridcraft", "artcraft", "artcraft launcher", "install photoshop alternative", "free office apps", "installer", "msi"],
  },
  // ── Databases ───────────────────────────────────────────────────────────────
  {
    ask: "Where are the old sale results?",
    name: "Databases → ABC Database", href: "/databases/archive",   // no app key: Databases is gated on sign-in only
    what: "Every lot sold through ABC, the system before Business Central — back to 1999 — with the description, estimate, hammer price, photo and a link to the lot on vectis.co.uk. Search by words in the description, sale, year or price.",
    also: ["ABC", "abc database", "lot archive", "archive", "old results", "what did it sell for", "past prices", "pre-BC", "old system", "historic lots", "sold prices"],
  },
  {
    ask: "Where can I look up what a lot sold for since we moved to Business Central?",
    name: "Databases → BC Database", href: "/databases/bc",   // no app key: Databases is gated on sign-in only
    what: "Every lot sold through Business Central — sale, lot, estimate and hammer from the nightly BC sync, with the full description, photo and a link to the lot on vectis.co.uk matched from the website. Search by words in the description, sale, year or price.",
    also: ["BC database", "business central lots", "recent results", "what did it sell for", "sold prices", "current system", "BC lots"],
  },
  {
    ask: "Where can I see the cover picture for a past sale?",
    name: "Databases → Sales", href: "/databases/sales",   // no app key: Databases is gated on sign-in only
    what: "Every sale on vectis.co.uk, ABC and Business Central alike, with its cover picture (the auction calendar's hero image), date, code and lot count, and a link to its lots in the ABC or BC Database.",
    also: ["sales database", "sale pictures", "hero image", "auction picture", "cover picture", "auction calendar", "past sales", "list of sales", "sale list"],
  },
  {
    ask: "Where are the website's news articles kept?",
    name: "Databases → News", href: "/databases/news",   // no app key: Databases is gated on sign-in only
    what: "Every News & Stories article from vectis.co.uk — title, full text, category, tags, date and cover picture — collected on an office machine and loaded here; the test website's News & Stories pages read it. Search by words, filter by category or year.",
    also: ["news", "news and stories", "news stories", "articles", "blog", "website news", "news database", "stories", "press"],
  },
  {
    ask: "Where are the website's department pages kept?",
    name: "Databases → Departments", href: "/databases/departments",   // no app key: Databases is gated on sign-in only
    what: "The website's 28 department pages — the Departments menu, each page's banner, \"sell with us\" copy and highlighted lots, and the words used to find its news and past sales — collected on an office machine and loaded here; the test website's Departments menu and pages read it.",
    also: ["departments", "department pages", "department", "sell with us pages", "department menu", "highlighted lots"],
  },
  {
    ask: "How do I change a page on the test website?",
    name: "Website → Pages", href: "/website/pages", adminOnly: true,   // the Website card is open to all; the editor checks ADMIN itself
    what: "The page editor for the TEST website — every page (home, auction calendar, departments, how to bid, FAQ, contact, careers, terms…) built from blocks you drag in and edit: sections, columns, headings, text, pictures, buttons, videos, fold-outs, tables, plus live blocks that show upcoming sales, news and a department's lots straight from the Hub. Changes save as a draft; the site changes only when you press Publish, and every publish is kept so a page can be put back.",
    also: ["page editor", "edit the website", "website pages", "change the website", "edit a page", "new page", "website editor", "cms", "page builder"],
  },
]

/** Every AppKey mentioned in the map really exists. Cheap guard against a typo'd key
 *  silently making an entry invisible to everyone (a wrong key never matches a permission). */
export function assertHelpMap(): string[] {
  const valid = new Set(ALL_APPS.map(a => a.key as string))
  return DESTINATIONS
    .filter(d => d.app && !valid.has(d.app))
    .map(d => `${d.name}: unknown app key "${d.app}"`)
}

export type HelpContext = {
  destinations: Destination[]
  /** The Hub cards this person can open, so "what can I do here" is answerable too. */
  cards: { name: string; href: string; what: string }[]
}

/**
 * Everything this person is allowed to be told about.
 *
 * ⚠ This is the security boundary. A destination survives only if the person passes
 * `hasAppAccess` for its app AND, where the app has per-section permissions, has that section.
 * Entries with no `app` are open to anyone signed in.
 */
export function allowedHelpContext(
  role: string,
  allowedApps: string[],
  appPermissions: Parameters<typeof getAllowedSections>[1],
): HelpContext {
  const canOpen = (app?: AppKey, section?: string): boolean => {
    if (!app) return true
    if (!hasAppAccess(role, allowedApps, app)) return false
    if (!section) return true
    const sections = getAllowedSections(role, appPermissions, app)
    return sections === null || sections.includes(section)
  }

  const destinations = DESTINATIONS.filter(d => canOpen(d.app, d.section) && (!d.adminOnly || role === "ADMIN"))

  const cards = APP_CARD_DEFS
    .filter(c => !c.comingSoon)
    .filter(c => c.allUsers || (c.appKey ? hasAppAccess(role, allowedApps, c.appKey) : role === "ADMIN"))
    .map(c => ({ name: c.defaultLabel, href: c.href, what: c.defaultDescription }))

  return { destinations, cards }
}

/** Up to three questions THIS person could usefully ask.
 *
 *  ⚠ Never hardcode these in the component: a fixed list offered Ben Kennington — a cataloguer
 *  with only CATALOGUING — "Where do I go to do an overnight run?", a tool he cannot open
 *  (Jordan, 2026-09-02). The suggestions have to come from the same filtered set as the answers.
 *
 *  ⚠⚠ And "can open" is not "would ever want". Three tools are open to EVERYONE signed in
 *  (Packing, Auction Monitor, IT Help, whose Hub cards are `allUsers`), so simply taking the
 *  first three allowed offered a cataloguer "How do I post a parcel?" (Jordan: "Why parcels?").
 *  Questions about a tool the person was deliberately GRANTED come first — those describe their
 *  job — and the universal ones only fill a gap. */
export function suggestedQuestions(ctx: HelpContext): string[] {
  const asks = (list: Destination[]) => list.map(d => d.ask).filter((q): q is string => !!q)
  const granted = asks(ctx.destinations.filter(d => d.app))   // gated → someone chose to give it
  // ⚠ Show FEWER rather than pad. A cataloguer with two granted questions was having a third
  // added from the everyone-can-open tools, which is how "How do I post a parcel?" turned up
  // under a cataloguer's Help box. Two relevant suggestions beat three with a stranger in them.
  if (granted.length > 0) return granted.slice(0, 3)
  // Nothing granted at all — the universal tools are genuinely all they have.
  return asks(ctx.destinations.filter(d => !d.app)).slice(0, 3)
}

// ─── Asking about something you cannot open ─────────────────────────────────
// Jordan, 2026-09-02: "if he asks about it it needs to block him". Leaving it to the model to
// say "I can't see a tool for that" is both vague and a matter of the model's mood — a question
// that plainly means a tool this person does not have gets a fixed, honest refusal instead, and
// never reaches the AI at all.

function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter(t => t.length > 2)
}

/** How strongly a question points at one destination.
 *
 *  ⚠ The `also` keywords carry the weight, not the name. A name part is often a generic
 *  fragment — "A sale → Manage Lots" contains "a sale" — and scoring those like real keywords
 *  made "where do I add photos to a sale" match Manage Lots instead of Photography, so the block
 *  named the wrong tool (caught in testing, 2026-09-02). Keywords describe what someone would
 *  actually type; names are only a weak tie-breaker. */
function matchScore(question: string, d: Destination): number {
  const q = " " + question.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ") + " "
  let score = 0

  // What people actually ask — the strong signal.
  for (const phrase of d.also ?? []) {
    if (q.includes(` ${phrase.toLowerCase()} `)) score += phrase.includes(" ") ? 6 : 3
  }

  // The name, weakly, and with the leading article dropped so "a sale" cannot carry a match.
  for (const raw of d.name.toLowerCase().split("→")) {
    const part = raw.trim().replace(/^(a|an|the)\s+/, "")
    if (part.length > 3 && q.includes(` ${part} `)) score += 2
  }

  const qt = new Set(tokens(question))
  for (const t of tokens(d.name)) if (qt.has(t)) score += 1
  return score
}

/**
 * The destination a question is asking about that this person may NOT open — or null.
 *
 * ⚠ Deliberately conservative: it only blocks when the best forbidden match clearly beats
 * anything they CAN open. A question that fits both ways is answered from what they have, never
 * refused, because a help box that wrongly says "you don't have access" is worse than a vague one.
 */
export function blockedDestination(question: string, ctx: HelpContext): Destination | null {
  const allowedNames = new Set(ctx.destinations.map(d => d.name))
  const best = (list: Destination[]) =>
    list.reduce<{ d: Destination | null; s: number }>(
      (acc, d) => { const s = matchScore(question, d); return s > acc.s ? { d, s } : acc },
      { d: null, s: 0 },
    )

  const forbidden = best(DESTINATIONS.filter(d => !allowedNames.has(d.name)))
  if (!forbidden.d || forbidden.s < 3) return null          // not clearly about anything
  const allowed = best(ctx.destinations)
  return forbidden.s > allowed.s ? forbidden.d : null
}

/** The context as the text the model reads. Kept stable and boring so Claude can cache it. */
export function helpContextText(ctx: HelpContext): string {
  const sections = APP_SECTIONS as Record<string, { key: string; label: string }[]>
  const lines: string[] = []

  lines.push("PLACES IN THE VECTIS HUB THIS PERSON CAN OPEN")
  lines.push("")
  for (const d of ctx.destinations) {
    lines.push(`- ${d.name} — ${d.href}`)
    lines.push(`  ${d.what}`)
    if (d.also?.length) lines.push(`  Also asked as: ${d.also.join(", ")}`)
  }

  lines.push("")
  lines.push("HUB CARDS THIS PERSON SEES ON THE HOME PAGE")
  for (const c of ctx.cards) lines.push(`- ${c.name} — ${c.href} — ${c.what}`)

  const shown = new Set(ctx.destinations.map(d => d.app).filter(Boolean) as string[])
  const withSections = Object.entries(sections).filter(([app]) => shown.has(app))
  if (withSections.length) {
    lines.push("")
    lines.push("SECTIONS WITHIN THOSE TOOLS")
    for (const [app, list] of withSections) {
      lines.push(`- ${app}: ${list.map(s => s.label).join(", ")}`)
    }
  }

  return lines.join("\n")
}
