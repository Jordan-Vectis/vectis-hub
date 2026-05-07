"use client"

import { useState } from "react"
import { auth } from "@/auth"

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
    overview: "Generates professional lot descriptions and key points from photographs using Google Gemini AI. Supports bulk batch runs across an entire auction or individual chat-style sessions for single lots.",
    howItWorks: [
      {
        label: "Batch Run",
        items: [
          "Upload photos named by barcode or unique ID (e.g. F066001.jpg, R000016-413_2.jpg). The filename determines which lot the photo belongs to.",
          "Select an auction code. The system loads all lots for that auction and matches photos to them by filename.",
          "Click Run — the server sends each lot's photos to Gemini with the configured AI preset instructions, waits 12 seconds between lots to stay within rate limits, then saves the result directly to the CatalogueLot record.",
          "The client shows live progress. If Gemini returns a rate-limit error, it retries with exponential back-off (60 s → 120 s → 240 s … up to 30 minutes) and alternates between primary and fallback models.",
          "The run only truly fails a lot if the user clicks Cancel or Gemini blocks the content (content blocks never succeed on retry).",
        ],
      },
      {
        label: "Chat Tab",
        items: [
          "Single-lot chat with Gemini — upload up to 6 images and have a free-form conversation to refine a description.",
          "Conversation history is maintained for the session so follow-up messages have context.",
        ],
      },
      {
        label: "Description Copier",
        items: [
          "Loads lot data (preloaded from the Cataloguing page via localStorage key copier_preload) and lets you copy descriptions individually or in bulk.",
          "Sort order is configurable: Unique ID, Barcode, or Lot Number.",
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
      "Railway file storage for uploaded photos (temp, per-request)",
    ],
    rules: [
      "Max 24 images per lot in batch mode; max 6 in chat mode.",
      "Server route maxDuration is 300 seconds. Client retry loop is infinite — never give up on rate limits or transient errors.",
      "Rate-limit backoff: exponential starting at 60 s, capped at 30 minutes. Other errors: linear starting at 12 s, capped at 30 s.",
      "Alternate between primary and fallback model on every retry so if one is still rate-limited the other gets a chance.",
      "12-second delay between lots on the server to stay within Gemini quota.",
      "The batch route returns HTTP 200 even when individual lots fail — always check results[0].status, not res.ok.",
      "Always check response.promptFeedback?.blockReason and response.candidates?.[0]?.finishReason before calling .text(). Calling .text() on a blocked response throws and loses the reason.",
      "Description lines must be joined with \\n, never with a space. Collapsing to a space destroys list and paragraph formatting.",
      "503 errors from Gemini are transient — retry, do not surface as permanent failure.",
      "Content blocks (SAFETY, etc.) abort the lot immediately and are shown as FAILED — they will never succeed on retry.",
      "FAILED status should only appear if the user explicitly cancels a lot mid-run.",
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
          "Create and manage CatalogueAuction records. Each auction has a code, name, date, type (General, Diecast, Trains, etc.) and status flags (locked, finished, complete, published).",
          "Once published, the auction and its lots appear on the public website.",
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
        label: "Photo Upload",
        items: [
          "Bulk photo upload with automatic filename-to-lot matching.",
          "Filenames are parsed: strip extension, strip trailing _N suffix (e.g. F066001_2.jpg → F066001).",
        ],
      },
      {
        label: "Lotting Up",
        items: [
          "Cross-references lots against BC warehouse data to check which items have been received.",
        ],
      },
      {
        label: "Research",
        items: [
          "Research tools for cataloguers — time spent here is logged for reporting.",
        ],
      },
    ],
    dependsOn: [
      "PostgreSQL — CatalogueAuction, CatalogueLot, CataloguePhotoSession, CatalogueTimingLog tables",
      "Google Gemini API — AI Upgrade and Lot History Generator tabs",
      "BC warehouse data (WarehouseItem) — for vendor lookup and Lotting Up",
      "Railway/S3 storage — lot photos",
    ],
    rules: [
      "Lot title maximum is 83 characters — truncate with … if exceeded.",
      "Three identifier fields exist and are NOT interchangeable: receiptUniqueId (format: R000016-413), barcode (format: F066001), lotNumber (integer string). Never store a unique ID in lotNumber.",
      "Lots created via Apply to Auction from AI runs will have an empty lotNumber — this is correct. A lot with receiptUniqueId is fully identified.",
      "Lot status values: ENTERED | REVIEWED | PUBLISHED | SOLD | UNSOLD | WITHDRAWN. Default on creation: ENTERED.",
      "Auction types: GENERAL | DIECAST | TRAINS | VINYL | TV_FILM | MATCHBOX | COMICS | BEARS | DOLLS.",
      "Estimate regex: /£([\\d,]+)\\s*[–\\-]\\s*£?([\\d,]+)/ — accepts en-dash and hyphen, optional £ on second value.",
      "Description Copier: Folder field must always be receiptUniqueId || lotNumber — never lotNumber alone. Lots from Apply to Auction have empty lotNumber.",
      "Bidding increment rounding applies when setting starting bids — see RULES.md for the full table.",
      "Photo filename matching strips extension and trailing _N suffix before lookup. Lot lookup checks all three identifier fields.",
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
        label: "How it works",
        items: [
          "Connects to the Business Central OData API using a per-user OAuth token (staff log in with their BC credentials).",
          "Cataloguing report fetches EVA_CataloguedBy and EVA_CataloguedDateTime from Auction_Receipt_Lines_Excel, grouped by date and user.",
          "Packing report fetches despatch records, grouped by staff member and document number.",
          "Data is stored locally in BCCatalogueDay / BCPackingDay tables so subsequent loads are fast — only new dates are fetched from BC.",
          "A background cron runs every 12 hours to keep data fresh.",
          "ShipMaps: visualises where parcels are being sent, derived from packing data.",
        ],
      },
    ],
    dependsOn: [
      "Business Central OData API (Dynamics 365)",
      "PostgreSQL — BCCatalogueDay, BCPackingDay, BCCatalogueEntry, BCPackingEntry tables",
      "BCToken (per-user OAuth token stored in DB)",
    ],
    rules: [
      "BC OData fetch timeouts: 30 seconds per page, 45 seconds for the full fetch.",
      "Page size: 500 items per BC request ($top=500).",
      "Token refresh buffer: 60 seconds before expiry — refresh before it runs out.",
      "getBCTokenAny() picks any valid non-expired token for background/cron use (no user context needed).",
      "Auction_Lines_Excel is item-level (one row per lot) — never use $top alone to get auction names. Filter by known EVA_UniqueID values.",
      "$apply=groupby is NOT supported by BC OData — do not use it.",
      "To resolve auction names: read WarehouseItem.auctionName from the local DB — it is populated by the sale-checklist route.",
      "Do not use CatalogueAuction for names in BC warehouse views — it is the local cataloguing system and may have stale data.",
    ],
  },

  {
    key: "bc-warehouse",
    icon: "🗺️",
    name: "BC Warehouse",
    path: "/tools/bc-warehouse",
    overview: "Business Central warehouse tools including location history per tote or barcode, a visual tote map, and a stock overview. All data comes directly from BC in real time.",
    howItWorks: [
      {
        label: "Location History Tab",
        items: [
          "Two modes: Tote number and Barcode (default: Tote).",
          "Tote mode: queries BC location change log directly for the tote number.",
          "Barcode mode: two-step — first resolves barcode to BC item key, then fetches location changes for that item.",
          "Results show movements: From / To / Changed by / Date. Most recent row is highlighted.",
          "Staff names are resolved via a hardcoded SALESPERSON_NAMES lookup table in the component.",
        ],
      },
      {
        label: "Tote Map & Stock Overview",
        items: [
          "Synced from BC via the background warehouse sync cron (every 12 hours).",
          "WarehouseItem and WarehouseTote tables are the local cache of BC data.",
        ],
      },
    ],
    dependsOn: [
      "Business Central OData API",
      "PostgreSQL — WarehouseItem, WarehouseTote, WarehouseSyncLog tables",
      "BCToken for authentication",
    ],
    rules: [
      "DO NOT change the design or behaviour of the Location History tab. It was accidentally replaced in an earlier rewrite and had to be manually restored.",
      "Location History API route is /api/bc/location-history — not /api/warehouse/location-history.",
      "The no-results state must show a styled card explaining the item may not have been moved or the change log wasn't active.",
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
          "Results are sorted by hammer price (highest first). You choose how many to include (Top 5 to Top 50).",
          "Select an article type: Sale Highlight, News Story, Collector's Guide, or Market Report.",
          "The selected lots are sent to Gemini along with the article type — Gemini writes the article in HTML format.",
          "Output can be copied as plain text or raw HTML for use in a CMS or email.",
        ],
      },
    ],
    dependsOn: [
      "Google Gemini API",
      "PostgreSQL — WarehouseItem table (BC auction data synced locally)",
    ],
    rules: [
      "Lot links to the public website cannot be auto-generated — the Vectis website URL contains internal IDs not available in BC data.",
      "Model is user-selectable from the available Gemini model list.",
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
          "The server authenticates with BC using any valid staff token and fetches a sample of records.",
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
    name: "Warehouse",
    path: "/tools/warehouse",
    overview: "Internal Vectis warehouse management system for tracking physical items through the warehouse. Manages inbound receipts, container locations, and item movements.",
    howItWorks: [
      {
        label: "Sections",
        items: [
          "Inbound: Log new receipts and containers arriving at the warehouse.",
          "Locate: Find where a specific container or item is currently stored.",
          "Lookup: Search containers and receipts by barcode, receipt number, or vendor.",
          "Customers: View receipt history per customer (manager+ role).",
          "Receipts: Full receipt list with container detail (manager+ role).",
          "History: Movement log showing who moved what and when (manager+ role).",
          "Reports: Warehouse statistics and summaries (admin role only).",
        ],
      },
    ],
    dependsOn: [
      "PostgreSQL — WarehouseReceipt, WarehouseContainer, WarehouseLocation, WarehouseMovement, Contact tables",
    ],
    rules: [
      "Three warehouse roles control access: warehouse (Inbound, Locate, Lookup only), manager (adds Customers, Receipts, History), admin (full access including Reports).",
      "Warehouse role is set per-user in App Access & Permissions and is separate from the main system role.",
    ],
  },

  {
    key: "crm",
    icon: "📋",
    name: "CRM",
    path: "/submissions",
    overview: "Customer submission management system used by the Collections team. Tracks items from initial customer enquiry through valuation, customer decision, and logistics.",
    howItWorks: [
      {
        label: "Workflow",
        items: [
          "Collections creates a submission for a customer (via email, web form, phone, or walk-in) with one or more items.",
          "Submission is assigned to a department and cataloguer for valuation.",
          "Cataloguer logs an estimated value and comments per item.",
          "Collections contacts the customer and logs the outcome.",
          "If declined: submission moves to the follow-up queue with a count and last-contact date.",
          "If approved: logistics are arranged — either the customer sends items in, or a collection is scheduled with address and contact details.",
        ],
      },
    ],
    dependsOn: [
      "PostgreSQL — Submission, Item, Valuation, ContactLog, Logistics, Contact, Department tables",
    ],
    rules: [
      "Submission status values: PENDING_ASSIGNMENT, PENDING_VALUATION, VALUATION_COMPLETE, PENDING_CUSTOMER_DECISION, APPROVED, DECLINED, FOLLOW_UP, COLLECTION_PENDING, ARRIVED, COMPLETED.",
      "Contact channels: EMAIL, WEB_FORM, PHONE, WALK_IN.",
      "Logistics types: SENT_IN (customer posts items) or COLLECTION (Vectis collects from customer).",
    ],
  },

  {
    key: "customers",
    icon: "👥",
    name: "Customers",
    path: "/contacts",
    overview: "Unified customer database combining BC contact data with local submission and bidding history. Visible to all users.",
    howItWorks: [
      {
        label: "How it works",
        items: [
          "Contact records are synced from Business Central and stored locally.",
          "Each contact can be a seller (linked to WarehouseReceipts) and/or a buyer (linked to CustomerAccount for bidding).",
          "View seller history, buyer activity, and contact details in one place.",
        ],
      },
    ],
    dependsOn: [
      "PostgreSQL — Contact, WarehouseReceipt, CustomerAccount, Submission tables",
      "BC sync for initial contact data",
    ],
    rules: [],
  },

  {
    key: "databases",
    icon: "🗄️",
    name: "Databases",
    path: "/databases",
    overview: "Unified search interface across all major data stores — customers, receipts, and warehouse totes. Visible to all users.",
    howItWorks: [
      {
        label: "How it works",
        items: [
          "Single search bar queries across Contact, WarehouseReceipt, and WarehouseTote tables simultaneously.",
          "Results are grouped by type for clarity.",
        ],
      },
    ],
    dependsOn: [
      "PostgreSQL — Contact, WarehouseReceipt, WarehouseTote tables",
    ],
    rules: [],
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
          "Create a parcel record with recipient details, weight, and service code (e.g. TPP48 — 48-hour tracked).",
          "Assign CatalogueLots to the parcel so the packing team knows what's inside.",
          "Submit to Royal Mail Click & Drop API — returns a tracking number and PDF label.",
          "At end of day, generate and submit a despatch manifest to finalise the collection.",
        ],
      },
    ],
    dependsOn: [
      "Royal Mail Click & Drop API",
      "PostgreSQL — Parcel, ParcelLot, CatalogueLot, CustomerAccount tables",
    ],
    rules: [
      "Parcel status values: PENDING, LABEL_CREATED, DISPATCHED, CANCELLED.",
      "Default package format: Parcel. Default service: TPP48 (48-hour tracked).",
    ],
  },

  {
    key: "website",
    icon: "🌐",
    name: "Website",
    path: "/website",
    overview: "Admin interface for the public-facing Vectis auction website. The website itself is part of this same application — the /(site) routes serve the public pages.",
    howItWorks: [
      {
        label: "Public site",
        items: [
          "Auction pages: lists published CatalogueAuctions and their lots. Buyers can browse lots, register to bid, and place commission bids.",
          "Live auction room: real-time bidding interface powered by Socket.IO. Buyers see the current lot and can place live bids.",
          "Account portal: buyers can register, manage their details, view their bids and purchase history.",
        ],
      },
      {
        label: "Admin — Website section",
        items: [
          "Hero banner management: create and reorder homepage hero slides.",
          "View published auctions and lot counts.",
        ],
      },
    ],
    dependsOn: [
      "PostgreSQL — CatalogueAuction, CatalogueLot, CustomerAccount, BidderRegistration, CommissionBid, LiveAuction, HeroSlide tables",
      "Socket.IO — live auction real-time events",
    ],
    rules: [
      "Lots only appear on the public site when their auction has published = true.",
      "A CatalogueAuction must have auctionDate set for the calendar sidebar to display it correctly.",
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
        label: "How it works",
        items: [
          "Select a published auction and start the live sale. The LiveAuction record is set to ACTIVE.",
          "Auctioneer view: advance through lots, accept bids, hammer at the winning price.",
          "Auto-bids (commission bids placed in advance by buyers) are processed automatically — the system bids on their behalf up to their maximum.",
          "Buyer-facing live room (/(site)/auctions/[code]/live) receives real-time updates via Socket.IO — current lot, current bid, hammer events.",
          "Results view: summary of all hammered lots with final prices.",
          "On server restart, any ACTIVE or PAUSED auction is automatically reset to PENDING to prevent a stale live banner on the public site.",
        ],
      },
    ],
    dependsOn: [
      "Socket.IO — real-time bidding events between auctioneer and buyer room",
      "PostgreSQL — LiveAuction, CatalogueLot, CommissionBid, BidderRegistration tables",
    ],
    rules: [
      "LiveAuction status values: PENDING, ACTIVE, PAUSED, COMPLETE.",
      "On server restart, stale ACTIVE/PAUSED auctions are reset to PENDING automatically.",
      "Bidding increments follow the standard Vectis rounding table (£0–50 nearest £5, £50–200 nearest £10, etc.).",
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
    overview: "Realistic AI avatar presenter that reads lot descriptions aloud with live lip-sync and head movement. Intended for use during live sales or promotional video content.",
    howItWorks: [
      {
        label: "How it works",
        items: [
          "Input a lot description or any text.",
          "The system streams the text to an AI avatar service which generates a video of a realistic presenter speaking the text with synchronised lip movement.",
          "Output is displayed in real time within the browser.",
        ],
      },
    ],
    dependsOn: [
      "External AI avatar/video synthesis API (HeyGen or equivalent)",
      "Streaming video delivery",
    ],
    rules: [],
  },

  {
    key: "admin",
    icon: "⚙️",
    name: "Admin",
    path: "/admin",
    overview: "System administration area. Only accessible to users with the ADMIN role. Covers user management, app permissions, system configuration, and database maintenance.",
    howItWorks: [
      {
        label: "Sections",
        items: [
          "Users & Permissions: create users (with role-default permissions auto-applied), edit details, set app access, manage section visibility within apps, change passwords.",
          "Departments: manage cataloguer departments used in the CRM.",
          "Home Page: drag-to-reorder hub cards, toggle visibility, mark as featured, customise labels and descriptions.",
          "Role Defaults: set default app access per role (Collections, Cataloguer). Applied automatically to new users; can be pushed to existing users individually or in bulk.",
          "Cataloguing Reports: view time-per-lot statistics across all cataloguers — average speed, method breakdown (wizard vs photo-only), recent session activity.",
          "Run Migrations: emergency button to apply any missing database column or table changes without redeploying.",
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
      "ADMIN users always have access to all apps — app permission checkboxes are ignored for admins.",
      "User roles: ADMIN, COLLECTIONS, CATALOGUER.",
      "Prisma migrate deploy runs on server startup via server.js. If it fails silently, use the Run Migrations button on this page.",
      "Any new database migration should also be added to the run-migrations endpoint (/api/admin/run-migrations) so it can be applied manually if needed.",
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
  const [search, setSearch]             = useState("")
  const [openKeys, setOpenKeys]         = useState<Set<string>>(new Set())

  function toggle(key: string) {
    setOpenKeys(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function expandAll() {
    setOpenKeys(new Set(APPS.map(a => a.key)))
  }

  function collapseAll() {
    setOpenKeys(new Set())
  }

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

      {/* Search + controls */}
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

      {/* App list */}
      <div className="flex flex-col gap-3">
        {filtered.length === 0 && (
          <p className="text-sm text-gray-400 italic py-8 text-center">No apps match your search.</p>
        )}

        {filtered.map(app => {
          const open = openKeys.has(app.key)
          return (
            <div key={app.key} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {/* Header */}
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

              {/* Body */}
              {open && (
                <div className="border-t border-gray-100 px-6 py-5 space-y-6">

                  {/* How it works */}
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

                  {/* Depends on */}
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

                  {/* Rules */}
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
