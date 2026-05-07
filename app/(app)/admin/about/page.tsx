"use client"

import { useState } from "react"

// ─── Content ─────────────────────────────────────────────────────────────────

type Section = {
  label: string
  items: string[]
}

type App = {
  key: string
  icon: string
  name: string
  path: string
  overview: string
  howItWorks: Section[]
  dependsOn: string[]
  rules: string[]
}

const APPS: App[] = [
  {
    key: "auction-ai",
    icon: "✨",
    name: "Auction AI",
    path: "/tools/auction-ai",
    overview: "Generates professional lot descriptions and key points from photographs using Google Gemini AI. Supports bulk batch runs across an entire auction, single-lot chat sessions, a description copier, barcode sorter, duplicate checker, and a model tester.",
    howItWorks: [
      {
        label: "Batch Run",
        items: [
          "Upload photos named by barcode or unique ID (e.g. F066001.jpg, R000016-413_2.jpg). The filename determines which lot the photo belongs to.",
          "Select an auction code. The system loads all lots for that auction and matches photos to them by filename (strips extension, strips trailing _N suffix).",
          "Click Run — the server sends each lot's photos to Gemini with the configured AI preset instructions, waits 12 seconds between lots to stay within rate limits, then saves the result directly to the CatalogueLot record.",
          "The client shows live progress. If Gemini returns a rate-limit error, it retries with exponential back-off (60 s → 120 s → 240 s → 480 s … up to 30 minutes) and alternates between primary and fallback models.",
          "The run only truly fails a lot if the user clicks Cancel or Gemini blocks the content (content blocks never succeed on retry).",
          "Already-saved lots are auto-deselected when new photos are loaded in the same session.",
          "Auction code is optional — if provided, each lot is saved to the DB immediately after it succeeds. If not, results are held in-memory only.",
        ],
      },
      {
        label: "Chat Tab",
        items: [
          "Single-lot chat with Gemini — upload up to 6 images and have a free-form conversation to refine a description.",
          "Conversation history is maintained for the session so follow-up messages have context.",
          "Optional Google Search grounding can be enabled to let Gemini pull in live product/collector information.",
          "Output can be copied as plain text or raw HTML.",
          "System instruction presets are customisable and stored per user in the DB.",
        ],
      },
      {
        label: "Barcode Sorter",
        items: [
          "Scan or type barcodes from physical labels to categorise and sort uploaded photo files.",
          "Useful when photos have been uploaded without correct filenames and need to be matched to lots manually.",
        ],
      },
      {
        label: "Description Copier",
        items: [
          "Loads lot data preloaded from the Cataloguing page via localStorage key copier_preload and lets you copy descriptions individually or in bulk.",
          "Sort order is configurable: Unique ID, Barcode, or Lot Number. The sort uses the actual field for the active mode (not a generic folder field) so the jump list and card display stay in sync.",
          "Folder field is always receiptUniqueId || lotNumber — never lotNumber alone (lots created via Apply to Auction have empty lotNumber).",
          "rowLabel() helper drives the jump list, search filter, and card ID display — they all use the same function.",
        ],
      },
      {
        label: "Duplicate Checker",
        items: [
          "Groups lots by receiptUniqueId (case-insensitive trim) and shows any groups with 2 or more lots.",
          "Each duplicate group is scored to identify which lot record is the most complete: description +4, title +2, keyPoints +1, estimateLow +1, estimateHigh +1, lotNumber +1, barcode +1, vendor +1, each image +2.",
          "The highest-scoring record is highlighted as the one to keep. The lower-scoring duplicate can be deleted from here.",
        ],
      },
      {
        label: "Model Tester",
        items: [
          "Send the same prompt to multiple Gemini models in sequence to compare output quality and speed.",
          "Models run sequentially with a 1-second gap between them — never in parallel, as firing all models concurrently burns quota and causes 429 rate-limit errors that pollute the results.",
        ],
      },
      {
        label: "Macro Files",
        items: [
          "Upload and manage text macro files used as base instructions for the AI. These are stored in the database and injected into the Gemini prompt.",
        ],
      },
    ],
    dependsOn: [
      "Google Gemini API (primary: gemini-2.5-flash-preview, user-selectable fallback)",
      "PostgreSQL — AuctionRun, AuctionLot, AiPreset, CatalogueLot, MacroFile tables",
      "Google Search API (optional grounding in chat tab)",
    ],
    rules: [
      "Max 24 images per lot in batch mode; max 6 in chat mode.",
      "Server route maxDuration is 300 seconds (batch) and 120 seconds (chat). Client retry loop is infinite — never give up on rate limits or transient errors.",
      "Rate-limit backoff: exponential starting at 60 s, capped at 30 minutes. Other errors: linear starting at 12 s, capped at 30 s.",
      "Alternate between primary and fallback model on every retry so if one is still rate-limited the other gets a chance.",
      "12-second delay between lots on the server to stay within Gemini quota.",
      "The batch route returns HTTP 200 even when individual lots fail — always check results[0].status, not res.ok.",
      "Always check response.promptFeedback?.blockReason and response.candidates?.[0]?.finishReason before calling .text(). Calling .text() on a blocked response throws and loses the reason.",
      "Description lines must be joined with \\n, never with a space. Collapsing to a space destroys list and paragraph formatting.",
      "503 errors from Gemini are transient — retry, do not surface as permanent failure.",
      "Content blocks (SAFETY etc.) abort the lot immediately and are shown as FAILED — they will never succeed on retry.",
      "FAILED status should only appear if the user explicitly cancels a lot mid-run.",
      "Chat route returns 422 (not 500) on Gemini content block, with the block reason in the error message.",
      "Model Tester: always run models sequentially with a 1-second gap — never Promise.all.",
    ],
  },

  {
    key: "cataloguing",
    icon: "📂",
    name: "Cataloguing",
    path: "/tools/cataloguing",
    overview: "Full lot cataloguing system for preparing auctions. Covers the complete journey from creating an auction through to publishing lots with descriptions, estimates, photos and vendor details.",
    howItWorks: [
      {
        label: "Auction Manager",
        items: [
          "Create and manage CatalogueAuction records. Each auction has a code, name, date, type (General, Diecast, Trains, Vinyl, TV/Film, Matchbox, Comics, Bears, Dolls) and status flags (locked, finished, complete, published).",
          "Once published = true, the auction and its lots appear on the public website.",
          "A CatalogueAuction must have auctionDate set for the calendar sidebar on the public site to display it correctly.",
        ],
      },
      {
        label: "Lot Wizard",
        items: [
          "Step-by-step form for creating a lot: barcode scan → vendor lookup → categories → estimate → condition → key points → description.",
          "Barcode is matched against existing lots via three-way lookup: lotNumber, barcode, and receiptUniqueId.",
          "Title is auto-extracted from the first sentence of the description (max 83 characters, truncated with …).",
        ],
      },
      {
        label: "Photo Upload",
        items: [
          "Bulk photo upload with automatic filename-to-lot matching.",
          "Filenames are parsed: strip extension, strip trailing _N suffix (e.g. F066001_2.jpg → F066001). Non-ASCII characters are stripped before barcode testing.",
          "Lot lookup checks all three identifier fields: lotNumber, barcode, and receiptUniqueId.",
        ],
      },
      {
        label: "Tablet Cataloguing",
        items: [
          "Simplified mobile-optimised view for cataloguers working on the warehouse floor.",
          "Photo-only mode skips the text fields — just scan, photograph, done.",
        ],
      },
      {
        label: "AI Upgrade",
        items: [
          "Runs existing lot descriptions through Gemini to improve quality.",
          "Lot History Generator tab produces SEO paragraphs about the manufacturer/item history per lot, stored in the extraDetails field.",
        ],
      },
      {
        label: "Lotting Up",
        items: [
          "Cross-references lots against BC warehouse data to check which items have been received at the warehouse.",
        ],
      },
      {
        label: "Research",
        items: [
          "Research tools for cataloguers — time spent here is logged per-user for the Cataloguing Reports in Admin.",
        ],
      },
      {
        label: "Apply to Auction (AI Runs)",
        items: [
          "Converts AI run results into CatalogueLot records. Detects unique ID format (/^[A-Za-z]\\d{4,7}-\\d{1,6}$/) and routes to receiptUniqueId (leaving lotNumber empty) or to lotNumber.",
          "Deduplication checks both existingLotNumbers and existingUniqueIds sets before creating any record.",
        ],
      },
    ],
    dependsOn: [
      "PostgreSQL — CatalogueAuction, CatalogueLot, CataloguePhotoSession, CatalogueTimingLog, ResearchLog tables",
      "Google Gemini API — AI Upgrade and Lot History Generator tabs",
      "BC warehouse data (WarehouseItem) — for vendor lookup and Lotting Up",
    ],
    rules: [
      "Lot title maximum is 83 characters — truncate with … if exceeded.",
      "Three identifier fields exist and are NOT interchangeable: receiptUniqueId (format: R000016-413), barcode (format: F066001), lotNumber (integer string). Never store a unique ID in lotNumber.",
      "Lots created via Apply to Auction from AI runs will have an empty lotNumber — this is correct. A lot with receiptUniqueId is fully identified.",
      "Unique ID detection regex: /^[A-Za-z]\\d{4,7}-\\d{1,6}$/. Barcode regex: /^[A-Za-z]\\d{6,7}$/.",
      "Lot status values: ENTERED | REVIEWED | PUBLISHED | SOLD | UNSOLD | WITHDRAWN. Default on creation: ENTERED.",
      "Auction types: GENERAL | DIECAST | TRAINS | VINYL | TV_FILM | MATCHBOX | COMICS | BEARS | DOLLS.",
      "Estimate regex: /£([\\d,]+)\\s*[–\\-]\\s*£?([\\d,]+)/ — accepts en-dash and hyphen, optional £ on second value, strip commas.",
      "Bidding increment rounding: £0–50 → nearest £5; £50–200 → nearest £10; £200–700 → nearest £20; £700–1000 → nearest £50; £1000–3000 → nearest £100; £3000–7000 → nearest £200; £7000–10000 → nearest £500; £10000+ → nearest £1000.",
      "Description Copier: Folder field must always be receiptUniqueId || lotNumber — never lotNumber alone.",
      "Photo filename matching strips extension and trailing _N suffix, then strips non-ASCII, before three-way lot lookup.",
    ],
  },

  {
    key: "bc-warehouse",
    icon: "🗺️",
    name: "BC Warehouse",
    path: "/tools/bc-warehouse",
    overview: "Business Central warehouse tools for tracking physical inventory. Includes a live location heatmap, sale checklist, tote analytics, location history per item or tote, and a full BC data sync interface.",
    howItWorks: [
      {
        label: "Heatmap",
        items: [
          "Visual aisle/bay/shelf grid showing how full each warehouse location is. Colour-coded by fill level: empty, 1–2 items, 3–5, 6–9, 10+.",
          "Unlocated items count is shown in a chip. Filter by aisle, auction code, or cataloguing status.",
        ],
      },
      {
        label: "Sale Checklist",
        items: [
          "Lists upcoming auctions and expands to show which items are in the warehouse, their location, and any missing items.",
          "Tracks vendor and withdrawal status per item.",
        ],
      },
      {
        label: "Search by Location",
        items: [
          "Enter a warehouse location code to see all items and totes currently stored there.",
          "Location code pattern: e.g. A10A1 = aisle A10, bay A, shelf 1.",
        ],
      },
      {
        label: "Location History",
        items: [
          "Two modes: Tote number and Barcode (default: Tote).",
          "Tote mode queries BC location change log directly for the tote number.",
          "Barcode mode is two-step: first resolves barcode to BC item key via BC API, then fetches location changes for that item.",
          "Results show movements: From / To / Changed by / Date. Most recent row is highlighted with a blue tint.",
          "Staff names are resolved via a hardcoded SALESPERSON_NAMES lookup table in the component.",
          "A no-results state shows a styled card explaining the item may not have been moved or the change log was not active.",
        ],
      },
      {
        label: "Tote Data",
        items: [
          "Analytics on active totes: counts by category, by location, paginated for 150+ totes.",
          "Shows which categories have the most physical totes in the warehouse at a given time.",
        ],
      },
      {
        label: "Data Sync",
        items: [
          "Shows item count, tote count, last sync time and running status.",
          "Syncs from four BC sources: Receipt_Lines_Excel (warehouse items), Auction_Lines_Excel (auction allocation), location changelog, and tote data.",
          "A background cron runs every 12 hours to keep data fresh. Manual sync can be triggered from this tab.",
          "WarehouseItem.uniqueId is the primary key for matching against CatalogueLot.receiptUniqueId.",
        ],
      },
      {
        label: "DB Explorer",
        items: [
          "Raw search across the local WarehouseItem and WarehouseTote tables — useful for debugging sync issues or finding specific items.",
        ],
      },
    ],
    dependsOn: [
      "Business Central OData API (Receipt_Lines_Excel, Auction_Lines_Excel, location change log, tote data)",
      "PostgreSQL — WarehouseItem, WarehouseTote, WarehouseSyncLog tables",
      "BCToken (per-user OAuth token) for API authentication",
    ],
    rules: [
      "DO NOT change the design or behaviour of the Location History tab. It was accidentally replaced in an earlier rewrite and had to be manually restored.",
      "Location History API route is /api/bc/location-history — not /api/warehouse/location-history.",
      "BC fetch timeouts: 30 seconds per page, 45 seconds total. Page size: 500 items per request ($top=500).",
      "Token refresh buffer: 60 seconds before expiry — refresh before it runs out.",
      "getBCTokenAny() picks any valid non-expired token for background/cron use — no specific user needs to be logged into BC.",
      "Auction names: WarehouseItem.auctionName is the primary source and is populated by the sale-checklist route by filtering Auction_Lines_Excel by known EVA_UniqueID values.",
      "$apply=groupby is NOT supported by BC OData — do not use it.",
      "Auction_Lines_Excel is item-level (one row per lot) — never use $top alone to get all auction names, you'll miss most codes.",
      "Do not use CatalogueAuction for names in any BC warehouse view — it is the local cataloguing system and may have stale or wrong names for BC auction codes.",
      "BC field reference: Auction_Lines_Excel (code: EVA_SalesAllocation, name: EVA_AuctionName); Receipt_Lines_Excel (EVA_SalesAllocation matches WarehouseItem.auctionCode, no name field).",
    ],
  },

  {
    key: "bc-reports",
    icon: "📊",
    name: "BC Reports",
    path: "/tools/bc-reports",
    overview: "Business Central reporting dashboard covering cataloguing activity, packing records, and warehouse metrics. Data is fetched from BC on demand and cached locally for fast display.",
    howItWorks: [
      {
        label: "Cataloguing Report",
        items: [
          "Fetches EVA_CataloguedBy and EVA_CataloguedDateTime from Auction_Receipt_Lines_Excel, grouped by date and user.",
          "Shows lots catalogued per person per day. Data is stored in BCCatalogueDay/BCCatalogueEntry tables so only new dates are fetched from BC on subsequent loads.",
        ],
      },
      {
        label: "Packing Report",
        items: [
          "Fetches despatch records from BC, grouped by staff member and document number.",
          "Includes a capacity modeller: configure staff count, sales/month, lots/sale, working days, collections/day to estimate backlog.",
          "Monthly auction receipt lines for the last 3 months. Data cached in BCPackingDay/BCPackingEntry tables.",
        ],
      },
      {
        label: "Warehouse Report",
        items: [
          "Tote counts by category and cataloguer derived from WarehouseItem and WarehouseTote sync.",
        ],
      },
      {
        label: "ShipMaps",
        items: [
          "Visualises where parcels are being sent geographically, derived from packing/despatch data.",
        ],
      },
    ],
    dependsOn: [
      "Business Central OData API (Auction_Receipt_Lines_Excel, ShipmentRequestAPI, CollectionList)",
      "PostgreSQL — BCCatalogueDay, BCPackingDay, BCCatalogueEntry, BCPackingEntry tables",
      "BCToken for authentication",
    ],
    rules: [
      "BC fetch timeouts: 30 seconds per page, 45 seconds total. Page size: 500 per request.",
      "Token refresh buffer: 60 seconds before expiry.",
      "getBCTokenAny() is used — no specific user needs to be logged in to BC for background report fetches.",
      "Do not use CatalogueAuction for names in BC report views — use BC source data or WarehouseItem.auctionName.",
    ],
  },

  {
    key: "bc-marketing",
    icon: "📰",
    name: "BC Marketing",
    path: "/tools/bc-marketing",
    overview: "Generates SEO-optimised news articles from Business Central auction results using Gemini AI. Filter sold lots by keyword, category or date range, then generate editorial-quality content in multiple styles.",
    howItWorks: [
      {
        label: "How it works",
        items: [
          "Filter lots from the local WarehouseItem table by keyword (searches description), category, and/or month/year of auction.",
          "Results are sorted by hammer price (highest first). Choose how many to include (Top 5 to Top 50).",
          "Select an article type: Sale Highlight, News Story, Collector's Guide, or Market Report.",
          "The selected lots are sent to Gemini along with the article type — Gemini writes the article in HTML format.",
          "Output can be copied as plain text or raw HTML for use in a CMS or email.",
          "System instruction presets are customisable and stored per user.",
          "Model is user-selectable from the available Gemini model list.",
        ],
      },
    ],
    dependsOn: [
      "Google Gemini API",
      "PostgreSQL — WarehouseItem table (BC auction data synced locally)",
    ],
    rules: [
      "Lot links to the public Vectis website cannot be auto-generated — the site URL structure contains internal IDs that are not available in BC data.",
    ],
  },

  {
    key: "bc-api-viewer",
    icon: "🔍",
    name: "BC API Viewer",
    path: "/tools/bc-api-viewer",
    overview: "Developer and admin tool for inspecting Business Central OData endpoints. Enter any endpoint path and see field names and sample data — useful for building new BC integrations or debugging.",
    howItWorks: [
      {
        label: "How it works",
        items: [
          "Type any BC endpoint path (e.g. Auction_Lines_Excel, Receipt_Lines_Excel).",
          "The server authenticates with BC using any valid staff token (getBCTokenAny) and fetches a sample of records.",
          "Results are displayed as a structured table showing all field names and their values.",
        ],
      },
    ],
    dependsOn: [
      "Business Central OData API",
      "BCToken — uses getBCTokenAny() so no specific user needs to be logged in to BC",
    ],
    rules: [
      "Requires BC_WAREHOUSE app permission — not visible to general users.",
    ],
  },

  {
    key: "warehouse",
    icon: "🏭",
    name: "Warehouse (Internal)",
    path: "/tools/warehouse",
    overview: "Internal Vectis warehouse management system for tracking physical items through the warehouse. Manages inbound receipts, container locations, and item movements independently of Business Central.",
    howItWorks: [
      {
        label: "Sub-sections",
        items: [
          "Dashboard: overview stats (customer count, receipt count, open receipts, container count) and the last 10 movements.",
          "Inbound: log new receipts and containers arriving at the warehouse, link to a Contact record.",
          "Locate: find where a specific container or item is currently stored by scanning or typing its ID.",
          "Lookup Location: browse all containers and items at a specific warehouse location.",
          "Customers: view receipt history per customer — requires manager+ role.",
          "Receipts: full receipt list with container detail and print functionality — requires manager+ role.",
          "History: movement log showing who moved what and when — requires manager+ role.",
          "Reports: warehouse statistics and summaries — requires admin role.",
        ],
      },
    ],
    dependsOn: [
      "PostgreSQL — WarehouseReceipt, WarehouseContainer, WarehouseLocation, WarehouseMovement, Contact tables",
    ],
    rules: [
      "Three warehouse roles control access within this tool: warehouse (Inbound, Locate, Lookup only), manager (adds Customers, Receipts, History), admin (full access including Reports).",
      "Warehouse role is set per-user in App Access & Permissions and is separate from the main system role (ADMIN, COLLECTIONS, CATALOGUER).",
      "Receipt status: open or closed.",
    ],
  },

  {
    key: "crm",
    icon: "📋",
    name: "Submissions",
    path: "/submissions",
    overview: "Customer submission management used by the Collections team. Tracks items from initial customer enquiry through valuation, customer decision, and logistics.",
    howItWorks: [
      {
        label: "Workflow",
        items: [
          "Collections creates a submission for a customer (via email, web form, phone, or walk-in) with one or more items.",
          "Submission is assigned to a department and cataloguer for valuation.",
          "Cataloguer logs an estimated value and comments per item via the Valuation record.",
          "Collections contacts the customer and logs the outcome via ContactLog.",
          "If declined: submission moves to the follow-up queue with a follow-up count and last-contact date.",
          "If approved: logistics are arranged — either SENT_IN (customer posts items) or COLLECTION (Vectis collects from customer address).",
        ],
      },
      {
        label: "Access control",
        items: [
          "ADMIN and COLLECTIONS roles can create, update, and delete submissions.",
          "CATALOGUER role can add valuations only.",
          "Contact channels: EMAIL, WEB_FORM, PHONE, WALK_IN.",
        ],
      },
    ],
    dependsOn: [
      "PostgreSQL — Submission, Item, Valuation, ContactLog, Logistics, Contact, Department tables",
    ],
    rules: [
      "Submission status flow: PENDING_ASSIGNMENT → PENDING_VALUATION → VALUATION_COMPLETE → PENDING_CUSTOMER_DECISION → APPROVED / DECLINED → FOLLOW_UP → COLLECTION_PENDING → ARRIVED → COMPLETED.",
      "Logistics types: SENT_IN or COLLECTION.",
      "Contact channels: EMAIL, WEB_FORM, PHONE, WALK_IN.",
    ],
  },

  {
    key: "customers",
    icon: "👥",
    name: "Customers",
    path: "/contacts",
    overview: "Unified customer database combining BC contact data with local submission and bidding history.",
    howItWorks: [
      {
        label: "List & search",
        items: [
          "Search by name, phone, email, postcode, address, or customer ID. Shows 50 results per page.",
          "Create new customers via a modal — salutation options: Mr, Mrs, Ms, Miss, Dr, Prof.",
        ],
      },
      {
        label: "Customer detail overlay (4 tabs)",
        items: [
          "Details: basic info (salutation, name, contact, address, notes), isSeller and isBuyer flags, save edits.",
          "Seller/Warehouse: linked warehouse receipts with status, containers, and a link to the warehouse tool.",
          "Buyer/CRM: linked submissions with status, channel, date, and a link to the submission.",
          "Documents: print receipt, auction pre/post-sale advice, vendor statements.",
        ],
      },
    ],
    dependsOn: [
      "PostgreSQL — Contact, WarehouseReceipt, Submission, CustomerAccount tables",
      "BC sync for initial contact data population",
    ],
    rules: [],
  },

  {
    key: "databases",
    icon: "🗄️",
    name: "Databases",
    path: "/databases",
    overview: "Read-only search interface across all major data stores. Seven tabbed tables with high row limits for bulk data review.",
    howItWorks: [
      {
        label: "Tabs",
        items: [
          "Contacts — customer master data (up to 3,000 rows).",
          "Receipts — warehouse receipts with commission rates (up to 3,000 rows).",
          "Containers — totes/boxes with receipt link and last location (up to 3,000 rows).",
          "Lots — catalogue lots with auction, status, condition, estimate, hammer price, image count (up to 5,000 rows).",
          "Auctions — catalogue auctions (all rows).",
          "Locations — warehouse location codes (all rows).",
          "Commission Bids — customer max bids placed on lots (up to 5,000 rows).",
        ],
      },
    ],
    dependsOn: [
      "PostgreSQL — Contact, WarehouseReceipt, WarehouseContainer, CatalogueLot, CatalogueAuction, WarehouseLocation, CommissionBid tables",
    ],
    rules: [
      "Read-only — no edits or deletes from this view.",
    ],
  },

  {
    key: "packing",
    icon: "📦",
    name: "Packing / Dispatch",
    path: "/tools/packing",
    overview: "Royal Mail shipping label generation and end-of-day manifest management for auction lot dispatch. Integrates directly with Royal Mail Click & Drop.",
    howItWorks: [
      {
        label: "How it works",
        items: [
          "Create a parcel record with recipient details (name, company, address, postcode, email, phone), package format (Letter, Large Letter, Small/Medium Parcel), weight, and Royal Mail service code.",
          "Assign CatalogueLots to the parcel so the packing team knows what's inside.",
          "Submit to Royal Mail Click & Drop API — returns a tracking number and PDF label.",
          "At end of day, generate and submit a despatch manifest to finalise the collection with Royal Mail.",
          "Parcel tabs: All, Pending, Label Ready, Dispatched.",
          "20+ Royal Mail service options: Tracked 24/48 with/without signature, Special Delivery tiers (NDA, SDA/SDB/SDC/SDD), express, etc.",
        ],
      },
    ],
    dependsOn: [
      "Royal Mail Click & Drop API",
      "PostgreSQL — Parcel, ParcelLot, CatalogueLot, CustomerAccount tables",
    ],
    rules: [
      "Parcel status values: PENDING → LABEL_CREATED → DISPATCHED → CANCELLED.",
      "Default package format: Parcel. Default service: TPP48 (48-hour tracked).",
      "Minimum required fields: recipient name, address line 1, city, postcode.",
    ],
  },

  {
    key: "website",
    icon: "🌐",
    name: "Website",
    path: "/website",
    overview: "Admin interface for the public-facing Vectis auction website. The public site is part of this same application — the /(site) routes serve it. Buyers can browse lots, register to bid, and place commission bids.",
    howItWorks: [
      {
        label: "Public site (/(site) routes)",
        items: [
          "Auction pages: lists published CatalogueAuctions and their lots. Lots appear only when their auction has published = true.",
          "Live auction room: real-time bidding interface powered by Socket.IO. Buyers see the current lot and can place live bids.",
          "Account portal: buyers register, manage details, view bids and purchase history.",
        ],
      },
      {
        label: "Website admin section",
        items: [
          "Website Preview tab: live iframe previewing the public site (Home, Auctions, Login, Register, Account) — useful for checking how published content looks without leaving the admin panel.",
          "Back End Controller tab: live auction control interface with WebRTC and bid management, embedded as an iframe.",
          "Banner Manager: create, edit, and reorder homepage hero banner slides.",
        ],
      },
    ],
    dependsOn: [
      "PostgreSQL — CatalogueAuction, CatalogueLot, CustomerAccount, BidderRegistration, CommissionBid, LiveAuction, HeroSlide tables",
      "Socket.IO — live auction real-time events",
    ],
    rules: [
      "Lots only appear on the public site when their auction has published = true.",
      "A CatalogueAuction must have auctionDate set for the calendar sidebar on the public site to display it correctly.",
    ],
  },

  {
    key: "auction-controller",
    icon: "🔨",
    name: "Auction Controller",
    path: "/auction-controller",
    overview: "Live auction clerking panel used during a sale. The auctioneer controls lot progression and bid increments; the system handles auto-bids and real-time updates to the buyer-facing live room.",
    howItWorks: [
      {
        label: "Pre-sale",
        items: [
          "Clerk authenticates with a password, then selects a published auction to operate.",
          "LiveAuction record is set to ACTIVE when the sale begins.",
        ],
      },
      {
        label: "During the sale",
        items: [
          "Auctioneer advances through lots sequentially or jumps to a specific lot number.",
          "Bid source buttons: Room, Telephone, Invaluable, Saleroom, Online.",
          "Online bids require manual acceptance from the clerk before they're registered.",
          "Auto-bids (commission bids placed in advance by buyers) are processed automatically — the system bids on their behalf up to their maximum, using the standard increment table.",
          "Fair Warning and Hammer are single-button controls. Sold popup auto-advances after 3 seconds.",
          "The clerk can pause the auction and display a custom message to viewers.",
        ],
      },
      {
        label: "Camera broadcast",
        items: [
          "The controller can broadcast a live video feed to the buyer-facing live room via WebRTC (ICE candidates, SDP exchange).",
          "Buyers in the live room see the current lot, current bid, and the camera feed simultaneously.",
        ],
      },
      {
        label: "Results view",
        items: [
          "Summary of all hammered lots with final prices. Recent results panel shows the last 10 sold lots.",
        ],
      },
      {
        label: "Real-time (Socket.IO)",
        items: [
          "Buyer-facing live room at /(site)/auctions/[code]/live receives real-time updates: current lot, current bid, hammer events.",
          "On server restart, any ACTIVE or PAUSED auction is automatically reset to PENDING to prevent a stale live banner showing on the public site.",
        ],
      },
    ],
    dependsOn: [
      "Socket.IO — real-time bidding events between auctioneer and buyer room",
      "PostgreSQL — LiveAuction, CatalogueLot, CommissionBid, BidderRegistration tables",
      "WebRTC — video broadcast from clerk camera to buyer room",
    ],
    rules: [
      "LiveAuction status values: PENDING, ACTIVE, PAUSED, COMPLETE.",
      "On server restart, stale ACTIVE/PAUSED auctions are reset to PENDING automatically.",
      "Bidding increments follow the standard Vectis rounding table: £0–50 nearest £5; £50–200 nearest £10; £200–700 nearest £20; £700–1000 nearest £50; £1000–3000 nearest £100; £3000–7000 nearest £200; £7000–10000 nearest £500; £10000+ nearest £1000.",
    ],
  },

  {
    key: "saleroom-trainer",
    icon: "🎓",
    name: "Saleroom Trainer",
    path: "/tools/saleroom-trainer",
    overview: "Interactive training simulator for new saleroom clerks. Simulates a live auction environment so staff can practise clerking without using real auction data.",
    howItWorks: [
      {
        label: "How it works",
        items: [
          "Loads an embedded HTML5 training module (saleroom-trainer.html).",
          "Presents simulated lots with estimates and asks the trainee to manage the bidding process.",
          "Tracks correct and incorrect bid increments, timing, and hammer decisions.",
          "No data is written to any production tables — all state is session-local.",
        ],
      },
    ],
    dependsOn: [
      "No external dependencies — fully self-contained simulation",
    ],
    rules: [],
  },

  {
    key: "ai-presenter",
    icon: "🎙️",
    name: "AI Presenter",
    path: "/tools/avatar",
    overview: "Realistic AI avatar presenter that reads lot descriptions aloud with live lip-sync. Connects to D-ID via WebRTC. Can auto-read from the auction controller screen in real time.",
    howItWorks: [
      {
        label: "Manual mode",
        items: [
          "Select a presenter from the D-ID library (thumbnail gallery, 3-column grid).",
          "Type any text and click Speak — the avatar reads it aloud with synchronised lip movement streamed back via WebRTC.",
          "Connection states: Idle → Connecting → Connected → Speaking → Error.",
          "A 20-second keepalive heartbeat is sent to D-ID to maintain the stream (D-ID drops idle streams after ~30 seconds).",
        ],
      },
      {
        label: "Auto-Read (Screen Sharing)",
        items: [
          "Share the auction controller browser tab.",
          "Gemini vision reads the lot number, current bid, and asking bid every 4 seconds at max 2 FPS, downscaled to a max 1280px-wide frame.",
          "When the lot number changes, the presenter automatically speaks the new lot description.",
          "Speech duration is estimated as: Math.ceil((wordCount / 140) * 60000) + 2000 ms.",
        ],
      },
    ],
    dependsOn: [
      "D-ID API — presenter library, WebRTC stream creation, SDP/ICE exchange, keepalive, speak endpoint",
      "Google Gemini API — vision reading of auction controller screen (auto-read mode)",
      "WebRTC — peer connection for video/audio stream from D-ID to browser",
    ],
    rules: [
      "Keepalive must fire every 20 seconds while connected — D-ID drops the stream after ~30 seconds of silence.",
      "Auto-read screen capture: max 2 FPS, max 1280px wide. Do not increase — higher rates burn Gemini quota unnecessarily.",
      "Presenter records may use either presenter_id or id field — both must be handled.",
    ],
  },

  {
    key: "admin",
    icon: "⚙️",
    name: "Admin",
    path: "/admin",
    overview: "System administration area. Only accessible to users with the ADMIN role. Covers user management, app permissions, system configuration, and database maintenance.",
    howItWorks: [
      {
        label: "Users & Permissions",
        items: [
          "Create users (role-default permissions are auto-applied on creation), edit details, set app access per section, manage permissions within apps (e.g. warehouse role), change passwords.",
          "App access and hub card visibility are grouped by section (Cataloguing & AI, Business Central, Operations, Auction) to match the hub page layout.",
        ],
      },
      {
        label: "Role Defaults",
        items: [
          "Set default app access per role (Collections, Cataloguer). Stored in the RoleDefault table.",
          "Applied automatically to new users when created via the createUser action.",
          "Can be pushed to existing users individually (pick mode) or all at once (apply-all mode).",
        ],
      },
      {
        label: "Home Page",
        items: [
          "Drag-to-reorder hub cards, toggle visibility, mark as featured, customise labels and descriptions.",
          "Reorder state is stored in the AppCard table per user.",
        ],
      },
      {
        label: "Departments",
        items: [
          "Manage cataloguer departments used when assigning submissions in the CRM.",
        ],
      },
      {
        label: "Cataloguing Reports",
        items: [
          "View time-per-lot statistics across all cataloguers — average speed, method breakdown (wizard vs photo-only vs tablet), recent session activity.",
          "Data sourced from CatalogueTimingLog and ResearchLog.",
        ],
      },
      {
        label: "Run Migrations",
        items: [
          "Emergency button that applies any missing database columns or tables without redeploying.",
          "Uses IF NOT EXISTS SQL so it is always safe to run — it will never drop or modify existing data.",
          "Any new migration added to the codebase must also be added to the /api/admin/run-migrations MIGRATIONS array.",
        ],
      },
      {
        label: "Claude Memory",
        items: [
          "Reads Claude's memory markdown files from the local ~/.claude/projects directory and renders them as a colour-coded accordion.",
          "Only available when running locally — shows a friendly unavailable notice on Railway.",
        ],
      },
      {
        label: "About",
        items: [
          "This page — documentation for every app section, its dependencies, and the rules that must be followed.",
        ],
      },
    ],
    dependsOn: [
      "PostgreSQL — User, Department, AppCard, RoleDefault, CatalogueTimingLog, ResearchLog tables",
      "NextAuth v5 — session management and role enforcement",
      "bcrypt — password hashing",
    ],
    rules: [
      "Superadmin email it@vectis.co.uk is hardcoded to always receive the ADMIN role regardless of what the database says.",
      "ADMIN users always have access to all apps — app permission checkboxes are ignored for ADMINs.",
      "User roles: ADMIN, COLLECTIONS, CATALOGUER.",
      "Prisma migrate deploy runs on server startup via server.js. If it fails silently, use the Run Migrations button on this page.",
      "Any new database migration must also be added to /api/admin/run-migrations so it can be applied manually if needed.",
      "New users automatically receive the role-default permissions for their role (fetched from RoleDefault table on createUser).",
    ],
  },
]

// ─── Component ────────────────────────────────────────────────────────────────

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

export default function AboutPage() {
  const [search, setSearch]     = useState("")
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set())

  function toggle(key: string) {
    setOpenKeys(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function expandAll()   { setOpenKeys(new Set(APPS.map(a => a.key))) }
  function collapseAll() { setOpenKeys(new Set()) }

  const q = search.toLowerCase().trim()
  const filtered = q
    ? APPS.filter(a =>
        a.name.toLowerCase().includes(q) ||
        a.overview.toLowerCase().includes(q) ||
        a.rules.some(r => r.toLowerCase().includes(q)) ||
        a.howItWorks.some(s => s.items.some(i => i.toLowerCase().includes(q))) ||
        a.dependsOn.some(d => d.toLowerCase().includes(q))
      )
    : APPS

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">About — How the App Works</h1>
        <p className="text-sm text-gray-500 mt-1">
          Documentation for every section — what it does, what it relies on, and the rules that must be followed.
        </p>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search apps, rules, dependencies…"
          className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
        <button onClick={expandAll}   className="text-xs text-gray-500 hover:text-gray-700 px-3 py-2 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors">Expand all</button>
        <button onClick={collapseAll} className="text-xs text-gray-500 hover:text-gray-700 px-3 py-2 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors">Collapse all</button>
      </div>

      <div className="flex flex-col gap-3">
        {filtered.length === 0 && (
          <p className="text-sm text-gray-400 italic py-8 text-center">No apps match your search.</p>
        )}

        {filtered.map(app => {
          const open = openKeys.has(app.key)
          return (
            <div key={app.key} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <button
                onClick={() => toggle(app.key)}
                className="w-full flex items-center gap-4 px-6 py-4 text-left hover:bg-gray-50 transition-colors"
              >
                <span className="text-2xl">{app.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-gray-900">{app.name}</span>
                    <span className="text-xs text-gray-400 font-mono">{app.path}</span>
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5 leading-snug line-clamp-2">{app.overview}</p>
                </div>
                <Chevron open={open} />
              </button>

              {open && (
                <div className="border-t border-gray-100 px-6 py-5 space-y-6">

                  {app.howItWorks.map(section => (
                    <div key={section.label}>
                      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{section.label}</h3>
                      <ul className="space-y-2">
                        {section.items.map((item, i) => (
                          <li key={i} className="flex gap-3 text-sm text-gray-700">
                            <span className="text-gray-300 mt-0.5 shrink-0">–</span>
                            <span className="leading-relaxed">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}

                  <div>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Depends On</h3>
                    <ul className="space-y-1.5">
                      {app.dependsOn.map((dep, i) => (
                        <li key={i} className="flex gap-3 text-sm">
                          <span className="text-blue-400 mt-0.5 shrink-0">◆</span>
                          <span className="text-gray-700 leading-relaxed">{dep}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {app.rules.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Rules & Notes</h3>
                      <ul className="space-y-2">
                        {app.rules.map((rule, i) => (
                          <li key={i} className="flex gap-3 text-sm">
                            <span className="text-amber-400 mt-0.5 shrink-0">▲</span>
                            <span className="text-gray-700 leading-relaxed">{rule}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
