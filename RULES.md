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
- ⚠ **The build's memory is set in `package.json`'s `build` script** (`--max-old-space-size`), not the
  Dockerfile — the Dockerfile's `NODE_OPTIONS` is what the RUNNING server gets. The type-check inside
  `next build` grows with the code: 2 GB (Jordan, 2026-04-15) was outgrown on 2026-10-26, when the
  Refunds push failed both deploys with *"JavaScript heap out of memory"* during "Running TypeScript"
  (a full type-check then used ~2.3–2.8 GB). Raised to 4 GB. A deploy that fails ~4 minutes in with no
  code error from a local `next build` is this — run the local build with the same limit to confirm.

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

## Public refund form — a deliberate exception (2026-10-26)

`/refund` (Accounts → Refunds) is reachable **without logging in**, on purpose: it is the Hub's own
replacement for the Microsoft Form customers reach from vectis.co.uk (Jack, 2026-10-26: "the form link
will need to come out of the hub instead of using the Microsoft form"). Requests land in
`/tools/refunds`, admins only.

It is allowed to stay public **only because of these constraints. Keep every one of them:**

- **EXACT-match allowlist entry, not a prefix** — `"/refund"` in `publicExact` (`auth.config.ts`), like
  `/first-aid`. ⚠ Never move it into the prefix list.
- **Top-level route (`app/refund`), never inside `app/(app)`**, and **no links from it into the Hub**.
- **No public GET endpoint, nothing read back.** The page shows no record. `?sent=1` / `?problem=<word>`
  (the route's answer to a browser that sent the form without its script) are fixed words only —
  nothing the customer typed is ever put in an address. The `<form>` keeps `method="post"` +
  `encType="multipart/form-data"` + `action="/api/public/refund-request"` for that reason.
- **One unauthenticated write**: `POST /api/public/refund-request` (already-public prefix). Write-only —
  it answers `{ok:true}` and nothing else: not the id, not the RF number (it's sequential and would
  give away how many requests Vectis has had). Honeypot `hp_ref` and >10 an hour from one address →
  saved but flagged suspect, never refused. Hard refusals only for floods: 60 attempts an hour per
  address counted before the body is read, 3 requests in flight at once, 30 saved an hour per
  address, 300 an hour overall. The address is the LAST X-Forwarded-For hop (Railway's), **hashed
  with `AUTH_SECRET`, never stored raw**.
- **Photos live under `refund-photos/` in R2 and are only ever opened through the admin-only
  `/api/refunds/photo`.** ⚠ Never add `refund-photos/` to `/api/public/photo`'s prefix list.
- `Refund` rows are only ever read inside the Hub, behind the admin check. Never bank or card details:
  the form refuses them (`looksLikeBankDetails`), and the old-log import takes them out of every cell
  before saving.
- ⚠ The Hub's general photo routes (`/api/image`, `/api/catalogue/signed-url`, `/api/catalogue/photo-proxy`)
  sign or stream any key for anyone signed in, so each REFUSES a key starting `refund-photos/` — a
  customer's damage photos are for admins only. Keep that guard on any new route of that kind.

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

1. Find the customer in the Hub's customer database (`Customer` — every BC customer). Until switch
   day a new person is added in BC first, then **Fetch new customers from BC** (next section).
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
    changed any of it last are ONE new table, **`GoodsInAgreement`** (one row per customer, cascade —
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
  - A Goods In customer **is** a `Customer` row (the Customers section — since 2026-10-23; the CRM
    `Contact` before that). `GoodsInCustomer` holds only the Goods In half (the Hub-given vendor
    number and the fees), one row per customer; their reserve,
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
- Check in opens with a customer already chosen from `/tools/warehouse/check-in?customer=<customer id>`
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

### 🗄 BC's receipts and totes copied INTO Goods In — BC first until switch day (2026-10-23)

Jordan: *"we need a similar thing for warehouse … pulling into its own separate section ready for a
transition so one day that is taken over in the hub that's searchable and editable"*, and chose
**one database, like Customers** over a separate read-only section on the BC copy tables. So
Business Central's receipts and totes are copied INTO `GoodsInReceipt` / `GoodsInContainer` every
night, and Goods In's Receipts list, Find, the handheld's lookup and the customer pages show BC's
and the Hub's together. Migration `20261023170000_goods_in_bc_source` (**NEEDS Run Migrations** —
⚠ between the deploy and the banner, check-in saves fail: Prisma reads the new columns back).

- **`source`** on both tables: `"bc"` = copied from BC; null / `"hub"` = booked in the Hub
  (`lib/goods-in/source.ts`: `isFromBc`, `HUB_MADE`, `FROM_BC`). `bcSyncedAt` = when the copy last
  touched it, `bcData` = everything BC's copy had. A BC row is keyed on BC's own number (R…, T…, P…).
- **The copy** is `lib/goods-in/bc-mirror.ts` (`mirrorBcPage`): it reads the Hub's OWN BC copy
  tables — `WarehouseTote` + `WarehouseReceiptTote`, filled by the BC Warehouse Data Sync — **never BC
  itself, and writes nothing to BC** (the Goods In rule stands). One page (1,000 totes) a call, keyset
  on the tote number; the nightly `/api/cron/bc-warehouse` drives it after the tote stages
  (changes-only on an incremental run, everything on the 5am FULL), and Goods In → Settings →
  **Business Central's receipts & totes** has Copy changes / Copy everything with a count that moves
  and a Stop (design rule 7b; actions in `lib/actions/goods-in-mirror.ts`, route
  `/api/goods-in/bc-mirror`). Runs are `WarehouseSyncLog` rows, source `goods_in_mirror`.
  - ⚠⚠ **A row booked in the Hub is NEVER written over**: the `INSERT … ON CONFLICT` updates only
    rows whose `source` is already `"bc"`. A BC number landing on a Hub row is counted and named
    (`hubClashes`) — the series carry on from BC's, so it means a series was set too low.
  - A tote on no receipt in BC (a shell tote, ~1,600) is skipped — a container must sit on a receipt.
    Nothing is ever deleted: a tote gone from BC keeps its row, its `bcSyncedAt` stops moving.
  - Worked out, not copied: a receipt's status (every tote catalogued → closed, else open — BC has no
    receipt status); a tote's (BC's catalogued tick → catalogued; at a location the Hub knows → that
    kind's status; an unknown code → stored; no location → booked). `movedAt` stays null (BC gives no
    time) — the screens say "as at the last BC copy". The receipt's `customer` snapshot is only the
    seller's name and number; its `person` is the Customer with that `vendorNo`, when there is one.
- ⚠⚠ **BC rows are read-only until `WAREHOUSE_OWNER=hub`** (`HUB_OWNS_WAREHOUSE` in
  `lib/customers/ownership.ts` — the same switch pattern as customers). Refused with
  `BC_OWNS_WAREHOUSE_MESSAGE`: `addContainers`, `updateContainer`, `updateReceipt` (notes, close,
  void) and `markReceiptSent` for printing/emailing; and **moving a BC tote** — `moveItem` refuses
  (Scan to move, the handheld, Check what's here), `moveEverything` leaves BC totes where they are.
  BC wouldn't know about a move made here, and the next copy would write BC's location back. **Tote
  labels CAN be reprinted** from the Hub. The receipt page shows a BC receipt whole with a From BC
  badge and no edit controls; the Receipts list has a **Booked in: Anywhere · In the Hub · In BC**
  filter. On switch day the flag opens them all up — nothing to migrate.
- **The dashboard's figures count Hub-made rows only** (`HUB_MADE`) — 9,000 BC receipts would swamp
  "booked today" and the status tiles — with one line under them saying how many came from BC and
  when; Settings' "last given" numbers read Hub-made rows too. The Customers hub's Receipts tab lists
  Goods In's receipts with a From BC badge beside the BC-copy receipts it already showed.
- **Goods In → Totes & pallets** (`/tools/warehouse/totes`, 2026-10-23 — Jordan: *"I want to see that
  warehouse database fully filterable editable and searchable"*): every tote and pallet, Hub and BC, in
  one list. The filter lives in the URL and is read, written and turned into the Prisma query by ONE
  module, `lib/goods-in/tote-list.ts`, which the page AND the CSV export (`/api/goods-in/totes/export`,
  streamed 2,000 rows at a time, ≤ 50,000) share — so the export is exactly what's on screen. Side
  filters with counts ("what you'd get if you picked this": each facet counted with its own choice
  cleared), sortable columns, 100 a page. Rows are edited in place through `updateContainer` — so a BC
  row is editable only when `HUB_OWNS_WAREHOUSE`, and the row says why not. Totes on voided receipts
  and unfinished check-ins are left out unless "Include voided and unfinished" is ticked. Help box:
  "Goods In → Tote list" (never "Warehouse" or "Stock" in the name).
- Known limits: a BC tote's location can be a day old (the copy is nightly), so a location holding
  only BC totes can't be removed until the next copy agrees it is empty; movements aren't mirrored
  (BC Warehouse → Location History still answers); lots are untouched by this (WarehouseItem,
  CatalogueLot and the BC Database page stay as they are).

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
redirects here; the `Contact` table itself stays only for the old test submissions and receipts that
point at it — since 2026-10-23 Submissions and Goods In use `Customer` (below).

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

### The customer section as the admins' central hub (2026-10-23)

Jordan: *"this is a very important part of the hub for admins — a central hub, CRM type notes, find
everything from this one customer section"*. He picked, from four mock-ups: the list with **side
filters and a preview drawer** (the filter panel collapsible), and the customer page with **tabs**.

- ⚠ **A person has ONE number.** BC's contact no. IS the vendor no. and the customer no. for all but
  a few dozen of 208,000 people. The list shows one "No." column (the contact no.; a different
  seller or buyer number is named under it), the page shows it once in the header. Don't bring back
  separate Seller no. / Buyer no. columns. (They had also been INVISIBLE on the dark theme — cells
  with no text colour — which is what "always blank" turned out to be.)
- **The list** (`page.tsx` → `customers-list.tsx`, client): every filter is in the URL
  (`lib/customers/filters.ts` parses and writes it), so Back and a shared link keep it; the server
  runs the query (`lib/customers/queries.ts`). The filter panel's open/closed state is per device
  (localStorage). Tapping a row previews the person on the right — row data plus
  `/api/customers/[id]/summary` (latest notes, ID status) — without leaving the list. Default
  sort: newest customer number first. Sorting by a COUNT (lots, receipts, activity) groups the whole
  table once, never a count per row; the page's own counts are read for its 100 rows only.
  - ⚠ **Measured before building (production, 2026-10-23):** the per-row receipt and lot counts were
    **7.9 s a page** without indexes on the vendor-number columns — hence
    `WarehouseItem(vendorNo)`, `WarehouseReceiptTote(vendorNo)`, `WarehouseTote(vendorNo)`,
    `CatalogueLot(vendor)` and `Customer(contactNo / vendorNo / buyerNo)` in the migration. And
    scanning BC's card JSON for a flag (`"contactCard"->>'EVA_HighRisk'`) took **2.8 s**, so there is
    NO high-risk / trusted-seller / ID-not-checked filter yet — those wait until the flags are copied
    into columns. Department-they-sell-in and saved views are also later steps.
- **Notes & calls — `CustomerNote`** (**NEEDS Run Migrations**; its own table, cascade). Kinds note /
  call / email / visit, an optional follow-up date (stored at 12:00 UTC on its London day), who wrote
  it. Anyone with CUSTOMERS may add; delete is the author's or an admin's. Actions in
  `lib/actions/customer-notes.ts` return `{ ok, error, notReady }`. ⚠ Bank or card details are
  refused (`looksLikeBankDetails`) — the standing rule. Until Run Migrations every screen says notes
  need it; the list's notes filters are disabled; nothing crashes.
- **Access** is `getCustomersUser()` / `requireCustomers()` in `lib/customers/access.ts`: the
  EFFECTIVE session, permissions read fresh from the database — the Help box's three guards. The
  summary API route checks it itself (the proxy skips `/api`).
- **The customer page** (`[id]/page.tsx`): header (name, the number, Seller / Buyer / Website /
  Blocked badges, contact line), key figures (receipts, totes, lots in BC + lots in the Hub not yet
  in BC, hammer total, paid-not-collected, last contact), then tabs by `?tab=`: Overview (contact,
  latest notes with a composer, **Needs attention**, recent receipts and lots) · Notes & calls ·
  Receipts & totes · Lots (by sale, paged) · Buying · Website account · ID checks & terms ·
  Everything BC sent. "Needs attention" is worked out, never stored: blocked, open paid-not-collected
  cases, unsold lots still here after their sale (`hammerPrice` 0, `collected` false, sale date
  past), follow-ups due, lots in a sale to come, Hub lots not yet in BC, an ID status other than
  Valid, screening expiry.
- ⚠ **"What they have bought" isn't here yet**: the BC lot copy (`WarehouseItem`) carries no buyer
  number. The Buying tab says so. Adding `EVA_BuyerNo` to that copy is the next copy change.
- Nothing on these screens writes to BC or edits a BC-owned detail; the page says details change in
  BC until switch day.

---
### Goods In and Submissions use `Customer` — BC first until switch day (2026-10-23)

Jordan: *"The submissions and goods in needs to use this new customer database"*, then *"BC first:
Goods In picks from the BC customers; new people are created in BC then copied in. Build it so the
Hub can take over at switch day."* Migration `20261023150000_customers_one_record` (**NEEDS Run
Migrations**): `GoodsInCustomer` and `GoodsInAgreement` are keyed on `customerId`; `GoodsInReceipt`
and `Submission` gain `customerId` (their old `contactId` stays, nullable, for the test rows).

- **The switch is ONE variable:** `CUSTOMERS_OWNER=hub` on Railway → `HUB_OWNS_CUSTOMERS`
  (`lib/customers/ownership.ts`). Unset (now): BC owns the details — `saveCustomer` refuses, the
  Goods In customer page has no Edit, and the check-in picker's "+ New customer" is **"Not on the
  system?"**: a panel (`_components/bc-first-panel.tsx`) saying add them in BC, then **Fetch new
  customers from BC** (`pullRecentCustomersFromBc`, `lib/actions/customers-pull.ts` — the nightly
  copy's own `copyCustomerPage` over the four person feeds, rows changed in the last 3 days, ≤ 20
  pages a feed, the background BC sign-in; nothing written to BC). Set to `hub`: the Hub's own form
  adds and edits, and new people get `Customer.source = "hub"`.
- Goods In searches the whole Customer table (name, name2, email, postcode, address, phone/mobile
  digits, contact / vendor / buyer number) — `searchCustomers` and the Customers list's
  `searchWhere`. `vendorNoOf()` = BC's `Customer.vendorNo`, else the Hub-given
  `GoodsInCustomer.vendorNo`. The list shows ONE number (the Customers rule).
- **A receipt's `person` is the Customer** (`GoodsInReceipt.person`); `customer` (JSON) stays the
  printed snapshot. `personName(p, snapshot)` falls back to the snapshot, then "(customer not on
  record)". The PDFs take `PERSON_FOR_PDF` + `personFallback()` (`lib/goods-in/customer-row.ts`).
- ⚠ **Submissions are the one place the Hub makes a customer before switch day**: an enquiry is
  matched to a Customer by EMAIL, else a **Hub prospect** is made — `source = "hub"`, no contact
  number (`lib/customers/prospects.ts`). The nightly copy's contacts phase ADOPTS a prospect when BC
  gets a contact with that email (BC's record is written onto the row, `source` → "bc", counted as
  `merged`), so the submission follows them. Submissions screens read `whoFor()`
  (`lib/customers/who.ts`): the Customer first, the old Contact second.
- The Customers hub person page has a **Fees & agreement** tab (the same `FeesAgreement` component)
  and lists their Goods In receipts; the Goods In customer page links "Open in Customers →".

---
## 📦 Accounts → Paid, not collected (2026-10-22)

Jack: *"a new panel inside the Accounts section to track people who pay and are not collecting —
make the framework for now"*. `/tools/accounts/uncollected` (the 📦 card under Reserves on the
Accounts page, and — since 2026-10-23 — its own **"Paid, not collected" tile in Admin & Operations**
on the Hub home, card key `UNCOLLECTED` in lib/app-cards.ts, admin-only like the panel: no appKey),
a case page per buyer at `/tools/accounts/uncollected/<id>`. One case = one buyer
who has paid (an invoice, or a sale's worth) and hasn't collected their lots: who they are, the
sale and invoice, lots and £ paid, when they paid, where it stands, the next chase date, when
storage charges start, and a timeline of every call, email, letter, note and change.

- **Admins only, exactly like Reserves.** The pages use `getAccountsAccess()` (`!canAccess` → `/hub`,
  `!isAdmin` → `/tools/accounts/simple`), and **every server action re-checks admin on the server**
  (`lib/actions/uncollected.ts`). A non-admin granted Accounts never sees it, and neither does the
  Help box (`adminOnly` in `lib/help-map.ts`).
- **One module for the words** — `lib/uncollected.ts` (a plain, client-safe module: no Prisma):
  statuses with their labels, help text and colours (`STATUS_META`), age bands (`AGE_BANDS`),
  London-day helpers, the shapes the actions return, and the URL filter
  (`parseUncollectedFilter` / `uncollectedFilterQuery`). Change a label or a band there, never in a
  page. ⚠ The server's SQL age-band filter is built from `AGE_BANDS` and repeats `daysWaiting()`'s
  rule — change the two together.
- **Statuses:** `waiting` (Paid — waiting to collect) · `contacted` (We've been in touch) ·
  `arranged` (Collection or delivery arranged) · `storage` (Storage charges apply) · `collected`
  (closes the case) · `closed` (Closed another way — refunded, re-offered — **needs a reason**).
  Collected/closed set `closedAt`; going back to an open status clears it. Choosing Storage on a case
  with no storage start leaves it to the storage rule when there's a paid date (the status line says
  "storage counted from …", ⚠ never "storage charges from" — see Storage charges below), and starts
  the charges today only when there's no paid date to count from. A call, email or letter logged on a `waiting` case moves
  it to `contacted` (said on the timeline). A status change only wins if the case is still where it
  was read, so two people changing it at once can't both win.
  - A status in the table that isn't one of the six (a future feed's typo) **reads as `waiting`
    everywhere** — `statusOf()` on the screen, the same `CASE` in the list's SQL, and "open" is
    defined as *anything but collected / closed* for the tiles, the Accounts card and the invoice
    check. So it is listed, counted and chased, never vanishes from every chip; an amber line on the
    panel says how many there are (`totals.unknownStatus`) so someone picks the right one.
- **Days waiting = today − the day they paid, in London days**, frozen on the day a case closed;
  no paid date = no days and no age band. Bands 0–7 · 8–14 · 15–30 · 31–60 · Over 60 (61 and up —
  the key stays `60+`, the label says "Over 60 days" so day 60 is plainly in the band before). Date-only values
  (paid on, next chase, storage from) are stored at **12:00 UTC on their London day**, like the Goods
  In signed-terms day, so they read as the same day all year. The tiles (open cases, lots and £
  waiting, oldest wait, chases due today/overdue) are over every OPEN case, whatever the filters.
- **Actions return `{ ok, error }`** (`UncollectedResult`); a missing table answers `notReady: true`
  with "needs Run Migrations" and the page says so — never crashes. `countOpenCases()` (the Accounts
  card's number) never fails, and never passes off "couldn't tell" as 0 (design rule 7): `ready:
  false` before Run Migrations (the card says "Needs Run Migrations"), `error: true` when the count
  couldn't be read ("Couldn't count just now").
- **Tables `UncollectedPaid` + `UncollectedPaidEvent`** (cascade), and `UncollectedSyncRun` (the BC
  check's runs, below) — **NEEDS Run Migrations**. Their own tables; nothing added to `Customer`,
  `Contact` or `User`. `customerId` is a plain id (no
  foreign key), filled when the buyer number matches a Hub **Customers** record (read tolerantly from
  the Hub's own copy — never BC).
- ⚠⚠ **Filled from BC automatically — and BC is READ ONLY** (2026-10-22 — Jack: *"so it triggers
  4 weeks after they paid for us to chase … only paid things that haven't been collected for over 4
  weeks"*). `lib/uncollected-feed.ts` — `findPaidUncollected` reads BC, `syncUncollected` writes the
  cases — with its pure matching rules in `lib/uncollected-feed-match.ts` (checked with made-up data,
  no BC, no database). Every BC call is a GET through `lib/bc.ts`. **Nothing is ever written to BC.**
  Cases can still be added by hand (`source "manual"`).
  - **The rule.** A case is due when ALL hold: a lot was **sold** (hammer > 0, not withdrawn); the
    buyer's **invoice covering it is Paid with nothing remaining**; the lot is **not gone** (next
    point); and at least **`UNCOLLECTED_AFTER_DAYS` (28) London days** have passed since the
    paid day. **One case per invoice**, `bcKey` = the invoice number (SI167361). Sales of the last
    `UNCOLLECTED_LOOKBACK_MONTHS` (12) are read. Both constants are in `lib/uncollected.ts`.
  - ⚠⚠ **"Gone" = BC's Collected tick OR the lot's LOCATION** (2026-10-23 — Jack, on sandbox: *"This
    first one is wrong — lot 513 has been collected and so has 551"*). `Auction_Lines_Excel.EVA_Collected`
    is a FlowField on the lot's `EVA_CollectionLine."EVA_Posted"` (not reversed) — it is ticked ONLY
    when the collection docket is **posted**. In practice staff often hand the lots over and **scan
    them to location `COLLECTED` without posting the docket**: the dockets (COL034753, COL039287,
    COL049651…) stay open in `CollectionList` as "Awaiting Release", never posted, while the lots'
    receipt lines say `EVA_ArticleLocationCode = "COLLECTED"`. So the tick alone is NOT trustworthy,
    and the check also reads each lot's current location live from **`Receipt_Lines_Excel`**
    (`EVA_UniqueID`, `EVA_ArticleLocationCode`, `EVA_ArticleBinCode`; `EVA_UniqueID eq '…' or …`, ≤ 20
    ids a call). The lists are constants in `lib/uncollected.ts`, compared upper case with spaces out
    (`normaliseLocation`; "-" and "_" ignored too):
    - **`GONE_LOCATIONS` = COLLECTED, SHIPPED, QUERY, RETURNED, DISPOSAL, CHARITY** — ⚠ QUERY since
      2026-10-23 (Jack: *"anything in query, shipped and collected should be gone and shouldn't be on
      here"*; it was a query location until then) — treated **exactly like
      the tick**: the lot is taken out before matching (`splitByPlace`), so it isn't charged or
      counted; a case with some gone keeps the rest ("lots not collected 2 → 1"); a case whose lots
      have ALL gone drops out and is closed as collected by the re-check below, its event naming the
      locations seen ("BC shows the lots collected (location COLLECTED)" — `collectedWhyWords`).
    - **`QUERY_LOCATIONS` = MISSING, RE-LOTTED, RE-AUCTION** — **not charged and not counted** in
      the case's lots or storage, but the lot still finds its invoice (`Candidate.queryLots`; a case
      may have only these — then `lots` is 0) and the case is **flagged** on its timeline: a note from
      the check, *"⚠ Lot 513 is at MISSING in BC — check it before chasing. …"* (`queryFlagText`),
      written only when the lots to check change (`nextQueryFlag` reads the check's last flag line —
      one starting "⚠ " — or its all-clear, "✓ No lot on this case is at a query location in BC now …",
      written once when they've all moved on). ⚠ Those lines must never contain "storage charges
      from", "paid by" or "BC no longer shows invoice" (other readers of the timeline look for them).
    - Anything else (a shelf like 12F1, a bench, SANDOWN, blank) — still here. **A tick always wins**
      over a location.
    - ⚠ **A lot whose receipt line can't be read** (no unique ID, no receipt line, rows that disagree)
      **is judged on the tick alone, as before**, and the run's notes say how many and why. So is every
      lot once BC **refuses** locations outright (400 to a single id, 401/403/404): that stops the
      location reads for the rest of the run (`placesBroken`, `PlacesRead.refused`) and makes the run
      `ok` false ("didn't check everything").
    - ⚠⚠ **But a buyer whose locations BC didn't ANSWER for** (no answer, 5xx / 429 after the retries —
      `PlacesRead.failed`), **or weren't read because the time ran out or a Stop came** (`timedOut`),
      **isn't judged that run at all** (like an unread invoice: no candidates, its dropped cases not
      re-checked, the run's notes say so) — never judged on a half-read. (2026-10-23, the review:) on the
      tick alone a passing fault flipped cases — "lots not collected 1 → 2" with a higher storage figure
      on the bad night and "2 → 1" the next, and a buyer whose lots were all at COLLECTED got a case the
      next run closed — Jack's bug back on any night BC stumbles. Holding the buyer keeps each case's
      last known state. ⚠ **A decision for Jack** — the brief said "can't be read → trust the tick";
      this applies that only to a lot BC really has no location for, or a run where BC refuses them.
      If he'd rather a failed read fell back to the tick too, put those ids in `refused` (placesFor).
    - ⚠ **Locations are read buyer by buyer, straight after the last of that buyer's invoice lines**
      (`readLinesThenPlaces` in lib/uncollected-feed-match.ts — never all the lines first, then all the
      locations). With them read after every invoice's lines, a run whose time ran out during the lines
      had no time left for any location, so it judged no buyer at all, and runs that kept running out
      never added, updated or closed a case. Now every buyer whose lines and locations were both read
      is judged, and the rotation (below) moves the start on. Still at most 3 BC calls at once.
    - Locations are read only for buyers with an invoice that could give a case
      (`invoicesNeedingLines`), for the lots BC hasn't ticked on each case the check re-checks, and for
      every lot on the case page's list. The run's notes count the lots found gone by location and at a
      query location ("COLLECTED 120, SHIPPED 3").
  - **What BC is asked** (all verified live 2026-10-22 with the BC API viewer): (1) `Auction_Lines_Excel`
    — `EVA_Collected eq false and EVA_HammerPrice gt 0` with `EVA_AuctionDate` from 12 months ago to
    28 days ago (a lot paid 28 days ago was sold at least that long ago), `$select` of verified fields
    only, paged by `@odata.nextLink`; (2) standard `api/v2.0` **`salesInvoices`** for those buyers
    (`customerNumber` = `EVA_BuyerNo`; ≤ 20 buyers a call, dated from their earliest uncollected
    lot's sale); (3) **`salesInvoiceLines`** (`documentId eq …`, ≤ 20 invoices a call — one at a time
    if BC refuses the batch, and any invoice a batch answered with no lines is asked again on its
    own) for the invoices that matter; (4) **`Receipt_Lines_Excel`** for where those buyers' lots are
    now (verified live 2026-10-23 — above; one at a time if BC refuses the batch; each buyer's read
    straight after its invoice lines). ≤ 3 calls at once, backoff on 429 / 502 / 503 / 504, a 401
    renews the sign-in once (the company lookup's "BC API companies 401" too), and a time budget for
    reading BC: **25 minutes for the nightly run, 20 for Check BC now** (12 until 2026-10-26, when BC on
    a Monday morning was slow enough that 12 read only half the buyers) — never more, under the
    30-minute stale rule below; saving stops 28 minutes in (`SAVE_STOP_MS`), whatever is left, so a
    run always ends before a second could be let in.
  - **Each run starts at a different buyer** (`rotate`, by the run's sequence number — the count of
    `UncollectedSyncRun` rows, kept in the database so a restart doesn't reset it). A run that runs out
    of time leaves a different stretch unread, so runs that keep running out still reach every buyer.
  - **Which lots are on which invoice.** A buyer invoice has a line per lot (its description) followed
    by **"Buyer Premium for Lot No 366"** (codeunit 75003 CreateSalesInvoice's `BuyersPremiumTxt =
    'Buyer Premium for Lot No %1'` — checked in the BC source 2026-10-23), so its lots are the numbers in those premium lines (suffix
    tolerant: 366 matches 366A unless both carry different suffixes). ⚠ **Lot numbers repeat between
    sales**, so each uncollected lot has ONE home: the buyer's **earliest** posted invoice dated on or
    after its sale that lists its number. A dealer's lot 366 left in F066 must never also hang on
    F067's paid invoice because F067's lot 366 (collected) is on it. **Exact first** (`assignHomes`):
    the earliest invoice listing its number AND suffix; only when none does, the earliest listing it
    suffix-tolerantly — so 366A is never hung on an earlier paid invoice listing plain 366, a different
    lot. ⚠ A premium line's number may be grouped in thousands ("Lot No 1,234" — AL's `Format()` of an
    integer does that) and is read whole (`lotRefFromText`), never as lot 1. Drafts, invoices in review and
    cancelled invoices are never a home. A paid lot invoice whose lines carry no readable lot numbers
    falls back to the buyer's unhomed uncollected lots from their latest sale on or before it (named
    in the run's notes and on the case's first event); an invoice with no lot lines at all (postage,
    storage) is skipped. ⚠ That "latest sale" is chosen over the buyer's lots at a GONE location too
    (`matchBuyer`'s `opts.gone` — only to choose the sale, never matched): when that sale's lots have
    all gone, the invoice gives **no case**, never a walk back to an older sale's lots (an unpaid
    earlier invoice's, say). Lots BC TICKED collected aren't in the feed at all, so a sale whose lots
    are all ticked can still be walked past — known, as before.
  - ⚠ **The paid date is a PROXY until BC publishes its own.** BC's published feeds carry no payment
    date. On a paid invoice `lastModifiedDateTime` matches BC's settling run (a batch at ~07:54 the
    morning after), so that London day is stored as `paidAt` and shown as **"Paid by (BC settled
    date)"** — they paid on or before it (`PAID_BY_HELP`). Caveat: anything else that changes a posted
    invoice later moves the day later, so a case can be added late, never early.
  - **The exact paid date — the upgrade path (verified in the BC source code on the Hub, 2026-10-23).**
    BC holds it per lot: table 75004 `EVA_AuctionLine` **field 153 `EVA_DatePaidByBuyer`** (Date), set
    by codeunit 75075 ReleaseForPayment from the customer ledger entry's "Closed at Date" and cleared if
    the payment is reversed. It is **not on any published feed** (`Auction_Lines_Excel` / `EVA_AuctionLine`
    have 59 fields, none of them a paid date), and the pages that show it (75063 Auction Reconciliation,
    75050 Editable Auction Lines, 75096 ClientAccMgtAuctionLines, 75014) aren't published. **What
    Jordan needs to do:** add `EVA_DatePaidByBuyer` to the `Auction_Lines_Excel` web-service page (or
    publish one of those pages and tell us which). Nothing in the Hub needs changing when he does:
    - Once per run the check reads **one** `Auction_Lines_Excel` row **with no `$select`** and looks
      for the key (`paidDatesPublished` / `hasPaidDateField`). Only if it is there is it added to that
      run's `$select`. ⚠⚠ **Never put a field in a `$select` before a row has shown it** — BC answers
      400 to the WHOLE request over one unknown field, and the check would read nothing.
    - With it, a case's paid date is **the latest of its lots' own paid dates** (`paidDayFor` — the day
      the invoice was paid in full), and the 28 days count from that (`couldQualify` lets an invoice
      whose lots' own date is old enough be read even when its settled date isn't yet; `matchBuyer`
      then checks again on the lots really on it). Lots with no paid date of BC's own (BC's blank
      `0001-01-01`, or paid before BC kept it) fall back to the settled date, counted in the run's notes.
    - The panel says **"Paid on (BC)"** (`PAID_EXACT_HELP`) or **"Paid by (BC settled date)"** per
      case (`paidTerm(source, exact)`), read from the check's own timeline line: its FIRST line says
      "paid on … (BC's own paid date)" (`PAID_EXACT_MARK`) or "paid by …" (`paidExactFromText`,
      `readPaidExact` in lib/uncollected-settings.ts). A case BC already holds is told when it
      switches either way, even when the day is the same, so the label never goes stale. ⚠ Keep those
      words in the check's lines (`dueWords`, `feedChanges`) — and never "paid by" / "paid on" in any
      other line the check writes as its first line.
    - ⚠ **"Couldn't tell" is not "not published"** (`FindResult.paidDates`: `"exact"` · `"settled"` ·
      `"unknown"`). Only a probe row that really lacks the key makes a run `"settled"` — then a case on
      BC's own date is switched back, and says so. When the probe FAILS (BC didn't answer), or BC showed
      the key but refused it in a `$select` (400), the run is `"unknown"`: the lots are read without the
      field, new cases take the settled date, and every case BC already holds that is — or may be —
      on BC's own paid date keeps its paid date, its "Paid on" and the storage start that hangs on it
      (`SaveCtx.holdExact` → `feedChanges(…, { holdPaid })`). A passing fault must never flip cases to
      "Paid by" and back, rewriting their timelines and moving their storage each time.
  - **Writing the cases** — per invoice, ONE transaction under the SAME invoice lock as the Hub's own
    writes (`lockInvoice`, advisory lock first, then row locks — the SQL is repeated in the feed;
    change both together): (1) the case BC already holds for that invoice → its BC fields brought up
    to date, with an `edit` event ("BC update: lots not collected 3 → 2 …") only when something
    changed; a CLOSED one is left closed; (2) else an OPEN case added by hand with the same invoice
    number → **taken over** (`source "bc"`, `bcKey` set, event "Matched to BC invoice SI…"); (3) else
    a case for that invoice that was CLOSED by hand → left alone — never re-added behind the staff's
    back; (4) else an OPEN hand case with the same buyer number + sale and no invoice number → taken
    over — and a CLOSED one like that → left alone, as in (3) (a hand case with no invoice number stands
    for the buyer's whole sale); (5) else a **new case**: `waiting`, next chase today, storage from the
    rule's day, event "Added from BC: paid by 3 Jun 2026, 2 lots not collected after 49 days. Invoice
    SI…. Storage charges from 2 Jul 2026 by the storage rule (28 free days after they paid)." with the
    lot list. Taking a case over keeps its status, notes, chase dates, a storage start a person set,
    and timeline. Invoices left closed are counted in the run's notes.
    ⚠ **A decision waiting on Jack:** "closed by hand → left alone" (3, and 4's closed half) wasn't in
    the brief — it was chosen so the staff's decision stands. If he'd rather such an invoice came back
    as a new case, change both together (`saveCandidate`).
  - ⚠ **The feed writes only `BC_OWNED_FIELDS`** (name, buyer number, sale, invoice, lots still
    waiting, amount paid, paid by) **plus email / phone where the case has none**, put through the
    Hub's own rules (no bank or card shapes, at most 15 phone digits), **plus the storage start by the
    storage rule while no person has set it** (Storage charges, below). A case's status, notes, chase
    date (except a new case's first one), a storage start a person set, and timeline are the staff's. The only status
    it ever sets is `collected` (next point). Its events have no `byId` and are signed "BC check
    (nightly)" or "BC check (Check BC now — <name>)"; new cases say "BC check" as who added them.
  - **The lot list lives on the timeline, not in the notes** (notes are the staff's): the "Added" /
    "Matched" event lists each lot's sale, number, description and hammer, and an update that changes
    how many lots are waiting lists the ones left. The case page also reads the buyer's lots in that
    sale **live from BC** (`bcLotsForCase` → the feed's `bcLotsForBuyer`, with the admin's own sign-in).
    ⚠ On a case FROM BC the timeline doesn't SHOW the "Added" event (Jack, 2026-10-23: "can you remove
    these bits" — its lot list repeats Lots in BC). Display only (case-client.tsx's Timeline): the event
    is still written and stored, and the check's own rules still read it.
  - **One invoice can cover more than one sale**: the case's sale box then holds them joined, "F067,
    F068" (`joinSales`, 40 characters). When they don't all fit it keeps what fits and SAYS how many it
    left off — "F061, F062, F063, F064, F065, +4 more" (`salesLeftOff`) — and `salesOf` reads only the
    sale codes (split on commas; "+4 more" or words typed by hand are not sales). The case page reads
    each sale (up to 4, `CASE_PAGE_MAX_SALES`) and says how many it didn't.
  - ⚠⚠ **The QUICK re-check comes first, with no limit** (2026-10-23 — Jack, on sandbox after the
    location fix: *"things are scanned as collected and still showing"*). The cases the 08:30 run had
    added that morning, before the check read locations, sat open: the re-check below takes only 60 a
    run, and **none at all on a run whose time for reading BC ran out**. So an open case from BC the
    check no longer finds is first judged from what THIS run already read for its buyer
    (`FindResult.judged`, `droppedFromRun` in lib/uncollected-feed-match.ts): its invoice is paid in
    full and its lines were read, with lot numbers on them; its sale box holds all its sales and
    nothing else (no "+N more", no words typed by hand — `salesUnparsed`); **every "Buyer Premium for
    Lot No N" line on the invoice is matched to a different lot of theirs the run saw** in the box's
    sales (exact number + suffix first, then suffix-tolerant); **every sale in the box** has one of
    them; each was sold inside the window (no margin since 2026-10-23: every E100 case, sold on the
    window's first day, sat open — a lot sold before the window can't match a line, so it goes slow anyway); and **every
    one of them had its location read and it is a GONE one** → closed as
    collected right there (`closeAsCollected`, the same stop day and words as below), with no BC call,
    however many there are, even when the time for reading ran out. Anything else (a lot still on a
    shelf, at a QUERY location, its location not read, a sale with no lot in the run — all ticked, or
    aged out of the window — or the buyer not judged this run) goes to the slow re-check below, as
    before. Saving's own time limit and a Stop still stop it; what's left is said in the run's notes
    (by its cause) and closed next run.
    - **Invoices with ticked lots too** (2026-10-23 — sandbox had 4,408 such cases waiting, 60 a run:
      26,842 of 37,015 unticked lots were at COLLECTED or SHIPPED). Before saving, the check reads the
      lots BC TICKED in those cases' sales, up to 20 buyers a call per sale (`readTickedFor`, only for
      cases where every unticked lot the invoice's numbers fit has gone — `droppedNeedsTicked`), and
      `droppedFromRun` takes them as its 4th argument: an invoice line may then be matched to a ticked
      lot as well as a gone one. A (sale, buyer) the read didn't get → that case has no ticked list and
      goes to the slow re-check. Every unticked lot the invoice's numbers fit must STILL have gone, and
      every line must still be matched to a different lot (one lot seen by both reads counts once).
    - ⚠⚠ **A lot missing from the run is NOT proof it went.** The run only holds lots BC hasn't ticked,
      of sales inside the 12-month window, as BC's paging gave them. The reviews of 2026-10-23 found
      the first version closing an invoice over F050 + F051 once F050 aged out with its lots still on
      a shelf — whether or not the box still named F050 — and the same for a row BC's paging skipped.
      Hence "every lot on the invoice matched", "every sale" and the margin: an invoice lot the run
      didn't see (ticked, aged out, skipped) always sends the case to the slow re-check, which reads
      each sale whole with no date filter. Never relax it to "the lots the run saw are gone".
    - The feed's lots are told apart by the WHOLE line (unique id + sale + lot + buyer), never the
      unique id alone: an item re-entered and sold again keeps its unique id, and dropping one of the
      two lines hid a lot that was still here. A failed location read of a shared unique id holds back
      every buyer with it.
    - ⚠ Known, older and NOT fixed by this: when a sale ages out of the window while its lots are still
      here, the next save rewrites the case's sale box and lot count from the lots the run still sees,
      so those lots drop off the case — and the SLOW re-check, and Close as collected, which read only
      the box's sales, can then close it on the rest (the quick one can't: it matches every invoice lot).
  - **An open case from BC the check no longer finds** (the quick re-check didn't settle) is judged on
    POSITIVE evidence only, and only
    for buyers it fully checked — at most 60 a run (`pickDropped`): cases whose buyer has no lot left
    in the window that isn't gone (ticked, or at a GONE location — the likely collected ones) first,
    with at least half the places; each group
    turns round by the run's sequence number, so every case is reached in turn and one left open on
    purpose (lots still waiting, not paid any more) never holds a place for ever. None of it after a
    Stop or once saving ran out of time. Its invoice isn't paid in full any more
    → said ONCE on the case ("BC no longer shows invoice SI… as paid — check it") and left open; still
    paid and every lot of theirs on it that BC still shows is gone — ticked collected, or at a GONE
    location (its lots' receipt lines are read for the ones BC hasn't ticked; `droppedEvidence`) →
    **closed as `collected`** ("BC shows the lots collected" — with the locations when they decided it:
    "(location COLLECTED)", "(1 ticked as collected; 1 at location SHIPPED)"), ⚠ with `closedAt` = the **stop day** (`collectedStopFrom`, below
    under Storage charges), never the moment the check noticed; anything else (lots still waiting, the
    rest at a QUERY location, nothing to be found under the buyer, couldn't be read) → left as it is and
    counted in the run's notes. A lot BC hasn't ticked whose location couldn't be read there leaves the
    case as it is (counted as "couldn't be read", never as "still waiting"). ⚠ A case whose sale box
    had to leave sales off ("+N more") is NEVER closed this way — not every lot of theirs can be looked
    at — and the notes say so.
    - ⚠ **A close a GONE location decided says the storage figure may be too high**
      (`collectedCloseText`): BC keeps no date for the scan to COLLECTED either, and many such cases
      were opened in error — the lots were already scanned out (docket never posted) before the case
      was added, as with E100's lots 513/551 — so their figure can run weeks past the day the lots
      left. The line names the locations and says to check the figure and waive the storage if so; the
      run's notes say it too. ⚠ **A decision for Jack:** whether such cases should stop the clock
      earlier (at the case's `createdAt`, say, or charge nothing) instead of only saying so — then
      change `closedAt` for location closes in `checkDropped`, never in a page.
  - **Idempotent**: run twice, the second run changes nothing. **One at a time**: a lock on
    `globalThis`, and a refusal while the database shows a run started under
    `UNCOLLECTED_RUN_STALE_MINUTES` (30) ago and unfinished (one from before this server started is
    dead — a restart ends it). Missing tables → "needs Run Migrations", nothing written.
  - **Every run is an `UncollectedSyncRun` row** (**NEEDS Run Migrations**): start, finish, trigger,
    who, ok, lots seen, buyers, found, added, updated (taken-over cases included), closed, notes,
    error. A run that couldn't read part of BC, ran out of time, or was stopped says so (`ok` false)
    and keeps what it saved — the next run reads BC afresh (from a different buyer). If BC's lot list
    itself couldn't be read in full, **nothing** is changed. An unexpected error part-way still
    records the counts and notes so far. The notes carry counts and invoice numbers, never a name.
  - **Nightly at 08:30 London** — `server.js` → `POST /api/cron/uncollected` (`CRON_SECRET`; the ONE
    background sign-in, `getBCTokenAny()`), after BC's overnight payment run. Same fixed-London-time
    pattern as the warehouse sync, through its own `msUntilLondonTime(8, 30)` — ⚠ `msUntilLondonHour`
    takes the hour ONLY, because `INCREMENTAL_LONDON_HOURS.map(msUntilLondonHour)` passes it the array
    index (a minute parameter on it would move the 17:00 sync to 17:01). A wait of over three hours sleeps
    to two hours before 08:30 and works it out again then, so a clock change overnight can't make it
    fire an hour off (the warehouse schedules still can). A check that can't start waits for tomorrow.
    The route answers at once (202) and the check logs `[cron/uncollected] …` itself.
    ⚠ server.js's `UNCOLLECTED_LONDON_TIME` (08:30) and `UNCOLLECTED_NIGHTLY_AT` in lib/uncollected.ts
    (what the panel says) must agree — server.js is CommonJS and can't import it. **Check BC now**
    on the panel (admins) starts the same check with the admin's OWN BC sign-in (`getBCToken`, never
    the background one) via `startUncollectedSync`, answers at once, and the panel follows it
    (`uncollectedSyncNow()` for "Reading invoices — 120 of 312 buyers", then the run's row); not
    connected to BC → it says so.
  - **Stop** (design rule 7b): the panel's "Stop the check" asks first (inline), then `stopBcCheck()`
    → the feed's `stopUncollectedSync(name)` puts a flag on the run's lock. The check looks at it before
    every BC call (a wait between retries is cut short) and before each case it saves, then skips the
    re-check of dropped cases and records "Stopped by <name> — N cases were saved before it stopped
    (…); M it had found weren't saved" (`UNCOLLECTED_STOPPED_PREFIX`). Every case saved stays saved.
    It stops the nightly run too — both run in the one server process.
  - **The panel's BC line** (`bc-check.tsx`) — keep these in step when changing it: while a check runs
    it asks `lastSyncRun()` every 2 s (`POLL_MS`) and shows `uncollectedSyncNow().progress` with the
    time so far (the ticking time is outside the live region — a screen reader would read it out every
    second), then `syncResultWords` for the run. "Last checked from BC" is the newest ok
    `UncollectedSyncRun`, with how many cases from BC are open now; under it a red line when the newest
    run failed or never finished (grey when it was stopped), "Sign in to BC →" when BC refused a Check
    BC now's own sign-in (401), an amber warning when the last good check is over 36 hours old
    (`STALE_AFTER_MS`), and each run's notes folded under its line. ⚠ "Running" means THIS server
    holds the run's lock (one instance; the nightly run and Check BC now both run in it). An unfinished
    run row with no lock is a run that died without recording its end: shown as that, never as a
    spinner, and Check BC now says when it can run again (30 minutes after it started — the feed's own
    guard).
  - **Every case says where it came from** — "From BC" / "Added by hand" on every row, phone card,
    case page and CSV (`SOURCE_META`; the colour key explains both, and a hand case the check took
    over shows From BC). Cases from BC say "Paid by (BC settled date)", or "Paid on (BC)" once BC
    publishes its own paid date (above); hand ones "Paid" / "Paid on".
  - **The case page's "Lots in BC" card** (`[id]/bc-lots.tsx`) reads the lots live (above) as the
    case opens for a case from BC, and on a press for one added by hand — chosen over storing a lot
    list (the timeline keeps the snapshot). With several sales each lot says its sale. Below `sm` it
    is stacked rows, not a table. Columns LOT · **BARCODE** · DESCRIPTION · HAMMER · **LOCATION** · COLLECTED?
    (BARCODE since 2026-10-23 — Jack: "can you add the internal barcodes": BC's Internal Barcode,
    `PTE_InternalBarcode`, read off the lot's receipt line in the SAME Receipt_Lines_Excel call as its
    location — `RECEIPT_LINE_SELECT`, `LotPlace.barcodes` (optional) — the one starting with the lot's
    sale code when the item has had more than one. ⚠ On a wide screen Lots in BC spans the WHOLE page
    under Details / Status + Log contact, with Storage and the Timeline beside each other below it, and
    on a desktop the case page is up to 1,600px — "instead of using a scroll function just use more of
    the page"; never put it back in a half-width column where its table scrolls sideways.)
    (2026-10-23 — Jack: *"can you also add the location in here please"*): Location is the lot's live
    BC location code (and bin), "—" for none, "Not read" when its receipt line couldn't be read. The
    COLLECTED? chip follows the check's own rule (`lotState`): green **Collected** when BC ticked it or
    its location is a GONE one (with a small "by location" under it when only the location says so),
    amber outlined **⚠ Check this lot** at a QUERY location (and an amber box listing them — "Lot 513 is
    at MISSING in BC — check it before chasing"), amber **Not collected** otherwise; the headline count
    ("2 not collected, 1 to check, 3 collected") follows the same rule. ⚠ No key under the list since
    2026-10-23 (Jack: "can you remove these bits") — the chips say what they mean in words, and each
    has a hover saying why (design rule 3 is met by the words, not a legend). Lots to check are listed first, then not collected. A location read that fails
    still shows the lots (judged on the tick) and says how many couldn't be read and why.
  - **"✓ Close as collected"** (2026-10-23): when that list reads every lot collected (ticked or at a
    GONE location), every sale of the case was read and the list isn't cut short, and the case is open,
    a green box under the headline offers to close it. ⚠ It never trusts the page's read:
    `closeCollectedFromBc` (admins, the admin's own BC sign-in) reads BC AGAIN and closes only if
    `collectedFromLiveLots` still says every lot has gone — a lot still here, at a QUERY location, a
    sale not read or a list cut short is refused in plain words, and a lot whose location BC didn't
    give says THAT ("couldn't be read from BC just now — try again"), never "still here". A sale box
    holding anything that isn't a sale code ("F067, F068 day 2" on a hand case) is refused up front
    (`salesUnparsed`), and counted as a sale not read on the card, so the box never shows for it; so is
    a sale that reads NO lots of theirs (`emptySales` — "F068-2", a typo), named on the card. It
    closes the way the check does: Collected, `closedAt` = the stop day (`collectedStopOf` — the last
    full BC check), only if the case still has the status, buyer number and sale it was read with, and
    a status line (`collectedCloseText(…, "page")`) naming the locations and the storage warning,
    signed by the admin. A refusal stays on the card (until the card's own Read again) and the list is
    read again, so it shows what the server saw; a lost answer says it may or may not have closed and
    refreshes the page. The card lists lots by the whole line (sale + lot + unique id), never the
    unique id alone, like the check. A case added by hand can be closed this way too — and its box says the BC check
    WON'T close it (the check only touches cases from BC).
  - **Docket · shipment** (2026-10-23 — Jack: *"i need a way to filter the list to know what has a
    shipment number and i need the collection docket number … also i need to know who packed it which is
    the internal reference inside of the shipment request card"*). Verified live and in the BC source the
    same day: each lot's **collection docket** is `Auction_Lines_Excel.EVA_CollectionNo` (COL049233 —
    the feed's `LOT_SELECT` reads it, `FeedLot`/`CandidateLot.collectionNo`, optional); a **shipment
    request** is BC's published `ShipmentRequestAPI` (page 58001 on table 75762 EVA_ShipmentRequest, the
    same feed the Packing page reads), one per docket: `EVA_DocumentNo` = the docket, `EVA_No` = the
    shipment number (SHP038405), `EVA_Status` (enum 75762: Awaiting Release · Error · Released ·
    Cancelled), `EVA_ShipmentDate`, `EVA_TrackingNo`, and `PTE_InternalReference` (PTE table-extension
    55008 — the card's "Internal Reference") = **who packed it**. Its type is always "Collection" (enum
    75761 has one value). ⚠ `SHIPMENT_SELECT` never asks for the request's name, address, email or phone.
    - **The BC check reads them** before saving, in a slot of their own (`SHIPMENT_BUDGET_MS`, 90 s —
      read even when the run's time for reading BC has run out, so the buyers it did judge still get
      theirs, and never counted against the run): every
      candidate's dockets, `EVA_DocumentNo eq … or …` up to 20 a call (one at a time if BC refuses the
      batch); and after saving writes **`UncollectedShipping`** (one row per case — its own table,
      **NEEDS Run Migrations**; cascade on the case): `collectionNos`, `shipments` (every request, JSON),
      `shipmentNos` and `packedBy` (cancelled ones left out), `checkedAt`. Only for a candidate whose
      dockets were ALL read this run; anything else keeps the row it had. BC is read only.
    - **"Has a shipment" = a shipment request on a docket of the case that isn't cancelled**
      (`isLiveShipment`). The list's **Shipment** chips — Any · Has a shipment · No shipment — count with
      the search, statuses and age band applied (`?ship=yes|no` in the address — a filter, never a
      name). A case not read yet (a new one, one added by hand — the check never reads those — or before
      the first check after Run Migrations) is in neither, only under Any, and the panel says how many.
      Before Run Migrations the chips say it needs Run Migrations and the filter is ignored (`shippingReady`
      with `to_regclass` — every read is tolerant).
    - The list's **Docket · shipment** column (the docket, then each shipment number · status, then
      "Packed by …"), the phone cards, the case's Details card and the CSV (Collection docket, Shipment,
      Shipment status, Packed by) all show the same `UncollectedCaseDetail.shipping`. ⚠ The column is a
      ninth column on a DESKTOP only (`desk:` — the panel page is up to 1,600px there); below that (an
      iPad in landscape, lg) it sits under the sale and invoice, because nine columns made the list scroll
      sideways there (review, 2026-10-23). A case not read says why: "Added by hand — not read from BC",
      or "Not read yet" — never a promise that the next check reads it. The check doesn't spend BC time
      reading shipments before Run Migrations (`shippingTableThere`).
- **"Start again from BC" — TEST SITES ONLY** (2026-10-26 — Jack: *"why don't we wipe the data and I do a
  fresh import"*). A box at the foot of the panel, shown only when `startAgainSite()` (lib/uncollected-
  settings.ts) names the site — an ALLOWLIST: RAILWAY_ENVIRONMENT_NAME exactly "staging" or "sandbox";
  production, a dev machine or no name never get it — and `startAgainFromBc` checks again on the server.
  Admins only; type START AGAIN; refused while a check is running here. It deletes EVERY case on the list
  (from BC and by hand, open and closed — their timelines and shipping go with them, cascade) and every
  `UncollectedSyncRun`, in one transaction; the storage settings stay; the deletion is written to the
  server's log. Then Check BC now reads everything fresh. ⚠ Never widen it to production.
- On a `bc` row the Hub refuses changes to `BC_OWNED_FIELDS` ("change it in BC") and refuses Delete
  (the feed would bring it back — close it instead). A manual case can be deleted, confirmed in the
  page. Contact details, chase dates, storage start and notes stay the Hub's own (a storage start a
  person sets is never moved by the check — Storage charges, below).
- ⚠ **One OPEN case per invoice** (case-insensitive) — the feed's "adopt the open manual case"
  depends on it. Enforced by every write that could break it: adding a case, giving an open case a
  new invoice number, and reopening a closed case whose invoice has had another case opened since.
  Each takes a transaction-scoped advisory lock on the invoice (`lockInvoice` —
  `hashtext('uncollected-invoice:' || lower(invoice))`, via `$executeRaw`) FIRST, then checks, then
  writes, in one transaction, so two people doing it at once queue and the second is refused. A
  refusal names the buyer and carries the other case's id (`existingId`); every screen that can be
  refused links to it. ⚠ Always the advisory lock before any row lock (updateCase then takes the row
  `FOR UPDATE`), so these writes can't deadlock each other; setStatus only writes if the case's
  status AND invoice are still what it read. A closed case may share an invoice with an open one.
- ⚠ **Customer personal data, and never bank or card details.** `looksLikeBankDetails()` refuses
  the obvious shapes — the words "sort code" or "IBAN"; a sort code beside an 8-digit account number
  (one that reads as a date, 22-10-26, only with an account word nearby); a card number (13–19
  digits of WHOLE digit groups, unbroken or in a card's grouping, passing the Luhn check — so two
  phone numbers side by side are never a card) — in **every box**: name, buyer number, sale,
  invoice, email, notes, contact text and closing reasons. The phone box takes at most 15 digits
  (no phone number has more) instead, because some real international numbers pass the card check.
  The timeline records which contact details changed, never the old values.
- ⚠ **Nothing personal goes in a URL — only the case id and the filters `?status= &age= &sort=`.
  NEVER the search** (`uncollectedFilterQuery` never writes it, `parseUncollectedFilter` ignores a
  `?q=`): a search is usually a customer's name or email, and an address ends up in the browser's
  history and the server's request logs. The panel sends the search to `listCases` itself (a
  server action — a POST, nothing in the URL) and keeps it in the tab's **sessionStorage** (in
  try/catch, restored after hydration) so Back from a case returns to the same search. The server
  page always renders the list unsearched. Don't move the search back into the address bar.
- **Deleting a case** removes its timeline with it, so `deleteCase` writes one line to the server's
  log (`console.info "uncollected case deleted"`: who, when, the case id, source, buyer number and
  invoice — never contact details). Accounts has no audit table and none was added for this.
- It is listed in `lib/data-map.ts`.
- Registered in `lib/help-map.ts` as **"Paid, not collected (Accounts)"** — ⚠ never "Accounts → …":
  with "Accounts" as a name part, any question mentioning accounts would score against this
  admin-only entry and refuse a Simple-mode user about their own screens.

### 💷 Paid, not collected → storage charges per lot after the free days (2026-10-23)

Jack: *"remember its 4 weeks after the item has been paid for we need to start charging them for
keeping the lots here they will be charged per lot"*.

- ⚠⚠ **The Hub never charges anything in BC, and never stores money.** The figures are worked out live
  (they change every day) for staff to raise the charge. BC has **no storage logic** of its own (checked
  in the BC source on the Hub).
- **The standard charges are Jack's: £2.00 per lot per WEEK** (2026-10-23 — *"it's £2 per lot per
  week"*). So the defaults (`STORAGE_DEFAULTS`) are **28 free days after payment, then £2.00 (200p) per
  lot per WEEK + 20% VAT on top, any part of a week counting as a whole week**. ⚠ Settings already
  saved in `UncollectedSettings` still win (a saved row is never overwritten by a change of
  defaults; a blank column in it falls back to the new default). Until 2026-10-23 the defaults were
  £5.00 per lot per DAY, taken from an old commented-out footer on BC's own buyer invoice (Reports/55004
  AuctionInvoiceT0V: *"Storage charges of £5 per lot per day + VAT will be strictly enforced
  thereafter"*) — that is NOT what Vectis charges, so it must never be put back as the default. The
  same footer's *"an additional charge of £10 + VAT per lot … on larger lots where they have to be
  removed to our warehouse"* is **not built** — ask Jack before adding it.
- **The maths is one pure function, `storageCharge()` in lib/uncollected.ts** (no Prisma — the panel's
  client parts use the same words). Change it there, never in a page, and re-run the made-up-date
  checks (BST changes, the grace boundary, collected stops the clock, week rounding, waived):
  - **Storage starts the day AFTER paid day + the free days**, in London days (`storageStartDay`):
    paid 1 Oct with 28 free days → free to 29 Oct, charged from 30 Oct. The case appears on the panel
    on day 28 (`UNCOLLECTED_AFTER_DAYS`, a separate constant), the last free day. ⚠ With FEWER free
    days than that, storage is already running when a case from BC appears: nothing is lost (it counts
    from its start), but the tile and the list can't show it until day 28. The settings box says so
    (`storageGraceWarning`) rather than refusing — the check's wait was deliberately left at 28 (Jack's
    "over 4 weeks" chase rule); ask Jack before tying it to the free days.
  - **Chargeable days = storage start → today, or → the day the case closed, both ends INCLUSIVE**,
    never negative. Collected or closed another way stops the clock on that day (`closedAt`).
    - Closed BY HAND (a status change): `closedAt` is the moment it was pressed — staff press it on
      the day the lots go, and that day is charged.
    - ⚠⚠ **Closed by the BC check** (BC shows the lots collected): BC keeps **no collected date**, so
      `closedAt` is the **stop day** — the London day of the check's PREVIOUS run that read BC's lot
      list in full (`lotsSeen` over 0), the last day the lots could have been seen still here
      (normally yesterday's nightly check; today's when Check BC now runs after it; the day before
      today when there's none) — `collectedStopFrom` in lib/uncollected-feed-match.ts, stored at 12:00
      UTC that day. Its timeline line says so. Never the moment the check noticed: at 08:30 that
      charged every case it closed at least a day too many. Known limit: a case that waited more than
      one run to be re-checked (60 a run, `DROPPED_CHECK_LIMIT`) may have gone before the stop day, so
      it can still be over by those days — the line says "the last day they could have been seen".
      ⚠ Worse when a GONE **location** decided the close (scanned to COLLECTED, docket not posted): the
      lots may have gone before the case was even added, so the line says to check the figure and waive
      it if so — a decision for Jack whether to stop the clock earlier ("An open case from BC the check
      no longer finds", above).
  - **Per lot still uncollected** — the case's `lots` (for a case from BC, never a lot that is ticked
    collected, at a GONE location, or at a QUERY location — "Gone" above). Not known → no total ("Lots not known"),
    never a calm £0; no start (no paid date, none set) → no figure either (design rule 7).
    - ⚠ **A lot collected part-way through is NOT charged for the days it was here**: the figure is
      the lots still here TODAY × every day since the start (the brief's rule), so when the check
      lowers `lots` ("lots not collected 3 → 2") the storage those lots built up drops out of the
      figure. The case's storage card and "How cases are added" say so. ⚠ **A decision waiting on
      Jack:** if he wants them charged until they went, work lot-days out from the timeline's lot-count
      changes instead of the current count — in `storageCharge`'s inputs, never in a page.
  - **Owed = lots × rate × days**, or × **whole weeks started** for "per week" (12 days = 2 weeks), ex
    VAT; VAT on the total, to the nearest penny (half up, `vatOnPence`); and the total. All in PENCE.
  - The words are `storageWords` ("£2.00 per lot per week + VAT since 15 Nov — 3 lots × 2 weeks (12
    days — a week started counts as a week) = £12.00 + VAT £2.40 = £14.40"; per day: "… — 3 lots × 12
    days = …"), `storageShortWords` for a column, `rateWords`,
    `storageSettingsWords`; `addStorage` sums many (the tile: open cases only, inc VAT — a minimum when
    some have no lot count, which it counts).
- **The settings are `UncollectedSettings`** — one row, id `"default"` (graceDays, ratePence, period
  `day`/`week`, vatPercent, who last changed it) — **NEEDS Run Migrations**. `lib/uncollected-settings.ts`
  (server only, NOT a `"use server"` file) reads it tolerantly: a missing table → the defaults with
  `ready: false` (the panel says they can't be changed yet); any other fault → the defaults with
  `readFailed: true` (the panel says the figures may be wrong, and the BC check sets or moves NO storage
  start that run). A blank or out-of-range column falls back to its default (`normaliseStorageSettings`).
  Saving is **admins only** (the panel's `saveStorageSettings` action checks `getAccountsAccess()` first,
  then calls the helper, which checks every value in plain English — 0–365 free days, up to £1,000 a
  lot, 0–100% VAT — and writes nothing when nothing changed, so "last changed by" stays true). The
  change is also written to the server's log (`console.info "uncollected storage settings changed"`).
  - **Save asks first, in the page** (`previewStorageSettings`, admins only, read only): what the new
    charges are, that EVERY case's figure changes at once — collected and closed ones too, since money
    is never stored, so a figure already used to raise a charge will read differently — and, when the
    free days change, how many open cases from BC will have their start moved, each with a timeline
    line (`countStartMoves`, the same rule as the move itself — `restampDay`). "Saving and moving start
    dates…" while it runs; the answer says how many moved, how many couldn't be, and — when the cases
    couldn't even be read (`startsUnread`) — that the BC check moves them when it next looks at each.
  - ⚠⚠ **The settings lock.** `saveStorageSettings` writes the row inside a transaction holding
    `pg_advisory_xact_lock(hashtext('uncollected-storage-settings'))` EXCLUSIVELY; every case the BC
    check saves takes the same lock SHARED (`lockStorageSettingsShared`) after the invoice lock and
    reads the free days inside that transaction (`graceDaysInTx`). So a check part-way through a run
    can't save a case on the old free days after the restamp has looked at the cases (it finished
    first, so the restamp moves it — or it waits and reads the new ones), and a case it adds after the
    change starts on the new ones. ⚠ `graceDaysInTx` only when the table is known to be there
    (`settingsInTx`): a missing table would abort the whole transaction. Before Run Migrations the
    check uses the standard free days, and looks again now and then during the run.
  - The box is **admins only** (the panel is) and its Change button is **disabled** before Run
    Migrations (`STORAGE_SETTINGS_NOT_READY`) and while the settings couldn't be read
    (`STORAGE_SETTINGS_READ_FAILED`), saying which underneath.
- **Where the storage start lives: the case's own `storageFrom`** (no new column). For a case from BC the
  check writes it (new cases, cases it holds, cases it takes over) and **moves it when the paid date or
  the free days change** — but ⚠⚠ **never a start a person set**. Who set it is read from the timeline
  (`storageStartOwner`): the newest `created` / `edit` / `status` event mentioning "storage charges
  from" decides — with `STORAGE_RULE_MARK` ("by the storage rule") it's the rule's; otherwise a
  person's (Changed storage charges from to …, or Storage charges apply — storage charges from …);
  "storage charges from cleared" hands it back to the rule. A start with no such event but a date on
  the case (typed when a case was added by hand) is a person's (`ruleMaySetStart`).
  - ⚠ Those words are load-bearing: `FIELD_LABELS.storageFrom` ("storage charges from"), the rule's
    `storageRuleWords`, and the Storage status line's "storage counted from …" (deliberately NOT
    "storage charges from", or the rule's start would read as a person's). Change them together.
  - **Changing the free days** moves the start of every OPEN case from BC whose start the rule owns
    (`restampStorageStarts`, run by the save): each move is its own small write, only if the start is
    still what was read, with a line on the case signed by the admin and carrying the rule's mark.
    The rate, per day/week and VAT need nothing moved — every figure follows at once.
  - A case added by hand with no storage start uses the rule live from its paid date (`startBasis:
    "rule"`); the check never writes to a hand case it hasn't taken over.
  - The first BC check after this shipped gives every open case from BC its start, with ONE "BC
    update: storage charges from … by the storage rule" line on each timeline — expected, not a fault.
  - **The case page says who set the start from the timeline, never by comparing dates**
    (`UncollectedCaseDetail.storageStartBy`, read by `readStorageStartOwner` — its own small read, so a
    long timeline can't hide it): "Set by the storage rule" (with what today's free days would give,
    when it differs — a closed case keeps the start it had), "Set on this case by a person" (the check
    leaves it alone; **Use the standard date** / **Hand it back to the storage rule** clears it, which
    hands it back), or "No start date is set". "The BC check keeps the start in step" is said only when
    the rule owns it.
  - **"Storage charges apply" with no start** (`setStatus`): with a paid date, nothing is stored — the
    rule's start already applies (the line says "storage counted from …", ⚠ never "storage charges
    from"), which can be EARLIER than the day the status was picked (an old hand case charges back to
    its standard start). With no paid date it starts today (a person's start), written only if the case
    still has no start. ⚠ **A decision waiting on Jack** (the old behaviour was "charges start the day
    the status is picked"): if he wants that back, set `storageFrom = today` with the "storage charges
    from …" line for every case with no start, and drop the rule branch and the status card's words.
- **Waiving storage** (admins only, a reason needed): an event of kind **`storage_waived`** whose text
  IS the reason, and **`storage_resumed`** (an optional note) to charge it again. The **latest** of the
  two is the switch (`storageWaiverOf`, `readCaseStorageFlags`) — no schema change. Waived → nothing
  owed and not in the tile, but the case still shows what it would have been. `EVENT_META` gives both
  their words and symbols on the timeline.
  - `waiveStorage(id, reason)` / `resumeStorage(id, note?)`: the event's text is ONLY the reason or
    note (bank and card shapes refused, `STORAGE_LIMITS.reason`). Each locks the case's row
    (`FOR UPDATE`) first, reads the latest switch event, answers "nothing changed" when it is already
    that way, and stamps the event's `at` after the lock, so two presses can't both write one and the
    switch events sort in the order they were made. Confirmed in the page; the answer gives the figure.
- **The panel** (`app/(app)/tools/accounts/uncollected/**`, actions in `lib/actions/uncollected.ts`):
  - A **"Storage owed" tile** — `storageOwedOnOpenCases` over EVERY open case whatever the filters,
    inc VAT, with "£X + VAT on N cases · N waived · at least — N with no lot count / no paid date"
    under it. ⚠ When cases ARE being charged but none can be added up (every one has no lot count) it
    shows "—" and says so — never a calm £0.00 (design rule 7); "No open case is being charged yet"
    only when nothing is charged, waived or uncounted. An amber note when the settings couldn't be read.
  - A **"Storage owed" column** (ex VAT, inc VAT under it, the whole sentence on hover; Waived · Free
    until … · Lots not known · None · —, with "no VAT" at 0%) — the colour key explains every one.
  - The case's **Storage card**: the sentence, the figures (two to a row while the card is half the
    page), where the start came from (above), the start-date box, Waive / Charge again.
  - **CSV** columns (worked out on the day of the export): Paid date is · Storage charges from ·
    Storage days charged · Storage weeks charged (per week only — blank per day) · Lots charged ·
    Storage £ ex VAT · Storage VAT £ · Storage £ inc VAT · Storage waived (reason, who, date and what
    it would be). Numbers stay numbers, so a spreadsheet can add them up.
  - The **"Storage charges" settings box** (above).

---
## 💷 Accounts → Refunds (2026-10-26)

Jack: *"here is our current refund log … customers requesting issues, partial refunds or returns … make
it better with the data you have"* and *"I want it all to be in the Hub, nice and clean"* — the Refunds
tile in Admin & Operations (`/tools/refunds`, card `REFUNDS`, **admins only** like Paid, not collected:
no appKey; every action re-checks `getAccountsAccess().isAdmin` on the server). It replaces the
SharePoint "Refund Log" the Microsoft Form filled: requests come from the Hub's own public form
(`/refund`, above), are added by staff (vendor payouts and the like), or were imported once from the old
log. The words, money rules and shapes are `lib/refunds.ts` (plain, client-safe); the shared server
helpers `lib/refunds-server.ts`; staff actions `lib/actions/refunds.ts`; BC look-ups `lib/refunds-bc.ts`;
the import `lib/refunds-import.ts` + `lib/actions/refunds-import.ts`.

- **Tables `Refund`, `RefundLot`, `RefundEvent`** (cascade) — **NEEDS Run Migrations**; until then the
  panel says so and the form answers 503. Nothing was added to `Customer`, `Contact` or `User`
  (`customerId` is a plain id, matched from the C-number by `matchCustomerId`).
- **The reference** `RF0042` is `Refund.ref`: max + 1 under `pg_advisory_xact_lock(hashtext('refund-ref'))`
  inside the creating transaction (`nextRefundRef`). It is shown to STAFF only — the public form never
  returns it (it's sequential).
- **Statuses**: New · Being looked at · Waiting for the item to come back · Agreed — to pay · Paid ·
  Declined · Closed another way (Declined and Closed need a reason). **Complete for accounts** is a
  separate tick, only once Paid. A status change only wins if the status is still the one the page
  showed. Unknown statuses read as New.
- ⚠ **The money** (checked against every row of the old log): commission = the buyer's premium, **27%
  of the hammer inc VAT** (`BUYERS_PREMIUM_INC_VAT`, overridable per lot); a lot refunds N% of hammer +
  commission, N% of the hammer only, or a set amount (`lotRefundPence`); postage refunded is added on
  top. Only a WHOLE total is saved (`refundTotalToSave`) — while any lot can't be worked out the total is
  null and the list says "Not worked out", never a partial figure as if complete. All money in pence.
  ⚠⚠ **27% is only the standard premium — the commission is what BC CHARGED** (2026-10-28, Jack: *"use
  BC's actual charge"*): an online bidder also paid BC's **web premium** (4.95% + VAT — 32.94% in all;
  28 of the old log's lots had 27% where BC charged it). `bcCommissionOf` = (`EVA_BuyerPremiumEarned` +
  `EVA_WebPremium`) each + 20% VAT, as the invoice adds them (checked against buyers' invoices). On a lot
  BC moved to the returns account (C000079) BC zeroes the premium but keeps the web premium — the premium
  is put back at `STANDARD_PREMIUM_RATE` 22.5% (what those buyers' invoices showed). A lookup fills a
  BLANK (or still-BC's) commission box with it, only beside BC's own hammer, saved as
  `RefundLot.commissionFromBc` (**NEEDS Run Migrations**); a blank box is still worked out at 27%.
  Buyers only — a vendor's payout isn't worked from the buyer's premium.
- ⚠ **Only flag, never change** (2026-10-28, Jack: *"only flag — I'll check each one"*): opening a
  request CHECKS its saved lots against BC (`lookUpRefundLots(…, check)` — no barcode read) and says
  BC's hammer / commission beside any that differ or are missing, with "Use BC's" — a commission's only
  on an OPEN request (a paid or closed one is left as it was). The Lots & money card says when the old
  log's total isn't what its lots work out at, or the saved total (the list's) isn't. **🔎 Check the
  money** (a collapsed card on the panel — `checkRefundMoney`, slices of 10, Stop / Carry on) goes
  through every request and LISTS the ones to look at (BC's figures, the sums, lots that can't be worked
  out, no lots, a day it came in in the future or before its sale) — it writes nothing. The day it came
  in (`receivedAt`) can be put right under Edit details (the old log mixed UK and US dates — RF0420
  "8/12/2026" came in as 8 December): never blank or in the future, never after the date processed or
  closed; an old-log request closed "on the day it came in" moves its closed day with it; the timeline
  says the day it was before.
- **Fill from BC** (read only, the admin's own BC sign-in): `Auction_Lines_Excel` for the buyer's
  C-number and the sale (or the auction date), the sold lots whose numbers the request names — it
  PROPOSES lots with hammer, description, barcode and receipt; nothing is saved until Save.
- **A lot row looks itself up** (2026-10-26 — Jack: *"when the lot number and the sale has been filled
  in the barcode number and receipt number pull in with it along with hammer price"*): on the Lots &
  money card, once a row has a sale (or the request an auction date) and a lot number, `lookUpRefundLots`
  (`lookUpLotsInBc`, read only) runs ~0.7 s after the typing stops — `Auction_Lines_Excel` by sale + lot
  (`EVA_LotNo` as a number, then as text, then the whole sale if BC refuses both — its type isn't pinned
  down) for the hammer, unique ID, description and buyer, then `Receipt_Lines_Excel` by unique ID for
  `PTE_InternalBarcode` and `EVA_ReceiptNo` (`RefundLot.barcode` / `receiptNo` — **NEEDS Run
  Migrations**). ⚠ The barcode is the one for THAT sale (a lot gets a new barcode each sale it goes
  into: the one starting with the sale code, or its only one unless that plainly carries another
  sale's code — never a guess between two; the receipt is the chosen barcode's line's). A box is
  filled only when blank or still holding BC's own value (each row keeps what BC put in it, `BcFill`;
  saved per box as `RefundLot.hammerFromBc` / `descriptionFromBc` — older lots, with only `fromBc`,
  count as typed) — a hammer typed by hand is never overwritten (BC's is shown with "Use BC's"), and a
  saved row looked up for its barcode only gets what it's missing; changing a row's
  sale or lot takes the other lot's BC values out at once, so no other lot's hammer can be saved
  against it. A lot BC shows bought by someone else is still filled, with that said (one on the returns
  account, C000079, is a refund's own — said as that, not as someone else's). Only rows that
  are new or whose sale/lot changed are looked up on their own — opening a request never changes its
  boxes; saved rows without a barcode (the old log's, or saved before this) have **🏷️ Get barcodes
  from BC**. Save waits while a lookup is pending. Signing in to BC from the card opens a new tab
  (leaving would lose unsaved lots).
- **🔗 Match sales from BC** (a collapsed card on the panel — 2026-10-26, Jack: *"the sale is either an
  F/E number but these say no sale or it's a date — can you match it and import it"*): every request
  with no sale code gets one: from its lot rows if they already carry ONE sale (BC not asked), else
  BC (`matchRefundSales` → `matchSaleInBc`, read only) — ⚠ it needs the buyer's C-number (a date and a
  lot number alone fit nearly any sale that day): C-number + auction date → the one sale of theirs
  that day holding ALL the request's lot numbers (only if they bought NOTHING dated that day → the day
  before, all lots required — a two-day sale is dated by its first day; no lot numbers → their only
  sale that day, and none in another sale dated the day before); C-number, no date → the one sale
  holding all the lots in the six months before it came in. The lot numbers are the lot rows' (a row
  that isn't a lot number stops it); with no rows, the lots box's only when ALL of it reads as lot
  numbers (`parseLotNumbers` — "2 items" is not lot 2). A lot row's typed barcode or receipt for
  another item keeps it out; a request changed in any way mid-run (`updatedAt`) is left for the next.
  ⚠⚠ **BC moves a refunded / returned lot's buyer to the house account `C000079`** (`RETURNS_ACCOUNT` —
  25 of 30 refunded lots checked on 2026-10-27: same sale, lot and hammer as the log, buyer C000079),
  so the customer's C-number no longer finds it. When the buyer's lines don't show the lots, the lots
  on the date bought by the buyer OR C000079 are taken — only when every lot is there once in one
  sale AND their hammers add up to EXACTLY the request's (the log's own hammer) (`matchViaReturns`).
  An ambiguous slash date in the log (5/8/2026) is also tried the other way round (`otherReadingOf`) —
  but ONLY by that hammer-confirmed rule, both days together (a lot on both days → listed, not guessed);
  the buyer-only rules never run on a guessed date.
  ⚠ Only a sale that's the **only one** fitting is saved; a lot gets the sale (and its unique ID,
  barcode, receipt, description where blank) only when BC places THAT lot in it; money is never
  changed, nothing a person entered is replaced, and a request edited mid-run is left for the next.
  The rest are listed with why (vendors aren't matched). Slices of 8, with Stop / Carry on.
- **The old-log import** (admins, a collapsed card on the panel): the SharePoint CSV, decoded in the
  browser as Windows-1252, parsed by column NAME, idempotent by `importKey` (sha256 of a row
  fingerprint) — a row already imported is never changed, a row changed in SharePoint since is refused
  ("make the change in the Hub"); bank/card details are taken out of every cell before saving; Date and
  Auction date are UK day-first, "Date processed" is US month-first (SharePoint's export). Batches of
  50 with a Stop. The admin chooses whether old rows "dealt with" but never processed count as done —
  ⚠ the DEFAULT is "bring them all in open" (Jack, 2026-10-26: *"leave them unticked for now"*; the
  first staging import went in counted-done by accident). **"Came in as done by the import?"** in the
  same card (`reopenCountedDone`) brings those back open — To pay (the import's accounts tick taken off)
  or Being looked at — but only ones untouched since: still in the status the import chose and NOTHING
  on their timeline after the import's line (checked again under a row lock). It finds them by the
  "(chosen at import)" words IN that line (other notes can follow them; "came in as Paid" says which
  choice), and counts ones it already reopened by its own "brought back open … never said it was
  processed" line — keep those words.
- The search is never in the URL (it's usually a name or email) — sent to `listRefunds` and kept in the
  tab's sessionStorage, as on Paid, not collected. Export CSV is made in the browser from what's shown.
- Listed in `lib/data-map.ts` (customer data) and in `lib/help-map.ts` as "Refunds (Accounts)".

## 🏷️ Barcode Labels (2026-10-28)

Jack, 2026-10-28: *"in Admin and Operations we need a new barcode panel — an easy way to print them,
it currently uses a mail merge and it confuses most people"* and *"it needs to follow the exact
template to fit on the sheets — we print around 600 per sale"*.
- **What it makes:** a sale's Lot ID labels (sale code + running number, at least 3 digits — X160001,
  `barcodeOf`) on **Avery L7651** (A4, 5 × 13 = 65 a sheet, 38.1 × 21.2 mm), as ONE PDF
  (`lib/barcode-labels-pdf.ts`, pdf-lib, server side — never pdfkit). Each label: the sale date
  (dd/mm/yyyy, 8 pt), the Code 39 barcode, the number 24 pt bold — the Word template's
  "Avery_38x21-R EDIT.docx" (an Excel "LotID Label Generator" fed it Barcode + Sale_Date).
- ⚠ **Each label is CENTRED ON ITS STICKER** (`STICKERS` / `LABEL` / `labelFit` in
  `lib/barcode-labels.ts` — Jack, 2026-10-29: *"have you made sure it fits on the paper"*, *"this doesn't
  line up"*): the stickers are 38.1 × 21.2 mm, 5 across at the template's pitch (2160 + 143 tw = 40.62 mm)
  and 13 down touching (21.2 mm), the block centred on A4 — 4.7 mm each side, 10.7 mm top and bottom.
  The template's three lines, sizes and spacing, ONE left edge, the block centred across and down: a
  normal code (F018001) keeps 2.3 mm clear left and right (the Code 39 quiet zone) and 2.6 mm top and
  bottom; even a 10-character one 1.27 mm. The Word template's own grid (`SHEET` — table at 10.0 mm /
  6.1 mm, 21.17 mm rows, the barcode and number pulled out to the cell edge, so on the sticker they sat
  1.3 mm from the left and 3.3 mm from the right, the date indented more) sits on the stickers to within
  1.4 mm; it's kept as the record. Printed at **Actual size** (100 %), never "fit" — the PDF sets
  PrintScaling None. The page's preview draws the sticker with the same `labelFit`.
- ⚠ **The barcode is Code 39 drawn as vector bars** (`lib/code39.ts`, checked against bwip-js for all
  43 characters), the SAME size as the template's Libre Barcode 39 font at 22 pt — measured from the
  font: narrow bar 0.03 em = 0.2328 mm, wide 3 × narrow, bars 0.59 em (≈ 4.6 mm) — so the scanners
  (`lib/photo-prep-barcode.ts` reads Code39, `/scan`) read them as before. A longer code that wouldn't
  fit the label gets narrower bars (`barNarrowFor`), and a smaller number.
- **The page** (`/tools/barcodes`, tile "Barcode Labels" in Admin & Operations, app key **BARCODES** —
  grant it per person in Users & Permissions; admins have it): TYPE the sale number (Jack, 2026-10-29:
  *"we would write the sale number, for example F018, then choose 600 lots, so it would do barcodes from
  F018001 to F018600"*) — a sale the Hub knows (BC's copy — WarehouseItem, upcoming sales included — plus
  the Hub's sales, four months back to a year ahead) fills its date, and the next ones are buttons to
  tap; the first number carries on from the last run printed for that sale; how many (600 to start
  with; 1 / 5 / 10 sheets in a tap, at most 1,300 = 20 sheets); "start on label" for a part-used sheet; a
  preview of the first label; Print posts a form into a new tab (inside the tap — iPad Safari).
  **Test on plain paper** draws each label's edges and isn't logged.
- **The log** (`BarcodeLabelRun` — **NEEDS Run Migrations**): every real print, so numbers already printed
  are pointed out (never refused — reprinting spoilt labels is normal) and "Print again" refills the
  boxes. Best effort: a log that can't be written never stops the labels.
- The route (`POST /api/barcodes/labels`) checks the BARCODES app itself (`requireBarcodes` — /api is
  outside the login gate) and only answers this Hub's own pages (`fromThisHub`); a refusal is plain text
  for the new tab. Nothing touches Business Central.
- Listed in `lib/data-map.ts` (Facilities) and in `lib/help-map.ts` as "Barcode Labels" (not the word
  "labels" alone — Packing owns it). ⚠ `/tools/barcode-sorter` is an unrelated old stub.

## 🔐 Two-factor login (2026-10-22)

Jordan: a tick box per person — *"Could we set it up as a tick box in the user panel would make
testing easier"* — plus "remember this device for 30 days". Users & Permissions → a person →
**Two-factor login** card: **Require two-factor**, and **Reset two-factor (lost phone)**.

- **Authenticator app codes (TOTP)**, built on Node's `crypto` in `lib/two-factor.ts` — no new
  package. ⚠ **No backup codes** (Jordan, 2026-10-22: *"if a staff member loses access we would
  rather they come see an admin and we can reset it for them"*) — a lost phone is always an admin's
  Reset, so keep a spare admin account unticked. The `backupCodes` column is unused; don't bring
  them back without asking. Each authenticator time step is accepted once (`lastStep`), so a code seen over a shoulder can't
  be replayed. Wrong codes count towards the login attempt limit in `auth.ts`.
- **Its own table, `UserTwoFactor`** (**NEEDS Run Migrations**) — never columns on `User` (the
  login lockout rule above). `readTwoFactor` treats a MISSING table as "not required", so a deploy
  can't lock anyone out; ⚠ any other database fault throws, so a blip never lets a ticked person
  in on their password alone. Don't widen that catch.
- **Flow** (`authorize` in `auth.ts` → `app/login/actions.ts`): password right + ticked + set up →
  the login form asks for the code (`2fa_required` / `2fa_wrong`). Ticked but not set up →
  `2fa_setup`: NO session — a 15-minute signed set-up pass cookie (path `/two-factor`) and a
  redirect to **`/two-factor/setup`** (public EXACT path in `auth.config.ts`; the pass is the only
  way in). There they scan the QR, confirm a code, then sign in properly.
- **Remember this device**: a signed `vectis-2fa-device` cookie for 30 days, set only when a code
  was actually typed. It includes the person's `enabledAt`, so **Reset** kills every remembered device.
- ⚠⚠ **Every key comes from `AUTH_SECRET`.** Change it and every secret and remembered device
  stops working — everyone ticked must be reset and set up again. Rotate
  `AUTH_SECRET` BEFORE switching two-factor on for real.
- ⚠ Known limit: whoever first signs in to a ticked-but-not-set-up account sets up its phone. Tick
  someone when they're about to sign in, not days ahead.
- Unticking keeps the set-up (ticking again needs no new QR). Admins only, checked on the server.
