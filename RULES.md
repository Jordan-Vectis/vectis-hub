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

## Public site is login-gated (2026-07-09)

The public **customer website** (`app/(site)` — homepage `/`, `/auctions`, `/portal`, `/account`,
`/search`, plus the public `/submit` and `/value` links) is **no longer public**. It now sits behind
the staff **Hub login**, same as the internal Hub. A logged-out visitor to any of these is bounced to
`/login`. This was a deliberate decision — the customer site is not yet meant to be publicly visible.

- Enforced in the `authorized` callback in **`auth.config.ts`** (wired up by `proxy.ts`, Next 16's
  renamed middleware). The only paths that stay reachable while logged out are `/login`, `/setup`,
  and the server-to-server relays `/api/public` / `/api/gap-relay`.
- ⚠ **Do NOT re-add** `/`, `/auctions`, `/portal`, `/account`, `/search`, `/submit`, `/value` to
  `publicPaths` "to fix" customers being unable to reach the site — that lock-out is intentional
  until the customer site is launched. If/when it goes live to customers, that's a deliberate reversal
  to discuss, not a silent edit.
- Applies to **both** staging and production (no env flag).

## Public First Aid page — the ONE deliberate exception (2026-08-11)

`/first-aid` (Facilities → First Aid) is reachable **without logging in**, on purpose: anyone on
site — agency staff, contractors, visitors, none of whom have a Hub account — must be able to find
a first aider in an emergency. This is a deliberate reversal of "only `/login`, `/setup` and the
API relays stay reachable", agreed with Jordan when the app was commissioned.

It is allowed to stay public **only because of these constraints. Keep every one of them:**

- **EXACT-match allowlist entry, not a prefix.** `auth.config.ts` keeps two lists: `publicPaths`
  (prefix, `startsWith`) and `publicExact` (`includes`). `/first-aid` is in the **exact** one, so
  `/first-aid-anything` stays gated. ⚠ Never move it into the prefix list.
- **Top-level route, never inside `app/(app)`.** That group's layout renders the Hub shell and
  reads the session — putting the page there would drag nav and a session lookup onto a page
  anyone can open. There are **no links from it into the Hub**.
- **No public GET endpoint.** The page reads its own tables server-side. Photos go through the
  pre-existing `/api/public/photo` prefix allowlist (`first-aid/` added to it).
- **Everything in `FirstAider` / `FirstAidKit` / `FirstAidInfo` is world-readable** — treat those
  models as public. Never put anything confidential in them.
- **One unauthenticated write**: `POST /api/public/first-aid-report` (already-public prefix, so it
  opened nothing new). It is write-only — it returns no record, not even an id — and is protected
  by a honeypot field, per-field length caps, and two rate limits (per `ipHash` per hour, plus an
  overall hourly cap so a spread-out botnet still cannot fill the table). The IP is **hashed with
  `AUTH_SECRET`, never stored raw** — it exists only to compare against other hashes.
- `AccidentReport` rows are **only ever read inside the Hub** (`/tools/first-aid`, behind the
  `FIRST_AID` app permission). Never surface them publicly.

## Design philosophy — read before building ANY screen

Every rule here exists because it was got wrong, more than once. Each one names the failure.

### 1. Use the width you have
**Never put data, tables, diagrams, plans or side-by-side comparisons in a narrow centred column.**
A narrow column (`max-w-2xl`) is only right for **prose read on a phone** — instructions, a form,
a paragraph of guidance. Everything else gets the screen.
- *The failure:* the site plan on `/first-aid` was rendered inside the page's phone-width reading
  column. A 1:1250 architectural drawing squeezed into 672px is unreadable — which defeated the
  entire point of putting a plan there. Jordan: "we are doing this thing where we dont use the
  full screen again". It had been raised before that.
- If one part of a page is data and the rest is prose, **break that part out** into its own wider
  block rather than narrowing the data or widening the prose.

### 2. Dark mode is the DEFAULT here, not the exception
`<html>` ships with `class="dark"`; light is an explicit user toggle. So **check every new screen
in dark first**, and remember that `dark:` must be the *lighter* value, not the darker one.
- *The failure:* `text-gray-500 dark:text-gray-600` — backwards, and unreadable.
- ⚠ **Native controls inherit the BROWSER's colours, not yours.** A bare `<input type="file">`
  renders "No file chosen" in black and vanishes on the dark theme. Use the shared **`.file-input`**
  class (`app/globals.css`). The same trap applies to `<select>`, `<input type="date">` and
  `datetime-local` — always look at them on the dark theme before shipping.
- ⚠ **The tablet cataloguing screen has its own light/dark switch** (Jordan, 2026-09-11: *"in the top
  right corner can we have a dark/light mode toggle this needs to be on the website search as well"*)
  — `ThemeToggle size="lg"` top-right in its header and in the Website Search panel, because both
  cover the top bar. Same saved setting as the top bar's switch (per device). That screen, Website
  Search, Lens and the Guide were **dark-ONLY** until then (hard-coded `#1C1C1E`, no `dark:` at all)
  and are now light-first with `dark:` variants — **new styling there needs both**, like everywhere else.

### 3. If a symbol or colour means something, there must be a key
Icons and colour coding are not self-explanatory.
- *The failure:* the site plan shipped with 🧰 ⚡ 💧 pins and nothing anywhere saying what they
  meant. A key that lists the actual marked items doubles as useful content, so prefer that to an
  abstract legend.

### 4. Borrow the convention the real world already uses
Where a domain has an established visual language, follow it — people are trained on it and a
wrong colour actively misinforms.
- *The failure:* First Aid was built in red. First aid signage is **green and white** (ISO 7010);
  red means fire equipment or prohibition. Jordan: "the colour scheme being red and not green is
  not a good idea haha".
- Keep red for genuine errors and destructive actions. Don't sweep those green for consistency.

### 5. Build for the iPads, not just the desktop
Much of this app is used on shared tablets, standing up.
- **Touch targets ~44px.** *The failure:* the activity popup's sliders used a default range input
  with a ~16px thumb; on a tablet they read as simply broken.
- **A drag inside a scrolling panel needs `touch-action: none`**, or the panel scrolls instead and
  the control feels dead.
- **Desktop-only styling uses `desk:`** (`app/globals.css`: a mouse or trackpad AND ≥1,280px) —
  never plain `xl:` for "desktop": a 12.9" iPad Pro in landscape is 1,366px wide, and the tablets
  must not change. First used on the Add Lot wizard (2026-09-11, Jordan: "the text boxes are so
  small" on a desktop): the screen splits **50/50** — the step and its banners fill the left half,
  a **"This lot so far"** panel the right — with taller text boxes. ⚠ The panel is **display only**
  — nothing in it is clickable (Jordan: *"more likely they will click it by accident"*); moving
  between steps is Back and Next. Every value is cut to 3 lines with "…" so a long description
  never makes the page scroll (⚠ no `block` class beside
  `line-clamp` — it overrides the clamp's display and the clamp silently stops working).

### 6. ⚠ The DESCRIPTION COPIER's layout is frozen — nothing above the lot card
**Scope: the Description Copier (`/tools/auction-ai` → Description Copier) and nothing else.**
Jordan's **AutoHotkey macro** reads that one page by **screen coordinates** while it types into
BC. Move anything on it and the macro types into the wrong field — silently, overnight, with
nobody watching. Every other screen in the Hub can be rearranged freely; layout there is an
ordinary design decision (Jordan, 2026-08-14: *"The macro only touched the description copier
everything else is fine to be moved around"*).

On the Copier specifically:
- **The lot card and its Copy Description buttons come FIRST.** Banners, warnings and
  summaries go *below* them. Anything above the card moves the card.
- **The page's height must not vary with the data.** A banner that grows with the number of
  flagged lots shifts everything under it on some sales and not others — just as damaging as
  putting it above. Keep such things collapsed by default, or below the working area.
- Making an existing element **taller** counts too (an extra line of text, a label that wraps).
- If something genuinely must sit above the card, **ask first** — it means re-recording the
  macro.

### 7b. A button that takes more than a moment must show REAL progress
**Jordan, 2026-09-08: "just says pulling, no idea of progress or if its working — this is a
repeated issue you have."** A spinner and a present participle are not progress. They are
indistinguishable from a hang, and on a slow job people press the button again or give up.

- **Show a number that moves.** "Reading the auction vendor list — 1,240 vendors so far" tells you
  it is alive and roughly how far along. "Pulling…" tells you nothing.
- **Page the work and let the CLIENT drive the loop**, the way the BC Warehouse Data Sync stages
  and `/api/warehouse/sync/vendors` do: one page per request, each returning a cursor and a running
  count. A single long request *cannot* report progress, and it risks a proxy timeout as well.
- **Say which stage it is on** when there is more than one, so a long pause is explainable.
- **Give it a Stop**, and say plainly what was kept when it is stopped.
- **Never invent a percentage** from a total you have not actually counted. A rising count is
  honest; a fake bar that sticks at 90% is worse than no bar.
- Finish with what happened in numbers, not "Done" — how many were saved, and how many were
  missing whatever the job was for.

*Related failures already recorded:* the Accounts tablet "dead-feeling Reconcile button" (fixed
with `useLinkStatus` spinners) and the pipeline runs that looked finished while every apply was
silently failing. Same root cause: the screen not telling the truth about what is happening.

### 7. Never let "nothing happened" look like success
- *The failure:* Change Vendor reported "✓ Changed 0 lots" when it had changed nothing, so a real
  problem read as done. If a count is zero, say so plainly and say why.

### 8. ⚠ The SALEROOM TRAINER is FROZEN while the Auto Clerk is being worked on (2026-08-21)
Jordan: *"we made some great changes for training our staff and the design of the clerking
screens so I want a rule made first you cannot change anything in here while working on the
autoclerk."* The trainer (`/tools/saleroom-trainer`) is a finished staff-training tool with
screens skinned to match the real clerking software; it is **not** Auto Clerk scratch space.

**Do not edit ANY of these while doing Auto Clerk work — not a line, not a colour, not a comment:**
- `app/(app)/tools/saleroom-trainer/` (layout.tsx, page.tsx)
- `public/saleroom-trainer.html`, `public/saleroom-trainer-bid.html`, `public/vectis-clerk-trainer.html`
- `app/api/trainer/**` (qr, sales, sales/lots)
- `lib/trainer-socket.js` and its `setupTrainerSocket` hook in `server.js`
- the trainer's registrations in `lib/app-cards.ts` and `components/nav.tsx`

**The ONE sanctioned exception (Jordan, 2026-08-24):** a single static link row in the trainer menu's
"Join a Running Sale" section pointing to the Stress Tester (`public/auto-clerk-bidders.html`, an
auto-clerk file). Jordan chose this placement knowingly when offered a trainer-free alternative.
It is a link only — no trainer logic changed, and no further trainer edits are covered by it.

**Second sanctioned exception (Jordan, 2026-08-24, asked for and confirmed against this rule):**
ten more built-in practice lots (ids 518–527, identical list in BOTH trainer files, so the two
platforms stay in step), and **simulated starting bids in the Vectis Clerk Trainer ONLY** — on the
built-in lots, roughly two lots in three open with a commission-style bid on the grey Auto Bid chip
at a random ladder figure under £100 (`seedStartBid()`, rolled once per lot and stored on it).
The Saleroom trainer got the lots but NO starting bids, deliberately — the point is the screens
start uneven so an auto clerk must catch the other platform up. Nothing else in the trainers is
covered by this.

**Third sanctioned exception (Jordan, 2026-08-25, confirmed via the conflict question):** the
sale-reversal controls, so the Auto Clerk's sold-check recovery is testable on the trainers.
The Vectis Clerk Trainer grows a **Re-Open Lot** button after a hammer/pass (as the real Bidpath
page does) — it clears the lot's outcome and the standing bid simply stands again. The Saleroom
trainer's **top-row Undo next to Sell/Pass** was corrected: it existed but wrongly shared the
bid-undo's handler (after a sale it ate real bids press by press); it now undoes the PRESS of
Sell/Pass itself — re-opening the lot, touching no bid — while the left-column Undo remains the
bid-undo, and guided scenarios still see the plain undo they script for. Nothing else is covered.

**If the Auto Clerk needs a replica screen, COPY the trainer file into a new `public/auto-clerk-*.html`
and change the copy** — exactly how the Scenario 1 rig (`auto-clerk-fake-saleroom.html`) was made from
the Saleroom replica. A copy may drift from the trainer afterwards; that is accepted, and it is why the
rule exists. The trainer's room protocol (`trainer:*` socket events) is likewise read-only from the
Auto Clerk's side. A genuine trainer bug found during Auto Clerk work is reported to Jordan, not fixed
in passing.

## ⚠ Claude memory sync (multi-developer) — check freshness before trusting local memory

The in-app memory page — the `ENTRIES` array in `app/(app)/admin/memory/page.tsx`, shown at
`/admin/memory` — is the **shared, committed record** of this project's Claude memory. Each
developer's *local* Claude memory (`~/.claude/…/memory/*.md`) is **per-machine and drifts**:
another dev's Claude will not have the facts your Claude recorded, and may be **stale** (still
describing things that have since changed).

**At the start of a work session — and before relying on memory to make a suggestion or edit —
compare your local memory against the shared record in `app/(app)/admin/memory/page.tsx` on the
`staging` branch** (`git pull origin staging` first, then read the file — no live URL / login
needed). **Always use `staging`, never `main`/production:** memory updates are pushed to staging
first and only reach production on a later merge, so production's copy lags and is not authoritative
for freshness. If your local memory is clearly **behind** the staging record (missing
recently-shipped features/decisions, or contradicting them), **STOP and warn the user that their
local memory looks out of date, then ask whether to refresh it from the shared record before
continuing.** Do not silently proceed on stale memory.

⚠ **`app/(app)/admin/memory/page.tsx` is a SERVER component — keep it that way.** It holds the
`ENTRIES` array, filters it per-request against the viewer's session, and passes only the
permitted entries to the client half (`memory-client.tsx`). Some entries are gated to a single
user (`JORDAN_ONLY`). **Never add `"use client"` back to `page.tsx`** (or import `ENTRIES` into
`memory-client.tsx`) "to simplify it": that compiles every entry into the JS bundle, where a
gated entry is readable by anyone in view-source and the filter proves nothing. The route must
also stay dynamic (`auth()` keeps it so) — a cached payload would serve one user's entries to
another. Verify a change here by rebuilding and grepping `.next/static` for a gated entry's text:
it must return **nothing**.

Rules for the refresh:
- Refresh only **project** and **reference** facts (shared project knowledge). Do **NOT** pull another
  machine's **user**/**feedback** memories over the local ones — those are personal to each developer.
- Refresh = fill in what's missing and correct contradictions, then re-sync `MEMORY.md`. The app
  record is a condensed mirror, so it's a catch-up, not a byte-for-byte clone.
- **Never push a stale local memory OVER the shared `ENTRIES` array.** When updating the shared record
  after building, edit only the specific entry for what you built, **pull before pushing**, and never
  regenerate the whole array from local memory (that would drop entries other devs added).

## Departments gate which sales a cataloguer sees (2026-07-27)

A `Department` carries **`auctionTypes String[]`** — the `CatalogueAuction.auctionType` values it
covers. People link to departments many-to-many via **`UserDepartment`**. A cataloguer sees the sales
their departments cover, plus any single sale an admin added them to (**`CatalogueAuctionAccess`**,
granted on the Auction Settings tab, admins only). `User.departmentId` is **legacy** — backfilled
into `UserDepartment` and kept roughly in step, but **never read for access**.

All of it goes through **`lib/departments.ts`**: `getDepartmentAccess`, `auctionWhere` (spread into a
Prisma `where`), `canSeeAuction`.

- ⚠ **Any new page that lists or opens sales MUST apply it.** It is already on Auction Manager,
  Tablet, Photography, the Auction AI auction dropdown, the transfer-lots target list, and the sale
  page itself. Miss one and that page becomes the way round the restriction.
- ⚠ **Hiding a sale from a list is not a restriction** — the sale page re-checks and redirects,
  logging to the Access Log with `source: "auction_department"`. Keep both halves.
- ⚠ **Three deliberate "sees everything" fallbacks — do NOT tighten them without asking.** Someone in
  no department; someone whose departments cover no auction types yet; and any failure reading the
  new tables (they only exist after Run Migrations, while code deploys instantly). All return
  unrestricted. The point is that turning this on cannot silently empty the whole team's sale list.
- A sale type belongs to **one** department. Ticking it on another department **moves** it.

The Manager Portal is tabbed (Sales / Departments), registered in `APP_SECTIONS.MANAGER_PORTAL` so
the existing per-section permission tickboxes gate the Departments tab. Its figures keep the
orphaned-timing-log exclusion so they agree with the Sales tab and the Reports pages.

⚠ **Sale pace/projection maths lives ONLY in `lib/sale-projection.ts`** (`paceFor`, `milestonesFor`,
`daysToSale`). Both Manager Portal tabs import it. Do not reimplement it anywhere else — a second
copy will drift and the two tabs will start reporting different dates for the same sale. Both tabs
also take their lot totals from `/api/manager-portal/bc-counts` (Hub ∪ BC, deduped by barcode) so a
sale reads the same on each.

## Database — Neon (PostgreSQL)

The database is hosted on **Neon** (console.neon.tech), not Railway. Never suggest looking for a Postgres service inside Railway — it isn't there.

- Neon provides point-in-time restore via branching
- The `DATABASE_URL` env var in Railway points to the Neon connection string
- A scheduled **JSON** backup exists: `/api/cron/db-backup` (run by a `server.js` setInterval loop at midnight UTC, 24h cadence) dumps tables to R2 (`CLOUDFLARE_R2_BACKUP_BUCKET`), keeping the last 30 per env, surfaced at `/admin/backup`. A true `pg_dump` / point-in-time dump is still not configured — Neon branching remains the primary restore path.

### ⚠ `.env` points at the REAL database — server.js only does its jobs in production

The local `.env` `DATABASE_URL` is the **shared Neon database**, not a local copy (same for the R2
bucket). `server.js` therefore gates its three unattended boot jobs on the module-level `dev` flag
(`NODE_ENV !== 'production'`), so they run on Railway and **never** from a dev machine:

- `runMigrations()` — would push migrations at the shared DB off a work-in-progress branch,
  outside the deliberate Run Migrations button flow.
- `resetStaleLiveAuctions()` — would flip a **genuinely live** auction to `PENDING`, dropping the
  live banner off the public site mid-sale. (Correct on a real restart; wrong from a laptop.)
- The four cron loops — db-backup writes to the real R2 bucket; **it-mailbox and
  condition-mailbox poll every 5 min and turn real emails into Job Board jobs / Condition
  Reports**. They no-op locally today only because `CRON_SECRET` is absent from `.env` — do not
  rely on that accident.

Gate on `dev`, not a new env var: it's the same flag passed to `next({ dev })`, so it cannot be
wrong on Railway without Next already running in dev mode there. ⚠ This is a **seatbelt, not a
cure** — running the app locally still reads and writes live data. Use `npx next dev` (skips
`server.js`) to run a page locally, and test anything on this boot path with a deliberately bogus
`DATABASE_URL` so a mistake can't reach real data.

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

⚠⚠ **And do not ASK to push to main either** (Jordan, 2026-09-04: *"you dont need to ask I will tell
you when"*). Finish the work, push to `staging`, say plainly what is sitting there and therefore not
live for him — then stop. No offer, no reminder, no "just say the word". He works on production all
day and picks the moment himself. Same shape as the Run Migrations rule: state it once, never nag.

### ⚠ Refresh the changelog seed before pushing

```bash
npm run changelog:seed
```

Run it **as part of every push**, or the work will not appear in Admin → **Patches & Changes**.

⚠ **It folds itself into your last commit — it does not make one of its own** (2026-09-04).
Railway names a deployment after the **HEAD commit of the push**, and `capture-changelog.mjs`
reads that same commit for the release headline. While the refresh was a separate commit pushed
on top, it was always HEAD — so **every** Railway deployment and **every** release row was titled
*"Refresh changelog seed"*, with the actual work buried underneath (Jordan, 2026-09-04: *"How come
all the pushes are just called this in railway?"*). Now the seed rides inside the commit it
describes, and the deployment is named after the work.

- It amends **only** when that is unmistakably safe: HEAD unpushed, not a merge commit, nothing
  else staged, no rebase in progress. Otherwise it writes the file, prints why it stopped, and
  leaves the commit to you. It never force-pushes. `--no-amend` forces the old behaviour.
- ⚠ **The newest commit is deliberately absent from the seed.** Amending changes its sha, so
  recording the old one would file a commit that no longer exists — and because ingest is keyed
  on `sha`, the next refresh would add the new sha *beside* it as a permanent duplicate row on
  Patches & Changes. The deploy capture records HEAD under its final sha instead, and the next
  refresh files it. Nothing is missed and nothing is filed twice. Do not "fix" this by including
  HEAD.
- `isHousekeeping` in `lib/changelog.ts` also matches *"Refresh changelog seed"*, so the ~30 such
  commits already in the history stop padding the manager report. No new ones are created.

**Railway's build has no `.git` directory.** `scripts/capture-changelog.mjs` therefore falls
through to `RAILWAY_GIT_COMMIT_SHA` / `_MESSAGE` and records **exactly one commit per release** —
the headline one. The running app has no git and no GitHub token (deliberate), so the *only*
complete history it can ever see is the one **committed into the repo**: `lib/changelog-seed.ts`.
That file had gone stale by 33 commits (Jordan, 2026-08-17: *"We have made so many changes today
but the patches tab only has 1 thing"* — a full day's work showed as a single line).

`scripts/refresh-changelog-seed.mjs` regenerates it from the full local history. It refuses to
write from a shallow clone and refuses to shrink the file, so it can only ever add. Ingest is
keyed on `sha`, so re-seeding never duplicates anything.

⚠ The page's "the record is complete up to X" banner reads that date **from the seed's newest
entry** — never hardcode it. It only appears when changes shown actually fall past that date, so
a stale seed is visible and a fresh one is silent.

---

## General

- **Never call the WHOLE Hub "the CRM".** It is the **Vectis Hub** ("the app"). It *began* as a CRM-only tool and grew into the Hub — a broad internal toolset — but Claude kept reflexively calling the entire thing "the CRM"; **this rule exists to stop that habit.** ⚠ The ban is on mislabelling the *overall app* (or tools outside the CRM area) as a CRM — it is **NOT** a blanket ban on the word. The genuine **CRM section** (Submissions / Follow-ups / Contacts) really IS a CRM and is **correctly** labelled "CRM" in the nav, hub card, and "Buyer — CRM" tab — leave those. (`/crm-settings` was reworded to "Department Settings" on 2026-06-29 because it manages Departments, not CRM-specific settings — an accuracy fix, not because "CRM" was wrong there.)
- The business is **Vectis auction house**. All language should reflect an auction context.
- British English spelling throughout: "Unauthorised", not "Unauthorized".
- Superadmin email `it@vectis.co.uk` is hardcoded to always receive ADMIN role regardless of DB role.

---

## Lot Identifiers — Critical Field Rules

**Two** identifier fields exist on `CatalogueLot`. They are not interchangeable.

| Field | Format | Example | Rule |
|---|---|---|---|
| `receiptUniqueId` | `[A-Za-z]\d{4,7}-\d{1,6}` | `R000016-413` | AI runs, receipt matching |
| `barcode` | `[A-Za-z]\d{6,7}` OR unique ID format | `F066001` | Physical label on item |

**CRITICAL**: Unique IDs (`R000016-413` format) must always be stored in `receiptUniqueId`,
never in `barcode`. A lot with `receiptUniqueId` is fully identified even with no `barcode`.

⚠ **`lotNumber` no longer exists on `CatalogueLot`.** It was dropped in migration
`20260528000001_remove_lot_number` (also removed from `CatalogueTimingLog`). Do **not** add it back,
and do not write code that reads or writes it on a lot. The `lotNumber` names still in the codebase
are **unrelated** and must be left alone:
- `ConditionReport.lotNumber` — the lot number a customer quoted in a condition-report request
  (`lib/condition-parse.ts`, `lib/condition-ingest.ts`, `lib/condition-bc.ts`).
- `lotNumber` in the live-auction Socket.IO payloads (`lib/auction-socket.js`) — a **wire-protocol
  field name only**, populated from `barcode || receiptUniqueId || id`. It is not a DB column.
- `lot_number` from the Bidpath WebSocket feed in Auction Monitor / Auto Clerk — third-party data.

⚠ **The Hub NEVER mints unique IDs (changed 2026-08-06 — Jordan's decision after the workflow
review).** A lot is created with `receiptUniqueId = NULL` everywhere (`createLot` / wizard,
`importLots`, `massCreateLots`, Photo Only), and the **only** population path is **🔗 BC Match &
Import** on the sale page (`bulkAssignUniqueIds` — upload the BC Lines export, matched by barcode,
writes **BC's own UniqueID** onto the lot). Rationale: the Hub used to mint a provisional
`{receipt}-N` under a per-receipt advisory lock, but the real workflow always overwrote those with
BC's numbering at the BC Match step — two racing numbering systems for no benefit.
- **The BARCODE is a lot's identifier until BC Match runs.** Every matching path already checks
  barcode first. Do not add code that assumes a new lot has a unique ID, and do NOT "fix" blank
  unique IDs by re-adding minting anywhere.
- **⚠ Never use `receiptUniqueId` to decide whether a lot exists in BC — BARCODE ONLY** (Jordan's
  explicit rule, 2026-08-07). Legacy Hub-minted `{receipt}-N` IDs collide with BC's own numbering
  for OTHER items, so a uniqueId "match" can point at a different lot entirely. An OR across
  barcode + uniqueId in the End of Day pending check silently kept **292 lots across 10 sales**
  off the overnight sheet this way. (Matching **by** BC's own imported IDs — Push to BC, AI
  apply within a sale — is fine; those IDs came FROM BC via BC Match.)
- **Change Vendor** (Manage Lots → Tools) and the End of Day intervention tools set vendor/receipt
  (and tote) from the BC tote data but **no longer mint IDs** — blanks stay blank until BC Match;
  existing IDs are never touched by them.
- Manual entry via the lot editor still works, but is for corrections — the value should be BC's.
- The old advisory-lock + `maxReceiptSuffix` scheme survives only inside `fillLotsFromTotes`,
  which **nothing calls** — don't reach for it, and don't wire it back up.
- There is still no DB unique constraint on `receiptUniqueId` (historic duplicates would block it).

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

## Auction AI Instructions — Single Source of Truth

The **`AiPreset` database table is the one and only home** for every Auction AI instruction
(the presets shown on Auction AI → **Instructions**). This replaced an earlier two-source design
(code constant + DB override) that silently drifted — the DB was auto-seeded once from code and then
frozen, so later code edits never reached the live app (this is how the Model Railway "condition"
drift happened even though nobody edited it in the UI). Do **not** reintroduce a code-vs-DB merge.

- `lib/auction-ai-presets.ts` (`PRESETS`) is **starter defaults only** — used once to seed a
  brand-new **empty** DB. Editing it does NOT change a seeded environment. It is imported **only**
  by `lib/ai-instructions.ts`. Never import it into a route or the page to read live instructions.
- `lib/ai-instructions.ts` is the runtime accessor: `getAllInstructions()` (ordered map, seeds only
  if the table is empty) and `resolveInstruction(key)` (single lookup, throws if missing).
- **Runs resolve their instruction server-side by key.** Batch/Chat/Chat-grounded receive a
  `presetKey` in FormData and call `resolveInstruction(presetKey)` — clients never post instruction
  **text**. So a stale/open tab cannot run old wording.
- **No session-only / temporary instructions.** There is no "Custom (paste my own)" box and no inline
  session editor. If the user wants different text they add or edit a saved instruction (via
  `PUT /api/auction-ai/presets`), which persists to the DB forever. Delete is permanent (the table is
  only ever auto-seeded when completely empty, so a deleted built-in does not reappear).
- The Instructions page is the **only** editor. Do not add editing UIs to the run tabs.
- **Instructions Testing tab (2026-08-19)** — Auction AI → Run → 🧪 Instructions Testing runs the full
  pipeline (Batch → Key Points → Double Check) over 5–10 hand-picked lots so instruction wording can be
  tried before a real sale. It is **PREVIEW ONLY and must stay that way**: no description, estimate,
  `aiFlagNote`, pipeline row or saved run is ever written. Do not add an apply/save button to it — the
  point is that a test run has no consequence. It honours the rule above (no instruction editor; it
  posts a `presetKey` like every other run tab). Its retries are deliberately **bounded** (3 attempts)
  rather than the pipeline's infinite loop, so a 5-lot test can never hang — failures are reported
  loudly on the lot, never swallowed. Lives in `app/(app)/tools/auction-ai/instructions-test-tab.tsx`.
- **Export / Import (sync between environments).** Staging and production are **separate databases**,
  so instruction edits do not cross over automatically. The Instructions page has **⬇ Export all**
  (downloads every instruction as `vectis-instructions-<date>.json`) and **⬆ Import** (upload that
  file → tick which to apply → upserts them). `POST /api/auction-ai/presets` does the bulk upsert
  (add new / overwrite by key). Import **never deletes** — it only adds/overwrites the ticked keys.
  This is the intended way to make production match staging after an instruction change.
- **Archive (2026-09-04).** `AiPreset.archived` (Boolean, **NEEDS Run Migrations**) takes an old
  instruction out of the Instructions list **and out of every run-tab dropdown**, reversibly.
  Toggled by 🗄 Archive / ↩ Restore on the view panel, or ↩ in the collapsed **🗄 Archived (N)**
  section at the foot of the list. Same `PATCH /api/auction-ai/presets` as favourites, which now
  accepts `{key, favourite}` and/or `{key, archived}`.
  - ⚠⚠ **`resolveInstruction()` must NEVER check `archived`.** A queued overnight sale stores its
    instruction as a plain string on `PipelineQueueItem.preset` — no foreign key, no validation.
    Refusing an archived key would fail **every lot of that sale, all night, unattended**. Archiving
    is a LIST FILTER, not a delete and not a lock.
  - ⚠ Filtered in **`getAllInstructions()`**, never in `fetchRows()`. That function's
    `rows.length === 0` check seeds the starter defaults, so filtering lower down would make
    archiving the last instruction **re-seed every built-in**. One filter there hides them from all
    five pickers at once (Chat, Batch, Pipeline, Instructions Testing, the overnight queue form).
  - ⚠ **`getPresetLayout()` (`?layout=1`) deliberately still returns them**, flagged — it feeds the
    tab that has to show them to restore them, and it feeds **Export all**.
  - ⚠ The client keeps archived rows in `presets` and filters at **render**. Dropping them at load
    would leave them out of the export file and renumber `sortOrder` around the gap on the next drag.
  - Export/Import **v4** carries an `archived` array, guarded by `Array.isArray` exactly like
    `favourites`, so importing an older file never un-archives anything.
  - ⚠⚠ **Every picker reloads on change, via `useInstructionOptions`** (`use-instructions.ts`).
    They each used to fetch once on mount with `[]` deps, and this page keeps its tabs MOUNTED
    (hidden with CSS, not unmounted) — so an archived instruction stayed sitting in the Batch,
    Chat, Pipeline and Instructions Testing dropdowns, still pickable, until a full page reload.
    Jordan: *"If they are archived I dont want them to show on any drop downs anywhere"*.
    Anything that changes which instructions EXIST calls `announceInstructionsChanged()` —
    archive, restore, delete, new, import. **Add the call to any new one, and use the hook rather
    than a fifth copy of the fetch.**
  - ⚠ The hook also drops a selection that has just been archived (`p && m[p] ? p : first`).
    Without it the picker shows a value with no matching `<option>` and renders blank.
  - ⚠ Archiving whatever currently sorts first silently changes the default instruction on the four
    tabs that auto-select `Object.keys(m)[0]`. Expected, but worth knowing.
  - `fetchRows()` gained its own fallback tier for the new column. **Each tier drops exactly one
    feature** — adding a column to the top select without a matching tier sends a pre-migration
    environment straight to the raw two-column read and silently loses favourites and categories.
- **Favourites.** `AiPreset.favourite` (Boolean, **NEEDS Run Migrations**) pins instructions to the
  top of the Instructions list (and the run-tab dropdowns, via favourites-first ordering). Toggled by
  the ★ button → `PATCH /api/auction-ai/presets {key, favourite}`. `getAllInstructions()` returns the
  ordered list favourites-first; `GET ?full=1` returns `[{key,instruction,favourite}]` for the
  Instructions tab, the default GET still returns the `{key:text}` map for the run tabs.
  Export/Import v2 carries a `favourites` array so they sync between environments (a v1 file without
  it never clears favourites). `getAllInstructions`/`resolveInstruction` are **migration-safe** — they
  select only existing columns / fall back if `favourite` isn't there yet, so the deploy can't break
  the Auction AI tools before Run Migrations is clicked.

---

## Batch AI Run — Server (`/api/auction-ai/batch`)

- `maxDuration`: 300 seconds.
- Up to **24 images per lot** (`files.slice(0, 24)`).
- Files sent as `lot_{name}_image_{i}` keys in FormData.
- **12-second delay between lots** to stay within Gemini rate limits.
- **No retries inside the route** — throw immediately so the client's retry loop handles it.
- **Instruction is resolved from the DB by `presetKey`** (FormData), not posted as text — see the
  single-source rule above. Missing/unknown key → 400. The empty-key case yields no instruction
  (only the `LANGUAGE_RULE` is applied).
- **Key points are authoritative.** When `lot_{label}_context` (contextType `keyPoints`) is sent,
  the route's user prompt forbids overriding a stated **class / model type / catalogue number /
  running number / livery** with a visual or training-data guess — the cataloguer had the item in
  hand. A strongly-suspected error must be KEPT in the description and raised on a `FLAG:` line,
  never silently changed. Both paths that hit this route must honour this: the **Auto Pipeline**
  sends key points, and the **standalone Batch Run** now also sends them (it looks them up from
  `/api/auction-ai/catalogue-lots?code=` by barcode/receiptUniqueId when an auction code is set).
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

### ⚠⚠ A leaked tool call is NOT a description (2026-09-01)

Gemini sometimes answers by **writing out the search it wanted to run** instead of running it:

```
Unboxed Sony PlayStation 1 with Games Includes. tool_code
print(google_search.search(queries=["Sony PlayStation 1 with Games Includes"]))
```

That exact text reached a live catalogue — the batch route only ever removed the `Estimate:` and
`FLAG:` lines and passed everything else through, and it is not empty, so the empty-answer guard
never saw it. Double Check then tried to rewrite the mess, invented a product code doing it, and
the lot surfaced in Review as a **cataloguer** mistake, which it never was. Measured on F113:
10 lots, three of them nothing but the leak.

- `stripToolCallLeak()` / `hasToolCallLeak()` in **`lib/description-cleanup.ts`** are the single
  source — fenced ` ```tool_code `, `<tool_code>`, the bare marker mid-sentence, and any
  `print(google_search…)` / `default_api` line. Universal, **not** preset-scoped (unlike
  `cleanBearsDescription`).
- **Every route that turns a Gemini reply into description text must check it**: batch,
  key-points-check, double-check, upgrade. Add the check to any new one.
- The text always **stops dead** where the model went to search, so what is left is half written.
  Batch and Upgrade therefore **fail the lot** rather than saving it; Key Points and Double Check
  keep the description they were given. A failure is bounded like an empty answer — 4 retries
  alternating primary/fallback model, then skipped **loudly**, never silently.
- ⚠ The strip must use `[ \t]`, never `\s`, around the bare marker: `\s` eats the newline after it
  and takes the last real sentence away with the `print(` line.
- ⚠⚠ **`MALFORMED_FUNCTION_CALL` is the same family, and it was LOSING lots (2026-09-02).** It is
  the model fumbling a real tool call, not a refusal — but every non-STOP finish reason is thrown
  worded `Blocked (…)`, so `isBlock` matched it and the lot was skipped on the FIRST try and
  reported as "content blocked" (F116378, on an overnight run). It is stochastic and clears on the
  other model, so it now takes the same bounded 4 retries. **Never let a give-up predicate decide
  on the `BLOCKED:` prefix alone** — the key-points and double-check routes throw
  `BLOCKED: MALFORMED_FUNCTION_CALL`, so a prefix test throws the lot away in those stages too.

---

## ⚠⚠ Applying an AI description must KEEP the condition line (2026-09-01)

The AI is told never to write a condition — it is a human's judgement, recorded in its own field —
so its text carries none. Every apply path therefore used to write over the whole `description`
field and take the `Condition appears …` line straight off any lot that had one.

**Measured, not guessed:** on F114, `CatalogueBulkUndo` showed Add Conditions pressed five times
(507, then 7, 21, 1, 11). Every lot in the four follow-up presses had already been done by the
first, and every one had been rewritten by `ai_apply` in between; none had been regraded.
**151 of 246 applies that day wiped a condition sentence; 620 across all sales.** Jordan reported
it as *"the add conditions button is really glitchy, I have to press it over and over"* — the
button was correct every single time.

**Jordan's rule:** *"the condition always goes at the end and is phrased how the lot wizard does
it; any wording relating to condition not from our wizard should never be affected."*

- `keepConditionLine(previous, condition, next)` in **`lib/condition.ts`** is the one
  implementation. `CONDITION_SENTENCE_RE` matches only OUR `Condition appears …` sentence, so a
  cataloguer's own prose ("in good condition throughout", "some wear to the box") is never
  matched, carried or stripped.
- ⚠ It **never ADDS a line to a lot that did not have one** — whether the sentence is on a
  description at all stays Add Conditions' decision. This was chosen over "always append when a
  condition is set"; don't quietly upgrade it.
- The condition FIELD wins when set (a lot regraded since comes back with its current grade),
  falling back to the exact line that was there when the field is blank.
- Wired into **all four** paths that write an AI description onto a lot — `applyAiDescriptions`,
  `applyAiDescriptionOne` (which every browser path goes through), `applyDescription` in
  `lib/pipeline-runner.ts`, and `app/api/auction-ai/runs/[id]/apply/route.ts`. **Add it to any
  new one.**
- Human edits (`review_tab`, `lot_editor`) are deliberately left alone.

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

Lot lookup map uses two-way matching — **both** identifier fields are checked
(`photo-upload-tab.tsx`, used by both the filename grouping and the smart scan's `buildGroups`):
```typescript
new Map([
  ...lots.filter(l => l.barcode).map(l => [l.barcode!.toLowerCase().trim(), l.id]),
  ...lots.filter(l => l.receiptUniqueId).map(l => [l.receiptUniqueId!.toLowerCase().trim(), l.id]),
])
```

---

## Description Copier

### Data sent from cataloguing page

`Folder` must always be `receiptUniqueId || barcode` — never just one of them.
A lot can legitimately have only one of the two, and using a single field leaves `Folder` blank,
which breaks the jump list and ID display (this has been broken before).

Always include both ID fields alongside `Folder`:
```javascript
{
  Folder:               l.receiptUniqueId || l.barcode || "",
  "Receipt Unique ID":  l.receiptUniqueId || "",
  Barcode:              l.barcode || "",
  Description:          l.description,
  Condition:            l.condition || "",
  Estimate:             "Estimate: £low–£high" or "",
  ImageUrls:            l.imageUrls || [],
}
```

### Condition check (2026-08-14)

`Condition` carries the lot's **recorded** condition so the Copier can check it is actually
**in the description**, rather than popping the old blanket reminder on every visit (which said
the same thing whether or not anything was wrong). `checkConditionInDescription` in `lib/condition.ts`
returns one of: `ok` · `reworded` (a grade is there, not in the recorded words) · `missing` ·
`none-recorded` (nothing graded on the lot yet) · `unknown` (row came from a spreadsheet, which has
no condition column — then all that can be said is whether a grade appears).

⚠ Grade detection is **case-SENSITIVE** on purpose. "Mint", "Good" and "Fair" are ordinary words, so
matching case-insensitively counts *"a good example of the type"* as a condition. Every grade
`buildCondition` writes is capitalised, and that is what separates a real grade from prose — don't
"fix" it to case-insensitive.

### Sort order

Default: **Unique ID**. Options: Unique ID / Barcode (`SortBy = "uniqueId" | "barcode"`).

Sort uses the **actual field** for the active mode, falling back to the generic `folder` field:
- Unique ID: parse `R000016-413` → sort by receipt number then line number
- Barcode: alphanumeric (`localeCompare` with `numeric: true`)

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
barcode:     +1 pt
vendor:      +1 pt
each image:  +2 pts
```

---

## Apply to Auction Route (`/api/auction-ai/runs/[id]/apply`)

Detects unique ID format with: `/^[A-Za-z]\d{4,7}-\d{1,6}$/`, then matches the run's `lot` string
against the auction's existing lots:
- Unique ID format → looked up in the `receiptUniqueId → id` map
- Otherwise → looked up in the `barcode → id` map

**Match found** → update only `title`, `description`, `aiEstimateLow/High`, `aiUpgraded`. Never
touch the human `estimateLow/High` on an existing lot.
**No match** → create a new lot with both the human and AI estimate fields set from the AI estimate,
and `receiptUniqueId = lot` **only when it is unique-ID format** (`isUniqueId ? l.lot : null`).

⚠ A run lot in **barcode** format that matches nothing is therefore created with **no identifier at
all** — the route does not set `barcode` on create. If that ever needs fixing, it's a deliberate
change to discuss, not a silent edit.

Run lots are deduplicated by trimmed `lot` string before applying (last saved record wins).

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

## Lot Change Log — log EVERY lot mutation

The `CatalogueLotEvent` table is the audit trail behind `/admin/lot-log`. It must capture **who
did what, when, and in which tool** for every way a lot changes — creation (with the details
entered), field edits, deletion, and photo changes. It used to be fed by `updateLot` alone (1 of
~36 mutation paths); now every path logs.

- **All logging goes through `lib/lot-log.ts`** — `logLotCreated` / `logLotsCreated`,
  `logLotDeleted`, `logLotFieldChanges` (diffs a before/after snapshot), `logLotPhoto`,
  `buildLotEventRow` + `writeLotEvents` (bulk). **Never write `catalogueLotEvent` rows directly.**
- In `lib/actions/catalogue.ts`, single-lot updates go through the local **`updateLotLogged(lotId,
  data, ctx)`** helper (fetches before, updates, logs the diff) instead of a bare
  `prisma.catalogueLot.update`. Bulk `updateMany` paths snapshot before, then log the changed lots
  under one `batchId`.
- **When you add ANY new code that creates, edits or deletes a lot (or its photos), you MUST log it.**
  Every event carries `action` (created/updated/deleted/photo_*), `source` (which tool — e.g.
  `lot_create`, `lot_editor`, `review_tab`, `photo_tab`, `ai_apply`, `bulk`, `import`, `mass_create`,
  `warehouse_fill`, `transfer`, `admin_db`) and, for bulk actions, a shared `batchId`.
- Schema: `CatalogueLotEvent.action` / `source` / `batchId` (**NEEDS Run Migrations**). Backup
  **restore** deliberately does NOT log (it's disaster recovery, not user edits).

## Server-action errors are REDACTED in production — return them, don't throw

In a production build, when a **server action throws**, Next.js hides the real message and the
client receives a generic **"An error occurred in the Server Components render… message is omitted
in production builds…"**. So a user hitting an expected/business error (the **BC lock** in
`requireNotBCLocked`, a permission failure, etc.) sees gibberish, not the reason.

**For any action whose failure a user needs to understand, RETURN the error, don't throw:**
`Promise<{ ok: boolean; error?: string }>` — wrap the body in try/catch and `return { ok: false,
error: e?.message }`, then show `res.error` in the client. The review-tab actions
(`saveLotDescription`, `setLotReviewFlag`, `saveAiFlagNote`) do this — otherwise a cataloguer editing
a **BC-locked** auction (which correctly blocks non-admins) just got the masked error.
(`bcLocked = auction.catalogued && role !== "ADMIN"` — admins bypass, which is why "works for admin,
not cataloguers" is the signature of a lock issue.)

**Review tab bypasses the BC lock (2026-07-01).** `saveLotDescription`, `setLotReviewFlag` and
`saveAiFlagNote` do **not** call `requireNotBCLocked` — the Review tab is QA/corrections and
cataloguers are allowed to fix lots even after the auction has gone to BC. The lock STILL applies
everywhere else (`updateLot`/wizard/Manage Lots, `deleteLot`, bulk actions, `transferLots`,
`saveLotExtraDetails`). Don't re-add the lock to the three Review actions.

---

## ⚠ Change Vendor by RECEIPT clears the tote (2026-09-04)

Change Vendor (Manage Lots → Tools, and the End of Day → BC intervention bar) takes a tote OR a
receipt, and the vendor behind it is read from the BC tote data.

- Type a **tote** → vendor, receipt **and tote** are all set from BC (2026-08-12).
- Type a **receipt** → vendor and receipt are set, and the **tote is CLEARED**.

A receipt covers several totes, so there is no single tote to set, and the one the lot is carrying
belongs to wherever it used to be. Leaving it there made End of Day flag the lot — and worse,
🔧 **Fix what BC can prove** then corrected vendor/receipt back **FROM that stale tote**, silently
reversing the change that had just been made.

⚠ **It clears unconditionally.** Jordan asked for exactly this, twice, the second time after being
shown something cleverer: *"I just wanted it so if I pressed change vendor it cleared the tote
field?"*. A version that kept a tote BC still places on the new receipt was built and **rejected as
more than was asked for** — do not reintroduce it.

⚠ A cleared tote raises **nothing** on End of Day — the empty-tote flag was removed the same day
(next rule). Tote Check and Locking Check still show it.

Both confirm dialogs say the tote will be cleared. A field that empties itself without warning is
how people stop trusting a tool.

---

## ⚠ End of Day does NOT flag an empty tote (2026-09-04)

Jordan: *"on the end of day remove the flag for empty totes it doesnt matter as we do everything of
receipt anyway"*.

The overnight sheet is keyed on **receipt**. A lot with no tote goes on it and imports perfectly
well, so `no_tote` never described a problem with tonight's run — and it became self-inflicted on
the same day, because Change Vendor by receipt now clears the tote deliberately and would have
raised a fresh flag every time.

⚠⚠ **It is dropped in `app/api/catalogue/end-of-day/route.ts`, NOT in `checkLot`.** The **Tote Check
tab and Locking Check still show it** — those are the screens where not knowing a lot's tote
actually matters. Never remove `no_tote` from the shared `lib/tote-check.ts`; that would silently
blind all three.

The page's `CHECK_META` entry, its row renderer case and its "not ignorable" clause went with it.
`duplicate_barcode` remains the only check the server refuses to let anyone ignore.

---
## 🎥 IT Tools → Screen Recorder (2026-09-04)

Jordan: *"I just start the recording and its stored in the hub"* — for recording Auto Clerk tests,
the website, a fault, anything on the screen. Recording ONLY; a private livestream was offered and
not pursued (no TURN server, and the socket layer has no login check — see the memory record).

`app/(app)/tools/it-tools/recorder-tab.tsx` + `app/api/it-tools/recordings/*` + `ScreenRecording`
(**NEEDS Run Migrations**). Browser `getDisplayMedia` + `MediaRecorder`; on Stop the browser PUTs the
file **straight to R2 on a presigned URL** (a recording is hundreds of MB; the server body limit is
20 MB and the proxy silently truncates past it), then registers the row.

- **Desktop Chrome/Edge only.** iOS has no `getDisplayMedia`, so the iPads can't record; the tab
  says so and still lets them play recordings. Everyone signed in can see every recording, the same
  as the rest of IT Tools (`allUsers`).
- ⚠⚠ **The recording lives in the tab's memory until it is saved.** Three guards, keep all three:
  the IT Tools page keeps the recorder **mounted** (`hidden`, not unmounted) once opened, so
  switching tabs doesn't kill it; `beforeunload` fires while anything is unsaved — recording,
  uploading, **or a failed save still held in memory**; and unmounting mid-recording (a link
  elsewhere in the Hub) **stops and saves what was captured** rather than dropping it. The
  **Pop out** window hides this page's chrome AND the Hub top bar (a `<style>` from the page — the
  shell layout can't read the query) so there is nothing to click away to. A second Pop out click
  must **focus** the existing window: it probes with `window.open("", name)`, which returns an
  existing window *without* navigating it — navigating would reload one that is recording.
- ⚠ **Nothing unsaved is discarded until a NEW capture has begun.** Pressing Record with a failed
  save in memory asks first — **inline, never `confirm()`**: a modal can outlive the click's transient
  activation (~5 s in Chromium) and `getDisplayMedia` then refuses to open. Even after "yes" the old
  recording and its retry / save-locally buttons stay until the picker has actually produced a
  stream — and if the old file had already reached storage, it is **registered first** (idempotent
  POST) so it lands in the list where it can be deleted, never left as an object nothing points at.
  A closed picker, or screen capture blocked by the OS, gets an amber notice — a Record button that
  silently does nothing reads as broken.
- ⚠ **Record is guarded while the picker or mic prompt is up** (`startingRef` + `starting`). Without
  it a double-click, or a click during Chrome's non-modal mic bubble, started a SECOND recorder into
  the same chunk array — an unplayable interleaved file, and the first recorder and its stream leaked.
- ⚠ **An in-flight save is guarded at MODULE scope, not in state.** The unmount path starts a save
  with no component behind it; a state-held `beforeunload` is torn down with the instance, leaving a
  minutes-long PUT unguarded. `pendingSaves` + one module-level listener cover it, and a save that
  fails after its component has gone is stashed (`stranded`) and handed to the next mount so retry and
  save-locally are still there.
- **A stalled upload can be cancelled** (the XHR is kept and aborted) and the recording stays in
  memory with both retry and save-locally on offer. A recorder error mid-recording is a **notice**,
  not the error box — `upload()` clears the error box on its way in, which would have announced a
  truncated file as "✓ Saved".
- **Play URLs are signed for 8 hours**, not the Documents route's one: a `<video>` fetches lazily in
  Range requests, each checked against the expiry, so an hour meant seeking or resuming an hour
  after pressing Play died with a 403. A failed Play/Delete on one row shows above the table
  (`actionError`); only a failed *load* replaces it (`listError`). **⬇ Download** signs the same
  object with `ResponseContentDisposition: attachment` and the title as filename — `<a download>`
  is ignored cross-origin, and R2 is a different origin, so the header is the only way that works.
- ⚠⚠ **Fail at the free step, never after the upload.** `upload-url` touches the table
  (`findFirst`) *before* signing, so a missing migration or a down database fails before the
  browser spends minutes pushing a file the save could never register.
- ⚠⚠ **A retry never re-uploads.** The client keeps the key once the PUT succeeds and a retry only
  re-registers it; the save `POST` is **idempotent on key** (returns the existing row). Without
  both, every retry left another unlisted, undeletable object in the bucket.
- ⚠ **Only a definite 404 means "nothing was saved".** The save route HEADs the object itself and
  turns any other failure into a 503 that says the file *may well be there* — `objectExistsInR2`
  returns false on *every* error, which would have told people their upload was lost when it wasn't.
  R2 is strongly consistent, so there is no eventual-consistency wait after a 200 PUT.
- ⚠ **Size cap is 2,000,000,000 bytes, not 2 GiB** — `sizeBytes` is a Postgres INTEGER (max
  2,147,483,647) and 2 GiB is one byte over. The cap is checked against the client-declared size
  and is **not bound into the signature** (same as the Documents route); the route is
  session-gated, so that is accepted rather than fixed. Bitrate is 2.5 Mbit/s (~1.1 GB/hour).
- `MediaRecorder` records only the **first** audio track, so system audio and the microphone are
  **mixed with an AudioContext**. MP4 is preferred where the browser can produce it; Chrome's WebM
  carries no duration (seek bar broken), so WebM playback uses the seek-to-end trick.
- The save route validates the key against the **exact shape** `upload-url` mints, never a prefix.
- Registered in `lib/help-map.ts` ("How do I record my screen?").

---
## 📸 IT Tools → Screenshots (2026-09-07)

Jordan: *"a snipping tool alternative as well that saves screenshots into the hub and lets me
annotate and draw symbols on etc"*. Fifth IT Tools tab, beside the recorder.

`app/(app)/tools/it-tools/screenshot-tab.tsx` + `app/api/it-tools/screenshots/*` + `ScreenCapture`
(**NEEDS Run Migrations**). Three ways in — 📸 Capture (the recorder's picker; ONE frame is grabbed
and the share stopped at once), **Ctrl+V** a screenshot, or upload a file — then ✂ crop and mark up
with pen, highlighter, box, circle, arrow, text, numbered markers and ✓ ✗ ⚠ stamps; then 💾 Save,
📋 Copy image (for pasting into an email) or ⬇ Download. Saved ones show as thumbnails with a viewer.

- **ONE canvas, drawn from an immutable list of shapes over the base image.** Undo is "drop the last
  shape", and ✂ Crop only has to translate the shapes it keeps (`shiftShape`) — mark-up moves with
  the picture rather than being thrown away. Don't move to a stateful drawing surface.
- **Crop applies the moment you let go** (snipping-tool feel; a tap under 10×10 is ignored) and a new
  picture opens in crop mode. **One undo history covers drawings AND crops** in the order they
  happened — a crop entry keeps the picture it replaced (Jordan: *"undo doesnt work for cropping"*).
- ⚠ **The canvas is sized inside `redraw()`, not where the picture loads.** It isn't mounted until
  `hasImage` is true, so sizing it at load time did nothing and it stayed at the browser default of
  300×150 — a full-screen capture showed as a tiny top-left corner.
- **Pointer events + `touch-action: none` on the canvas** (design rule 5). The iPads can't capture a
  screen, but they can paste, upload and draw with a finger or pencil, and the tab says so.
- ⚠ **Saved files are read back THROUGH the Hub** (`GET /api/it-tools/screenshots/[id]` streams the
  PNG, `?download=1` for an attachment). Same origin on purpose: thumbnails, the viewer, Copy image
  (which must `fetch()` the bytes) and Download all work with **no CORS rule on the bucket**. A
  screenshot is a few MB at most, so streaming it is fine; recordings are hundreds of MB and use
  signed URLs instead. Uploads still go straight to R2 on a presigned PUT, then register after a
  HEAD check, idempotent on key, exactly like the recorder.
- **Copy uses `ClipboardItem` with a `Promise<Blob>`** so the write stays inside the click's
  user-gesture window while the PNG is still being encoded. Where the browser has no
  `ClipboardItem` the error says so.
- Capture has the recorder's **in-flight guard**; the paste listener is attached **only while the
  tab is the one showing** (`active`); the tab is kept **mounted once opened** so an unsaved marked-up
  image survives a tab switch; `beforeunload` guards it.
- Every tool button carries a text label (design rule 3), so the symbols need no separate key.
- Cap 25 MB. Registered in `lib/help-map.ts` ("How do I take a screenshot?").

---
## ⚠⚠ The edit lock is the CATALOGUED tick, not "Added to BC" (2026-09-02)

`requireNotBCLocked` — the one gate, 28 call sites — reads **`CatalogueAuction.catalogued`**.
Ticking Catalogued makes the whole sale read-only for everyone except admins (wizard, Manage Lots,
deletes, bulk actions, transfers). **Do not re-point it at `addedToBC`.**

Why it moved: `addedToBC` had to stay a manual tick purely to drive the lock, and that tick was the
thing Jordan wanted replaced by a real check. Measured before the change — **all 39 sales had the
two ticks set identically**, so nothing locked or unlocked on the day it shipped.

- `addedToBC` still exists and is still tickable, but it is now **a note only**. Nothing reads it
  for access, and the Auction Manager's column ignores it.
- Auction Settings labels the Catalogued tick **"Catalogued 🔒"** with a line underneath saying what
  it does — a lock disguised as a progress marker is how someone freezes a live sale by accident.
- The Review tab still bypasses the lock (see above), unchanged.

### The Auction Manager's "In BC" column is MEASURED

It shows **`594/616`** — lots whose **barcode** was found in the synced BC data (`WarehouseItem`) —
computed in one grouped raw query in `app/(app)/tools/cataloguing/auctions/page.tsx`, the same way
the Admin Centre and End of Day → BC already answer this question.

- ⚠ **BARCODE ONLY**, never `receiptUniqueId` — the standing rule above.
- ⚠ It reflects the **last Data Sync**, not BC live. The tooltip says so; don't make the page call BC.
- The status filter is **"All lots in BC" / "Not all lots in BC"** — a count, not a flag, and a sale
  with no lots is never "all in BC".
- The **auctions overview PDF** prints the same measurement: `BC` when every lot is found,
  `BC 84/102` when only some are, from the same barcode query, with a footer note that it is as at
  the last Data Sync. ⚠ Only the COMPLETED table carries status flags; the active one has none.



---

## ⚠⚠ The Help box filters the CONTEXT, never the prompt (2026-09-02)

The 💬 Help box in the top bar answers "where do I go to do an overnight run?" and must only ever
talk about tools the person asking can open.

**That is enforced by what goes IN, not by what the model is told.**
`allowedHelpContext(role, allowedApps, appPermissions)` in `lib/help-map.ts` drops every
destination the person cannot reach before the question is sent, so someone without Accounts is
never sent a word about Accounts. **Never relax this into "the system prompt says not to mention
it"** — a prompt is a request, a filter is a guarantee.

Three guards on the same principle, keep all of them:
- ⚠⚠ **`getEffectiveSession()`, never `auth()`**, decides who is asking. Every page and layout in
  the Hub resolves the person that way because an admin can be **viewing as** someone else. The
  first version called `auth()` and judged the real admin: Jordan, viewing as a cataloguer with
  only CATALOGUING, was told about Auction AI. The filtering was right — it was filtering for the
  wrong person. Any new route that discloses what someone may see has the same trap.
- `/api/help/ask` reads permissions **fresh from the database**, not from the session JWT. A token
  can be hours old, and access that has been removed must not still open the door.
- The links it returns are **checked back against the allowed set**, so a hallucinated path can
  never become a clickable link to somewhere they cannot go.

- **The suggested questions are FETCHED, never hardcoded.** A fixed list in the component offered
  a cataloguer with only CATALOGUING "Where do I go to do an overnight run?" — same filter as the
  answers, or it is the same bug in a different place. ⚠⚠ And they come only from destinations
  gated by an app the person was **granted**: three tools are open to everyone (`allUsers` cards),
  so taking the first three allowed offered a cataloguer "How do I post a parcel?". It shows
  **fewer** rather than padding with a universal one.
- **A question about a tool they cannot open is BLOCKED before the AI**, by
  `blockedDestination()`, which returns a fixed refusal naming the tool. Naming it back is not a
  leak — they typed it. It is conservative on purpose: anything that fits both ways is answered
  from what they have, because wrongly saying "you don't have access" is worse than a vague answer.
  ⚠ In `matchScore` the `also` keywords carry the weight and the name is only a weak tie-break —
  scoring name fragments like "a sale" made "add photos to a sale" match Manage Lots instead of
  Photography, so the refusal named the wrong tool.

Knowledge comes from the app's own structure — `APP_CARD_DEFS`, `APP_SECTIONS`, and the
hand-written `DESTINATIONS` list for the tabs that appear in neither.

- **Add a `DESTINATIONS` entry when you build a screen worth finding.** It is the only part that
  goes stale. `assertHelpMap()` catches a typo'd app key; nothing can check a route still exists.
- ⚠ **A destination's gate must match its Hub card.** Gating one whose card is `allUsers: true`
  hides it from people who can plainly see it on their home page — that was the bug the
  before-shipping run over every real user caught (Packing, Auction Monitor, IT Help).
- Model slot: `help_assistant` in `AI_TOOLS`. Distinct from **IT Help** (`/tools/it-help`), which
  answers computer problems from knowledge articles and tickets.

## 🚦 Status Centre + the admin bell (2026-09-10)

`/admin/status` — the **Status** section, first on the Admin page. Its one job (Jordan): **"staff say
something's broken — is it us or a supplier?"** The banner at the top answers exactly that: services
in the `hub` group are "inside the Hub", everything else is a supplier.

- **One file per service** in `lib/status/checks/`, each default-exporting a `StatusCheckDef`
  (`lib/status/types.ts`), listed in `lib/status/registry.ts`. `lib/status/engine.ts` runs them and
  keeps the current state (`StatusService`) and the history (`StatusCheck`, pruned after 30 days).
- ⚠⚠ **Every check is READ-ONLY and FREE.** Never send an email, publish a notification, create an
  order or a row, spend AI generation quota (the whole Google project gets 4 generate requests a
  minute) or credits, or download a big file. Anything that can only be proven by a side effect is
  shown passively ("last email arrived …") or as grey.
- ⚠⚠ **Green must mean the Hub can do its job with it, not that a host answered.** The database
  check samples many connections and goes red on even one that refuses saves — one `SELECT` would
  have been green all through the 2026-09-09 read-only day. A check that couldn't run is grey
  ("Couldn't tell"), never green and never red.
- ⚠ **"Us or a supplier" follows the FIX, not the logo.** A supplier's check returns `cause: "hub"` when
  the fix is in the Hub's own hands — a setting (Admin → AI Models), a key or variable missing or
  refused, a sign-in that needs redoing, the Hub's own job or copy gone stale, an office task not done.
  The banner then says "Problem inside the Hub" and the bell adds "the fix is on the Hub's side". Found
  on the first run: tools set to a model Google had retired were blamed on "a supplier".
- ⚠ **Environment first.** Anything that depends on background jobs or production-only data returns
  `off` ("Not used here") unless `ctx.backgroundJobsExpected` / `ctx.isProduction` — the staging and
  sandbox databases are branches of production holding timestamps that stopped the day they were made.
- ⚠ **The website's 202-with-nothing to Railway is expected** and never red; that light is about how
  fresh the office collection is.
- **Its loop in `server.js` runs on PRODUCTION ONLY, every 5 min** (each check also has its own
  minimum interval). On staging/sandbox it would wake their Neon branches every tick and ring bells
  about test copies of production's data — there, "Check now" on the page runs the checks on demand.
  It isn't gated on `CRON_SECRET`: it proves itself to `/api/status/run` with a token made at boot and
  held in memory (`globalThis._statusToken`).
- **The bell** (`components/notification-bell.tsx`, admins only, just before the settings cog) — Jordan
  chose it over email alerts; the Hub sends no email. It rings after **2 bad checks in a row** (one blip
  is not an outage) and again on recovery; grey never rings it. `Notification` + `NotificationSeen`
  (unread = newer than when you last opened the bell). `createNotification()` in `lib/notifications.ts`
  is general-purpose, but the Status Centre is its only writer today.
- While the database is refusing saves the engine keeps results in memory, so the page still tells the
  truth, and files the bad spell as an alert as soon as the database can record it.
- **Adding a service:** a new file in `lib/status/checks/` plus one line in the registry. **Never rename
  an existing `key`** — it keys the history and every alert's link.
- ⚠ **The `MIGRATIONS` array now lives in `lib/migrations.ts`** (moved the same day, so the Hub light
  can compare `MIGRATIONS_HASH` — a Next route file may only export its handlers). New SQL goes there.

## 📝 Hub Feedback — surveys for the cataloguers (2026-09-10)

`/admin/feedback` — the **Feedback** section on the Admin page. Jordan writes (or has the AI draft)
questions about the Hub, including what features people want, and sends them as a popup.

- **Jordan's decisions:** written answers only · **named**, not anonymous (the popup says so) · the
  audience is chosen **per survey** — roles and/or named people · **"Fill it out later" never pops up
  again**: it keeps what they typed and shows a temporary 📝 button in THEIR top bar until they submit
  or the survey closes.
- Tables `FeedbackSurvey` (questions as JSON `[{id,text}]`, status DRAFT/OPEN/CLOSED, audience) and
  `FeedbackResponse` (one row per person per survey, LATER or SUBMITTED). ⚠ Answers are stored WITH
  the wording of the question they answered (`AnswerSnapshot`), so editing a question after sending
  never changes what someone was asked. ⚠ A SUBMITTED response never goes back to LATER.
- The popup answers as the **REAL** signed-in user, never the impersonated one, and reads their role
  fresh from the database — nobody may answer on someone else's behalf.
- ⚠ It waits while any other `[data-hub-popup]` is on screen (the patch-notes popup carries it) — two
  stacked modals on an iPad is a mess. Any new app-wide popup should carry the attribute too.
- AI questions: slot `feedback_questions` (Admin → AI Models), context built from the Hub's own
  `APP_CARD_DEFS` and help-map `DESTINATIONS`. Open-ended only — never yes/no or rate-1-to-5.
- Shapes in `lib/feedback-types.ts` (client-safe), rules in `lib/feedback.ts` (server).

## 🔎 Website Search — tablet cataloguing (2026-09-10)

The **🔎 Website Search** button in the tablet cataloguing screen's header, just left of Lens
(Jordan: *"the ultimate search bar to help them research. Our own website's search bar is rubbish"*).
It **replaced Description Finder**, which is gone — page, route, home card and app key
(`DESCRIPTION_FINDER`). Don't bring it back as a separate tool.
**Also its own home card since 2026-09-11** — Cataloguing & AI → `/tools/website-search` (Jordan,
reversing his own "one button only": *"can we have website search as its own home page tab as well
under cataloguing"*). It is the SAME component in `standalone` mode (no Close, no second theme switch —
the Hub top bar is there), gated on Cataloguing like the route, a refusal logged to the Access Log.

- ONE search over three sources, sorted as one list (`/api/website-search`):
  **ABC** (`ArchiveLot`, 1999–2023) · **BC** (`WarehouseItem` ⟕ `BcLotWeb` — lots through a past sale,
  the same rule as Databases → BC Database) · **Hub** (`CatalogueLot` NOT yet through a BC sale — once
  sold they'd only be doubles of their BC row).
- ⚠ It searches OUR copies — vectis.co.uk refuses the Hub's server — so it's as fresh as the last office
  collection ("Update the BC lots").
- Every word must appear in the **description**; ID fields only when the search looks like an ID (one
  word with a digit). ⚠ Gluing description + IDs + sale name per row took ~6 s; description-only is
  ~2.4 s (measured on production). Counts come from window totals in the SAME query — ⚠ per-source
  `FILTER`, not `PARTITION BY`, or a source with no row on the page loses its count.
- A search needs a word, a sale or a category. Hammer/sold filters leave out Hub lots; a category
  leaves out ABC lots (they have none) — the response says so in `notes`.
- Each query runs with `SET LOCAL statement_timeout` inside a transaction (the pooler's unit).
- **Forgiving matching** (Jordan: *"if I add a , anywhere it doesnt find that one lot"*) lives in
  `lib/search-words.ts`: punctuation stripped and little words (&, and, the) dropped; plurals count;
  accents don't matter either way — the typed word is searched as typed AND folded (Kämmer → kammer),
  and the spelling list supplies the accented spellings our descriptions use (marklin → märklin); a
  misspelt word also searches its nearest real spellings.
- **Whole numbers** (Jordan, 2026-09-11 — *"Class 37"* was bringing up every Class 373): a word that
  starts or ends with a digit may not have more digits glued on at that end — "37" finds Class 37,
  37/5 and No.37, never 373, 3714 or 37417; letters may touch, so "3514" still finds R3514. A tick in
  the filters — **"Exact numbers"**, with an ⓘ beside it and beside "Exact phrase" explaining each
  (tapped, not hovered — iPads) — **on by default** (his choice: a toggle rather than typing quotes), and the page says so
  under the results. The ILIKE stays as the cheap first pass and a `~*` pattern confirms the edges —
  measured no slower (class 37: 2.4 s, 13,414 lots → 3,406). ID fields stay a plain "contains".
- **Exact words** (same day) — **off by default**: a word may not sit inside a longer word, though
  its own plural still counts ("bus" finds buses, never business or omnibus). Off, "loco" finding
  "locomotive" is usually wanted. One `edgePattern()` in the route: Exact words governs LETTER edges,
  Exact numbers DIGIT edges. Three ticks, each with an ⓘ: Exact phrase · Exact words · Exact numbers.
- ⚠⚠ **Never fold or rewrite the DESCRIPTIONS at search time.** Measured on production 2026-09-10:
  `translate()` over ArchiveLot took **36 s** for "halo" against **3.3 s** for a plain ILIKE, and every
  search timed out on staging. Matching stays a plain ILIKE on the stored text; anything cleverer is an
  extra spelling of the TYPED word, or goes into the spelling list.
- **The spelling list** is `SearchWord` (+ `SearchWordState`, `SearchWordBuild`) — every word in our
  descriptions seen twice or more, its accented spellings, and a pg_trgm index. Built in the background
  in 5,000-row batches (~2–3 minutes; never one long query) the first time it's needed, whenever
  `BUILD_VERSION` changes, and weekly in London evenings; a search never waits for it. Only unknown or
  rare words are corrected, and the panel says what it also searched for — a lot found by a guessed
  spelling must never be a mystery.
- ⚠ **No HTML in stored descriptions.** The website hands BC lots over as HTML (`<p>`, `&nbsp;`,
  `&auml;`). `htmlToText()` in `lib/html-text.ts` is the one cleaner: `writeBcSale` stores new lots
  clean, the spelling-list build cleans old rows first, and every screen/export that shows them cleans
  on the way out too.
- If it ever feels slow: a pg_trgm index on `ArchiveLot.description` (~500 MB) is the next step — ask first.
- **Lens checks the same data** (2026-09-10): `findComparables(id, { everywhere: true })` in
  `lib/comparables.ts` — ABC + BC full descriptions, the same spellings, and ONE `rank()` shared with
  Valuations. ⚠ Valuations and Lotting Up stay on the quick BC-only default: they run it once per item
  in a list, and the wide search is two scans of a million rows. Lens's "See every match" opens this
  panel through a `hub:website-search` window event.
- Gate: the Cataloguing app, read fresh from the database.

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
| `copier_preload` | `Array<{ Folder, "Receipt Unique ID", Barcode, Description, Estimate, ImageUrls }>` | Cataloguing page → Description Copier |
| `batch_preload` | `{ auctionCode: string }` | Cataloguing page → Batch Run pre-fill |

---

## Model Tester

Run sequentially with a **1-second gap** between models — never `Promise.all`.
Firing all models concurrently burns quota and causes the 429s that show up in the test results.

---

## AI Model Selection — central config (Admin → AI Models)

The model each AI feature uses is configured in **Admin → AI Models** (`/admin/ai-models`), backed by the `ToolModel` table. **Never hardcode a Gemini model default in a route.** Instead:

- `lib/ai-models.ts` holds the `AI_TOOLS` registry (one `slot` per AI feature, with a built-in `default`) and `getToolModel(slot, clientModel?)`. **Always resolve the model with `await getToolModel("slot", clientModel)`** — do NOT write `clientModel || (await getToolModel("slot"))`. `getToolModel` honours a valid client-posted model but **ignores a blank OR retired model** (see `RETIRED_MODELS`) and falls back to the configured default. This is because a **stale client** (an old cached app bundle on a shared iPad, or an old model saved in localStorage) can still POST a dead model name, which hard-404s — it broke Review-tab auto-fix for cataloguers on 2026-07-01 while it worked for the admin (fresh bundle). **When Google retires a model, add its name to `RETIRED_MODELS`.**
- **When adding a new AI feature, add a slot to `AI_TOOLS`** and use `getToolModel` — don't invent a new hardcoded default.
- The dropdowns reuse the enabled-models list from `/api/auction-ai/models` (which already respects the `DisabledModel` enable/disable toggles in Auction AI → Models). The two are complementary: Models tab = which models are *available*; AI Models = which model each *tool* defaults to.
- ⚠ Google **retires** models (e.g. `gemini-2.0-flash` 404'd 2026-06-29 and broke auto-fix + 3 other routes that hardcoded it). With this config, a retirement is a one-click admin fix, not a code change. The current safe default is `gemini-3-flash-preview`.

### The fallback model (2026-09-03)

There is **one** fallback model for the whole app — the second model tried when the main one is
rate limited, refuses a lot, or returns nothing. It is set on the same Admin → AI Models page and
read with **`getFallbackModel()`** from `lib/ai-models.ts`.

- It is stored in the **`ToolModel` table under the reserved key `_fallback`** (`FALLBACK_SLOT`).
  Deliberate: it is a setting keyed by the thing configured, exactly like the per-tool rows, so it
  needs **no schema change and no Run Migrations**. No row = no fallback. The reserved key never
  leaves the server — the page posts a plain `fallback` field on `POST /api/admin/ai-models`.
- ⚠⚠ **It is a DEFAULT, not an override.** It decides what a fallback picker OPENS ON. What a
  queued overnight sale actually runs with is the value on **that sale's own row**
  (`PipelineQueueItem.fallbackModel`), and the runner must never substitute for it — a sale
  silently running on settings from a screen somewhere else is the exact bug the overnight queue
  form was built to end. Changing it does not touch anything already queued.
- Screens seed from it via **`GET /api/ai-tool-model?slot=<slot>`**, which returns
  `{ model, fallback }`. The overnight queue form seeds both; the Auction AI sidebar seeds the
  fallback only when the person has **never** chosen one (a missing localStorage key, not a blank
  one — an explicit "— none —" is a decision). Neither writes the seeded value back, so the box
  keeps following the admin setting until someone picks for themselves.
- ⚠ The admin dropdown **never offers a Claude id**. One model is shared by every feature and most
  of them send images or use Google Search, where `usable()` silently drops a Claude id — the same
  reason "Apply to all" excludes them. A retired name is dropped by `getFallbackModel()` too, so a
  picker seeded from it can never open on a dead model.
- ⚠ **With no fallback set, "trying the other model" is a lie** — the retries all land on the same
  model. The overnight runner's log says *"trying again — no fallback model set"* instead
  (`hasFallback` on `withRetry`). Keep any new retry message honest the same way.

## Databases → Lot Archive (pre-BC lots, LotIDs + photos from the website)

- `/databases/archive`: every lot sold before Business Central — tables `ArchiveLot` (unique on
  `lotId` — the old system's key; sale + lot number REPEATS in multi-day sales, so it is only an index),
  `ArchiveImport`, `ArchiveSale`, `ArchiveJob`. Admin panels on top. NEEDS Run Migrations.
- ⚠ The Crystal report is the trusted source, NOT "lot export.xlsx": measured 2026-09-07 the xlsx's 1,496,760 rows
  are 946k real + 548,254 DUPLICATES + 1,637 hammerless 2008 rows. The report's 956,832 rows include 7,477 blank
  placeholder lots and 849 unlotted entries the importer rejects as unreadable — expected, not a fault. AuctionID is
  not printed by the report; the Hub-ready "Lot Export (Claude version).csv" was stamped from the xlsx by date/lot.
- ⚠⚠ **The spreadsheet is STREAMED, never read whole.** The old system's export is 136 MB; SheetJS
  reading it into memory killed the request ("Couldn't read the spreadsheet"). `readArchiveStream`
  (lib/archive-import.ts: exceljs WorkbookReader for .xlsx, our own reader for .csv) feeds a
  server-side loop the page polls — resumable from `offset`, `createMany skipDuplicates` is the dedupe.
  .xls cannot be streamed: the error says save as .xlsx.
- **Website pull (lib/archive-site.ts, job "site").** Walks vectis.co.uk's own sale ids; a sale's URL is
  `/bidding/{AuctionID}-{slug}-{siteSaleId}` — the FIRST number is the sheet's AuctionID. Lots come from
  the site's JSON feed (`task=commission.getLots`, auction_id = site id, per_page 500). The feed's
  `unique_id` IS the old system's LotID and photos are filed under it
  (`lot_images/large/{LotID}/{LotID}.webp`); the number at the end of a lot URL is the site's own row id
  (`siteLotId`) — never confuse the two. Only FINISHED sales are written; matched rows get
  lotId/siteLotId/sitePhoto/siteHammerPrice (the sheet's figures are KEPT, only blanks filled, one raw
  `UPDATE … FROM unnest` per sale, matched on lotId, and `siteLink` = the site's exact lot address for the
  "vectis.co.uk ↗" link). ⚠⚠ ANNOTATE ONLY — nothing is created or overwritten from the site (Jordan: "the
  website has errors"); lots only on the site are just counted.
- **Photo copy (job "photos")** copies each main photo (~23 KB) into R2 `archive-photos/{lotId}.webp`;
  a 404 nulls `sitePhoto`. The page shows our copy (signed) first, else the site's medium image.
- Jobs survive the tab closing but NOT a redeploy — the button resumes from the cursor. 250 ms between
  requests, honest User-Agent, 40 empty ids in a row = done. "Check for new sales" restarts from the
  first unfinished sale.
- **Export & handover:** admin `⬇ Export data (CSV)` = `GET /api/databases/archive/export`, streamed 5,000 rows a
  batch with every column (LotID, PhotoFile, PhotoFullSizeFile, SiteLink). The page's "Export & handover" panel
  documents the R2 naming and the bucket-to-bucket rclone handover for a future website. Zips-of-everything were
  deliberately NOT built — an object store keyed on LotID + a CSV is the handover format.
- Where the site's hammer differs from the sheet's, the page shows "site £N" in amber under the hammer;
  the sheet's value stays. Oldest sale on the site is Feb 2006 — earlier rows stay text-only.

## Databases → BC Database (Business Central lots, built like the ABC database)

- `/databases/bc`: every BC lot that has been through a sale, same layout as the ABC database (tiles, search,
  thumbnails, "vectis.co.uk ↗", amber "site £N", Export & handover, `GET /api/databases/bc/export`).
- **Two sources, one raw LEFT JOIN:** `WarehouseItem` (BC sync: sale, lot, short description, estimates, hammer —
  lot = `COALESCE(NULLIF(currentLotNo,'0'), lotNo)`, hammer 0 = unsold) ⟕ `BcLotWeb` on `upper(uniqueId)` (the
  website's FULL description, siteLotId, siteLink, sitePhoto, photoKey `bc-photos/{UniqueID}.webp`, photoXlKey).
- ⚠⚠ **BC's API has NO long description** (probed 2026-09-07: only `EVA_ShortDescription`, 250 chars) — the site's
  lot feed is the only source; its `unique_id` "r008728-194" = WarehouseItem "R008728-194"; BC sale URLs start
  with the sale CODE (`/bidding/D062-…`). `writeBcSale` in lib/archive-site.ts CREATES/updates BcLotWeb rows (one
  INSERT … ON CONFLICT per finished sale) — allowed here because BcLotWeb is purely the site's view and never
  touches WarehouseItem. The photos job does ABC lots first, then BC (`copyOne`, prefix `bc-photos`).

**⚠⚠ THE WEBSITE WILL NOT ANSWER THE HUB'S SERVER (2026-09-09).** Measured twice: from Railway every sale id comes back **202 with an empty body**; the identical request from an office machine returns the lots. Browser headers, Referer/Origin/X-Requested-With — no difference. So the "Pull from the website" button can never work from Railway, and the Hub's own walk reads nothing. There is no fix on our side and no Evo-soft development time, so **the lot feed is collected on an office machine and the files are loaded on the page**. `writeBcSale` is the ONE write path — the live walk and the upload both go through it, so they cannot drift.

**How the collecting works.** `scripts/collect-bc-lots.mjs` (Node, on an office machine) and `lib/bc-web-collector.ts` (the same logic as a browser-console script the page hands out) → JSON files → `POST /api/databases/bc/collect` (admin only, one file at a time, 12 MB each, under Railway's 20 MB body limit). Measured facts, all from a full run on 2026-09-09 that collected **216,259 lots from 375 sales**: the site answers **500 for a sale number that does not exist** (not an error); sale numbers are **sparse** (1450 and 1500 missing while 1541 exists) so a run must cover its whole range rather than stop after N misses; **BC sales run from site number 1062 (B007) to 1558**, older ones below; a sale is all one era, so a **10-lot probe** decides whether to download it and is what stops a run pulling a thousand pre-BC sales in full.

⚠ **A sale the probe has proved holds BC lots must never come away empty in silence.** One 503 on the heavy per_page=500 request used to drop a whole sale — 600 descriptions that exist nowhere else — with no line printed, no counter moved and a closing summary that read exactly like a clean run. Both collectors now retry the sale three times and then name it, and list every unread sale at the end.

**Checking a run.** Business Central's own auction list (Auction List.xlsx: No. / Auction Name / Auction Date / Finished) is the answer key. The 2026-09-09 run matched it exactly — 375 sale codes for the 375 sales dated that day or earlier; the 8 not collected were all Cancelled / No Auction / Do not use / DUMMY / TESTING plus B023. Eight sales BC dates in the FUTURE were collected because the website already lists them as finished; their hammer prices arrive when the range is collected again.

**Doing it again.** `BcLotWeb.siteSaleId` (**NEEDS Run Migrations**; the write falls back cleanly without it) records which website sale number each lot came from, so the page reads back "collected up to sale N" and sets the next run to N+1. Re-collecting old sales is safe — every column is COALESCEd, so a second pass only fills blanks.

**⚠ The page's tools are CHIPS** (`bc-tools.tsx`): 🌐 Website jobs · 📥 Update the BC lots · ⬇ Export & handover. Nothing shows until one is pressed, one at a time, and **a running job opens its own panel and keeps a live dot on the chip** — hiding the tools must never hide a job that is going. Jordan, 2026-09-09: *"these should be really small options at the top that then show the square they need otherwise they should be hidden"* and *"the filtering options are still awful"* — hence sortable columns (date/sale/lot/estimate/hammer, both ways, with an arrow) and on-screen filters (search incl. unique ID, sale name or code, date range, hammer range, sold/unsold, has a photo, full vs short description), every one carried through paging AND sorting.
- WarehouseItem is a sync CACHE (`reconcile-deleted` may delete rows); BcLotWeb has no FK and survives.
