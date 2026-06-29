# Vectis App — Standing Rules & Design Decisions

Read this before making any change. These are deliberate decisions, not defaults.

## How to work on this project

- **Never guess.** If you don't know a file path, credential, how an external service works, or where something should go — look it up or ask. There is no situation where guessing is the right call.
- **Ask before building.** If a task involves creating a new page, moving files, adding a new section, or connecting to an external service — confirm the desired location or approach first.
- **Common sense on confirmation.** Small things (bug fix, TS error, styling tweak within an existing file) — just do it. Anything involving WHERE something lives, WHAT it connects to, or structural changes to the app — ask first.
- **One clear question at a time.** Keep questions clear and focused. If you need to know something, ask it directly and wait for the answer.

---

## ⚠ Conflict Protocol

If a requested change conflicts with any rule in this file, **stop and discuss it before writing
any code**. Explain which rule is affected and why. Either:
- The change is wrong and should be adjusted, or
- The rule needs updating to reflect a deliberate new decision

Never silently override a rule. Never silently leave a rule stale.
Update this file whenever a rule genuinely changes.

---

## Deployment — Railway Only

The app is hosted on **Railway**, not Vercel. Never reference a `.vercel.app` URL.

- Production: https://vectis-production.up.railway.app
- Staging: https://vectis-staging.up.railway.app
- Auto-deploys: push to `main` → production, push to `staging` → staging environment on Railway
- Never tell the user to open a `vercel.app` URL for any reason

## Database — Neon (PostgreSQL)

The database is hosted on **Neon** (console.neon.tech), not Railway. Never suggest looking for a Postgres service inside Railway — it isn't there.

- Neon provides point-in-time restore via branching
- The `DATABASE_URL` env var in Railway points to the Neon connection string
- A scheduled **JSON** backup exists: `/api/cron/db-backup` (run by a `server.js` setInterval loop at midnight UTC, 24h cadence) dumps tables to R2 (`CLOUDFLARE_R2_BACKUP_BUCKET`), keeping the last 30 per env, surfaced at `/admin/backup`. A true `pg_dump` / point-in-time dump is still not configured — Neon branching remains the primary restore path.

### ⚠ Adding columns to the `User` table — login lockout risk

Code deploys to Railway immediately, but migrations are applied manually via the **Run Migrations**
button (which requires being logged in). So there's a window where the new Prisma client expects a
column the database doesn't have yet. The **login query in `auth.ts` MUST use an explicit `select`**
listing only the fields it needs — never a bare `findFirst({ where })` (which selects `*`). A `*`
select would reference the not-yet-created column and break login → and since you must be logged in
to run migrations, that's a **lockout**. When adding any `User` column, double-check `auth.ts` still
uses an explicit `select`.

## ⚠ Branch / Deploy Rules — MUST follow every time

**Never push to `main` unless the user explicitly says to.** Phrases like "push it", "deploy it", or "merge it" are NOT enough — the user must specifically say "push to main" or "merge to production".

Default branch for all new work is **`staging`** unless told otherwise.

Before every git push, ask yourself: "Did the user explicitly name `main`?" If not, push to `staging` only.

---

## General

- **Never call the WHOLE Hub "the CRM".** It is the **Vectis Hub** ("the app"). It *began* as a CRM-only tool and grew into the Hub — a broad internal toolset — but Claude kept reflexively calling the entire thing "the CRM"; **this rule exists to stop that habit.** ⚠ The ban is on mislabelling the *overall app* (or tools outside the CRM area) as a CRM — it is **NOT** a blanket ban on the word. The genuine **CRM section** (Submissions / Follow-ups / Contacts) really IS a CRM and is **correctly** labelled "CRM" in the nav, hub card, and "Buyer — CRM" tab — leave those. (`/crm-settings` was reworded to "Department Settings" on 2026-06-29 because it manages Departments, not CRM-specific settings — an accuracy fix, not because "CRM" was wrong there.)
- The business is **Vectis auction house**. All language should reflect an auction context.
- British English spelling throughout: "Unauthorised", not "Unauthorized".
- Superadmin email `it@vectis.co.uk` is hardcoded to always receive ADMIN role regardless of DB role.

---

## Lot Identifiers — Critical Field Rules

Three separate identifier fields exist. They are not interchangeable.

| Field | Format | Example | Rule |
|---|---|---|---|
| `receiptUniqueId` | `[A-Za-z]\d{4,7}-\d{1,6}` | `R000016-413` | AI runs, receipt matching |
| `barcode` | `[A-Za-z]\d{6,7}` OR unique ID format | `F066001` | Physical label on item |
| `lotNumber` | Integer string | `"42"` | Catalogue sequence number |

**CRITICAL**: Unique IDs (`R000016-413` format) must always be stored in `receiptUniqueId`,
**never in `lotNumber`**. Lots created via "Apply to Auction" from AI runs will have an empty
`lotNumber` — this is correct and expected. A lot with `receiptUniqueId` is fully identified
even if `lotNumber` is empty.

Detection regex:
```
Unique ID:  /^[A-Za-z]\d{4,7}-\d{1,6}$/
Barcode:    /^[A-Za-z]\d{6,7}$/ OR the unique ID pattern
isVectisBarcode: accepts both formats
```

Strip non-ASCII before testing barcodes: `.replace(/[^\x20-\x7E]/g, "")`

---

## Lot Titles

- Maximum **83 characters**. Truncate with `…` if exceeded.
- First 83 characters of the description, truncated with `…` if longer. No sentence splitting — full stops do not break the title.
- Fallback: `"Untitled"` if description is empty.

---

## Lot Status

Values: `ENTERED | REVIEWED | PUBLISHED | SOLD | UNSOLD | WITHDRAWN`
Default on creation: `ENTERED`

---

## Auction Types

`GENERAL | DIECAST | TRAINS | VINYL | TV_FILM | MATCHBOX | COMICS | BEARS | DOLLS`

---

## Estimate Parsing

Regex: `/£([\d,]+)\s*[–\-]\s*£?([\d,]+)/`
- Accepts en-dash (`–`) and hyphen (`-`)
- Optional `£` on second value: `£100–200` is valid
- Strip commas from numbers: `£1,000–£2,000` → 1000, 2000

Bidding increment rounding:
```
£0–50:        nearest £5
£50–200:      nearest £10
£200–700:     nearest £20
£700–1000:    nearest £50
£1000–3000:   nearest £100
£3000–7000:   nearest £200
£7000–10000:  nearest £500
£10000+:      nearest £1000
```

---

## Batch AI Run — Server (`/api/auction-ai/batch`)

- `maxDuration`: 300 seconds.
- Up to **24 images per lot** (`files.slice(0, 24)`).
- Files sent as `lot_{name}_image_{i}` keys in FormData.
- **12-second delay between lots** to stay within Gemini rate limits.
- **No retries inside the route** — throw immediately so the client's retry loop handles it.
- Rate-limit errors (429 / RESOURCE_EXHAUSTED) must be re-thrown prefixed with `RATE_LIMITED:` so
  the client applies the correct backoff.
- **Returns HTTP 200 even when individual lots fail.** Status is inside the results array.
  Always check `results[0].status`, not `res.ok`.
- **Description formatting**: join lines with `\n`, never with ` `. Collapsing to a space
  destroys list and multi-paragraph formatting. This has been broken before — don't change it.
- **English output is enforced**: a `LANGUAGE_RULE` constant is appended to the system instruction
  (`[systemInstruction, LANGUAGE_RULE].filter(Boolean).join("\n\n")`) and reinforced in the user
  prompt, forcing British English. Without it Gemini mirrors foreign-language packaging in the
  photos (e.g. German Märklin/Fleischmann/Roco model railway boxes) and returns non-English
  descriptions. Don't remove it.

---

## Batch AI Run — Client

### Retry loop — infinite, never give up on transient errors

Lots must never be silently marked FAILED or skipped due to rate limits or network errors.
The retry loop is **infinite** — keep going until the lot succeeds or the user clicks Cancel.

Only abort a lot early on a Gemini **content block** — those will never succeed on retry.
**Exception (pipeline `withRetry`, 2026-06-25): RECITATION blocks DO retry** — up to 4 times with a
short (~1.5s) wait, alternating primary/fallback model each attempt, because RECITATION is
stochastic/model-specific (a list of catalogue numbers echoed back) and often clears on the other
model. Every other block reason (SAFETY etc.) still skips instantly. To make the model actually
swap, the pipeline stages select the model by `attempt % 2`, not `wasRateLimit`.

Backoff:
- **Rate limits** (`RATE_LIMITED:` prefix): exponential — `Math.min(60000 * 2^(attempt-1), 1800000)`
  → 60s → 120s → 240s → 480s → 960s → 1800s (30 min cap)
- **Other errors**: `Math.min(attempt * 12000, 30000)` → 12s → 24s → 30s (capped)

On every retry, **alternate between primary and fallback model** so if one is still rate-limited
after the wait, the other gets a chance. The fallback is user-selected in the sidebar.

### Save logic

- Auction code is optional. When provided, each lot is saved to DB immediately after it succeeds.
- `savedLots` Set tracks what's already been saved in the current session.
- Already-saved lots are auto-deselected when photos are loaded (whether code was entered before
  or after loading photos — a `useEffect` on `savedLots` handles the retroactive case).
- The `FAILED` status should only appear if the user explicitly cancels.

---

## Gemini Response Handling

**Always** check these two things before calling `.text()`:
1. `response.promptFeedback?.blockReason` — prompt was blocked before response was generated
2. `response.candidates?.[0]?.finishReason` — only `"STOP"` and `"MAX_TOKENS"` are acceptable

Calling `.text()` on a blocked response throws and loses the block reason. Check first, throw with
a useful message, then `.text()`.

`503 Service Unavailable` from Gemini is transient — retry, do not surface as permanent failure.

---

## Chat Route (`/api/auction-ai/chat`)

- `maxDuration`: 120 seconds.
- Up to **6 images** per chat message.
- History format: `[{ role: "user"|"model", parts: [{ text: string }] }]`
- Returns 422 (not 500) on Gemini content block, with block reason in error message.

---

## Photo Upload / Filename Matching

`parseBarcode(filename)`:
1. Strip extension: `filename.replace(/\.[^.]+$/, "")`
2. Strip trailing `_N` suffix: `.replace(/_\d+$/, "")`

Examples:
- `F066001.jpg` → `F066001`
- `F066001_2.jpg` → `F066001`
- `R000016-413_1.jpg` → `R000016-413`

Lot lookup map uses three-way matching — **all three** identifier fields are checked:
```typescript
new Map([
  ...lots.map(l => [l.lotNumber.toLowerCase().trim(), l.id]),
  ...lots.filter(l => l.barcode).map(l => [l.barcode!.toLowerCase().trim(), l.id]),
  ...lots.filter(l => l.receiptUniqueId).map(l => [l.receiptUniqueId!.toLowerCase().trim(), l.id]),
])
```

---

## Description Copier

### Data sent from cataloguing page

`Folder` must always be `receiptUniqueId || lotNumber` — never just `lotNumber`.
Lots created via Apply to Auction have empty `lotNumber`; using only `lotNumber` leaves
`Folder` blank and breaks the jump list and ID display (this has been broken before).

Always include all three ID fields:
```javascript
{
  Folder:               l.receiptUniqueId || l.lotNumber || "",
  "Receipt Unique ID":  l.receiptUniqueId || "",
  Barcode:              l.barcode || "",
  "Lot Number":         l.lotNumber || "",
  Description:          l.description,
  Estimate:             "£low–£high" or "",
}
```

### Sort order

Default: **Unique ID**. Options: Unique ID / Barcode / Lot Number (user-selectable).

Sort uses the **actual field** for the active mode, not the generic `folder` field:
- Unique ID: parse `R000016-413` → sort by receipt number then line number
- Barcode: alphanumeric
- Lot Number: integer sort with alphanumeric fallback

`rowLabel()` helper drives the jump list, search filter, and card ID display — they must all use
the same function so they stay in sync.

### localStorage key

`copier_preload` — array of row objects (consumed once and cleared on load).

---

## Duplicate Checker

Groups by `receiptUniqueId` (case-insensitive trim). Only groups with 2+ lots are shown.

Scoring (higher = more complete, keep this one):
```
description: +4 pts
title:       +2 pts
keyPoints:   +1 pt
estimateLow: +1 pt
estimateHigh:+1 pt
lotNumber:   +1 pt
barcode:     +1 pt
vendor:      +1 pt
each image:  +2 pts
```

---

## Apply to Auction Route (`/api/auction-ai/runs/[id]/apply`)

Detects unique ID format with: `/^[A-Za-z]\d{4,7}-\d{1,6}$/`
- If unique ID format → `receiptUniqueId = lot`, `lotNumber = ""`
- If not → `lotNumber = lot`, `receiptUniqueId = null`

Deduplication checks both `existingLotNumbers` and `existingUniqueIds` sets before creating.

---

## BC Warehouse — Location History Tab

**Do not change the design or behaviour of the Location History tab in `/tools/bc-warehouse`.**
It was accidentally replaced during an earlier rewrite and had to be manually restored.

The correct implementation:
- **Two modes**: Tote number and Barcode (toggle buttons, default: Tote)
- **API route**: `/api/bc/location-history` — not `/api/warehouse/location-history`
- **Barcode mode** does two BC queries: barcode → item key, then item key → location changes
- **Results** show: BC Item Key · field2 (if present), movements count, and a table of From / To / Changed by / Date
- **Staff names** are resolved via the `SALESPERSON_NAMES` lookup table in the component
- **"No results" state**: styled card explaining the item may not have been moved or the change log wasn't active
- The most recent movement row is highlighted with `bg-blue-950/30`

If this tab genuinely needs to change, discuss it first and update this rule.

---

## BC (Business Central) Sync

- Token refresh buffer: **60 seconds** before expiry.
- Per-page fetch timeout: **30 seconds**. Full fetch timeout: **45 seconds**.
- Batch size: **500 items per page** (`$top=500`).
- `getBCTokenAny()` picks any valid non-expired token for system/cron use (no user context needed).
- `WarehouseItem.uniqueId` is the primary key for matching against `CatalogueLot.receiptUniqueId`.

### BC Field Name Reference — Auction/Sale Identifiers

⚠ The auction-code field name **differs between endpoints**. Confirmed by
querying the BC OData metadata via `/api/bc/api-viewer`. Using the wrong
field on the wrong endpoint returns a 400 BadRequest, and because the
auction-names sync catches errors per batch, this kind of mistake fails
silently and leaves stale names in the DB.

| Endpoint | Code field | Name field | Notes |
|---|---|---|---|
| `Auction_Lines_Excel` | **`EVA_AuctionNo`** | `EVA_AuctionName` | Auction-level lookup — use this to resolve auction names. Does NOT have `EVA_SalesAllocation`. |
| `Receipt_Lines_Excel` | `EVA_SalesAllocation` | _(no name field)_ | Item-level — `EVA_SalesAllocation` matches `WarehouseItem.auctionCode` |
| `Auction_Receipt_Lines_Excel` | `EVA_SalesAllocation` | _(no name field)_ | Item-level auction receipt lines |

**To resolve auction names:** `WarehouseItem.auctionName` stores the name and is the primary source — read it directly from the DB. It is populated by the sale-checklist route on first load (filter `Auction_Lines_Excel` by known `EVA_UniqueID` values, get `EVA_AuctionName`, write back to DB). `$apply=groupby` is NOT supported by BC OData — do not use it.
**Important:** `Auction_Lines_Excel` is item-level (one row per lot) — never use `$top` alone to get auction names as you'll miss most codes. Use `EVA_UniqueID` filter per known item to get its auction name.

**Do not** use `CatalogueAuction` for names in any BC warehouse view — it is the local cataloguing system and will have stale/wrong names for BC auction codes.

---

## API Route Patterns

**Every route handler must be wrapped in try/catch.** Unhandled exceptions produce HTML error
pages which break any client doing `res.json()`. The pattern for every route:

```typescript
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    // ... logic ...
  } catch (e: any) {
    console.error("route-name error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
```

Error response shape: `{ error: string }` always — never let an exception escape as HTML.

HTTP status codes used:
- 401: Missing/invalid session
- 404: Record not found
- 422: Gemini content block (not a server error — don't use 500)
- 500: Server/config error (missing API key, DB failure)

---

## Hardcoded Constants

| Constant | Value | Location |
|---|---|---|
| Lot title max length | 83 chars | Apply route, lot create |
| Max images per lot (batch) | 24 | Batch route + UI |
| Max images per lot (chat) | 6 | Chat tab |
| Inter-lot delay | 12 000 ms | Batch route |
| Rate limit backoff cap | 1 800 000 ms (30 min) | Batch tab client |
| Rate limit backoff base | 60 000 ms | Batch tab client |
| Other error backoff cap | 30 000 ms | Batch tab client |
| Batch route maxDuration | 300 s | Batch route |
| Chat route maxDuration | 120 s | Chat route |
| BC fetch timeout | 45 000 ms | lib/bc.ts |
| BC page timeout | 30 000 ms | lib/bc.ts |
| BC page size | 500 | lib/bc.ts |
| BC token refresh buffer | 60 s | lib/bc.ts |
| Default AI model | `gemini-3-flash-preview` | page.tsx |

---

## Storage Keys (localStorage)

| Key | Shape | Purpose |
|---|---|---|
| `copier_preload` | `Array<{ Folder, "Receipt Unique ID", Barcode, "Lot Number", Description, Estimate }>` | Cataloguing page → Description Copier |
| `batch_preload` | `{ auctionCode: string }` | Cataloguing page → Batch Run pre-fill |

---

## Model Tester

Run sequentially with a **1-second gap** between models — never `Promise.all`.
Firing all models concurrently burns quota and causes the 429s that show up in the test results.
