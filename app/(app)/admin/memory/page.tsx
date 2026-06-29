"use client"

import { useState } from "react"

// ─── Static memory content ────────────────────────────────────────────────────
// Updated by Claude alongside memory file changes. Last synced: 2026-06-11

type Entry = { filename: string; content: string }

const ENTRIES: Entry[] = [
  {
    filename: "audit_2026-06-29_missing.md",
    content: `---
name: Audit — surfaces previously missing from memory
last_updated: 2026-06-29
---

# Documentation gaps closed by the 2026-06-29 code-vs-memory audit

Three whole features the memory never recorded, plus stale facts:

## Condition Reports (/tools/condition-reports, key CONDITION_REPORTS)
Customer condition-report helpdesk grouped by auction (NEW/IN_PROGRESS/DONE, assign, manual add). Live BC lookup per report (lib/condition-bc.ts) resolves cataloguer + tote/location. Two email paths: inbound webhook POST /api/condition-reports/inbound?key= (env CONDITION_INBOUND_SECRET) and a 2nd Graph shared mailbox (lib/condition-mailbox.ts, env CONDITION_MAILBOX, OAuth /api/condition-mailbox/auth|callback|folders). Gemini fallback parse (condition-extract.ts). Models ConditionReport + ConditionMailboxAuth. Needs Run Migrations.

## Public website + customer bidder portal — app/(site)/  (NOT just an iframe)
The Hub serves a full public Vectis site + portal: marketing pages, /auctions (+[code]/live online bidding room, /lot, /bidjs), /search, /portal/login+register, /account(+bids,sales). Own CustomerAccount cookie auth (lib/customer-auth.ts), separate from staff NextAuth. Models: CustomerAccount, BidderRegistration, LiveAuction (status + currentLotIndex, reset to PENDING on boot), CommissionBid. The /website staff tool is now THREE tabs (adds BidJS Setup).

## Royal Mail Click & Drop parcel dispatch (inside /tools/packing)
Create parcel then POST /api/parcels/[id]/label (lib/royal-mail.ts, env ROYAL_MAIL_API_KEY) creates the Click & Drop order + label PDF + tracking; end-of-day /api/parcels/manifest marks LABEL_CREATED to DISPATCHED. Models Parcel + ParcelLot.

## Cron scheduling = server.js setInterval loops (NOT Railway/Vercel)
On boot: migrate deploy + reset stale LiveAuctions to PENDING. Four loops (Bearer CRON_SECRET): bc-warehouse 12h, db-backup daily-midnight-UTC (JSON dump to R2 then /admin/backup), it-mailbox 5m, condition-mailbox 5m. bc-packing and bc-catalogue have NO in-repo scheduler (external Railway).

## Models with zero memory
CatalogueTimingLog (per-lot cataloguing time → Admin Cataloguing Reports), IdleLog (idle periods), CataloguePhotoSession (Photo Only storage), EmailTemplate (IT Tools templates), plus the feature models above.

## Stale facts corrected
- NO KPCheckRun/KPCheckLot table — batch runs persist in AuctionRun/AuctionLot, the pipeline in PipelineRun/PipelineLot.
- AI Presenter (/tools/avatar) has 3 modes (script speak, screen-reading Gemini OCR auto-narrate, live-feed WebSocket templates) — not just a D-ID avatar.
- IT Tools also has an Email Templates library + AI draft-reply route.
- Databases tab 5 is Commission Bids (portal data), not a generic Bids tab.
- /crm-settings reworded to "Department Settings" (2026-06-29, accuracy fix — it manages Departments). The "CRM" nav section / hub-card / "Buyer — CRM" tab are CORRECT and stay (that section genuinely is the CRM) — the no-CRM rule only bans calling the WHOLE Hub a CRM, not the legitimate CRM section.
- RULES.md "no backup configured" was stale — the db-backup JSON cron exists.

## Env vars previously unrecorded
ROYAL_MAIL_API_KEY, CONDITION_INBOUND_SECRET, CONDITION_MAILBOX, CLOUDFLARE_R2_BACKUP_BUCKET, CONDITION_AI_MODEL.
`,
  },
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

## Shipping report column coverage (added 2026-06-29)

The Shipping report reads parcel size/collection from the locally-synced WarehouseItem.collectionNo / .sizeClassification (backfilled by a full Receipt Lines re-sync). To confirm the backfill worked, the **Data Sync** tab in /tools/bc-warehouse shows a "Shipping column coverage" line — total items · N with collection · N with size — from /api/warehouse/sync/status (withCollectionNo / withSizeClassification = count where the column is not null). DB Explorer also returns a true total (real match count, not the capped page) and shows "Showing X of Y matching rows"; its select now includes both shipping columns so they're visible.

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
- Another developer, Jack, also works on the same staging branch with his own Claude and pushes independently. RULES.md was made team-neutral 2026-06-25 (the "How to work with Jordan" section became "How to work on this project"; personal framing removed) so it doesn't confuse other devs' Claude — personal preferences live in Jordan's own Claude memory.`,
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

**Production URL:** https://vectis-production.up.railway.app
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
- /submissions/[id] is a two-column dashboard (max-w-7xl, grid lg:grid-cols-3). Left col-span-2: Customer Details pinned top (items can be ~50 long, mustn't push customer off screen), then an internal Notes section, then Items, forms, logistics, history. Right rail (lg:sticky top-6): Status dropdown + "Needs follow-up" checkbox, Photo Request Link, Valuation Request Link. Earlier narrow single-column left too much empty space.
- **Internal staff notes (2026-06-18):** SubmissionNote model (running timestamped log, separate from the customer's own submission-note field and from ContactLog). notes-section.tsx client component (add box + list with author/when + delete); addSubmissionNote/deleteSubmissionNote in lib/actions/submissions.ts. Needs run-migrations (SubmissionNote table). The customer's own submission note is now labelled "Customer note".
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
- Per-auction tabs: Manage Lots, Add Lot, Photo Only Cataloguing, Import Lots, Upload Photos, AI Upgrade, Review, Statistics (incl. Lots Missing Photos), Lot History, **🔒 Locking Check**, **📋 BC Check**, **📤 Push to BC**, Auction Settings
- **Locking Check tab** (locking-check-tab.tsx): validates every lot has title (not 'Untitled'), description, estimateLow, estimateHigh, and ≥1 photo. Summary cards (total/ready/failing). Filter: Failing only / All lots. Red issue badges per lot. "Fix →" navigates to the lot in Manage Lots tab.
- **BC Check tab** (bc-check-tab.tsx): upload BC Lines export (.xlsx), cross-references by UniqueID then barcode. Flags title mismatches (case-insensitive normalised), estimate low/high mismatches, lots in our system missing from BC, lots in BC not in our system. BC columns used: Internal Barcode, UniqueID, Short Description, Low Estimate, High Estimate.
- **Push to BC tab** (bc-fill-tab.tsx, tab id "bc-fill", added 2026-06-24): copy-paste BC-import builder. Paste the BC import sheet (TSV from Excel, MUST include the header row) → it fills the Hub-owned columns matched by **UniqueID = receiptUniqueId (NOT row position)** → copy the result back over the same top-left cell. Columns filled: Short Description ← title; Low/High Estimate ← real estimateLow/High, falling back to aiEstimateLow/High (flagged); Size Classification ← lot.notes (the parcel size: Small/Medium/Large/Contact/Collection Only); Article Category Code ← category; Article Subcategory Code ← subCategory. Category values are already BC-style codes (e.g. RETRO_TOYS). Matches columns by header NAME (case-insensitive) so "Article Subcategory Code" never collides with "Article Subcategory 2 Code", and a shifted/extra cell can't misalign. Preserves every other cell, same column count/order, so paste-back is cell-for-cell identical. Validation report: UniqueIDs not in Hub, lots missing estimate/size/category, AI-estimate fallbacks, Hub lots absent from the sheet, expected columns missing from the paste. Pure client-side (no API) — page already passes all needed lot fields. Solves the positional copy-paste errors that broke imports when one cell was out of line. Verified against a real BC export (2026-06-24): 75-column sheet, mapped headers at UniqueID=C, Short Description=H, Article Category Code=N, Article Subcategory Code=O, Size Classification=Q, Low Estimate=U, High Estimate=V — matched by name so column letters are informational only.
- Review tab (shared review-tab.tsx, also on tablet): photo (tap for modal; each image has hover "⛶ Fullscreen" → full-screen overlay), key points with ✓/≈/⚠ markers (word-level stem matching), description with per-KP colour highlights. Filters: search, cataloguer, issues dropdown (All lots / ⚠ With issues / ✓ All good), Flagged-only, **AI-flagged only toggle** (filters to lots with aiFlagNote). THREE DISTINCT things: "with issues" = hasIssues() (any key point missing/partial OR no description OR no photos OR reviewFlag); "Flagged only" = human reviewFlag; "AI-flagged only" = aiFlagNote. The header "⚠ N with issues" count is a CLICKABLE button (2026-06-24) toggling the issues filter — previously users clicked the flag buttons expecting those lots and got nothing. Error flagging: setLotReviewFlag action. **AI flag note:** CatalogueLot.aiFlagNote (TEXT nullable) — set by pipeline batch when AI spots a potential cataloguer mistake; shown as amber ⚠️ banner with two options: "Edit description to fix…" (inline textarea, saves + clears flag) and **"Ignore (AI is wrong)"** button (calls saveAiFlagNote(id, null) to dismiss without editing). A lot with an active edit textarea is always kept in filtered results regardless of active filters. Key point analysis shared lib: lib/kp-analysis.tsx (analyseKeyPoints, HighlightedDescription, kpColour) — imported by review-tab.tsx and AI Upgrade tab.
- **Photo Only Cataloguing tab** (lot-photos-tab.tsx): per-lot panel shows photos with teal border + "Main" label on index 0, gray "Photo N" labels on others, original filename underneath each thumbnail. "↕ Reverse order" button (2+ photos) calls reorderLotPhotos action. On filename-based import, photos within each lot group are **reversed** (highest-numbered file → main). R2 key format: 'lot-photos/[auctionId]/[lotId]/[Date.now()]-[safeName]' (preserves original filename; old format had no filename). Lot wizard also shows filenames under photo thumbnails.
- **Lot Wizard** (lot-wizard-tab.tsx): 8 sequential steps — 1 Vendor & Tote, 2 Barcode, 3 Key Points, 4 Categories, 5 Estimate, 6 Condition, 7 Parcel Size, 8 Photos. Step dots are NOT clickable (advance via Next/Back only). Required fields are enforced in validateStep(s) which blocks Next (error shown above the nav): step 1 vendor+tote+receipt (receipt made required 2026-06-25), step 2 barcode, step 5 estimate low+high, **step 7 parcel size (made required 2026-06-24 — needed for the BC Size Classification column; parcel stored in CatalogueLot.notes)**. Required labels show a red *. Field checks are only a soft 7-character length warning (bypassable) + maxLength 7 — no strict pattern check. Remember-last (2026-06-25): Tote/Vendor/Receipt persist per USER ACCOUNT (User.lastTote/lastVendor/lastReceipt columns — NEEDS Run Migrations) so they follow a cataloguer across shared iPads and survive closing the app; wizard pre-fills blank fields on open via getLastLotFields() and saves via saveLastLotFields() after each createLot (barcode still uses localStorage). **Separate box/packaging condition (2026-06-24, extended to all editors 2026-06-25):** checkbox under the main condition reveals a Wording picker ("Box is" / "Packaging is" / Custom free-text) plus the same grade selector with its own optional "to" range. Saved as a separate sentence on the condition — e.g. "Near Mint to Excellent. Box is Good to Good Plus." Only added when the box is ticked AND a prefix AND grade are set. Now available in all three lot editors via shared lib/condition.ts (parseCondition/buildCondition/CONDITION_GRADES): the Lot Wizard (buttons), the desktop auction-manager editor (buttons, autosaves) and the tablet editor (dropdowns). Wizard only builds; desktop + tablet also parse the stored string back into the fields. Edit lib/condition.ts to change the format. Wording presets are DB-managed (2026-06-25): the "Box is"/"Packaging is" picker is driven by the ConditionWording table, seeded with Box is / Packaging is / Carded Back is / Blister Card is (format "<wording> is" so it reads "Carded Back is Mint"). Read via useConditionWordings() hook + /api/catalogue/condition-wordings; managed (add/rename/reorder/delete) at Admin → Condition Wording (/admin/condition-wording, admin-only). Each editor also keeps a per-lot Custom free-text wording. NEEDS Run Migrations on staging (ConditionWording table).
- Auctions list page: split into Active and Completed tables. Complete column is an interactive toggle (CompleteToggle → toggleAuctionComplete). **Filterable** (2026-06-26) via a shared filter bar (search code/name + Type dropdown + status dropdown) in the client component auctions-tables.tsx; both tables filter together and show a (count). Each auction Type shows a **fun emoji** (🚂 trains, 🚗 diecast, 🎬 TV/film, 🧸 bears, etc.) on desktop + tablet lists + the New Auction dropdown — single source of truth in lib/auction-types.ts (auctionTypeEmoji/auctionTypeLabel/AUCTION_TYPES).
- Manage Lots table: Added By (createdByName, sortable), **KP column** (✓/— with Has KP / No KP filter), **AI column** (🚫 excluded / ✨ upgraded), **AI Excluded filter**.
- Manage Lots mass actions: mark/unmark added to BC, generate titles, transfer, delete lots, 📷🗑 Delete photos (bulkClearLotPhotos), **🚫 Exclude/Unexclude from AI** (bulkSetLotsAiExcluded)
- Lots have addedToBC boolean, aiExcluded boolean, aliases for Unique ID matcher
- bcLocked = auction.addedToBC && userRole !== "ADMIN" — gates mutations
- Export/Import xlsx on auctions list page
- Lotting Up (/tools/cataloguing/lotting-up): AI photo → proposed lot groups with bounding boxes
- Research (/tools/cataloguing/research): Quick-launch Google/eBay/WorthPoint/Catawiki/Vectis/Wikipedia + invisible research timer
- Tablet Mode (/tools/cataloguing/tablet): Touch-optimised iPad interface. Lot cards show key points at bottom and creator name (👤) in metadata row.

### Auction AI (/tools/auction-ai) — 14 tabs
Sidebar organised into groups: Chat / Run / History / Tools / Reference.
Chat Window, Batch Run, Key Points Check, Double Check, Auto Pipeline, AI Upgrade (Run group); Saved Runs, KP Check Runs (History group); Description Copier, Barcode Sorter (Tools group); Instructions, Macro Downloader, BC Import Check, Models (Reference group).

Key Points Check: validates descriptions against key points, returns verdict/contradictions/unsupported claims/revised description. Stored in KPCheckRun/KPCheckLot tables. Partial match rule: a key point is only satisfied if its exact meaning is explicitly present — partial word matches do not count. JSON parsing hardened 2026-06-25 via shared lib/model-json.ts (parseModelJson + extractJsonField), used by Key Points, Double Check AND Batch routes. Gemini sometimes returns invalid JSON (commonly an invalid backslash-apostrophe escape — e.g. a foot/inch measurement like 61'6"). Old per-route catch blocks dumped raw JSON into a UI field: KP put the whole blob into the lot description; Double Check showed {"contradictions":"",...} in the contradictions box and lost the revised cleanup. Now both parse via the shared helper (repairs the escape, retries), salvage the needed field via regex on total failure, and never show raw JSON.
Double Check: second-pass AI validation. Uses React 18 batching fix pattern.
Auto Pipeline: chains Batch → Key Points → Double Check (TEST ORDER from 2026-06-05). Batch & KP AUTO-APPLY; Double Check is the final MANUAL Review & Apply gate. Content blocks = skipped, errors retry infinitely. Google Search toggle (off by default). Stored in PipelineRun/PipelineLot tables. Per-lot 🔍 AI log button shows exact prompt + raw response per stage. Results table (2026-06-25): "— Skipped" cells show the per-stage reason (batchSkipReason/dcSkipReason/kpSkipReason): "no photos", "no description", "no key points", and for content blocks the SPECIFIC Gemini reason e.g. "content blocked (RECITATION)" / "(SAFETY)" (withRetry stashes the BLOCKED reason in lastBlockRef; blockReasonLabel() formats it). Blocks hit KP/DC but not Batch because the stages send different requests — Batch sends photos, KP/DC send the finished TEXT back; model-railway lots (long catalogue-number lists) commonly trip RECITATION when echoed. Each row also has a ↻ Re-run button (rerunLot) that resets just that lot and re-runs Batch → Key Points → Double Check for it only. Disabled during a full run. "⚠ Problems only" toggle (2026-06-25) in the Results header filters the table to problem lots: any stage skipped, OR Double Check corrected (dcStatus issues), OR Key Points pending, OR a cataloguer flag. Shows the count; disabled when none. Batch prompt preserves exact wording of condition/completeness key points. Google Search grounding nudges verification of catalogue/set numbers. Cataloguer mistake flag: AI appends FLAG: line → saved to CatalogueLot.aiFlagNote (TEXT nullable, cleared on description edit). Stage card "not processed" shows per-reason breakdown (no key points / batch failed / no description). **Re-check Cataloguer Flags button** (below stage cards): text-only AI scan on all lots with descriptions + key points — no images, no full re-run — saves results to aiFlagNote. Route: /api/auction-ai/recheck-flags. **✨ Auto-fix button** (2026-06-29, Review tab flag banner, beside Edit/Ignore): /api/auction-ai/autofix-flag rewrites the description applying ONLY the flagged fix (keeps format, British English, no condition, no invented facts) and drops it into the edit box for review — user clicks Save (clears the flag); review-first by design, not auto-saved. **Google Search grounding always on** in recheck-flags route (verifies set/catalogue numbers before flagging). Prompt + batch route both have CRITICAL rule: never flag a set/catalogue number solely because it is absent from training data (training cutoff issue). Optional final AI Upgrade step (purple panel when stage=complete). Models tab: lists all Gemini models, enable/disable toggle (DisabledModel table). NEEDS run-migrations: aiFlagNote, aiExcluded, DisabledModel, PipelineLot.batchDesc columns.

BC Import Check (bcimport tab, Reference group, added 2026-06-26): client-side only, no DB/API. Fixes the problem where the "add to BC" hotkey macro breaks or errors part-way through a batch. Upload two files: the hotkey sheet (the macro to-do list: ToteNumber, LotCount, Barcodes where Barcodes is pipe-separated F-numbers, e.g. bc_import.csv from the Macro Downloader) and the BC export (the BC Lines xlsx of what actually made it in — columns Internal Barcode, Errors, UniqueID, Tote No.). It matches by barcode, drops the lots already in BC, and gives back a fresh hotkey-format sheet (recomputed counts, finished totes removed) with only the lots still to do — feed that back to the macro. Lots already in BC that have a non-zero Errors value are flagged separately and NOT added to the re-run sheet (Jordan fixes those in BC then re-exports and re-checks). Two parsing gotchas handled: Errors/Warnings are numeric counts where 0 means no error (do not treat "0" as an error); and CSV is read with the field separator forced to comma, because XLSX.read otherwise auto-detects the pipe-heavy Barcodes column as the delimiter. Validated against real files (471 to-do, 293 in BC, 178 remaining). File: app/(app)/tools/auction-ai/bc-import-check-tab.tsx.

Deploy/update banner (components/deploy-banner.tsx) polls /api/version every 30s; shows "app updated" warning when token changes. Version token MUST be RAILWAY_GIT_COMMIT_SHA (stable across replicas + restarts) — NOT Date.now() at process start (that fired false warnings on every OOM/crash/scaling/health-check restart and differed between replicas). The deploy banner is mounted only in the cataloguing shell, not app-wide.
Manual announcement banner (added 2026-06-25): app-wide custom banner (components/announcement-banner.tsx) mounted in app/(app)/layout.tsx. Admins set a message at Admin → Announcements (/admin/announcements) — type text, pick a style (info/warning/success), Show to everyone or Turn off. Banner polls /api/announcement every 60s, shows when active, dismissible per-user (re-shows when the message is edited). Singleton Announcement model (id="current"). Constants in lib/announcement-constants.ts, read helper in lib/announcements-db.ts, mutation in lib/actions/announcements.ts (split because a "use server" file can only export async functions). NEEDS Run Migrations (Announcement table).

Dark-mode form inputs: app/globals.css has a zero-specificity :where(.dark) :where(input,textarea,select) rule giving form controls a default dark bg + light text (fixes "can't see what I type in dark mode" app-wide). Inputs with their own dark:bg/text utilities still win. Don't remove it.
  - Batch stage applies the generated description straight to the catalogue (was a bug: only saved to pipeline DB). The AI estimate (aiEstimateLow/aiEstimateHigh — a SEPARATE field that never touches the real estimate) is written via applyAiEstimateOne and is ALWAYS saved as soon as it's generated, regardless of the ⚡ Auto-apply / 👁 Review-all toggle — the toggle only controls the description. (Fixed 2026-06-24: in Review-all mode the AI estimate was silently dropped because its only write was gated behind auto-apply and the manual Review & Apply gate writes description only.)
  - Double Check auto-applies fixes; raw pre-DC text preserved in PipelineLot.batchDesc for the before/after.
  - Key Points = manual review (does NOT auto-apply): lots appear in a Review & Apply section with key points, DC findings + before/after, editable textarea, View Photo, Apply/Apply All/Reject. Applying writes to catalogue + persists revised to pipeline DB.
  - Recovery: review section shows any lot whose AI text isn't yet on the catalogue (kpRevised vs appliedDesc), so old completed runs can be applied retroactively.
  - Apply-persistence fix 2026-06-25: appliedDesc is now a persisted PipelineLot column. acceptKP saves appliedDesc alongside revised/description; load reads saved.appliedDesc (falls back to catalogue description). Previously appliedDesc was rebuilt only from the catalogue text, so after Apply All a reload could re-show applied lots when the saved revised and catalogue text didn't match exactly (edits / AI Upgrade / round-trip). NEEDS Run Migrations (PipelineLot.appliedDesc column) — until run, applies don't persist.
  - "X lots were not key-point checked" / "pipeline did not fully complete" warning fixed 2026-06-25: the KP stage only processes lots that have BOTH a description and key points, so a lot with no key points never got a kpStatus and was flagged forever ("Re-run Key Points" just re-sets the stage + reloads, it doesn't run the stage). The warning + kpIncomplete now use a kpUnchecked predicate (batchStatus ok AND no kpStatus AND has key points AND has description) so lots with nothing to verify no longer count as incomplete. DC stage was never affected — it marks all batch-ok lots, skipping unprocessable ones.
  - PipelineLot.batchDesc column added 2026-06-01 — run migrations after deploy.
AI Upgrade: mass description rewrite tab. Auction code → pick transformation options (shorten/expand/humanise/grammar/brand first etc.) → run → before/after review step with **key point highlights** (coloured dots + highlighted "After" description, same lib/kp-analysis.tsx as Review tab) → accept individually or all. Key points passed to upgrade route to ensure AI preserves them. API route: /api/auction-ai/upgrade. Modes include: brand_first (moves brand/maker to start of description). Unified 2026-06-25: ONE shared UPGRADE_MODES list (key/label/desc) drives both the pipeline's inline upgrade chips and the standalone AI Upgrade tab (previously two drifted lists). Added a "Remove conditions" mode (remove_condition) that strips any grading/condition statement. Adding a mode = add to UPGRADE_MODES (UI) + MODE_INSTRUCTIONS (upgrade route prompt). Accept fix 2026-06-25 (standalone UpgradeTab): acceptLot now uses functional setLots(prev => …) so Accept All applies/marks ALL lots — the old "const working = [...lots]" read a stale closure in the loop and only the last lot stuck. Also: an empty AI result is now marked "skipped" with a log line instead of a "done" lot with no description (which left an Accept All button that did nothing), and pendingCount requires a non-empty revised so the count/button match what's acceptable.
Double Check condition removal made reliable 2026-06-25: the DC instruction now requires recording any removed condition statement in "contradictions" so the DC route's verdict becomes "issues" and the corrected description is actually applied (a condition-only change was previously dropped because verdict is derived from contradictions/unsupported). Pairs with the preset fix (presets no longer generate condition) — DC strips any that slips through.
Model alternation: all tabs (Batch, KP Check, Double Check, Pipeline, AI Upgrade) use attempt % 2 to switch between primary and fallback model on retries. fallbackModel prop passed from top-level sidebar to all run tabs.
RECITATION auto-retry (pipeline, 2026-06-25): content blocks normally skip a lot instantly, but RECITATION is the exception — it retries up to 4 times with a short wait, alternating model each attempt (it's stochastic/model-specific — Gemini refusing to echo long verbatim catalogue lists, common on model-railway lots in Key Points/Double Check). SAFETY etc. still skip immediately. Pipeline stages now pick the model by attempt % 2 (was wasRateLimit) so the retries actually swap. Set a fallback model for it to swap to. A higher-temperature retry may be added later.
applyAiDescriptionOne: aiEstimateLow/aiEstimateHigh are optional — omitting preserves existing DB values. DC and KP stages must NOT pass these fields or they wipe Batch-set estimates. As of 2026-06-24 the Batch stage writes the AI estimate via the dedicated applyAiEstimateOne (estimate-only, leaves description untouched) so it's saved in BOTH auto-apply and review modes. The AI estimate must NEVER overwrite the real estimate.
React 18 batching fix: never setState(prev => prev.map(...)) in a 100+ item loop. Use local working[] array + setState([...working]) full replace after each item.
Export/Import: xlsx with Auction + Lots sheets. Routes: /api/catalogue/export, /api/catalogue/import.

Presets: Vinyl, TV/Film, Modern Diecast, Comics, Model Railway (strict+free), Teddy Bears, General Toys, Military Figures, Matchbox.

### BC Marketing (/tools/bc-marketing) — 9 tabs
Content Generator (16 types), Paste & Generate, Insights, Saved Drafts (DRAFT/APPROVED/PUBLISHED), Hashtag Bank, Web Descriptions, Social Auto Posts, Social Media Images, Email Lists. BC codes (F025, DM0126 etc.) NEVER in AI output.
Email Lists tab: pulls buyer emails from BC AttendenceRegister by auction name keyword + optional date range. Deduplicates by email, collects all sale codes per buyer. API: /api/bc/email-lists. CSV export: Name, Email, Sale Codes. Default: All time.

### BC Warehouse (/tools/bc-warehouse) — 8 tabs
Location Heatmap, Sale Checklist, Search by Location, Location History (DO NOT redesign), Tote Data, Collections Due, Unsold Items, Data Sync, DB Explorer.
Scheduled sync: /api/cron/bc-warehouse (server interval scheduler, CRON_SECRET) loops receipt-lines to completion then auction-lines/changelog/totes/totes-active/auction-names — but INCREMENTAL only, so newly-added columns need a one-time full re-sync (Data Sync → amber Full re-sync button) to backfill historical rows; the cron then maintains them. Data Sync shows a "Shipping column coverage" line (total items · with collection · with size, from /api/warehouse/sync/status) to confirm a full re-sync populated the Shipping report columns.

### BC Reports (/tools/bc-reports)
Cataloguing report (barcode/uniqueid/compare modes), Packing report, **Shipping report**.
**Shipping report** (Shipping tab, 2026-06-26): parcels by country / region (UK / Europe / Rest of World) / city, By Month trend (parcels + est. revenue per month), Items-by-location breakdown (STANDALONE count of WarehouseItem by location in the period by bcModifiedAt — restricted to items with a collectionNo (COL number); buckets Shipped / Collected / SANDOWN / Not scanned-unknown (everything else, EXCLUDING the last month since recent collections may be undispatched); Not-scanned has a drill-in listing its actual location values; counts + % only, NOT linked to the shipment join; plus estimated revenue reduction from collections (meta.collectedRefund — Collected items priced at UK rates grouped by collection = hypothetical lost/refund revenue; collected sales raise only a COL docket, NOT a shipment request, so they are NOT in the shipping revenue total — no double-charge)), Items-by-size breakdown (labelled "Items by size" — lots, NOT parcels; the report distinguishes parcels=shipments vs items=lots-inside, with a one-line explainer), estimated shipping revenue, country × size grid, World/UK maps, Download PDF. Joins ShipmentRequestAPI (destination country = EVA_CountryRegion, parcel docket EVA_DocumentNo, filter EVA_Status ≠ Cancelled) to receipt-line sizes (EVA_SHIP_EVA_SizeClassification) via the collection number — sizes read from local WarehouseItem.collectionNo/sizeClassification, so a one-time full receipt-lines resync is needed to backfill (amber banner until then). Revenue (ex VAT) = per parcel: one first-item charge (dearest lot) + every other lot at its size's additional rate, per Vectis UK/EU-zone pricing (parcelLotCharges in lib/shipping-rates.ts, static snapshot of Shipping Rates.xlsx); Rest of World = quote-only → £0; no hammer price. Logic: lib/shipping-analytics.ts; PDF: /api/bc/shipping/pdf. Sizes/revenue depend on a COMPLETE receipt-lines resync (collectionNo/sizeClassification nullable, no backfill) — a partial resync silently undercounts items/revenue (parcels stay correct); report warns when >3% of parcels lack local lot data, counts blank-size shipped lots as Unspecified (£0), and fetches shipments via skiptoken (not $skip). Note: BC's 69,880 lots (per-lot, auction date) is NOT comparable to items-shipped (shipped lots, shipment date; ~5 lots/parcel, ~60% ship). Unlinked parcels (2026-06-29): some shipments have EVA_DocumentNo="DISPATCH" (no COL link, big share pre-Sep-2025) so their lots can't be joined; report counts them as "unlinked" (per-month "No docket" column + orange banner), parcel still counted, and rough-ESTIMATES their items/£ at the average per linked parcel in the same region (UK/Europe/RoW) — folded into headline/By Month/By Region as a labelled rough total; By Size/Country×Size stay actual-only. Caused the "Jul/Aug 2025 items too low" symptom.
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
Separate from Tickets. Asana-style kanban (header icons + coloured left edge per source). **The Make scenario's HTTP-module URL is the staging-vs-prod switch and currently points to PRODUCTION** (the …@hook.eu1.make.com mailhook address is NOT environment-specific). IT_INBOUND_SECRET set on staging AND production. After a production deploy, click Admin → Run Migrations on production. ITJob model (NEW/IN_PROGRESS/WAITING/DONE, source EMAIL|MANUAL). Kanban board; clickable cards open a full-screen modal (status, assignee, original email, conversation of internal notes + customer replies, delete). New column split into "From mailbox" vs "Added manually". Email auto-import via FORWARDING WEBHOOK (Graph route blocked — tenant needs admin consent even for delegated; code dormant). Inbound: POST /api/it-mailbox/inbound?key=SECRET (env IT_INBOUND_SECRET) → ITJob, OR appends a reply (ITJobMessage kind=REPLY) + sets hasNewReply if it matches an existing thread (In-Reply-To/References headers, else normalised-subject threadKey). Email path WORKING (no admin) via a relay chain: IT@ mailbox → Outlook REDIRECT rule → jordan.orange@vectis.co.uk inbox → Power Automate flow (Send an email V2 to the Make mailhook, Reply To = From, then Move email) → Make.com (mailhook → HTTP POST, form-urlencoded, fields Subject/From/FromName/TextBody/Headers) → /api/it-mailbox/inbound. Tenant blocks Graph consent AND external auto-forward AND PA HTTP is premium, hence the chain. Real customer is read from the Reply-To header (relay is "from" Jordan); parseAddress handles JSON-blob addresses, headerLine handles text/JSON headers. If sender is internal (@vectis.co.uk forwarder like admin@/accounts@/returns@), extractOriginalSender pulls the real customer from the quoted From: in the body. Replies threaded by Office 365 Conversation Id (PA stamps "VH-CID: {id}" into the body; webhook reads + strips it). Modal (wide, max-w-5xl, single scroll — no nested scrollbox): Customer email row (copy + Outlook-web email), original message in a readable blue 'Customer · original message' panel, full content (no trimming). Two clearly separated sections: a 'Customer · email thread' (the original email + the customer's replies stacked, blue) and an 'IT notes' section (internal-only, amber, never sent to the customer) with the add-note box. Customer replies update the email thread; the notes section is reserved for IT's own notes (kind=NOTE). Plain-text bodies strip leftover [image0.jpeg]/[cid:…] placeholders (stripPlaceholders) and split the quoted/forwarded history (From:/Sent: header, 'Original Message' divider, 'On … wrote:') into a collapsible block — plain text via splitQuote, and **HTML via splitHtmlQuote (best-effort:** splits at blockquote / gmail_quote / an Outlook 'From: … Subject:' header, re-balancing each half with the shared sanitiser cleanEmailHtml in lib/email-html.ts). The quoted header is parsed into From/Date/Subject shown in its own header box, the forwarded sender surfaced in the toggle label. Quoted body renders as HTML (isHtml) or text accordingly. Attachment thumbnails show larger + aspect-preserved (max-h-56, object-contain). **🧪 Test plain / 🧪 Test HTML buttons** (board header, admin): createTestITJob(mode) spins up a sample job — mode "html" = formatted email (signature + inline cid logo + Outlook forwarded section), mode "text" = plain-text forwarded email; both get 2 sharp-generated screenshot attachments + a [image.jpeg] placeholder + a From/Sent/Subject forwarded section — to exercise both render paths (HTML + plain), inline-image rewriting, the forwarded-quote split and the parsed header box so the rendering can be eyeballed without sending a real email / Make round-trip. NOTE for testing: render-side changes only need a page refresh (rendering happens at page load); only storage-side changes need fresh data (Make "Replay run"). Assignees = User.isITStaff ("IT staff" modal). **Due dates (2026-06-18):** ITJob.dueDate (date only, stored midnight UTC). Set/cleared via date picker in the modal's Status/Assigned/Due-date row. Visual reminders only (no cron/notifications — Jordan's choice): board cards show a colour-coded 📅 badge (red overdue, amber today/soon, grey later) + a red ring on overdue cards; badge hidden once DONE. Due status (overdue/today/soon/later) computed server-side in page.tsx to avoid hydration drift. **Image attachments (2026-06-18):** email images flow through the Make relay → inbound webhook → R2. **Make sends ONE image per request** — single File field mapped to bare 'Attachments[]' makes Make loop the HTTP module once per attachment. (Learned the hard way: Make's static per-index binary mapping 'Attachments[1]/[2]/[3]' does NOT work reliably — it sent duplicate/identical images. The looping bare-array form is what gives distinct images.) So the inbound route **consolidates**: any request carrying image file(s) attaches them to the matching job (found by conversationId/threadKey) instead of spawning a reply-per-image; the first delivery of a brand-new email creates the job, later deliveries attach to it. **Caveat: the looping module runs ZERO times when an email has no attachments**, so a SEPARATE always-on TEXT module (same fields, NO File field) is required to create jobs for text-only emails/replies. **Order-proofed in code** (the reply path no-ops if the exact body already exists as the job body or a message), so the two modules can be in any order — no fiddly sequencing needed. Route skips empty/non-image/>25MB parts AND validates each with sharp (sharp(buffer).metadata() — skips corrupt/placeholder copies that some mail clients tack on beside the real photos; without this they stored and rendered as broken thumbnails). Uploads each to R2 ('it-jobs/{jobId}/…'), creates ITJobAttachment rows at job level (messageId null). New model ITJobAttachment (jobId + nullable messageId FKs, filename/mimeType/size/r2Key). page.tsx pre-signs R2 keys (1h URLs); modal shows 96px thumbnails (click=full size) under the original message; card shows a 🖼 count. deleteITJob cleans up R2 objects. iPhone inline images arrive as normal attachments. **HTML email rendering (2026-06-18):** the real email body is rendered in the modal (signatures/inline images in place), not just plain text. ITJob.bodyHtml + ITJobMessage.bodyHtml store the email HTML, sanitised on inbound with sanitize-html (keeps formatting + img incl. cid/data schemes, strips scripts/style-tag/iframes/handlers). ITJobAttachment.contentId stores each image's email Content-ID — images WITH a Content-ID are inline (signatures) and are NOT shown as thumbnails; the page rewrites cid: refs in the HTML to signed R2 URLs (renderHtml in page.tsx) so they render in place, AND strips any <img> it can't load (bare filename / unmatched cid — e.g. iPhone inline photos that also arrive as real attachments) so they don't show as broken icons (those photos still appear as thumbnails). Thumbnails = attachments with NO Content-ID (genuine screenshots) only. Modal renders HTML on a white email-style panel (so dark mode stays readable) via EmailBody, falling back to plain text when no HTML. Make additions for this: TEXT module sends HtmlBody (mailhook HTML content); IMAGE module sends cid (Attachments Content ID). PA side: "Send an email V2" forwards attachments + trigger Include Attachments=Yes. Models: ITJob, ITJobMessage, ITJobAttachment, ITMailboxAuth(dormant Graph). Needs run-migrations for the new table + bodyHtml/contentId columns.

### Cataloguing Reports (/tools/reports)
Cataloguing performance with time ranges (7d/30d/90d/6m/1y/all). Per-user stats + charts + research time. (Card/app label renamed from "Reports" to "Cataloguing Reports" 2026-06-18 — app key is still REPORTS.)

### Marketing Reports (/tools/marketing-reports) — admin/permissioned · added 2026-06-18
Website analytics from Google Analytics (GA4), under the Cataloguing & AI group. Reads live via the GA4 Data API (lib/ga.ts, @google-analytics/data). Env: GA4_PROPERTY_ID + GA_SERVICE_ACCOUNT_JSON (full service-account key JSON, one line; service account added as Viewer on the GA4 property with Analytics Data API enabled). Page shows a setup card until both env vars are set. Reports: headline stats (active/new users, sessions, page views, avg session, engagement rate, bounce rate, engaged sessions, key events) — each shows % change vs the previous equal period (bounce rate coloured inversely, since up is worse); a realtime "active right now" strip (runRealtimeReport); visitors-over-time line; traffic by channel; top sources; top pages; top landing pages; events; top countries; devices + new-vs-returning donuts. Every table has a CSV export. Date ranges 7/28/90/365d via ?range. App key MARKETING_REPORTS. recharts client component marketing-charts.tsx; data layer lib/ga.ts (getMarketingReport fetches current + previous totals for deltas). (v3 2026-06-18) Plain-English "?" tooltips (InfoTip component) on every stat + section, explaining the jargon for non-marketers. "Hide bot traffic" toggle (?bots=hide, off by default) excludes scraper-heavy countries via a countryId dimensionFilter on every query — BOT_COUNTRY_IDS in lib/ga.ts (CN/HK/TW/SG/IN/VN/ID/PH/TH/PK/BD; Japan + Korea deliberately kept as likely genuine diecast/model collectors — adjust the list as needed). (v4 2026-06-18) Report sections are now a CATALOG (SECTION_CATALOG in lib/ga.ts — ~19 reports: channels, sources, referrers, pages, page URLs, landing pages, events, key events, site search, countries/regions/cities, languages, devices, browsers, OS, screens, new-vs-returning, busiest hours, busiest days) with a Customise selector (section-selector.tsx) to show/hide any of them; choice saved in the mr_sections cookie (read server-side, validated against the catalog; DEFAULT_SECTION_IDS when unset). Only selected sections are fetched (mapLimit 6-at-a-time to stay under GA4's ~10 concurrent-request cap). To add a report, append to SECTION_CATALOG. Summary stats + visitors-over-time line + realtime are always shown. (v5 2026-06-18) Added "Registrations by channel" + "Registrations by source" — report on the GA 'register' event broken down by where those visits came from. Needed per-report event filtering: SectionDef gained an eventName field, and the bot filter became buildFilter(excludeBots, eventName) which AND-combines a countryId exclusion with an eventName match. Site search terms + the two registration reports added to DEFAULT_SECTION_IDS. (v6 2026-06-18) Replaced the per-browser Customise cookie with SHARED saved layouts: new MarketingLayout table (name, ordered sections string[], isDefault), visible to all users. Managed via LayoutBar (admin-only ⚙ Layouts): drag to reorder + tick to include the catalog sections, then Save as new / Save changes / Set default / Delete (server actions in lib/actions/marketing-layouts.ts). A switcher dropdown lets any user flip between layouts (their choice saved in the mr_layout cookie). Active layout = mr_layout cookie → the default → first → DEFAULT_SECTION_IDS fallback when no layouts exist. The page renders tiles in the layout's order. Needs run-migrations for the MarketingLayout table. (v7 2026-06-19) Added a "UK only" toggle (?uk=1, off by default) next to "Hide bot traffic" — restricts every figure and report on the page to United Kingdom visitors via a countryId = "GB" filter. buildFilter now takes (excludeBots, eventName, ukOnly) and UK-only takes precedence over the bot exclusion (it is stricter, so there's no need to use both at once). The header's linkFor helper was generalised so the range, bot and UK toggles all preserve each other plus the active layout. (v8 2026-06-19) Added SHARED favourite sections (everyone sees the same starred reports, not per-user). New MarketingFavourite table (one row per favourited section id) + toggleMarketingFavourite server action (admin-gated, in lib/actions/marketing-layouts.ts). Admins get a ★/☆ star on every report tile to favourite/unfavourite; favourited reports are pinned to the top under a "★ Favourites" heading (the rest under "All reports") and always show even if not in the active layout. A "Favourites only" header toggle (?fav=1, added to linkFor) shows just the favourites. Needs run-migrations for the MarketingFavourite table.

### Accounts (/tools/accounts) — admin-only · added 2026-06-19
AI bookkeeping that automates the monthly NatWest/expenses spreadsheet (the one filled in by hand from invoices and bills). Flow: scan -> AI batch -> review -> database -> Excel export, deliberately built like the Auction AI batch run. You create a month (e.g. "April 26"), pick whose card a pile of receipts belongs to (B Goodall, J Goodall, James, Michael, or Vectis), and upload photos/PDFs. AI (Gemini) reads each document and pulls out the supplier, date, total and VAT, then suggests the VAT code (1 = 20%, 2 = none, 7 = personal) and the nominal column (Directors, Vectis, Fares, Fees, Other Debtors, Fuel, 21050, Meals, Computers, HGFP Stor, Card Fee). You review the lines in a table (fix anything, add lines manually for things with no paper receipt) and it learns: once you confirm a supplier it remembers the coding for next month. Export produces the April-26-style spreadsheet (grouped per cardholder with a VAT summary sheet) so it still slots in for the accountant. Scans stored in R2; data in AccountingMonth/AccountingDocument/AccountingSupplierRule; categories in lib/accounting.ts. Admin-only (financial data). The upload area shows three explained options — Take photo (camera), Choose files/PDF, and a Multi-page invoice toggle — each describing what it does. The VAT column holds a code: 1 = 20% VAT, 2 = no VAT, 7 = personal (shown as a legend on screen). There's an invoice Date column (the AI fills it from the document if it's shown). Newly added scans wait in a separate "To read" area (shown as thumbnails) where you tick which ones to read (Select all/none) — Run AI only reads the ticked scans and never re-does lines already in the table; once you Run AI and approve, they automatically drop into the main table. Each photo or file you add becomes a blank line straight away (just the image); you take them all, then press Run AI to read them in one go. Run AI doesn't write straight away — it reads everything then shows an Approve AI results confirmation listing what it will fill in for each document (including any splits); you Approve to apply or Cancel to discard, so nothing changes without your say-so. If a read is wrong you can redo it — once new scans are read the button becomes Re-read AI for any line not yet ticked OK, and each line's detail view has a Re-read with AI button. For a multi-page invoice, tick the Multi-page invoice toggle before scanning and every photo you take goes onto the same invoice (press New invoice to start the next); or open a line and use Add page / Add files. The thumbnail shows a page count, and the AI reads all the pages together as one invoice. If a single photo has several separate receipts on it — or you upload a PDF scanned from a stack of different invoices — Run AI automatically detects them and splits them into separate lines; for PDFs it uses two passes (one to work out where each invoice's pages are, then one to read each invoice) and each new line gets just its OWN pages sliced out of the PDF. If a file has more than 200 invoices the approve screen warns you to split it. PDFs are supported (the AI reads them); they show a PDF tile and open in the viewer's built-in PDF view. Clicking a page opens a full-screen viewer where you can zoom (buttons, scroll wheel, or pinch on an iPad), pan, and flick between pages (the AI fills supplier, item/service, website, date, total, VAT and suggests the code + column). Item and website are only filled if clearly visible on the document — the AI is told not to guess them. Clicking any invoice opens a detail view showing the full image next to its saved details (like the auction manager). The "whose card/account" list (B Goodall, J Goodall, James, Michael, Vectis) is editable on the Accounts index page — add, rename or remove cards; removing one keeps it on existing lines but takes it off the pick-list. The review screen is laid out like the spreadsheet (full width, fits without scrolling): lines grouped per card with a subtotal, and the nominal columns (Directors, Vectis, Fares, etc.) shown across; each line's net sits in its column and you click a column cell to file it there. Bank/card statement reconciliation is at /tools/accounts/[monthId]/reconcile (the month page has a blue Reconcile button at the top, in the header next to Export to Excel). All statements for the month are shown simultaneously (one section per statement, stacked). Upload a statement photo/PDF or import a CSV, assign it to a card, press Read (AI) to extract the transactions, then Auto-match or manually match each transaction to an entered invoice. The match dropdown shows only exact-amount matches (sorted by description similarity) rather than the full list; Auto-match now always picks the best candidate ranked by date then description. If a statement's matching goes wrong, the "Clear matches" button on that statement resets all its matches (and un-ignores) so you can run Auto-match again from scratch — the transactions are kept. If you've entered receipts that don't match the statement you're on because they belong to a different check (past or future), you can park them in a shared "Reserve" — click the ⤓ on a line in "Entered, but not matched" (or "Reserve all"). Reserved lines drop out of every month's table, export and matching so nothing gets mixed up. A Reserve panel at the bottom of every reconcile shows all parked lines (from any month, with their origin month); if one actually belongs to the check you're doing, "pull in" moves it into the current month ready to match, or "un-reserve" puts it back. The panel has a filter box and tickboxes so you can multi-select lines and pull or un-reserve them in bulk, plus a "Pull all shown" that pulls everything currently filtered into the month. There's also a "Reserves" page (a card on the accounts home page) that shows all parked lines in the same full grid as a month, so you can view and edit them in the familiar layout, pull a selection into a month, or un-reserve them. Reserving a line does remove it from its month's table, export and matching until you place it. (Needs Run Migrations once after deploy for the reserve flag.) If a bank payment has no invoice or receipt (and never will), you can mark that row "receipt missing" — it turns red, shows a badge, and stops counting as something still to match. The "Missing invoices" button in the reconcile header gives you ready-made email text listing exactly the payments you've marked as receipt-missing (date, description and amount), grouped by card, with a Copy button and an Open-in-email option — for chasing up the missing paperwork. (Needs Run Migrations once after deploy for the receipt-missing flag.) An "Unmatched only" toggle in the header hides the transactions that are already matched, so you can focus on what still needs doing. Some suppliers (like Google Ads) send one invoice for a big total but take the money in several smaller capped payments (e.g. £500 at a time) — so a single invoice can be matched to several bank transactions. When you match a payment to an invoice that's bigger than it, the dropdown offers it as "part of" that invoice, the invoice stays in the list showing how much is still outstanding, and once the payments add up to the total it's marked complete. Matched part-payment rows show how much of the invoice has been matched so far. The opposite also works: when the bank settles several small invoices in one chunk (e.g. lots of shipping receipts paid in one go), you can attach several invoices to the one transaction — pick one and it's added, the row shows "£X of £Y covered · £Z to go", and you keep adding lines until they add up to the payment (each attached line has an × to remove it). To save doing the maths, a "Smart match" button works out which combination of entered lines adds up to the payment and matches them all in one click (it favours lines from the same supplier and the fewest lines). You can move lines to a different month: tick them on the month table, pick the target month from the "Move selected to…" dropdown and click Move (useful if a receipt was filed under the wrong month). Each statement on the reconcile page has a "View" button that opens the uploaded statement photos/PDF full-screen so you can zoom in and read it. You can star a month to mark the one you're currently working on — starred months are pinned to the top of the list and highlighted, and the star is also in the month's header. (Needs Run Migrations once after deploy for the favourite column.) The Reconcile button and the month links now show a spinner the instant you tap them, so on a tablet you can tell the page is loading rather than wondering if your tap registered. Each statement section on the reconcile page can be minimised or expanded (it remembers which are collapsed), and there's a Collapse all / Expand all button. When expanded, each section shows a summary strip — number of transactions, total spend, how much is matched vs unmatched, any credits, ignored count, and the total of entered lines not yet matched. Rename a month using the "Rename" button next to the month title on the month page (or its label in the reconcile page header). "Export matched to Excel →" exports the same spreadsheet format but filtered to only the invoice lines that have been matched to a bank transaction. Lines that share the same date and amount for the same person get an orange "Possible duplicate" note that names the line it matches (the supplier), and the filter bar has a "Possible duplicates" quick-filter button (shown only when there are any) that narrows the table to just those flagged lines so you can compare them. The match is only within one person's lines — different drivers often spend the same amount (e.g. £120 of fuel) on the same day, which isn't a duplicate. Phase 2 later: smarter AI + a bank-CSV import for subscriptions/direct debits that have no receipt.

### Saleroom Trainer (/tools/saleroom-trainer)
Iframe embedding /saleroom-trainer.html static training guide.

### Internal Warehouse (/tools/warehouse)
Vectis's own physical warehouse (separate from BC Warehouse). Dashboard + sub-pages: /customers, /receipts, /inbound, /locate, /history, /warehouse, /reports. DB models: Contact, WarehouseReceipt, WarehouseContainer, WarehouseMovement, WarehouseLocation.

### Admin (/admin)
About, Users & Permissions, Roles & Defaults, Home Page Cards (/admin/home-cards — now grouped by the same sections shown on the hub: drag to reorder WITHIN a section, toggle visibility + featured, customise label/description; reworked 2026-06-18 to match the sections layout — previously a confusing flat ungrouped list. API /api/admin/app-cards returns each card's group; save flattens in grouped order so the global AppCard.order keeps sections contiguous. Which section a card belongs to is set in code via APP_CARD_DEFS.group), Departments, Cataloguing Reports, Devices, Claude Memory, Run Migrations. Also: Backup (DB backup viewer in R2, cross-table search), Documents (nested folders, drag-and-drop R2 upload), Invoices (flat file store, any file type, R2 under invoices/ prefix, InvoiceFile model), Idle Timer (yellowMins/redMins/reasons, IdleTimerConfig singleton), **Lot Change Log** (/admin/lot-log — full audit trail of every field edited on every lot via updateLot: who, what field, old→new, when; CatalogueLotEvent table; estimate rows highlighted amber, cleared estimates highlighted red; filterable by auction/barcode/field/user, paginated 50/page). **Cataloguing Categories** (/admin/categories — the category and subcategory list cataloguers pick from is now editable here: add, rename, reorder and delete both categories and their subcategories. It used to be fixed in the code. Changes show up everywhere lots are catalogued, on desktop and tablet; existing lots keep whatever category they already had. Needs Run Migrations once after deploy. 2026-06-26: the subcategory lists were synced to Business Central. First TRAINS got the 7 it was missing (Dapol O, Fleischmann HO, Heljan OO, Triang Hornby, Liliput, Mixed Lots, Rivarossi). Then, from the BC "Auction Statistics by Sub-Category" export, 211 more missing subcategories were added across 18 categories — the biggest being Military (had just 1 placeholder, now the full ~108 maker ranges: Britains, King and Country, Timpo, etc.), plus Sports, Kits, Star Wars and Collectables. Note: that stats export is your full auction history, so it includes some old/retired subcategories that are no longer used (proven by Trains showing 11 extras from an old item-type system) and a few BC typos/abbreviations; the retired Trains ones were left out, the rest were added as-is so they match BC exactly (any you don't want can be removed here). Adding a bulk list to an already-set-up system needs a Run Migrations step, because editing the default list in code only seeds a brand-new database.)

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

**Production:** https://vectis-production.up.railway.app
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
- English output enforced (2026-06-24): a LANGUAGE_RULE is appended to the system instruction AND the user prompt in the batch route, forcing British English. Without it Gemini mirrored foreign-language packaging (German Märklin/Fleischmann/Roco model railway boxes etc.) and returned non-English descriptions. Applies to Pipeline Batch stage + standalone Batch Run (shared route). Re-run any lots already generated in another language.
- Double Check English safety net (2026-06-24): DOUBLE_CHECK_INSTRUCTION has a LANGUAGE section — non-English descriptions must be flagged in "contradictions" AND fully translated into British English in "revised". Needed because the DC route sets verdict from contradictions/unsupported (not the model's verdict field) and the pipeline only applies "revised" when verdict is "issues", so a non-English description must populate "contradictions" or the translation is dropped. Catches anything the batch English rule misses, at the final DC review gate.
- Condition must NOT appear in AI descriptions (it's added manually by a human to the separate condition field). Fixed 2026-06-25: the Model Railway presets (strict + free) used to instruct including a condition statement and showed "condition appears Excellent to Near Mint" in their examples; replaced with an explicit do-not-include rule + condition-free examples, matching the Vinyl preset. IMPORTANT: built-in presets are DB-overridable (aiPreset table; DB always wins over the lib default), so if the Model Railway preset was edited/saved in the UI the code change has no effect — reset or re-save it in the preset editor.

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

Cataloguing (/tools/cataloguing): Auction list (Active/Completed split, Complete toggle) with Export/Import xlsx. Per-auction tabs: Manage Lots (KP column ✓/— + Has KP/No KP filter; AI column 🚫 excluded/✨ upgraded; AI Excluded filter; Added By column; bulk Exclude/Unexclude from AI via bulkSetLotsAiExcluded), Add Lot, Photo Only, Import Lots, Upload Photos, AI Upgrade, Review (key points highlighted, error flagging, AI flag note amber banners + inline edit, AI-flagged only filter, fullscreen photo viewer — also on tablet), Statistics (Lots Missing Photos), Lot History, Auction Settings, **📤 Push to BC** (copy-paste BC-import builder — fills Short Description/estimates/Size Classification/categories matched by UniqueID, not position). CatalogueLot.aiFlagNote (TEXT nullable) — set by pipeline/recheck, cleared by saveLotDescription. bcLocked = auction.addedToBC && userRole !== "ADMIN". Lotting Up, Research, Tablet Mode.

Auction AI (/tools/auction-ai) — 12 tabs, grouped sidebar (Chat/Run/History/Tools/Reference): Chat Window, Batch Run, Key Points Check, Double Check, Auto Pipeline, AI Upgrade, Saved Runs, KP Check Runs, Description Copier, Barcode Sorter, Instructions, Macro Downloader. All run tabs alternate primary/fallback model on retries. applyAiDescriptionOne estimate fields optional — only Batch sets estimates. KP Check: validates descriptions (partial word matches don't count), stored in KPCheckRun/KPCheckLot. Double Check: second-pass validation, uses React 18 batching fix. AI Upgrade: mass rewrite (/api/auction-ai/upgrade). Auto Pipeline: chains Batch→Key Points→Double Check (TEST ORDER 2026-06-05); Batch applies desc+estimate to catalogue + saves aiFlagNote; KP auto-applies; DC is final MANUAL Review & Apply gate. Stage cards show per-reason "not processed" breakdown. Re-check Cataloguer Flags button (text-only AI scan on existing descriptions, /api/auction-ai/recheck-flags). React 18 fix: use local working[] + setState([...working]) full replace — never setState(prev=>prev.map(...)) in 100+ item loop.

BC Marketing (/tools/bc-marketing): 9 tabs — Content Generator (16 types), Paste & Generate, Insights, Saved Drafts, Hashtag Bank, Web Descriptions, Social Auto Posts, Social Media Images, Email Lists (buyer emails from BC AttendenceRegister by keyword+date, CSV export with sale codes). BC codes never in AI output.

BC Warehouse (/tools/bc-warehouse): Location Heatmap, Sale Checklist, Search by Location, Location History (DO NOT redesign), Tote Data, Collections Due, Unsold Items, Data Sync, DB Explorer.

BC Reports (/tools/bc-reports): Cataloguing report (barcode/uniqueid/compare), Packing report, Shipping report (parcels by country/region/size, estimated revenue from the rate sheet, country×size grid, PDF).

Packing (/tools/packing): Royal Mail dispatch. Packers: Full Time/Agency/Ex-Staff, aliases, barcode sheet PDF.

Auction Monitor (/tools/auction-monitor): Live WebSocket (wss://www.vectis.co.uk/wss/{auctionId}). ntfy.sh push notifications (10 alert rules, JSON body POST).

IT Help (/tools/it-help): IT knowledge base + AI chat (searches articles + tickets, cites sources).

IT Tools (/tools/it-tools): IT utilities + ModelPingTester.

Tickets (/tools/tickets): IT helpdesk with statuses, priorities, configurable categories, comments, resolution notes.

Cataloguing Reports (/tools/reports): Cataloguing performance with time ranges, per-user stats + charts. Marketing Reports (/tools/marketing-reports): GA4 website analytics (visitors, sources, pages, devices, countries) via the GA4 Data API.

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

## Recent work (as of 2026-06-24)

Long session on the Accounts tool (/tools/accounts, admin-only) — mostly bank/card statement reconciliation. All on STAGING only.
- Reconcile is its own page (/tools/accounts/[monthId]/reconcile, blue Reconcile button at top of the month page). All statements stacked + collapsible with a summary stat strip; "Unmatched only" toggle; per-statement Clear matches + fullscreen View.
- Smarter matching: dropdown shows only exact-amount candidates (or nearest 5); part-payment matching (one invoice paid by several capped payments, e.g. Google Ads £500 caps); chunked-payment matching (one payment covering several invoices); ✨ Smart match button (subset-sum — auto-finds the invoices that add up to a payment).
- "Receipt missing" per-transaction flag; "Missing invoices" copy-to-email button.
- Shared Reserve pool: park entered lines that belong to another check (out of the month table/export/matching). Reserve panel on every reconcile (filter + multi-select + Pull selected/Pull all/Un-reserve) + a full-grid Reserves page (/tools/accounts/reserves).
- Month extras: rename month, ★ favourite the month, move lines to another month, possible-duplicate quick filter (scoped per cardholder), instant tap-feedback spinners on slow nav (tablet). Export matched to Excel.
- Cataloguing categories now DB-managed at Admin → Cataloguing Categories (/admin/categories) — add/rename/reorder/delete; feeds desktop + tablet dropdowns.
- Box/packaging condition wording presets DB-managed at Admin → Condition Wording (/admin/condition-wording) — add/rename/reorder/delete; feeds the wording picker in all three lot editors. ConditionWording table (NEEDS Run Migrations).
- NEEDS Run Migrations on staging (AccountingMonth.favourite, BankTransaction.receiptMissing, AccountingDocument.reserved, LotCategory/LotSubcategory).

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
description: Don't call it "the CRM" — it's the Hub; it only BEGAN as a CRM
type: feedback
---

Don't refer to the Vectis app as "the CRM". It is the Vectis Hub (or just "the app").

**Why:** The system started as a CRM-only tool, then grew into the Hub — a broad internal toolset (cataloguing, BC tools, auction controller, accounts, shipping, IT help, the public auction site, etc.) of which the original contacts/CRM piece is now just one part. The rule exists because Claude kept reflexively calling the WHOLE thing "the CRM" out of that history, which is now inaccurate.

**How to apply:** Say "the Hub" (or "the app") for the overall application. Never use "CRM" in UI copy, logs, comments, or memory. Known live violation: the /crm-settings page still renders "CRM Settings".`,
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

**How to apply:** Any time a schema change is made, update both the migration file AND the run-migrations endpoint in the same commit.

Runner behaviour (since 2026-06-23): the run-migrations POST wraps each statement in try/catch — it continues past failures and returns { ok, ran, errors[] } instead of aborting on the first error, so one bad statement can't block later migrations. Keep statements idempotent. Seed INSERTs must use bare ON CONFLICT DO NOTHING (not ON CONFLICT ("name")) — a name-only arbiter doesn't catch a primary-key clash and threw 23505, blocking the reconciliation migrations until fixed.`,
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

**Releasing staging → main (production):** A plain fast-forward often fails because hotfixes get committed straight to \`main\` and never back-merged, so the branches diverge. Procedure that worked (2026-06-17): (1) \`git merge --no-ff origin/staging\` into \`main\`, (2) push \`main\`, (3) then \`git checkout staging; git merge --ff-only main; git push origin staging\` so both branches realign and don't drift again. Always do a trial \`git merge --no-commit --no-ff\` first to confirm no conflicts before pushing to production. Only do this when Jordan explicitly says "push to main".

**A successful git push is NOT a successful deploy.** Railway builds the pushed commit afterwards; if that build fails the change never goes live. next.config.ts has NO ignoreBuildErrors, so any TypeScript/compile error fails the whole build. If recent staging changes "still aren't showing", suspect a broken build — often a compile error in another developer's commit (2026-06-17: a duplicate const [deselected] in the Accounts tool silently broke every staging build until fixed). Run \`npx tsc --noEmit\` before/after touching shared files to catch it.`,
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
    filename: "reference_app_access_control.md",
    content: `---
name: App access control model
description: How Vectis Hub gates access to app areas — hasAppAccess + per-app layouts, NOT hard-coded role lists
metadata:
  type: reference
---

Access to an app area is decided by hasAppAccess(role, allowedApps, appKey) in lib/apps.ts: ADMIN always; otherwise User.allowedApps must include the appKey. Hub card visibility uses this, and each app area's layout.tsx enforces it (e.g. the cataloguing layout redirects to /hub if the user lacks the CATALOGUING app). Sidebar sub-sections within an app are gated by appPermissions[appKey].sidebarItems.

TRAP (bug fixed 2026-06-17): the 4 cataloguing auction pages hard-coded if (!["ADMIN","CATALOGUER"].includes(role)) redirect("/submissions"). A Manager (custom role) granted the Cataloguing app saw the hub card and passed the layout, but the page-level role list bounced them to /submissions ("the CRM"). Fix: removed those redundant page gates — the layout's hasAppAccess is the single gate. Never gate app pages with hard-coded role-string lists; roles are free-form, so a role list locks out custom roles that were granted the app.

Server actions/API routes have no layout, so they must self-check the grant. lib/actions/catalogue.ts requireCataloguer() was broadened too (ADMIN/CATALOGUER, or any role with CATALOGUING in allowedApps), else a Manager could view cataloguing but got "Access denied" creating/editing lots. Audit 2026-06-17: all other role !== "ADMIN" gates are legitimately admin-only (Admin pages, Accounts, Job Board, role-defaults, backups, devices); follow-ups excluding CATALOGUER is intentional.`,
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
