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
  // ─── AUTH & SESSION ────────────────────────────────────────────────────────
  {
    key: "auth",
    icon: "🔐",
    name: "Auth & Sessions",
    path: "/login",
    overview: "NextAuth v5 (beta) with a Credentials provider. Staff log in with email or username + password. The session is a JWT stored in a cookie. A separate customer account system exists for public buyers on the site.",
    howItWorks: [
      {
        label: "Staff login",
        items: [
          "Accepts email or username. Password verified via bcrypt.compare() (12 salt rounds).",
          "Superadmin override: email it@vectis.co.uk always receives role ADMIN regardless of what the database says.",
          "Session JWT includes: id, name, email, role, departmentId, allowedApps[], appPermissions (JSON).",
          "appPermissions is a JSON object of shape Record<string, { role: string }> — keys are app identifiers, values hold app-specific sub-roles (e.g. warehouse role: 'manager').",
          "Auth split: auth.config.ts (Edge-safe, no Prisma) used in middleware/proxy; auth.ts (full, with Prisma) used in server components and API routes.",
          "trustHost: true is set in auth.config.ts — required for Railway's dynamic domain.",
          "The middleware file is proxy.ts (not middleware.ts) — Next.js renamed the convention.",
        ],
      },
      {
        label: "Customer accounts (public site)",
        items: [
          "Separate CustomerAccount model — email + bcrypt password, shipping/billing address, sessionToken cookie.",
          "Not connected to the staff User table.",
          "Buyers register, place commission bids, and view purchase history via /(site)/portal/.",
        ],
      },
      {
        label: "Role definitions",
        items: [
          "ADMIN — full access to everything, including admin panel. Hardcoded for it@vectis.co.uk.",
          "COLLECTIONS — CRM, submissions, follow-ups.",
          "CATALOGUER — cataloguing tools.",
          "App visibility is additionally controlled per-user via allowedApps[] and per-role defaults via the RoleDefault table.",
        ],
      },
    ],
    dependsOn: [
      "NextAuth v5 beta — JWT sessions, Credentials provider",
      "PostgreSQL — User, CustomerAccount tables",
      "bcrypt — password hashing (12 rounds)",
    ],
    rules: [
      "it@vectis.co.uk is always ADMIN — this is hardcoded in auth.ts and cannot be changed via the UI.",
      "ADMIN users have access to all apps regardless of their allowedApps[] array.",
      "appPermissions JSON holds app-specific sub-roles (e.g. warehouse: manager, admin). Read via session.user.appPermissions[key]?.role.",
      "Session includes allowedApps[] — check this before rendering app cards for non-admin users.",
      "British English throughout — 'Unauthorised' not 'Unauthorized'.",
    ],
  },

  // ─── AUCTION AI ────────────────────────────────────────────────────────────
  {
    key: "auction-ai",
    icon: "✨",
    name: "Auction AI",
    path: "/tools/auction-ai",
    overview: "Generates professional lot descriptions and key points from photographs using Google Gemini AI. Sub-tools: Batch Run, Chat, Barcode Sorter, Description Copier, Batch Runs history, Duplicate Checker, Model Tester, and Macro Files.",
    howItWorks: [
      {
        label: "Batch Run",
        items: [
          "Upload photos named by barcode or unique ID (e.g. F066001.jpg, R000016-413_2.jpg). The filename determines which lot the photo belongs to.",
          "Select an auction code. The system loads all lots for that auction and matches photos to them using two-way lot lookup (barcode, receiptUniqueId).",
          "Server route: /api/auction-ai/batch (maxDuration 300 s). FormData keys are lot_{name}_image_{i}. Max 24 images per lot (files.slice(0, 24)).",
          "12-second delay between lots on the server to stay within Gemini rate limits.",
          "Returns HTTP 200 even when individual lots fail — always check results[0].status, not res.ok.",
          "Rate-limit errors (429 / RESOURCE_EXHAUSTED) are re-thrown with the prefix RATE_LIMITED: so the client applies the correct backoff.",
          "No retries inside the route — errors thrown immediately so the client retry loop handles it.",
          "Description lines joined with \\n (not a space) — collapsing to a space destroys list/paragraph formatting.",
          "Auction code is optional. If provided, each lot is saved to the DB immediately after success via an upsert on (runId, lot) — so reloading the page cannot create duplicates.",
          "Already-saved lots are auto-deselected when photos are loaded (useEffect on savedLots handles this retroactively even if the auction code was entered after photos were loaded).",
        ],
      },
      {
        label: "Batch Run — client retry loop",
        items: [
          "Infinite retry — never gives up on rate limits or transient errors. Only aborts a lot on a Gemini content block (these never succeed on retry).",
          "Rate-limit backoff: Math.min(60000 × 2^(attempt−1), 1800000) → 60 s → 120 s → 240 s … capped at 30 min.",
          "Other error backoff: Math.min(attempt × 12000, 30000) → 12 s → 24 s → 30 s cap.",
          "Alternates between primary and fallback model on every retry — if one is still rate-limited the other gets a chance.",
          "FAILED status only appears if the user explicitly clicks Cancel.",
          "localStorage key batch_preload ({ auctionCode: string }) pre-fills the auction code field when arriving from the Cataloguing page.",
        ],
      },
      {
        label: "Chat Tab",
        items: [
          "Single-lot chat with Gemini — upload up to 6 images and have a free-form conversation to refine a description.",
          "Route: /api/auction-ai/chat (maxDuration 120 s). Returns 422 (not 500) on a Gemini content block.",
          "History format: [{ role: 'user'|'model', parts: [{ text: string }] }] — maintained for the session.",
          "Optional Google Search grounding via /api/auction-ai/chat-grounded.",
          "System instruction presets are customisable and stored in the AiPreset table (key = string primary key, instruction = TEXT).",
          "Output can be copied as plain text or raw HTML.",
        ],
      },
      {
        label: "Gemini response validation (critical)",
        items: [
          "Always check response.promptFeedback?.blockReason before calling .text() — a blocked prompt has no text.",
          "Always check response.candidates?.[0]?.finishReason — only STOP and MAX_TOKENS are acceptable.",
          "Calling .text() on a blocked response throws and loses the block reason. Check first, throw with a useful message, then .text().",
          "503 errors from Gemini are transient — retry, do not surface as a permanent failure.",
        ],
      },
      {
        label: "Barcode Sorter",
        items: [
          "Scan or type barcodes from physical labels to categorise uploaded photo files before a batch run.",
          "Useful when photos were uploaded without correctly named filenames and need to be matched to lots manually.",
        ],
      },
      {
        label: "Description Copier",
        items: [
          "Loaded with data from the Cataloguing page via localStorage key copier_preload (array of lot objects).",
          "Shape: Array<{ Folder, 'Receipt Unique ID', Barcode, Description, Estimate }>.",
          "Folder is receiptUniqueId || barcode — lots without either field would appear blank.",
          "Sort modes: Unique ID (parses receipt number and line number for correct numeric order), Barcode (alphanumeric).",
          "rowLabel() helper drives the jump list, search filter, and card ID display — all three must use the same function so they stay in sync.",
        ],
      },
      {
        label: "Duplicate Checker",
        items: [
          "Groups lots by receiptUniqueId (case-insensitive trim). Only groups with 2+ records are shown.",
          "Scoring to identify the most complete record: description +4, title +2, keyPoints +1, estimateLow +1, estimateHigh +1, barcode +1, vendor +1, each image +2.",
          "The highest-scoring record is highlighted as the keeper. The lower-scoring duplicate can be deleted from this view.",
        ],
      },
      {
        label: "Model Tester",
        items: [
          "Send the same prompt to multiple Gemini models in sequence and compare output quality and speed.",
          "Models run sequentially with a 1-second gap — never Promise.all. Firing all concurrently burns quota and causes the 429 errors that pollute results.",
        ],
      },
      {
        label: "Macro Files",
        items: [
          "Upload and manage text macro files stored as binary content in the MacroFile table.",
          "Fields: id, name, filename, description, content (Bytes), mimeType, size.",
          "Macros are injected into the Gemini prompt as base instructions.",
        ],
      },
      {
        label: "AI Instructions",
        items: [
          "SINGLE SOURCE OF TRUTH: the AiPreset table (key = primary key string, instruction = full TEXT prompt). Viewed/edited on Auction AI → Instructions; every run resolves its instruction from the DB by key server-side (lib/ai-instructions.ts), so what runs is always exactly what's saved.",
          "lib/auction-ai-presets.ts holds STARTER DEFAULTS only — used once to seed a brand-new empty DB. Editing that file does NOT change a seeded environment; there is no code-vs-DB merge and no session-only editing.",
          "All instructions define estimate format as 'Estimate: £X–£Y' and include the bidding increment table in the prompt.",
        ],
      },
    ],
    dependsOn: [
      "Google Gemini API (default: gemini-3-flash-preview, user-selectable fallback)",
      "Google Search API (optional grounding in chat tab)",
      "PostgreSQL — AuctionRun, AuctionLot, AiPreset, CatalogueLot, MacroFile tables",
    ],
    rules: [
      "Max 24 images per lot in batch mode; max 6 in chat mode.",
      "Batch route maxDuration 300 s, chat route maxDuration 120 s. Client retry is infinite — never give up on transient errors.",
      "Rate-limit backoff: exponential from 60 s, capped at 30 min. Other errors: linear from 12 s, capped at 30 s.",
      "Alternate primary/fallback model on every retry.",
      "12-second inter-lot delay on the server. Do not remove — it prevents Gemini 429s.",
      "Returns HTTP 200 even on individual lot failures — check results[0].status not res.ok.",
      "Check blockReason and finishReason before calling .text(). 503 from Gemini = transient, retry.",
      "Description lines: join with \\n not space. This has been broken before.",
      "Chat returns 422 (not 500) on content block.",
      "Model Tester: sequential only, 1-second gap between models.",
      "Duplicate checker groups by receiptUniqueId. Scoring determines which record to keep.",
    ],
  },

  // ─── CATALOGUING ──────────────────────────────────────────────────────────
  {
    key: "cataloguing",
    icon: "📂",
    name: "Cataloguing",
    path: "/tools/cataloguing",
    overview: "Full lot cataloguing system. Covers creating auctions, the lot wizard, photo upload, AI upgrades, lotting up against BC warehouse data, and research logging.",
    howItWorks: [
      {
        label: "Auction Manager",
        items: [
          "Create and manage CatalogueAuction records: code (unique), name, auctionDate, auctionType (GENERAL/DIECAST/TRAINS/VINYL/TV_FILM/MATCHBOX/COMICS/BEARS/DOLLS), eventName, and status flags: locked, finished, complete, published.",
          "published = true makes the auction and its lots visible on the public website.",
          "auctionDate must be set for the calendar sidebar on the public site to display the auction correctly.",
        ],
      },
      {
        label: "Lot Wizard",
        items: [
          "Step-by-step form: barcode scan → vendor lookup (against BC WarehouseItem) → categories → estimate → condition → key points → description.",
          "Barcode matched via two-way lookup (barcode, receiptUniqueId) — case-insensitive, trimmed.",
          "Title auto-extracted from first sentence of description, max 83 characters (truncated with …). Fallback: 'Untitled'.",
        ],
      },
      {
        label: "Photo Upload",
        items: [
          "Bulk upload — filenames parsed: strip extension, strip trailing _N suffix (F066001_2.jpg → F066001). Non-ASCII stripped before barcode detection.",
          "Photos stored in Cloudflare R2. Key format: lot-photos/{auctionId}/{identifier}-{timestamp}-{i}.{ext}.",
          "Up to 24 photos per lot. URLs stored as array in CatalogueLot.imageUrls.",
          "Two-way lot lookup checks barcode and receiptUniqueId.",
        ],
      },
      {
        label: "Tablet Cataloguing",
        items: [
          "Mobile-optimised view for warehouse floor work.",
          "Photo-only mode: scan barcode, photograph, done — no text fields required.",
          "Sessions logged to CataloguePhotoSession (status PENDING) for review later.",
        ],
      },
      {
        label: "AI Upgrade",
        items: [
          "Runs existing descriptions through Gemini to improve quality — result written to CatalogueLot.description.",
          "Lot History Generator: produces SEO paragraphs about manufacturer/item history, stored in CatalogueLot.extraDetails (TEXT field, added via migration).",
        ],
      },
      {
        label: "Lotting Up",
        items: [
          "Cross-references lots against BC WarehouseItem records to check which items have been received at the warehouse.",
          "Matches by receiptUniqueId (WarehouseItem.uniqueId ↔ CatalogueLot.receiptUniqueId).",
        ],
      },
      {
        label: "Research",
        items: [
          "Research tools for cataloguers. Active time per session logged to ResearchLog (userId, userName, durationMs, startedAt, savedAt).",
          "Research time feeds the Cataloguing Reports in Admin.",
        ],
      },
      {
        label: "Apply to Auction (from AI runs)",
        items: [
          "Route: /api/auction-ai/runs/[id]/apply",
          "Detects unique ID format /^[A-Za-z]\\d{4,7}-\\d{1,6}$/ → receiptUniqueId = lot.",
          "Otherwise → barcode = lot, receiptUniqueId = null.",
          "Deduplication: checks existingBarcodes and existingUniqueIds sets before creating. Returns count of created + skipped.",
        ],
      },
      {
        label: "Key server actions",
        items: [
          "createAuction(), updateAuction(), deleteAuction(), togglePublished().",
          "createLot() (wizard, uploads to R2), createPhotoOnlyLot(), updateLot(), deleteLot(), deleteLots().",
          "generateTitlesFromDescriptions() — auto-fills titles from keyPoints (83 char max).",
          "setStartingBids() — bulk update.",
          "applyAiDescriptions() / applyAiDescriptionOne() — bulk/single lot update from AI run.",
        ],
      },
    ],
    dependsOn: [
      "PostgreSQL — CatalogueAuction, CatalogueLot, CatalogueTimingLog, CataloguePhotoSession, ResearchLog tables",
      "Cloudflare R2 — lot photo storage (key: lot-photos/{auctionId}/…)",
      "Google Gemini API — AI Upgrade and Lot History Generator",
      "BC WarehouseItem — vendor lookup and Lotting Up",
    ],
    rules: [
      "Two identifier fields (receiptUniqueId, barcode) are NOT interchangeable. Never store a unique ID in barcode.",
      "Unique ID format: /^[A-Za-z]\\d{4,7}-\\d{1,6}$/ e.g. R000016-413. Barcode format: /^[A-Za-z]\\d{6,7}$/ e.g. F066001.",
      "Lot title max 83 chars, truncate with …, fallback 'Untitled'.",
      "Lot status values: ENTERED (default) | REVIEWED | PUBLISHED | SOLD | UNSOLD | WITHDRAWN.",
      "Auction types: GENERAL | DIECAST | TRAINS | VINYL | TV_FILM | MATCHBOX | COMICS | BEARS | DOLLS.",
      "Estimate regex: /£([\\d,]+)\\s*[–\\-]\\s*£?([\\d,]+)/ — en-dash or hyphen, optional £ on second value, strip commas.",
      "Bidding increment rounding: £0–50→£5; £50–200→£10; £200–700→£20; £700–1000→£50; £1000–3000→£100; £3000–7000→£200; £7000–10000→£500; £10000+→£1000.",
      "Photo filenames: strip extension, strip _N suffix, strip non-ASCII before barcode detection.",
      "Lot lookup map checks both identifier fields — barcode and receiptUniqueId (case-insensitive, trimmed).",
      "Description Copier: Folder = receiptUniqueId || barcode || ''.",
      "extraDetails column was added post-launch — added to run-migrations SQL as a safety net.",
    ],
  },

  // ─── BC WAREHOUSE ─────────────────────────────────────────────────────────
  {
    key: "bc-warehouse",
    icon: "🗺️",
    name: "BC Warehouse",
    path: "/tools/bc-warehouse",
    overview: "Business Central warehouse tools. Syncs items and totes from BC into local tables for fast querying. Provides a heatmap, sale checklist, location search, location history, tote analytics, sync control, and a raw data explorer.",
    howItWorks: [
      {
        label: "Heatmap",
        items: [
          "Visual aisle/bay/shelf grid coloured by fill level: empty, 1–2 items, 3–5, 6–9, 10+.",
          "Unlocated items count shown in a chip at the top.",
          "Filterable by aisle, auction code, cataloguing status.",
          "Location code pattern: e.g. A10A1 = aisle A10, bay A, shelf 1.",
        ],
      },
      {
        label: "Sale Checklist",
        items: [
          "Lists upcoming auctions. Expands each to show item locations, missing items, vendor, and withdrawal status.",
          "Uses WarehouseItem data — auction names resolved from WarehouseItem.auctionName (not CatalogueAuction).",
          "First load populates auctionName by filtering Auction_Lines_Excel by known EVA_UniqueID values then writing EVA_AuctionName back to the DB.",
        ],
      },
      {
        label: "Search by Location",
        items: [
          "Enter a warehouse location code to see all items and totes currently stored there.",
        ],
      },
      {
        label: "Location History",
        items: [
          "Two modes: Tote (default) and Barcode. Toggle buttons switch between them.",
          "Tote mode: queries BC ChangeLogEntries filtered by Field_Caption = 'Location' for the tote number.",
          "Barcode mode (two steps): first resolves barcode to BC item key via BC API, then fetches location changes filtered by Field_Caption = 'Article Location Code' for that item key.",
          "Results: From / To / Changed by / Date. Newest row is highlighted bg-blue-950/30.",
          "Staff names resolved via hardcoded SALESPERSON_NAMES lookup table in the component (40+ entries, e.g. AM → Ashley McIntyre).",
          "No-results state: styled card explaining the item may not have been moved or the change log wasn't active when it was.",
          "API route: /api/bc/location-history (NOT /api/warehouse/location-history).",
        ],
      },
      {
        label: "Tote Data",
        items: [
          "Analytics on active totes: counts by category, by location. Paginated for 150+ totes.",
        ],
      },
      {
        label: "Data Sync",
        items: [
          "Shows: item count, tote count, last sync time, running status. Stale threshold: 15 minutes (shown as warning).",
          "Four sync sources: receipt_lines (Receipt_Lines_Excel via EVA_SystemModifiedAt), auction_lines (Auction_Receipt_Lines_Excel), changelog (location changes), totes (Receipt_Totes_Excel).",
          "Sync strategy: each call to /api/warehouse/sync/receipt-lines processes 5 pages × 500 items = 2,500 items max, returning { itemsProcessed, more: boolean }. The client loops until more = false.",
          "Incremental sync: uses lastTimestamp (ISO string stored in WarehouseSyncLog) to resume from last EVA_SystemModifiedAt.",
          "WarehouseSyncLog tracks: source, startedAt, completedAt, status (running/complete/failed), itemsProcessed, lastTimestamp, error.",
          "Background cron runs every 12 hours. Manual sync available from this tab.",
        ],
      },
      {
        label: "DB Explorer",
        items: [
          "Raw search across local WarehouseItem and WarehouseTote tables for debugging sync issues.",
        ],
      },
    ],
    dependsOn: [
      "Business Central OData API — Receipt_Lines_Excel, Auction_Receipt_Lines_Excel, ChangeLogEntries, Receipt_Totes_Excel",
      "PostgreSQL — WarehouseItem, WarehouseTote, WarehouseSyncLog tables",
      "BCToken — per-user OAuth token (getBCTokenAny() used for sync/cron)",
    ],
    rules: [
      "DO NOT change the design or behaviour of the Location History tab. It was accidentally replaced in an earlier rewrite and manually restored.",
      "Location History route: /api/bc/location-history — NOT /api/warehouse/location-history.",
      "Auction names: use WarehouseItem.auctionName (DB). Do NOT use CatalogueAuction for BC warehouse views — it may be stale.",
      "To get auction names: filter Auction_Lines_Excel by known EVA_UniqueID values, read EVA_AuctionName, write back to DB.",
      "$apply=groupby is NOT supported by BC OData — do not use it.",
      "Auction_Lines_Excel is item-level (one row per lot) — never use $top alone to get auction names.",
      "BC fetch timeouts: 45 s total, 30 s per page. Page size: 500 ($top=500, Prefer: odata.maxpagesize=500).",
      "BC token refresh buffer: 60 seconds before expiry.",
      "getBCTokenAny() picks any valid non-expired token — no specific user needs to be logged into BC for sync/cron.",
      "WarehouseItem.uniqueId is the primary key — matches CatalogueLot.receiptUniqueId.",
      "Sync stale threshold: 15 minutes. Show warning if last sync > 15 min ago.",
    ],
  },

  // ─── BC REPORTS ───────────────────────────────────────────────────────────
  {
    key: "bc-reports",
    icon: "📊",
    name: "BC Reports",
    path: "/tools/bc-reports",
    overview: "Business Central analytics dashboard. Covers cataloguing activity per staff member, packing/dispatch records, warehouse metrics, and shipping geography. Data fetched from BC and cached locally.",
    howItWorks: [
      {
        label: "Cataloguing Report",
        items: [
          "Source: Auction_Receipt_Lines_Excel — fields EVA_CataloguedBy and EVA_CataloguedDateTime.",
          "Shows lots catalogued per person per day. Cached in BCCatalogueDay (full-day fetch marker) and BCCatalogueEntry (userId, date, count) tables.",
          "Only new dates are fetched from BC on subsequent loads.",
          "Metrics: daily average, total by user, monthly trend.",
        ],
      },
      {
        label: "Packing Report",
        items: [
          "Source: ShipmentRequestAPI and CollectionList BC endpoints.",
          "Grouped by staff member and document number. Cached in BCPackingDay / BCPackingEntry.",
          "Capacity modeller: configure staff count, sales/month, lots/sale, working days, collections/day to estimate backlog.",
          "Metrics: total lots packed, avg/day, active days, lots collected.",
        ],
      },
      {
        label: "Warehouse Report",
        items: [
          "Tote counts by category and cataloguer, item counts by status.",
          "Derived from local WarehouseItem and WarehouseTote sync (not a live BC call).",
        ],
      },
      {
        label: "ShipMaps",
        items: [
          "Visualises parcel destinations geographically — where items are being sent post-auction.",
          "Derived from packing/despatch data.",
        ],
      },
      {
        label: "Date presets",
        items: [
          "Last 7 days, Last 30 days, This month, Last month, Last 12 months, This year, Custom from/to picker.",
        ],
      },
      {
        label: "Export",
        items: [
          "XLSX export available via the xlsx library.",
        ],
      },
    ],
    dependsOn: [
      "Business Central OData API — Auction_Receipt_Lines_Excel, ShipmentRequestAPI, CollectionList",
      "PostgreSQL — BCCatalogueDay, BCPackingDay, BCCatalogueEntry, BCPackingEntry tables",
      "BCToken — getBCTokenAny() for system-level fetches",
    ],
    rules: [
      "BC fetch timeouts: 45 s total, 30 s per page. Page size 500.",
      "Token refresh buffer: 60 seconds before expiry.",
      "getBCTokenAny() used — no specific user needs to be logged into BC.",
      "Do not use CatalogueAuction for names in BC report views — use BC source data directly.",
      "$apply=groupby is NOT supported by BC OData.",
    ],
  },

  // ─── BC MARKETING ─────────────────────────────────────────────────────────
  {
    key: "bc-marketing",
    icon: "📰",
    name: "BC Marketing",
    path: "/tools/bc-marketing",
    overview: "Generates SEO-optimised news articles from BC auction results using Gemini AI. Filter sold lots by keyword, category, or date range, then generate editorial content in multiple styles.",
    howItWorks: [
      {
        label: "How it works",
        items: [
          "Filter lots from local WarehouseItem table by keyword (searches description/artist), category, and/or month/year of auction.",
          "Results sorted by hammer price (highest first). Choose how many to include (Top 5 to Top 50).",
          "Article types: Sale Highlight, News Story, Collector's Guide, Market Report.",
          "Lots sent to Gemini with article type and system instruction preset — Gemini writes HTML output.",
          "Copy as plain text or raw HTML for CMS / email.",
          "Model is user-selectable from the available Gemini model list.",
          "System instruction presets customisable and stored per user (AiPreset table).",
        ],
      },
    ],
    dependsOn: [
      "Google Gemini API",
      "PostgreSQL — WarehouseItem table (BC auction data synced locally)",
    ],
    rules: [
      "Lot links to the public Vectis website cannot be auto-generated — the site URL structure contains internal IDs not present in BC data.",
    ],
  },

  // ─── BC API VIEWER ────────────────────────────────────────────────────────
  {
    key: "bc-api-viewer",
    icon: "🔍",
    name: "BC API Viewer",
    path: "/tools/bc-api-viewer",
    overview: "Developer tool for inspecting BC OData endpoints directly. Enter any endpoint path and see field names and sample data. Useful for building new BC integrations or debugging.",
    howItWorks: [
      {
        label: "How it works",
        items: [
          "Enter any BC endpoint path (e.g. Auction_Lines_Excel, Receipt_Lines_Excel).",
          "Server authenticates with BC using getBCTokenAny() and fetches a sample of records.",
          "Results shown as a structured table with all field names and values.",
          "Base BC URL: https://api.businesscentral.dynamics.com/v2.0/{tenantId}/{environment}/ODataV4/Company('Vectis')/",
        ],
      },
    ],
    dependsOn: [
      "Business Central OData API",
      "BCToken — getBCTokenAny(), no specific user needed",
    ],
    rules: [
      "Requires BC_WAREHOUSE app permission — not visible to general users.",
    ],
  },

  // ─── WAREHOUSE (INTERNAL) ────────────────────────────────────────────────
  {
    key: "warehouse",
    icon: "🏭",
    name: "Warehouse (Internal)",
    path: "/tools/warehouse",
    overview: "Internal Vectis warehouse management for tracking physical items independent of Business Central. Manages inbound receipts, container locations, and movement history.",
    howItWorks: [
      {
        label: "Sub-sections",
        items: [
          "Dashboard: stats (customer count, receipt count, open receipts, container count) and last 10 movements.",
          "Inbound: log new receipts and containers arriving; link to a Contact record.",
          "Locate: find where a specific container or item is by ID.",
          "Lookup Location: browse all containers and items at a specific location code.",
          "Customers: receipt history per customer — manager+ role.",
          "Receipts: full list with containers and print functionality — manager+ role.",
          "History: movement audit log (who moved what, when) — manager+ role.",
          "Reports: warehouse statistics and summaries — admin role only.",
        ],
      },
    ],
    dependsOn: [
      "PostgreSQL — WarehouseReceipt, WarehouseContainer, WarehouseLocation, WarehouseMovement, Contact tables",
    ],
    rules: [
      "Three warehouse sub-roles: warehouse (Inbound/Locate/Lookup only), manager (+ Customers/Receipts/History), admin (full + Reports).",
      "Warehouse sub-role is set per-user in App Access & Permissions via appPermissions JSON, separate from the main system role.",
      "Receipt status: open or closed.",
    ],
  },

  // ─── SUBMISSIONS ──────────────────────────────────────────────────────────
  {
    key: "crm",
    icon: "📋",
    name: "Submissions",
    path: "/submissions",
    overview: "Customer submission management for the Collections team. Tracks items from initial enquiry through valuation, customer decision, and logistics.",
    howItWorks: [
      {
        label: "Submission workflow",
        items: [
          "Collections creates a submission for a customer — contact channel: EMAIL, WEB_FORM, PHONE, or WALK_IN.",
          "Assigned to a department and cataloguer (PENDING_ASSIGNMENT → PENDING_VALUATION).",
          "Cataloguer adds a Valuation per item (estimatedValue + comments).",
          "Collections contacts the customer and logs outcome via ContactLog (method, notes, outcome, isFollowUp flag).",
          "If DECLINED: moves to FOLLOW_UP queue with followUpCount and lastFollowUpAt tracked.",
          "If APPROVED: logistics arranged — SENT_IN (customer posts items) or COLLECTION (Vectis collects from customer address).",
          "Status continues: COLLECTION_PENDING → ARRIVED → COMPLETED.",
        ],
      },
      {
        label: "Status filter & list",
        items: [
          "Filter by status, channel, department, name/reference search.",
          "Row shows: first 8 chars of reference, contact name, channel, item count, department, status badge, date.",
          "Delete available to ADMIN and COLLECTIONS roles only.",
        ],
      },
      {
        label: "Data models",
        items: [
          "Submission: reference, channel, status, notes, followUpCount, lastFollowUpAt, contactId, departmentId, cataloguerId, createdById.",
          "Item (SubmissionItem): name, description, imageUrls[], submissionId.",
          "Valuation: estimatedValue, comments, itemId (unique — one valuation per item), cataloguerId.",
          "ContactLog: method, notes, outcome, isFollowUp, submissionId, userId.",
          "Logistics: type (SENT_IN/COLLECTION), arrived (boolean), arrivedAt, collection address fields, submissionId (unique).",
        ],
      },
    ],
    dependsOn: [
      "PostgreSQL — Submission, Item, Valuation, ContactLog, Logistics, Contact, Department tables",
    ],
    rules: [
      "Status flow: PENDING_ASSIGNMENT → PENDING_VALUATION → VALUATION_COMPLETE → PENDING_CUSTOMER_DECISION → APPROVED/DECLINED → FOLLOW_UP → COLLECTION_PENDING → ARRIVED → COMPLETED.",
      "Logistics types: SENT_IN or COLLECTION.",
      "Contact channels: EMAIL, WEB_FORM, PHONE, WALK_IN.",
      "ADMIN and COLLECTIONS can create/delete submissions. CATALOGUER can only add valuations.",
    ],
  },

  // ─── CUSTOMERS ────────────────────────────────────────────────────────────
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
          "Search by name, phone, email, postcode, address, or ID. 50 results per page.",
          "Create new customers via modal. Salutation options: Mr, Mrs, Ms, Miss, Dr, Prof.",
        ],
      },
      {
        label: "Customer detail overlay (4 tabs)",
        items: [
          "Details: salutation, name, contact info, address, notes, isSeller and isBuyer flags. Save button.",
          "Seller/Warehouse: linked warehouse receipts with status, containers, link to warehouse tool.",
          "Buyer/CRM: linked submissions with status, channel, date, link to submission.",
          "Documents: print receipt, auction pre/post-sale advice, vendor statements.",
        ],
      },
    ],
    dependsOn: [
      "PostgreSQL — Contact, WarehouseReceipt, Submission, CustomerAccount tables",
      "BC sync for initial contact data",
    ],
    rules: [],
  },

  // ─── DATABASES ────────────────────────────────────────────────────────────
  {
    key: "databases",
    icon: "🗄️",
    name: "Databases",
    path: "/databases",
    overview: "Read-only search across seven major data tables. High row limits for bulk data review.",
    howItWorks: [
      {
        label: "Seven tabs",
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

  // ─── PACKING ──────────────────────────────────────────────────────────────
  {
    key: "packing",
    icon: "📦",
    name: "Packing / Dispatch",
    path: "/tools/packing",
    overview: "Royal Mail shipping label generation and end-of-day manifest management for auction lot dispatch. Integrates with Royal Mail Click & Drop.",
    howItWorks: [
      {
        label: "Parcel lifecycle",
        items: [
          "Create a parcel: recipient name, company, address line 1/2/3, city, county, postcode, email, phone.",
          "Select package format (Letter, LargeLetter, SmallParcel, MediumParcel) and service code.",
          "Assign CatalogueLots to the parcel via ParcelLot join table.",
          "Submit to Royal Mail Click & Drop API — returns trackingNumber and labelPdf (stored as TEXT).",
          "Status progression: PENDING → LABEL_CREATED → DISPATCHED → CANCELLED.",
        ],
      },
      {
        label: "Royal Mail services",
        items: [
          "TPNN — Tracked 24 No Signature. TPNS — Tracked 24 Signature. TPSN — Tracked 48 No Signature. TPSS — Tracked 48 Signature.",
          "FEO — Express 48. FEM — Express 48 Medium. NDA — Express 24.",
          "SD* — Special Delivery tiers (SDA/SDB/SDC/SDD) for high-value items.",
          "Default: service TPSS (Tracked 48 Signature), format Parcel, weight 500 g.",
          "Minimum required: recipient name, address line 1, city, postcode.",
        ],
      },
      {
        label: "End-of-day manifest",
        items: [
          "All LABEL_CREATED parcels batched into one manifest submission to Royal Mail.",
          "Route: POST /api/parcels/manifest — marks parcels as DISPATCHED and stores manifestId.",
        ],
      },
      {
        label: "Parcel tabs",
        items: [
          "All, Pending, Label Ready, Dispatched — filter by parcel status.",
        ],
      },
    ],
    dependsOn: [
      "Royal Mail Click & Drop API — label generation, tracking, manifest submission",
      "PostgreSQL — Parcel, ParcelLot, CatalogueLot, CustomerAccount tables",
    ],
    rules: [
      "Parcel status: PENDING → LABEL_CREATED → DISPATCHED → CANCELLED.",
      "Default service: TPSS (Tracked 48 Sig). Default format: Parcel. Default weight: 500 g.",
      "Minimum required fields: name, address line 1, city, postcode.",
      "labelPdf stored as TEXT (Base64) in the Parcel table.",
    ],
  },

  // ─── WEBSITE ──────────────────────────────────────────────────────────────
  {
    key: "website",
    icon: "🌐",
    name: "Website",
    path: "/website",
    overview: "Admin interface for the public-facing Vectis auction website. The public site runs on /(site) routes within the same Next.js app. Buyers browse lots, register to bid, and place commission bids.",
    howItWorks: [
      {
        label: "Public site — /(site) routes",
        items: [
          "/ — home: hero banner (HeroSlide table), published auctions list.",
          "/auctions — all published CatalogueAuctions.",
          "/auctions/[code] — auction detail with lot grid, live bidding room when ACTIVE.",
          "/auctions/[code]/lot/[lotId] — lot detail, commission bid placement.",
          "/portal/login, /portal/register — customer auth.",
          "/account/* — customer portal: profile, bid history, sales history.",
          "/search — lot search across all published auctions.",
          "/how-to-bid, /faq, /sell-with-us, /terms, /careers — static info pages.",
          "Lots appear only when their CatalogueAuction has published = true.",
        ],
      },
      {
        label: "Website Admin section tabs",
        items: [
          "Website Preview: live iframe of the public site (Home/Auctions/Login/Register/Account) — check published content without leaving the admin panel.",
          "Back End Controller: live auction control interface embedded as an iframe.",
          "Banner Manager: create, edit, and reorder HeroSlide records for the homepage carousel.",
        ],
      },
      {
        label: "Live auction room",
        items: [
          "Buyer-facing page at /auctions/[code]/live — receives real-time updates via Socket.IO.",
          "Shows current lot, current bid, lot image, and optional WebRTC camera feed from the clerk.",
          "Online bidder count tracked via Socket.IO connection events.",
        ],
      },
    ],
    dependsOn: [
      "PostgreSQL — CatalogueAuction, CatalogueLot, CustomerAccount, BidderRegistration, CommissionBid, LiveAuction, HeroSlide tables",
      "Socket.IO — real-time events between auction controller and buyer room",
      "WebRTC — clerk camera broadcast to buyers",
    ],
    rules: [
      "Lots are only visible on the public site when auction published = true.",
      "auctionDate must be set on CatalogueAuction for the public site calendar to show it.",
      "CustomerAccount is separate from staff User — do not confuse them.",
    ],
  },

  // ─── AUCTION CONTROLLER ───────────────────────────────────────────────────
  {
    key: "auction-controller",
    icon: "🔨",
    name: "Auction Controller",
    path: "/auction-controller",
    overview: "Live auction clerking panel. The clerk controls lot progression and bid increments; the system handles auto-bids and real-time updates to the buyer room via Socket.IO.",
    howItWorks: [
      {
        label: "Pre-sale",
        items: [
          "Clerk authenticates with a separate clerk password (not the staff login).",
          "Select a published auction to operate. LiveAuction record set to ACTIVE.",
        ],
      },
      {
        label: "During the sale",
        items: [
          "Navigate lots sequentially or jump to a specific lot number.",
          "Bid sources: Room, Telephone, Invaluable, Saleroom, Online. Online bids require manual acceptance.",
          "Auto-bids (CommissionBid records placed in advance by buyers) processed automatically up to the buyer's maximum, using the standard increment table.",
          "Fair Warning button, then Hammer button. Sold popup auto-advances after 3 seconds.",
          "Clerk can pause and display a custom pauseMessage to viewers.",
          "Recent results panel: last 10 sold lots with hammer prices.",
        ],
      },
      {
        label: "Socket.IO events",
        items: [
          "clerk:auth / clerk:auth:ok / clerk:auth:fail — login.",
          "clerk:loadAuctions / clerk:auctions — auction selection.",
          "clerk:auctionLoaded — transition to control panel.",
          "auction:state — full state push (auction meta, current lot, lots summary, online bidder count).",
          "lot:hammer — lot sold; buyer room receives hammer event.",
          "auction:fairWarning — fair warning alert to buyer room.",
          "bid:online — online bid alert (requires clerk acceptance).",
          "webrtc:offer / webrtc:answer / webrtc:ice — WebRTC signalling between clerk and viewers.",
        ],
      },
      {
        label: "Auction state object",
        items: [
          "status (PENDING/ACTIVE/PAUSED/COMPLETE), currentLotIndex (0-based), fairWarning (boolean), pauseMessage.",
          "Current lot: id, lotNumber (mapped from barcode for socket protocol compatibility), title, description, imageUrls[], estimateLow, estimateHigh, status, currentBid, askingBid, increment, hammerPrice, bids[].",
          "Bid entry: amount, type, bidderId, bidderName, timestamp.",
        ],
      },
      {
        label: "Camera broadcast (WebRTC)",
        items: [
          "getUserMedia() captures clerk camera.",
          "RTCPeerConnection broadcasts to buyer room viewers via ICE/SDP signalling on Socket.IO.",
          "30-second connection timeout. ICE servers negotiated via config.",
        ],
      },
      {
        label: "Server restart recovery",
        items: [
          "On server restart, any LiveAuction with status ACTIVE or PAUSED is automatically reset to PENDING.",
          "This prevents a stale live banner showing on the public site after a crash or redeploy.",
        ],
      },
    ],
    dependsOn: [
      "Socket.IO — real-time bidding events (clerk ↔ buyer room ↔ server)",
      "PostgreSQL — LiveAuction, CatalogueLot, CommissionBid, BidderRegistration tables",
      "WebRTC — clerk camera broadcast to buyers",
    ],
    rules: [
      "LiveAuction status: PENDING | ACTIVE | PAUSED | COMPLETE.",
      "Server restart resets ACTIVE/PAUSED auctions to PENDING automatically.",
      "Bidding increments: £0–50→£5; £50–200→£10; £200–700→£20; £700–1000→£50; £1000–3000→£100; £3000–7000→£200; £7000–10000→£500; £10000+→£1000.",
      "Auto-advance after hammer: 3 seconds. Do not change — buyers rely on consistent timing.",
    ],
  },

  // ─── SALEROOM TRAINER ─────────────────────────────────────────────────────
  {
    key: "saleroom-trainer",
    icon: "🎓",
    name: "Saleroom Trainer",
    path: "/tools/saleroom-trainer",
    overview: "Interactive training simulator for new saleroom clerks. Practise clerking without touching production data.",
    howItWorks: [
      {
        label: "How it works",
        items: [
          "Loads an embedded HTML5 training module (saleroom-trainer.html).",
          "Presents simulated lots with estimates, asks trainee to manage bidding.",
          "Tracks correct/incorrect bid increments, timing, hammer decisions.",
          "No data written to any production table — all state is session-local.",
        ],
      },
    ],
    dependsOn: [
      "No external dependencies — fully self-contained HTML5 simulation",
    ],
    rules: [],
  },

  // ─── AI PRESENTER ─────────────────────────────────────────────────────────
  {
    key: "ai-presenter",
    icon: "🎙️",
    name: "AI Presenter",
    path: "/tools/avatar",
    overview: "Realistic AI avatar presenter that reads lot descriptions aloud with lip-sync, powered by D-ID via WebRTC. Can auto-read from the auction controller screen in real time.",
    howItWorks: [
      {
        label: "Manual mode",
        items: [
          "Select a presenter from the D-ID library (3-column thumbnail gallery).",
          "Presenter records use presenter_id or fallback id field — both handled.",
          "Type any text and click Speak — avatar reads it via TTS with synchronised lip movement streamed back via WebRTC.",
          "Connection states: Idle → Connecting → Connected → Speaking → Error.",
          "Connection timeout: 30 seconds.",
          "20-second keepalive heartbeat keeps the stream alive (D-ID drops idle streams after ~30 s).",
        ],
      },
      {
        label: "D-ID API actions",
        items: [
          "presenters — list available presenters with thumbnails.",
          "create — start new WebRTC stream session (returns stream id, session_id, SDP offer, ICE servers).",
          "delete — stop the stream.",
          "keepalive — heartbeat (must fire every 20 s while connected).",
          "ice — submit ICE candidate.",
          "speak — trigger TTS for given text (async, emits event when done).",
        ],
      },
      {
        label: "Auto-Read (Screen Sharing)",
        items: [
          "Share the auction controller browser tab.",
          "Gemini vision reads lot number, current bid, and asking bid every 4 seconds.",
          "Max 2 FPS capture, downscaled to max 1280 px wide before sending to Gemini.",
          "When lot number changes, the presenter automatically speaks the new lot description.",
          "Speech duration estimated as Math.ceil((wordCount / 140) × 60000) + 2000 ms.",
          "Read count and last read timestamp tracked. Error state shown if vision fails.",
        ],
      },
    ],
    dependsOn: [
      "D-ID API — presenter library, WebRTC stream, SDP/ICE, keepalive, speak",
      "Google Gemini API — vision reading of auction controller screen (auto-read mode)",
      "WebRTC — peer connection for video/audio stream from D-ID to browser",
    ],
    rules: [
      "Keepalive must fire every 20 s. D-ID drops streams after ~30 s of silence.",
      "Auto-read: max 2 FPS, max 1280 px wide. Do not increase — higher rates burn Gemini quota.",
      "Presenter records may use presenter_id or id field — both must be supported.",
      "Connection timeout: 30 seconds. Show error state if exceeded.",
    ],
  },

  // ─── ADMIN ────────────────────────────────────────────────────────────────
  {
    key: "admin",
    icon: "⚙️",
    name: "Admin",
    path: "/admin",
    overview: "System administration area. ADMIN role only. Covers user management, app permissions, role defaults, home page customisation, cataloguing reports, database migrations, and this documentation.",
    howItWorks: [
      {
        label: "Users & Permissions",
        items: [
          "Create users: role-default permissions (RoleDefault table) auto-applied for COLLECTIONS and CATALOGUER roles on creation.",
          "Edit: name, email, username, role, departmentId, allowedApps[], appPermissions (JSON).",
          "appPermissions JSON shape: Record<string, { role: string }> — e.g. { warehouse: { role: 'manager' } }.",
          "App access and hub cards are grouped by section (Cataloguing & AI, Business Central, Operations, Auction) to match the hub page layout.",
          "Change password: admin sets new password (bcrypt 12 rounds).",
        ],
      },
      {
        label: "Role Defaults",
        items: [
          "Set default allowedApps[] and appPermissions per role (COLLECTIONS, CATALOGUER) in the RoleDefault table.",
          "Applied automatically on createUser() for non-admin roles.",
          "Push to existing users: all at once or pick-mode (select individual users).",
          "Routes: GET/PUT /api/admin/role-defaults, POST /api/admin/role-defaults/apply.",
        ],
      },
      {
        label: "Home Page",
        items: [
          "Drag-to-reorder hub cards, toggle visibility, mark as featured/pinned, customise labels and descriptions.",
          "Card state stored in AppCard table: key, order, visible, pinned, label, description.",
        ],
      },
      {
        label: "Departments",
        items: [
          "Manage cataloguer departments (Department table, name unique) used when assigning submissions.",
        ],
      },
      {
        label: "Cataloguing Reports",
        items: [
          "Time-per-lot statistics: average speed, method breakdown (WIZARD vs PHOTO_ONLY), recent session activity.",
          "Data from CatalogueTimingLog (userId, userName, method, durationMs, keyPointsMs, lotId, auctionId, savedAt).",
          "Research session time from ResearchLog (userId, userName, durationMs, startedAt, savedAt).",
        ],
      },
      {
        label: "Run Migrations",
        items: [
          "POST /api/admin/run-migrations — admin-only. Runs SQL from MIGRATIONS array in sequence.",
          "All statements use IF NOT EXISTS — safe to re-run at any time, will never drop or modify existing data.",
          "Current migrations in the array:",
          "1. ALTER TABLE CatalogueLot ADD COLUMN IF NOT EXISTS extraDetails TEXT",
          "2. CREATE TABLE IF NOT EXISTS RoleDefault (role TEXT PRIMARY KEY, allowedApps TEXT[], appPermissions JSONB NOT NULL DEFAULT '{}')",
        ],
      },
      {
        label: "Claude Memory",
        items: [
          "Reads Claude's memory .md files from ~/.claude/projects/C--Dev-apps/memory/ via Node.js fs/promises.",
          "Parses YAML frontmatter (name, type, description). Renders body with basic markdown. Type badges colour-coded: user=blue, feedback=amber, project=green, reference=purple.",
          "Returns { unavailable: true } if directory not found — shows a notice on Railway.",
        ],
      },
    ],
    dependsOn: [
      "PostgreSQL — User, Department, AppCard, RoleDefault, CatalogueTimingLog, ResearchLog tables",
      "NextAuth v5 — session and role enforcement",
      "bcrypt — password hashing (12 rounds)",
      "Node.js fs/promises — Claude memory file reading (local only)",
    ],
    rules: [
      "it@vectis.co.uk is always ADMIN — hardcoded in auth.ts, cannot be changed via UI.",
      "ADMIN users have access to all apps — allowedApps[] is ignored for ADMINs.",
      "User roles: ADMIN, COLLECTIONS, CATALOGUER.",
      "New users automatically receive role-default permissions from RoleDefault table.",
      "Prisma migrate deploy runs on startup via server.js. If it fails silently, use the Run Migrations button.",
      "Every new DB migration must also be added to the MIGRATIONS array in /api/admin/run-migrations so it can be applied manually.",
      "All SQL in MIGRATIONS must use IF NOT EXISTS — the endpoint must be safe to re-run at any time.",
    ],
  },

  // ─── DATABASE SCHEMA ─────────────────────────────────────────────────────
  {
    key: "schema",
    icon: "🗃️",
    name: "Database Schema",
    path: "/admin",
    overview: "Reference for every Prisma model and its key fields. All models live in a single PostgreSQL database on Neon, accessed via Prisma 7 with the @prisma/adapter-pg adapter.",
    howItWorks: [
      {
        label: "Prisma setup",
        items: [
          "Prisma 7 with @prisma/adapter-pg — adapter required, no direct DATABASE_URL in client constructor.",
          "prisma generate runs as part of npm run build.",
          "prisma migrate deploy runs on startup via server.js. DATABASE_URL not available at build time.",
          "Client generated at app/generated/prisma/.",
          "DATABASE_URL, AUTH_SECRET, NEXTAUTH_URL set in Railway Variables.",
        ],
      },
      {
        label: "Staff & Auth models",
        items: [
          "User: id, email (unique), username (unique), password (bcrypt), role (ADMIN/COLLECTIONS/CATALOGUER), allowedApps[], appPermissions (JSON), departmentId.",
          "Department: id, name (unique).",
          "BCToken: userId, accessToken, refreshToken, expiresAt — per-user BC OAuth2 token.",
          "RoleDefault: role (PK), allowedApps[], appPermissions (JSONB).",
          "AppCard: key (PK), order, visible, pinned, label, description.",
        ],
      },
      {
        label: "Auction AI models",
        items: [
          "AuctionRun: id, code (unique), preset, createdAt, updatedAt.",
          "AuctionLot: id, lot (identifier), description, estimate, originalDescription, keyPoints, missing, added, runId. Upserted by (runId, lot) to prevent duplicates.",
          "AiPreset: key (PK string), instruction (TEXT), updatedAt.",
          "MacroFile: id, name, filename, description (TEXT), content (Bytes), mimeType, size.",
        ],
      },
      {
        label: "Cataloguing models",
        items: [
          "CatalogueAuction: id, code (unique), name, auctionDate, auctionType, eventName, locked, finished, complete, published, notes.",
          "CatalogueLot: id, barcode, receiptUniqueId, title (83 char max), description (TEXT), keyPoints, estimateLow, estimateHigh, startingBid, reserve, currentBid, hammerPrice, condition, vendor, tote, receipt, category, subCategory, brand, notes, extraDetails (TEXT), imageUrls[], status (ENTERED/REVIEWED/PUBLISHED/SOLD/UNSOLD/WITHDRAWN), aiUpgraded, createdByName, auctionId.",
          "CatalogueTimingLog: auctionId, lotId, userId, userName, method (WIZARD/PHOTO_ONLY), durationMs, keyPointsMs, savedAt.",
          "CataloguePhotoSession: auctionId, lotBarcode, customerRef, barcodePhotoKey, itemPhotoKeys[], notes, status (PENDING), createdById, createdByName.",
        ],
      },
      {
        label: "BC Warehouse models",
        items: [
          "WarehouseItem: uniqueId (PK, e.g. R000006-1), receiptNo, articleNo, stockNo, barcode, description/artist/category/subcategory, vendorNo, vendorName, auctionCode, auctionName, auctionDate, lotNo, currentLotNo, lowEstimate, highEstimate, hammerPrice, reservePrice, location, binCode, toteNo, catalogued, cataloguedBy, cataloguedAt, noOfPhotos, goodsReceived, goodsReceivedDate, collected, withdrawLot, bcModifiedAt.",
          "WarehouseTote: toteNo (unique), location, receiptNo, vendorNo, vendorName, status, catalogued, syncedAt.",
          "WarehouseSyncLog: id, source, startedAt, completedAt, status (running/complete/failed), itemsProcessed, lastTimestamp, error.",
          "WarehouseReceipt: id, contactId, commissionRate, notes, status.",
          "WarehouseContainer: id, type, description, category, subcategory, receiptId.",
          "WarehouseLocation: id, code (unique).",
          "WarehouseMovement: id, containerId, location (code), notes, movedByName, movedAt.",
        ],
      },
      {
        label: "Submissions models",
        items: [
          "Submission: id, reference, channel, status, notes, followUpCount, lastFollowUpAt, contactId, departmentId, cataloguerId, createdById.",
          "Item: id, name, description, imageUrls[], submissionId.",
          "Valuation: id, estimatedValue, comments, itemId (unique — one per item), cataloguerId.",
          "ContactLog: id, method, notes, outcome, isFollowUp, submissionId, userId.",
          "Logistics: id, type (SENT_IN/COLLECTION), arrived, arrivedAt, address fields, submissionId (unique).",
          "Contact: id, salutation, name, email, phone, address lines, postcode, notes, isSeller, isBuyer.",
        ],
      },
      {
        label: "Public site & auction models",
        items: [
          "CustomerAccount: id, email (unique), password (bcrypt), firstName, lastName, phone, sessionToken, contactId, shipping/billing address fields, billingSameAsShipping.",
          "BidderRegistration: auctionId, customerAccountId, contactId, acceptedTerms, registeredAt. Unique on (auctionId, customerAccountId).",
          "CommissionBid: lotId, customerAccountId, maxBid, contactId, notes, placedAt. Unique on (lotId, customerAccountId).",
          "LiveAuction: id, auctionId (unique), status (PENDING/ACTIVE/PAUSED/COMPLETE), currentLotIndex.",
          "HeroSlide: id, order, title, subtitle, cta, ctaHref, imageKey, active.",
        ],
      },
      {
        label: "BC Reports & Packing models",
        items: [
          "BCCatalogueDay: date (YYYY-MM-DD), fetchedAt.",
          "BCCatalogueEntry: date, userId, count. Composite PK (date, userId).",
          "BCPackingDay: date, fetchedAt.",
          "BCPackingEntry: date, staff, docNo, lotCount. Composite PK (date, staff, docNo).",
          "Parcel: id, reference (unique), status, recipient fields, weightInGrams, packageFormat, serviceCode, specialInstructions, notes, rmOrderIdentifier, trackingNumber, labelPdf (TEXT), manifestId, despatchedAt, customerAccountId, createdByName.",
          "ParcelLot: parcelId, lotId. Unique constraint.",
          "ResearchLog: id, userId, userName, durationMs, startedAt, savedAt.",
        ],
      },
    ],
    dependsOn: [
      "PostgreSQL on Neon",
      "Prisma 7 with @prisma/adapter-pg",
      "Railway — DATABASE_URL set as environment variable",
    ],
    rules: [
      "Prisma generate runs at build time (npm run build). prisma migrate deploy runs at startup.",
      "DATABASE_URL is NOT available at build time on Railway — only at runtime.",
      "Every new migration must also be added to /api/admin/run-migrations as a safety net.",
      "All run-migrations SQL must use IF NOT EXISTS — safe to re-run at any time.",
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
        a.howItWorks.some(s => s.label.toLowerCase().includes(q) || s.items.some(i => i.toLowerCase().includes(q))) ||
        a.dependsOn.some(d => d.toLowerCase().includes(q))
      )
    : APPS

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">About — How the App Works</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Documentation for every section — what it does, what it relies on, and the rules that must be followed.
        </p>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search apps, rules, dependencies…"
          className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
        <button onClick={expandAll}   className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-gray-300 dark:hover:border-gray-600 transition-colors">Expand all</button>
        <button onClick={collapseAll} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-gray-300 dark:hover:border-gray-600 transition-colors">Collapse all</button>
      </div>

      <div className="flex flex-col gap-3">
        {filtered.length === 0 && (
          <p className="text-sm text-gray-400 italic py-8 text-center">No apps match your search.</p>
        )}

        {filtered.map(app => {
          const open = openKeys.has(app.key)
          return (
            <div key={app.key} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
              <button
                onClick={() => toggle(app.key)}
                className="w-full flex items-center gap-4 px-6 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              >
                <span className="text-2xl">{app.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{app.name}</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">{app.path}</span>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 leading-snug line-clamp-2">{app.overview}</p>
                </div>
                <Chevron open={open} />
              </button>

              {open && (
                <div className="border-t border-gray-100 dark:border-gray-700 px-6 py-5 space-y-6">

                  {app.howItWorks.map(section => (
                    <div key={section.label}>
                      <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">{section.label}</h3>
                      <ul className="space-y-2">
                        {section.items.map((item, i) => (
                          <li key={i} className="flex gap-3 text-sm text-gray-700">
                            <span className="text-gray-300 dark:text-gray-600 mt-0.5 shrink-0">–</span>
                            <span className="leading-relaxed text-gray-700 dark:text-gray-300">{item}</span>
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
                          <span className="text-gray-700 dark:text-gray-300 leading-relaxed">{dep}</span>
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
                            <span className="text-gray-700 dark:text-gray-300 leading-relaxed">{rule}</span>
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
