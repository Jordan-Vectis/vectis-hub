// BC Warehouse user guide — single source of truth.
//
// This content is rendered in two places:
//   1. The 📖 Guide tab on /tools/bc-warehouse (guide-tab.tsx)
//   2. The per-section PDF download (/api/bc/warehouse-guide-pdf?section=<id>)
// Edit HERE and both stay in step. The content was written from a full read of
// each tab's code (2026-07-02) — if a tab's behaviour changes, update its entry.

export type GuideSection = {
  id: string
  title: string
  icon: string
  intro: string
  dataSource: string
  shows: string[]
  controls: { name: string; what: string }[]
  howTo: { task: string; steps: string[] }[]
  tips: string[]
  gotchas: string[]
}

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: "home",
    title: "Home & the sync bar",
    icon: "🏠",
    intro:
      "The Home screen is the front page of the BC Warehouse tool — a grid of cards, one per section, so you can pick where to go. You can drag the cards into your own preferred order. The thin grey bar at the very bottom of every screen is the sync bar, which tells you how fresh the warehouse data is.",
    dataSource:
      "The Home screen itself shows no warehouse data — the card order is saved per browser, per device. The sync bar reads from the tool's local copy of the Business Central data: it shows how many items are stored and when they were last refreshed.",
    shows: [
      "A grid of section cards, each with an icon, a name, a short description and an \"Open →\" button.",
      "Card colours are just section branding — they don't mean anything about status. The grey cards (Data Sync, DB Explorer) are the utility sections.",
      "The sync bar at the bottom of every screen: \"N items in DB\", the last sync time, a pulsing yellow \"Syncing…\" while a refresh is running, and a blue \"Sync now\" link.",
      "The tab bar along the top is hidden on Home — it appears once you open a section, with a ⌂ button to come back.",
      "A blue \"🔗 Connect to Business Central\" banner across the top if you haven't signed in to Business Central with your own Microsoft account yet — some sections need that personal sign-in.",
    ],
    controls: [
      { name: "Open [Section] → (on each card)", what: "Opens that section. Greyed out while Reorder mode is on." },
      { name: "⠿ Reorder / ✓ Done (top right)", what: "Turns card-dragging on and off. While on, drag cards to rearrange the grid — the order saves automatically and is remembered on this browser. Click ✓ Done to finish." },
      { name: "Sync now (sync bar, bottom of screen)", what: "Manually refreshes the warehouse data from Business Central. Greyed out while a refresh is already running." },
      { name: "Sign in with Microsoft (blue banner)", what: "Appears when you haven't connected Business Central with your own account. One-off sign-in — it's needed for Location History, Collections Due and Unsold Items, which look things up in Business Central as you." },
    ],
    howTo: [
      {
        task: "Put your most-used sections first",
        steps: [
          "Click ⠿ Reorder in the top-right corner.",
          "Drag the cards into your preferred order.",
          "Click ✓ Done — the order is saved automatically.",
        ],
      },
      {
        task: "Check the data is up to date",
        steps: [
          "Look at the sync bar at the very bottom — it shows the item count and last sync time.",
          "If it looks old, click \"Sync now\" and wait for the yellow \"Syncing…\" to disappear.",
        ],
      },
    ],
    tips: [
      "You rarely need \"Sync now\" — the tool refreshes itself automatically when opened if the data is more than 15 minutes old.",
      "Your card order is per browser and per device — rearranging on the office PC won't change an iPad.",
      "\"Last sync\" is the time of the last completed refresh of the main item list.",
    ],
    gotchas: [
      "First-time use: if the database is completely empty, the whole tool is replaced by a first-time setup screen until the initial download from Business Central completes.",
      "\"0 items in DB\" means nothing has been synced yet — most sections will be empty until a sync completes.",
      "While Reorder mode is on you can't open sections — click ✓ Done first.",
    ],
  },

  {
    id: "heatmap",
    title: "Location Heatmap",
    icon: "🗺️",
    intro:
      "A visual map of the warehouse showing how full every shelf is. Each shelf appears as a coloured square — green means nearly empty, red means very full — so you can see at a glance where stock is concentrated, find free shelf space, and click any shelf to see exactly what's on it.",
    dataSource:
      "Reads the tool's local copy of the Business Central data — not a live query. The map reflects the last Data Sync, so stock moved since then won't show until the next refresh.",
    shows: [
      "A stats bar at the top: total locations, occupied, empty, total items and total totes (the figures follow whatever filters are on).",
      "The colour legend: Empty (grey), 1–2 (green), 3–5 (yellow), 6–9 (orange), 10+ (red). A small cyan dot on a square means at least one tote is on that shelf.",
      "One panel per aisle. Bays run as columns (letters along the bottom); shelves as rows, with shelf 1 at the bottom — just like the physical racking. Each square shows its item + tote count.",
      "Hovering a square shows the location code and the item/tote split; clicking it loads the full contents into the right-hand details panel.",
      "An \"Other locations\" section at the bottom for codes that don't fit the aisle/bay/shelf pattern (only shown on All aisles).",
      "An orange \"⚠ Unlocated · N items\" chip when items or totes have no recorded location.",
    ],
    controls: [
      { name: "Aisle dropdown", what: "Show one aisle on its own, or all aisles. Choosing one aisle also hides the Other locations section." },
      { name: "Show empty (tick-box)", what: "Ticked by default. Untick to hide empty shelf squares (gaps are left so the columns still line up)." },
      { name: "Filter pills: All / Active / Catalogued totes (located) / Barcodes only / Totes only", what: "Change what is counted on the map. Active = not yet catalogued; Barcodes only = items with a barcode, no totes; Totes only = totes, no items. Changing a pill reloads the map and clears the selected shelf." },
      { name: "Auction dropdown", what: "Narrow the map to one auction's items. Note this hides totes entirely while active." },
      { name: "✕ Clear filters", what: "Appears when a filter or auction is active — resets everything back to All." },
      { name: "Shelf squares / Other location chips", what: "Every square and chip is clickable — the right-hand panel lists that location's totes (green Catalogued / amber Active badges) and items (auction code, description, barcode, lot, tote, bin, last-scanned date)." },
      { name: "⚠ Unlocated chip", what: "Shows the count of items/totes with no recorded location." },
    ],
    howTo: [
      {
        task: "Find out what is on a particular shelf",
        steps: [
          "Find the aisle panel (or pick the aisle from the dropdown).",
          "Find the square where the bay letter (bottom) meets the shelf number (left) — hover to confirm the location code.",
          "Click the square — the right-hand panel lists every tote and item recorded there.",
        ],
      },
      {
        task: "Find empty shelf space to put stock away",
        steps: [
          "Make sure \"Show empty\" is ticked.",
          "Look for grey squares (nothing recorded) or green ones (1–2 items).",
          "Click a square to double-check it really is empty.",
        ],
      },
      {
        task: "See where an auction's items are stored",
        steps: [
          "Pick the auction code from the Auction dropdown.",
          "The map redraws showing only that auction's items.",
          "Click any coloured square to list the individual items.",
        ],
      },
    ],
    tips: [
      "Colours: grey = empty, green = 1–2, yellow = 3–5, orange = 6–9, red = 10+. The number is the combined item + tote count.",
      "The cyan dot means totes — hover it for the tote count.",
      "Grids read like the real racking: shelf 1 is the bottom row, higher shelves stack upwards.",
      "The stats bar recalculates for the active filters — a quick way to count, say, shelves holding uncatalogued stock.",
    ],
    gotchas: [
      "The map shows the last sync, not live data — run a Data Sync if stock has just been moved.",
      "Clicking ⚠ Unlocated only reports the count — it can't list the unlocated stock itself.",
      "An auction filter hides totes, and \"Catalogued totes (located)\" hides items — counts drop accordingly, which can look like stock has vanished.",
      "Changing a filter clears your selected shelf — re-click the square afterwards.",
      "The details panel lists at most 500 items and 500 totes per location.",
    ],
  },

  {
    id: "sale-checklist",
    title: "Sale Checklist",
    icon: "📋",
    intro:
      "A per-auction stock check. For every auction that items are assigned to, it lists each item and shows whether the warehouse has a recorded location for it (located) or not (missing). Use it before a sale to confirm every lot can actually be found.",
    dataSource:
      "Reads the tool's local copy of the Business Central data — no live query, so it loads fast, but everything shown is only as fresh as the last Data Sync. Data is fetched once when the tab opens; reload the page to re-fetch.",
    shows: [
      "One collapsible card per auction, newest first. The header shows the auction code, name, date and three counts: located (green), missing (red, only when something is missing) and total (grey).",
      "Clicking a card expands a table: Unique ID, Barcode, Lot, Description, Location, Vendor, Status.",
      "Rows with no location have a red-tinted background; the Location column shows location · bin · tote in green when found, or \"Missing\" in red.",
      "The Status column shows \"Withdraw\" in orange for lots flagged for withdrawal and \"Collected\" in blue for items already collected.",
      "Artist names appear in yellow before the description; blank values show as a dash (—).",
    ],
    controls: [
      { name: "Search box", what: "Filters the auction list as you type — it matches auction codes and names only (NOT barcodes or lot numbers inside auctions)." },
      { name: "All / Located / Missing buttons", what: "All shows everything. Located shows only items with a location; Missing shows only items without one. While Located or Missing is on, auctions with no matching items disappear from the list entirely." },
      { name: "Auction card header", what: "Click to expand or collapse the item table. Only one auction can be open at a time — opening another closes the first." },
    ],
    howTo: [
      {
        task: "Check what is still missing before a sale",
        steps: [
          "Type the auction code or name into the search box.",
          "Look at the red \"X missing\" count on the card header.",
          "Click the Missing filter, then expand the card — you now see only the items that need finding.",
          "Use the Barcode, Lot and Description columns to identify each one.",
        ],
      },
      {
        task: "Find where an auction's items are shelved",
        steps: [
          "Search for the auction and expand its card.",
          "Read the green Location column — location · bin · tote, with blank parts left out.",
        ],
      },
    ],
    tips: [
      "The counts on each card header always reflect the whole auction, even when a filter is on — the filter only changes which rows appear.",
      "Colours: green = located, red = missing, orange = withdrawn, blue = collected, yellow = artist name.",
      "The Lot column shows the current lot number, falling back to the original one.",
    ],
    gotchas: [
      "\"Missing\" strictly means no location in the synced data — the item may be in the building but not yet scanned, or moved since the last sync.",
      "The search box does not search items — searching a barcode shows \"No auctions found\". Use Search by Location for individual items.",
      "With Located or Missing active, whole auctions can disappear from the list — switch back to All to see them.",
      "Data loads once when the tab opens — reload the page to see colleagues' scans.",
      "There are no export or print buttons on this tab — it's on-screen only.",
    ],
  },

  {
    id: "search",
    title: "Search by Location",
    icon: "🔍",
    intro:
      "Find out exactly what is sitting at a warehouse location — one specific spot, one item or tote, or a whole aisle at once. Results list both loose items and totes.",
    dataSource:
      "Reads the tool's local copy of the Business Central data — not live. If an item moved after the last Data Sync, this search still shows the old location.",
    shows: [
      "Two mode buttons (Specific search / Whole aisle), a single text box and a Search button.",
      "A summary line after each search, e.g. \"142 results in aisle A2 · 120 items · 22 totes\".",
      "A TOTES section: tote number, location (aisle mode), receipt, vendor, status and a state badge — green \"Catalogued\" or amber \"Active\".",
      "An ITEMS section: unique ID, barcode, location (aisle mode), description (artist in yellow), auction code (blue badge), lot, category and tote/bin.",
    ],
    controls: [
      { name: "Specific search (mode)", what: "The default. One box handles three kinds of code at once: a shelf location (e.g. A2A1), an item barcode (e.g. F066001) or a tote number (e.g. T001234). Exact match, capitals don't matter." },
      { name: "Whole aisle (mode)", what: "Type just an aisle (e.g. A2) to list everything on every shelf in it. Deliberately precise: A2 matches A2A1 and A2B2 but NOT A20 or A22. Adds a Location column to the results." },
      { name: "Search box", what: "Auto-capitalises as you type. Pressing Enter runs the search." },
      { name: "Search button", what: "Runs the search; shows \"Searching…\" while working." },
    ],
    howTo: [
      {
        task: "Find what is at a specific shelf",
        steps: [
          "Stay in Specific search mode.",
          "Type the location code (e.g. A2A1) and press Enter.",
          "Read the Totes and Items sections for everything recorded at that spot.",
        ],
      },
      {
        task: "Look up an item by barcode, or a tote by number",
        steps: [
          "Type the barcode (e.g. F066001) or tote number (e.g. T001234) in Specific mode.",
          "Press Enter — the item or tote appears with its location, auction and lot.",
        ],
      },
      {
        task: "List everything in a whole aisle",
        steps: [
          "Click \"Whole aisle\" and type the aisle code (e.g. A2, A10 or BENCH).",
          "Press Enter — results include a Location column showing which shelf each thing is on.",
        ],
      },
    ],
    tips: [
      "You never need to worry about capitals — everything is upper-cased automatically.",
      "In Specific mode you don't have to say what kind of code it is — the search checks locations, barcodes and tote numbers at once.",
      "State badges: green = Catalogued, amber = Active (not yet catalogued).",
    ],
    gotchas: [
      "Specific mode needs the full, exact code — a partial location like A2 finds nothing (switch to Whole aisle for that).",
      "At most 500 items and 500 totes are returned per search — a very full aisle may be quietly truncated.",
      "Specific mode doesn't match unique IDs or lot numbers — only locations, barcodes and tote numbers.",
      "If the search fails (e.g. network), it can look like the location is genuinely empty — try again.",
      "Results only update when you press Search; switching mode clears them.",
    ],
  },

  {
    id: "location-history",
    title: "Location History",
    icon: "📍",
    intro:
      "Look up every location a tote or an individual lot has ever been moved to, using Business Central's change logs. It can also list what else moved around the same time as the most recent move — useful for tracing where a misplaced item ended up.",
    dataSource:
      "Live Business Central — both lookups query BC's change logs in real time, so no Data Sync is needed and results are as current as BC itself.",
    shows: [
      "A search panel with two mode buttons (Tote number / Barcode), a text box and a Look up button.",
      "A summary line with the BC item key and the number of movements found.",
      "A movement table: From, To (bold), Changed by (staff name resolved from their BC initials) and Date/Time — newest first, with the most recent move highlighted in blue.",
      "Empty From/To values show as an italic \"empty\" (e.g. an item's first-ever location has an empty From).",
      "A purple \"Check Similar Changes\" button below the results, with its own results table (Type badge: blue Tote / green Item) and a Print Report button.",
    ],
    controls: [
      { name: "Tote number (mode)", what: "The default — looks the tote up directly in BC's change log. Example format: T000123." },
      { name: "Barcode (mode)", what: "Two-step lookup: finds the item's BC key from the barcode first, then fetches its location changes. Slightly slower. Example format: F037458." },
      { name: "Search box + Look up", what: "Type the code and press Enter or click Look up. Exact value required — no fuzzy matching." },
      { name: "Check Similar Changes", what: "Appears once a lookup has results. Searches BC for ALL location changes (tote moves and item moves) within 5 minutes either side of this item's most recent move. Can take a while — a progress bar counts the seconds; it gives up at 55 seconds." },
      { name: "Print Report", what: "Opens a printer-friendly report of the similar-changes results in a new tab and opens the print dialogue." },
    ],
    howTo: [
      {
        task: "Find everywhere a tote has been",
        steps: [
          "Type the tote number (e.g. T000123) and press Enter.",
          "Read the table newest-first — the blue-highlighted top row is the most recent move, and its To column is where the tote should be now.",
        ],
      },
      {
        task: "Trace what else moved at the same time (mis-scan hunting)",
        steps: [
          "Look up the tote or barcode first.",
          "Click Check Similar Changes and wait for the progress bar.",
          "Review every move within ±5 minutes of the item's last move — who did it and when. Click Print Report for a paper copy.",
        ],
      },
    ],
    tips: [
      "\"Changed by\" shows the staff member's full name where the initials are recognised; unknown codes show as-is.",
      "The main history is newest-first; the similar-changes table is oldest-first (chronological).",
      "Type badge colours: blue = a whole tote was relocated, green = an individual item's location changed.",
    ],
    gotchas: [
      "Zero movements is a normal result — the item may never have been moved, or BC's change log wasn't active when it was.",
      "The similar-changes window is fixed at ±5 minutes of the MOST RECENT move — it won't find changes around older moves.",
      "The similar-changes search can be slow and times out after 55 seconds — try again in a moment if it does.",
      "If several BC records share a barcode, only the first match is used.",
      "Print Report opens a new tab — allow pop-ups if nothing appears.",
      "This tab looks things up in Business Central AS YOU — if you see the blue \"Connect to Business Central\" banner at the top, click Sign in with Microsoft first or lookups will fail.",
    ],
  },

  {
    id: "tote-data",
    title: "Tote Data",
    icon: "📦",
    intro:
      "A quick overview of all active (not yet catalogued) totes — how many there are, which categories of stock they hold, where they sit, and a full list with receipt, vendor and status.",
    dataSource:
      "Reads the tool's local copy of the Business Central data. The Refresh button re-reads the local database — it does NOT pull new data from Business Central; run a Data Sync for that.",
    shows: [
      "Three stat cards: Total Totes (active in amber, done in grey), Categories, and Largest Category.",
      "Three views via sub-tabs: By Category (blue bar chart, largest first), By Location (cyan bar chart, top 20 locations) and Raw Data (full table, sorted by tote number).",
      "Raw Data columns: Tote No (cyan), Location, Receipt, Vendor, Status — blanks show as a dash.",
    ],
    controls: [
      { name: "⟳ Refresh", what: "Reloads from the local database (not from Business Central)." },
      { name: "By Category / By Location / Raw Data sub-tabs", what: "Switch between the two charts and the full table. The Raw Data label shows the tote count." },
      { name: "Show all / Show fewer (bottom of the table)", what: "The table shows 150 rows at first — click Show all for the rest (the list itself is capped at 500 totes)." },
    ],
    howTo: [
      {
        task: "Check how much uncatalogued stock is waiting, by category",
        steps: [
          "Read the stat cards for the totals.",
          "On the By Category view, the longest bar at the top is the biggest backlog.",
        ],
      },
      {
        task: "Look up a specific tote",
        steps: [
          "Click the Raw Data sub-tab.",
          "Scan down the tote-number-sorted table (click Show all if needed).",
          "Read the Location, Receipt, Vendor and Status columns.",
        ],
      },
    ],
    tips: [
      "Amber numbers always mean active (uncatalogued) totes; grey means done.",
      "Both charts are largest-first — the top row is always the biggest.",
      "There's no search box here — to search totes by number, location or vendor, use the DB Explorer tab.",
      "\"No Reserve\" statuses are deliberately shown as a dash — they're the norm, not information.",
    ],
    gotchas: [
      "Data is only as fresh as the last Data Sync — Refresh does not fetch anything new from Business Central.",
      "The Raw Data list caps at 500 totes — with more than that, the highest tote numbers won't appear (the stat-card counts are still correct).",
      "The By Location chart shows only the top 20 locations, and totes with no recorded location are excluded from it.",
      "A tote with no synced items in it won't appear in the category chart.",
    ],
  },

  {
    id: "collections-due",
    title: "Collections Due",
    icon: "🚚",
    intro:
      "Finds items in your chosen aisles that have a collection docket number — stock due to be dispatched but not yet collected — and produces printable pick-lists so pickers can pull those items from the shelves.",
    dataSource:
      "Live Business Central query every time you press Search (one query per aisle) — no Data Sync needed, and results are as fresh as BC at that moment.",
    shows: [
      "An \"Aisle prefixes\" box, a Search button and a \"Group by docket\" tick-box.",
      "A summary line (\"N items found\", plus the docket count when grouped).",
      "Flat view: one table — Location, Barcode, Description, Collection No. (in green) — sorted by location then docket, the natural walking order.",
      "Grouped view: one panel per collection docket with its item count.",
      "A green Download PDF button once there are results.",
    ],
    controls: [
      { name: "Aisle prefixes (text box)", what: "Type which aisles to search, comma-separated (e.g. A39, A40, A41). These are prefixes — A39 catches A39A1, A39B5 and so on. Spaces, full stops, semicolons, slashes and pipes also work as separators; capitals don't matter. Enter runs the search." },
      { name: "Search", what: "Runs the live BC query. Shows \"Searching BC…\" while working; disabled until at least one aisle is typed." },
      { name: "Group by docket (tick-box)", what: "Regroups the on-screen results into one panel per docket. Display-only — no new search, and it doesn't change the PDF." },
      { name: "Download PDF", what: "Downloads a ready-to-print pick-list: one report per aisle, each with the Vectis logo, date, aisle code, item count, the item table with a tick-box beside every row, and an aisle total. Each aisle starts on its own page so different pickers can take different aisles." },
    ],
    howTo: [
      {
        task: "Produce a pick-list of items awaiting collection",
        steps: [
          "Type the aisles into the box, e.g. A39, A40, A41.",
          "Click Search (or press Enter) and check the count and table.",
          "Click Download PDF and print it — hand each aisle's pages to the picker covering that aisle.",
        ],
      },
      {
        task: "See which dockets the items belong to",
        steps: [
          "Run a search, then tick \"Group by docket\".",
          "Results regroup into one panel per docket number with its item count.",
        ],
      },
    ],
    tips: [
      "Aisle entries are prefixes, not exact locations — A39 finds every bay and shelf in the aisle.",
      "Green text in the results is the collection docket number.",
      "The PDF always uses the flat per-aisle layout — the Group by docket toggle is on-screen only.",
    ],
    gotchas: [
      "This tab queries Business Central AS YOU — if the blue \"Connect to Business Central\" banner is showing, sign in with Microsoft first. A Data Sync won't help this tab (and isn't needed).",
      "Only items whose collection number contains \"COL\" are returned — an item without a docket never appears here, by design.",
      "If BC times out for one aisle but not others, the failed aisle's items are silently missing — a suspiciously low count for a busy aisle may mean one query failed.",
      "Results are a snapshot of the moment you searched — the PDF re-queries BC when you download it, so it may differ slightly.",
      "Items whose location doesn't match any typed aisle land in an \"Other\" report in the PDF rather than being dropped.",
    ],
  },

  {
    id: "unsold-items",
    title: "Unsold Items",
    icon: "🏷️",
    intro:
      "Finds every item in your chosen aisles with a hammer price of zero — passed at auction or not yet sold — so unsold stock can be pulled for return to vendors or re-allocation. Works just like Collections Due.",
    dataSource:
      "Live Business Central query every time you press Search — no Data Sync needed; results are current at that moment.",
    shows: [
      "An \"Aisle prefixes\" box, Search button and a \"Group by vendor\" tick-box.",
      "Flat view: Location, Barcode, Description, Vendor, Auction — sorted by location then barcode.",
      "Grouped view: one panel per vendor (A–Z, vendor name in green) so a picker can pull everything for one consignor in one go.",
      "A green Download PDF button once there are results.",
    ],
    controls: [
      { name: "Aisle prefixes (text box)", what: "Comma-separated aisle prefixes (e.g. A50, A51, A52) — A50 matches everything starting A50. Other separators and lower-case also accepted. Enter runs the search." },
      { name: "Search", what: "Runs the live BC query for items with Hammer Price = 0 in those aisles." },
      { name: "Group by vendor (tick-box)", what: "Switches between the flat table and one panel per vendor. Can be toggled any time without re-searching." },
      { name: "Download PDF", what: "Downloads a Vectis-branded pick-list: one report per aisle, with vendor shown per item and a DONE tick-box column." },
    ],
    howTo: [
      {
        task: "Print a pick-list of unsold items",
        steps: [
          "Type the aisle prefixes, e.g. A50, A51, A52.",
          "Click Search and check the results.",
          "Click Download PDF and print — each aisle gets its own report with tick-boxes.",
        ],
      },
      {
        task: "Pull all unsold items for one vendor",
        steps: [
          "Search the relevant aisles.",
          "Tick \"Group by vendor\" — results collapse into one panel per vendor, A–Z.",
          "Work through that vendor's panel; each row shows the exact location and barcode.",
        ],
      },
    ],
    tips: [
      "To narrow to one bay, type a fuller prefix (e.g. A50B).",
      "A dash in Vendor or Auction just means BC has nothing recorded for that field.",
      "Results are sorted by location then barcode — a natural walking order.",
    ],
    gotchas: [
      "\"Hammer price = 0\" catches both items passed at auction AND items simply not yet sold — the tab cannot tell them apart.",
      "If some aisle queries fail but one succeeds, the screen shows the successful results with no warning about the failed aisles.",
      "The PDF re-queries BC at download time, so it may differ slightly from the screen.",
      "Nothing is remembered between visits — leaving the tab means searching again.",
      "This tab queries Business Central AS YOU — if the blue \"Connect to Business Central\" banner is showing, sign in with Microsoft first; there is no local fallback.",
    ],
  },

  {
    id: "data-sync",
    title: "Data Sync",
    icon: "🔄",
    intro:
      "Keeps the warehouse tool's local database up to date by pulling items, current lot numbers, location scans, tote records and auction names from Business Central. Most other tabs read from this local copy — this tab is where you check how fresh it is and refresh it manually.",
    dataSource:
      "The bridge between the two systems: every sync queries Business Central live and writes the results into the local database. Normal syncs are incremental (only changed records); Full re-syncs re-fetch everything. The tool also auto-syncs itself when opened if the data is over 15 minutes old.",
    shows: [
      "Six stat cards: Items in DB (with tote count), then one card per sync source — Receipt Lines, Auction Lines, Change Log, Totes, Active Totes — each showing when it last ran (\"5m ago\", \"never\") and how many records it processed.",
      "A \"Shipping column coverage\" panel — how many items have a collection number and size classification (these feed the Shipping report).",
      "While a sync runs: a yellow spinner with the stage name, batch count, items processed and an elapsed timer. Then a green \"✓ Finished\" or red \"✗ Stopped\" line.",
      "An Activity log (terminal-style): grey = info, green = success, yellow = warning, red = error.",
      "A Raw BC responses feed below it — technical, for diagnosing syncs that stop early.",
    ],
    controls: [
      { name: "⟳ Run sync now (blue)", what: "Incremental sync of all six stages in order: Receipt Lines → Auction Lines → Change Log → Totes → Active Totes → Auction Names. Only changed records are fetched, so it's usually quick." },
      { name: "⤓ Full re-sync (amber)", what: "Same stages but re-fetches every record. Asks for confirmation first — it can take 15+ minutes." },
      { name: "⛔ Cancel", what: "Appears while a sync runs. The current batch finishes first, then the sync stops." },
      { name: "⟳ Sync / ⤓ Full (on each source card)", what: "Sync just that one source — quicker than a full re-sync when only one kind of data looks wrong. A Full Receipt Lines re-sync walks the entire ~186,000-row table and can take 5+ minutes. A Full Totes re-sync clears the local tote table first." },
      { name: "Clear (above each log)", what: "Empties that log panel — doesn't affect the sync itself." },
      { name: "Sync now (bottom bar, every tab)", what: "Starts a background incremental sync without opening this tab." },
      { name: "Start initial sync (first-time screen)", what: "Only shown when the database is empty — downloads everything, with a live counter. Leave the tab open until \"✓ Sync complete\"." },
    ],
    howTo: [
      {
        task: "Refresh the data before starting work",
        steps: [
          "Glance at the source cards — \"5m ago\" means it's already fresh (the tool auto-syncs when opened if over 15 minutes old).",
          "If it looks old, click ⟳ Run sync now.",
          "Wait for the green ✓ Finished message.",
        ],
      },
      {
        task: "Fix missing or out-of-date items",
        steps: [
          "If one kind of data looks wrong, use the ⤓ Full button on just that card (e.g. Receipt Lines if items are missing; Totes if tote locations are wrong).",
          "Confirm the warning — a full Receipt Lines re-sync can take 5+ minutes.",
          "If problems persist everywhere, use the amber ⤓ Full re-sync (15+ minutes) and leave the tab open.",
        ],
      },
    ],
    tips: [
      "Blue ⟳ buttons are quick incremental refreshes; amber ⤓ buttons re-fetch everything and always ask first.",
      "\"never\" on a card means that source has never completed a sync.",
      "You rarely need this tab day-to-day — auto-sync plus the bottom-bar Sync now cover normal use.",
      "Failed batches retry up to 3 times automatically before giving up.",
      "Use the Shipping column coverage panel to check the Shipping report's columns are fully fed.",
    ],
    gotchas: [
      "Only one sync can run at a time — all sync buttons grey out while one is running.",
      "Incremental syncs can't detect deletions — if something looks missing, only a Full re-sync will fix it.",
      "Stages 3–6 are best-effort: if one fails the sync still reports success with only a yellow warning line — check the log if location scans or totes look stale.",
      "If Business Central isn't connected at all, syncs fail with a connection error — use the blue \"Connect to Business Central\" banner (Sign in with Microsoft) to connect.",
      "The activity log only records syncs started from this tab — background auto-syncs don't write to it.",
      "Starting a new sync wipes the logs — copy anything you need first.",
    ],
  },

  {
    id: "db-explorer",
    title: "DB Explorer",
    icon: "🔎",
    intro:
      "A look-under-the-bonnet tool for inspecting the raw warehouse data the Hub has copied from Business Central. Use it to check exactly what is stored for an item or tote; admins also use its maintenance buttons to fix stale auction names or wipe the cache for a fresh re-sync.",
    dataSource:
      "Searches read the local copy — results are only as fresh as the last Data Sync. The \"Refresh auction names\" button is the exception: it queries Business Central live.",
    shows: [
      "A table toggle (Warehouse Items / Warehouse Totes), a field dropdown, a search box and a Search button.",
      "A results line like \"Showing 200 of 3,412 matching rows\" with a note when capped.",
      "A raw table with the database's own column names. Empty values show as a grey \"null\"; long values are cut off — hover a cell to see the full value.",
    ],
    controls: [
      { name: "Warehouse Items / Warehouse Totes toggle", what: "Switches which table you search. Also resets the field dropdown and clears results." },
      { name: "Field dropdown", what: "Which field to match: for items — Auction Code, Unique ID, Barcode, Location, Tote No, Vendor No, Category, Description; for totes — Tote No, Location, Receipt No, Vendor No, Vendor Name." },
      { name: "Search box + Search button", what: "\"Contains\" matching, case-insensitive — f069 finds F069. Leave blank to browse the whole table. Enter runs the search. Returns at most 200 rows." },
      { name: "↻ Refresh auction names from BC", what: "Re-pulls all auction names live from Business Central and writes them into the cache — use when a sale name looks stale. Your current search re-runs automatically afterwards." },
      { name: "⚠ Clear BC data… (admins only)", what: "Opens a red confirmation panel: choose items, totes or both, type DELETE in capitals, then click Clear. Permanently wipes the chosen cache and resets the sync history so the next Data Sync re-pulls everything." },
    ],
    howTo: [
      {
        task: "Check what the database holds for an item",
        steps: [
          "Keep the toggle on Warehouse Items.",
          "Pick the field (e.g. Barcode), type the value and press Enter.",
          "Read across the row — hover truncated cells for the full value.",
        ],
      },
      {
        task: "Fix a stale sale name",
        steps: [
          "Click ↻ Refresh auction names from BC.",
          "Wait for the green tick telling you how many rows were updated.",
        ],
      },
      {
        task: "Wipe the cache for a fresh re-sync (admins only)",
        steps: [
          "Click ⚠ Clear BC data… and choose what to clear.",
          "Type DELETE in capitals and click the red Clear button.",
          "Go to Data Sync and run a fresh pull — BC-based tabs are empty until you do.",
        ],
      },
    ],
    tips: [
      "Searches match anywhere in the field and ignore capitals — part of a description works too.",
      "A grey \"null\" means the field is genuinely empty — not an error.",
      "Green messages (✓) mean success; amber or red mean something failed.",
    ],
    gotchas: [
      "Results cap at 200 rows — the results line shows the true total; narrow the search to see more specific rows.",
      "Clear BC data is permanent and empties other BC-dependent tabs (Sale Checklist, Heatmap) until the next sync completes.",
      "The Clear button stays greyed out until you type DELETE exactly, in capitals.",
      "No export, print or copy buttons — view-only apart from the two maintenance actions.",
    ],
  },

  {
    id: "location-barcodes",
    title: "Location Barcodes",
    icon: "📄",
    intro:
      "Type in a list of shelf or location codes and download a printable A4 sheet of barcode labels — one barcode per row, six rows per page — for labelling warehouse locations. Optionally adds a direction arrow to each page.",
    dataSource:
      "No data source at all — it works purely on the codes you type. No Data Sync or Business Central connection is needed (you just need to be logged in).",
    shows: [
      "A large text box — one location code per line (e.g. SHELF-A1).",
      "A sequence-autofill bar that appears when your last line ends in a number: an up/down toggle, a count box and a + Fill button.",
      "An arrow picker: No arrow / ← Left / → Right.",
      "A live counter of how many locations you've entered, and a green 📄 Download PDF button.",
    ],
    controls: [
      { name: "Location codes text box", what: "One code per line — any text is accepted; blank lines are ignored. Each line becomes one barcode row." },
      { name: "↑ / ↓ toggle (autofill bar)", what: "Whether the autofill counts up (default) or down from the number at the end of your last line." },
      { name: "Add [N] more + Fill", what: "Appends the next codes in the sequence (1–100 at a time), keeping the prefix and preserving leading zeros — SHELF-A09 continues SHELF-A10, SHELF-A11…" },
      { name: "Arrow picker", what: "No arrow (default), or a black arrow printed at the bottom of each PDF page pointing left or right — useful signage for which way locations run." },
      { name: "📄 Download PDF", what: "Generates and downloads the sheet (named vectis-locations-<date>.pdf). Greyed out until at least one code is typed." },
    ],
    howTo: [
      {
        task: "Print labels for a run of shelf locations",
        steps: [
          "Type the first code, e.g. SHELF-A1.",
          "Use the autofill bar: pick ↑, set how many more you need, click + Fill.",
          "Choose an arrow if wanted, then click 📄 Download PDF and print — six barcodes per A4 page.",
        ],
      },
    ],
    tips: [
      "Codes are free-form — shelves, aisles, bays, any naming scheme becomes a scannable barcode.",
      "The autofill always continues from the LAST line — fill one run, type a new starting code underneath, fill again.",
      "Long codes shrink automatically so the whole code always shows.",
      "Rows sit in fixed slots, so labels are always the same size — handy if you cut pages into strips.",
    ],
    gotchas: [
      "It does NOT check that a code actually exists — it will happily print a barcode for a typo.",
      "The autofill bar only appears when the last line ends in digits.",
      "Despite the on-screen wording, the arrow prints once at the bottom of each page, not on every row.",
      "Extremely long lists could hit the 60-second generation limit — split them if the download errors.",
    ],
  },
]

export function getGuideSection(id: string): GuideSection | undefined {
  return GUIDE_SECTIONS.find((s) => s.id === id)
}
