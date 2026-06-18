"use client"

import { useState } from "react"

// ─── Static memory content ────────────────────────────────────────────────────
// Updated by Claude alongside memory file changes. Last synced: 2026-06-11

type Entry = { filename: string; content: string }

const ENTRIES: Entry[] = [
  {
    filename: "bc_api_reference.md",
    content: `---
name: BC OData API Reference
purpose: Authoritative notes about Vectis's Business Central OData API — field names, endpoint quirks, and bugs hit in production. Read before any new BC sync or query code.
last_updated: 2026-05-08
---

# Business Central OData — Reference & Gotchas

## Diagnostic tool — always use this first
\`/api/bc/api-viewer?endpoint=<EndpointName>&limit=1[&filter=...]\` returns sample row + every field name. Use BEFORE guessing field names.

## Field naming convention
PascalCase with underscores: \`User_ID\`, \`Date_and_Time\`, \`Field_Caption\`, \`Type_of_Change\`, \`EVA_AuctionNo\`. Vectis custom = \`EVA_\` prefix; some others = \`PTE_\` prefix.

## Endpoint reference (verified)

### Auction_Lines_Excel
- Auction code: **EVA_AuctionNo** (NOT EVA_SalesAllocation)
- Auction name: EVA_AuctionName
- Date: EVA_AuctionDate
- Unique ID: EVA_UniqueID
- Description: EVA_ShortDescription
- Hammer/estimates: EVA_HammerPrice, EVA_LowEstimate, EVA_HighEstimate
- Catalogued: EVA_CataloguedBy, EVA_CataloguedDateTime
- Category: EVA_ArticleCategoryCode, EVA_ArticleSubcategoryCode
- Collection docket: EVA_CollectionNo
- Location: EVA_ArticleLocationCode

### Receipt_Lines_Excel
- Auction code: **EVA_SalesAllocation** (NOT EVA_AuctionNo!)
- Internal barcode: PTE_InternalBarcode
- No EVA_AuctionName — must look up via Auction_Lines_Excel

### Auction_Receipt_Lines_Excel
- Auction code: EVA_SalesAllocation (same as Receipt_Lines_Excel)

### ChangeLogEntries (verified 2026-05-08)
- Entry_No, User_ID, Date_and_Time
- Table_No, Table_Caption (e.g. "Auction Line", "Web Invoices")
- Field_No, Field_Caption (e.g. "Internal Barcode", "UniqueID", "AuthCode")
- **Type_of_Change**: "Insertion" | "Modification" | "Deletion"
- Old_Value, New_Value
- Primary_Key_Field_1_Value (auction code, e.g. F077)
- Primary_Key_Field_2_Value (unique ID, e.g. R008269-4)

## Critical gotchas (all hit in production)

**Field names DIFFER between similar endpoints.** EVA_AuctionNo vs EVA_SalesAllocation. Wrong field = 400 BadRequest. If errors are caught per-batch, fails silently.

**Complex OR filters time out.** Don't OR 8 startswith() clauses across thousands of rows. Use Promise.allSettled with one focused query per key.

**Auction codes get reused across years.** Sort by EVA_AuctionDate DESC and pick most recent — NOT first row encountered.

**Cached fields go stale.** WarehouseItem.auctionName is a cache; use the "Refresh auction names from BC" button in DB Explorer to re-pull.

**Pagination — use @odata.nextLink, not $skip.** BC has a ~38k row $skip limit. Use bcPageWithNext.

**Date filter syntax — OData v4.** Bare ISO 8601: \`Date_and_Time ge 2026-05-08T00:00:00Z\`. No datetime'…' wrapper.

**ge vs gt for incremental syncs.** Use ge so boundary rows aren't skipped.

## Cataloguing report — two modes

- **barcode** (default): Field_Caption='Internal Barcode', no type filter — counts edits + insertions.
- **uniqueid**: Table_Caption='Auction Line' and Field_Caption='UniqueID' and Type_of_Change='Insertion' — strict per-lot insertion count, matches BC's filtered view.

Cache (BCCatalogueDay, BCCatalogueEntry) is namespaced by mode via composite PK. Nightly cron at /api/cron/bc-catalogue refreshes both. UI toggle on /tools/bc-reports.

## When adding a new BC integration
1. Call /api/bc/api-viewer first to confirm field names.
2. Cross-check this file.
3. **If field names differ from another endpoint, document it here.**`,
  },
  {
    filename: "vectis_company_facts.md",
    content: `---
name: Vectis Company Facts
purpose: Authoritative reference for Vectis Auctions company facts. Used in any AI prompt that generates Vectis-branded content (BC Marketing tool, etc.). Keep updated as the business changes.
last_updated: 2026-05-08
---

# Vectis Auctions — Company Facts

## Identity
- Name: Vectis Auctions Ltd ("Vectis Auctions" or "Vectis")
- Founded: 1988 by Roger and Jill Mazillius on the Isle of Wight
- Acquired: 1996 by Bryan Goodall (current owner)
- Self-description: "professional, reliable and friendly service"

## Location
- Head Office: Thornaby, Teesside, North East England
- Address: Vectis Auctions Ltd, Fleck Way, Teesside Industrial Estate, Thornaby, TS17 9JZ, UK
- Phone: +44 (0)1642 750616
- Hours: Mon–Fri 9am–5pm UK

## Scale (2021 figures)
- 30,000 sq ft premises, 52 staff
- £7m turnover, 70+ auctions/year, ~70,000 lots/year
- Currently ~10 auctions/month, ~500 lots/day

## Auction format
- Live online (worldwide), with postal and telephone bidding
- Telephone bidding: £100 minimum, no charge to caller
- Buyer's premium: 22.5% +VAT (27% total)
- Reserve: 60% of bottom estimate

## Departments
Star Wars (+ Star Wars Lego), Music & Memorabilia, TV & Film, Dolls,
Military Toy Figures, Trains & Model Railway, Retro Toys, Vintage Diecast,
Vintage Toys, Teddy Bears, Lego, Retro Gaming, Matchbox, Sports Memorabilia,
Trading Cards, Corgi, Dinky, Action Man, Comics, Tinplate, Action Figures,
Airfix and Model Kits, Militaria Memorabilia, Transformers, Barbie.
Catch-all: Lead, Plastic, Games, Constructional Toys, Railwayana, Books, Annuals.

## Contact emails
- collections@vectis.co.uk — auctioning your collectables
- admin@vectis.co.uk — general enquiries
- accounts@vectis.co.uk — accounts & payable
- dispatch@vectis.co.uk — postage & packing

## Website
Only allowed URL in AI-generated content: vectis.co.uk

## Brand voice rules
**Always:** British English, professional & friendly tone, exact year(s) from data, only facts from this file.
**Never:** invent staff/founders/quotes beyond Bryan Goodall + Mazillius, claim awards/superlatives, reference URLs other than vectis.co.uk, use the word "CRM", or expose internal BC auction codes (e.g. F025, DM0126) — these are staff-only references; use the human-readable sale name for public content.`,
  },
  {
    filename: "user_profile.md",
    content: `---
name: User Profile
description: Jordan Orange, works at Vectis toy auction house, non-technical, Windows 11
type: user
---

- Name: Jordan Orange (jordan.orange@hambletongroup.com / it@vectis.co.uk)
- Works at Vectis, a toy and collectables auction house
- Non-technical — happy to defer to recommendations on stack, hosting, tooling
- Prefers concise responses — one paragraph max, lead with the answer
- Uses Windows 11, PowerShell, VS Code
- GitHub username: Jordan-Vectis
- Always accesses the app via the Railway staging/production URL — never runs it locally with npm run dev
- Staff use iPads around the warehouse and cataloguing areas — device tracking feature being planned
- Another developer (unnamed) also works on the same staging branch and pushes changes independently`,
  },
  {
    filename: "project_vectis_hub.md",
    content: `---
name: Vectis Hub Project
description: Full spec, tech stack, deployment details, and current feature state for the Vectis Hub app
type: project
last_updated: 2026-05-29
---

# Vectis Hub

**Production URL:** https://vectis-crm-production.up.railway.app
**Staging URL:** https://vectis-staging.up.railway.app
**GitHub repo:** https://github.com/Jordan-Vectis/vectis-hub
**Local path:** C:\\Dev apps\\vectis-hub

## Stack
- Next.js 16.2 (App Router), TypeScript, Tailwind CSS v4 (CSS-first, no tailwind.config.ts)
- Prisma 7.7 with \`@prisma/adapter-pg\` (requires adapter — no direct URL in client)
- PostgreSQL on Neon
- NextAuth v5 beta (JWT sessions, Credentials provider)
- Hosted on Railway (auto-deploys: push to \`main\` → production, push to \`staging\` → staging)
- Socket.IO for live auction real-time events
- Google Gemini API (lot description generation, BC Marketing articles)
- Royal Mail Click & Drop API (packing/dispatch)
- Business Central OData API (BC Reports, BC Warehouse, BC Marketing)
- Cloudflare R2 for lot photo storage
- D-ID API for AI Presenter avatar
- pdf-lib + sharp + bwip-js for server-side PDF generation (NOT pdfkit)

## Accessibility — Submissions section redesigned (not a CSS scale hack)
First attempt used a .a11y-zoom wrapper div with font-size: 145% — didn't work, rem units resolve against html not the nearest parent. Reverted. Replaced with a real UI redesign across all /submissions pages: list page is now large cards instead of a table, detail page is single-column with bigger headings/buttons/inputs, all forms sized up to match. Permanent for everyone using that section.

## Key config notes
- \`prisma generate\` runs as part of \`npm run build\`
- \`trustHost: true\` in \`auth.config.ts\` — required for Railway domain
- \`proxy.ts\` (not middleware.ts) — Next.js renamed middleware to proxy
- Auth split: \`auth.config.ts\` (Edge-safe) + \`auth.ts\` (full, uses Prisma)
- Prisma client generated at \`app/generated/prisma/\`
- \`DATABASE_URL\`, \`AUTH_SECRET\`, \`NEXTAUTH_URL\` set in Railway Variables
- Jordan never runs the app locally — always uses the Railway staging URL

## Roles — custom-creatable
- **ADMIN** — full access, hardcoded for it@vectis.co.uk, can't be deleted via UI
- All other roles are free-form strings on User.role. Defaults come from RoleDefault table.
- Pre-seeded defaults: COLLECTIONS, CATALOGUER

## Git discipline
- Default branch for all work: \`staging\`
- Never push to \`main\` unless Jordan explicitly says "push to main"
- Always pull from remote staging before pushing (another developer works on the same branch)

## Current feature surface (2026-05-29)

### Website (/website)
Live vectis.co.uk iframe preview + Back End Controller tab (embeds /auction-controller). Banner Manager at /website/banner — manage hero carousel slides (headline, subtext, CTA, image, active toggle, reorder). DB model: HeroSlide.

### Auction Controller (/auction-controller)
Password-gated Socket.IO clerk interface. Control panel: current lot, asking/increment, auto-bids, Fair Warning, Hammer + 3s countdown, pause messages, WebRTC camera broadcast. Results page at /auction-controller/results.

### Submissions (/submissions)
Customer submission pipeline. Statuses: PENDING_ASSIGNMENT → PENDING_VALUATION → VALUATION_COMPLETE → PENDING_CUSTOMER_DECISION → APPROVED/DECLINED/FOLLOW_UP → COLLECTION_PENDING → ARRIVED → COMPLETED. Channels: Email, Web Form, Phone, Walk-in.
- No department/cataloguer assignment step (removed, too complex). assign-form.tsx + assignSubmission deleted. The /cataloguer "My Valuations" page + its sidebar link also removed — internal valuation workflow retired in favour of external valuer link.
- Dark theme rule: use #1C1C1E for card panels (not Tailwind dark:bg-gray-900, which is blue-tinted #111827 and clashes against the app's actual #141416 page background). Border: dark:border-gray-800 not -700. Matches the palette already used in cataloguing.
- /submissions/[id] is a two-column dashboard (max-w-7xl, grid lg:grid-cols-3). Left col-span-2: Customer Details pinned top (items can be ~50 long, mustn't push customer off screen), then Items, forms, logistics, history. Right rail (lg:sticky top-6): Status dropdown + "Needs follow-up" checkbox, Photo Request Link, Valuation Request Link. Earlier narrow single-column left too much empty space.
- Status control: status-select.tsx dropdown (all 10 statuses, onChange → updateSubmissionStatus) replaced the old Accept/Decline buttons. follow-up-toggle.tsx checkbox toggles Submission.needsFollowUp (Boolean) — a flag designed to be cron-automated later.
- Submissions list has List | Board views (?view=board). Board = kanban column-per-status; status filter hidden there.
- Photo zoom: components/zoomable-lightbox.tsx (wheel/pinch/double-click zoom, drag-pan) used by submission PhotoViewer and /value/[token].
- New submission form (/submissions/new): each item has "Add photos" — uploads to R2 via /api/upload-url immediately; keys passed as item_N_imageKey form fields on submit.
- Customer photo request link: Submission.photoUploadToken (String? @unique). Collections/admin see "Photo Request Link" sidebar card. Link /submit/[token] — public step-by-step wizard (Take a Photo / Choose from Gallery), no size limits, accepts any image type. Both public pages show Vectis logo.
- External cataloguer valuation link: Submission.valuationToken (String? @unique). Collections/admin see "Valuation Request Link" sidebar card — generate link, copy, or "Send email" (opens Outlook 365 web compose; body "Hello, Please can you give me a valuation using the following link: {link}"). Recipient dropdown = CATALOGUERS ONLY (role CATALOGUER w/ email) or type custom. Also a "Sent to" note dropdown of cataloguers → persists Submission.valuationSentTo (display-only) via setValuationSentTo. Public page /value/[token] shows items + photos (presigned GET URLs), per-item estimate + notes, overall comments. Saves to Item.externalEstimate/externalNotes + Submission.valuationNotes/valuationSubmittedAt. Server action: generateValuationToken. API: POST /api/public/submission/[token]/save-valuation.

### Follow-ups (/follow-ups)
Submissions where Submission.needsFollowUp = true (set via the "Needs follow-up" checkbox on the submission detail). Card list matching the submissions tab (dark mode). CATALOGUER role is redirected to /submissions.

### Contacts (/contacts)
Customer database. Paginated list + search. Detail overlay: Details / Seller / Buyer / Documents tabs.

### Cataloguing (/tools/cataloguing)
- Per-auction tabs: Manage Lots, Add Lot, Photo Only Cataloguing, Import Lots, Upload Photos, AI Upgrade, Review, Statistics (incl. Lots Missing Photos), Lot History, **🔒 Locking Check**, **📋 BC Check**, Auction Settings
- **Locking Check tab** (locking-check-tab.tsx): validates every lot has title (not 'Untitled'), description, estimateLow, estimateHigh, and ≥1 photo. Summary cards (total/ready/failing). Filter: Failing only / All lots. Red issue badges per lot. "Fix →" navigates to the lot in Manage Lots tab.
- **BC Check tab** (bc-check-tab.tsx): upload BC Lines export (.xlsx), cross-references by UniqueID then barcode. Flags title mismatches (case-insensitive normalised), estimate low/high mismatches, lots in our system missing from BC, lots in BC not in our system. BC columns used: Internal Barcode, UniqueID, Short Description, Low Estimate, High Estimate.
- Review tab (shared review-tab.tsx, also on tablet): photo (tap for modal; each image has hover "⛶ Fullscreen" → full-screen overlay), key points with ✓/≈/⚠ markers (word-level stem matching), description with per-KP colour highlights. Filters: search, cataloguer, issues dropdown, Flagged-only, **AI-flagged only toggle** (filters to lots with aiFlagNote). Error flagging: setLotReviewFlag action. **AI flag note:** CatalogueLot.aiFlagNote (TEXT nullable) — set by pipeline batch when AI spots a potential cataloguer mistake; shown as amber ⚠️ banner with two options: "Edit description to fix…" (inline textarea, saves + clears flag) and **"Ignore (AI is wrong)"** button (calls saveAiFlagNote(id, null) to dismiss without editing). A lot with an active edit textarea is always kept in filtered results regardless of active filters. Key point analysis shared lib: lib/kp-analysis.tsx (analyseKeyPoints, HighlightedDescription, kpColour) — imported by review-tab.tsx and AI Upgrade tab.
- **Photo Only Cataloguing tab** (lot-photos-tab.tsx): per-lot panel shows photos with teal border + "Main" label on index 0, gray "Photo N" labels on others, original filename underneath each thumbnail. "↕ Reverse order" button (2+ photos) calls reorderLotPhotos action. On filename-based import, photos within each lot group are **reversed** (highest-numbered file → main). R2 key format: 'lot-photos/[auctionId]/[lotId]/[Date.now()]-[safeName]' (preserves original filename; old format had no filename). Lot wizard also shows filenames under photo thumbnails.
- Auctions list page: split into Active and Completed tables. Complete column is an interactive toggle (CompleteToggle → toggleAuctionComplete).
- Manage Lots table: Added By (createdByName, sortable), **KP column** (✓/— with Has KP / No KP filter), **AI column** (🚫 excluded / ✨ upgraded), **AI Excluded filter**.
- Manage Lots mass actions: mark/unmark added to BC, generate titles, transfer, delete lots, 📷🗑 Delete photos (bulkClearLotPhotos), **🚫 Exclude/Unexclude from AI** (bulkSetLotsAiExcluded)
- Lots have addedToBC boolean, aiExcluded boolean, aliases for Unique ID matcher
- bcLocked = auction.addedToBC && userRole !== "ADMIN" — gates mutations
- Export/Import xlsx on auctions list page
- Lotting Up (/tools/cataloguing/lotting-up): AI photo → proposed lot groups with bounding boxes
- Research (/tools/cataloguing/research): Quick-launch Google/eBay/WorthPoint/Catawiki/Vectis/Wikipedia + invisible research timer
- Tablet Mode (/tools/cataloguing/tablet): Touch-optimised iPad interface. Lot cards show key points at bottom and creator name (👤) in metadata row.

### Auction AI (/tools/auction-ai) — 12 tabs
Sidebar organised into groups: Chat / Run / History / Tools / Reference.
Chat Window, Batch Run, Key Points Check, Double Check, Auto Pipeline, AI Upgrade (Run group); Saved Runs, KP Check Runs (History group); Description Copier, Barcode Sorter (Tools group); Instructions, Macro Downloader (Reference group).

Key Points Check: validates descriptions against key points, returns verdict/contradictions/unsupported claims/revised description. Stored in KPCheckRun/KPCheckLot tables. Partial match rule: a key point is only satisfied if its exact meaning is explicitly present — partial word matches do not count.
Double Check: second-pass AI validation. Uses React 18 batching fix pattern.
Auto Pipeline: chains Batch → Key Points → Double Check (TEST ORDER from 2026-06-05). Batch & KP AUTO-APPLY; Double Check is the final MANUAL Review & Apply gate. Content blocks = skipped, errors retry infinitely. Google Search toggle (off by default). Stored in PipelineRun/PipelineLot tables. Per-lot 🔍 AI log button shows exact prompt + raw response per stage. Batch prompt preserves exact wording of condition/completeness key points. Google Search grounding nudges verification of catalogue/set numbers. Cataloguer mistake flag: AI appends FLAG: line → saved to CatalogueLot.aiFlagNote (TEXT nullable, cleared on description edit). Stage card "not processed" shows per-reason breakdown (no key points / batch failed / no description). **Re-check Cataloguer Flags button** (below stage cards): text-only AI scan on all lots with descriptions + key points — no images, no full re-run — saves results to aiFlagNote. Route: /api/auction-ai/recheck-flags. **Google Search grounding always on** in recheck-flags route (verifies set/catalogue numbers before flagging). Prompt + batch route both have CRITICAL rule: never flag a set/catalogue number solely because it is absent from training data (training cutoff issue). Optional final AI Upgrade step (purple panel when stage=complete). Models tab: lists all Gemini models, enable/disable toggle (DisabledModel table). NEEDS run-migrations: aiFlagNote, aiExcluded, DisabledModel, PipelineLot.batchDesc columns.

Deploy/update banner (components/deploy-banner.tsx) polls /api/version every 30s; shows "app updated" warning when token changes. Version token MUST be RAILWAY_GIT_COMMIT_SHA (stable across replicas + restarts) — NOT Date.now() at process start (that fired false warnings on every OOM/crash/scaling/health-check restart and differed between replicas).

Dark-mode form inputs: app/globals.css has a zero-specificity :where(.dark) :where(input,textarea,select) rule giving form controls a default dark bg + light text (fixes "can't see what I type in dark mode" app-wide). Inputs with their own dark:bg/text utilities still win. Don't remove it.
  - Batch stage applies generated description + estimate straight to the catalogue (was a bug: only saved to pipeline DB).
  - Double Check auto-applies fixes; raw pre-DC text preserved in PipelineLot.batchDesc for the before/after.
  - Key Points = manual review (does NOT auto-apply): lots appear in a Review & Apply section with key points, DC findings + before/after, editable textarea, View Photo, Apply/Apply All/Reject. Applying writes to catalogue + persists revised to pipeline DB.
  - Recovery: review section shows any lot whose AI text isn't yet on the catalogue (kpRevised vs appliedDesc), so old completed runs can be applied retroactively.
  - PipelineLot.batchDesc column added 2026-06-01 — run migrations after deploy.
AI Upgrade: mass description rewrite tab. Auction code → pick transformation options (shorten/expand/humanise/grammar/brand first etc.) → run → before/after review step with **key point highlights** (coloured dots + highlighted "After" description, same lib/kp-analysis.tsx as Review tab) → accept individually or all. Key points passed to upgrade route to ensure AI preserves them. API route: /api/auction-ai/upgrade. Modes include: brand_first (moves brand/maker to start of description).
Model alternation: all tabs (Batch, KP Check, Double Check, Pipeline, AI Upgrade) use attempt % 2 to switch between primary and fallback model on retries. fallbackModel prop passed from top-level sidebar to all run tabs.
applyAiDescriptionOne: aiEstimateLow/aiEstimateHigh are optional — omitting preserves existing DB values. DC and KP stages must NOT pass these fields or they wipe Batch-set estimates.
React 18 batching fix: never setState(prev => prev.map(...)) in a 100+ item loop. Use local working[] array + setState([...working]) full replace after each item.
Export/Import: xlsx with Auction + Lots sheets. Routes: /api/catalogue/export, /api/catalogue/import.

Presets: Vinyl, TV/Film, Modern Diecast, Comics, Model Railway (strict+free), Teddy Bears, General Toys, Military Figures, Matchbox.

### BC Marketing (/tools/bc-marketing) — 9 tabs
Content Generator (16 types), Paste & Generate, Insights, Saved Drafts (DRAFT/APPROVED/PUBLISHED), Hashtag Bank, Web Descriptions, Social Auto Posts, Social Media Images, Email Lists. BC codes (F025, DM0126 etc.) NEVER in AI output.
Email Lists tab: pulls buyer emails from BC AttendenceRegister by auction name keyword + optional date range. Deduplicates by email, collects all sale codes per buyer. API: /api/bc/email-lists. CSV export: Name, Email, Sale Codes. Default: All time.

### BC Warehouse (/tools/bc-warehouse) — 8 tabs
Location Heatmap, Sale Checklist, Search by Location, Location History (DO NOT redesign), Tote Data, Collections Due, Unsold Items, Data Sync, DB Explorer.

### BC Reports (/tools/bc-reports)
Cataloguing report (barcode/uniqueid/compare modes), Packing report.
DateRange component: active preset tracked explicitly via state (not date-string comparison) — prevents two presets with coinciding dates both highlighting. Manual date-input edits clear the active preset.
Bar charts: isAnimationActive={false} on Bar to prevent LabelList flash during animation.

### Packing (/tools/packing)
Royal Mail dispatch. Packers sub-page (/tools/packing/packers): Full Time/Agency/Ex-Staff groups, aliases, barcode sheet PDF.
Export/Import JSON on Packers page — Export downloads all packers+aliases as JSON; Import upserts by name (merges aliases for existing, creates new). API route: /api/packers/import.

### Auction Monitor (/tools/auction-monitor)
Live WebSocket monitor (wss://www.vectis.co.uk/wss/{auctionId}). ntfy.sh push notifications (10 alert rules, JSON body POST). Persistent lot-outcomes store (~2000 lots).

### IT Help (/tools/it-help)
Internal IT knowledge base + AI assistant. Articles (GENERAL/HARDWARE/SOFTWARE/NETWORK/APP/HOW_TO). Chat searches articles + tickets, cites sources.

### IT Tools (/tools/it-tools)
IT utilities + ModelPingTester component for Gemini model availability testing.

### Tickets (/tools/tickets)
Internal IT helpdesk. Statuses: OPEN/IN_PROGRESS/AWAITING_RESPONSE/RESOLVED/CLOSED. Priorities: LOW/MEDIUM/HIGH/URGENT. Configurable categories. Comments + resolution notes.

### Job Board (/tools/job-board) — admin-only · LIVE ON PRODUCTION 2026-06-17
Separate from Tickets. Asana-style kanban (header icons + coloured left edge per source). **The Make scenario's HTTP-module URL is the staging-vs-prod switch and currently points to PRODUCTION** (the …@hook.eu1.make.com mailhook address is NOT environment-specific). IT_INBOUND_SECRET set on staging AND production. After a production deploy, click Admin → Run Migrations on production. ITJob model (NEW/IN_PROGRESS/WAITING/DONE, source EMAIL|MANUAL). Kanban board; clickable cards open a full-screen modal (status, assignee, original email, conversation of internal notes + customer replies, delete). New column split into "From mailbox" vs "Added manually". Email auto-import via FORWARDING WEBHOOK (Graph route blocked — tenant needs admin consent even for delegated; code dormant). Inbound: POST /api/it-mailbox/inbound?key=SECRET (env IT_INBOUND_SECRET) → ITJob, OR appends a reply (ITJobMessage kind=REPLY) + sets hasNewReply if it matches an existing thread (In-Reply-To/References headers, else normalised-subject threadKey). Email path WORKING (no admin) via a relay chain: IT@ mailbox → Outlook REDIRECT rule → jordan.orange@vectis.co.uk inbox → Power Automate flow (Send an email V2 to the Make mailhook, Reply To = From, then Move email) → Make.com (mailhook → HTTP POST, form-urlencoded, fields Subject/From/FromName/TextBody/Headers) → /api/it-mailbox/inbound. Tenant blocks Graph consent AND external auto-forward AND PA HTTP is premium, hence the chain. Real customer is read from the Reply-To header (relay is "from" Jordan); parseAddress handles JSON-blob addresses, headerLine handles text/JSON headers. If sender is internal (@vectis.co.uk forwarder like admin@/accounts@/returns@), extractOriginalSender pulls the real customer from the quoted From: in the body. Replies threaded by Office 365 Conversation Id (PA stamps "VH-CID: {id}" into the body; webhook reads + strips it). Modal: Customer email row (copy + Outlook-web email), full message content (no trimming), dated/tagged boxes, viewport-capped + scroll. Assignees = User.isITStaff ("IT staff" modal). Models: ITJob, ITJobMessage, ITMailboxAuth(dormant Graph). Needs run-migrations for new columns/table.

### Reports (/tools/reports)
Cataloguing performance with time ranges (7d/30d/90d/6m/1y/all). Per-user stats + charts + research time.

### Saleroom Trainer (/tools/saleroom-trainer)
Iframe embedding /saleroom-trainer.html static training guide.

### Internal Warehouse (/tools/warehouse)
Vectis's own physical warehouse (separate from BC Warehouse). Dashboard + sub-pages: /customers, /receipts, /inbound, /locate, /history, /warehouse, /reports. DB models: Contact, WarehouseReceipt, WarehouseContainer, WarehouseMovement, WarehouseLocation.

### Admin (/admin)
About, Users & Permissions, Roles & Defaults, Home Page (drag-to-reorder), Departments, Cataloguing Reports, Devices, Claude Memory, Run Migrations. Also: Backup (DB backup viewer in R2, cross-table search), Documents (nested folders, drag-and-drop R2 upload), Invoices (flat file store, any file type, R2 under invoices/ prefix, InvoiceFile model), Idle Timer (yellowMins/redMins/reasons, IdleTimerConfig singleton), **Lot Change Log** (/admin/lot-log — full audit trail of every field edited on every lot via updateLot: who, what field, old→new, when; CatalogueLotEvent table; estimate rows highlighted amber, cleared estimates highlighted red; filterable by auction/barcode/field/user, paginated 50/page).

### Databases (/databases)
Customers, Receipts, Totes, Lots, Bids editors + Browse Any Table (~30 models, row counts + 3 sample rows).

## Common gotchas
- pdfkit fails on Railway — use pdf-lib + sharp + bwip-js
- CORS preflight blocks custom headers on ntfy.sh — use JSON body
- BC OData: Auction_Lines_Excel uses EVA_AuctionNo; Receipt_Lines_Excel uses EVA_SalesAllocation
- Complex OR filters time out at BC — run per-key in parallel with Promise.allSettled
- React 18 batching: never setState(prev => prev.map(...)) in 100+ item loops
- S3/R2 image keys: always route through /api/catalogue/photo-proxy?key=... never fetch raw keys`,
  },
  {
    filename: "opening_message.md",
    content: `---
name: Opening Message
description: Copy and paste this at the start of every new Claude Code session to set expectations
type: opening_message
---

# Opening Message — paste this at the start of every session

Hi Claude. Before we start, here are the rules for working with me:

**Never guess.** If you don't know something — a file path, a credential, how an external service works, where something should go in the app — stop and either look it up properly or ask me. Guessing wastes time and causes mistakes.

**Ask before building.** If a task involves creating a new page, moving files, adding a new section, or connecting to an external service — ask me where I want it first. Don't assume.

**Common sense on confirmation.** You don't need to check with me on every small thing — fixing a bug, a TypeScript error, a styling tweak within an existing file is fine to just do. But if the decision involves WHERE something lives, WHAT it connects to, or anything that affects the structure of the app — ask first.

**Keep responses short.** One paragraph max unless explaining something technical. Lead with the action or answer, skip preamble. No summaries at the end, no "here's what I did" recaps.

**Don't suggest console commands.** Any admin operation that needs to be triggered manually must have a proper UI button.

**Match the complexity of the solution to the simplicity of the request.** If I say "put a copy on the site", embed it statically — don't build a syncing system.

---

## The app

This is the **Vectis Hub** — an internal tool for Vectis Auctions. It is NOT a CRM. Never call it a CRM. British English throughout (colour, unauthorised, etc.).

**Production:** https://vectis-crm-production.up.railway.app
**Staging:** https://vectis-staging.up.railway.app
**Reports-only:** Separate Railway environment, deploys from reports-only branch (DIVERGED — has its own server.js and Logo handling)
**GitHub:** https://github.com/Jordan-Vectis/vectis-hub
**Local path:** C:\\Dev apps\\vectis-hub

I (Jordan) never run the app locally. I always use the Railway staging URL. Any feature that only works locally is useless.

---

## Tech stack

- Next.js 16.2 (App Router), TypeScript, Tailwind CSS v4 (CSS-first — NO tailwind.config.ts, config goes in the CSS file)
- Prisma 7.7 with @prisma/adapter-pg (requires adapter — no direct URL in client)
- PostgreSQL on Neon (NOT Railway — never look for a Postgres service in Railway)
- NextAuth v5 beta (JWT sessions, Credentials provider)
- Socket.IO for live auction real-time events
- Google Gemini API (lot descriptions, BC Marketing articles)
- Royal Mail Click & Drop API (packing/dispatch)
- Business Central OData API (BC Reports, BC Warehouse, BC Marketing)
- Cloudflare R2 for lot photo storage
- D-ID API for AI Presenter avatar
- pdf-lib + sharp + bwip-js for server-side PDF generation (NEVER pdfkit — fails on Railway with missing Helvetica.afm)

Key config notes:
- prisma generate runs as part of npm run build
- trustHost: true in auth.config.ts — required for Railway domain
- proxy.ts (not middleware.ts) — Next.js renamed middleware. Matcher excludes static image extensions (svg/png/jpg/etc) so /public images load on public pages (/submit, /value) without being redirected to /login. New public-page assets must have their extension in the exclusion.
- Auth split: auth.config.ts (Edge-safe) + auth.ts (full, uses Prisma)
- Prisma client generated at app/generated/prisma/
- DATABASE_URL, AUTH_SECRET, NEXTAUTH_URL set in Railway Variables

---

## Git workflow

- Default branch for ALL work: staging — never push to main unless I explicitly say "push to main" or "merge to production"
- "Push it" or "deploy it" are NOT permission to push to main
- Always git pull origin staging before pushing — another developer also pushes to this branch
- Merge to production: git push origin staging:main

---

## Database migrations

Whenever a new Prisma migration is added, ALSO add the equivalent SQL to the MIGRATIONS array in app/api/admin/run-migrations/route.ts. The Run Migrations button on /admin is the one-click fix — prisma migrate deploy is unreliable on Railway.

---

## Memory workflow

The Claude Memory viewer at /admin/memory is a static page — content is hardcoded in the ENTRIES array in app/(app)/admin/memory/page.tsx. Whenever memory files are updated, ALSO update the corresponding entry in the ENTRIES array and push to staging in the same commit.

---

## Lot identifier rules — CRITICAL

Two active fields. Never interchange them.
- receiptUniqueId: format R000016-413 — for AI runs and receipt matching
- barcode: format F066001 — physical label on item

(lotNumber has been removed from the schema. Folder in Description Copier is receiptUniqueId || barcode.)

receiptUniqueId assignment ({receipt}-N): NEVER count-based. createLot assigns it inside a prisma.$transaction holding a per-receipt advisory lock (pg_advisory_xact_lock) and uses MAX(existing suffix)+1. Earlier count-based + non-atomic scheme caused recurring skipped/duplicate/blank IDs from concurrent tablet saves (fixed 2026-06-17). Shared helper maxReceiptSuffix used by importLots/massCreateLots/fillLotsFromTotes. No DB unique constraint (existing dupes would block it). Backfill blanks via fillLotsFromTotes; fix is forward-only.

Detection regex:
- Unique ID: /^[A-Za-z]\\d{4,7}-\\d{1,6}$/
- Barcode: /^[A-Za-z]\\d{6,7}$/ or unique ID pattern
- Strip non-ASCII before testing: .replace(/[^\\x20-\\x7E]/g, "")

---

## Lot titles

Max 83 characters. First 83 characters of the description, truncated with … if longer. No sentence splitting — full stops do NOT break the title. Fallback: "Untitled".

## Lot status values

ENTERED | REVIEWED | PUBLISHED | SOLD | UNSOLD | WITHDRAWN — default on creation: ENTERED

## Auction types

GENERAL | DIECAST | TRAINS | VINYL | TV_FILM | MATCHBOX | COMICS | BEARS | DOLLS

---

## Estimate parsing

Regex: /£([\\d,]+)\\s*[–\\-]\\s*£?([\\d,]+)/
Accepts en-dash and hyphen, optional £ on second value. Strip commas from numbers.

Bidding increments: £0–50: £5 | £50–200: £10 | £200–700: £20 | £700–1000: £50 | £1000–3000: £100 | £3000–7000: £200 | £7000–10000: £500 | £10000+: £1000

---

## Batch AI run rules

- maxDuration: 300s. Up to 24 images per lot. 12-second delay between lots.
- Retry loop is infinite — never silently fail a lot. Only abort on Gemini content block.
- Rate limit backoff: exponential — Math.min(60000 * 2^(attempt-1), 1800000)
- Other error backoff: Math.min(attempt * 12000, 30000)
- On retry, alternate between primary and fallback model
- Returns HTTP 200 even when lots fail — always check results[0].status, not res.ok
- Join description lines with \\n, never space — collapsing to space destroys formatting

Always check before calling .text(): (1) response.promptFeedback?.blockReason and (2) response.candidates?.[0]?.finishReason — only "STOP" and "MAX_TOKENS" are acceptable. 503 from Gemini = transient, retry. Use 422 (not 500) for content blocks.

---

## BC OData API — critical field differences

- Auction_Lines_Excel: auction code = EVA_AuctionNo
- Receipt_Lines_Excel: auction code = EVA_SalesAllocation
- These are NOT interchangeable — wrong field = silent failure or 400 error

Always use /api/bc/api-viewer?endpoint=<Name>&limit=1 to confirm field names before writing new BC queries. Complex OR filters time out — run per-key in parallel with Promise.allSettled. Use @odata.nextLink for pagination, NOT $skip (BC has ~38k row $skip limit). $apply=groupby is NOT supported.

---

## PDF generation

Always use pdf-lib (pure JS). Logo: sharp rasterises SVG → PNG, then pdfDoc.embedPng(). Helper: lib/pdf-logo.ts. Barcodes: bwip-js for Code 128. Always generate server-side. Use fixed slot heights.

---

## BC Warehouse — Location History tab

DO NOT change the design or behaviour of the Location History tab in /tools/bc-warehouse. It was accidentally replaced once already. Two modes: Tote and Barcode. API route: /api/bc/location-history. Most recent row highlighted with bg-blue-950/30.

---

## Common gotchas

- fillLotsFromTotes must SELECT receiptUniqueId and preserve existing IDs — earlier bug wiped them
- Hub cards / app permissions: distinguish "key not configured" (default all-on) from "key present but empty" (respect empty). Don't use array length as the configured signal
- Mass-select async: use server-side atomic ops, not client-side list arithmetic — React state is async
- CORS preflight blocks custom headers on ntfy.sh — use JSON body POST format
- Auction codes get reused across years — sort by date DESC and pick most recent
- WarehouseItem.auctionName is a cache — use "Refresh auction names from BC" button to re-pull

---

## Current feature surface (as of 2026-05-29)

Website (/website): Live vectis.co.uk iframe preview, Back End Controller tab, Banner Manager (/website/banner) for hero carousel slides.

Auction Controller (/auction-controller): Password-gated Socket.IO clerk interface. Current lot display, asking/increment, auto-bids, Fair Warning, Hammer + 3s countdown, WebRTC camera broadcast. Results page at /auction-controller/results.

Submissions (/submissions): Customer submission pipeline with statuses PENDING_ASSIGNMENT through COMPLETED. Channels: Email, Web Form, Phone, Walk-in.

Follow-ups (/follow-ups): Submissions with DECLINED or FOLLOW_UP status.

Contacts (/contacts): Customer database with paginated list, create modal, detail overlay (Details/Seller/Buyer/Documents tabs).

Cataloguing (/tools/cataloguing): Auction list (Active/Completed split, Complete toggle) with Export/Import xlsx. Per-auction tabs: Manage Lots (KP column ✓/— + Has KP/No KP filter; AI column 🚫 excluded/✨ upgraded; AI Excluded filter; Added By column; bulk Exclude/Unexclude from AI via bulkSetLotsAiExcluded), Add Lot, Photo Only, Import Lots, Upload Photos, AI Upgrade, Review (key points highlighted, error flagging, AI flag note amber banners + inline edit, AI-flagged only filter, fullscreen photo viewer — also on tablet), Statistics (Lots Missing Photos), Lot History, Auction Settings. CatalogueLot.aiFlagNote (TEXT nullable) — set by pipeline/recheck, cleared by saveLotDescription. bcLocked = auction.addedToBC && userRole !== "ADMIN". Lotting Up, Research, Tablet Mode.

Auction AI (/tools/auction-ai) — 12 tabs, grouped sidebar (Chat/Run/History/Tools/Reference): Chat Window, Batch Run, Key Points Check, Double Check, Auto Pipeline, AI Upgrade, Saved Runs, KP Check Runs, Description Copier, Barcode Sorter, Instructions, Macro Downloader. All run tabs alternate primary/fallback model on retries. applyAiDescriptionOne estimate fields optional — only Batch sets estimates. KP Check: validates descriptions (partial word matches don't count), stored in KPCheckRun/KPCheckLot. Double Check: second-pass validation, uses React 18 batching fix. AI Upgrade: mass rewrite (/api/auction-ai/upgrade). Auto Pipeline: chains Batch→Key Points→Double Check (TEST ORDER 2026-06-05); Batch applies desc+estimate to catalogue + saves aiFlagNote; KP auto-applies; DC is final MANUAL Review & Apply gate. Stage cards show per-reason "not processed" breakdown. Re-check Cataloguer Flags button (text-only AI scan on existing descriptions, /api/auction-ai/recheck-flags). React 18 fix: use local working[] + setState([...working]) full replace — never setState(prev=>prev.map(...)) in 100+ item loop.

BC Marketing (/tools/bc-marketing): 9 tabs — Content Generator (16 types), Paste & Generate, Insights, Saved Drafts, Hashtag Bank, Web Descriptions, Social Auto Posts, Social Media Images, Email Lists (buyer emails from BC AttendenceRegister by keyword+date, CSV export with sale codes). BC codes never in AI output.

BC Warehouse (/tools/bc-warehouse): Location Heatmap, Sale Checklist, Search by Location, Location History (DO NOT redesign), Tote Data, Collections Due, Unsold Items, Data Sync, DB Explorer.

BC Reports (/tools/bc-reports): Cataloguing report (barcode/uniqueid/compare), Packing report.

Packing (/tools/packing): Royal Mail dispatch. Packers: Full Time/Agency/Ex-Staff, aliases, barcode sheet PDF.

Auction Monitor (/tools/auction-monitor): Live WebSocket (wss://www.vectis.co.uk/wss/{auctionId}). ntfy.sh push notifications (10 alert rules, JSON body POST).

IT Help (/tools/it-help): IT knowledge base + AI chat (searches articles + tickets, cites sources).

IT Tools (/tools/it-tools): IT utilities + ModelPingTester.

Tickets (/tools/tickets): IT helpdesk with statuses, priorities, configurable categories, comments, resolution notes.

Reports (/tools/reports): Cataloguing performance with time ranges, per-user stats + charts.

Saleroom Trainer (/tools/saleroom-trainer): Iframe training guide.

Internal Warehouse (/tools/warehouse): Vectis physical warehouse (separate from BC Warehouse). Sub-pages: /customers, /receipts, /inbound, /locate, /history, /warehouse, /reports.

Admin (/admin): About, Users & Permissions, Roles & Defaults, Home Page, Departments, Cataloguing Reports, Devices, Claude Memory, Run Migrations, Backup (R2 backup viewer + cross-table search), Documents (nested folders, drag-and-drop R2 upload), Invoices (flat file store, any file type, R2 invoices/ prefix, InvoiceFile model), Idle Timer (yellowMins/redMins/reasons config), **Lot Change Log** (/admin/lot-log — CatalogueLotEvent table, logs every field change from updateLot with old/new values, changedBy, changedAt; filterable/paginated).

Databases (/databases): Customers, Receipts, Totes, Lots, Bids editors + Browse Any Table (~30 models).

---

## Auto Clerk (/tools/auto-clerk) — READ THE REFERENCE CARD FIRST

A shadow-clerking aid for running an auction on TWO platforms at once: Vectis (Bidpath) and Saleroom (GAP). The clerk works one platform; these pages show what to press on the other.

**The reference card on /tools/auto-clerk is the SOURCE OF TRUTH** for which buttons exist and when to press them. Read it before changing any auto-clerk code — the button mappings are fiddly and easy to get wrong (I got them wrong repeatedly before they were documented).

Launcher (/tools/auto-clerk) layout (tidied 2026-06): (1) 🧪 Testing section — three scenarios built/tested one at a time: Scenario 1 "Clerk on Vectis → auto Saleroom" (READY = /auto-clerk-fake-saleroom.html), Scenario 2 "Clerk on Saleroom → auto Vectis" (coming next), Scenario 3 "Fully automated (timers)" (coming soon). (2) 📡 Shadow views — read-only Combined + Bidpath→Saleroom + Saleroom→Bidpath. (3) Sync Logic Reference card. (4) Legacy simulation in a collapsed details element — old BroadcastChannel dashboard + 4 panels + Coordinator, reference only.

Pages:
- /tools/auto-clerk-live — Bidpath → Saleroom shadow (reads Bidpath WebSocket directly)
- /tools/auto-clerk-saleroom — Saleroom → Bidpath shadow (reads GAP via relay)
- /tools/auto-clerk-combined — both side by side in iframes
- /auto-clerk-fake-saleroom.html — end-to-end test rig: a DUMB Saleroom replica + a separate auto-clerk that only presses its real buttons. (1) Dumb replica (whole Saleroom UI from /public/auto-clerk-saleroom.html / Saleroom Trainer): buttons (bBid, btn-sell, btn-next, bFW, btn-undo, Room, Pass, Offer) react normally via their own act() handlers; no knowledge of Bidpath; own placeholder lot list advanced by Next; new act('online') = saleroom.com online customer bid (advances one increment, green). (2) Auto-clerk (top dark bar: WS URL + Auction ID + Connect + Production/Staging presets + Show raw): reads Bidpath WS and ONLY calls autoClick(id)→el.click() on real buttons, no state reaching-in. Mapping: bid Online/Saleroom → nothing (already on Saleroom); other platforms (Room/Telephone/Invaluable/BSCB/Commission) → click Bid; bid amount drops below last seen → click Undo; lotInformationUpdate Sold → click Sell; activeLotChange → click Next; getFairWarningStatus true → click Fair warn. (3) Test helper: green "+ Saleroom online bid" button fires act('online') to simulate an independent saleroom bidder. Same .click() approach will drive a console-pasted script on the real Saleroom GAP page later (swap element IDs for real ones). (4) ABSOLUTE-AMOUNT targeting + failsafes: clicking Bid only steps one increment so platforms starting at different amounts lag; fix uses the custom-amount box next to A (#bidOverride) — replica act('bid') reads it (value present = bid that exact amount, else step). Auto-clerk drives Saleroom to the absolute current Vectis bid each time (set box + click Bid), so missed presses self-correct on the next bid. Failsafes: verify-after-press + retry up to 4x (syncSaleroomToTarget/readSaleroomBid), coalesce fast bids onto latest target, pre-sell reconcile (bring Saleroom to hammer before Sell), 2s watchdog re-sync if behind, red #syncWarn banner if stuck. bpTargetBid holds target. URL + auction ID persist in localStorage. Shows a Saleroom-style clerking screen (lot, current bid, asking, message) mirroring the live auction. The six Saleroom buttons (BID, ROOM, SELL, NEXT, FAIR WARNING, UNDO) animate when auto-clerk logic would press them: room/commission bid → BID; lot sold → SELL then NEXT (2.2s apart); FW → FAIR WARNING. Online bids update state but don't press buttons (automatic on Saleroom). "Show raw" toggle dumps every WS message + flags unrecognised command names with a red UNK badge.

Data sources:
- Bidpath: direct WebSocket wss://www.vectis.co.uk/wss/{auctionId}. Message data is in parsed.content (NOT parsed.data — this was a real bug). liveBidEvent has content.amount/asking/platform (BSCB=room, Online, Saleroom)/lot_id.
- Saleroom (GAP): no public feed. A console script (copy button on the page) uses a MutationObserver on hammer-price / asking-price / lot-number / auction-message-content, POSTs to /api/gap-relay (in-memory store, CORS open, must stay in publicPaths in auth.config.ts), and the shadow page polls every 1s.

Core sync rules (full detail on the reference card):
- ONLY Vectis Online (platform === "Online") and Saleroom Online (platform === "Saleroom") bids are automatic on the other platform — no clerk action. Every other platform value (Room, Telephone, Invaluable, BSCB, any third-party source) needs the clerk to press BID on Saleroom. This is an ALLOWLIST not a denylist — if Bidpath emits a new platform name, the safe default is "needs BID" until verified auto-synced.
- Lot start: catch the lower platform up — BID on Saleroom / SALEROOM button on Vectis.
- Same-amount tie: ROOM on Saleroom = favour Vectis (default at lot start); ! on Vectis = favour Saleroom. The ! is the ONLY ! button and only drops the Vectis bidder.
- Fair Warning after 15s inactivity (both, manual). Sell 20s after FW (both, manual): Vectis HAMMER then NEXT LOT; Saleroom SELL then NEXT.
- Undo is a manual button only (no auto-detection). Saleroom buttons have NO exclamation marks.

## Recent work (as of 2026-05-28)

- Auto Clerk shadow system built end-to-end (pages above, GAP relay, reference card) — pushed to production
- Auction AI: sidebar model dropdown now stays in sync with the KP Check / Double Check tester-list selection (they could silently drift before; the run uses the tester selection)
- Cataloguing Statistics tab: added "Lots Missing Photos" headline stat (red with %, green tick when none)

## Working-style reminders that came up this session

- When unsure how a real-world workflow maps to buttons/actions, ASK one question at a time and write the answers down — don't invent logic (I invented a 1.5s double-bid detector and a same-amount auto-detector that were never asked for).
- Don't add behaviour that wasn't requested. Build exactly what's asked.`,
  },
  {
    filename: "feedback_vectis.md",
    content: `---
name: General Feedback & Collaboration Style
description: How Jordan likes to work — tone, approach, and patterns to avoid
type: feedback
---

Keep responses short — one paragraph max unless explaining something technical. Lead with the action or answer, skip preamble.

**Why:** User explicitly asked for concise answers early on.

**How to apply:** No summaries at the end of responses, no "here's what I did" recaps, no headers in conversational replies.

---

Jordan always uses the Railway staging URL — never runs the app locally. Any feature that only works locally is useless to him.

**Why:** Jordan got frustrated multiple times when features were built assuming local access (e.g. memory file reading from disk).

**How to apply:** Before building anything that reads from disk, env vars only available locally, or requires npm run dev — stop and think whether it will work on Railway. If not, find a different approach.

---

When Jordan says something simple like "take a copy and put it on the site", do exactly that — don't architect a syncing system with DB tables, API routes, and seed scripts.

**Why:** Jordan had to repeat himself multiple times while I kept overcomplicating the memory viewer.

**How to apply:** Match the complexity of the solution to the simplicity of the request. If they say "put a copy on the site", embed the content statically.

---

Don't suggest Jordan open the browser console or run commands to fix things.

**Why:** Jordan called this out as a bad suggestion when I told him to run fetch() in the console to trigger a migration.

**How to apply:** Any admin operation that might need to be triggered manually must have a proper UI button (like the Run Migrations button).`,
  },
  {
    filename: "feedback_memory_workflow.md",
    content: `---
name: Memory file workflow
description: When updating memory files, always update the static page content at the same time
type: feedback
---

The Claude Memory viewer at /admin/memory is a static page — the memory content is hardcoded directly into \`app/(app)/admin/memory/page.tsx\` as a const ENTRIES array.

**Rule:** Whenever memory files are written or updated, also update the corresponding entry in the ENTRIES array in the page file and push to staging.

**Why:** Jordan can't run the app locally, so the only way he can see updated memory is if it's baked into the deployed page. A memory file written to disk but not reflected in the page is invisible to him.

**How to apply:** At the end of any session where memory files are written, update \`app/(app)/admin/memory/page.tsx\` with the new content and commit + push to staging in the same operation.`,
  },
  {
    filename: "feedback_file_saving.md",
    content: `---
name: Always ask before saving files
description: Ask the user where to save files before saving them
type: feedback
---

Always ask the user where they want files saved before saving them. Do not assume Desktop or any other default location.

**Why:** User was annoyed when a Word document was saved to their Desktop without being asked.

**How to apply:** Any time a file is being created/saved (documents, exports, downloads), ask "Where would you like me to save this?" before proceeding.`,
  },
  {
    filename: "feedback_naming.md",
    content: `---
name: App naming
description: Don't call it a CRM — it's just one section of the whole app
type: feedback
---

Don't refer to the Vectis app as "the CRM". It is just "the app". CRM is only one section of it and using that label causes confusion.

**Why:** User corrected this explicitly — calling it a CRM is inaccurate and could cause misunderstanding about what's being worked on.

**How to apply:** Always say "the app" when referring to the overall Vectis Next.js application.`,
  },
  {
    filename: "feedback_migrations.md",
    content: `---
name: Migration pattern for Vectis Hub
description: Always back new migrations with a run-migrations endpoint entry; prisma migrate deploy is unreliable on Railway
type: feedback
---

Database migration errors are a recurring problem on Railway staging/production. \`prisma migrate deploy\` can fail silently on startup.

**Rule:** Whenever a new Prisma migration is added, also add the equivalent \`CREATE TABLE IF NOT EXISTS\` or \`ALTER TABLE ... ADD COLUMN IF NOT EXISTS\` SQL to the \`MIGRATIONS\` array in \`app/api/admin/run-migrations/route.ts\`.

**Why:** The Run Migrations button on /admin gives Jordan a one-click fix without needing console commands or redeployment.

**How to apply:** Any time a schema change is made, update both the migration file AND the run-migrations endpoint in the same commit.`,
  },
  {
    filename: "feedback_git_workflow.md",
    content: `---
name: Git push workflow for Vectis Hub
description: Always pull from remote staging before pushing — another developer also pushes to staging
type: feedback
---

Another developer works on the same staging branch. Always pull before pushing, not after, so our commits go on top cleanly.

**Rule:** Before pushing to staging, run \`git pull origin staging\` first, then push.

**Why:** Git rejects pushes when the remote is ahead of local. Pulling first avoids force-pushing which would overwrite the other developer's work.

**How to apply:** Every time I'm about to push to staging, pull first. At the start of a session is ideal.

**Releasing staging → main (production):** A plain fast-forward often fails because hotfixes get committed straight to \`main\` and never back-merged, so the branches diverge. Procedure that worked (2026-06-17): (1) \`git merge --no-ff origin/staging\` into \`main\`, (2) push \`main\`, (3) then \`git checkout staging; git merge --ff-only main; git push origin staging\` so both branches realign and don't drift again. Always do a trial \`git merge --no-commit --no-ff\` first to confirm no conflicts before pushing to production. Only do this when Jordan explicitly says "push to main".`,
  },
  {
    filename: "feedback_pdf_patterns.md",
    content: `---
name: PDF Generation Patterns
purpose: Standing rules for server-side PDF generation in the Vectis Hub app.
type: feedback
last_updated: 2026-05-13
---

# PDF generation — standing rules

## Use pdf-lib, not pdfkit
pdfkit reads Helvetica.afm from disk at runtime — missing on Railway's serverless filesystem, so every pdfkit route fails with ENOENT. Use **pdf-lib** (pure JS, embeds standard fonts without disk reads).

## Logo embedding — sharp converts SVG → PNG
pdf-lib cannot embed SVGs directly. Use sharp to rasterise the Vectis logo SVG to PNG bytes, then \`pdfDoc.embedPng()\`. Shared helper: \`lib/pdf-logo.ts\`.

## Barcodes — bwip-js
For Code 128 barcodes use bwip-js. Outputs PNG buffers embeddable via embedPng. Types declared in \`types/bwip-js.d.ts\`.

## Never use browser print-to-PDF for tabular reports
Inconsistent across machines/browsers. Generate server-side and return as download.

## Layout — lock slot height
Divide the usable page area into a **fixed number of slots** rather than autosizing. Small groups should not produce giant rows.`,
  },
  {
    filename: "reference_new_claude_account.md",
    content: `---
name: New Claude Account Setup
description: Steps to replicate the full working Claude Code setup on a new account — permissions, hooks, memory files, project config
metadata:
  type: reference
---

# Setting up Claude Code on a new account

If you're starting fresh (new machine, new Anthropic account, or reinstalled Claude Code), follow these steps to get the same working setup.

## 1. Permissions — stop Claude asking for approval on everything

Edit C:\\Users\\<YourUser>\\.claude\\settings.json and add this permissions block:

\`\`\`json
{
  "permissions": {
    "allow": [
      "Bash(*)", "Edit(*)", "Write(*)", "Read(*)", "Glob(*)", "Grep(*)", "PowerShell(*)"
    ]
  }
}
\`\`\`

This lets Claude read/edit/write files and run shell commands without asking permission every time.

## 2. Hook — mandatory rules check before every response

In settings.json, add a hooks block (see the full file below). This fires before Claude responds and injects a reminder to check rules, not suggest things already built, and update memory after building.

\`\`\`json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "echo '{\"hookSpecificOutput\": {\"hookEventName\": \"UserPromptSubmit\", \"additionalContext\": \"BEFORE RESPONDING — mandatory rules check: (1) Re-read RULES.md and the opening message memory files before making any observation, suggestion, or writing any code. (2) Do NOT suggest features, patterns, or fixes that are already documented as built or in place. (3) Do NOT suggest things that conflict with any rule. (4) If unsure whether something exists, look it up — never assume it is missing. AFTER BUILDING ANYTHING — memory update is mandatory: update the relevant memory files in C:\\\\\\\\Users\\\\\\\\Jordan.Orange\\\\\\\\.claude\\\\\\\\projects\\\\\\\\C--Dev-apps\\\\\\\\memory\\\\\\\\ AND the ENTRIES array in app/(app)/admin/memory/page.tsx to reflect what was built, then push both to staging.\"}}'",
        "statusMessage": "Checking rules…"
      }]
    }]
  }
}
\`\`\`

## 3. Project files in the repo root

CLAUDE.md (tells Claude which files to load):
\`\`\`
@AGENTS.md
@RULES.md
\`\`\`

AGENTS.md — Next.js version warning. RULES.md — the full working rules (deployment, branch rules, lot identifiers, BC API fields, batch AI rules, PDF patterns, route patterns, etc.). Both already exist in C:\\Dev apps\\vectis-hub\\.

## 4. Memory files

Copy C:\\Users\\Jordan.Orange\\.claude\\projects\\C--Dev-apps\\memory\\ to the same path on the new machine. Key files: MEMORY.md (index), opening_message.md, project_vectis_hub.md, user_profile.md, vectis_company_facts.md, bc_api_reference.md, feedback_*.md, reference_*.md.

## 5. Opening message

At the start of every new session, open the Claude Memory page (/admin/memory), hit Copy on "Opening Message", and paste it as the first message. This sets all the rules, tech stack context, and feature surface.

## 6. Settings.json location

Windows: C:\\Users\\<YourUser>\\.claude\\settings.json
Mac: ~/.claude/settings.json`,
  },
  {
    filename: "MEMORY.md",
    content: `---
name: Memory Index
description: Index of all memory files
type: reference
---

# Memory Index

- [User Profile](user_profile.md) — Jordan Orange, Vectis auction house, non-technical, always uses Railway URL never local
- [Vectis Hub Project](project_vectis_hub.md) — Full spec, stack, deployment, current admin features, planned iPad tracking
- [Vectis Company Facts](vectis_company_facts.md) — Authoritative company facts; use in any AI-generated content prompt
- [BC OData API Reference](bc_api_reference.md) — Endpoint field names, gotchas, cataloguing modes, bidstream WebSocket protocol + ntfy.sh push pattern
- [PDF Generation Patterns](feedback_pdf_patterns.md) — pdf-lib (not pdfkit), sharp for SVG logos, bwip-js for barcodes, server-side over browser print
- [General Feedback](feedback_vectis.md) — Keep responses short; don't build local-only features; don't overcomplicate simple requests; no console commands
- [Memory Workflow](feedback_memory_workflow.md) — Always update the static memory page alongside memory files and push to staging
- [File Saving Preference](feedback_file_saving.md) — Always ask where to save files before saving them
- [App Naming](feedback_naming.md) — Don't call it a CRM; it's "the app"
- [Migration Pattern](feedback_migrations.md) — Always add new migrations to run-migrations endpoint; prisma migrate deploy unreliable on Railway
- [Git Workflow](feedback_git_workflow.md) — Pull from remote staging before every push; another dev works on the same branch
- [New Claude Account Setup](reference_new_claude_account.md) — Steps to replicate this full Claude Code setup on a new account (permissions, hooks, memory, project files)`,
  },
]

// ─── Rendering ────────────────────────────────────────────────────────────────

const TYPE_COLOURS: Record<string, string> = {
  user:      "bg-blue-100 text-blue-700",
  feedback:  "bg-amber-100 text-amber-700",
  project:   "bg-green-100 text-green-700",
  reference: "bg-purple-100 text-purple-700",
}

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { meta: {}, body: content.trim() }
  const meta: Record<string, string> = {}
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":")
    if (colon === -1) continue
    meta[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
  }
  return { meta, body: match[2].trim() }
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i} className="font-semibold text-gray-900 dark:text-white">{part.slice(2, -2)}</strong>
      : part
  )
}

function renderBody(body: string) {
  return body.split("\n").map((line, i) => {
    if (line.startsWith("# "))   return <h2 key={i} className="text-base font-bold text-gray-900 dark:text-white mt-4 mb-1">{line.slice(2)}</h2>
    if (line.startsWith("## "))  return <h3 key={i} className="text-sm font-semibold text-gray-800 dark:text-gray-200 mt-3 mb-1">{line.slice(3)}</h3>
    if (line.startsWith("### ")) return <h4 key={i} className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-2 mb-0.5">{line.slice(4)}</h4>
    if (line.startsWith("- "))   return <p key={i} className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed pl-3 before:content-['–'] before:mr-2 before:text-gray-400 dark:text-gray-500">{renderInline(line.slice(2))}</p>
    if (line.trim() === "")      return <div key={i} className="h-2" />
    return <p key={i} className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{renderInline(line)}</p>
  })
}

export default function MemoryPage() {
  const [open, setOpen]       = useState<string | null>(null)
  const [entries, setEntries] = useState<Entry[]>(ENTRIES)
  const [copied, setCopied]   = useState<string | null>(null)

  function handleCopy(e: React.MouseEvent, entry: Entry) {
    e.stopPropagation()
    const { body } = parseFrontmatter(entry.content)
    navigator.clipboard.writeText(body)
    setCopied(entry.filename)
    setTimeout(() => setCopied(c => (c === entry.filename ? null : c)), 1500)
  }

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    files.forEach(file => {
      if (!file.name.endsWith(".md")) return
      const reader = new FileReader()
      reader.onload = ev => {
        const content = ev.target?.result as string
        setEntries(prev => {
          const existing = prev.findIndex(e => e.filename === file.name)
          if (existing >= 0) {
            const next = [...prev]
            next[existing] = { filename: file.name, content }
            return next
          }
          return [...prev, { filename: file.name, content }].sort((a, b) => a.filename.localeCompare(b.filename))
        })
        setOpen(file.name)
      }
      reader.readAsText(file)
    })
    e.target.value = ""
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Claude Memory</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            What Claude remembers about you, this project, and how to work with you.
          </p>
        </div>
        <label className="shrink-0 cursor-pointer text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white dark:text-white border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:border-gray-600 px-4 py-2 rounded-lg transition-colors">
          Upload .md
          <input type="file" accept=".md" multiple onChange={handleUpload} className="hidden" />
        </label>
      </div>

      <div className="flex flex-col gap-3">
        {entries.map(entry => {
          const { meta, body } = parseFrontmatter(entry.content)
          const isOpen    = open === entry.filename
          const typeClass = TYPE_COLOURS[meta.type ?? ""] ?? "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"

          return (
            <div key={entry.filename} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
              <button
                onClick={() => setOpen(isOpen ? null : entry.filename)}
                className="w-full flex items-start gap-4 px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900 dark:text-white text-sm">{meta.name ?? entry.filename}</span>
                    {meta.type && (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${typeClass}`}>
                        {meta.type}
                      </span>
                    )}
                    <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">{entry.filename}</span>
                  </div>
                  {meta.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{meta.description}</p>
                  )}
                </div>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => handleCopy(e, entry)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleCopy(e as unknown as React.MouseEvent, entry) }}
                  className={`shrink-0 mt-0.5 text-xs font-medium px-2.5 py-1 rounded-md border transition-colors cursor-pointer ${
                    copied === entry.filename
                      ? "border-green-500 text-green-600 dark:text-green-400"
                      : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:border-gray-300 dark:hover:border-gray-600"
                  }`}
                >
                  {copied === entry.filename ? "Copied ✓" : "Copy"}
                </span>
                <svg
                  className={`w-4 h-4 text-gray-400 dark:text-gray-500 mt-1.5 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isOpen && (
                <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-4 space-y-1">
                  {renderBody(body)}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
