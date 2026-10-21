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
- ⚠ **Exception — the customer PHOTO REQUEST LINK `/submit/<code>` is public again (Jordan, 2026-09-14).**
  Staff send it to customers, and this gate had been asking them to sign in since 2026-07-09. It is
  matched by a regex in `auth.config.ts` that allows exactly ONE path segment after `/submit/`, so
  `/submit` itself (the customer site's web form) stays gated — and the valuation link `/value/<code>`
  stays behind the login **by his choice** (it shows the customer's name and photos). The page checks
  its code server-side (404 for a wrong one) and uploads through `/api/public`, which was already
  public. ⚠ Never widen it to a `startsWith("/submit")` prefix, and don't open `/value` without asking.
- ⚠ **Exception — the handheld scanner screen `/scan` and its worker `/scan/sw` (Jack, 2026-10-16).**
  Exact paths in `publicExact`, like `/first-aid`, so a warehouse worker can sign in by scanning a
  scanner sign-in card on a device with no keyboard. The page does its own sign-in check and shows
  nothing but "Scan your sign-in card" to nobody. See Goods In → handheld scanner → "Scanner sign-in
  cards" for the rules that keep it safe.

## Public First Aid page — a deliberate exception (2026-08-11)

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
- ⚠⚠ **Nothing in the shell may be wider than a phone** (2026-09-18 — Jordan: *"on mobile zooming
  in and out is really glitchy on the entire hub, you get this white space"*). The top bar was one
  row that couldn't wrap — 435px for staff, 644px for an admin, on a 375px screen — so the whole
  PAGE became wider than the phone: it zoomed out, slid sideways, and showed the canvas beside the
  app. And the canvas was PURE WHITE in dark mode, because an unlayered `body { background:
  var(--background) }` beats Tailwind v4's layered `bg-*` classes and `--background` had no dark
  value. Fixed four ways, keep all four:
  - The page canvas is set for pages inside the shell (`html:has(.hub-shell)` in globals.css). Keep
    `hub-shell` on the shell wrapper in `app/(app)/layout.tsx`.
  - The shell has **`overflow-x-clip`** as a backstop. ⚠ CLIP, never `overflow-x-hidden` — hidden
    makes a scroll container and breaks the h-full pages, sticky banners and dropdowns. Never put an
    overflow rule on html/body either (iOS ignores it when pinch-zooming).
  - Below `sm` the top bar drops only words that repeat an icon and **wraps** rather than
    overflows; every control stays. Its dropdowns hang from the BAR (wrapper `max-sm:static`, panel
    `max-sm:inset-x-2`), not a fixed `top-12`, because the bar can be two rows. Adding a button to
    it? Check it at 375px as an admin with the Dashboard switch.
  - iPhones zoom the page in when a field under 16px is tapped; a phone-only rule in globals.css
    sets text fields to 16px. ⚠ **Never** fix zoom with `maximum-scale` / `user-scalable=no` —
    stopping people zooming is an accessibility failure.
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

### 8. The Saleroom Trainer freeze — LIFTED 2026-09-29 (history kept below)
**Lifted by Jordan on 2026-09-29** ("why are we saying edits are frozen?" — asked, and he chose to
lift it): the trainer is now the Auto Clerk's Scenario 2 test bench, so trainer edits that serve
Auto Clerk testing are **allowed without asking each time**. Two things still hold: **the guided
training scenarios' behaviour is not changed in passing** — a change that touches how a scenario
plays out is said so plainly first — and the trainer stays skinned to match the real clerking
software (Jack's work), so no Auto Clerk-only clutter on the clerking screens themselves. The
reasons the rule existed, and the four exceptions granted under it, are kept below because they
explain why the trainer looks the way it does.

*The rule as it stood 2026-08-21 → 2026-09-29:* Jordan: *"we made some great changes for training
our staff and the design of the clerking screens so I want a rule made first you cannot change
anything in here while working on the autoclerk."* The trainer (`/tools/saleroom-trainer`) is a
finished staff-training tool with screens skinned to match the real clerking software; it was
**not** Auto Clerk scratch space.

**These were the files the rule covered:**
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

**Fourth sanctioned exception (Jordan, 2026-09-29, chosen over a trainer-free copy via the conflict
question):** a third source in the Saleroom Trainer's **Test Mode picker — "From a BC Lines export"**.
For an Auto Clerk Scenario 2 test the fake Saleroom must run THE SAME lots as the real Vectis
clerking screen — same lot numbers, same order — and the Hub's own lots can never give that
(`CatalogueLot` has no lot number and no sale order), while BC's Lines export has both. The picker
takes the .xlsx, posts it to **`/api/auto-clerk/lines-sheet`** (deliberately OUTSIDE the frozen
`app/api/trainer` tree; parser `lib/lines-sheet.ts`, proven against F118's real export) and runs the
lots with the lot NUMBER as the id, so the AHK clerk's lot watch reads the same token on both screens.
Unnumbered and withdrawn lines are left out and counted on screen. The Vectis Clerk Trainer's picker
was NOT changed. Nothing else in the trainer is covered.

**If the Auto Clerk needs a replica screen, COPY the trainer file into a new `public/auto-clerk-*.html`
and change the copy** — exactly how the Scenario 1 rig (`auto-clerk-fake-saleroom.html`) was made from
the Saleroom replica. A copy may drift from the trainer afterwards; that is accepted, and it is why the
rule exists. The trainer's room protocol (`trainer:*` socket events) is likewise read-only from the
Auto Clerk's side. A genuine trainer bug found during Auto Clerk work is reported to Jordan, not fixed
in passing.

## 💾 The database backup — every table, streamed, one file each (2026-09-22)

Jordan picked this from the review: *"Nightly backup covers 42 of 151 tables and the restore
screen can't restore the induction tables."* `lib/backup-engine.ts` is the whole of it; the
routes under `/api/admin/backup`, `/api/admin/restore` and `/api/cron/db-backup` are thin.

- **No list of tables anywhere.** The database describes itself (`information_schema`,
  `pg_class`): every base table in `public` except `_prisma_migrations` and UNLOGGED scratch
  (`SearchWordBuild`). A new table is in tonight's backup without anyone remembering it, and
  the restore can put it back the same way. **Never reintroduce a hand-kept table list** — the
  old one missed 109 of 151 tables and the restore's copy of it missed the induction tables.
- **Nothing is held whole.** Rows are read a page at a time (keyset on a single-column key, OFFSET
  on the six composite ones) and written straight to R2 through `lib/r2-multipart.ts` as
  `tables/<Name>.jsonl`. Node's largest string is ~0.5 GB, which is why ArchiveLot (~1 GB as
  JSON) could never join the old single file. Restore streams the file back line by line. Keep
  both sides that way.
- **Restore is generic and upsert-only.** `INSERT … ON CONFLICT (primary key) DO UPDATE`, every
  value cast to the column's real type from `information_schema` (jsonb, timestamp, enums,
  `text[]` via a JSON array, bytea via base64) — Prisma sends parameters untyped, so without the
  casts Postgres refuses. Parents before children (`tableOrder`, from the foreign keys), a
  failed batch retried row by row, the failed rows tried once more after their table. Columns
  the database no longer has are dropped and named; columns it has gained are left as they are.
  Nothing is ever deleted; rows made since the backup stay.
- **The manifest is the evidence.** `manifest.json` names every table copied, its rows and bytes,
  and every table that FAILED. The Status Centre's backup light reads it and goes amber on a
  failed table; the nightly run also rings the bell with the names. The old run saved a failed
  table as null and still said ok.
- **A manual run is started and polled** (`POST /api/admin/backup` → 202, then
  `/api/admin/backup/progress` once a second, `/stop` to stop): a full copy takes minutes and
  Railway's proxy would cut off a request that lasted the whole run. The nightly one is awaited
  by the cron route — localhost, no proxy. One job at a time, held on `globalThis`. Stop keeps
  the tables already copied, throws the half-copied one away, and the manifest says "stopped".
- **The old single-file copies (`backup-<ts>.json`) still list and still restore** — their
  camelCase-plural keys are mapped onto real table names by `legacyTableName()`. They fall out
  of the 30 in a month; the code that reads them can go then.
- ⚠ **R2 insists every multipart part but the last is the SAME size** (S3 only asks for ≥ 5 MB) —
  the writer cuts parts at exactly 8 MiB. Don't "simplify" that.
- ⚠⚠ **Cast pg_catalog's one-byte `"char"` columns to text** (`relpersistence`, `relkind`, `contype`…)
  when you SELECT them. The Prisma pg adapter can't read that type — `Failed to deserialize column of
  type 'char'` — and because `describeTables()` selected `relpersistence` bare, **every backup and every
  restore failed** from the rewrite on 22 Sept until 25 Sept. Filtering on them in a WHERE is fine.
- ⚠ Never "test" the backup by running it from a check or a script: it writes a real copy and
  can prune a real one out of the 30.

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
`ENTRIES` array, checks the viewer is an admin, and passes the entries to the client half
(`memory-client.tsx`). **Never add `"use client"` back to `page.tsx`** (or import `ENTRIES` into
`memory-client.tsx`) "to simplify it": that compiles every entry into the JS bundle, where anyone
can read them in view-source and the admin check proves nothing. The route must also stay dynamic
(`getEffectiveSession()` keeps it so). Verify a change here by rebuilding and grepping
`.next/static` for an entry's text: it must return **nothing**.

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
- A scheduled backup exists: `/api/cron/db-backup` (run by a `server.js` setInterval loop at midnight UTC, 24h cadence) copies **every table** to R2 (`CLOUDFLARE_R2_BACKUP_BUCKET`) as one file per table plus a manifest, keeping the last 30 per env, surfaced at `/admin/backup` — see "The database backup" below. A true `pg_dump` / point-in-time dump is still not configured — Neon branching remains the primary restore path.

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

## 🔍 Where each fact came from, and the look-again (2026-10-01)

A trio of Sindy dolls: the third holds a **microphone**; the AI wrote *"holding a silver baton with
a loose white feather (cap absent)"*. It had recognised the 1979 Majorette outfit from memory, and
memory supplied the baton and the missing cap. Jordan: *"we need to come up with like a way of
scoring the accuracy or having like a confidence rating"*. Two **advisory** checks exist for that —
**neither ever changes a description**, and a "confidence" is never a percentage the model awards itself:

- **ASSUMED line (Batch).** `ASSUMED_RULE` in `lib/batch-prompt.ts` makes the model end with
  `ASSUMED: a | b | c` — every statement that came from its own knowledge rather than the key points
  or something clearly visible. The batch route parses it (`parseAssumed`, `lib/lot-ai-check.ts`)
  and returns `assumed[]`. ⚠ Keep it a separate line, never tags inside the description text.
- **Look-again (Double Check).** The "NAMED OBJECTS" section of `lib/double-check-instruction.ts`
  makes it list every object the description names with `sure | unsure | no` and a note on what the
  photos show, and the "NOT MENTIONED" section lists what the photos show that the description
  leaves out (`unmentioned`, merged into `objects` with that verdict — the microphone was never
  named, so it was never looked at until this existed). Report only; the route returns `objects[]`.
  ⚠ The first run showed that making the model declare its knowledge made it DROP the knowledge
  ("Majorette" vanished with the baton) — the rule now says naming a recognised outfit is welcome,
  write it AND declare it; only naming an unseen accessory is not. `photoDetail: "ultra"` sets Gemini 3's
  `MEDIA_RESOLUTION_ULTRA_HIGH` **per photo part** (the only place Google accepts it; 2,240 tokens a
  photo). Instructions Testing runs Double Check at ultra by default; the real pipeline still runs at
  the default detail until the sandbox has proved ultra — flip it deliberately, not in passing.
- **Storage is its own table, `CatalogueLotAiCheck`** (one row per lot; written by the overnight
  runner and the Auto Pipeline tab via `recordLotAiCheck`, migration-safe, warns once). ⚠ Deliberately
  NOT columns on `CatalogueLot`: `prisma.update()` reads the whole row back, so a shipped-but-unmigrated
  column there breaks every lot save between the deploy and Run Migrations.
- **Review tab:** an amber **🔍 Look again** box per lot (assumed chips; objects not "sure" with ✗/?;
  confirmed ones in grey), **✓ I've checked these** (a new run clears the tick), the **🔍 Needs a look**
  filter and header count. Instructions Testing (preview only) shows both and writes nothing.
- A third option — two independent models disagreeing on an object — was offered and not built.

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
- `getBCTokenAny()` is the ONE background BC sign-in for system/cron use: the Hub user `BACKGROUND_BC_USERNAME` (Jordan's login) in `lib/bc.ts`, and **nobody else's** — Jordan's decision 2026-09-14, after the old "any stored token" pick (arbitrary, and it drifted) got a 403 on the change log on every run from 11 Sept while every other part of the copy worked. No fallback: if that sign-in lapses, the Status Centre's Business Central light goes red and names who must press the BC button. `getBCTokenForStatus()` must test the same person — keep the two in step.
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

- `addedToBC` still exists as a column, but **it is no longer tickable anywhere** (2026-09-15 —
  Jordan: *"we just need the catalogued tick and the complete tick if the rest are worked off
  counters anyway"*). The same day `photography` and `aiRan` lost their ticks too. All three columns
  stay in the database untouched — `updateAuction` deliberately does not write them, because a
  tick absent from the form would otherwise be saved as false and wipe every sale's old value —
  but nothing in the UI sets or shows them any more: the Auction Manager, the sale header, the
  Photography list, the Manager Portal and the overview PDF all read **measured counts** (barcodes
  in the BC sync, lots with a photo, lots with `aiUpgraded`). Export still writes the old columns.
  Never add a tick back "so it can be marked" — the count is the answer.
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
- **A check can be switched off from its details panel (2026-09-22)** — Jordan: *"I don't use the it
  emails thing anymore can I have options in the status centre to disable things"*.
  `StatusService.disabledAt` / `disabledBy` (**NEEDS Run Migrations**; NULL = on). Off = the engine never
  runs it (the loop AND Check now), the banner and Check everything leave it out, the bell never rings
  for it; the tile stays, greyed "Switched off", with who and when, and a Switch on button. Switching
  off also resets its bell bookkeeping, so it can't ring "working again" the day it comes back.
  ⚠ The columns are **nullable with NO default on purpose**: Prisma writes a literal default into every
  INSERT, so a `@default(true)` column would have failed every result write between the deploy and Run
  Migrations. For the same reason `record()` selects only the columns it needs and every read of the
  switch is tiered (with the columns, then without). `POST /api/status/switch`, admin-only.

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

## Databases → Sales — every sale with its cover picture (2026-09-22)

`/databases/sales` (Jordan: *"On our current website we have the hero (preview image for the entire
auction) is it possible to get them as well? … Why don't we make a new tab for them in databases?"*).
Every sale page on vectis.co.uk carries ONE cover picture at a fixed place on the site's S3 —
`auction_images/large/<sale guid>/<image guid>.webp`, ABC and BC sales alike (checked on sales
683 and 1566). Rows are `ArchiveSale` (+ `code`, `heroUrl`, `heroKey`, `heroAt` — **NEEDS Run
Migrations**; every write and read is tiered so the page lists sales without pictures until then).
- **Collected, not fetched.** The office collector (`scripts/collect-bc-lots.mjs` and the browser
  copy in `lib/bc-web-collector.ts` — change one, change the other) now reads each sale's own page
  (`/bidding/0-x-<id>`) for title, date and picture, for EVERY sale that exists — old system
  included, their lots still skipped — and the BC Database page's upload writes them through
  `upsertSaleMeta()` (never blanks a value already held; a new picture clears our old copy). Files
  from before this carry only lots and still load. A run over 1–1061 is how the ABC sales get theirs.
- **Copied by the Hub.** The `heroes` job (`startHeroCopy`, same plumbing as the photo copy)
  fetches each picture from S3 — which the server CAN reach, unlike the lot feed — into
  `sale-photos/<siteId>.webp`. The page shows our copy first, else the website's original.
- **A picture-only collector** — `scripts/collect-sale-pictures.mjs` and its browser copy
  `lib/sale-pictures-collector.ts`, handed out on the Sales tab's "📥 Get the pictures" panel with
  the upload box (the BC Database page's route reads its file too). One page per sale number,
  never the lot feed: ten minutes for the whole site. Same page-reading as the lot collectors —
  change one, change all three.
- One export, `GET /api/databases/sales/export`, one row per sale, for the same handover as the
  other two pages.

---
## 🎨 IT Tools → Craft Apps (2026-10-13)

Jordan: *"I don't want it fetching from the github in case it gets taken down"* — the Craft App Suite
(storytold's open-source, clean-room stand-ins for Photoshop, Illustrator, Premiere, Lightroom,
Acrobat, After Effects, InDesign, Figma, Word, PowerPoint, Excel, AutoCAD and Pro Tools), the
ArtCraft Launcher, and the Vectis build of ArtCraft (sign-in screen removed) must stay installable
whatever happens to the projects online. So the Hub holds the installers itself and never links to
GitHub for them.

`app/(app)/tools/it-tools/craft-apps-tab.tsx` + `app/api/it-tools/craft-apps/{route,download/route}.ts`
+ `scripts/upload-craft-apps.mjs`. No table: the list is **`craft-apps/manifest.json` in R2**, written
by the upload script, and the files are `craft-apps/<app>/<version>/<file>` beside it.

- **Where the installers come from.** The source of every app is cloned and built on Jordan's office
  PC in `C:\Dev apps\artcraft-suite` (the launcher's `cargo xtask local sync --every-commit` builds the
  12 launcher-managed apps as `x.y.z-dev.<commit time>`, one patch above the official release). The
  upload script reads the offline kit's `mirror` folder there, plus FigCraft, the launcher and
  ArtCraft, hashes everything (SHA-256, shown on the page) and uploads what the bucket doesn't already
  hold at that size. **Run it from `vectis-hub` on that PC after a rebuild**; the page updates with no
  code change. `--dry-run` lists without uploading. ⚠ It writes to the LIVE bucket (`.env`).
- **"Built by Vectis" vs "Official release"** (badge key on the page, design rule 3). A `-dev.` or
  `-vectis` version is ours; a plain x.y.z is storytold's own MSI, kept as a fallback. Newest x.y.z
  leads; at the same x.y.z the Vectis build leads. **Download** gives the MSI/EXE; the portable zip
  sits under **All versions**.
- **Downloads are signed GETs with `ResponseContentDisposition: attachment`** (the Screen Recorder's
  reason: `<a download>` is ignored cross-origin). The download route only signs a key the manifest
  lists — never a prefix match — after checking the key's exact shape.
- **Gate = IT Tools (`allUsers`)**: signed in is enough, the same as the recorder and screenshots, so
  the `DESTINATIONS` entry in `lib/help-map.ts` is ungated too. Software only, no personal data
  (compliance → R2 line updated).
- **"Download all" = two zips the script builds and uploads** (`craft-apps/bundles/`): every app's
  NEWEST Vectis build, and every app's newest official release, each with `SHA256SUMS.txt` and a
  README inside, stored uncompressed (installers don't shrink). A zip is rebuilt only when the set of
  installers in it changed (fingerprint kept in the manifest's `bundles`), so a re-run after a single
  rebuilt app re-uploads one ~400–750 MB zip, not both. Jordan (2026-10-13): *"separate download all
  buttons for both platforms"* — platforms here meaning the two kinds, not Windows/macOS (only
  Windows x64 is built or kept).
- A missing manifest (nothing uploaded yet) is an **empty list, not an error**.

---
## 📦 Goods In — the Hub's own check-in (2026-10-15)

Jack rebuilt the Warehouse section (`/tools/warehouse`, app key `WAREHOUSE`, tiers warehouse < manager
< admin) as **Goods In**, replacing the abandoned April prototype. The Hub card is now called "Goods
In" (key, href and app key unchanged). The flow, in the words staff see:

1. Find the customer in the customer database (the CRM `Contact`), or add them at the counter.
2. **Check in** their goods onto a **receipt** (R010244) — three steps: Customer · What they've
   brought · Check & book in.
3. Group the goods **by category, not item**, into **totes** (T027657) and **pallets** (P…) —
   "5x boxes of comics" is one tote. Each gets its number the moment its row is added, and its
   barcode label (100 × 50 mm) can be printed right there on the goods step.
4. **Book in**, then print and/or email the receipt.
5. Put the totes away at a **storage** location; later move them to a **bench** to be catalogued.
6. Cataloguers make lots from a tote in the Add Lot wizard exactly as now — each lot keeps the tote,
   receipt and vendor number, so its barcode still ties back to the receipt.
7. Move each finished lot to a **shelf** until it sells.

Every write is a server action in `lib/actions/goods-in.ts` (Check in's own in
`lib/actions/goods-in-checkin.ts`) returning `{ ok, error }`; the shared words and shapes are in
`lib/goods-in/model.ts`; who may do what is `lib/goods-in/access.ts` (read fresh from the database,
judged on the effective session). Managers void receipts and edit locations; only a Warehouse admin
sets the number series. ⚠ A `"use server"` file may only export async functions (and types), so the
customer helpers both action files share (`customerRow`, `CUSTOMER_INCLUDE`, `snapshot`) live in the
plain module `lib/goods-in/customer-row.ts` — put any other shared non-async helper in a plain module
the same way, never as an export of an actions file.

- ⚠⚠ **Goods In never touches Business Central** (Jack: *"don't do anything with BC"*). No BC API call,
  no BC sync table written, and End of Day, Tote Check, Locking Check, BC Match, Change Vendor,
  `lib/bc.ts` and `lib/tote-check.ts` are unchanged. What that means, and it is **not solved**:
  - A lot made from a Goods In tote shows **"Tote not in the BC data"** on Tote Check and **"Tote not
    found in BC"** on Locking Check, because BC has never heard of the tote.
  - End of Day flags its receipt **"Receipt doesn't exist in BC"** — the lot stays on the sheet, but
    the overnight import fails on it. So **a lot from a Goods In tote cannot get into BC** today.
  - ⚠ **A decision for Jack and Jordan before real stock is booked in this way.** Don't quieten those
    flags by teaching the checks about Goods In without that decision — they are telling the truth.
- **Numbering** (`lib/goods-in/numbers.ts`): one `GoodsInCounter` row per series, each number taken
  with a single `UPDATE … RETURNING` inside the transaction that needs it, so two clerks at once can
  never be handed the same number (the prototype's read-the-highest-and-add-one could). At check-in
  the numbers are taken **as the rows are added**, not at Book in (next rule). A number that already
  exists in Goods In is skipped, never reused. The series **carry on from BC's** — an admin sets the
  next receipt, tote and pallet number in Goods In → Settings on the day BC stops, and until a series
  is set, check-in refuses with a plain message rather than guessing.
  - ⚠ **Numbers are never reused, so there are GAPS, and that is accepted.** A row removed at
    check-in, a tote switched to a pallet (it takes a new pallet number), and a thrown-away check-in
    all give their numbers up for good — the counter has already moved past them. Don't "fill" gaps
    and don't set a series back to reuse them: a printed label may still be out there carrying one.
  - ⚠ **The vendor series is deliberately optional.** BC still hands out C-numbers for website
    sign-ups, so the Hub carrying the C-series on could give two customers the same number. With no
    vendor series set, a customer without a vendor number simply gets a receipt without one. Don't
    make it compulsory without asking.
- **Check in saves as it goes: a receipt is a DRAFT until Book in** (2026-10-16 — Jack, on the goods
  step: *"this needs to show the tote number and also needs to be able to print the tote labels etc
  from this"*). `GoodsInReceipt.status = "draft"` means **not booked in yet** — a free-text column, so
  no schema change. The actions are in `lib/actions/goods-in-checkin.ts`:
  - `saveCheckIn` saves the check-in so far. The first save (on reaching the goods step) takes the
    receipt number and makes the draft; every save numbers each row that has no number yet, in screen
    order, so the number shows on the row straight away. Labels print from the goods step through
    `GET /api/goods-in/labels?containers=…`, which records `labelPrintedAt`. ⚠ `saveCheckIn` does
    **not** `revalidatePath` — it runs on every add, remove and pause in typing, and the check-in page
    must not re-render under the clerk.
  - `bookInCheckIn` books it in: the same row save, then (one transaction) the terms, a vendor number
    exactly as `createReceipt` gives one (only when the customer has none AND the vendor series is
    set), the customer's details copied afresh, `status` draft → `"open"`, `createdAt` = the booking
    time and `createdById/Name` = whoever pressed Book in. A double tap books once (the second waits
    on the lock, finds it open, and gets the receipt back, not an error). Check in no longer uses
    `createReceipt`.
  - ⚠⚠ **Nothing about a draft counts as booked in.** Every count, figure and "booked in" list leaves
    drafts out (a customer's receipt count too — `CUSTOMER_INCLUDE`); the Add Lot wizard and Lotting
    Up fallback leave them out exactly like voided receipts; the receipt PDF and email refuse one (409);
    `addContainers`, `updateReceipt`, `updateContainer` and `markReceiptSent` refuse one ("carry on
    with it in Check in") — its totes can be moved, but not edited, catalogued or returned from
    elsewhere, because the check-in's next save would write over them. Its **labels can** be printed
    — that is the point of it. A draft is shown as "Not booked in yet" with a Carry on link wherever
    it appears.
  - ⚠ **Locks.** Every check-in write locks the receipt row first (`SELECT … FOR UPDATE`), then its
    totes and pallets in id order, so two tabs on one check-in queue instead of interleaving, and a
    Scan to move or label print of one of its totes waits for the save (or the save sees it).
  - ⚠⚠ **Anything that has moved is never deleted or re-numbered** — a tote or pallet with any
    `GoodsInMovement` (or a location recorded on it) can't be removed from a check-in or switched
    between tote and pallet; the save is refused, naming it, and nothing is changed. Its history must
    still read.
  - ⚠⚠ **A printed label is never lost without trace.** Taking a tote or pallet off a check-in after
    its label was printed (removed, or switched between tote and pallet) adds a line to the receipt's
    notes — *"Taken off this check-in after its label was printed: T…, T… (date, by …)"*
    (`LABEL_GIVEN_UP_NOTE`, read back by `labelsGivenUp`). The Hub keeps those lines itself: the
    check-in screen is sent only what was typed in Notes, and every save puts them back after it. And
    each save says which numbers the screen took off (`removed`), so a labelled tote the screen never
    had — another tab added it, or the screen is an older copy — is **refused**, naming it ("open the
    check-in again"), instead of being taken off unseen.
  - **Throwing a check-in away** (`discardCheckIn`) **deletes** the draft (its totes and pallets with
    it) when no label was printed — for a tote still on it, or one taken off after printing — and
    nothing moved; otherwise it **voids** it with a note — *"Thrown away at check-in before booking in
    — labels had been printed for T…, T…"* — so a stray labelled tote can be traced. That void is
    final: it was never booked in, so `updateReceipt` refuses to reopen it, even for a manager, and
    its notes can be added to but never have that record taken out (it is also what tells it apart
    from a booked receipt a manager voided). Carrying on (`loadCheckIn`, `?receipt=R…` on Check in),
    printing and throwing away are **anyone in Goods In**; voiding a BOOKED receipt is still a
    manager's. Unfinished check-ins are offered to carry on from Check in (the person's own only —
    and, once a customer is picked, a quiet line if that customer already has one waiting, anyone's),
    the Receipts list, the Goods In dashboard ("Check-ins not finished", the first three) and the
    customer's page. A check-in with nothing written, ticked or printed on it is thrown away without
    asking when the clerk moves on to another one.
  - Check in takes `?receipt=` / `?customer=` off the address once it has opened (replaceState):
    Book in and Throw it away refresh the page on the server, and with `?receipt=` still there that
    refresh would redirect off the Done panel to the receipt page.
  - Known limits, accepted for now: each save sends every row on the screen and the server makes the
    receipt match, so a second, out-of-date tab on the same check-in takes off rows it never saw —
    refused if they had moved or had a label printed; an unlabelled one becomes a gap. A save that
    hasn't answered in 30 seconds is treated as not answered (Retry), so the screen never waits for
    ever. And if the answer to the very FIRST save is lost, the retry makes a second draft — the
    first then waits in "Check-ins not finished" to be thrown away.
- **Check in never asks about fees** (Jack, 2026-10-16: *"it's more the checking in asking for fees
  part you have done is annoying"*). There is **no Terms step** — the steps are Customer · What
  they've brought · Check & book in. Every receipt takes the customer's usual terms automatically —
  their **Fees & agreement** tab (next rule): commission and lotting / photography / unsold fees from
  their `GoodsInCustomer`, their usual reserve from `GoodsInAgreement`, and `DEFAULT_TERMS` for any
  that is blank (`usualTermsFrom` in `lib/goods-in/model.ts` is the one way it is worked out — the
  server's check-in actions and `createReceipt` use it, and so do the screens). Check & book in
  shows them as one plain line with a small "Change for this receipt" link that opens the terms fields
  (closed by default); that changes THIS receipt only, and its hint links (a full-size link, new
  tab) to the customer's Fees & agreement tab, where their usual terms are changed — not at the
  counter. An unusual value never blocks or nags — only an impossible one (a negative fee, more than
  100%) is refused, and Book in refuses it on the server too. ⚠ Don't bring back a Terms step or a
  "check the fees" question without asking Jack.
  - **How Check in reads the agreement.** `getAgreement` whenever the customer changes and whenever
    the browser tab comes back into view (so a change made on their tab in another browser tab shows
    when the clerk returns); terms still at their usual values follow it, terms changed for this
    receipt are left alone, and nothing changes during a booking. The special arrangement shows under
    the terms line as a small indigo note, and one quiet grey *"Vendor terms not signed yet — they'll
    sign the receipt."* only once the agreement has been read and is `ready` — never a guess, a nag or
    a block.
  - ⚠ **A read that fails is never shown as their usual terms** (design rule 7). Book in waits for
    the FIRST read for the customer on screen ("Reading their fees…", 6 seconds at most); a read that
    fails is tried once more after 3 seconds, and meanwhile Check & book in labels the line *"The fees
    on their record"* with one amber line — *"Their Fees & agreement couldn't be read — the reserve
    shown is the standard one"* — and Try again. Booking is then still allowed. A failed RE-read keeps
    what was read before.
- **A customer's Fees & agreement tab** (2026-10-16 — Jack: *"need a tab for fees and agreement and
  stuff"*, and asked where: *"Tab on the customer's page"*). `/tools/warehouse/customers/<id>?tab=fees`,
  beside Overview: their fees and usual reserve (each blank = standard, shown as the placeholder), the
  day they **signed Vectis's vendor terms** and who recorded it (the terms themselves fold out from
  `VENDOR_TERMS`), and a **special arrangement** in plain words ("15% on any single lot over £5,000 —
  agreed with Jordan, March 2026"). Set once there; Check in just uses it and has no fees tab at all —
  it shows the arrangement as a small note and, if the terms aren't signed, one quiet line (never a
  block or a nag). The customer form has no fees any more: new customers start on the standard terms.
  - **Where it is kept.** The fees stay on `GoodsInCustomer`; the reserve, the signed date + who
    recorded it, the special arrangement (≤ 1,000 characters, `SPECIAL_ARRANGEMENT_MAX`) and who
    changed any of it last are ONE new table, **`GoodsInAgreement`** (one row per contact, cascade —
    **NEEDS Run Migrations**). Nothing was added to `Contact` or `GoodsInCustomer`. The signed day is
    stored at 12:00 UTC on that London day, so it reads as that day.
  - **Editing** is `getAgreement` / `saveAgreement` in `lib/actions/goods-in-agreement.ts` — anyone
    in Goods In (as with the rest of a customer), `{ ok, error }`, every value checked before
    anything is written and then written in one transaction; null puts a field back to standard /
    not signed / none. ⚠ `saveCustomer` now leaves a fee it isn't sent ALONE (it used to write a
    missing fee as null — with the fees gone from the form, every address edit would have put the
    customer back on the standard fees).
  - ⚠⚠ **Every read of `GoodsInAgreement` is tolerant** — `readAgreement` / `readAgreements` in
    `lib/goods-in/agreement.ts` (never throw; a missing table → nulls, `ready: false`). Its OWN query
    in try/catch: **never `include` it** in a contact or customer query (`CUSTOMER_INCLUDE` or any
    other a screen depends on) — between the deploy and Run Migrations that would break the
    customer screens and Check in. And **never read it inside a transaction**: a failed query aborts
    the whole Postgres transaction, so a missing table would take a booking down with it — the
    check-in actions and `createReceipt` read it first, then open the transaction. Until Run
    Migrations the tab still shows and saves the FEES and says the rest needs Run Migrations;
    `saveAgreement` refuses anything that would put something in the table (clearing is fine), before
    writing anything; Check in falls back to the standard reserve and no arrangement.
  - ⚠ **The one strict read is BOOK IN.** `bookInCheckIn` and `createReceipt` use `findAgreement`
    (still before the transaction): a missing table is `ready: false` as above, but any other fault
    refuses the booking — nothing booked, `AGREEMENT_UNREAD`, "press Book in again" — rather than
    copy "no special arrangement" onto a receipt nobody could check. (A second press of a check-in
    that DID book still gets its receipt back.) The autosave, `saveCheckIn`, stays tolerant: Book in
    copies the arrangement afresh anyway. On the customer page a failed read says so too — the
    Overview summary says "couldn't read their agreement just now" instead of the standard reserve,
    and the tab's cards say "couldn't be read", not "needs Run Migrations".
  - **The special arrangement is COPIED onto the receipt** at booking, inside the customer snapshot
    (`GoodsInReceipt.customer.specialArrangement` — JSON, no schema change), and the receipt PDF
    prints it on page 1 under the terms as "Special arrangement: …" from that copy, never from the
    customer's current agreement: a reprint shows what applied on the day, and changing the agreement
    changes future receipts only. It is fitted so the signature lines never leave page 1 — the PDF
    measures the rest of page 1 with the same drawing code (`dry`) before sizing it: the largest size
    down to 7pt as written, then with its line breaks joined by " / " (a list takes a line per item),
    and only when even that won't fit does page 1 end it "... (continued overleaf)" and page 2 print
    the WHOLE arrangement above the tote table. ⚠ Nothing agreed is ever cut off without trace — don't
    go back to simply truncating it. `safe()` keeps € and • (WinAnsi has both) and turns a tab into a
    space (`saveAgreement` stores tabs as spaces, so what's kept is what's printed). The labels'
    layout is unchanged.
  - The arrangement is **indigo** wherever it shows (the tab, the Overview summary, Check in) — amber
    means a warning everywhere else in Goods In, and an arrangement isn't one.
  - ⚠ Never put bank details in a special arrangement or anywhere else (rule below) — the box says so
    to the staff typing in it, as it's printed on their receipts.
- ⚠⚠ **A customer's bank details are never stored or shown.** The bank form on the printed receipt
  is blank by design and the customer fills it in by hand — nothing in the Hub is locked down enough
  to hold them. Don't add fields for them.
- **Emailing a receipt** goes from the receipts mailbox (`RECEIPTS_MAILBOX`, default
  admin@vectis.co.uk) through Microsoft Graph, signed in **delegated with `Mail.Send.Shared`** — the IT
  mailbox's pattern, no tenant-wide permission. ⚠ It waits on **IT's consent** (the permission and
  the redirect URI on the app registration); until then the screens say so plainly, and a receipt can
  still be printed, or downloaded and emailed by hand. A copy is kept in the mailbox's Sent Items.
  Microsoft 365 is listed as a processor on Data & Compliance and the DPIA for this.
- **New tables only**: `GoodsInCustomer`, `GoodsInReceipt`, `GoodsInContainer`, `GoodsInLocation`,
  `GoodsInMovement`, `GoodsInCounter`, `GoodsInMailAuth`, and (2026-10-16) `GoodsInAgreement` and
  `GoodsInScanEvent` (the handheld scanner's record, below) and `GoodsInScannerPass` (its sign-in
  cards), and (2026-10-21) `GoodsInScanAck` (failed scans acknowledged on the scanner's pop-up)
  (**NEEDS Run Migrations**). ⚠ **Nothing was
  added to `Contact`, `CatalogueLot` or `User`** — a shipped-but-unmigrated column there breaks every
  contact or lot save, or login, between the deploy and Run Migrations. Keep it that way. Until the
  tables exist every Goods In screen says it isn't set up yet rather than crashing.
  - A Goods In customer **is** a CRM contact; `GoodsInCustomer` holds only the Goods In half (vendor
    number, mobile, town, county, country, VAT number and fees), one row per contact; their reserve,
    signed vendor terms and special arrangement are `GoodsInAgreement` (above).
  - A receipt **copies** the customer's details when it is booked (`GoodsInReceipt.customer`, with
    their special arrangement as it was then), so a reprint next year says what it said on the day.
    Editing the customer, or their agreement, changes future receipts only.
- **A lot's shelf is its latest `GoodsInMovement` with that `lotId`** — never a column on the lot. A
  tote's current location is kept on `GoodsInContainer` as well, so lists don't have to work it out;
  a move writes both in one transaction.
- **The Add Lot wizard and Lotting Up fall back to Goods In ONLY after BC's copy finds nothing**
  (`/api/warehouse/vendor-lookup` and `/api/warehouse/tote-search`). Every tote and receipt BC knows —
  a shell tote and one with no vendor included — answers byte-for-byte as before; Goods In is asked
  only when BC has **no row at all** for the number, and answers in the same shape with
  `source: "goods-in"`. ⚠ `catalogued` is always null there (the wizard words a true value as BC's
  tick on a re-used tote, which a Goods In tote never is), totes on a **voided** receipt — or on a
  **draft** one, not booked in yet — are not offered, and a missing table simply means nothing from
  Goods In.
  - ⚠ The wizard still says "BC" in places ("Type the BC tote number…", "Typed by hand, not taken from
    BC"), and a Goods In receipt with no vendor number cannot fill the wizard's required Vendor box —
    the cataloguer types it. Wording on those screens is a cataloguing change, not a Goods In one.
    For such a tote the wizard now shows the customer and receipt in its banner, fills the receipt,
    and says "Booked in through Goods In with no vendor number … type it in".
- **Switching the vendor series off**: an admin can press "Stop giving vendor numbers" on the vendor
  card in Goods In → Settings (`clearCounter("vendor")`, which refuses every other series).
- **Voiding and un-voiding a receipt both need a manager.** `updateReceipt` reads the current status
  and changes it in one step, so two people changing it at once can't both win; a void reason is
  added to the notes on the server (`appendNote`), never overwriting them.
- **A half-finished check-in is kept on the server** as its draft receipt (above). The browser tab's
  `sessionStorage` (v2) also keeps the receipt number, customer id and name, rows, terms and ticks only
  (every access in try/catch), offered back only to the same user; carrying on from it loads the draft
  from the server (`loadCheckIn`), and a v1 copy (no receipt number) still restores as before. It is
  cleared on Book in. Never put anything more personal in it.
- Check in opens with a customer already chosen from `/tools/warehouse/check-in?customer=<contact id>`
  (the Customers list and customer page use it), or carries on a draft from
  `/tools/warehouse/check-in?receipt=<receipt number>` (a receipt that isn't a draft opens its receipt
  page instead).
- Registered in `lib/help-map.ts` (Book in · Receipt list · Scan to move · Benches · Code lookup ·
  Locations & labels · Number series & email · Movement record · Fees & agreement · Handheld scanner ·
  Scanner sign-in cards · Output by person). ⚠ Those names and their keywords avoid everyday words
  ("find", "move", "receipts", "bench", "settings") on purpose: the Help box refuses a question that
  matches a tool the asker can't open, and a cataloguer asking "where do I find…" must never be told
  Goods In isn't part of their Hub.
- **Locations** (2026-10-15 — Jack: *"I need to be able to filter on this, remove locations etc — this
  is missing a lot of functions"*). The list is `/tools/warehouse/locations`, each location has its own
  page at `/tools/warehouse/locations/<code>`, the many-at-once actions are in
  `lib/actions/goods-in-locations.ts`, and reading and making codes (aisle/bay/shelf, ranges, pasted
  lists, CSV cells) is `lib/goods-in/location-codes.ts` — use those helpers, don't write another parser.
  - ⚠⚠ **Remove only DELETES a location that was never used and is empty.** One with goods there now
    (a tote or pallet that isn't returned, or a lot whose latest move is to it) is **refused** — move
    them out first. One that was ever used (any move into or out of it, or any tote or pallet, even a
    returned one, recorded there) is **switched off** instead, so its history still reads:
    `GoodsInMovement` keeps codes as text with no foreign key, and deleting a used code would leave
    moves pointing at a place that no longer exists. The checks and the delete run in one transaction
    with the locations locked, and the DELETE re-checks "never used" itself. Don't simplify it into a
    plain delete.
  - **Adding, changing, switching off and removing locations — one or many — is manager+**, checked
    on the server in every action, not just hidden on the screen. Viewing, labels, exporting and moving
    goods are anyone in Goods In. A bulk action takes at most `MAX_BULK_LOCATIONS` (2,000).
  - **Adding in bulk never changes an existing location** (`createLocations`, behind Add a range and
    Paste a list) — a code that's already there is reported as already there and left exactly as it
    is. Every way in (single edit, bulk add, the warehouse's list) checks codes with
    `LOCATION_CODE_RULE` (letters, numbers and `- _ / .`, up to 24).
  - **"Import the warehouse's location list" reads `lib/goods-in/location-list.json`** — the full
    3,920-code list from the warehouse's own spreadsheet (Jack, 2026-10-20): aisles in both the
    A10A1 and 10A1 forms (780 pairs name the same shelf — both are kept because both are in use),
    half-shelves (11A1A/11A1B), cages, benches and named areas. ⚠ It is Goods In's own copy:
    `lib/warehouse-locations.json` (1,946 codes) feeds the BC warehouse heat-maps and must not be
    swapped for it. To refresh, rebuild location-list.json from a new export (Code, Name,
    Cataloguing Bench) and press Import again — it only adds codes that are missing.
  - **Move everything** (`moveEverything`) empties a location into another: every tote and pallet
    there (not returned) and every lot whose latest move is there, one movement each noted "Moved
    everything from …", all in one transaction. Status follows `moveTo`'s rule (catalogued and returned
    keep theirs), and a lot's move carries its barcode as it is NOW (as `moveTo` does). The target must
    exist and be switched on; the source may be switched off, or no longer a location at all — the
    "no such location" page offers it for goods stranded at a removed code.
  - ⚠⚠ **Locks.** `moveEverything` reads its target `FOR SHARE`, so a remove or switch-off of that
    location waits for the move (then sees the goods) or the move waits for it (then finds it gone or
    off) — goods can't land at a location being deleted. Every many-at-once UPDATE locks its rows in
    CODE ORDER first (`… FROM (SELECT … ORDER BY "code" FOR UPDATE)`), the same order `removeLocations`
    uses, so two managers' overlapping changes queue instead of deadlocking; a deadlock that still
    happens is reported as "someone else was changing the same locations — nothing was changed".
    `moveTo` takes the same FOR SHARE lock on its target since 2026-10-16 (its rules moved into the
    shared `moveItem` in `lib/goods-in/move-core.ts` for the handheld scanner — see below), so a single
    Scan to move racing a remove of its target is covered too.
  - **The Locations screens never re-create or overwrite a location from a stale screen.** Add uses
    `createLocations` (reports "added by someone else a moment ago"), Edit and Change name or kind use
    `updateLocation` (writes only the fields that changed, and reports a location removed meanwhile
    instead of bringing it back), Switch on/off uses `setLocationsActive`. `saveLocation` (an upsert)
    is no longer used by them — don't wire it back in.
  - Changing a location's kind (one or many) doesn't touch the totes already there — they keep their
    status and recorded kind until they're next moved, the same as the single edit form.
  - **Bulk "Move everything to…"** (anyone in Goods In) is driven by the BROWSER, one location per
    `moveEverything` call, with a moving count, a Stop, and a closing summary in numbers (design rule
    7b); it stops by itself when the same error comes back three times in a row (the target, or the
    connection). Bulk **Names…** (`setLocationsName`, manager+) gives the usual name or clears it; named
    areas have no usual name and are left alone. **Export what's there** (`goodsAtLocations`, read-only,
    anyone in Goods In) lists every tote, pallet and lot at the ticked locations, or at one location.
  - **Check what's here** on a location's page is a shelf check: scan what is really there, see what
    the Hub records but nobody scanned, and what was scanned but is recorded elsewhere. It stores
    NOTHING — only its "Move it here" button writes, through `moveTo`. **Replace with a new code**
    (manager+) is `createLocations` → `moveEverything` → `removeLocations`, reported step by step and
    stopping at the first failure with what was done so far.
  - **The list's filters live in the URL** (`window.history.replaceState`), so Back, a refresh and a
    shared link keep them. Don't move them into localStorage. A choice is written at once; typing in
    the search box a quarter-second after the last key. Picking an area clears aisle/bay/shelf/cabinet,
    an aisle clears bay and shelf, a bay clears the shelf — and `computeFacets` counts each choice with
    exactly those cleared, so the number beside a choice is what picking it shows (the picked one shows
    the list's own count). ⚠ Change one and you must change the other.
  - Conveniences in sessionStorage (all in try/catch): the ticked codes, read through
    `useSyncExternalStore` so the server's first render (nothing ticked) still matches — never in a
    `useState` initialiser, which mismatches on hydration; and the list's query, so deleting a location
    from its page returns to the same filtered list (`?removed=CODE` is said only if CODE is really gone).
  - A `<select>` picked with the MOUSE lets go of focus (`select-focus.ts`), or the next scanned label
    types into it instead of the search box. Paste a list reads spreadsheet quoting, so the Locations
    export pastes straight back in.
  - **No new tables or columns.** Area, aisle, bay and shelf are worked out from the code
    (`parseLocationCode`); "last used" and "ever used" from `GoodsInMovement`. Removing is confirmed
    in the page (Confirm / Cancel), never with `window.confirm`.

### 📱 Goods In → the handheld scanner: `/scan` and the Vectis Scanner app (2026-10-16)

Jack: *"Right now we use scanners to locate things — they're Newland scanners. I need to make a hand
scanner app."* He chose a real Android app — *"its not linked to pc purely for the Hub warehouse we
have made"* — that **saves scans offline and sends them when it reconnects**, and **takes scans straight
from the scanner** so a scan can't land in the wrong box, as a **thin wrapper around a scanner screen in
the Hub**, not a separate build.

- **Three parts, one set of rules.**
  - **The screen** — `/scan` (`app/(scanner)/scan/`): its own full-screen, phone-sized, one-handed
    layout with no Hub nav. It does its own sign-in check (`scanWho` → `resolveScanUser`): nobody
    signed in → only the full-screen **"Scan your sign-in card"** screen (`card-sign-in.tsx`, with
    "Sign in with username and password instead"); no Goods In access → a plain message with the card
    sign-in underneath (a Hub login's refusal is written to the Access Log first). Put away / Move,
    Find, Check a location. Works in any browser with a scanner set to keyboard output. Its queue,
    sync and scanner input are `lib/goods-in/scan-client/`.
  - **The app** — `scanner-app/`: a Capacitor 7 Android app whose WebView loads the Hub's `/scan`
    (`server.url`), so it signs in with the Hub's own login and cookies. A small native plugin
    (`NewlandScanner`) receives Newland scans by broadcast and hands them to the page; other brands and
    plain browsers use keyboard output. Production, staging and sandbox builds install side by side.
    It is its own project (own package.json) — not part of the Hub's dependencies, tsconfig, eslint or
    Next build.
  - **The server** — `app/api/goods-in/scan/{sync,bootstrap,lookup}`. The contract (types, limits, the
    not-set-up message) is `lib/goods-in/scan-contract.ts`; change both sides together.
- ⚠⚠ **A move from the scanner is exactly a move from Scan to move.** The rules — a tote or pallet by
  its number, else the newest lot with that barcode; the target must exist and be switched on;
  catalogued and returned keep their status, otherwise `STATUS_FOR_KIND`; one `GoodsInMovement` with
  `fromCode`, note and who; a tote on a not-booked-in-yet check-in can still be moved — live ONCE, in
  `moveItem` (`lib/goods-in/move-core.ts`), which `moveTo` and the sync both call, with the same
  messages. Change them there; never fork them into the route or the screen. It locks the target
  `FOR SHARE` (as `moveEverything` does), a tote or pallet `FOR UPDATE`, and a lot by a
  transaction-scoped advisory lock on its id (`hashtext('goods-in-lot:' || id)`).
  - `moveEverything` (`lib/actions/goods-in-locations.ts`) takes the same per-lot advisory lock for
    every lot it moves, in lot-id order, then re-reads the lots' latest moves, so a lot a scanner
    moved away while it waited drops out instead of being moved back. Any new code that moves lots
    must take that lock too (with `$executeRaw` — the lock returns void, which `$queryRaw` can't read).
- ⚠ **Nothing touches Business Central.** Since the scanner sign-in cards (below), `/scan` and
  `/scan/sw` — those two EXACT paths, nothing under them — are let through the login gate
  (`publicExact` in `auth.config.ts`), and the /scan layout does its own sign-in check through
  `getScanUser()`. The scanner's API routes check the person and Goods In access themselves
  (`scanGate()` in `app/api/goods-in/scan/_lib/scan-gate.ts` — the Hub session, else a card; fresh from
  the database, effective session), as every `/api` route must. ⚠ Never put `/scan` in the PREFIX list
  (`publicPaths`), and never open another path for the scanner — anything it needs goes behind
  `/api/goods-in/scan/*`.
  - ⚠⚠ **The service worker must stay an extensionless ROUTE — `app/(scanner)/scan/sw` (URL
    `/scan/sw`) — never a `.js` file in `/public`.** `/scan/sw` is public ON PURPOSE (its exact path
    is in `publicExact`, so the sign-in screen works with nobody signed in); that is safe because the
    script holds no data or secrets. It stays a route so that this one exact path is all that is
    opened: `proxy.ts`'s matcher lets EVERY `*.js` path through without a login, so a
    `public/scan-sw.js` would sit outside the gate with no list entry saying so. The route sends
    `Service-Worker-Allowed: /scan` and is registered with scope `/scan`, only from the /scan page.
  - ⚠ **Signing in from a plain browser lands on `/hub`, not back on `/scan`** — `loginAction`
    (`app/login/actions.ts`) always redirects to `/hub` and ignores `callbackUrl`. The app works round
    it (below) and Switch user signs in on the screen itself; the fix is for login to honour a safe
    same-origin relative `callbackUrl`.
- **The offline queue.** Every scan is queued on the device (IndexedDB, localStorage as a fallback)
  with its own uuid and the time it was scanned, and sent in scan order, at most 200 a call, to
  `POST /api/goods-in/scan/sync` whenever the device is online. Nothing is dropped silently: an event
  the server didn't answer stays queued. A service worker scoped to `/scan` lets the screen open with
  no Wi-Fi, and the bootstrap (`GET …/bootstrap` — who is signed in, which Hub, every location) is kept
  so location codes are still recognised offline. Find (`GET …/lookup`) is online only and says so
  (it does say what THIS scanner last did with the item, from its own queue).
  - **What the service worker does** (`app/(scanner)/scan/sw/source.ts`): the /scan page is network
    first with a 4-second fallback to the saved copy (a Wi-Fi dead spot doesn't leave it hanging); only
    a page carrying `data-scan-ready` is saved — never the sign-in page, a redirect or the no-access
    message. ⚠ A page that ISN'T the one loading its own files (the slow answer that arrives after the
    copy was shown, or the copy fetched on a first visit) is saved only once every `/_next/static/`
    file it names is in the cache; otherwise the old copy is kept. A new build saved without its chunks
    would open offline looking normal and never take a scan. Next's static files are
    stale-while-revalidate; the bootstrap falls back to a saved copy marked `X-Scan-From-Cache: 1`. It
    never handles a POST, a lookup or any other route. Signing out or switching user deletes the saved
    page and bootstrap (they are one person's).
  - The queue asks the browser to keep its storage (`navigator.storage.persist()`); a plain browser
    that won't promise it is named in the screen's settings.
- ⚠⚠ **Idempotent by event id — `GoodsInScanEvent`.** Each event's row is inserted FIRST, in the SAME
  transaction as its move (on conflict do nothing), then given its outcome. A retry after a lost answer,
  or two sync calls racing, waits for the first, finds the row and answers **already** — a scan is
  applied once or not at all. One transaction per event, in order. Outcomes: **applied** · **already**
  · **refused** (in plain words — unknown item or location, switched off, already there, too old; it is
  RECORDED, so it isn't retried for ever, and a replay answers the same) · **stale**.
- ⚠ **The stale rule.** A scan whose item has a recorded move NEWER than the scan (its latest
  `GoodsInMovement`, or the tote's `movedAt`) — someone moved it since — is NOT applied; the message
  says who moved it, where and when. An applied move is stamped with the time it was SCANNED, not when
  it arrived, so History reads in the order things really happened. A `scannedAt` in the future is
  taken as now; older than 7 days is refused as too old. ⚠ The rule compares the scanner's clock with
  the Hub's, so a scanner whose clock is wrong can be told "stale" wrongly — keep the devices on
  automatic time. The screen corrects its own stamps with the Hub's clock (from every answer, and saved
  for a reload with no Wi-Fi) and shows a red strip when the device is more than 5 minutes out.
- **Shared devices.** Every scan carries `scannedBy` — the person signed in when it was made — and the
  sync refuses one sent by anyone else ("Scanned by someone else — sign in as them to send it"). That
  refusal alone is NOT recorded, so signing in as them still sends it. The screen blocks Switch user
  while scans are waiting (sending them first when online). Moves are recorded under the effective
  user, as `moveTo` does. After 20 minutes with no scan or tap the next scan asks **"Still (their name)?"**
  (that scan isn't used), so the next person to pick a scanner up doesn't scan under the last one's
  name; and a location that stays set is let go after 10 minutes with no scan.
- **The screen's feedback.** The banner answering each scan sits OUTSIDE the scrolling part, so it is
  on screen however far down the lists someone has scrolled — keep it there. Every answer to a scan
  beeps and buzzes; "Location set" and "Checking …" have their own two rising pips, because from then
  on every item goes to that place. Refused and stale scans stay in "Need a look" on every screen until
  dismissed, with a red button to them in the status bar. In keyboard mode a scanner's burst typed
  into one of the screen's own boxes (the note, Type a code) is caught as a scan and taken back out
  of the box (`lib/goods-in/scan-client/scanner.ts`), so it is never lost or sent as a note.
- ⚠⚠ **A failed scan must be acknowledged before scanning carries on** (2026-10-21 — Jack: *"it's fine
  to rapid scan 100s of them but currently they do this and one fails and they don't check"*).
  - **What opens the pop-up**: every scan whose answer is a failure the worker must know about —
    anything the screen shows as a red (error) result, a **refused** or **stale** answer from the sync
    (even minutes later, after being offline), and a scan **not taken because the pop-up was already
    open**. Amber or information answers that aren't failures ("already there", location set) don't.
  - **The pop-up** covers the whole scanner screen (red header, "This scan didn't go through") and
    lists every failure not yet acknowledged: the barcode, what went wrong in plain words, when it was
    scanned (UK time, to the second), and for the Hub's answers who and where when known. One button,
    **"I've seen it — carry on"** (≥ 48px), covers everything listed. ⚠ It must be a deliberate TAP:
    never focused by itself, Enter and Tab are ignored while it is open (a keyboard-output scanner
    sends Enter after every code), and no scan can press it. It stays compact enough for the MT65.
  - ⚠ **While it is open, nothing scanned is acted on** — from the plugin or the keyboard. Each such
    code is added to the pop-up as "Not taken — the pop-up was open" with an error buzz, as a failure
    of its own (`blocked`) to acknowledge too. It buzzes when it opens (Settings → Sound & alerts is
    respected) and again about every 8 seconds while it stays open. It survives a reload, shows for the
    signed-in person only, and blocks Switch user and Settings while it is up. Refused and stale scans
    still stay in "Need a look" for rescanning, as before.
    - ⚠ **Nothing else gets past it either.** A TAP's action that queues a move or starts a check (a
      banner button, Move it here, Move it anyway, Move / Check from Find, Check again) waits behind any
      scan still being handled and is dropped with an error buzz if the pop-up is open by its turn
      (`afterScans` in the controller) — use it for any new tap that acts. Back does nothing
      underneath: the app's `vectis:back` is refused, and a plain browser's Back (a popstate) puts the
      screen's history entry back. (Back from the very first entry leaves /scan, which no page can stop
      — the pop-up is still there when /scan opens again.)
    - ⚠ **It says whose failures they are**: "<name>, check it before you carry on — the button records
      that you've seen it". When Switch user is pressed and held (the usual way: "Still …?" → Switch
      user, when the scanner may be in someone else's hands), it adds that only <name> should tap it.
      The acknowledgement is recorded under the signed-in person, so someone else tapping it away would
      make Reports say the wrong person saw it. ⚠ **A decision for Jack** (not yet made): whether
      Switch user from "Still …?" should instead go ahead and leave the failures on the pop-up for
      their owner (they come back when that person signs in on this scanner again). Until he says,
      the brief's rule stands — held.
  - **Each acknowledgement is recorded.** The button queues one `ScanAck` per failure listed
    (`lib/goods-in/scan-contract.ts`: its own uuid, the code, the problem — `refused` · `stale` ·
    `error` · `blocked` — the reason in words, the scan's id, when scanned / shown / acknowledged, and
    who) in the device's store beside the scans; the sync engine sends them to
    **`POST /api/goods-in/scan/acks`** (≤ 200 a call, `scanGate()` — cards allowed). They become
    `GoodsInScanAck` rows (in `lib/data-map.ts` as staff data), read by Goods In → Reports. This ADDS
    a step and a second kind of queued record: how moves and scans are applied, the stale and refused
    rules, card sign-in and the scan queue are unchanged.
    - **On the device** (`lib/goods-in/scan-client/`): IndexedDB `vectis-scan` **version 2** adds the
      `acks` object store beside `scans` and `kv` (localStorage key `vectis-scan-acks-v1` when
      IndexedDB can't open, carried back into IndexedDB on a later visit; page memory as the last
      resort). An `AckRecord` goes `open` (on the pop-up) → `waiting` (acknowledged) → `sent` or
      `refused` (the Hub can never store it). ⚠ `StoredScan.flagged` is the pop-up's mark on a queued
      scan: sync.ts writes `flagged: false` in the SAME store write as a refused or stale answer, and
      the controller sets it true only once that failure's record is really WRITTEN on the device — so
      an answer that lands as the page closes, or whose record couldn't be saved, still reaches the
      pop-up when it opens again. Scans from before this have no flag and never pop up. ⚠ `prune()`
      must never drop a scan with `flagged: false`, or an `open` or `waiting` acknowledgement — only
      sent / refused ones beyond the newest 100. Change prune and a failure can vanish from the pop-up.
    - **Sending**: acknowledgements go only after every waiting scan has gone with no problem, and
      never while another send is asked for — a scan queued while an acks call is in flight lets go of
      that call (aborted; the Hub stores each once, so they simply go again after the scan). They have
      their own back-off and their own problem (`ackProblem`), so an acks 503 before Run Migrations
      never shows as scans "not sent". Switch user sends scans only (`sendNow({ scansOnly: true })`)
      and waits at most 8 seconds for a person's waiting acknowledgements — never a reason not to switch.
    - ⚠ **The reason never carries a customer's name or another member of staff's** — it is what
      Reports keeps. A red banner that names someone (a receipt's or vendor number's customer with a
      Hub login, "now signed in as <someone else>") passes its own `reason` without the name
      (`say(…, { failure: { reason } })`). The one exception is the Hub's own overtaken message (who
      moved it since), which Reports takes the name out of for a warehouse-tier viewer.
  - ⚠ **The acks route** (`app/api/goods-in/scan/acks/route.ts`) stores each acknowledgement ONCE per
    id (`createMany` with `skipDuplicates`), so a replay answers ok and stores nothing new — and once
    per person, queued scan and problem: one naming a `scanId` already acknowledged with the same
    problem under another id (two /scan tabs, or a scan put on the pop-up again after its first record
    was sent and pruned) answers ok and is not stored, so Reports counts that failure once. `scannedBy`
    must be the signed-in person: that refusal (`ACKED_BY_SOMEONE_ELSE`, with `keep: true`) isn't
    stored, and the scanner keeps it until that person sends it. Any other refusal (no proper id, an
    unknown problem, no proper time, acknowledged more than 30 days ago) could never be stored, and the
    scanner drops it. Fields are tidied, never trusted: code ≤ 64, reason ≤ 500, a time in the future is
    taken as now and any other time older than 30 days as unknown. ⚠⚠ **A sign-in card's code is never
    stored** — as the code it is dropped, and inside the reason it becomes "a sign-in card". One insert
    per call; only a fault in one record's own DATA makes it store them one at a time so just that one
    is refused — anything else stores nothing and answers 503, and they are sent again. About 15
    seconds in it starts no more (the rest get no result and stay queued), inside the screen's
    30-second wait (`postAcks`) — change them together.
- ⚠⚠ **Run Migrations.** `GoodsInScanEvent` is a new table (one row per scan: who, which device, item,
  location, when scanned and when received, outcome, message — in `lib/data-map.ts` as staff data).
  Until it exists the sync answers **503 "Goods In scanner isn't set up — an admin needs to press Run
  Migrations."** before touching anything, the scanner keeps its queue, and the bootstrap says
  `ready: false`. Nothing was added to `Contact`, `CatalogueLot` or `User`. **`GoodsInScanAck`** (2026-10-21,
  migration `20261021120000_goods_in_scan_acks`) is the same: until it exists the acks route answers
  the same 503 with nothing stored, and the scanner keeps every acknowledgement queued — never drops one.
- **A call that can't finish.** The sync stops starting new events after about 25 seconds, and stops at
  any unexpected error (a lock, a timeout, the connection, a fault in the Hub's own code): the events
  already done are answered, the rest get no result (`unsent`, with `error` saying why) and stay queued.
  ⚠ Only a fault in one scan's own DATA (a value the database won't store) is recorded as a refusal,
  so one bad scan can't hold up the queue behind it. Don't widen that to "any error": a bug would then
  turn every scanner's backlog into refusals that have to be redone by hand.
  - ⚠ **The timings fit together**: 25 s, plus one event's worst case (5 s waiting for a connection, 10 s
    running), stays inside the screen's 50-second wait for an answer (`postSync`). An answer that
    arrives later is lost on the screen and read as "no Wi-Fi". Change them together.
  - A `scannedAt` before 2020 (a scanner's clock reset after a battery pull, or a value Postgres can't
    store) is treated as no time and refused — recorded — rather than failing the call on every retry.
- **The build.** GitHub builds the APKs (`.github/workflows/scanner-app.yml` — a push to `staging` or
  `main` that touches `scanner-app/**`, or run by hand); nothing is built on anyone's PC. Release builds
  are signed with a key held ONLY as GitHub secrets (`SCANNER_KEYSTORE_BASE64`,
  `SCANNER_KEYSTORE_PASSWORD`, `SCANNER_KEY_ALIAS`, `SCANNER_KEY_PASSWORD`), made once by
  `scanner-app/scripts/make-signing-key.mjs`, which saves the keystore and its passwords to
  `Documents\Vectis Scanner signing key\` on the PC that ran it — never the repo — and never prints a
  secret. ⚠⚠ **Keep that key safe**: an update installs over the old app only when it is signed with the
  SAME key. Lose it and every scanner has to uninstall the app (losing any scans still queued on it)
  and install afresh. Without the secrets the workflow still builds, debug-signed, and says so loudly;
  ⚠ with the secrets present but not fitting together (wrong password or alias, cut-short base64) it
  builds NOTHING, so a wrongly signed app can't go out. "Run workflow" only appears once the workflow
  file is on `main` (the default branch); until then a push under `scanner-app/` or "Re-run all jobs"
  builds. ⚠ Check every `run:` block with `bash -n` before pushing — an apostrophe inside a
  `${var:-word}` in double quotes broke the summary step once, which turns every run red.
  The install guide for the Newland scanners is `scanner-app/README.md`.
- **App facts** (`scanner-app/`):
  - **JDK 21, not 17** — Capacitor 7's Android code is compiled for Java 21. **targetSdk 36** (Play's
    level since 31 Aug 2026), which needs Android build plugin **8.10.1**; Gradle 8.11.1; minSdk 24.
  - The NewlandScanner plugin takes scans by broadcast (`nlscan.action.SCANNER_RESULT` /
    `SCAN_BARCODE1`, the older `com.android.server.scannerservice.broadcast` / `scannerdata`, and one
    custom broadcast for other makes) and, while the app is on screen, sets the scan service to API
    output (`ACTION_BAR_SCANCFG`, `EXTRA_SCAN_MODE` 3). ⚠ When the app leaves the screen it sets
    `plugins.NewlandScanner.keyboardOutputMode` in `capacitor.config.ts` — **2 "Simulate keystroke"
    by default**, 1 = Fill in EditText, 3 = API output, 0 = send nothing. Newland gives no way to read
    the setting from before, so it is a device-wide change: check what else scans on those devices
    (another app may need 3) before the first rollout.
  - A scan that arrives while the page has no plugin listener is offered as a cancelable
    `vectis-scan` window event; the page takes it with `preventDefault()`, and one nobody takes shows
    "Scan not taken — scan it again". Back is offered to the page first as a cancelable `vectis:back`
    event (the screen uses it to cancel signing in, put down a waiting item, or let go of a location
    that stays set), then steps back through `/scan` pages, and only closes the app after asking.
  - The Hub's login always lands on `/hub`, so inside the app arriving at `/hub`, `/submissions` or
    `/` goes straight back to `/scan`.
  - The offline page (`server.errorPath`) is for the Hub being unreachable or answering 5xx only; a
    Hub 404 or 403 shows the Hub's own page (`ScannerWebViewClient`). Keep
    `android.resolveServiceWorkerRequests` on, or the page the service worker serves offline has no
    native bridge and scans taken straight from the scanner are lost.
  - Scanners need **Android System WebView 111 or newer** (Next 16 / Tailwind v4):
    `android.minWebViewVersion: 111` opens the offline page instead on an older one, which says so and
    doesn't retry by itself.
- **Scanner sign-in cards** (2026-10-16 — Jack: *"Can you give me a QR code to auto sign in please,
  as there's no keyboard"*). Each worker prints a card (Goods In → **Scanner cards**,
  `/tools/warehouse/scanner-cards`) with a QR code; scanning it on `/scan` signs them in, and on a
  shared scanner the next person scans theirs to switch. The rules are `lib/goods-in/scanner-pass.ts`.
  - ⚠⚠ **A card never holds a password.** Its QR is `VSC1-` + 32 random bytes (`crypto.randomBytes`,
    base64url). The Hub stores only the code's **SHA-256** (`GoodsInScannerPass.tokenHash`) and finds
    a card by that hash. The code exists in ONE place outside the scanner: the PDF answered once by
    `POST /api/goods-in/scanner-cards` when the card is made (`lib/goods-in/scanner-card-pdf.ts`, built
    in memory, never saved). Never log it, store it, return it anywhere else, or reprint it — a lost
    card is cancelled and a new one made. Never put a password in a QR code.
  - ⚠⚠ **A card signs in to the SCANNER ONLY** — `/scan` and `/api/goods-in/scan/*`, never the rest
    of the Hub, so a lost or photographed card can't open customers, receipts or anything else. Its
    session is the **`vectis-scan` cookie** (httpOnly, Secure in production, SameSite=Lax, 14 hours),
    `v1.<pass>.<user>.<expiry>` signed with HMAC-SHA256 under a key derived from `AUTH_SECRET` (or
    `NEXTAUTH_SECRET`) and checked with `timingSafeEqual`. It is read ONLY by `getScanUser()` /
    `resolveScanUser()`, and those are used ONLY by the /scan screen and `scanGate()` (the scanner's
    API routes). ⚠ No other page, action or route may accept it — every other Goods In check stays
    `getGoodsInUser` / `requireGoodsIn` / `gate()`, which read the Hub session alone. A card session
    never makes cards. With no auth secret set, no card is issued and no card session counts.
  - **Checked on every request**, fresh from the database: signature and expiry, the card exists and
    isn't cancelled, it is the cookie's person's, and that person still has Warehouse access. A Hub
    session on the same device always wins (so signing in with a card there needs a sign-out of the
    Hub login too). `lastUsedAt` is written at most once an hour.
  - **A Hub login ends an older card session.** When `scanGate()` lets a Hub login in, it clears any
    `vectis-scan` cookie on the device older than two minutes (`dropCardUnderHubLogin` — a younger one
    is a card being signed in with while the Hub login is still being signed out), so the last card's
    person can't come back on /scan once that Hub login signs out. Signing in at `/login` also ends
    any card session on the device first (`endScanSession()` at the top of `loginAction` in
    `app/login/actions.ts`), so a card can't outlast the next person's own Hub login. Never clear it
    from `auth.config.ts` (the proxy's edge config).
  - **Signing in**: `POST /api/goods-in/scan/pass { code }` — 401 with ONE message for a card that
    doesn't exist and one that has been cancelled ("That card has been cancelled or isn't a Vectis
    card."), 403 when its person has no Warehouse access, 503 before Run Migrations or with no secret.
    `DELETE` on the same route signs the scanner out (always 200). Scans carry the card person's id as
    `scannedBy`, exactly as a Hub login's.
    - ⚠ **Only this Hub's own pages** may sign in (`fromThisHub`: `Sec-Fetch-Site` same-origin — or,
      with none, an `Origin` naming this Hub; "same-site" and no sign at all are refused), and only
      with a **JSON** body (415 otherwise), so another site can't post a form that signs someone's
      scanner in to ITS card. Don't add a form branch back. The card-making route uses the same check.
    - ⚠ **The limiter is ADVISORY** — a 256-bit code can't be guessed, so it isn't what keeps cards
      safe. The card is looked up FIRST and a **good card always signs in**: every scanner in the
      warehouse shares one public address, and people scanning an old cancelled card must never lock
      everyone's valid card out. Only bad cards count: after 20 in 5 minutes from one address (the
      LAST `X-Forwarded-For` entry — the one Railway's proxy added; the first ones are whatever the
      client sent) a bad card gets 429 "wait five minutes". In memory, per server. The sign-in screen
      also answers the same refused card scanned again within 10 seconds itself, without asking.
  - **Who may make and cancel**: anyone in Goods In makes one for themselves (Hub login required) and
    sees and cancels their own; a Warehouse manager or admin makes one for anyone with Warehouse access
    **at or below their own tier** (a manager can't make an admin's — a card signs in AS its person)
    and sees and cancels everyone's (`lib/actions/goods-in-scanner-cards.ts` — no codes or hashes in
    it). Old cards keep working until cancelled; cancelling stops a card at once, on every scanner.
    - ⚠ **No card is made while an admin is VIEWING AS someone** (the route refuses and the page says
      so): it would be that person's sign-in, recorded as made by them. Cancelling while viewing as
      someone is allowed and records `"<admin> (viewing as <name>)"`.
    - **Printing**: the page opens a NEW tab inside the tap (iPad Safari) and posts a hidden form into
      it, so that tab loads the PDF itself — the labels screens' way, nothing depending on the Hub tab
      running in the background. ⚠ A tab of its own for EVERY print (never one reused name): a manager
      printing several people's cards in a row must never lose one under the next — it can't be shown
      again. Errors show in that tab as plain text, and nothing is made then. The list catches up when
      the Hub tab is looked at again.
  - **Find on the scanner** reads `lib/goods-in/lookup-core.ts` (Code lookup's own reads), not the
    server actions, because those take the Hub session alone. `lookupCode` (`lib/actions/goods-in.ts`)
    and `goodsAtLocations` (`lib/actions/goods-in-locations.ts`) call `findCode` / `goodsHere` after
    their own access check, so there is ONE copy of the reading — change it in lookup-core and Code
    lookup, Export what's there and the scanner all follow.
    - ⚠ **With a CARD session** the lookup leaves the customer out where the scanner doesn't need it:
      a vendor number answers only that it IS one (no name, no contact id) and a receipt carries no
      customer name; and one card may look up at most 600 codes in 10 minutes (429 after). A lost or
      photographed card must not become a way to walk vendor or receipt numbers to customer names.
      Totes, lots and locations answer as for a Hub login (whose goods they are is the scanner's job).
  - **On the scanner screen** (`app/(scanner)/scan/`, `lib/goods-in/scan-client/`):
    - ⚠⚠ **Card codes keep their case.** `scanner.ts` hands codes over with `tidyCode` (control
      characters and spaces out, case kept); the controller upper-cases ITEMS itself (`cleanCode`).
      Never "tidy" `scanner.ts` back to upper-casing — every card would stop working. The hidden scan
      boxes are `autoCapitalize="none"` for the same reason; a card that arrives all in capitals (a
      scanner set to send capitals) gets its own plain message.
    - ⚠ The client's `CARD_PREFIX` / `CARD_RE` (`lib/goods-in/scan-client/card.ts`) must match
      `lib/goods-in/scanner-pass.ts` — change both together.
    - A card scanned on the main screen is **never an item**: not queued, looked up or shown —
      "That's a sign-in card — press Switch user to sign in as them." Scanned while "Still …?" is up,
      it goes straight to Switch user (after sending the waiting scans), where it's scanned again.
      Its code is never logged, shown or kept; it is sent once, in the body of the sign-in call.
    - **Accepting a card ends any Hub login on the device** (`signOut`, no redirect) before /scan
      reloads, because a Hub login counts first; if that sign-out fails while a Hub login was there,
      the screen says so rather than open as the wrong person. **A password sign-in clears the card
      session** — once the password has been accepted, so a mistyped one signs nobody out.
    - **Sign out** clears the card session and any Hub login, then goes back to /scan's own sign-in
      screen — never `/login` or `/hub`. Either way the last person's saved offline copy is forgotten.
    - **Signed out while the screen is open** (card cancelled or expired, Hub login ended, access
      removed): whichever call hears 401/403 first — a send, the bootstrap or a lookup — stops taking
      scans and reloads /scan (`sessionEnded`), so the card screen appears instead of the last
      person's name. The queue is untouched: the same person signing in again sends their scans;
      anyone else sees "N scans by … still waiting". It stays put with Switch user open instead when
      the scans live only in the page's memory, or when it already reloaded for this in the last 30
      seconds (never a loop). Switch user with scans the Hub won't take from this person any more
      opens the sign-in straight away rather than asking for a send that can never work.
    - **Opened from the saved copy** (no Wi-Fi, so nobody could check who is signed in), the first
      scan or tap asks "Still …?" before anything is recorded against the last person.
  - ⚠⚠ **Run Migrations**: `GoodsInScannerPass` is a new table (in `lib/data-map.ts`). Until it exists
    the card routes answer "Scanner sign-in cards need Run Migrations" and username-and-password
    sign-in on the scanner still works. Nothing was added to `Contact`, `CatalogueLot` or `User`.
  - Registered in `lib/help-map.ts` as **"Goods In → Scanner sign-in cards"**; its keywords all name
    the scanner or the card, never bare "sign in" or "qr code".
- Registered in `lib/help-map.ts` as **"Goods In → Handheld scanner"** — never plain "Scanner", which
  would refuse a cataloguer whose tablet "scanner isn't working" with Goods In.

### 📊 Goods In → Reports: what each warehouse person does, per day (2026-10-20)

Jack: *"I need a tracking page inside of the warehouse called Reports which counts how many scans each
user does per day etc — some nice user tracking like what the cataloguers have."*
`/tools/warehouse/reports` (until now a redirect to History), with a page per person at
`/tools/warehouse/reports/<userId>`: range buttons (Today · Yesterday · 7 days · 30 days · 90 days ·
6 months · 1 year, or a From/To), summary tiles, a per-person table, charts, a CSV export, and each
person's day-by-day figures, hours and latest activity. The numbers are ONE module,
`lib/goods-in/reports.ts` (`parseRange`, `warehouseReport`, `personActivity`, `REPORT_DEFINITIONS`) —
change a definition there, never in a page.

- **Read-only, from what Goods In already records.** Nothing written, nothing sent to or read from
  Business Central. Its one table of its own is `GoodsInScanAck` (2026-10-21), which the handheld
  scanner's failed-scan pop-up fills — the report only reads it.
- ⚠⚠ **Who sees what, decided on the server** (`getGoodsInUser` + `atLeast`): a Warehouse **manager
  or admin** sees everyone; a **warehouse**-tier person sees only their OWN numbers — the same page,
  with the report ASKED FOR with their id only (`onlyUserId`), so nobody else's name or figures ever
  reach their browser — and the per-person page refuses anyone else's id. Filter in the query, never
  by hiding rows on the screen.
- **What counts** (the page's "What the numbers mean" fold-out shows `REPORT_DEFINITIONS`):
  - **Scans** — `GoodsInScanEvent` rows (the handheld scanner) by `userId`, on the day of `scannedAt`;
    **Refused** (outcome refused), **Overtaken** (stale), **Sent late** (reached the Hub more than 5
    minutes after it was scanned — made with no Wi-Fi); **Scanners used** = distinct `deviceId`.
  - **Moves** — `GoodsInMovement` rows by `movedById`, from every screen, on the day of `movedAt`:
    **Put away** (a tote or pallet to a `storage` or `other` location, one with no kind, or one since
    removed), **To bench**, **Lots shelved** (any move with a `lotId`), **Moved in bulk** (the note
    starts "Moved everything from" — counted in Moves as well). The kind is the location's kind NOW
    (`GoodsInLocation`); a move doesn't store it.
  - **Check-ins** — receipts booked in (not `draft`, not `void`) by `createdById`, on the day of
    `createdAt` (Book in's time), with the **totes and pallets booked** on them. A receipt voided
    later drops out.
  - **Failed scans acknowledged** (`acks`, 2026-10-21) — `GoodsInScanAck` rows by `userId`, on the
    day of `acknowledgedAt`: one per failure the handheld's pop-up listed when they pressed "I've seen
    it — carry on". ⚠ COUNTED ONLY — never in Days active, first / last, the busiest hour, the hour
    counts or Scanners used, which are moves, scans and check-ins: an acknowledgement's row has
    `acts = 0` and no device, and the grouped query FILTERs it out of the day count and the times.
    Someone with only acknowledgements in a range is listed with 0 days active, and isn't counted in
    **People active** (people with a move, scan or check-in — as Days active). A day with only
    acknowledgements IS listed in a person's Day by day table (its Acknowledged column), so that
    table's day count can be more than Days active — its note says which days are listed.
    ⚠ Before Run Migrations (`missing` has `"acks"`) the tiles show "—" with "not recorded on this
    Hub yet", and the person page's list says the same instead of "No failed scans acknowledged" —
    never a calm 0 (design rule 7): the scanners are still holding them.
  - **First / last** and the **busiest hour** are over moves, scans and check-ins.
  - ⚠ **A scan that moved something is in BOTH Scans and Moves** (the scanner writes its move under
    the same person, stamped with the scan's time) — they are separate measures, so never add them up
    as one "total". The busiest hour, the hour-of-day counts and the activity list count it ONCE, as
    its move: an applied scan adds nothing to the hour counts, and the activity list shows only the
    refused and overtaken scans, marking a move made on the scanner "handheld scanner". (The list
    also has each acknowledged failed scan, kind `"ack"`.)
  - Grouped by **user id, never by name**. The name shown is the one stored on their latest activity,
    else the User table's. A row with no person id isn't counted.
- ⚠ **London days and hours, worked out in SQL**: `("col" AT TIME ZONE 'UTC') AT TIME ZONE
  'Europe/London'` on the UTC `timestamp(3)` columns; range bounds are London midnights
  (`londonDayStart`) sent as plain UTC timestamps, so the WHERE compares the bare columns. ⚠ Never bucket
  these columns with a single `AT TIME ZONE 'Europe/London'`: on a timestamp WITHOUT time zone that
  reads the UTC value as if it were London time, so through BST every time lands an hour early
  instead of an hour late, and work just after midnight falls on the day before.
- **One grouped query per report** — a UNION ALL of the four sources (moves, scans, check-ins,
  acknowledgements) with GROUPING SETS (person × day, person × hour of day, person) — plus one for the
  activity list. Never a query per person or per day; parameterised throughout. ⚠ UNION ALL matches
  columns by POSITION: a column added to one source's SELECT goes into every source's, in the same place.
- ⚠ **Tolerant of missing tables.** `GoodsInScanEvent` and `GoodsInScanAck` exist only after Run
  Migrations: the report checks with `to_regclass` first and leaves a missing source out — its counts
  are 0 and it is named in `missing` (`"acks"` for the acknowledgements), so the page can say so rather
  than show a quiet zero. Any other database fault throws, and the page says so.
- **Ranges are in the URL** — `?range=today|yesterday|7d|30d|90d|6m|1y`, or `?range=custom&from=&to=`
  (London days, both ends included). The default, and the answer to anything unreadable, is the last
  7 days; a custom range is tidied (swapped, kept to today, at most about three years).
- ⚠ **The per-day chart draws Moves, Scans and Check-ins SIDE BY SIDE, never stacked.** Every scan
  that moved something is also a move, so a stack counted each scanner move twice and made a day on
  the handheld look twice as busy as the same work on Scan to move. **No chart may stack Scans on
  top of Moves, or add them into one total.** Three bars a day get thin, so up to 45 days it is a
  group a day, up to 200 days a group a week (weeks start on Monday), and beyond that a month
  (`day-points.ts`); the part-weeks and part-months at each end count only the days picked, and the
  chart says which it is. A one-day range has no per-day chart (the hour strip covers it). The same
  figures are always in "Show these figures as a table".
- **"Moves a day" / "Scans a day"** in the per-person table and its CSV are the total ÷ Days active
  (one decimal place), shown when the range is more than one day; first and last times only when it
  is one day.
- ⚠⚠ **A warehouse-tier person who opens someone else's per-person page is refused BEFORE that id is
  read** — the refusal names nobody, doesn't say whether the id exists, and links to their own
  page. Their activity list also takes the name out of an overtaken scan's message (it names whoever
  moved the item since — `personActivity(…, { hideOtherNames })`); a manager or admin sees it as
  stored. The same goes for the reason on an acknowledged overtaken scan (it is the Hub's message):
  `hideOtherNames` takes the name out of `ack.reason` as well as the item's words.
- **"Failed scans they acknowledged"** on the per-person page (2026-10-21): every acknowledgement in
  the range, newest first — the barcode, what went wrong, when it was scanned and when they
  acknowledged it (UK time, to the second) — from `personActivity(…, { kinds: ["ack"] })`, asked for
  on its own so a busy day's moves can't push them out of the latest list. Each `"ack"` item carries
  `ack` (code, problem and its words, reason, scanned / shown / acknowledged times); its words read
  *"T026156 didn't scan at 10:42:05 — <reason>. Acknowledged 10:42:31."* The summary tiles, the
  per-person table and the CSVs carry the `acks` count.
- The per-person page is a 404 only for an id with no Hub account AND nothing ever on record in
  Goods In (`personOnRecord`), and only when both reads worked: a former member of staff whose
  account has gone still has a page ("nothing recorded" for a quiet range), and a read that failed
  falls back to "This person" rather than calling a real person's page missing.
- **The CSVs are made in the BROWSER from what the page already holds** (`reports/export.ts`) —
  there is no export route, so there is no second door round the warehouse-tier filter. ⚠ If a
  server export is ever added it must apply the same filter. Every cell through `csvCell`, a UTF-8
  byte-order mark (written as the escape `"\uFEFF"`), Windows line endings, London days as
  YYYY-MM-DD and London times.
- **The pages write NOTHING** — not even an Access Log row. (The Goods In layout still logs anyone
  turned away from the section; a refused per-person page is not logged.)
- **Every fault is an error on the page.** Neither page has a "not set up yet" branch — a missing
  table arrives as `missing` (the amber Run Migrations note), so a "does not exist" that throws is a
  real fault and is shown and logged. ⚠ The module's `isMissingRelation` tolerates a missing TABLE
  only (42P01 / P2021), never a missing column: every column it reads was in its table's first
  CREATE TABLE, so a missing column can only be a bug and must not look like "needs Run Migrations".
- **Loading screens** (`reports/loading.tsx`, `reports/[userId]/loading.tsx`) say the figures are
  being worked out while a range or a person opens — without them a long range left the old figures
  up as if the tap had done nothing. Keep them.
- **Speed.** The report reads by date range through `GoodsInReceipt(createdAt)`,
  `GoodsInMovement(movedAt)` and `GoodsInScanEvent(scannedAt)` indexes (the last two added 2026-10-20,
  migration `20261020120000_goods_in_report_indexes` — until Run Migrations it still works, it just
  reads those tables whole). The scan reads also add an always-true `receivedAt` bound (with a day's
  margin for clock difference — never tighten it) so the `(userId, receivedAt)` index narrows a
  one-person read. Acknowledgements are read through `GoodsInScanAck(acknowledgedAt)` and
  `(userId, acknowledgedAt)`, made with the table.
- **It is staff monitoring.** It is on the staff-monitoring lists in Admin → Data & Compliance and
  the DPIA. Keep it to work activity, and keep the warehouse-tier filter.
- Registered in `lib/help-map.ts` as **"Goods In → Output by person"** — never "Reports" or
  "Warehouse reports" as the name: a name part scores as a word, and a BC Reports or Cataloguing
  Reports user asking for "the reports" must not be refused with Goods In. Its keywords name Goods
  In, the handheld or the warehouse's people — no bare "warehouse report" or "warehouse tracking",
  which a BC Warehouse user could ask about their own screens.

---
## 👥 Customers — the Hub's own customer database (2026-10-20)

The first step of the Hub taking over the whole business from Business Central (Jordan, 2026-10-20 —
*"we are now starting to plan for the hub taking over the entire business"*). `/tools/customers`,
the Customers card in Admin & Operations, its own app permission **`CUSTOMERS`** (admins
automatically; anyone else is ticked in Users & Permissions). The old test Contacts page (`/contacts`)
redirects here; the `Contact` table itself stays — Submissions use it.

- **One row per PERSON** (`Customer`): seller (`vendorNo`, BC's C…), buyer (`buyerNo`) or both,
  keyed on BC's contact number — the same shape BC uses (a Contact linked to a Vendor and/or a
  Customer). Delivery addresses are `CustomerShipTo`. **NEEDS Run Migrations**; until then the page
  says so and the copy refuses to start.
- **Filled from BC every night** (`lib/customer-sync.ts`, `POST /api/customers/sync`, run as a stage
  of the 5am FULL BC copy in `/api/cron/bc-warehouse`, and by the admin-only **Copy customers now**
  button). Five read-only Evo feeds under `api/evo/base/v1.0` — `contacts`, `vendors`, `customers`,
  `webCustomers`, `shipToAddresses` (AL pages 75609/75608/75607/75615/75627 in Evo-auction Base) — one
  page per call, the caller drives the loop (design rule 7b).
- ⚠ **BC is in charge until switch day:** every column that came from BC is overwritten on the next
  copy, so nothing is edited in the Hub yet. The contact owns the person's details; a seller or buyer
  feed only fills gaps (`gapsOnly`). Every field each feed sent is kept whole in `bcContact` /
  `bcVendor` / `bcBuyer` / `bcWeb` (Jordan: keep everything, "better to have it than not").
- **`attachAccount` puts a seller/buyer number on ONE row**: its contact's row if BC links one, else
  the row already holding the number, else a new row. A number found on a different row from its
  contact's is moved, and a stub that held nothing else is deleted. Proven against a fake database
  (stub merge, BC moving a seller to another contact, gap filling) before shipping.
- **Two more stages read BC's CARDS** (published ODataV4 services found with "What does BC publish?"):
  `Contact_Card_Excel` (ID / anti-money-laundering checks, approvals, date of birth, nationality, first
  name/surname) by contact number, and `Vendor_Card_Excel` (the seller's terms — entry fee, unsold and
  withdrawn charges, introduction commission, every "never charge" setting) by seller number; a supplier
  who isn't an auction seller is skipped. Kept whole in **`CustomerBcCard`** — its own table, so the
  copy and the pages work before Run Migrations. ⚠ `noBank()` drops every field whose name mentions a
  bank before storing. The person page shows the main fields in plain words (Seller terms, ID checks).
- ⚠⚠ **Changes only, and it carries on** (2026-10-21 — a copy spent four hours re-reading what it
  already had, then a Stop sent it back to the start). **`CustomerSyncState`** keeps, per stage, `since`
  (when its last COMPLETE pass began, less 10 minutes) and `nextLink` (where an unfinished pass got
  to). **Copy changes** asks BC only for rows changed after `since` (`changedSinceFilter`:
  `systemModifiedAt` on the Evo feeds, `LastDateTimeModified` on the Contact Card, `Last_Date_Modified`
  — a date — on the Vendor Card); **Copy everything** reads it all; **Carry on** restarts the first
  unfinished stage from its saved link. If BC refuses a date filter, that stage reads everything and
  says so. The nightly copy is changes-only, and everything on **Sundays** (BC can change a field
  without stamping it as changed). Every pass's first page asks BC's `$count`, so each stage shows
  "X of Y". **Stop asks first.** Until Run Migrations the copy still works but can't remember.
- ⚠ **Bank details are never stored** (they go to Sage), same rule as Goods In.
- **Data check** tab: counts, likely duplicates (same email on several records), missing email /
  postcode, delivery addresses with no buyer here — the tidying to do before anything depends on it.
