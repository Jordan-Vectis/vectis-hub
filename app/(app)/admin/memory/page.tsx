"use client"

import { useState } from "react"

// ─── Static memory content ────────────────────────────────────────────────────
// Updated by Claude alongside memory file changes. Last synced: 2026-05-19

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
last_updated: 2026-05-19
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

## Current feature surface

### Cataloguing (/tools/cataloguing)
- Per-auction tabs: Manage Lots, Add Lot, Photo Only Cataloguing, Import Lots, Upload Photos, AI Upgrade, Statistics, Lot History, Auction Settings
- Lots have addedToBC boolean, aliases for Unique ID matcher
- Mass actions: delete, generate titles, mark added to BC

### Auction AI (/tools/auction-ai)
- Batch AI run with Gemini — up to 24 images per lot, 12s inter-lot delay, infinite retry loop
- Presets in lib/auction-ai-presets.ts: Vinyl & Memorabilia, TV & Film, Modern Diecast, Comics & Toys, Model Railway (strict + free), Teddy Bears, General Toys, Military Figures, Matchbox
- Chat mode (up to 6 images), Model Tester, Description Copier, Duplicate Checker

### BC Marketing (/tools/bc-marketing) — 5 tabs
Content Generator, Paste & Generate, Insights, Saved Drafts, Hashtag Bank

### BC Warehouse (/tools/bc-warehouse) — 8 tabs
Location Heatmap, Sale Checklist, Search by Location, Location History (DO NOT redesign), Tote Data, Collections Due, Unsold Items, Data Sync, DB Explorer

### BC Reports (/tools/bc-reports)
Cataloguing report (barcode/uniqueid/compare modes), Packing report

### Packing (/tools/packing)
Royal Mail dispatch, Packers sub-page with Full Time/Agency/Ex-Staff groups, aliases, barcode sheet PDF

### Auction Monitor (/tools/auction-monitor)
Live WebSocket monitor, ntfy.sh push notifications, 10 alert rules

### Admin (/admin)
About, Users & Permissions, Roles & Defaults, Home Page (drag-to-reorder), Departments, Cataloguing Reports, Devices, Claude Memory, Run Migrations

### Databases (/databases)
Customers, Receipts, Totes, Lots, Bids editors + Browse Any Table (30 models)`,
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
- proxy.ts (not middleware.ts) — Next.js renamed middleware
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

Three separate fields. Never interchange them.
- receiptUniqueId: format R000016-413 — for AI runs and receipt matching
- barcode: format F066001 — physical label on item
- lotNumber: integer string "42" — catalogue sequence

Unique IDs (R000016-413 format) always go in receiptUniqueId, NEVER in lotNumber. Lots created via Apply to Auction have empty lotNumber — this is correct. Folder in Description Copier must always be receiptUniqueId || lotNumber, never just lotNumber.

Detection regex:
- Unique ID: /^[A-Za-z]\\d{4,7}-\\d{1,6}$/
- Barcode: /^[A-Za-z]\\d{6,7}$/ or unique ID pattern
- Strip non-ASCII before testing: .replace(/[^\\x20-\\x7E]/g, "")

---

## Lot titles

Max 83 characters. Extracted from first sentence of description (split on . or newline). Fallback: "Untitled".

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

## Current feature surface (as of 2026-05-19)

Cataloguing (/tools/cataloguing): Auction list → per-auction tabs: Manage Lots (filters, inline edit, mass actions inc. mark-added-to-BC), Add Lot, Photo Only Cataloguing, Import Lots, Upload Photos, AI Upgrade, Statistics, Lot History, Auction Settings. Lots have addedToBC boolean and aliases for Unique ID matcher.

Auction AI (/tools/auction-ai): Batch run with Gemini (24 images/lot, 12s delay, infinite retry). Presets in lib/auction-ai-presets.ts (Vinyl, TV/Film, Modern Diecast, Comics, Model Railway strict+free, Teddy Bears, General Toys, Military Figures, Matchbox). Chat mode (6 images), Model Tester, Description Copier, Duplicate Checker.

BC Marketing (/tools/bc-marketing): 5 tabs — Content Generator (16 content types, DB-sourced), Paste & Generate, Insights, Saved Drafts (DRAFT/APPROVED/PUBLISHED), Hashtag Bank. BC internal codes (F025, DM0126 etc.) must NEVER appear in AI output.

BC Warehouse (/tools/bc-warehouse): 8 tabs — Location Heatmap, Sale Checklist, Search by Location, Location History (DO NOT redesign), Tote Data, Collections Due (per-aisle PDFs), Unsold Items, Data Sync, DB Explorer.

BC Reports (/tools/bc-reports): Cataloguing report (barcode/uniqueid/compare modes), Packing report (fuzzy matcher + aliases).

Packing (/tools/packing + /tools/packing/packers): Royal Mail dispatch. Packers: Full Time / Agency / Ex-Staff groups, aliases, barcode sheet PDF (10 rows/page, Code 128, Vectis logo).

Auction Monitor (/tools/auction-monitor): Live WebSocket monitor (wss://www.vectis.co.uk/wss/{auctionId}). Tracks bids, session totals, sale-state flags. ntfy.sh push notifications (10 alert rules, JSON body POST). Persistent lot-outcomes store (~2000 lots).

Admin (/admin): About, Users & Permissions, Roles & Defaults, Home Page (drag-to-reorder), Departments, Cataloguing Reports, Devices (serial/user tracking), Claude Memory, Run Migrations.

Databases (/databases): Customers, Receipts, Totes, Lots, Bids editors + Browse Any Table (read-only, ~30 models, row counts + 3 sample rows).

---

## Auto Clerk (/tools/auto-clerk) — READ THE REFERENCE CARD FIRST

A shadow-clerking aid for running an auction on TWO platforms at once: Vectis (Bidpath) and Saleroom (GAP). The clerk works one platform; these pages show what to press on the other.

**The reference card at the bottom of /tools/auto-clerk is the SOURCE OF TRUTH** for which buttons exist and when to press them. Read it before changing any auto-clerk code — the button mappings are fiddly and easy to get wrong (I got them wrong repeatedly before they were documented).

Pages:
- /tools/auto-clerk-live — Bidpath → Saleroom shadow (reads Bidpath WebSocket directly)
- /tools/auto-clerk-saleroom — Saleroom → Bidpath shadow (reads GAP via relay)
- /tools/auto-clerk-combined — both side by side in iframes

Data sources:
- Bidpath: direct WebSocket wss://www.vectis.co.uk/wss/{auctionId}. Message data is in parsed.content (NOT parsed.data — this was a real bug). liveBidEvent has content.amount/asking/platform (BSCB=room, Online, Saleroom)/lot_id.
- Saleroom (GAP): no public feed. A console script (copy button on the page) uses a MutationObserver on hammer-price / asking-price / lot-number / auction-message-content, POSTs to /api/gap-relay (in-memory store, CORS open, must stay in publicPaths in auth.config.ts), and the shadow page polls every 1s.

Core sync rules (full detail on the reference card):
- Online bids are automatic on BOTH platforms — no clerk action.
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

**How to apply:** Every time I'm about to push to staging, pull first. At the start of a session is ideal.`,
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
- [Git Workflow](feedback_git_workflow.md) — Pull from remote staging before every push; another dev works on the same branch`,
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
                <svg
                  className={`w-4 h-4 text-gray-400 dark:text-gray-500 mt-0.5 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
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
